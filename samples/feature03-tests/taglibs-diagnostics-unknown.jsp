<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ taglib prefix="demo" uri="http://example.com/tld/demo" %>

<!doctype html>
<html>
  <head>
    <title>Feature 03 - Diagnostics</title>
  </head>
  <body>
    <!-- Unknown prefix (should warn): -->
    <oops:thing />

    <!-- Unknown tag for a known prefix (should warn): -->
    <demo:notATag />

    <!-- Unknown attribute for a known tag (should warn on 'wat'): -->
    <demo:form action="/submit" wat="nope" />
  </body>
</html>
