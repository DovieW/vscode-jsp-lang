import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Range } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export type SimpleLocation = {
  uri: string;
  range: Range;
};

export function buildPrefixRenameEdits(
  doc: TextDocument,
  oldPrefix: string,
  newPrefix: string,
): Array<{ range: Range; newText: string }> {
  if (!oldPrefix || !newPrefix || oldPrefix === newPrefix) {
    return [];
  }

  const text = doc.getText();
  const edits: Array<{ range: Range; newText: string }> = [];

  // 1) Rename prefix value in taglib directives: prefix="old" or prefix='old'
  // Keep this conservative: only within <%@ taglib ... %> blocks.
  const dirRe = /<%@\s*taglib\b([\s\S]*?)%>/gi;
  let m: RegExpExecArray | null;
  while ((m = dirRe.exec(text))) {
    const body = m[1] ?? '';
    const bodyStart = m.index + m[0].indexOf(body);

    const prefixRe = /\bprefix\s*=\s*(["'])([^"']*)\1/i;
    const pm = prefixRe.exec(body);
    if (!pm) {
      continue;
    }

    const value = pm[2] ?? '';
    if (value !== oldPrefix) {
      continue;
    }

    const valueStartInBody = (pm.index ?? 0) + pm[0].indexOf(value);
    const startOffset = bodyStart + valueStartInBody;
    const endOffset = startOffset + value.length;

    edits.push({
      newText: newPrefix,
      range: {
        start: doc.positionAt(startOffset),
        end: doc.positionAt(endOffset),
      },
    });
  }

  // 2) Rename tag usages: <old:... and </old:...
  // We DO NOT try to avoid strings/comments; JSP is too flexible. Keep it simple.
  // The leading '<' requirement makes it unlikely to hit URIs like http://.
  const tagPrefixRe = new RegExp(`<\\s*/?\\s*${escapeRegExp(oldPrefix)}\\s*:`, 'g');
  while ((m = tagPrefixRe.exec(text))) {
    const matchText = m[0];

    // Find the prefix span inside the match.
    const prefixStart = m.index + matchText.search(new RegExp(escapeRegExp(oldPrefix)));
    const prefixEnd = prefixStart + oldPrefix.length;

    edits.push({
      newText: newPrefix,
      range: {
        start: doc.positionAt(prefixStart),
        end: doc.positionAt(prefixEnd),
      },
    });
  }

  return edits;
}

export type OffsetSpan = {
  startOffset: number;
  endOffset: number;
};

/**
 * If the given offset is within a taglib directive's prefix value, returns that prefix and its span.
 *
 * Example:
 *   <%@ taglib prefix="c" uri="..." %>
 */
export function findTaglibDirectivePrefixValueAtOffset(
  jspText: string,
  offset: number,
): { prefix: string; startOffset: number; endOffset: number } | null {
  const dirRe = /<%@\s*taglib\b([\s\S]*?)%>/gi;
  let m: RegExpExecArray | null;
  while ((m = dirRe.exec(jspText))) {
    const full = m[0];
    const body = m[1] ?? '';
    const startOffset = m.index;
    const endOffset = startOffset + full.length;
    if (offset < startOffset || offset > endOffset) {
      continue;
    }

    const bodyStart = startOffset + full.indexOf(body);
    const prefixRe = /\bprefix\s*=\s*("([^"]*)"|'([^']*)')/i;
    const pm = prefixRe.exec(body);
    if (!pm) {
      return null;
    }

    const prefix = (pm[2] ?? pm[3] ?? '').trim();
    const prefixStartInBody = (pm.index ?? 0) + pm[0].indexOf(prefix);
    const prefixStart = bodyStart + prefixStartInBody;
    const prefixEnd = prefixStart + prefix.length;

    if (offset >= prefixStart && offset <= prefixEnd) {
      return { prefix, startOffset: prefixStart, endOffset: prefixEnd };
    }
    return null;
  }
  return null;
}

/**
 * Finds file-local tag prefix usages like:
 *   <c:if ...> or </c:if>
 * Returns spans that cover only the prefix (not the colon).
 */
export function scanTagPrefixUsagesInText(jspText: string, prefix: string): OffsetSpan[] {
  if (!jspText || !prefix) {
    return [];
  }

  const out: OffsetSpan[] = [];
  const re = new RegExp(`<\\s*/?\\s*${escapeRegExp(prefix)}\\s*:`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(jspText))) {
    const matchText = m[0];
    const prefixStart = m.index + matchText.search(new RegExp(escapeRegExp(prefix)));
    const prefixEnd = prefixStart + prefix.length;
    out.push({ startOffset: prefixStart, endOffset: prefixEnd });
  }
  return out;
}

