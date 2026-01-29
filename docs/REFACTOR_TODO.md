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
