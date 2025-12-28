<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%--
Test: JSP masking/projection does not break HTML/CSS language features.

Try:
- Trigger HTML completion near `<di`.
- Trigger CSS completion inside <style> and inline style="...".
- Verify diagnostics do not go wild because of JSP constructs.

Notes:
- Java/scriptlet content is NOT semantically validated by Feature 01.
--%>
<html>
  <head>
    <%-- JSP comment between tags should be masked safely --%>
    <style>
      .box {
        displ
      }
    </style>
  </head>
  <body>
    <di class="box" style="col">
      Hello ${user.name}
      <%= request.getParameter("x") %>
      <% if (true) { %>
        <span>inside scriptlet-controlled region</span>
      <% } %>
    </div>
  </body>
</html>
