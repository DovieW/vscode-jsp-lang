# Feature 04 tests — Debugger integration

These files are **manual fixtures** to help validate Feature 04 (debugger integration).

## `jsp-debug-stackframe-rewrite.jsp`

What to test:

- Start a Tomcat-based webapp that serves this JSP.
- Attach VS Code Java debugger to the JVM.
- When execution stops in the generated servlet code, the stack frames should resolve back to the JSP source (this file) if mapping is available.

## `jsp-debug-breakpoint-translation.jsp`

What to test:

- Configure `jsp.debug.tomcat.workDir` so the extension can find Tomcat/Jasper generated servlet sources.
- Attach VS Code Java debugger to the JVM.
- Set a breakpoint in the JSP (scriptlet line) and confirm:
	- it becomes verified (best-effort)
	- when hit, the call stack shows the JSP source location (not the generated `.java`)

## `test/fixtures/tomcat-generated/index_jsp.java`

This is a **unit-test fixture** used by the Tomcat/Jasper mapping parser tests.

It intentionally contains a few different comment marker formats that our parser should support.
