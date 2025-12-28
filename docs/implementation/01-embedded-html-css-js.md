# Feature 1 — HTML/CSS/JS language features inside `.jsp`

This document describes how to implement **IntelliSense + validation** for embedded **HTML, CSS, and JavaScript** within JSP files.

> Current state: this repo provides **TextMate highlighting** and basic editor config. No IntelliSense/diagnostics/navigation.

## Goal

When editing a `.jsp` document (language id `jsp`), users should get (as much as realistically possible):

- HTML completions (tags, attributes, attribute values), hover, and diagnostics
- CSS completions/diagnostics inside `<style>` blocks (and inline `style="..."`)
- JavaScript completions/diagnostics inside `<script>` blocks
- Optional: formatting support for the embedded regions

## Non-goals (for this feature)

These are explicitly out of scope for Feature 1 (they belong to later features):

- Understanding/validating Java **scriptlets** (`<% ... %>`, `<%= ... %>`, `<%! ... %>`)
- Taglib/framework semantics (Struts/JSTL/custom tag completion/validation)
- Java navigation/refactors/debugging

## Why this is non-trivial

A JSP file is a single buffer with **multiple embedded languages** (HTML + CSS + JS + JSP directives/scriptlets/EL). VS Code’s built-in web language features mostly activate when the document language is `html` / `css` / `javascript`, not `jsp`.

To get “real” embedded IntelliSense you need one of:

1) **Virtual documents** + delegation (fastest prototype, but brittle)
2) A **JSP-aware language server** that parses JSP and provides web features itself (recommended long-term)

## Implementation options

### Option A — Virtual documents + delegate to existing providers (prototype path)

**Idea**

- Register a `TextDocumentContentProvider` (virtual docs) that exposes projections of a JSP file as:
  - “projected HTML”
  - “extracted CSS”
  - “extracted JS”
- When VS Code requests completion/hover/formatting for the JSP doc, translate the position into the virtual doc and call built-in commands like:
  - `vscode.executeCompletionItemProvider`
  - `vscode.executeHoverProvider`
  - `vscode.executeFormatDocumentProvider`

**Pros**

- Very quick to demo completions/hover
- Reuses built-in services (including TypeScript/tsserver for JS completions) *if they activate*

**Cons / gotchas**

- Many extensions/providers only activate on certain URI schemes (`file:`) or languages.
- Diagnostics are especially tricky because they’re usually produced asynchronously by language servers that may never “attach” to virtual docs.
- Keeping the virtual docs up-to-date and mapping edits back is extra work.
- Mixed-language formatting (HTML + JSP + embedded CSS/JS) is usually the hardest part to get right. Treat formatting as an optional milestone, not an assumed byproduct of “having IntelliSense”.

**Use when**

- You want a proof-of-concept quickly.

### Option B — One JSP-aware language server (recommended)

**Idea**

Create a language server (LSP) for `jsp` that:

1. Parses a JSP document into **embedded regions** (HTML container + CSS + JS sub-regions)
2. Builds projected documents and source maps
3. Uses language-service libraries to provide:
   - HTML completion/hover/diagnostics
   - CSS completion/hover/diagnostics
   - JS completion/diagnostics (hardest part)

**Pros**

- Works consistently (no reliance on other extensions’ activation conditions)
- You control diagnostics end-to-end
- Easier to test and evolve

**Cons**

- Largest up-front work (new extension code, build, server process)
- JS “full IntelliSense” is still expensive

**Use when**

- You want a maintainable solution.

### Option C — Hybrid: LSP for HTML/CSS + delegate JS to TypeScript tooling

**Idea**

- Implement HTML and CSS features inside your own LSP (via `vscode-html-languageservice` / `vscode-css-languageservice`).
- For JavaScript completions/diagnostics, delegate to tsserver *via* virtual docs or embedded TS service.

**Pros**

- Ships real value early (HTML/CSS), while JS catches up later.

**Cons**

- Two systems to maintain.

## Recommended plan (phased)

### Phase 1 (MVP) — HTML + CSS IntelliSense/diagnostics

Deliverables:

- HTML completion + hover in `.jsp`
- HTML diagnostics that don’t explode on JSP syntax
- CSS completion/diagnostics inside `<style>` and inline styles

Out of scope:

- “Full” JavaScript IntelliSense (do minimal support or none in MVP)

### Phase 2 — JavaScript blocks (incremental)

Deliverables:

- JS completion in `<script>` blocks (at least keyword + local symbol)
- JS diagnostics (syntax errors)

