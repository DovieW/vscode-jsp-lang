<%--
Feature 02: Java in scriptlets (completion)

Try this:
- Put your cursor after `re` inside the scriptlet and trigger completion.
- Expected (MVP): `request`, `response`, `session`, `pageContext`, `out`, ...
- Expected: completions ONLY inside the scriptlet body (not in surrounding HTML).
--%>

<html>
  <body>
    <h1>Feature 02: implicit objects</h1>

    <%
      re
    %>

    <div class="after">Outside scriptlet: HTML completions only</div>
  </body>
</html>
