import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Diagnostic } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import type { JavaRegion } from '../extractJavaRegions';
import type { LintConfig } from './lintConfig';
import { DEFAULT_LINT_CONFIG, effectiveRuleLevel, severityFromLevel } from './lintConfig';

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

function pushDirectiveTaglibMissingAttrDiagnostics(doc: TextDocument, jspText: string, out: Diagnostic[], lint: LintConfig): void {
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
      const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.directive.taglib-missing-prefix', 'warning'));
      if (!sev) {
        // off
      } else {
      out.push({
        message: 'Taglib directive is missing required attribute "prefix".',
        severity: sev,
        range: { start: doc.positionAt(rangeStart), end: doc.positionAt(rangeEnd) },
        source: 'jsp-lang(lint)',
        code: 'jsp.directive.taglib-missing-prefix',
      });
      }
    }

    if (!uri) {
      const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.directive.taglib-missing-uri', 'warning'));
      if (!sev) {
        // off
      } else {
      out.push({
        message: 'Taglib directive is missing required attribute "uri".',
        severity: sev,
        range: { start: doc.positionAt(rangeStart), end: doc.positionAt(rangeEnd) },
        source: 'jsp-lang(lint)',
        code: 'jsp.directive.taglib-missing-uri',
      });
      }
    }
  }
}

function pushIncludeUnresolvableDiagnostics(
  doc: TextDocument,
  jspText: string,
  out: Diagnostic[],
  args: { docFsPath?: string; workspaceRoots: string[] },
  lint: LintConfig,
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

    const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.include.unresolvable', 'warning'));
    if (sev) {
      out.push({
        message: `Include target "${p}" could not be resolved in the workspace.`,
        severity: sev,
        range: { start: doc.positionAt(valueStart), end: doc.positionAt(valueEnd) },
        source: 'jsp-lang(lint)',
        code: 'jsp.include.unresolvable',
      });
    }
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

    const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.include.unresolvable', 'warning'));
    if (sev) {
      out.push({
        message: `Include target "${p}" could not be resolved in the workspace.`,
        severity: sev,
        range: { start: doc.positionAt(valueStart), end: doc.positionAt(valueEnd) },
        source: 'jsp-lang(lint)',
        code: 'jsp.include.unresolvable',
      });
    }
  }
}

function pushScriptletPresenceDiagnostic(doc: TextDocument, javaRegions: JavaRegion[], out: Diagnostic[], lint: LintConfig): void {
  const first = javaRegions.find(isScriptletRegion);
  if (!first) {
    return;
  }

  const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.scriptlet.present', 'info'));
  if (!sev) {
    return;
  }

  // Highlight only the opening delimiter so we don't paint the whole scriptlet block.
  const start = first.jspStartOffset;
  const end = Math.min(first.jspStartOffset + 3, first.jspEndOffset);

  out.push({
    message:
      'JSP scriptlet detected. Consider migrating logic to taglibs (JSTL) / EL, or move code into Java classes for better maintainability.',
    severity: sev,
    range: { start: doc.positionAt(start), end: doc.positionAt(end) },
    source: 'jsp-lang(lint)',
    code: 'jsp.scriptlet.present',
  });
}

function countLines(text: string): number {
  if (!text) return 0;
  // Count newline chars + 1.
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

function estimateMaxBraceDepth(javaSnippet: string): number {
  // Very rough heuristic. We want "deeply nested logic" signals, not correctness.
  let depth = 0;
  let max = 0;
  for (let i = 0; i < javaSnippet.length; i++) {
    const c = javaSnippet.charCodeAt(i);
    if (c === 123 /* { */) {
      depth++;
      if (depth > max) max = depth;
    } else if (c === 125 /* } */) {
      depth = Math.max(0, depth - 1);
    }
  }
  return max;
}

function pushScriptletCountAndSizeDiagnostics(doc: TextDocument, javaRegions: JavaRegion[], out: Diagnostic[], lint: LintConfig): void {
  const scriptlets = javaRegions.filter(isScriptletRegion);
  if (!scriptlets.length) {
    return;
  }

  // Too many scriptlets
  const maxCount = Math.max(0, lint.scriptlets.maxCount ?? 0);
  if (maxCount > 0 && scriptlets.length > maxCount) {
    const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.scriptlet.too-many', 'info'));
    if (sev) {
      const first = scriptlets[0]!;
      const start = first.jspStartOffset;
      const end = Math.min(first.jspStartOffset + 3, first.jspEndOffset);
      out.push({
        message: `This file contains ${scriptlets.length} scriptlet blocks (limit: ${maxCount}). Consider moving logic into taglibs/EL or Java classes.`,
        severity: sev,
        range: { start: doc.positionAt(start), end: doc.positionAt(end) },
        source: 'jsp-lang(lint)',
        code: 'jsp.scriptlet.too-many',
      });
    }
  }

  // Too large + nested control flow (per-block)
  const maxLines = Math.max(0, lint.scriptlets.maxLines ?? 0);
  const maxNesting = Math.max(0, lint.scriptlets.maxNesting ?? 0);

  for (const r of scriptlets) {
    const body = doc.getText({
      start: doc.positionAt(r.jspContentStartOffset),
      end: doc.positionAt(r.jspContentEndOffset),
    });

    if (maxLines > 0) {
      const lines = countLines(body);
      if (lines > maxLines) {
        const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.scriptlet.too-large', 'info'));
        if (sev) {
          const start = r.jspStartOffset;
          const end = Math.min(r.jspStartOffset + 3, r.jspEndOffset);
          out.push({
            message: `This scriptlet spans ~${lines} lines (limit: ${maxLines}). Consider extracting logic for readability.`,
            severity: sev,
            range: { start: doc.positionAt(start), end: doc.positionAt(end) },
            source: 'jsp-lang(lint)',
            code: 'jsp.scriptlet.too-large',
          });
        }
      }
    }

    if (maxNesting > 0) {
      const depth = estimateMaxBraceDepth(body);
      if (depth > maxNesting) {
        const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.scriptlet.nested-control-flow', 'info'));
        if (sev) {
          const start = r.jspStartOffset;
          const end = Math.min(r.jspStartOffset + 3, r.jspEndOffset);
          out.push({
            message: `This scriptlet appears deeply nested (brace depth ~${depth}, limit: ${maxNesting}). Consider simplifying control flow.`,
            severity: sev,
            range: { start: doc.positionAt(start), end: doc.positionAt(end) },
            source: 'jsp-lang(lint)',
            code: 'jsp.scriptlet.nested-control-flow',
          });
        }
      }
    }
  }
}

export function validateJspLinting(args: {
  doc: TextDocument;
  javaRegions: JavaRegion[];
  workspaceRoots: string[];
  docFsPath?: string;
  lintConfig?: LintConfig;
}): Diagnostic[] {
  const { doc, javaRegions, workspaceRoots, docFsPath } = args;

  const lint = args.lintConfig ?? DEFAULT_LINT_CONFIG;
  if (!lint.enable) {
    return [];
  }

  const jspText = doc.getText();
  const out: Diagnostic[] = [];

  pushScriptletPresenceDiagnostic(doc, javaRegions, out, lint);
  pushScriptletCountAndSizeDiagnostics(doc, javaRegions, out, lint);
  pushDirectiveTaglibMissingAttrDiagnostics(doc, jspText, out, lint);
  pushIncludeUnresolvableDiagnostics(doc, jspText, out, { docFsPath, workspaceRoots }, lint);

  return out;
}

// Exported for potential future reuse in navigation features.
export function fsPathToFileUri(fsPath: string): string {
  return pathToFileURL(fsPath).toString();
}