export type IncludePathHit = {
  kind: 'directive' | 'jsp-include';
  path: string;
  startOffset: number;
  endOffset: number;
};

/**
 * Best-effort include navigation hit-testing.
 * Supports:
 *  - <%@ include file="..." %>
 *  - <jsp:include page="..." />
 */
export function findIncludePathAtOffset(jspText: string, offset: number): IncludePathHit | null {
  // 1) Static include directive: <%@ include file="..." %>
  const includeDirRe = /<%@\s*include\b([\s\S]*?)%>/gi;
  let m: RegExpExecArray | null;
  while ((m = includeDirRe.exec(jspText))) {
    const full = m[0];
    const body = m[1] ?? '';
    const start = m.index;
    const end = start + full.length;
    if (offset < start || offset > end) {
      continue;
    }

    const bodyStart = start + full.indexOf(body);
    const fileRe = /\bfile\s*=\s*("([^"]*)"|'([^']*)')/i;
    const fm = fileRe.exec(body);
    if (!fm) {
      return null;
    }

    const p = (fm[2] ?? fm[3] ?? '').trim();
    const valueStartInBody = (fm.index ?? 0) + fm[0].indexOf(p);
    const valueStart = bodyStart + valueStartInBody;
    const valueEnd = valueStart + p.length;

    if (offset >= valueStart && offset <= valueEnd) {
      return { kind: 'directive', path: p, startOffset: valueStart, endOffset: valueEnd };
    }
    return null;
  }

  // 2) jsp:include tag: <jsp:include page="..." />
  // Best-effort: only consider the start tag region.
  const jspIncludeRe = /<\s*jsp:include\b[^>]*>/gi;
  while ((m = jspIncludeRe.exec(jspText))) {
    const full = m[0];
    const start = m.index;
    const end = start + full.length;
    if (offset < start || offset > end) {
      continue;
    }

    const pageRe = /\bpage\s*=\s*("([^"]*)"|'([^']*)')/i;
    const pm = pageRe.exec(full);
    if (!pm) {
      return null;
    }

    const p = (pm[2] ?? pm[3] ?? '').trim();
    const valueStartInFull = (pm.index ?? 0) + pm[0].indexOf(p);
    const valueStart = start + valueStartInFull;
    const valueEnd = valueStart + p.length;

    if (offset >= valueStart && offset <= valueEnd) {
      return { kind: 'jsp-include', path: p, startOffset: valueStart, endOffset: valueEnd };
    }
    return null;
  }

  return null;
}

