<%@ page contentType='text/html;charset=UTF-8' language='java' %>

<!-- Same taglib, but using single quotes + extra whitespace to test directive parsing: -->
<%@   taglib   prefix = 'demo'   uri = 'http://example.com/tld/demo'   %>

<!doctype html>
<html>
  <body>
    <demo:if test="${1 == 1}">
      OK
    </demo:if>
  </body>
</html>
