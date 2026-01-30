# What this extension supports (and what it doesn’t)

This extension provides:

- a **TextMate grammar** for JSP highlighting
- a small **language server** for embedded web-language IntelliSense in `.jsp` files

## ✅ Supported

### File recognition

Files are treated as JSP when they use one of these extensions:

- `.jsp`
- `.jspf`
- `.tag`

Language id: `jsp` (display name: “JSP Language Support”).

### Syntax highlighting (TextMate)

The grammar scope is `text.html.jsp` and builds on VS Code’s HTML grammar (`text.html.derivative`). In practice that means you get HTML highlighting plus JSP-specific constructs.

Because the HTML grammar is included, you also typically get **basic syntax highlighting for embedded CSS and JavaScript** inside `<style>` / `<script>` blocks the same way you would in HTML.

### IntelliSense + diagnostics (language server)

When editing `.jsp` files, the extension provides:

- HTML completion + hover
- CSS completion + hover inside:
  - `<style> ... </style>` blocks
  - inline `style="..."` attributes
- CSS diagnostics (syntax/validation) for those CSS regions
- Taglib support for custom/framework JSP tags when a matching `.tld` exists in the workspace:
  - tag name completion after typing `<prefix:` (where `prefix` is imported via `<%@ taglib %>`)
  - attribute name completion for known tags
  - boolean attribute value completion (`true` / `false`) when the TLD declares a boolean type
  - hover docs for tag/attribute descriptions (from the TLD)
  - warning diagnostics for unknown prefixes/tags/attributes
- Taglib-aware navigation & refactoring (Feature 05, MVP):
  - Go to Definition for `<prefix:tag>` and tag attributes (jumps into the backing `.tld` file when available)
  - Find All References for `<prefix:tag>` (workspace scan of `.jsp/.jspf/.tag`)
  - Rename taglib **prefix** within a single file (updates the `<%@ taglib prefix=... %>` directive and `<prefix:...>` usages)
  - Document Symbols (outline) for common directives (`page`, `include`, `taglib`)
- JSP scriptlet/directive **MVP completions**:
  - implicit object identifier completion inside `<% ... %>`, `<%= ... %>`, `<%! ... %>`
  - snippet completions when starting `<%` / `<%=` / `<%!` / `<%@`

Notes:

- HTML diagnostics are intentionally conservative to avoid false positives caused by JSP constructs.
- CSS features work by extracting CSS regions from a same-length HTML projection of the JSP file.
- Taglib discovery is configurable via `jsp.taglibs.tldGlobs` (defaults to scanning `**/*.tld`).
- Optional: taglibs from dependency jars can be picked up via `jsp.taglibs.enableJarScanning` + `jsp.taglibs.jarGlobs` (best-effort jar glob scanning).

### Debugging integration (experimental)

When debugging Java (for example when attaching to a Tomcat JVM), the extension provides **best-effort** JSP debugging help:

- rewrite Java stack frames that point at Tomcat/Jasper generated `*_jsp.java` sources back to `.jsp/.jspf/.tag` files
- translate breakpoints set in `.jsp/.jspf/.tag` files into breakpoints in the generated servlet `.java` sources (when mapping markers are available)

This is intentionally Tomcat/Jasper-focused and depends on generated servlet sources being accessible.

Highlighted JSP constructs include:

- **JSP comments**
  - `<%-- comment --%>`
- **JSP directives**
  - `<%@ page ... %>`, `<%@ taglib ... %>`, etc.
  - Directive keywords that are explicitly tokenized: `attribute`, `include`, `page`, `tag`, `taglib`, `variable`
- **Scriptlets (embedded Java)**
  - `<% ... %>`
  - `<%= ... %>`
  - `<%! ... %>`
  - Scriptlet bodies are marked as `meta.embedded.block.java` and mapped to VS Code’s `java` language for tokenization.
- **Template/EL-style expressions (embedded Java tokenization)**
  - `${ ... }`
  - `#{ ... }`

### Where JSP constructs are recognized

- Scriptlets are allowed “almost anywhere” in JSP/HTML (with some exclusions to avoid bad nesting).
- `${...}` / `#{...}` expressions are also recognized inside **quoted HTML attribute values**.

### Editor behavior (language configuration)

The `language-configuration.json` contributes:

- **Block comment toggling** for JSP comments: `<%--` … `--%>`
- **Bracket / auto-closing / surrounding pairs** for:
  - `{}` `[]` `()`
  - `""` `''`

### Emmet (via user configuration)

Emmet isn’t enabled automatically, but you can opt-in by mapping `jsp` to `html`:

```json
"emmet.includeLanguages": {
  "jsp": "html"
}
```

## ❌ Not supported

This extension does **not** currently provide a full JSP language server.

In particular, it does not include:

- JavaScript IntelliSense/diagnostics for `<script>` blocks (planned)
- Full Java IntelliSense/diagnostics for JSP scriptlets (`<% ... %>`) (planned)
- Java-aware go to definition / references / rename for code inside scriptlets (this requires Feature 2’s Java semantic model)
- Formatting or code actions
- A full snippet pack (the only snippets currently provided are small scriptlet/directive starters via completion)
- Refactoring tools beyond the safe, file-local taglib prefix rename
- A full DAP proxy adapter for JSP debugging (current implementation is tracker-based and best-effort)

### Confirming the “Requirements” list you received

Most of the items in that list require a language server (or multiple language servers) plus project-aware Java/JSP parsing. This extension does not attempt that.

Specifically, the following are **still missing**:

- **JavaScript IntelliSense and diagnostics inside JSP** (`<script>` blocks)
- **JSP smart completions** for scriptlets/directives/expressions
  - No Java member/type completions (e.g. `request.get...`)
  - No import-aware type completion from `<%@ page import="..." %>`
- **Java-aware navigation/analysis** from scriptlets
  - No go-to-definition into Java sources for `<%= bean.method() %>`
  - No warnings for invalid Java syntax or “bad practice” scriptlets
- **Framework tag libraries (Struts/JSTL/custom tags) from dependencies**
  - No project classpath integration; jar scanning is glob-based (enable `jsp.taglibs.enableJarScanning`)
  - No container-provided URI-to-TLD mappings
  - No bean/property inference for attribute values
- **Java debugging integration for JSP**
  - No breakpoints/step-through/variable inspection support specifically tied to JSP/scriptlets/tags
- **Profiling, migration tooling, project configuration, or AI-tool integration features**
  - None of these are contributed by this extension.

## Known limitations / expectations

- The grammar is best-effort and does **not** cover every JSP pattern or edge case.
- `${...}` / `#{...}` bodies are tokenized using the Java grammar (`source.java`). That improves coloring consistency, but JSP EL is not identical to Java—some constructs may be highlighted imperfectly.
- Custom tag libraries (JSTL/custom tags) are generally treated as HTML-like tags; semantic understanding (e.g., validating attributes) is out of scope.

  Note: This extension *does* provide basic tag/attribute awareness when the taglib is backed by a `.tld` file in the workspace. It does not do deep semantic analysis of attribute values.

If you need IDE-like features, the usual approach is combining this extension (for JSP-specific highlighting) with separate Java and web tooling; however, whether those tools activate for the `jsp` language id depends on the specific extension.

## Quick scope statement

If you’re looking for “JSP looks readable in VS Code”, this extension aims to deliver.
If you’re looking for “JSP behaves like a fully-featured IDE language”, you’ll want a separate Java/JSP language server or additional tooling.
