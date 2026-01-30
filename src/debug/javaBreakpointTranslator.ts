import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { mapJavaLineToJsp } from './tomcatJspSourceMap';
import { GeneratedJavaMarkerCache } from './generatedJavaMarkerCache';

type BreakpointTranslationSettings = {
  enabled: boolean;
  verbose: boolean;
  /** Candidate workspace-relative web roots (same semantics as stackFrameRewrite.webRoots). */
  webRoots: string[];

  /** Tomcat work directories to scan for generated servlet sources. */
  tomcatWorkDirs: string[];

  /** Limit scanning to avoid runaway recursion in huge directories. */
  maxGeneratedFilesToScan: number;

  /** TTL for caching jspAbsPath -> generatedJavaPath resolution results. */
  generatedJavaPathCacheTtlMs: number;

  markerCacheMaxEntries: number;
  markerCacheStatDebounceMs: number;
  jspPathCacheTtlMs: number;
};

function readSettings(): BreakpointTranslationSettings {
  const cfg = vscode.workspace.getConfiguration('jsp');

  const webRoots = cfg.get<string[]>('debug.stackFrameRewrite.webRoots', ['.', 'src/main/webapp', 'WebContent']);

  const markerCacheMaxEntries = cfg.get<number>('debug.stackFrameRewrite.cache.maxEntries', 200);
  const markerCacheStatDebounceMs = cfg.get<number>('debug.stackFrameRewrite.cache.statDebounceMs', 250);
  const jspPathCacheTtlMs = cfg.get<number>('debug.stackFrameRewrite.jspPathCache.ttlMs', 5000);

  const enabled = cfg.get<boolean>('debug.breakpointTranslation.enabled', true);
  const verbose = cfg.get<boolean>('debug.breakpointTranslation.verbose', false);

  // Support string or string[] (the JSON schema contribution uses string, but users can still
  // hand-edit settings.json with an array; we accept both).
  const workDirAny = cfg.get<any>('debug.tomcat.workDir', undefined);
  const workDirs: string[] = [];
  if (typeof workDirAny === 'string' && workDirAny.trim().length > 0) workDirs.push(workDirAny.trim());
  if (Array.isArray(workDirAny)) {
    for (const v of workDirAny) {
      if (typeof v === 'string' && v.trim().length > 0) workDirs.push(v.trim());
    }
  }

  // Env fallback when no explicit workDir is provided.
  const envCandidates = [process.env.CATALINA_BASE, process.env.CATALINA_HOME, process.env.TOMCAT_HOME]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => path.join(x, 'work'));

  const tomcatWorkDirs = [...workDirs, ...envCandidates];

  const maxGeneratedFilesToScan = cfg.get<number>('debug.breakpointTranslation.maxGeneratedFilesToScan', 5000);
  const generatedJavaPathCacheTtlMs = cfg.get<number>('debug.breakpointTranslation.generatedJavaPathCache.ttlMs', 5000);

  return {
    enabled,
    verbose,
    webRoots: Array.isArray(webRoots) && webRoots.length > 0 ? webRoots : ['.', 'src/main/webapp', 'WebContent'],
    tomcatWorkDirs,
    maxGeneratedFilesToScan: Number.isFinite(maxGeneratedFilesToScan)
      ? Math.max(100, Math.floor(maxGeneratedFilesToScan))
      : 5000,
    generatedJavaPathCacheTtlMs: Number.isFinite(generatedJavaPathCacheTtlMs)
      ? Math.max(0, Math.floor(generatedJavaPathCacheTtlMs))
      : 5000,
    markerCacheMaxEntries: Number.isFinite(markerCacheMaxEntries) ? Math.max(1, markerCacheMaxEntries) : 200,
    markerCacheStatDebounceMs: Number.isFinite(markerCacheStatDebounceMs)
      ? Math.max(0, markerCacheStatDebounceMs)
      : 250,
    jspPathCacheTtlMs: Number.isFinite(jspPathCacheTtlMs) ? Math.max(0, jspPathCacheTtlMs) : 5000,
  };
}

function isJspLikeFile(sourcePath: string): boolean {
  return /\.(jsp|jspf|tag)$/i.test(sourcePath.replace(/\\/g, '/'));
}

