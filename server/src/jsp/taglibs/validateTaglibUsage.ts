import type { Diagnostic } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import { parseTaglibDirectives } from './parseTaglibDirectives';
import type { TaglibIndex } from './types';
import type { LintConfig } from '../diagnostics/lintConfig';
import { DEFAULT_LINT_CONFIG, effectiveRuleLevel, severityFromLevel } from '../diagnostics/lintConfig';

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
  return validateTaglibUsageInJspWithConfig(jspDocument, index, undefined);
}

export function validateTaglibUsageInJspWithConfig(
  jspDocument: TextDocument,
  index: TaglibIndex | undefined,
  lintConfig: LintConfig | undefined,
): Diagnostic[] {
  const jspText = jspDocument.getText();
  const prefixMap = buildPrefixMap(jspText);
  const diagnostics: Diagnostic[] = [];

  const lint = lintConfig ?? DEFAULT_LINT_CONFIG;

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
      const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.taglib.unknown-prefix', 'warning'));
      if (sev) {
        diagnostics.push({
          message: `Unknown taglib prefix "${prefix}". Add a <%@ taglib prefix=\"${prefix}\" uri=\"...\" %> directive to enable tag completions/validation.`,
          severity: sev,
          range: { start: jspDocument.positionAt(nameStart), end: jspDocument.positionAt(nameEnd) },
          source: 'jsp-lang(taglibs)',
          code: 'jsp.taglib.unknown-prefix',
          data: { prefix },
        });
      }
      continue;
    }

    const taglib = index?.byUri.get(uri);
    if (!taglib) {
      // We know the prefix exists, but we couldn't resolve the TLD.
      // Keep this as a warning (common when TLD is only available from jars).
      const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.taglib.unresolved-tld', 'warning'));
      if (sev) {
        diagnostics.push({
          message: `Taglib URI "${uri}" is imported as prefix "${prefix}", but no matching .tld was found in the workspace.`,
          severity: sev,
          range: { start: jspDocument.positionAt(nameStart), end: jspDocument.positionAt(nameEnd) },
          source: 'jsp-lang(taglibs)',
          code: 'jsp.taglib.unresolved-tld',
          data: { prefix, uri },
        });
      }
      continue;
    }

    const tagDef = taglib.tags.get(tag);
    if (!tagDef) {
      const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.tag.unknown-tag', 'warning'));
      if (sev) {
        diagnostics.push({
          message: `Unknown tag <${prefix}:${tag}> for taglib URI "${uri}".`,
          severity: sev,
          range: { start: jspDocument.positionAt(nameStart), end: jspDocument.positionAt(nameEnd) },
          source: 'jsp-lang(taglibs)',
          code: 'jsp.tag.unknown-tag',
          data: { prefix, tag, uri },
        });
      }
      continue;
    }

    // Attribute validation (best-effort).
    const attrs = parseAttributeNames(attrText);
    const present = new Set(attrs.map((a) => a.name));
    const attrTextStartOffset = matchStart + (m[0].length - 1 - attrText.length);
    for (const a of attrs) {
      if (tagDef.attributes.has(a.name)) {
        continue;
      }

      const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.tag.unknown-attribute', 'warning'));
      if (!sev) {
        continue;
      }

      const attrNameStart = attrTextStartOffset + a.index;
      const attrNameEnd = attrNameStart + a.name.length;
      diagnostics.push({
        message: `Unknown attribute "${a.name}" on <${prefix}:${tag}>.`,
        severity: sev,
        range: { start: jspDocument.positionAt(attrNameStart), end: jspDocument.positionAt(attrNameEnd) },
        source: 'jsp-lang(taglibs)',
        code: 'jsp.tag.unknown-attribute',
        data: { prefix, tag, uri, attribute: a.name },
      });
    }

    // Missing required attributes.
    const requiredAttrs = [...tagDef.attributes.values()].filter((a) => a.required === true);
    for (const req of requiredAttrs) {
      if (present.has(req.name)) {
        continue;
      }

      const sev = severityFromLevel(effectiveRuleLevel(lint, 'jsp.tag.missing-required-attribute', 'warning'));
      if (sev) {
        diagnostics.push({
          message: `Missing required attribute "${req.name}" on <${prefix}:${tag}>.`,
          severity: sev,
          range: { start: jspDocument.positionAt(nameStart), end: jspDocument.positionAt(nameEnd) },
          source: 'jsp-lang(taglibs)',
          code: 'jsp.tag.missing-required-attribute',
          data: { prefix, tag, uri, attribute: req.name },
        });
      }
    }
  }

  return diagnostics;
}
