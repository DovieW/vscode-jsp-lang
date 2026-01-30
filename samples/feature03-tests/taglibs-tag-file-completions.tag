<%@ tag language="java" pageEncoding="UTF-8" body-content="scriptless" %>
<%@ taglib prefix="demo" uri="http://example.com/tld/demo" %>

<%--
  Feature 03: Taglibs in .tag files

  What to test:
  - Type `<demo:` below and confirm tag name completion suggests: form, input, if
  - Inside `<demo:form ...>` confirm attribute completion suggests: action, method, id, class
  - Inside `disabled=""` confirm value completion suggests: true / false
--%>

<demo:form action="/submit" method="post">
  <demo:input name="username" disabled="" />
</demo:form>
