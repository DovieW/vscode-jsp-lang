<%--
Feature 02: Scriptlet blocks split around HTML

Try this:
- Ensure completions work inside BOTH scriptlet blocks.
- Ensure HTML completion/hover still works in the HTML between them.
--%>

<html>
  <body>
    <%
      if (true) {
    %>
      <span>OK</span>
    <%
      }
      // Completion here should suggest implicit objects
      ses
    %>
  </body>
</html>
