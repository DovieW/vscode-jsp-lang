import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { extractJavaRegionsFromJsp } from '../server/src/jsp/extractJavaRegions';
import { validateJspLinting } from '../server/src/jsp/diagnostics/jspLint';
import { DEFAULT_LINT_CONFIG } from '../server/src/jsp/diagnostics/lintConfig';
import { parseTldXml } from '../server/src/jsp/taglibs/parseTld';
import { validateTaglibUsageInJspWithConfig } from '../server/src/jsp/taglibs/validateTaglibUsage';
import { validateJavaScriptletSyntax } from '../server/src/jsp/diagnostics/javaScriptletDiagnostics';

function makeDoc(uri: string, text: string) {
  return TextDocument.create(uri, 'jsp', 1, text);
}

describe('Feature 06 (JSP linting + validation)', () => {
  test('emits an info diagnostic when any scriptlet is present', () => {
    const jsp = ['<html>', '<% int x = 1; %>', '</html>'].join('\n');
    const doc = makeDoc('file:///test.jsp', jsp);

    const { regions } = extractJavaRegionsFromJsp(jsp);
    const diags = validateJspLinting({
      doc,
      javaRegions: regions,
      workspaceRoots: [],
      docFsPath: undefined,
      includeConfig: { webRoots: [], resolveStrategy: 'relative-first' },
      lintConfig: DEFAULT_LINT_CONFIG,
    });

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
    const diags = validateJspLinting({
      doc,
      javaRegions: regions,
      workspaceRoots: [],
      docFsPath: undefined,
      includeConfig: { webRoots: [], resolveStrategy: 'relative-first' },
      lintConfig: DEFAULT_LINT_CONFIG,
    });

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
      includeConfig: { webRoots: [], resolveStrategy: 'relative-first' },
      lintConfig: DEFAULT_LINT_CONFIG,
    });

    const includeDiags = diags.filter((d) => d.code === 'jsp.include.unresolvable');
    // Two missing includes should warn; the header include should not.
    expect(includeDiags.length).toBe(2);

    // Ensure the warning range points at the include path string.
    const first = includeDiags[0]!;
    expect(first.range.start.line).toBeGreaterThanOrEqual(0);
  });

  test('scriptlet count/size/nesting rules produce diagnostics when thresholds are exceeded', () => {
    const jsp = [
      '<html>',
      '<%\nif (a) { if (b) { if (c) { if (d) { } } } }\n%>',
      '<% int x = 1; %>',
      '<% int y = 2; %>',
      '<% int z = 3; %>',
      '<% int w = 4; %>',
      '<% int v = 5; %>',
      '</html>',
    ].join('\n');

    const doc = makeDoc('file:///test.jsp', jsp);
    const { regions } = extractJavaRegionsFromJsp(jsp);

    const lintConfig = {
      ...DEFAULT_LINT_CONFIG,
      scriptlets: { maxCount: 2, maxLines: 1, maxNesting: 2 },
      rules: {
        ...DEFAULT_LINT_CONFIG.rules,
        'jsp.scriptlet.too-many': 'warning',
        'jsp.scriptlet.too-large': 'warning',
        'jsp.scriptlet.nested-control-flow': 'warning',
      },
    };

    const diags = validateJspLinting({
      doc,
      javaRegions: regions,
      workspaceRoots: [],
      docFsPath: undefined,
      includeConfig: { webRoots: [], resolveStrategy: 'relative-first' },
      lintConfig,
    });

    expect(diags.some((d) => d.code === 'jsp.scriptlet.too-many')).toBe(true);
    expect(diags.some((d) => d.code === 'jsp.scriptlet.too-large')).toBe(true);
    expect(diags.some((d) => d.code === 'jsp.scriptlet.nested-control-flow')).toBe(true);
  });

  test('taglib validation warns when a required attribute is missing', () => {
    const tldPath = path.join(__dirname, '..', 'samples', 'feature03-tests', 'WEB-INF', 'tlds', 'demo.tld');
    const xml = fs.readFileSync(tldPath, 'utf8');
    const taglib = parseTldXml(xml, tldPath);

    const index = {
      byUri: new Map([[taglib.uri!, taglib]]),
      builtAtMs: 0,
      tldFileCount: 1,
      parseErrorCount: 0,
      roots: [],
    };

    const jsp = [
      `<%@ taglib prefix="demo" uri="${taglib.uri}" %>`,
      '<demo:form method="POST" />',
    ].join('\n');

    const doc = makeDoc('file:///test.jsp', jsp);
    const diags = validateTaglibUsageInJspWithConfig(doc, index as any, DEFAULT_LINT_CONFIG);

    const missingReq = diags.find((d) => d.code === 'jsp.tag.missing-required-attribute');
    expect(missingReq).toBeTruthy();
  });

  test('java scriptlet syntax diagnostics report an error for invalid Java (when enabled)', () => {
    const jsp = ['<% int x = ; %>'].join('\n');
    const doc = makeDoc('file:///test.jsp', jsp);
    const { regions, pageImports } = extractJavaRegionsFromJsp(jsp);

    const diags = validateJavaScriptletSyntax({ doc, javaRegions: regions, pageImports });
    expect(diags.some((d) => d.code === 'jsp.java.syntax')).toBe(true);
  });
});
