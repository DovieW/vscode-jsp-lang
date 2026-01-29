<%--
Feature 02: Declaration vs scriptlet vs expression

Try this:
- Trigger completion inside each region (declaration, statement scriptlet, expression).
- Expected: implicit object completions inside statement/expression; declarations are also treated as Java regions.
--%>

<%!
  private int counter = 0;
%>

<html>
  <body>
    <%
      counter++;
      // Try completion here: `pageContext`, `request`, etc.
      pag
    %>

    <div>Counter: <%= counter %></div>
  </body>
</html>
