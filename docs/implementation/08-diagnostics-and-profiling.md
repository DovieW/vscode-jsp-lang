# Feature 8 — Diagnostics & profiling (JSP rendering performance)

> **Scope reset (2026-02):** Runtime profiling features were removed from the core extension and are now out of scope.

This document outlines how to implement **runtime profiling** and **performance diagnostics** for JSP pages, e.g.:

- measure JSP rendering time
- identify slow pages/partials/includes
- warn about inefficient patterns (e.g., excessive includes)

This feature is fundamentally different from “editor diagnostics”: it requires **runtime data from the server/container**.

## Goal

Provide a workflow where users can:

1) run or attach to their Java web app
2) collect per-request metrics that include JSP page timing
3) view results inside VS Code and jump to the relevant `.jsp` lines/files

## Non-goals

- Perfect attribution of time to individual JSP lines (usually impossible without deep instrumentation)
- Supporting every servlet container in v1
- Profiling in production by default (privacy/security concerns)

## Reality check: what’s actually measurable

### What’s feasible

- Time spent handling a request mapped to a JSP (page-level timing)
- Count of includes per request (`<jsp:include>`, tag-based includes) — best effort
- Hot pages list (p95/p99 render time) if you collect enough samples

### What’s hard

- Accurate breakdown per JSP fragment when taglibs are involved
- Time spent inside DB calls triggered by tag handlers (requires tracing)

## High-level architecture

### Two components

1) **Data collector** (runs with the app)
- collects timing events and metadata
- exports them (HTTP endpoint, log stream, file)

2) **VS Code extension UI**
- fetches/reads events
- aggregates, visualizes, and links results to JSP files

## Data collection approaches

### Approach A — Application-level servlet filter (MVP)

**Idea**

Add a servlet filter to the webapp that measures time per request and logs:

- request path
- resolved JSP (best effort)
- elapsed time

**Pros**

- Easiest to implement
- Works across containers

**Cons**

- Mapping “request → actual JSP executed” is not always trivial
- Doesn’t capture internal includes accurately without extra hooks

**Feasibility**: Medium (but requires app changes)

### Approach B — Container-specific hook (Tomcat Valve) (more accurate, less portable)

**Idea**

For Tomcat, implement a Valve or use container logging that provides more internal details.

**Pros**

- Can be more precise for JSP dispatch

**Cons**

- Container-specific
- Harder setup

**Feasibility**: Hard

### Approach C — Java agent / bytecode instrumentation (deepest, most complex)

**Idea**

Ship a Java agent (ByteBuddy/ASM) that instruments JSP-generated servlet classes and key JSP runtime calls.

**Pros**

- Best chance at capturing includes and internal timings

**Cons**

- Complex and brittle across container versions
- Requires JVM args (`-javaagent`)

**Feasibility**: Very hard

### Approach D — Java Flight Recorder (JFR) events (best “serious” approach)

**Idea**

If the app runs on a JDK that supports JFR:

- create custom JFR events (or leverage existing HTTP/server events)
- record JSP timing as structured events
- export `.jfr` and analyze

**Pros**

- Low overhead, production-grade tooling
- Great ecosystem for timeline analysis

**Cons**

- Still needs instrumentation to emit JSP-specific events
- Requires JDK/JFR access and some operational know-how

**Feasibility**: Hard → Very hard

## Recommended plan (phased)

### Milestone 1 (MVP) — “Log-based profiling”

Deliver a very practical workflow:

- The extension can start a local dev server (or attach) and read a log stream/file.
- The server side logs lines like:
  - timestamp, request, jspPath, durationMs, status

Extension features:

- Command: “JSP: Import Profiling Log” (choose file)
- View: top slow pages (avg/p95)
- Clicking an entry opens the `.jsp`

This does **not** require a debugger and avoids deep container coupling.

### Milestone 2 — Live stream over HTTP

- Provide a small collector that exposes an endpoint (e.g., `http://localhost:PORT/__jsp_profile/events`)
- Extension polls/subscribes and updates a live view

### Milestone 3 — Include counts and hotspots

- Enrich events with:
  - include count
  - list of included JSPs (best effort)

### Milestone 4 — JFR / agent-based deep profiling (optional)

- Only if you truly need it.

## VS Code UI integration options

### Option 1 — Tree view + webview details (recommended)

- Tree view: “JSP Profiling” with groups:
  - Slowest pages
  - Most frequent pages
  - Most includes
- Webview panel: charts + tables

### Option 2 — CodeLens annotations (advanced)

Show CodeLens above JSP files:

- “Avg 38ms (p95 120ms) over last 50 requests”

This requires careful caching and should be opt-in.

### Option 3 — Diagnostics as hints (careful)

Use diagnostics sparingly for performance, e.g.:

- “This JSP averages p95 > 500ms in latest run”

But avoid noisy diagnostics that feel like errors.

### MVP (Milestone 1)

- User can load a profiling log file and see slow pages sorted by p95
- Clicking an entry opens the JSP

### Live mode (Milestone 2)

- Extension updates the slow-page list without reload

### Include insights (Milestone 3)

- Extension can show “most includes” and “top included JSPs” (best effort)

## Testing strategy

- Unit tests:
  - log parser
  - stats aggregation (p95, p99)

- Integration tests:
  - open a workspace fixture, load a log, verify navigation to JSP file

## Security & privacy notes

Profiling data can include:

- URLs, query strings, user identifiers, cookies (if logged)

Guidelines:

- default to collecting minimal metadata
- document clearly what’s stored
- provide redaction options for query strings

## Risks

- Without server-side instrumentation, the extension cannot “measure” anything.
- Container diversity makes deep profiling expensive.
- Performance tooling can be noisy; keep UX opt-in and focused.
- Profiling in production by default (privacy/security concerns)
