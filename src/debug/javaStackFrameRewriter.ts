import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { mapJavaLineToJsp, parseTomcatGeneratedJavaMarkers, type TomcatJspMarker } from './tomcatJspSourceMap';

type MarkerCacheEntry = {
  mtimeMs: number;
  markers: TomcatJspMarker[];
};

const markerCache = new Map<string, MarkerCacheEntry>();

function readMarkersForGeneratedJavaFile(generatedJavaPath: string): TomcatJspMarker[] | undefined {
  try {
    const stat = fs.statSync(generatedJavaPath);
    const cached = markerCache.get(generatedJavaPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.markers;

    const text = fs.readFileSync(generatedJavaPath, 'utf8');
    const markers = parseTomcatGeneratedJavaMarkers(text);

    markerCache.set(generatedJavaPath, { mtimeMs: stat.mtimeMs, markers });
    return markers;
  } catch {
    return undefined;
  }
}

function isLikelyGeneratedJspServletSource(sourcePath: string): boolean {
  const p = sourcePath.replace(/\\/g, '/');

  // Tomcat tends to generate into a work directory and use org/apache/jsp package.
  if (p.includes('/org/apache/jsp/') && p.endsWith('.java')) return true;

  // Fallback heuristic: Jasper usually names classes *_jsp.java
  if (/_jsp\.java$/i.test(p)) return true;

  return false;
}

function resolveWorkspaceJspPath(jspRef: string): string | undefined {
  const normalized = jspRef.replace(/\\/g, '/');

  // If it is already an absolute path on this machine and exists, prefer it.
  if (path.isAbsolute(jspRef) && fs.existsSync(jspRef)) return jspRef;

  const rel = normalized.replace(/^\//, '');
  const folders = vscode.workspace.workspaceFolders ?? [];

  const webRootCandidates = ['.', 'src/main/webapp', 'WebContent'];

  for (const folder of folders) {
    const root = folder.uri.fsPath;

    for (const webRoot of webRootCandidates) {
      const candidate = path.join(root, webRoot, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

function maybeRewriteStackTraceResponse(message: any, output: vscode.OutputChannel): void {
  const stackFrames: any[] | undefined = message?.body?.stackFrames;
  if (!Array.isArray(stackFrames) || stackFrames.length === 0) return;

  for (const frame of stackFrames) {
    const sourcePath: string | undefined = frame?.source?.path;
    const javaLine: number | undefined = frame?.line;

    if (!sourcePath || typeof javaLine !== 'number') continue;
    if (!isLikelyGeneratedJspServletSource(sourcePath)) continue;

    const markers = readMarkersForGeneratedJavaFile(sourcePath);
    if (!markers || markers.length === 0) continue;

    const mapped = mapJavaLineToJsp(markers, javaLine);
    if (!mapped) continue;

    const jspFileRef = mapped.jspFile;
    if (!jspFileRef) continue;

    const jspPath = resolveWorkspaceJspPath(jspFileRef);
    if (!jspPath) continue;

    // Rewrite in-place: VS Code sees the mutated message object.
    frame.source = {
      ...(frame.source ?? {}),
      name: path.basename(jspPath),
      path: jspPath,
    };
    frame.line = mapped.jspLine;

    output.appendLine(
      `[debug] Rewrote stack frame: ${sourcePath}:${javaLine} -> ${jspPath}:${mapped.jspLine}`,
    );
  }
}

export function registerJavaStackFrameRewriter(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  const disposable = vscode.debug.registerDebugAdapterTrackerFactory('java', {
    createDebugAdapterTracker: (session) => {
      const enabled = vscode.workspace
        .getConfiguration('jsp')
        .get<boolean>('debug.stackFrameRewrite.enabled', true);

      if (!enabled) return {};

      output.appendLine(`[debug] JSP stack-frame rewrite tracker active for session: ${session.name}`);

      return {
        onDidSendMessage: (m) => {
          try {
            // We only touch stackTrace responses.
            if (m?.type === 'response' && m?.command === 'stackTrace' && m?.success === true) {
              maybeRewriteStackTraceResponse(m, output);
            }
          } catch (err) {
            output.appendLine(`[debug] Failed to rewrite stack trace: ${String(err)}`);
          }
        },
      };
    },
  });

  context.subscriptions.push(disposable);
}
