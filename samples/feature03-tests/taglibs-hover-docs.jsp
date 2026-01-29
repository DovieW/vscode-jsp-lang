<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ taglib prefix="demo" uri="http://example.com/tld/demo" %>

<!doctype html>
<html>
  <head>
    <title>Feature 03 - Hover docs (taglibs)</title>
  </head>
  <body>
    <!-- What to test:
         - Hover over the tag name `demo:form` to see the tag description from the TLD.
         - Hover over attributes like `action` and `method` to see type/required/description.
    -->

    <demo:form action="/submit" method="post" id="myForm" class="fancy">
      <demo:input name="username" type="text" />
    </demo:form>
  </body>
</html>