export function findTaglibDefinitionLocation(args: {
  tldFilePath: string;
  tagName: string;
  attributeName?: string;
}): SimpleLocation | null {
  const { tldFilePath, tagName, attributeName } = args;
  if (!tldFilePath || !tagName) {
    return null;
  }

  // Jar-scanned sources are represented as `jar:/path/to.jar!/META-INF/x.tld`.
  // We don't currently provide a virtual document for these, so definition locations
  // are only supported for real workspace files.
  if (tldFilePath.startsWith('jar:') || tldFilePath.includes('!/')) {
    return null;
  }

  // Best-effort location mapping by searching the XML text.
  // We intentionally avoid a full XML AST with position tracking.
  const xml = fsSync.readFileSync(tldFilePath, 'utf8');

  const tagBlockRe = new RegExp(
    `<tag\\b[\\s\\S]*?>[\\s\\S]*?<name>\\s*${escapeRegExp(tagName)}\\s*<\\/name>[\\s\\S]*?<\\/tag>`,
    'i',
  );
  const tagMatch = tagBlockRe.exec(xml);
  if (!tagMatch) {
    return null;
  }

  const tagBlockStart = tagMatch.index;
  const tagBlock = tagMatch[0];

  if (!attributeName) {
    const nameIndexInBlock = tagBlock.toLowerCase().indexOf('<name>');
    if (nameIndexInBlock === -1) {
      return null;
    }

    const nameValueStartInBlock = nameIndexInBlock + '<name>'.length;
    const nameValueEndInBlock = nameValueStartInBlock + tagName.length;

    const startOffset = tagBlockStart + nameValueStartInBlock;
    const endOffset = tagBlockStart + nameValueEndInBlock;

    return {
      uri: pathToFileURL(tldFilePath).toString(),
      range: rangeFromOffsets(xml, startOffset, endOffset),
    };
  }

  const attrBlockRe = new RegExp(
    `<attribute\\b[\\s\\S]*?>[\\s\\S]*?<name>\\s*${escapeRegExp(attributeName)}\\s*<\\/name>[\\s\\S]*?<\\/attribute>`,
    'i',
  );

  const attrMatch = attrBlockRe.exec(tagBlock);
  if (!attrMatch) {
    return null;
  }

  const attrBlockStart = tagBlockStart + attrMatch.index;
  const attrBlock = attrMatch[0];

  const nameIndexInAttr = attrBlock.toLowerCase().indexOf('<name>');
  if (nameIndexInAttr === -1) {
    return null;
  }

  const valueStartInAttr = nameIndexInAttr + '<name>'.length;
  const valueEndInAttr = valueStartInAttr + attributeName.length;

  const startOffset = attrBlockStart + valueStartInAttr;
  const endOffset = attrBlockStart + valueEndInAttr;

  return {
    uri: pathToFileURL(tldFilePath).toString(),
    range: rangeFromOffsets(xml, startOffset, endOffset),
  };
}

export async function scanTagUsagesInWorkspace(args: {
  roots: string[];
  prefix: string;
  tagName: string;
  maxFiles: number;
}): Promise<SimpleLocation[]> {
  const { roots, prefix, tagName, maxFiles } = args;
  if (!roots?.length || !prefix || !tagName || maxFiles <= 0) {
    return [];
  }

  const files: string[] = [];
  for (const r of roots) {
    await walkForJspLikeFiles(r, files, 18, maxFiles);
    if (files.length >= maxFiles) {
      break;
    }
  }

  const out: SimpleLocation[] = [];
  const re = new RegExp(`<\\s*${escapeRegExp(prefix)}\\s*:\\s*${escapeRegExp(tagName)}\\b`, 'g');

  for (const filePath of files) {
    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const startOffset = m.index + m[0].indexOf(prefix);
      const endOffset = startOffset + prefix.length + 1 + tagName.length;

      out.push({
        uri: pathToFileURL(filePath).toString(),
        range: rangeFromOffsets(text, startOffset, endOffset),
      });
    }
  }

  return out;
}

const DEFAULT_IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.next']);

async function walkForJspLikeFiles(root: string, out: string[], depth: number, maxFiles: number): Promise<void> {
  if (depth <= 0 || out.length >= maxFiles) {
    return;
  }

  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    if (out.length >= maxFiles) {
      return;
    }

    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (DEFAULT_IGNORE_DIRS.has(ent.name)) {
        continue;
      }
      await walkForJspLikeFiles(full, out, depth - 1, maxFiles);
      continue;
    }

    if (!ent.isFile()) {
      continue;
    }

    const lower = ent.name.toLowerCase();
    if (lower.endsWith('.jsp') || lower.endsWith('.jspf') || lower.endsWith('.tag')) {
      out.push(full);
      if (out.length >= maxFiles) {
        return;
      }
    }
  }
}

function rangeFromOffsets(text: string, startOffset: number, endOffset: number): Range {
  const start = positionAt(text, startOffset);
  const end = positionAt(text, endOffset);
  return { start, end };
}

function positionAt(text: string, offset: number): { line: number; character: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));

  let line = 0;
  let lastLineStart = 0;

  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
      lastLineStart = i + 1;
    }
  }

  return { line, character: clamped - lastLineStart };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
