# Feature 03 tests — Taglibs / custom JSP tags

These files are meant to manually test **taglib intelligence**:

- tag name completion after typing `<demo:`
- attribute completion inside a start tag like `<demo:form `
- warnings for unknown prefixes/tags/attributes

## Workspace layout

- `WEB-INF/tlds/demo.tld` defines a taglib with URI `http://example.com/tld/demo`.
- The JSP files import it via `<%@ taglib prefix="demo" uri="http://example.com/tld/demo" %>`.

## What to try

1) Open `taglibs-tagname-completion.jsp`
   - Type `<demo:` and verify tag name completion suggests `form`, `input`, `if`.

2) Open `taglibs-attribute-completion.jsp`
   - Inside `<demo:form ...>` type a space and verify attribute completion suggests `action`, `method`, `id`, `class`.
   - Inside `<demo:input ...>` verify attribute completion suggests `name`, `value`, `type`, `disabled`.

3) Open `taglibs-diagnostics-unknown.jsp`
   - Verify diagnostics warn about:
     - unknown prefix `<oops:...>`
     - unknown tag `<demo:notATag>`
     - unknown attribute `wat="..."` on `<demo:form>`

4) Open `taglibs-hover-docs.jsp`
   - Hover over `demo:form` and verify you see the tag description from the TLD.
   - Hover over `action`/`method` and verify you see attribute info.

5) Open `taglibs-boolean-attr-value-completion.jsp`
   - Put the cursor inside `test=""` or `disabled=""` and trigger completion.
   - Verify it suggests `true` / `false`.

6) Open `taglibs-diagnostics-missing-tld.jsp`
   - Verify you get a warning that the URI is imported but no matching `.tld` exists in the workspace.
