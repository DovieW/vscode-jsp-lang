# Feature 4 — Debugging JSP: breakpoints, stepping, and runtime inspection

This document outlines how (and how hard) it is to support **debugging at the JSP source level** while a Java web app runs in a servlet container.

The desired experience:

- Set a breakpoint on a `.jsp` line (including lines containing scriptlets)
- Hit the breakpoint while debugging/attaching to the running JVM
- Step and inspect variables, while VS Code shows the **JSP source**, not the generated servlet Java

## Big picture: why this is difficult

JSPs are compiled into **generated servlet Java sources** and then into bytecode. The Java debugger debugs bytecode with source mapping to Java sources.

To debug “at the JSP level”, you need a reliable mapping:

- JSP line/column ↔ generated Java line/column ↔ bytecode locations

The mapping is typically produced by the container during JSP compilation and may not be accessible in a standard way.

## Goal

Provide a workflow where users can:

1. Attach to a JVM running a web app (Tomcat/Jetty/etc.)
2. Set breakpoints in `.jsp` files and have them bind reliably
3. When stopped, see stack frames and source locations resolved back to `.jsp`

## Non-goals (realistic boundaries)

- Supporting all containers equally in v1
- Debugging taglibs “as if they were JSP lines” (tags are usually compiled into helper calls or tag handler classes)
- Full variable/value mapping from generated Java locals back to JSP expressions

## What VS Code allows us to do

VS Code debugging is based on **DAP** (Debug Adapter Protocol). From an extension, you can:

- Contribute a debugger type or intercept/debug adapter communication
- Provide debug configuration resolution
- Provide a debug adapter (executable/server/inline) via a `DebugAdapterDescriptorFactory`
- Observe and potentially rewrite messages using a `DebugAdapterTracker`

Key APIs:

- `DebugAdapterDescriptorFactory.createDebugAdapterDescriptor(...)`
- `DebugAdapterTrackerFactory.createDebugAdapterTracker(...)`
- `debug.registerDebugConfigurationProvider(...)`

## Integration strategies

### Strategy A — “Proxy” debug adapter that rewrites sources (recommended)

**Idea**

- Do not build a Java debugger.
- Instead, run the existing Java debug adapter, but place a lightweight **proxy adapter** in between:
  - VS Code ↔ *JSP Proxy Adapter* ↔ Java Debug Adapter

The proxy:

- Translates breakpoints set in `.jsp` into breakpoints in generated servlet `.java`
- Translates stopped events / stack traces / source references so frames point back to `.jsp`

**Why this is plausible**

DAP is designed for an “adapter” component. A proxy is a common pattern when you need source mapping.

**Hard parts**

- You must obtain and maintain the JSP↔Java mapping and find the correct generated servlet source.
- You must ensure breakpoints bind and remain stable across recompiles.

### Strategy B — Use a DebugAdapterTracker to rewrite messages (prototype-only)

**Idea**

Attach a `DebugAdapterTracker` to an existing debug type and rewrite messages on the fly.

**Reality check**

- Trackers are best for logging/telemetry.
- Rewriting DAP messages via trackers is fragile and depends on what VS Code exposes.

Use this only for experimentation.

### Strategy C — Provide a dedicated `jsp` debug type (rarely worth it)

This would bundle a debug adapter and potentially implement DAP fully.

**Not recommended** unless you intend to build/own a full debugging product.

## Core prerequisite: source mapping & generated servlet discovery

To make any approach work, you need to answer:

1. For a `.jsp` file, which generated servlet class does it compile to?
2. Where is the generated `.java` source (if available)?
3. What is the line mapping JSP → generated Java?

### Possible mapping sources

Different containers provide different mechanisms. Common patterns include:

- Generated source files stored in a work directory (e.g., Tomcat `work/`)
- Debug metadata or mapping comments embedded in generated sources
- Container-specific compilation artifacts (sometimes SMAP-like mappings)

**Reality**: there is no single, portable answer.

### Practical v1 constraint

Pick one supported path first, e.g.:

- **Tomcat** (common, predictable work directory)

…and design everything else as “best effort / experimental”.

