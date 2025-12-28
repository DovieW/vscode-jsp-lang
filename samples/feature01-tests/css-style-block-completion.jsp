<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<!--
Test: CSS completion in <style> blocks inside .jsp

Try:
- Inside `.box { ... }`, type `displ` and trigger completion (expect `display`).
- Try completing values after `display:` (e.g. `fl` -> `flex`).
-->
<html>
  <head>
    <style>
      .box {
        display: ;
      }
    </style>
  </head>
  <body>
    <div class="box">CSS block completion target</div>
  </body>
</html>
