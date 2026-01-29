<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ taglib prefix="missing" uri="http://example.com/tld/does-not-exist" %>

<!doctype html>
<html>
  <head>
    <title>Feature 03 - Diagnostics (imported URI missing from workspace)</title>
  </head>
  <body>
    <!-- What to test:
         - The prefix `missing` IS declared via <%@ taglib %>
         - But the workspace has no .tld for that URI
         - Using a tag should show a warning about the missing .tld resolution
    -->

    <missing:someTag foo="bar" />
  </body>
</html>
