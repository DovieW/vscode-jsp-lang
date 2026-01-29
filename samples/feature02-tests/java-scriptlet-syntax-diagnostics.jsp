<%--
Feature 02 (planned): Java syntax diagnostics inside scriptlets

This file is a placeholder for Phase 1.

Try this (once diagnostics are implemented):
- Confirm the syntax error is reported ONLY on the Java fragment inside `<% ... %>`.
- Confirm no diagnostics appear on surrounding HTML.
--%>

<html>
  <body>
    <%
      // Missing ')' before '{'
      for (int i = 0; i < 10; i++ {
        out.println(i);
      }
    %>

    <p>More HTML here.</p>
  </body>
</html>
