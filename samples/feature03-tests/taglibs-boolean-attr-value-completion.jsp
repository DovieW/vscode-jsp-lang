<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ taglib prefix="demo" uri="http://example.com/tld/demo" %>

<!doctype html>
<html>
  <head>
    <title>Feature 03 - Attribute value completion (boolean)</title>
  </head>
  <body>
    <!-- What to test:
         1) Put your cursor inside the quotes and trigger completion.
         2) You should get `true` / `false`.

         Examples below:
         - demo:if has boolean `test`
         - demo:input has boolean `disabled`
    -->

    <demo:if test="">
      OK
    </demo:if>

    <demo:input name="a" disabled="" />
  </body>
</html>
