<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<!--
Test: CSS completion in inline style="..." attributes inside .jsp

Try:
- In style="col", trigger completion (expect `color`).
- After inserting `color: `, trigger completion for values (e.g. `re` -> `red`).
-->
<html>
  <body>
    <div style="col">Inline style completion target</div>
  </body>
</html>
