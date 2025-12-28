# Feature 2 — JSP scriptlets: Java IntelliSense, diagnostics, and navigation

This document outlines an implementation plan for **Java-aware** editor features inside JSP scriptlets and directives:

- Scriptlets: `<% ... %>`, `<%= ... %>`, `<%! ... %>`
- Directives that affect Java context: `<%@ page import="..." %>`

> Reminder: TextMate grammars can only do highlighting. Everything below requires extension code and (realistically) an LSP-based architecture.

## Goal

When editing a `.jsp` document (language id `jsp`), users should get Java-like behavior in scriptlet regions:

- Completion for Java keywords, locals, fields (where applicable)
- Completion for JSP implicit objects (`request`, `response`, `session`, `pageContext`, etc.)
- Completion that respects `<%@ page import="..." %>`
- Diagnostics for Java syntax errors inside scriptlets
- Optional: go-to-definition / hover / references for Java symbols used in scriptlets

## Non-goals (for Feature 2)

- Framework taglibs semantics (Struts/JSTL/custom tags) — Feature 3
- JSP runtime debugging and breakpoint mapping — Feature 4
- Perfect semantic modeling of all JSP edge cases (includes, custom tag codegen, container-specific behavior)

## Constraints & why this is hard

### JSP is not “just Java in a file”

JSP is compiled into a servlet. The Java code you type is embedded into generated methods/fields with:

- implicit objects and lifecycle methods
- container-specific imports and generated members
- declarations vs scriptlets mapping to different Java locations

### Java IntelliSense needs a project model

High-quality Java completion and diagnostics typically require:

- classpath resolution
- type inference
- incremental parsing/compilation

That’s beyond a simple regex tokenizer.

**The iceberg:** without a reliable classpath/project model (Maven/Gradle, multi-module, source roots, servlet/JSP API jars), anything beyond “keyword completion” will feel broken. Plan to solve project modeling early, or explicitly scope Feature 2 to syntax-only diagnostics.

## Implementation options

### Option A — Lightweight MVP: snippets + implicit-object completion only

**What you implement**

- Completion snippets for:
  - `<% $0 %>`
  - `<%= $0 %>`
  - `<%! $0 %>`
  - `<%@ page import="${1:...}" %>`
- Inside `<% ... %>` regions: completion items for implicit object names only
- Optional: a warning diagnostic like “Scriptlets detected (legacy)” (heuristic)

**Feasibility**: Medium (fast)

**Limitations**

- No Java member completions (`request.get...`) without real Java analysis
- Diagnostics are not Java-accurate

**Why this is still valuable**

It provides a “better than nothing” experience quickly and is a good stepping stone.

### Option B — Projection + delegation to the existing Java extension (prototype)

**Idea**

- Project JSP scriptlet content into a synthetic Java document.
- Attempt to delegate completion/hover/diagnostics to the user’s installed Java tooling.

There are two sub-variants:

1) **Virtual Java documents** (in-memory URIs)
   - Pros: no filesystem churn
   - Cons: Java extensions may not attach to non-`file:` schemes.

2) **On-disk generated Java stubs** in a hidden folder
   - Pros: more likely to be understood by existing Java tools
   - Cons: has workspace side-effects; must manage cleanup and avoid noisy file watchers.

**Feasibility**: Hard

**Main risk**

You may discover that the Java extension does not provide stable APIs to “just ask it” for scriptlet completions, or that it requires project metadata you can’t easily supply.

### Option C — A dedicated JSP language server with Java analysis (recommended long-term)

**Idea**

Build a JSP LSP server that:

1) Parses JSP and extracts Java regions (scriptlets/declarations/expressions)
2) Generates a synthetic Java compilation unit per JSP with accurate source mapping
3) Uses a Java analysis engine to provide completion/diagnostics/navigation

**Feasibility**: Very hard (product-scale)

**Recommended server language**

- **Java server**: easiest route to reuse Eclipse JDT for parsing/type resolution
- **Node server**: easier packaging, but harder to get “real Java IntelliSense”

## Recommended plan (phased)

### Phase 0 — Quick wins (Option A)

- Ship snippets for scriptlet tags and page directives
- Provide implicit-object completions inside scriptlet ranges

### Phase 1 — Syntax-only diagnostics (no classpath)

- Provide Java **syntax** diagnostics inside scriptlets (not type resolution)

Possible approaches:

- Run a Java parser (syntax-only) on extracted code
- Or implement a minimal Java grammar-based parser just to catch obvious syntax errors (not recommended long-term)

### Phase 2 — Full semantic Java integration (Option C)

- Provide member completions (`request.get...`) and type-aware diagnostics
- Respect imports from `<%@ page import="..." %>`
- Enable navigation/hover