function isLikelyGeneratedJspServletSource(sourcePath: string): boolean {
  const p = sourcePath.replace(/\\/g, '/');
  if (p.includes('/org/apache/jsp/') && p.endsWith('.java')) return true;
  if (/_jsp\.java$/i.test(p)) return true;
  if (/_tag\.java$/i.test(p)) return true;
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

type GeneratedJavaPathCacheEntry = {
  checkedAtMs: number;
  generatedJavaPath?: string;
};

function computePossibleMarkerJspRefs(jspAbsPath: string, webRootCandidates: string[]): string[] {
  const refs = new Set<string>();
  const folders = vscode.workspace.workspaceFolders ?? [];

  const jspAbsNormalized = path.resolve(jspAbsPath);

  for (const folder of folders) {
    const root = path.resolve(folder.uri.fsPath);
    for (const webRoot of webRootCandidates) {
      const webRootAbs = path.resolve(path.join(root, webRoot));

      // Ensure prefix match on path boundary.
      const prefix = webRootAbs.endsWith(path.sep) ? webRootAbs : webRootAbs + path.sep;
      if (!jspAbsNormalized.startsWith(prefix)) continue;

      const rel = jspAbsNormalized.slice(prefix.length).replace(/\\/g, '/');
      if (!rel) continue;
      refs.add(rel);
      refs.add('/' + rel);
    }
  }

  // Also add basename-only as a last resort (rare, but cheap).
  refs.add(path.basename(jspAbsNormalized));

  return [...refs];
}

function* walkFiles(rootDir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const full = path.join(rootDir, ent.name);
    if (ent.isDirectory()) {
      yield* walkFiles(full);
    } else if (ent.isFile()) {
      yield full;
    }
  }
}

function findGeneratedJavaForJspSource(
  jspAbsPath: string,
  settings: BreakpointTranslationSettings,
  markerCache: GeneratedJavaMarkerCache,
  generatedJavaPathCache: Map<string, GeneratedJavaPathCacheEntry>,
): string | undefined {
  const now = Date.now();
  const cacheKey = path.resolve(jspAbsPath);
  const cached = generatedJavaPathCache.get(cacheKey);
  if (cached && settings.generatedJavaPathCacheTtlMs > 0 && now - cached.checkedAtMs < settings.generatedJavaPathCacheTtlMs) {
    return cached.generatedJavaPath;
  }

  const possibleRefs = computePossibleMarkerJspRefs(jspAbsPath, settings.webRoots).map((r) => r.replace(/\\/g, '/'));

  let filesScanned = 0;

  const workDirs = settings.tomcatWorkDirs
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
    .flatMap((d) => {
      // Allow workspace-relative workDir paths.
      if (path.isAbsolute(d)) return [d];
      const folders = vscode.workspace.workspaceFolders ?? [];
      return folders.map((f) => path.join(f.uri.fsPath, d));
    });

  for (const workDir of workDirs) {
    for (const file of walkFiles(workDir)) {
      filesScanned++;
      if (filesScanned > settings.maxGeneratedFilesToScan) break;

      const p = file.replace(/\\/g, '/');
      if (!p.endsWith('.java')) continue;
      if (!isLikelyGeneratedJspServletSource(p)) continue;

      const markers = markerCache.readMarkersForGeneratedJavaFile(file, { forceStat: true });
      if (!markers || markers.length === 0) continue;

      // If any marker file reference matches one of our possible refs, we treat it as a hit.
      const hasMatch = markers.some((m) => {
        const jspFile = m.jspFile?.replace(/\\/g, '/');
        if (!jspFile) return false;
        return possibleRefs.includes(jspFile);
      });

      if (hasMatch) {
        generatedJavaPathCache.set(cacheKey, { checkedAtMs: now, generatedJavaPath: file });
        return file;
      }
    }
  }

  generatedJavaPathCache.set(cacheKey, { checkedAtMs: now, generatedJavaPath: undefined });
  return undefined;
}

