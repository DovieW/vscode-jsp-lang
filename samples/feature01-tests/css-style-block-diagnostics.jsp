<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<!--
Test: CSS diagnostics in <style> blocks inside .jsp

Expectation:
- Should show CSS diagnostics for obvious syntax issues in the CSS block.
-->
<html>
  <head>
    <style>
      .bad {
        color:: red;
        width: 10px
      }
    </style>
  </head>
  <body>
    <div class="bad">CSS block diagnostics target</div>
  </body>
</html>
