# Feature 01 test files (HTML + CSS inside JSP)

Open these files in the Extension Development Host (F5) to manually smoke-test:

- **HTML completion + hover** anywhere in `.jsp`
- **CSS completion + hover + diagnostics** inside:
  - `<style> ... </style>` blocks
  - inline `style="..."` attributes

Notes:

- HTML diagnostics are intentionally conservative.
- Java/scriptlet IntelliSense is out of scope for Feature 01.

## Suggested quick checks

1. Open `html-completion-tags.jsp` and type `<di` then trigger completion.
2. Open `css-style-block-completion.jsp` and type `displ` in the CSS block.
3. Open `css-inline-style-completion.jsp` and type `col` inside `style="..."`.
4. Open `css-*-diagnostics.jsp` files and confirm diagnostics appear only on CSS ranges.
5. Open `jsp-masking-smoke.jsp` and confirm HTML/CSS features still work around JSP constructs.