Phase 2A (simpler):

- Use TypeScript compiler API to do **syntax-only** parsing and offer basic completions

Phase 2B (true IntelliSense):

- Use TypeScript language service with project context (tsconfig/jsconfig) and module resolution

### Phase 3 — Tool integration hooks (ESLint/Prettier)

- Provide formatting by implementing LSP formatting or VS Code formatting providers.
- ESLint integration may require either:
  - reusing ESLint libraries directly, or
  - generating virtual `file:` artifacts (generally not recommended).

> Reality check: many tooling ecosystems (ESLint/Prettier) assume a real file on disk with a known language id. Expect extra work to make them behave well on projections.

## Core technical design (Option B)

### 1) Parsing JSP into regions

We need a fast “good enough” parser that can locate:

- HTML text
- JSP constructs to *mask* (so HTML parsing still works)
  - directives `<%@ ... %>`
  - scriptlets `<% ... %>`, `<%= ... %>`, `<%! ... %>`
  - JSP comments `<%-- ... --%>`
  - `${...}` / `#{...}` expressions inside attributes/text
- Embedded CSS regions
  - `<style ...> ... </style>`
  - inline `style="..."`
- Embedded JS regions
  - `<script ...> ... </script>`

**Rule of thumb**: prioritize correctness of offsets/line numbers over perfectly understanding JSP.

### 2) Projection strategy (“masked HTML”)

Create a projected HTML string $H$ from JSP source $S$ by replacing JSP tokens with whitespace **of the same length**.

- This keeps position mapping simple: line/column offsets remain aligned.
- Where possible, preserve delimiters that keep HTML structure valid.

Example masking policy:

- Replace `<% ... %>` content with spaces, but keep `<` and `>` if needed to avoid breaking surrounding HTML parsing.
- For `${...}` inside attributes, replace inner content with spaces but keep `${` and `}` so the HTML attribute remains a string.

### 3) Language services

- HTML: `vscode-html-languageservice`
- CSS: `vscode-css-languageservice`
- JS: TypeScript language service (best) or syntax-only fallback

Even if you start without JS, design the region mapper so JS can be plugged in later.

### 4) Source mapping

You need mapping functions between:

- JSP document position ↔ projected HTML position (often identity if lengths preserved)
- JSP position ↔ embedded CSS/JS document position (offset-based within each region)

Represent regions as:

- `kind: 'html' | 'css' | 'js'`
- `startOffset`, `endOffset` in the JSP document
- plus helpers to convert offsets to LSP positions

### 5) Diagnostics

On each change (debounced):

- Compute projected HTML + regions
- Run HTML and CSS validation
- Convert diagnostics back to JSP ranges
- Publish diagnostics under the original JSP URI

VS Code-side equivalent uses `DiagnosticCollection`; in LSP this is `textDocument/publishDiagnostics`.

### 6) Performance constraints

Target: keep latency under ~50ms for typical completion requests.

Techniques:

- Incremental document sync (LSP `TextDocuments`)
- Debounce diagnostics (e.g., 200–500ms)
- Cache parse results per document version

## Acceptance criteria (Feature 1)

### Must-have

- In a `.jsp` file, typing `<di` suggests `<div>` (HTML completion)
- HTML attribute completion works in common cases (e.g., `class`, `id`, `href`)
- `<style>` blocks provide CSS property/value completion
- HTML diagnostics don’t spam false positives on common JSP constructs (scriptlets, directives)

### Nice-to-have

- Completion works inside HTML attributes that contain `${...}` without breaking the entire attribute
- Hover works for HTML tags/attributes
- Formatting support for the HTML projection (with safe mapping back)

### Explicit limitations (documented)

- If JS IntelliSense is MVP-level initially, document that Phase 2 is required for “full JS”.

## Testing strategy

- Unit tests for:
  - JSP masking/projection (golden snapshots)
  - region extraction (script/style)
  - offset ↔ position mapping
- Integration tests (VS Code extension tests) for:
  - completion at given positions
  - diagnostics appear on the JSP document

## Milestone checklist

1. Scaffold extension codebase (client)
2. Add LSP server skeleton + connection
3. Implement JSP projection + region extraction
4. Wire HTML completion + hover
5. Wire HTML diagnostics
6. Add CSS support for `<style>` + inline style
7. Document limitations and config knobs

---

## Notes / references

- VS Code Virtual Documents guide (TextDocumentContentProvider)
- VS Code Language Server Extension Guide
- VS Code command `vscode.executeCompletionItemProvider` (useful for prototypes and tests)