## Proposed architecture (Strategy A)

### Components

1) **VS Code extension (client)**

- Registers a debug configuration provider for a new “jsp attach” configuration that wraps Java attach
- Starts the proxy debug adapter

2) **JSP proxy debug adapter**

- Speaks DAP to VS Code
- Speaks DAP to the underlying Java debug adapter
- Maintains a mapping service for JSP↔generated Java

3) **Mapping service**

- Locates container work directories
- Watches generated sources for updates
- Builds mapping tables for each JSP

### DAP flow: setting breakpoints

When VS Code sends `setBreakpoints` for a JSP source:

1. Proxy receives `setBreakpoints` with `source.path = /path/to/view.jsp`
2. Proxy resolves generated servlet source (e.g., `.../work/.../view_jsp.java`)
3. Proxy maps each JSP line to one or more Java lines
4. Proxy sends `setBreakpoints` to Java adapter for the generated Java source lines
5. Proxy returns the resulting breakpoint verification status back to VS Code

### DAP flow: stopped events / stack traces

When the Java adapter reports a stop:

1. Proxy requests stack trace
2. For each frame, if the source is a generated servlet `.java`, map it back to `.jsp`
3. Rewrite:
   - `StackFrame.source.path` to the JSP file
   - `StackFrame.line` to JSP line
4. Return rewritten frames to VS Code

### Source retrieval

If the debugger requests source content (`source` request) for generated sources:

- Prefer returning the actual JSP file if mapping exists
- For frames that can’t be mapped, fall back to generated Java

## Configuration & UX

### Debug configuration

Add a debug configuration provider that creates an “attach to JVM + JSP mapping” configuration.

Example fields (conceptual):

- `type`: `jsp-java`
- `request`: `attach`
- `hostName`, `port` (standard Java attach)
- `container`: `tomcat` (future: `jetty`, `wildfly`, etc.)
- `tomcatWorkDir`: explicit path override
- `webappRoot`: map JSP paths to deployed paths if necessary

### Activation events

Use debug activation events so the extension doesn’t load unnecessarily (e.g., `onDebugResolve:type`).

## Milestones (recommended)

### Milestone 1 — Proof of concept: map stack frames only

- Attach to Java
- When stopped inside generated servlet code, rewrite stack frames back to JSP

This validates the mapping approach before you attempt breakpoint translation.

### Milestone 2 — Breakpoint translation (JSP → generated Java)

- Support setting breakpoints in `.jsp`
- Translate to generated `.java` and verify binding

### Milestone 3 — Robust mapping refresh

- Detect JSP recompiles and refresh mappings
- Handle line drift gracefully

### Milestone 4 — Taglibs and stepping polish

- Best-effort mapping for tag handler calls (likely stays limited)
- Improve user-facing messages for unmapped frames

## Acceptance criteria

### P0 (Milestone 1)

- Attaching to a JVM and breaking in generated servlet code shows the corresponding `.jsp` file and line in VS Code

### P1 (Milestone 2)

- A breakpoint set on a `.jsp` line containing `<% ... %>` binds and is hit
- Stepping keeps the user in `.jsp` view when mapping exists

### P2 (Milestone 3+)

- Recompiling JSPs during a debug session does not permanently break mappings

## Testing strategy

- Unit tests:
  - mapping parser from generated sources to JSP lines (fixture-based)
  - breakpoint translation logic

- Integration tests:
  - Start a minimal container fixture (e.g., Tomcat) in CI (if feasible)
  - Run attach debug session and verify DAP messages / frame rewriting

## Key risks / blockers

- **Mapping availability**: some containers don’t preserve sufficient mapping information.
- **Generated source accessibility**: production deployments may not keep generated `.java` files.
- **Classpath + servlet API alignment**: debugging depends on how the app is built and launched.
- **Maintenance burden**: container-specific behavior means ongoing upkeep.

## Practical recommendation

Treat Feature 4 as an advanced, container-specific capability.

If you want the fastest credible path:

1) implement stack-frame rewriting for Tomcat-generated sources
2) then add breakpoint translation
3) expand compatibility only after you have strong tests and clear user configuration knobs
