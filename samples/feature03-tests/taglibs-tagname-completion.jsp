<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ taglib prefix="demo" uri="http://example.com/tld/demo" %>

<!doctype html>
<html>
  <head>
    <title>Feature 03 - Tag name completion</title>
  </head>
  <body>
    <!-- To test tag name completion:
         1) Delete the tag name (e.g. "form")
         2) Type `<demo:` and trigger completion
    -->
    <demo:form></demo:form>

    <!-- Also try partial typing (delete "input", then type `<demo:i`): -->
    <demo:input />
  </body>
</html>
