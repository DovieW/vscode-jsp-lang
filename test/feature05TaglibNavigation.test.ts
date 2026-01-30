import { describe, expect, test } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { TextDocument } from 'vscode-languageserver-textdocument';

import {
  buildPrefixRenameEdits,
  findIncludePathAtOffset,
  findTaglibDefinitionLocation,
  findTaglibDirectivePrefixValueAtOffset,
  scanTagUsagesInWorkspace,
  scanTagPrefixUsagesInText,
} from '../server/src/jsp/navigation/taglibNavigation';

const FIXTURE_ROOT = path.join(__dirname, '..', 'samples', 'feature03-tests');
const DEMO_TLD = path.join(FIXTURE_ROOT, 'WEB-INF', 'tlds', 'demo.tld');

function makeDoc(text: string) {
  return TextDocument.create('file:///test.jsp', 'jsp', 1, text);
}

describe('Feature 05 (taglib navigation + rename)', () => {
  test('buildPrefixRenameEdits renames prefix in directive and tag usages (file-local)', () => {
    const jsp = [
      '<%@ taglib prefix="c" uri="http://example.com/tld/demo" %>',
      '<c:if test="true">',
      '  <c:out value="x" />',
      '</c:if>',
    ].join('\n');

    const doc = makeDoc(jsp);

    const edits = buildPrefixRenameEdits(doc, 'c', 'core');

    // Expect at least: directive + 3 tag occurrences (<c:if, <c:out, </c:if)
    expect(edits.length).toBeGreaterThanOrEqual(3);

    const applied = applyEdits(doc.getText(), edits);
    expect(applied).toContain('prefix="core"');
    expect(applied).toContain('<core:if');
    expect(applied).toContain('<core:out');
    expect(applied).toContain('</core:if>');

    // Ensure we did not accidentally change the URI.
    expect(applied).toContain('uri="http://example.com/tld/demo"');
  });

  test('findTaglibDefinitionLocation finds best-effort tag + attribute locations in a .tld', () => {
    expect(fs.existsSync(DEMO_TLD)).toBe(true);

    const tagLoc = findTaglibDefinitionLocation({ tldFilePath: DEMO_TLD, tagName: 'form' });
    expect(tagLoc).toBeTruthy();
    expect(tagLoc!.uri.endsWith('/demo.tld')).toBe(true);
    expect(tagLoc!.range.start.line).toBeGreaterThanOrEqual(0);

    const attrLoc = findTaglibDefinitionLocation({ tldFilePath: DEMO_TLD, tagName: 'form', attributeName: 'action' });
    expect(attrLoc).toBeTruthy();
    expect(attrLoc!.range.start.line).toBeGreaterThanOrEqual(tagLoc!.range.start.line);
  });

  test('scanTagUsagesInWorkspace finds references across JSP files', async () => {
    const refs = await scanTagUsagesInWorkspace({
      roots: [FIXTURE_ROOT],
      prefix: 'demo',
      tagName: 'form',
      maxFiles: 200,
    });

    // The fixture has multiple demo:form occurrences.
    expect(refs.length).toBeGreaterThanOrEqual(2);

    const anyInTagnameFixture = refs.some((r) => r.uri.endsWith('/taglibs-tagname-completion.jsp'));
    expect(anyInTagnameFixture).toBe(true);
  });

  test('findTaglibDirectivePrefixValueAtOffset detects prefix value when cursor is inside <%@ taglib %>', () => {
    const jsp = [
      '<%@ taglib prefix="c" uri="http://example.com/tld/demo" %>',
      '<c:if test="true">',
      '</c:if>',
    ].join('\n');

    const offsetInsidePrefix = jsp.indexOf('prefix="c"') + 'prefix="'.length;
    const hit = findTaglibDirectivePrefixValueAtOffset(jsp, offsetInsidePrefix);

    expect(hit).toBeTruthy();
    expect(hit!.prefix).toBe('c');
    expect(jsp.slice(hit!.startOffset, hit!.endOffset)).toBe('c');
  });

  test('scanTagPrefixUsagesInText finds file-local <prefix: occurrences (not directive values)', () => {
    const jsp = [
      '<%@ taglib prefix="c" uri="http://example.com/tld/demo" %>',
      '<c:if test="true">',
      '  <c:out value="x" />',
      '</c:if>',
    ].join('\n');

    const spans = scanTagPrefixUsagesInText(jsp, 'c');

    // Expect 3 usages: <c:if, <c:out, </c:if
    expect(spans.length).toBe(3);
    for (const s of spans) {
      expect(jsp.slice(s.startOffset, s.endOffset)).toBe('c');
    }
  });

  test('findIncludePathAtOffset detects <%@ include file=... %> and <jsp:include page=...>', () => {
    const jsp = [
      '<%@ include file="/partials/header.jspf" %>',
      '<jsp:include page="other.jsp" />',
    ].join('\n');

    const dirOffset = jsp.indexOf('header.jspf');
    const dirHit = findIncludePathAtOffset(jsp, dirOffset);
    expect(dirHit).toBeTruthy();
    expect(dirHit!.kind).toBe('directive');
    expect(dirHit!.path).toBe('/partials/header.jspf');

    const tagOffset = jsp.indexOf('other.jsp');
    const tagHit = findIncludePathAtOffset(jsp, tagOffset);
    expect(tagHit).toBeTruthy();
    expect(tagHit!.kind).toBe('jsp-include');
    expect(tagHit!.path).toBe('other.jsp');
  });
});

function applyEdits(text: string, edits: Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }>) {
  // Apply in reverse order by start offset.
  const lines = text.split(/\n/);
  const offsetAt = (pos: { line: number; character: number }) => {
    let off = 0;
    for (let i = 0; i < pos.line; i++) off += lines[i]!.length + 1;
    return off + pos.character;
  };

  const sorted = [...edits].sort((a, b) => offsetAt(b.range.start) - offsetAt(a.range.start));
  let out = text;
  for (const e of sorted) {
    const start = offsetAt(e.range.start);
    const end = offsetAt(e.range.end);
    out = out.slice(0, start) + e.newText + out.slice(end);
  }
  return out;
}
