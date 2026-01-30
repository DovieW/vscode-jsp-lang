import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// This import is resolved via vitest alias to test/mock/vscode.ts
import * as vscode from 'vscode';

import { registerJavaBreakpointTranslator } from '../src/debug/javaBreakpointTranslator';

const FIXTURE_WORKSPACE_ROOT = path.join(__dirname, 'fixtures', 'workspaces', 'feature04');
const FIXTURE_GENERATED_JAVA_DIR = path.join(__dirname, 'fixtures', 'tomcat-generated');
const FIXTURE_GENERATED_JAVA = path.join(FIXTURE_GENERATED_JAVA_DIR, 'index_jsp.java');
const FIXTURE_INDEX_JSP = path.join(FIXTURE_WORKSPACE_ROOT, 'webapp', 'index.jsp');

function makeOutput() {
  return {
    appendLine: vi.fn(),
  } as unknown as vscode.OutputChannel;
}

function makeContext() {
  return {
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function writeFileWithMtime(filePath: string, content: string, mtime: Date): void {
  fs.writeFileSync(filePath, content, 'utf8');
  fs.utimesSync(filePath, mtime, mtime);
}

describe('javaBreakpointTranslator (Feature 04 Milestone 2)', () => {
  beforeEach(() => {
    (vscode as any).__resetMocks?.();

    expect(fs.existsSync(FIXTURE_WORKSPACE_ROOT)).toBe(true);
    expect(fs.existsSync(FIXTURE_GENERATED_JAVA)).toBe(true);
    expect(fs.existsSync(FIXTURE_INDEX_JSP)).toBe(true);

    (vscode as any).__setMockWorkspaceFolders?.([{ uri: { fsPath: FIXTURE_WORKSPACE_ROOT } }]);
    (vscode as any).__setMockConfigValue?.('debug.breakpointTranslation.enabled', true);
    (vscode as any).__setMockConfigValue?.('debug.tomcat.workDir', FIXTURE_GENERATED_JAVA_DIR);
  });

  test('rewrites setBreakpoints request for .jsp to generated *_jsp.java (JSP -> Java)', () => {
    const output = makeOutput();
    const context = makeContext();

    registerJavaBreakpointTranslator(context, output);

    const factory = (vscode as any).__getLastDebugAdapterTrackerFactory?.();
    expect(factory).toBeTruthy();

    const tracker = factory.createDebugAdapterTracker({ name: 'test-session' });
    expect(typeof tracker.onWillReceiveMessage).toBe('function');

    const request: any = {
      type: 'request',
      seq: 101,
      command: 'setBreakpoints',
      arguments: {
        source: { path: FIXTURE_INDEX_JSP },
        breakpoints: [{ line: 3 }],
      },
    };

    tracker.onWillReceiveMessage(request);

    // Our fixture has marker for jspLine 3 at javaLine 14, so we target line 15.
    expect(request.arguments.source.path).toBe(FIXTURE_GENERATED_JAVA);
    expect(request.arguments.breakpoints[0].line).toBe(15);
  });

  test('rewrites setBreakpoints response back to .jsp (Java -> JSP)', () => {
    const output = makeOutput();
    const context = makeContext();

    registerJavaBreakpointTranslator(context, output);

    const factory = (vscode as any).__getLastDebugAdapterTrackerFactory?.();
    const tracker = factory.createDebugAdapterTracker({ name: 'test-session' });

    // First: outgoing request is rewritten and stored as pending.
    const request: any = {
      type: 'request',
      seq: 201,
      command: 'setBreakpoints',
      arguments: {
        source: { path: FIXTURE_INDEX_JSP },
        breakpoints: [{ line: 3 }],
      },
    };
    tracker.onWillReceiveMessage(request);

    // Then: adapter response comes back for the rewritten request.
    const response: any = {
      type: 'response',
      request_seq: 201,
      command: 'setBreakpoints',
      success: true,
      body: {
        breakpoints: [
          {
            verified: true,
            line: 15,
            source: { path: FIXTURE_GENERATED_JAVA },
          },
        ],
      },
    };

    tracker.onDidSendMessage(response);

    expect(response.body.breakpoints[0].line).toBe(3);
    expect(response.body.breakpoints[0].source.path).toBe(FIXTURE_INDEX_JSP);
  });

  test('does not rewrite setBreakpoints requests for non-JSP files', () => {
    const output = makeOutput();
    const context = makeContext();

    registerJavaBreakpointTranslator(context, output);

    const factory = (vscode as any).__getLastDebugAdapterTrackerFactory?.();
    const tracker = factory.createDebugAdapterTracker({ name: 'test-session' });

    const someJavaFile = path.join(FIXTURE_WORKSPACE_ROOT, 'Some.java');

    const request: any = {
      type: 'request',
      seq: 301,
      command: 'setBreakpoints',
      arguments: {
        source: { path: someJavaFile },
        breakpoints: [{ line: 1 }],
      },
    };

    tracker.onWillReceiveMessage(request);

    expect(request.arguments.source.path).toBe(someJavaFile);
    expect(request.arguments.breakpoints[0].line).toBe(1);
  });

  test('refreshes breakpoint translation after a JSP recompile even within marker-cache debounce window', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-lang-bp-'));
    const tmpWebapp = path.join(tmpRoot, 'webapp');
    const tmpWorkDir = path.join(tmpRoot, 'tomcat-work');

    fs.mkdirSync(tmpWebapp, { recursive: true });
    fs.mkdirSync(tmpWorkDir, { recursive: true });

    const jspPath = path.join(tmpWebapp, 'index.jsp');
    fs.writeFileSync(jspPath, '<%-- placeholder --%>\n', 'utf8');

    const generatedJava = path.join(tmpWorkDir, 'index_jsp.java');

    // v1: marker for jspLine 3 lives at javaLine 5 => translated bp targets 6
    const v1 = [
      'public class X {',
      '  void a() {',
      '    int x = 0;',
      '  }',
      '  // line 3 "/webapp/index.jsp"',
      '  void b() {}',
      '}',
    ].join('\n');

    // v2: add padding so the marker shifts down to javaLine 9 => translated bp targets 10
    const v2 = [
      'public class X {',
      '  void a() {',
      '    int x = 0;',
      '  }',
      '  void pad1() {}',
      '  void pad2() {}',
      '  void pad3() {}',
      '  void pad4() {}',
      '  // line 3 "/webapp/index.jsp"',
      '  void b() {}',
      '}',
    ].join('\n');

    writeFileWithMtime(generatedJava, v1, new Date('2020-01-01T00:00:00.000Z'));

    (vscode as any).__setMockWorkspaceFolders?.([{ uri: { fsPath: tmpRoot } }]);
    (vscode as any).__setMockConfigValue?.('debug.breakpointTranslation.enabled', true);
    (vscode as any).__setMockConfigValue?.('debug.tomcat.workDir', tmpWorkDir);

    const output = makeOutput();
    const context = makeContext();
    registerJavaBreakpointTranslator(context, output);

    const factory = (vscode as any).__getLastDebugAdapterTrackerFactory?.();
    const tracker = factory.createDebugAdapterTracker({ name: 'test-session' });

    const req1: any = {
      type: 'request',
      seq: 1001,
      command: 'setBreakpoints',
      arguments: {
        source: { path: jspPath },
        breakpoints: [{ line: 3 }],
      },
    };

    tracker.onWillReceiveMessage(req1);
    expect(req1.arguments.source.path).toBe(generatedJava);
    expect(req1.arguments.breakpoints[0].line).toBe(6);

    // Simulate a recompile occurring immediately.
    writeFileWithMtime(generatedJava, v2, new Date('2020-01-01T00:00:10.000Z'));

    const req2: any = {
      type: 'request',
      seq: 1002,
      command: 'setBreakpoints',
      arguments: {
        source: { path: jspPath },
        breakpoints: [{ line: 3 }],
      },
    };

    tracker.onWillReceiveMessage(req2);
    expect(req2.arguments.source.path).toBe(generatedJava);
    expect(req2.arguments.breakpoints[0].line).toBe(10);
  });
});
