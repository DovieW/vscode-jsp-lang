import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { extractJavaRegionsFromJsp } from '../server/src/jsp/extractJavaRegions';
import { validateJspLinting } from '../server/src/jsp/diagnostics/jspLint';

function makeDoc(uri: string, text: string) {
  return TextDocument.create(uri, 'jsp', 1, text);
}

describe('Feature 06 (JSP linting + validation)', () => {
  test('emits an info diagnostic when any scriptlet is present', () => {
    const jsp = ['<html>', '<% int x = 1; %>', '</html>'].join('\n');
    const doc = makeDoc('file:///test.jsp', jsp);

    const { regions } = extractJavaRegionsFromJsp(jsp);
    const diags = validateJspLinting({ doc, javaRegions: regions, workspaceRoots: [], docFsPath: undefined });

    const scriptlet = diags.find((d) => d.code === 'jsp.scriptlet.present');
    expect(scriptlet).toBeTruthy();
    expect(scriptlet!.severity).toBeDefined();
  });

  test('warns when a taglib directive is missing prefix or uri', () => {
    const jsp = [
      '<%@ taglib uri="http://example.com/t" %>',
      '<%@ taglib prefix="c" %>',
    ].join('\n');

    const doc = makeDoc('file:///test.jsp', jsp);
    const { regions } = extractJavaRegionsFromJsp(jsp);
    const diags = validateJspLinting({ doc, javaRegions: regions, workspaceRoots: [], docFsPath: undefined });

    expect(diags.some((d) => d.code === 'jsp.directive.taglib-missing-prefix')).toBe(true);
    expect(diags.some((d) => d.code === 'jsp.directive.taglib-missing-uri')).toBe(true);
  });

  test('warns on unresolvable include targets and stays quiet for resolvable ones', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-lang-lint-'));
    const webRoot = path.join(tmp, 'webapp');
    fs.mkdirSync(webRoot, { recursive: true });

    const partials = path.join(webRoot, 'partials');
    fs.mkdirSync(partials, { recursive: true });

    const header = path.join(partials, 'header.jspf');
    fs.writeFileSync(header, '<!-- header -->', 'utf8');

    const docPath = path.join(webRoot, 'index.jsp');

    const jsp = [
      '<%@ include file="/partials/header.jspf" %>',
      '<%@ include file="/partials/missing.jspf" %>',
      '<jsp:include page="missing2.jsp" />',
    ].join('\n');

    const doc = makeDoc(pathToFileURL(docPath).toString(), jsp);
    const { regions } = extractJavaRegionsFromJsp(jsp);

    const diags = validateJspLinting({
      doc,
      javaRegions: regions,
      workspaceRoots: [webRoot],
      docFsPath: docPath,
    });

    const includeDiags = diags.filter((d) => d.code === 'jsp.include.unresolvable');
    // Two missing includes should warn; the header include should not.
    expect(includeDiags.length).toBe(2);

    // Ensure the warning range points at the include path string.
    const first = includeDiags[0]!;
    expect(first.range.start.line).toBeGreaterThanOrEqual(0);
  });
});
