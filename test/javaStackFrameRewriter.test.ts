import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// This import is resolved via vitest alias to test/mock/vscode.ts
import * as vscode from 'vscode';

import { registerJavaStackFrameRewriter } from '../src/debug/javaStackFrameRewriter';

const FIXTURE_WORKSPACE_ROOT = path.join(__dirname, 'fixtures', 'workspaces', 'feature04');
const FIXTURE_GENERATED_JAVA = path.join(__dirname, 'fixtures', 'tomcat-generated', 'index_jsp.java');

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

describe('javaStackFrameRewriter (Feature 04 Milestone 1)', () => {
  beforeEach(() => {
    (vscode as any).__resetMocks?.();

    // Ensure the workspace fixtures exist (tests should be runnable from a clean checkout)
    // The files themselves are checked in; this is a sanity check to fail loudly if missing.
    expect(fs.existsSync(FIXTURE_WORKSPACE_ROOT)).toBe(true);
    expect(fs.existsSync(FIXTURE_GENERATED_JAVA)).toBe(true);

    (vscode as any).__setMockWorkspaceFolders?.([{ uri: { fsPath: FIXTURE_WORKSPACE_ROOT } }]);
    (vscode as any).__setMockEnabled?.(true);
  });

  test('rewrites stackTrace frames from generated *_jsp.java to workspace .jsp/.jspf paths', () => {
    const output = makeOutput();
    const context = makeContext();

    registerJavaStackFrameRewriter(context, output);

    const factory = (vscode as any).__getLastDebugAdapterTrackerFactory?.();
    expect(factory).toBeTruthy();

    const tracker = factory.createDebugAdapterTracker({ name: 'test-session' });
    expect(typeof tracker.onDidSendMessage).toBe('function');

    const message: any = {
      type: 'response',
      command: 'stackTrace',
      success: true,
      body: {
        stackFrames: [
          {
            id: 1,
            name: 'frame-1',
            line: 16,
            source: { path: FIXTURE_GENERATED_JAVA },
          },
          {
            id: 2,
            name: 'frame-2',
            line: 18,
            source: { path: FIXTURE_GENERATED_JAVA },
          },
        ],
      },
    };

    tracker.onDidSendMessage(message);

    // Line 16 maps to marker at javaLine 14 -> jspLine 3, jspFile '/webapp/index.jsp'
    expect(message.body.stackFrames[0].line).toBe(3);
    expect(message.body.stackFrames[0].source.path).toBe(
      path.join(FIXTURE_WORKSPACE_ROOT, 'webapp', 'index.jsp'),
    );

    // Line 18 maps to marker at javaLine 17 -> jspLine 10, jspFile 'WEB-INF/jspf/header.jspf'
    expect(message.body.stackFrames[1].line).toBe(10);
    expect(message.body.stackFrames[1].source.path).toBe(
      path.join(FIXTURE_WORKSPACE_ROOT, 'WEB-INF', 'jspf', 'header.jspf'),
    );
  });

  test('does not rewrite when debug messages are not stackTrace responses', () => {
    const output = makeOutput();
    const context = makeContext();

    registerJavaStackFrameRewriter(context, output);

    const factory = (vscode as any).__getLastDebugAdapterTrackerFactory?.();
    const tracker = factory.createDebugAdapterTracker({ name: 'test-session' });

    const message: any = {
      type: 'response',
      command: 'threads',
      success: true,
      body: {
        stackFrames: [
          {
            id: 1,
            name: 'frame-1',
            line: 16,
            source: { path: FIXTURE_GENERATED_JAVA },
          },
        ],
      },
    };

    tracker.onDidSendMessage(message);

    // unchanged
    expect(message.body.stackFrames[0].line).toBe(16);
    expect(message.body.stackFrames[0].source.path).toBe(FIXTURE_GENERATED_JAVA);
  });

  test('does not rewrite when the feature flag is disabled', () => {
    (vscode as any).__setMockEnabled?.(false);

    const output = makeOutput();
    const context = makeContext();

    registerJavaStackFrameRewriter(context, output);

    const factory = (vscode as any).__getLastDebugAdapterTrackerFactory?.();
    const tracker = factory.createDebugAdapterTracker({ name: 'test-session' });

    // When disabled, our implementation returns an empty tracker object.
    expect(tracker.onDidSendMessage).toBeUndefined();
  });

  test('does not rewrite when source is not likely a generated JSP servlet source', () => {
    const output = makeOutput();
    const context = makeContext();

    registerJavaStackFrameRewriter(context, output);

    const factory = (vscode as any).__getLastDebugAdapterTrackerFactory?.();
    const tracker = factory.createDebugAdapterTracker({ name: 'test-session' });

    const message: any = {
      type: 'response',
      command: 'stackTrace',
      success: true,
      body: {
        stackFrames: [
          {
            id: 1,
            name: 'frame-1',
            line: 16,
            source: { path: path.join(__dirname, 'fixtures', 'tomcat-generated', 'not_generated.java') },
          },
        ],
      },
    };

    tracker.onDidSendMessage(message);

    // unchanged
    expect(message.body.stackFrames[0].line).toBe(16);
  });

  test('refreshes mapping across stackTrace responses when generated servlet source is recompiled (within debounce window)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-lang-rewrite-'));
    const tmpWebapp = path.join(tmpRoot, 'webapp');

    fs.mkdirSync(tmpWebapp, { recursive: true });
    fs.writeFileSync(path.join(tmpWebapp, 'index.jsp'), '<%-- placeholder --%>\n', 'utf8');

    const generated = path.join(tmpRoot, 'index_jsp.java');

    const v1 = [
      'public class X {',
      '  void a() {',
      '    int x = 0;',
      '  }',
      '  // line 1 "/webapp/index.jsp"',
      '  void b() {}',
      '}',
    ].join('\n');

    const v2 = [
      'public class X {',
      '  void a() {',
      '    int x = 0;',
      '  }',
      '  // line 99 "/webapp/index.jsp"',
      '  void b() {}',
      '}',
    ].join('\n');

    writeFileWithMtime(generated, v1, new Date('2020-01-01T00:00:00.000Z'));

    const output = makeOutput();
    const context = makeContext();

    // Override workspace folder to our temp root for this test.
    (vscode as any).__setMockWorkspaceFolders?.([{ uri: { fsPath: tmpRoot } }]);

    registerJavaStackFrameRewriter(context, output);

    const factory = (vscode as any).__getLastDebugAdapterTrackerFactory?.();
    const tracker = factory.createDebugAdapterTracker({ name: 'test-session' });

    // First stackTrace: map java line 6 -> marker at line 5 -> jspLine 1
    const msg1: any = {
      type: 'response',
      command: 'stackTrace',
      success: true,
      body: { stackFrames: [{ id: 1, name: 'frame', line: 6, source: { path: generated } }] },
    };

    tracker.onDidSendMessage(msg1);
    expect(msg1.body.stackFrames[0].line).toBe(1);
    expect(msg1.body.stackFrames[0].source.path).toBe(path.join(tmpRoot, 'webapp', 'index.jsp'));

    // Simulate recompile occurring immediately (still inside debounce window). If we don't
    // force a stat() per stackTrace response, we'd keep using the stale markers.
    writeFileWithMtime(generated, v2, new Date('2020-01-01T00:00:10.000Z'));

    const msg2: any = {
      type: 'response',
      command: 'stackTrace',
      success: true,
      body: { stackFrames: [{ id: 1, name: 'frame', line: 6, source: { path: generated } }] },
    };

    tracker.onDidSendMessage(msg2);
    expect(msg2.body.stackFrames[0].line).toBe(99);
    expect(msg2.body.stackFrames[0].source.path).toBe(path.join(tmpRoot, 'webapp', 'index.jsp'));
  });
});
