# Feature 9 — Framework & project-specific configuration

This document outlines how to support real-world JSP projects that vary wildly in layout and build tooling.

Feature 9 is the “glue” that makes Features 1–8 work reliably across:

- different webapp roots (`src/main/webapp`, `WebContent`, etc.)
- different taglib locations (`WEB-INF/tlds`, jars)
- different servlet API namespaces (Jakarta vs Javax)
- multi-module Maven/Gradle builds

## Goal

Provide configuration that lets users (and workspaces) tell the extension:

- where the web root is
- where taglibs/TLDs live
- how to resolve include paths
- how to resolve Java types/sources for scriptlets (when implemented)

…and do so with good defaults + helpful diagnostics.

## Non-goals

- Automatically supporting every Java build system perfectly without user input
- Replacing the Java extension’s project model

## Design principles

1) **Sane defaults** for common layouts, but never assume too much.
2) **Workspace-folder scoping**: in multi-root workspaces, config must apply per folder.
3) **Explainability**: always provide “why did we choose this path?” diagnostics.
4) **Opt-in expensive features**: jar scanning and classpath inference can be slow.

Practical note: jar-based taglibs are where configuration and project modeling collide. If you don’t know which jars are actually on the webapp runtime classpath, “scan jars for TLDs” quickly becomes either incomplete (misses jars) or unusably expensive (scans everything).

## Configuration surfaces

### 1) VS Code settings (primary)

Use `contributes.configuration` in `package.json` to define settings.

Use scopes:

- `resource` for file-specific behavior (rare)
- `workspace` for project config
- `machine` only if truly machine-specific (avoid)

### 2) Commands (secondary)

Add commands to help users bootstrap configuration:

- `JSP: Configure project...` (wizard)
- `JSP: Diagnose configuration` (shows what was detected)
- `JSP: Rebuild taglib index`

### 3) Status / output channel

Provide an output channel (or LSP server logs) showing:

- resolved web roots
- discovered TLDs
- jar scanning status
- servlet API namespace selection

## Proposed settings (v1)

### Web roots & include resolution

- `jsp.webRoots`: `string[]`
  - Workspace-relative directories considered web roots.
  - Defaults:
    - `src/main/webapp`
    - `WebContent`
    - `src/main/resources/META-INF/resources` (some setups)

- `jsp.include.resolveStrategy`: `"webRoot" | "relative" | "both"`
  - Default: `both`

- `jsp.include.additionalSearchPaths`: `string[]`
  - Extra folders to search for include targets.

### Taglibs / TLD discovery (Feature 3)

- `jsp.taglibs.enabled`: `boolean` (default `true`)

- `jsp.taglibs.webInfTldGlobs`: `string[]`
  - Defaults:
    - `**/WEB-INF/**/*.tld`

- `jsp.taglibs.additionalTldGlobs`: `string[]`
  - Empty by default.

- `jsp.taglibs.jarScanning.enabled`: `boolean` (default `false`)

- `jsp.taglibs.jarScanning.mode`: `"classpath" | "globs"`
  - `classpath`: use Java project model/build tool integration
  - `globs`: user provides jar globs

Recommendation:

- Prefer `classpath` whenever possible. `globs` is a last resort and should ship with very loud performance warnings.
- Even with `classpath`, consider limiting scanning to dependency jars that are plausibly relevant (and cache results aggressively).

- `jsp.taglibs.jarScanning.jarGlobs`: `string[]`
  - e.g. `**/*.jar` (strongly discouraged as default; too expensive)

### Servlet API namespace (Feature 2/4)

- `jsp.servletApi.namespace`: `"jakarta" | "javax" | "auto"`
  - Default `auto`

Auto-detection ideas:

- scan for dependencies / imports in project (if available)
- fall back to `jakarta` for newer projects, but always log the decision

### Java/scriptlet integration (Feature 2)

- `jsp.java.enabled`: `boolean` (default `false` until Feature 2 exists)

- `jsp.java.sourceRoots`: `string[]`
  - Optional explicit overrides

- `jsp.java.classpath.mode`: `"javaExtension" | "maven" | "gradle" | "manual"`
  - Default: `javaExtension` (if present)

- `jsp.java.classpath.manualJars`: `string[]`

### Performance / indexing controls

- `jsp.indexing.maxFiles`: `number` (default e.g. 20000)
- `jsp.indexing.watchFiles`: `boolean` (default `true`)
- `jsp.indexing.debounceMs`: `number` (default 300–800)

## Auto-detection strategy

### Heuristics (safe)

Detect common roots by probing directories:

- if `src/main/webapp` exists → use it
- else if `WebContent` exists → use it
- else → fallback to workspace folder root as a web root (with warning)

### Diagnostics

Expose a “diagnose” command that prints:

- selected web roots
- number of TLDs found
- whether jar scanning is enabled
- what jar scanning mode is active and how many jars are in-scope
- whether servlet API namespace is set/auto
- warnings about ambiguous layouts

## Multi-module Maven/Gradle considerations

Problems:

- multiple `src/main/webapp` directories
- shared taglibs in parent modules
- jars built locally and used as dependencies

Recommendations:

- treat each workspace folder independently by default
- allow `jsp.webRoots` to list multiple module web roots
- if jar scanning/classpath is enabled, compute per-module where possible

## Milestones

### Milestone 1 — Basic settings + diagnostics

- Implement configuration keys and defaults
- Implement “Diagnose configuration” command

### Milestone 2 — Better auto-detection + multi-webroot support

- Support multiple web roots and prioritize nearest matches for relative includes

### Milestone 3 — Taglib discovery configuration

- Allow custom TLD globs and rebuild index on config changes

### Milestone 4 — Java integration config (Feature 2)

- Servlet namespace selection
- Classpath strategy and overrides

## Acceptance criteria

- Users can fix broken include/taglib resolution by changing settings (no code changes required)
- Multi-module workspaces can specify multiple web roots and get correct include resolution
- A dedicated command shows exactly what the extension detected and why

## Risks

- Too many settings can overwhelm users → keep defaults strong and offer a guided command.
- Jar scanning can be expensive → make it opt-in with clear warnings.
- Classpath integration is the biggest source of complexity → prefer leveraging existing Java tooling where possible.
