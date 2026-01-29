<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ taglib prefix="demo" uri="http://example.com/tld/demo" %>
<%@ taglib prefix="ui" uri="http://example.com/tld/ui" %>

<!doctype html>
<html>
  <head>
    <title>Feature 03 - Multiple taglibs</title>
  </head>
  <body>
    <!-- What to test:
         - `<demo:` suggests tags from demo.tld
         - `<ui:` suggests tags from ui.tld (panel)
         - attribute completion works per-taglib
         - boolean value completion works for ui:panel collapsible=""
    -->

    <demo:form action="/submit" method="post">
      <ui:panel title="Settings" collapsible="">
        <demo:input name="username" type="text" />
      </ui:panel>
    </demo:form>
  </body>
</html>
