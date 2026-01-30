import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Diagnostic } from 'vscode-languageserver';
import { DiagnosticSeverity } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import type { JavaRegion } from '../extractJavaRegions';

function isScriptletRegion(region: JavaRegion): boolean {
  return (
    region.kind === 'scriptlet-statement' ||
    region.kind === 'scriptlet-expression' ||
    region.kind === 'scriptlet-declaration'
  );
}

function resolveIncludeTargetToFsPath(args: {
  docFsPath: string;
  workspaceRoots: string[];
  includePath: string;
}): string | undefined {
  const { docFsPath, workspaceRoots, includePath } = args;
  if (!docFsPath || !includePath) {
    return undefined;
  }

  const docDir = path.dirname(docFsPath);

  // JSP include paths often start with '/', which is typically "web-root relative", not filesystem-absolute.
  if (includePath.startsWith('/')) {
    const rel = includePath.replace(/^\/+/, '');

    for (const root of workspaceRoots) {
      const candidate = path.join(root, rel);
      if (fsSync.existsSync(candidate)) {
        return candidate;
      }
    }

    // Fallback: treat as relative to current file.
    const fallback = path.join(docDir, rel);
    if (fsSync.existsSync(fallback)) {
      return fallback;
    }

    return undefined;
  }

  const candidate = path.resolve(docDir, includePath);
  if (fsSync.existsSync(candidate)) {
    return candidate;
  }

  return undefined;
}

function pushDirectiveTaglibMissingAttrDiagnostics(doc: TextDocument, jspText: string, out: Diagnostic[]): void {
  const dirRe = /<%@\s*taglib\b([\s\S]*?)%>/gi;
  let m: RegExpExecArray | null;
  while ((m = dirRe.exec(jspText))) {
    const full = m[0];
    const body = m[1] ?? '';
    const startOffset = m.index;
    const endOffset = startOffset + full.length;

    let prefix: string | undefined;
    let uri: string | undefined;

    const attrRe = /\b(prefix|uri)\s*=\s*("([^"]*)"|'([^']*)')/gi;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(body))) {
      const key = (a[1] ?? '').toLowerCase();
      const value = (a[3] ?? a[4] ?? '').trim();
      if (key === 'prefix') prefix = value;
      if (key === 'uri') uri = value;
    }

    if (prefix && uri) {
      continue;
    }

    // Highlight the 'taglib' keyword (best-effort) rather than the whole directive.
    const keywordIndex = full.toLowerCase().indexOf('taglib');
    const rangeStart = keywordIndex >= 0 ? startOffset + keywordIndex : startOffset;
    const rangeEnd = keywordIndex >= 0 ? rangeStart + 'taglib'.length : Math.min(endOffset, startOffset + 5);

    if (!prefix) {
      out.push({
        message: 'Taglib directive is missing required attribute "prefix".',
        severity: DiagnosticSeverity.Warning,
        range: { start: doc.positionAt(rangeStart), end: doc.positionAt(rangeEnd) },
        source: 'jsp-lang(lint)',
        code: 'jsp.directive.taglib-missing-prefix',
      });
    }

    if (!uri) {
      out.push({
        message: 'Taglib directive is missing required attribute "uri".',
        severity: DiagnosticSeverity.Warning,
        range: { start: doc.positionAt(rangeStart), end: doc.positionAt(rangeEnd) },
        source: 'jsp-lang(lint)',
        code: 'jsp.directive.taglib-missing-uri',
      });
    }
  }
}

