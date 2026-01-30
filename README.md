# JSP Language Support

This extension provides JSP support for VS Code:

- JSP syntax highlighting (TextMate grammar)
- HTML language features inside `.jsp` (completion + hover)
- CSS language features inside `<style>...</style>` and inline `style="..."` attributes (completion + hover + diagnostics)
- Taglib support (custom/framework JSP tags) when a matching `.tld` exists in the workspace:
    - tag/attribute completions, hover docs, and warning diagnostics

It does **not** (yet) implement JavaScript language features inside `<script>` blocks, nor Java IntelliSense for JSP scriptlets.

Note that not all JSP patterns are handled. Contributions are welcome. Please open a pull request.

![Example image](./assets/example.png)

To enable [emmet abbreviations](https://code.visualstudio.com/docs/editor/emmet#_emmet-abbreviations-in-other-file-types) for JSP files (for example, to expand `h1` to `<h1></h1>`), add the following configuration to your settings:

```json
"emmet.includeLanguages": {
    "jsp": "html"
}
```

## Development

1) Install dependencies

2) Build

3) Run the extension

- Open this repository in VS Code
- Press `F5` to launch the Extension Development Host
- Open `samples/feature01.jsp` and try:
    - typing `<di` and triggering completion (should suggest `<div>`)
    - typing `displ` inside the `<style>` block (should complete to `display`)
    - typing `col` inside `style="..."` (should complete `color`)

- Open `samples/feature03-tests/` and try:
    - `taglibs-tagname-completion.jsp` (type `<demo:`)
    - `taglibs-attribute-completion.jsp` (complete attributes inside `<demo:form ...>`)
    - `taglibs-hover-docs.jsp` (hover tag/attribute names)
