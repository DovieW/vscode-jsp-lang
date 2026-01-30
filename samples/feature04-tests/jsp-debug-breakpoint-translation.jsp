<%@ page contentType="text/html;charset=UTF-8" language="java" %>

<!doctype html>
<html>
  <head>
    <title>Feature 04 - Debugger integration (breakpoint translation)</title>
  </head>
  <body>
    <!--
      What to test (Milestone 2):

      Goal: Set a breakpoint in THIS .jsp, but have it bind/hit by translating it to
      the Tomcat/Jasper generated servlet .java source.

      Setup notes:
      - You usually need to configure the Tomcat work directory:
          jsp.debug.tomcat.workDir
        (Example paths often look like: $CATALINA_BASE/work)

      Steps:
      1) Run Tomcat and load this JSP once so it gets compiled.
      2) Attach the VS Code Java debugger to the JVM.
      3) Set a breakpoint on the "int translated =" line below.
      4) Refresh the page.

      Expected:
      - The breakpoint should become verified and be hit.
      - In the call stack, the frame/source should show THIS .jsp file and line.

      If it doesn't work:
      - Turn on verbose logging:
          jsp.debug.breakpointTranslation.verbose
          jsp.debug.stackFrameRewrite.verbose
      - Make sure the generated *_jsp.java files exist under the work directory.
    -->

    <h1>Breakpoint translation test page</h1>

    <%@ include file="/WEB-INF/jspf/header.jspf" %>

    <%
      int translated = 123; // Put a breakpoint here
      out.write("translated=" + translated);
    %>

  </body>
</html>
