# Feature 02 test files (Java in JSP scriptlets)

Open these files in the Extension Development Host (F5) to manually smoke-test:

- **JSP scriptlet completion** inside:
  - `<% ... %>` (statement)
  - `<%= ... %>` (expression)
  - `<%! ... %>` (declaration)

What’s implemented in the current MVP:

- Completion items for common **JSP implicit objects** (e.g. `request`, `response`, `session`, `pageContext`, `out`)
- Snippet completions for starting scriptlets/directives when you type `<%` and trigger completion

Notes:

- Java member completion (e.g. `request.get...`) is **not** implemented yet.
- Java diagnostics are planned for a later phase; one file is included as a placeholder.

## Suggested quick checks

1. Open `java-scriptlet-implicit-object-completion.jsp` and type `req` inside `<% ... %>`.
2. Open `java-expression-scriptlet.jsp` and trigger completion after `request.` inside `<%= ... %>`.
3. Open `java-declaration-vs-scriptlet.jsp` and confirm completion works in all three scriptlet kinds.
4. Open `java-page-import-directive.jsp` (imports are extracted for future semantic work).
