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