function mapJspLineToJavaLine(
  markers: Array<{ javaLine: number; jspLine: number; jspFile?: string }>,
  possibleJspFileRefs: string[],
  jspLine: number,
): number | undefined {
  let best: { javaLine: number; jspLine: number } | undefined;

  const normalizedRefs = possibleJspFileRefs.map((r) => r.replace(/\\/g, '/'));

  for (const m of markers) {
    if (typeof m.jspFile !== 'string') continue;
    const jspFile = m.jspFile.replace(/\\/g, '/');
    if (!normalizedRefs.includes(jspFile)) continue;

    if (m.jspLine <= jspLine) {
      if (!best) {
        best = { javaLine: m.javaLine, jspLine: m.jspLine };
      } else {
        // Prefer closest JSP line <= target; on ties pick later javaLine.
        if (m.jspLine > best.jspLine || (m.jspLine === best.jspLine && m.javaLine > best.javaLine)) {
          best = { javaLine: m.javaLine, jspLine: m.jspLine };
        }
      }
    }
  }

  if (!best) return undefined;

  // Markers point at the comment line; the executable statement usually follows.
  return best.javaLine + 1;
}

type PendingSetBreakpoints = {
  originalSourcePath: string;
  requestedSourcePath: string;
  generatedJavaPath: string;
};

function tryRewriteSetBreakpointsRequest(
  message: any,
  output: vscode.OutputChannel,
  settings: BreakpointTranslationSettings,
  markerCache: GeneratedJavaMarkerCache,
  generatedJavaPathCache: Map<string, GeneratedJavaPathCacheEntry>,
  pendingByRequestSeq: Map<number, PendingSetBreakpoints>,
): void {
  if (message?.type !== 'request' || message?.command !== 'setBreakpoints') return;

  const srcPath: string | undefined = message?.arguments?.source?.path;
  if (!srcPath || typeof srcPath !== 'string') return;
  if (!isJspLikeFile(srcPath)) return;

  // Only translate breakpoints for files within workspace.
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const isInWorkspace = workspaceFolders.some((f) => {
    const root = path.resolve(f.uri.fsPath) + path.sep;
    return path.resolve(srcPath).startsWith(root);
  });
  if (!isInWorkspace) return;

  const generatedJavaPath = findGeneratedJavaForJspSource(srcPath, settings, markerCache, generatedJavaPathCache);
  if (!generatedJavaPath) {
    if (settings.verbose) {
      output.appendLine(`[debug] Breakpoint translation: no generated .java found for ${srcPath}`);
    }
    return;
  }

  // Ensure we refresh mappings promptly if the JSP was recompiled recently.
  // (Debounced stat checks are great for performance, but can make breakpoints feel “stuck”.)
  const markers = markerCache.readMarkersForGeneratedJavaFile(generatedJavaPath, { forceStat: true });
  if (!markers || markers.length === 0) return;

  const possibleRefs = computePossibleMarkerJspRefs(srcPath, settings.webRoots);

  const bps: any[] | undefined = message?.arguments?.breakpoints;
  if (!Array.isArray(bps) || bps.length === 0) return;

  let didChangeAny = false;
  for (const bp of bps) {
    const jspLine = bp?.line;
    if (typeof jspLine !== 'number') continue;

    const javaLine = mapJspLineToJavaLine(markers, possibleRefs, jspLine);
    if (typeof javaLine !== 'number') continue;

    bp.line = javaLine;
    didChangeAny = true;
  }

  if (!didChangeAny) return;

  // Rewrite the source in the outgoing request so the Java debug adapter accepts it.
  message.arguments.source = {
    ...(message.arguments.source ?? {}),
    name: path.basename(generatedJavaPath),
    path: generatedJavaPath,
  };

  if (typeof message.seq === 'number') {
    pendingByRequestSeq.set(message.seq, {
      originalSourcePath: srcPath,
      requestedSourcePath: srcPath,
      generatedJavaPath,
    });
  }

  if (settings.verbose) {
    output.appendLine(`[debug] Breakpoint translation: setBreakpoints ${srcPath} -> ${generatedJavaPath}`);
  }
}

