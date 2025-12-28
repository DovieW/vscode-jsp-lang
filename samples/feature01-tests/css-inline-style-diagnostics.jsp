<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<!--
Test: CSS diagnostics in inline style="..." attributes inside .jsp

Expectation:
- Should show CSS diagnostics for obvious syntax issues in the inline style.
- Diagnostics should map to the correct range in this JSP file.
-->
<html>
  <body>
    <div style="color:: red; width: 10px">Inline style diagnostics target</div>
  </body>
</html>
