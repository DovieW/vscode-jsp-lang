<%@ page contentType="text/html;charset=UTF-8" language="java" %>

<!doctype html>
<html>
  <head>
    <title>Feature 04 - Debugger integration (stack frame rewrite)</title>
  </head>
  <body>
    <!--
      What to test (Milestone 1):

      1) Run this JSP in Tomcat with JSP compilation enabled.
      2) Attach VS Code Java debugger to the JVM.
      3) When execution stops inside generated servlet code (e.g. org.apache.jsp.index_jsp),
         the extension should rewrite stack frames so VS Code shows THIS .jsp file + line.

      Tip:
      - Put a breakpoint on the line with "int x =" below (scriptlet) and step.
    -->

    <h1>Debugger test page</h1>

    <%
      int x = 1; // Put a breakpoint here
      int y = x + 41;
      out.write("Answer=" + y);
    %>

  </body>
</html>
