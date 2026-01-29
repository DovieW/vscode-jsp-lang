import type { Diagnostic } from 'vscode-languageserver';
import { DiagnosticSeverity } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import { parseTaglibDirectives } from './parseTaglibDirectives';
import type { TaglibIndex } from './types';

type PrefixMap = Map<string, string>; // prefix -> uri

function buildPrefixMap(jspText: string): PrefixMap {
  const map = new Map<string, string>();
  for (const d of parseTaglibDirectives(jspText)) {
    map.set(d.prefix, d.uri);
  }
  return map;
}

function parseAttributeNames(attrText: string): Array<{ name: string; index: number }> {
  // attrText is the substring between the tag name and the closing `>`.
  // We'll match `foo=` occurrences and report the offset of the attribute name.
  const out: Array<{ name: string; index: number }> = [];
  const re = /(?:^|\s)([A-Za-z_][\w:.-]*)(?=\s*=)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText))) {
    out.push({ name: m[1], index: m.index + (m[0].length - m[1].length) });
  }
  return out;
}

export function validateTaglibUsageInJsp(jspDocument: TextDocument, index: TaglibIndex | undefined): Diagnostic[] {
  const jspText = jspDocument.getText();
  const prefixMap = buildPrefixMap(jspText);
  const diagnostics: Diagnostic[] = [];

  // Find start tags like `<prefix:tag ...>` (not closing tags).
  const tagRe = /<\s*([A-Za-z_][\w.-]*)\s*:\s*([A-Za-z_][\w.-]*)\b([^>]*?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(jspText))) {
    const prefix = m[1];
    const tag = m[2];
    const attrText = m[3] ?? '';

    // Compute offsets for the `prefix:tag` portion.
    const matchStart = m.index;
    const nameStart = jspText.indexOf(prefix, matchStart);
    const nameEnd = nameStart + prefix.length + 1 + tag.length;

    const uri = prefixMap.get(prefix);
    if (!uri) {
      diagnostics.push({
        message: `Unknown taglib prefix "${prefix}". Add a <%@ taglib prefix=\"${prefix}\" uri=\"...\" %> directive to enable tag completions/validation.`,
        severity: DiagnosticSeverity.Warning,
        range: { start: jspDocument.positionAt(nameStart), end: jspDocument.positionAt(nameEnd) },
        source: 'jsp-lang(taglibs)',
      });
      continue;
    }

    const taglib = index?.byUri.get(uri);
    if (!taglib) {
      // We know the prefix exists, but we couldn't resolve the TLD.
      // Keep this as a warning (common when TLD is only available from jars).
      diagnostics.push({
        message: `Taglib URI "${uri}" is imported as prefix "${prefix}", but no matching .tld was found in the workspace.`,
        severity: DiagnosticSeverity.Warning,
        range: { start: jspDocument.positionAt(nameStart), end: jspDocument.positionAt(nameEnd) },
        source: 'jsp-lang(taglibs)',
      });
      continue;
    }

    const tagDef = taglib.tags.get(tag);
    if (!tagDef) {
      diagnostics.push({
        message: `Unknown tag <${prefix}:${tag}> for taglib URI "${uri}".`,
        severity: DiagnosticSeverity.Warning,
        range: { start: jspDocument.positionAt(nameStart), end: jspDocument.positionAt(nameEnd) },
        source: 'jsp-lang(taglibs)',
      });
      continue;
    }

    // Attribute validation (best-effort).
    const attrs = parseAttributeNames(attrText);
    const attrTextStartOffset = matchStart + (m[0].length - 1 - attrText.length);
    for (const a of attrs) {
      if (tagDef.attributes.has(a.name)) {
        continue;
      }

      const attrNameStart = attrTextStartOffset + a.index;
      const attrNameEnd = attrNameStart + a.name.length;
      diagnostics.push({
        message: `Unknown attribute "${a.name}" on <${prefix}:${tag}>.`,
        severity: DiagnosticSeverity.Warning,
        range: { start: jspDocument.positionAt(attrNameStart), end: jspDocument.positionAt(attrNameEnd) },
        source: 'jsp-lang(taglibs)',
      });
    }
  }

  return diagnostics;
}
