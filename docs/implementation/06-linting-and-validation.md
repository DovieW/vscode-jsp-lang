# Feature 6 — Code linting & validation for JSP

This document outlines how to add JSP-focused linting and validation on top of:

- Feature 1 (embedded HTML/CSS/JS language features)
- Feature 2 (Java-in-scriptlets analysis)
- Feature 3 (taglib/TLD indexing)

The goal here is **JSP-aware diagnostics** for common mistakes and modernization guidance, even when deeper semantic engines are unavailable.

## Goal

Provide diagnostics in `.jsp` files for:

- Common JSP errors (unknown taglibs/tags/attributes, broken directives)
- Common maintainability problems (scriptlet-heavy pages, deeply nested logic)
- Project hygiene checks (unresolvable include paths, suspicious taglib URIs)

Diagnostics should be:

- Fast (incremental, debounced)
- Configurable (rules on/off, severity)
- Conservative by default (avoid false positives)

## Non-goals

- Replacing full HTML/CSS/JS/Java compilers
- Proving runtime correctness (container- and deployment-dependent)
- Enforcing a strict style guide out of the box

## Where this runs

### Option A — In the extension host (quick MVP)

Implement a `DiagnosticCollection` and update it on document changes.

Pros:

- Fast to build
- No language server packaging

Cons:

- Cross-file and indexing work can become heavy in the extension host

### Option B — In a JSP language server (recommended long-term)

Implement diagnostics in the LSP server and publish via `textDocument/publishDiagnostics`.

Pros:

- Scales better with workspace indexing
- Co-locates with other parsing/indexing (Features 2/3)

Cons:

- Requires LSP scaffolding

Recommendation: if you’re already implementing Feature 1/2/3 via LSP, put linting there.

## Rule categories

### Category 1 — Syntax & directive validation (lightweight)

Rules that can run without external tools:

- `directive/taglib-missing-prefix`
  - Uses a prefix `<x:...>` without a matching `<%@ taglib prefix="x" ... %>` in the document.
- `directive/taglib-missing-uri`
  - Taglib directive missing `uri`.
- `directive/page-import-parse`
  - Malformed `<%@ page import="..." %>` (unbalanced quotes, etc.)

These should be **warnings**, not errors.

### Category 2 — Taglib/TLD-backed validation (Feature 3 dependent)

- `tag/unknown-tag`
  - Tag name not found in the resolved taglib.
- `tag/unknown-attribute`
  - Attribute not defined for that tag in the TLD.
- `tag/missing-required-attribute`
  - Attribute marked required in the TLD but absent.

Severity guidance:

- Unknown tag/attribute: warning (unless you are confident the index is complete)
- Missing required attribute: warning

### Category 3 — Include path validation

- `include/unresolvable`
  - `<%@ include file="..." %>` or `<jsp:include page="..." />` cannot be resolved to a file.

Support both:

- absolute web paths (`/WEB-INF/...` style)
- relative includes

Severity: warning (many projects resolve includes at build/deploy time).

### Category 4 — Scriptlet modernization rules

These are “best practice” diagnostics, not correctness diagnostics:

- `scriptlet/present`
  - Any scriptlet detected.
- `scriptlet/too-many`
  - More than N scriptlet blocks in a file.
- `scriptlet/too-large`
  - A single scriptlet block exceeds M lines.
- `scriptlet/nested-control-flow`
  - Heuristic detection of deeply nested `if/for/while` in scriptlets.

Severity: info or warning (default info).

### Category 5 — Java semantic validation (Feature 2 dependent)

If Feature 2 provides Java parsing/diagnostics:

- surface Java syntax/type errors found inside scriptlets
- optionally tag “bad practice” patterns (e.g., `out.println` in loops) as hints

## Rule engine design

### Rule interface

Define rules as pure functions over a document + available indices:

