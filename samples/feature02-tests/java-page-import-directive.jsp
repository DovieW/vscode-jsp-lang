<%--
Feature 02: `<%@ page import="..." %>` extraction (for future semantic Java integration)

Try this:
- This file includes an import directive and references the imported types in a scriptlet.
- Expected (current MVP): no type-aware completion yet, but scriptlet regions should still be detected correctly.
--%>

<%@ page import="java.util.List, java.time.Instant" %>

<html>
  <body>
    <%
      List<String> xs = java.util.Arrays.asList("a", "b");
      Instant now = Instant.now();
      out.println(xs.size());
      out.println(now);
    %>
  </body>
</html>
