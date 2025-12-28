<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<!--
Test: HTML attribute completion inside .jsp

Try:
- In `<a >`, type `hr` and trigger completion (expect `href`).
- In `<img >`, type `sr` and trigger completion (expect `src`).
-->
<html>
  <body>
    <a hr="/path">link</a>
    <img sr="/img.png" alt="x" />
  </body>
</html>