- Input:
  - document text + version
  - extracted regions (scriptlets, directives, tags)
  - taglib index (optional)
  - workspace file resolver (optional)
- Output:
  - list of diagnostics (range, message, severity, code)

### Rule configuration

Add settings (future) such as:

- `jsp.lint.enable`: boolean
- `jsp.lint.rules`: object mapping rule id → `"off" | "info" | "warning" | "error"`
- `jsp.lint.scriptlets.maxCount`: number
- `jsp.lint.scriptlets.maxLines`: number
- `jsp.lint.includes.enable`: boolean

### Debouncing and caching

- Debounce runs (e.g., 300–700ms after last change)
- Cache parse outputs per document version
- Only re-run taglib rules when:
  - the document’s taglib directives changed, or
  - the taglib index changed

## Diagnostics UX

- Use diagnostic `code` to identify rules (e.g., `jsp.tag.unknown-attribute`).
- Provide quick fixes where safe:
  - Add missing taglib directive skeleton (optional)
  - Convert `<%-- --%>` comment toggling is already supported via language config, not a lint fix

## Milestones

### Milestone 1 — Heuristic linting (no workspace index)

- Scriptlet presence/size/count rules
- Directive parsing warnings

### Milestone 2 — Include resolution

- Resolve includes against workspace file system (configurable roots)

### Milestone 3 — Taglib-backed validation (Feature 3)

- Unknown tag/attribute checks
- Missing required attributes

### Milestone 4 — Java-backed diagnostics (Feature 2)

- Surface Java diagnostics within scriptlets (mapped back to JSP)

## Acceptance criteria

### Must-have (Milestone 1)

- Editing a JSP file shows an info diagnostic when any `<% ... %>` scriptlet is present (configurable)
- Malformed taglib directive produces a warning with a precise range

### Nice-to-have (Milestone 2)

- Unresolvable include paths produce warnings

### Taglib validation (Milestone 3)

- Unknown attributes on a known `<prefix:tag>` produce warnings

### Java validation (Milestone 4)

- A Java syntax error inside `<% ... %>` produces a diagnostic on the JSP line/column

## Testing strategy

- Unit tests for each rule with fixture JSP strings
- Snapshot tests for diagnostic output (ids, ranges, severities)
- Integration tests (VS Code extension tests) that:
  - open a JSP document
  - edit text
  - assert diagnostics appear/disappear

## Risk management

- Avoid “error” severity unless you’re confident (index complete, deterministic validation)
- Prefer opt-in strictness via settings
- Keep rules small and explainable; users will ignore noisy linters

---

## Current status in this repo (Milestones 1–4 ✅)

We currently ship JSP-aware diagnostics via the bundled language server:

- **HTML diagnostics** (minimal, conservative) and **CSS diagnostics** for embedded regions (Feature 01 foundation)
- **Taglib diagnostics** for unknown prefixes/tags/attributes when `.tld` data is available (Feature 03 foundation)
- **JSP linting MVP** (Feature 06):
  - Info diagnostic when any **scriptlet** (`<% ... %>`) is present
  - Heuristic scriptlet rules (configurable thresholds):
    - too many scriptlets in a file
    - scriptlet too large (line count)
    - deeply nested control flow (brace-depth heuristic)
  - Warnings for malformed taglib directives missing `prefix` or `uri`
  - Warnings for **unresolvable include paths** in `<%@ include file="..." %>` and `<jsp:include page="..." />` (best-effort filesystem resolution)
  - Optional: **Java syntax diagnostics** for code inside scriptlets (no type checking)

- **Quick fixes (Code Actions)** for a few safe cases:
  - Add missing `prefix`/`uri` attributes in a `<%@ taglib ... %>` directive
  - Add a `<%@ taglib prefix="..." uri="" %>` skeleton when a prefix is used without being declared

What’s still out of scope / not implemented:

- Java type-check / classpath-aware diagnostics inside scriptlets (Feature 2 prerequisite)
