# Refactor / follow-up ideas

## Taglib feature follow-ups

- **Don’t rescan the whole workspace every ~15s**
  - Current MVP rebuilds the taglib index on a simple time-based staleness check.
  - Better: wire up file watching for `**/*.tld` via LSP `workspace/didChangeWatchedFiles` (client-side) or VS Code FS watchers (extension-side), then rebuild incrementally.

- **Make TLD discovery configurable**
  - Add settings like:
    - `jsp.taglibs.webInfGlobs`
    - `jsp.taglibs.maxScanDepth`
    - `jsp.taglibs.excludeGlobs`

- **Jar scanning (META-INF/*.tld)**
  - If enabled, read TLDs from dependency jars (requires classpath / build tool integration or jar glob heuristics).

- **More robust parsing of tags/attributes**
  - Diagnostics currently use regexes against raw JSP text.
  - Better: use the HTML scanner/AST and map projected offsets back to JSP, so we can avoid false positives in scripts/strings and report cleaner ranges.

- **Hover support**
  - Use `<description>` from TLD tags/attributes for hover docs.

  - Status: implemented (MVP) — see `samples/feature03-tests/taglibs-hover-docs.jsp`.

- **Attribute value completions beyond boolean**
  - Status: boolean-only is implemented (`true|false`).
  - Future: enums (rare in TLDs), framework-specific known values, and bean/property inference (Feature 2).

- **Support tagdir directives**
  - `<%@ taglib prefix="x" tagdir="/WEB-INF/tags" %>` (tag files) could be indexed separately.

## Debugger integration (Feature 04) follow-ups

- **Move from tracker-based rewriting to a proxy adapter (Strategy A)**
  - The current Milestone 1 implementation rewrites `stackTrace` responses using a Java debug adapter tracker.
  - Trackers are inherently best-effort; a proxy adapter gives more control and can support breakpoint translation.

- **Make JSP path resolution configurable**
  - Current mapping tries common web roots (`src/main/webapp`, `WebContent`) and direct workspace-relative paths.
  - Add settings for explicit web roots and/or deployed context mapping.

- **Improve mapping parser coverage**
  - Add fixtures from real Tomcat/Jasper generated sources across versions.
  - If feasible, consider SMAP-based mapping for higher fidelity.
