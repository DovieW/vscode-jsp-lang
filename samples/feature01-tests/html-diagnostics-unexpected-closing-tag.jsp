<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<!--
Test: HTML diagnostics (conservative)

Expectation:
- Should report an error for an unexpected/mismatched closing tag.
-->
<html>
  <body>
    <div>
      <span>Oops</div>
    </span>
  </body>
</html>