## Core technical design (Option C)

### 1) Region extraction

Extract these region types with offsets in the original JSP document:

- `directive.page.import` — imports from `<%@ page import="..." %>`
- `scriptlet.statement` — `<% ... %>`
- `scriptlet.expression` — `<%= ... %>`
- `scriptlet.declaration` — `<%! ... %>`

Keep a stable data model:

- `startOffset`, `endOffset` (in JSP)
- `contentStartOffset` (start of inner Java)
- `kind`

### 2) Synthetic Java generation

Generate a Java source file $J$ from a JSP file $S$:

- A package (configurable; default something like `__jsp__`)
- A generated class name derived from the JSP path
- Imports:
  - default servlet imports
  - imports extracted from page directives
- A `service`-like method containing scriptlet statements/expressions
- Declarations become class members

**Implicit objects**

Inject common implicit objects with reasonable types (servlet API):

- `javax.servlet.http.HttpServletRequest request`
- `javax.servlet.http.HttpServletResponse response`
- `javax.servlet.http.HttpSession session`
- `javax.servlet.jsp.PageContext pageContext`
- `javax.servlet.ServletContext application`
- `javax.servlet.jsp.JspWriter out`
- `java.lang.Object page`
- `javax.servlet.jsp.JspWriter out` (and other standard ones you choose)

> Note: Jakarta vs javax namespace varies. You’ll likely need configuration for `jakarta.servlet.*` vs `javax.servlet.*`.

Treat this as a first-class requirement: the wrong namespace breaks type resolution immediately.

### 3) Source mapping

You must map positions between JSP and synthetic Java.

A practical mapping strategy:

- For each extracted region, record:
  - `jspInnerRange` (inner Java range in JSP)
  - `javaRange` (where that fragment appears in generated Java)
- When the Java analyzer returns diagnostics/completions at a Java position, convert back to JSP.

### 4) Completion routing

Only offer Java completions when the cursor is inside a scriptlet/declaration/expression region.

- For `<%= ... %>` (expression), you may need to wrap the fragment in a context like `out.print(<expr>);` in the synthetic file.

### 5) Project/classpath integration

This is the make-or-break element.

To resolve symbols, you need:

- servlet/JSP API jars
- the project’s dependencies (Maven/Gradle)
- source roots for navigation

Possible strategies:

- **Leverage existing Java tooling** (preferred if possible): discover classpath from the user’s Java extension/project model.
- **Self-managed build integration**: run Maven/Gradle tooling to compute classpaths (more invasive; can be slow).

### 6) Diagnostics lifecycle

- Debounce validation (e.g., 300–800ms)
- Cache per document version
- Publish diagnostics only for ranges that map back to JSP (ignore synthetic scaffolding errors)

## Acceptance criteria (Feature 2)

### MVP (Phase 0)

- Typing `<%` suggests scriptlet snippets
- Inside `<% ... %>`, completion suggests `request`, `response`, `session`, `pageContext`, `out`

### Syntax diagnostics (Phase 1)

- `for (` with missing `)` inside `<% ... %>` produces a diagnostic on the JSP line
- Diagnostics do not appear outside scriptlet regions

### Semantic IntelliSense (Phase 2)

- `request.` suggests known methods from the servlet API
- Imports in `<%@ page import="java.util.List" %>` allow completion of `List` in scriptlets
- Go-to-definition works for project classes referenced in scriptlets (when classpath is known)

## Testing strategy

- Unit tests:
  - region extraction correctness
  - synthetic Java generation snapshots
  - JSP↔Java source map conversions

- Integration tests:
  - completion is returned only within scriptlet ranges
  - diagnostics are published against JSP URIs

## Dependencies / packaging notes

If you choose Option C, expect to add:

- `vscode-languageclient` (client)
- `vscode-languageserver` / `vscode-languageserver-textdocument` (server)

If you choose a Java-based server:

- a build pipeline for the server (Gradle/Maven)
- server distribution bundling with the VS Code extension

## Milestone checklist

1. Phase 0: snippets + implicit-object completion
2. Phase 1: region extraction + syntax-only diagnostics
3. Phase 2: synthetic Java generation + semantic Java engine
4. Phase 2+: imports/jakarta-vs-javax configuration
5. Phase 2+: navigation/hover/references

---

## Open questions to answer early

- Do we target **Jakarta** (`jakarta.servlet.*`) or classic **Javax** (`javax.servlet.*`) projects, or both? If both, what is the auto-detection strategy and what’s the fallback?
- Should generated Java stubs be persisted on disk (better interoperability) or kept virtual (cleaner)?
- Do we require the user to install a Java extension, or bundle our own Java analysis engine?