function pushIncludeUnresolvableDiagnostics(
  doc: TextDocument,
  jspText: string,
  out: Diagnostic[],
  args: { docFsPath?: string; workspaceRoots: string[] },
): void {
  const { docFsPath, workspaceRoots } = args;
  if (!docFsPath || !workspaceRoots.length) {
    return;
  }

  // <%@ include file="..." %>
  const includeDirRe = /<%@\s*include\b([\s\S]*?)%>/gi;
  let m: RegExpExecArray | null;
  while ((m = includeDirRe.exec(jspText))) {
    const full = m[0];
    const body = m[1] ?? '';
    const startOffset = m.index;

    const fileRe = /\bfile\s*=\s*("([^"]*)"|'([^']*)')/i;
    const fm = fileRe.exec(body);
    if (!fm) {
      continue;
    }

    const p = (fm[2] ?? fm[3] ?? '').trim();
    if (!p) {
      continue;
    }

    const bodyStart = startOffset + full.indexOf(body);
    const valueStartInBody = (fm.index ?? 0) + fm[0].indexOf(p);
    const valueStart = bodyStart + valueStartInBody;
    const valueEnd = valueStart + p.length;

    const resolved = resolveIncludeTargetToFsPath({ docFsPath, workspaceRoots, includePath: p });
    if (resolved) {
      continue;
    }

    out.push({
      message: `Include target "${p}" could not be resolved in the workspace.`,
      severity: DiagnosticSeverity.Warning,
      range: { start: doc.positionAt(valueStart), end: doc.positionAt(valueEnd) },
      source: 'jsp-lang(lint)',
      code: 'jsp.include.unresolvable',
    });
  }

  // <jsp:include page="..." />
  const jspIncludeRe = /<\s*jsp:include\b[^>]*>/gi;
  while ((m = jspIncludeRe.exec(jspText))) {
    const full = m[0];
    const startOffset = m.index;

    const pageRe = /\bpage\s*=\s*("([^"]*)"|'([^']*)')/i;
    const pm = pageRe.exec(full);
    if (!pm) {
      continue;
    }

    const p = (pm[2] ?? pm[3] ?? '').trim();
    if (!p) {
      continue;
    }

    const valueStartInFull = (pm.index ?? 0) + pm[0].indexOf(p);
    const valueStart = startOffset + valueStartInFull;
    const valueEnd = valueStart + p.length;

    const resolved = resolveIncludeTargetToFsPath({ docFsPath, workspaceRoots, includePath: p });
    if (resolved) {
      continue;
    }

    out.push({
      message: `Include target "${p}" could not be resolved in the workspace.`,
      severity: DiagnosticSeverity.Warning,
      range: { start: doc.positionAt(valueStart), end: doc.positionAt(valueEnd) },
      source: 'jsp-lang(lint)',
      code: 'jsp.include.unresolvable',
    });
  }
}

function pushScriptletPresenceDiagnostic(doc: TextDocument, javaRegions: JavaRegion[], out: Diagnostic[]): void {
  const first = javaRegions.find(isScriptletRegion);
  if (!first) {
    return;
  }

  // Highlight only the opening delimiter so we don't paint the whole scriptlet block.
  const start = first.jspStartOffset;
  const end = Math.min(first.jspStartOffset + 3, first.jspEndOffset);

  out.push({
    message:
      'JSP scriptlet detected. Consider migrating logic to taglibs (JSTL) / EL, or move code into Java classes for better maintainability.',
    severity: DiagnosticSeverity.Information,
    range: { start: doc.positionAt(start), end: doc.positionAt(end) },
    source: 'jsp-lang(lint)',
    code: 'jsp.scriptlet.present',
  });
}

export function validateJspLinting(args: {
  doc: TextDocument;
  javaRegions: JavaRegion[];
  workspaceRoots: string[];
  docFsPath?: string;
}): Diagnostic[] {
  const { doc, javaRegions, workspaceRoots, docFsPath } = args;

  const jspText = doc.getText();
  const out: Diagnostic[] = [];

  pushScriptletPresenceDiagnostic(doc, javaRegions, out);
  pushDirectiveTaglibMissingAttrDiagnostics(doc, jspText, out);
  pushIncludeUnresolvableDiagnostics(doc, jspText, out, { docFsPath, workspaceRoots });

  return out;
}

// Exported for potential future reuse in navigation features.
export function fsPathToFileUri(fsPath: string): string {
  return pathToFileURL(fsPath).toString();
}
