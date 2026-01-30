import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { mapJavaLineToJsp } from './tomcatJspSourceMap';
import { GeneratedJavaMarkerCache } from './generatedJavaMarkerCache';

type StackFrameRewriteSettings = {
  enabled: boolean;
  verbose: boolean;
  webRoots: string[];
  markerCacheMaxEntries: number;
  markerCacheStatDebounceMs: number;
  jspPathCacheTtlMs: number;
};

function readSettings(): StackFrameRewriteSettings {
  const cfg = vscode.workspace.getConfiguration('jsp');

  const webRoots = cfg.get<string[]>('debug.stackFrameRewrite.webRoots', ['.', 'src/main/webapp', 'WebContent']);
  const markerCacheMaxEntries = cfg.get<number>('debug.stackFrameRewrite.cache.maxEntries', 200);
  const markerCacheStatDebounceMs = cfg.get<number>('debug.stackFrameRewrite.cache.statDebounceMs', 250);
  const jspPathCacheTtlMs = cfg.get<number>('debug.stackFrameRewrite.jspPathCache.ttlMs', 5000);

  return {
    enabled: cfg.get<boolean>('debug.stackFrameRewrite.enabled', true),
    verbose: cfg.get<boolean>('debug.stackFrameRewrite.verbose', false),
    webRoots: Array.isArray(webRoots) && webRoots.length > 0 ? webRoots : ['.', 'src/main/webapp', 'WebContent'],
    markerCacheMaxEntries: Number.isFinite(markerCacheMaxEntries) ? Math.max(1, markerCacheMaxEntries) : 200,
    markerCacheStatDebounceMs: Number.isFinite(markerCacheStatDebounceMs)
      ? Math.max(0, markerCacheStatDebounceMs)
      : 250,
    jspPathCacheTtlMs: Number.isFinite(jspPathCacheTtlMs) ? Math.max(0, jspPathCacheTtlMs) : 5000,
  };
}

function isLikelyGeneratedJspServletSource(sourcePath: string): boolean {
  const p = sourcePath.replace(/\\/g, '/');

  // Tomcat tends to generate into a work directory and use org/apache/jsp package.
  if (p.includes('/org/apache/jsp/') && p.endsWith('.java')) return true;

  // Fallback heuristic: Jasper usually names classes *_jsp.java
  if (/_jsp\.java$/i.test(p)) return true;

  return false;
}

type ResolvedJspPathCacheEntry = {
  checkedAtMs: number;
  resolvedPath?: string;
};

function resolveWorkspaceJspPath(
  jspRef: string,
  webRootCandidates: string[],
  cache: Map<string, ResolvedJspPathCacheEntry>,
  cacheTtlMs: number,
): string | undefined {
  const normalized = jspRef.replace(/\\/g, '/');

  const now = Date.now();
  const cached = cache.get(normalized);
  if (cached && cacheTtlMs > 0 && now - cached.checkedAtMs < cacheTtlMs) {
    return cached.resolvedPath;
  }

  // If it is already an absolute path on this machine and exists, prefer it.
  if (path.isAbsolute(jspRef) && fs.existsSync(jspRef)) {
    cache.set(normalized, { checkedAtMs: now, resolvedPath: jspRef });
    return jspRef;
  }

  const rel = normalized.replace(/^\//, '');
  const folders = vscode.workspace.workspaceFolders ?? [];

  for (const folder of folders) {
    const root = folder.uri.fsPath;

    for (const webRoot of webRootCandidates) {
      const candidate = path.join(root, webRoot, rel);
      if (fs.existsSync(candidate)) {
        cache.set(normalized, { checkedAtMs: now, resolvedPath: candidate });
        return candidate;
      }
    }
  }

  cache.set(normalized, { checkedAtMs: now, resolvedPath: undefined });
  return undefined;
}

function maybeRewriteStackTraceResponse(
  message: any,
  output: vscode.OutputChannel,
  settings: StackFrameRewriteSettings,
  markerCache: GeneratedJavaMarkerCache,
  jspPathCache: Map<string, ResolvedJspPathCacheEntry>,
): void {
  const stackFrames: any[] | undefined = message?.body?.stackFrames;
  if (!Array.isArray(stackFrames) || stackFrames.length === 0) return;

  // Robust refresh for JSP recompiles:
  // Ensure we stat() each generated servlet source at least once per stackTrace response,
  // even if the cache is in its debounce window from a previous response.
  const forceStatForPathOnce = new Set<string>();

  for (const frame of stackFrames) {
    const sourcePath: string | undefined = frame?.source?.path;
    const javaLine: number | undefined = frame?.line;

    if (!sourcePath || typeof javaLine !== 'number') continue;
    if (!isLikelyGeneratedJspServletSource(sourcePath)) continue;

    const markers = markerCache.readMarkersForGeneratedJavaFile(sourcePath, {
      forceStat: !forceStatForPathOnce.has(sourcePath),
    });
    forceStatForPathOnce.add(sourcePath);
    if (!markers || markers.length === 0) continue;

    const mapped = mapJavaLineToJsp(markers, javaLine);
    if (!mapped) continue;

    const jspFileRef = mapped.jspFile;
    if (!jspFileRef) continue;

    const jspPath = resolveWorkspaceJspPath(
      jspFileRef,
      settings.webRoots,
      jspPathCache,
      settings.jspPathCacheTtlMs,
    );
    if (!jspPath) continue;

    // Rewrite in-place: VS Code sees the mutated message object.
    frame.source = {
      ...(frame.source ?? {}),
      name: path.basename(jspPath),
      path: jspPath,
    };
    frame.line = mapped.jspLine;

    if (settings.verbose) {
      output.appendLine(
        `[debug] Rewrote stack frame: ${sourcePath}:${javaLine} -> ${jspPath}:${mapped.jspLine}`,
      );
    }
  }
}

export function registerJavaStackFrameRewriter(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  let settings = readSettings();
  const markerCache = new GeneratedJavaMarkerCache({
    maxEntries: settings.markerCacheMaxEntries,
    statDebounceMs: settings.markerCacheStatDebounceMs,
  });
  const jspPathCache = new Map<string, ResolvedJspPathCacheEntry>();

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('jsp.debug.stackFrameRewrite')) return;

    settings = readSettings();
    markerCache.updateOptions({
      maxEntries: settings.markerCacheMaxEntries,
      statDebounceMs: settings.markerCacheStatDebounceMs,
    });
    jspPathCache.clear();

    if (settings.verbose) {
      output.appendLine('[debug] JSP stack-frame rewrite settings reloaded; caches cleared.');
    }
  });
  context.subscriptions.push(configListener);

  const disposable = vscode.debug.registerDebugAdapterTrackerFactory('java', {
    createDebugAdapterTracker: (session) => {
      if (!settings.enabled) return {};

      if (settings.verbose) {
        output.appendLine(`[debug] JSP stack-frame rewrite tracker active for session: ${session.name}`);
      }

      return {
        onDidSendMessage: (m) => {
          try {
            // We only touch stackTrace responses.
            if (m?.type === 'response' && m?.command === 'stackTrace' && m?.success === true) {
              maybeRewriteStackTraceResponse(m, output, settings, markerCache, jspPathCache);
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
