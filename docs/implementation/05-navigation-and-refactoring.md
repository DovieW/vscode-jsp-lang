# Feature 5 — Code navigation & refactoring (definitions, references, rename)

This document describes how to implement IDE-like navigation/refactoring features for JSP projects:

- Go to Definition / Peek Definition
- Find All References
- Rename Symbol
- Document Symbols (outline)

## Scope

### In-scope symbol kinds

1) **Taglib-related** (Feature 3 foundation)

- `<%@ taglib prefix="x" uri="..." %>` directives
- Tag usages: `<x:tagName ...>`
- Attribute names on tags

2) **Java-in-scriptlets** (Feature 2 foundation)

- Java identifiers inside `<% %>`, `<%= %>`, `<%! %>`
- Imported Java types from `<%@ page import="..." %>`

3) **JSP-level symbols (lightweight)**

- Common directives (`page`, `include`, `taglib`) as navigable items
- Optionally, include targets for `<%@ include file="..." %>` or `<jsp:include ...>` (mostly path navigation)

### Out of scope (for Feature 5 itself)

- Debugger stepping/breakpoint mapping (Feature 4)
- Full semantic understanding of custom frameworks beyond TLD-defined tags

## Prerequisites

- Feature 3 (taglib indexing) for tag/attribute navigation
- Feature 2 (Java extraction + semantic model) for Java navigation/rename

Without those, Feature 5 can only provide shallow navigation (e.g., file includes).

## Implementation choices

### Choice A — Implement via LSP capabilities (recommended)

If you already have a JSP language server, implement:

- `textDocument/definition`
- `textDocument/references`
- `textDocument/rename`
- `textDocument/documentSymbol`

This keeps all cross-file analysis in one place and is much easier to test.

### Choice B — Implement via VS Code providers in the extension host

Possible using:

- `languages.registerDefinitionProvider`
- `languages.registerReferenceProvider`
- `languages.registerRenameProvider`
- `languages.registerDocumentSymbolProvider`

This is workable for taglibs and simple path-navigation but becomes painful once you need a project index.

## Symbol model & resolution

### 1) Taglib symbols (from TLD)

**Definitions**

- Tag definition location = where it’s defined in the `.tld` file.
  - For jar-provided TLDs, definition location can be virtual (read-only) unless you extract the file.

**References**

- Find all usages of `<prefix:tagName>` across `.jsp` / `.tag` / `.jspf` files.
  - Requires scanning/parsing JSP documents (or at least a tolerant tag tokenization).

**Rename**

- Renaming tag names globally is usually a bad idea unless you control the taglib.
- Practical renames:
  - rename a **prefix** in a single file (and update all tag usages in that file)
  - rename attribute occurrences in a file (only if attribute is known and safe)

Recommendation:

- Start with safe, local renames (prefix only), and avoid cross-project tag renames.

### 2) Java symbols in scriptlets

This depends on Feature 2’s synthetic Java + source maps.

**Definition/References**

- When cursor is on a Java identifier in a scriptlet region:
  1. Map JSP position → synthetic Java position
  2. Ask Java semantic engine for definition/references
  3. Map result locations back to JSP (when they point into synthetic regions)

**Rename**

- Rename is only safe if your Java semantic engine returns a valid workspace edit.
- You must remap edits that touch synthetic JSP-derived code back into JSP edits.

Important limitation:

- If the Java engine returns edits in generated scaffolding (not mappable), those edits must be discarded or transformed.

### 3) Include navigation

Implement “go to definition” for include targets:

- `<%@ include file="/path/to.jspf" %>`
- `<jsp:include page="..." />` (best effort)

This is mostly file path resolution.

## Feature behavior

### Go to Definition

- On `<prefix:tag>` → jump to the tag entry in the resolved TLD
- On tag attribute name → jump to attribute definition in TLD
- On include file path → open the target file
- On Java identifier in scriptlet → jump to Java definition (requires Feature 2)

### Find All References

- On `<prefix:tag>` → find all usages in workspace
- On prefix declared in `<%@ taglib %>` → find all tag usages using that prefix in the file
- On Java identifier in scriptlet → project-wide Java references (requires Feature 2)

### Rename

Start with the safest refactors:

1) Rename taglib prefix (file-scoped)
- Rename `prefix="c"` to `prefix="core"` and update `<c:...>` to `<core:...>` in that file.

2) Rename include target (string edit)
- Only if you can resolve and validate paths.

Defer / caution:

- Renaming tag names or attributes across the project (too risky)
- Renaming Java symbols unless Feature 2 provides a reliable edit mapping

### Document Symbols (outline)

Provide a useful outline for JSP:

- Taglib directives (prefixes)
- Include directives
- Optionally: top-level custom tags usage blocks as symbols

## Milestones

### Milestone 1 — File-local taglib navigation

- Definition: tag name/attribute → TLD definition
- Rename: taglib prefix in a single file
- Document symbols for directives

### Milestone 2 — Workspace references for tags

- Find all references of a tag across JSP files (tokenizer-based)

### Milestone 3 — Java navigation (depends on Feature 2)

- Definition/references inside scriptlets
- Optional rename if mapping is robust

## Acceptance criteria

### Must-have (Milestone 1)

- Ctrl+Click on `<c:forEach>` opens the correct `.tld` definition (when available)
- Rename on `prefix="c"` updates all `<c:` occurrences in the same file
- Outline shows taglib directives and include directives

### Nice-to-have (Milestone 2)

- Find All References on a tag returns workspace usages

### Advanced (Milestone 3)

- Ctrl+Click on `request` inside `<% ... %>` navigates to the servlet API symbol (or shows correct type info)

## Testing strategy

- Unit tests:
  - prefix rename edit generation
  - TLD location mapping
  - tag usage tokenizer correctness

- Integration tests:
  - definition provider returns correct locations
  - rename provider produces a correct `WorkspaceEdit`

## Risks

- Jar-based TLDs complicate “definition locations” unless you provide a readable virtual document.
- Rename is dangerous without a real parser; keep renames conservative.
- Java rename/navigation is only as good as the classpath/project model (Feature 2).

---

## Current status in this repo (Milestones 1–2 ✅ for taglibs; Java navigation ❌)

We currently ship an MVP implementation of **Feature 05 for taglibs** via the bundled language server:

- **Go to Definition** on `<prefix:tag>` and known tag attribute names jumps into the backing `.tld` file (best-effort location mapping).
- **Go to Definition** on include targets works (best-effort) for `<%@ include file="..." %>` and `<jsp:include page="..." />` when the target file can be resolved in the workspace.
- **Find All References** on `<prefix:tag>` scans the workspace for usages in `.jsp/.jspf/.tag` files.
- **Find All References** on a taglib directive prefix value (e.g. `prefix="c"`) returns file-local usages of `<c:...>` / `</c:...>` in that same document.
- **Rename** supports safe, file-local **taglib prefix rename** (updates the `<%@ taglib prefix=... %>` directive and `<prefix:...>` usages in that file).
- **Document Symbols** (outline) lists common directives (`page`, `include`, `taglib`).

What’s still out of scope / not implemented:

- Java-aware definition/references/rename for identifiers inside scriptlets (Feature 2 prerequisite)
- Cross-project rename of tag names or attributes (intentionally avoided)