function tryRewriteSetBreakpointsResponse(
  message: any,
  output: vscode.OutputChannel,
  settings: BreakpointTranslationSettings,
  markerCache: GeneratedJavaMarkerCache,
  jspPathCache: Map<string, ResolvedJspPathCacheEntry>,
  pendingByRequestSeq: Map<number, PendingSetBreakpoints>,
): void {
  if (message?.type !== 'response' || message?.command !== 'setBreakpoints' || message?.success !== true) return;

  const requestSeq: number | undefined = message?.request_seq;
  if (typeof requestSeq !== 'number') return;

  const pending = pendingByRequestSeq.get(requestSeq);
  if (!pending) return;

  const bps: any[] | undefined = message?.body?.breakpoints;
  if (!Array.isArray(bps) || bps.length === 0) return;

  // Prefer to map from the returned breakpoint line/source; fall back to our generatedJavaPath.
  const generatedJavaPath = pending.generatedJavaPath;

  const markers = markerCache.readMarkersForGeneratedJavaFile(generatedJavaPath, { forceStat: true });
  if (!markers || markers.length === 0) return;

  for (const bp of bps) {
    const javaLine = bp?.line;
    if (typeof javaLine !== 'number') continue;

    // Some adapters return bp.source.path. If it is a different generated file, use it.
    const srcPath: string | undefined = bp?.source?.path;
    const effectiveGeneratedPath = typeof srcPath === 'string' && isLikelyGeneratedJspServletSource(srcPath) ? srcPath : generatedJavaPath;

    const effectiveMarkers = effectiveGeneratedPath === generatedJavaPath
      ? markers
      : markerCache.readMarkersForGeneratedJavaFile(effectiveGeneratedPath, { forceStat: true });

    if (!effectiveMarkers || effectiveMarkers.length === 0) continue;

    const mapped = mapJavaLineToJsp(effectiveMarkers, javaLine);
    if (!mapped?.jspLine || !mapped.jspFile) continue;

    const jspPath = resolveWorkspaceJspPath(mapped.jspFile, settings.webRoots, jspPathCache, settings.jspPathCacheTtlMs);
    if (!jspPath) continue;

    bp.line = mapped.jspLine;
    bp.source = {
      ...(bp.source ?? {}),
      name: path.basename(jspPath),
      path: jspPath,
    };

    if (settings.verbose) {
      output.appendLine(`[debug] Breakpoint translation: response ${effectiveGeneratedPath}:${javaLine} -> ${jspPath}:${mapped.jspLine}`);
    }
  }

  // We can drop the pending entry now.
  pendingByRequestSeq.delete(requestSeq);
}

export function registerJavaBreakpointTranslator(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  let settings = readSettings();

  const markerCache = new GeneratedJavaMarkerCache({
    maxEntries: settings.markerCacheMaxEntries,
    statDebounceMs: settings.markerCacheStatDebounceMs,
  });

  const jspPathCache = new Map<string, ResolvedJspPathCacheEntry>();
  const generatedJavaPathCache = new Map<string, GeneratedJavaPathCacheEntry>();
  const pendingByRequestSeq = new Map<number, PendingSetBreakpoints>();

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('jsp.debug')) return;

    settings = readSettings();
    markerCache.updateOptions({
      maxEntries: settings.markerCacheMaxEntries,
      statDebounceMs: settings.markerCacheStatDebounceMs,
    });
    jspPathCache.clear();
    generatedJavaPathCache.clear();
    pendingByRequestSeq.clear();

    if (settings.verbose) {
      output.appendLine('[debug] JSP breakpoint translation settings reloaded; caches cleared.');
    }
  });

  context.subscriptions.push(configListener);

  const disposable = vscode.debug.registerDebugAdapterTrackerFactory('java', {
    createDebugAdapterTracker: (session) => {
      if (!settings.enabled) return {};

      if (settings.verbose) {
        output.appendLine(`[debug] JSP breakpoint translation tracker active for session: ${session.name}`);
      }

      return {
        onWillReceiveMessage: (m) => {
          try {
            tryRewriteSetBreakpointsRequest(m, output, settings, markerCache, generatedJavaPathCache, pendingByRequestSeq);
          } catch (err) {
            output.appendLine(`[debug] Failed to translate breakpoints request: ${String(err)}`);
          }
        },
        onDidSendMessage: (m) => {
          try {
            tryRewriteSetBreakpointsResponse(m, output, settings, markerCache, jspPathCache, pendingByRequestSeq);
          } catch (err) {
            output.appendLine(`[debug] Failed to translate breakpoints response: ${String(err)}`);
          }
        },
      };
    },
  });

  context.subscriptions.push(disposable);
}
