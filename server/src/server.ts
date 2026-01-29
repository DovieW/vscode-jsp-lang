import {
  type CompletionList,
  type CompletionParams,
  type CompletionItem,
  CompletionItemKind,
  type Diagnostic,
  DiagnosticSeverity,
  type Hover,
  type HoverParams,
  type InitializeParams,
  type InitializeResult,
  InsertTextFormat,
  type InsertReplaceEdit,
  type Range,
  type TextDocumentChangeEvent,
  TextDocumentSyncKind,
  type TextEdit,
} from 'vscode-languageserver';
import { fileURLToPath } from 'node:url';
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  getLanguageService as getHtmlLanguageService,
  type DocumentContext,
  TokenType,
} from 'vscode-html-languageservice';
import { getCSSLanguageService, type Stylesheet } from 'vscode-css-languageservice';

import { maskJspToHtml } from './jsp/maskToHtml';
import { extractCssRegionsFromProjectedHtml, type CssRegion } from './jsp/extractCssRegions';
import { extractJavaRegionsFromJsp, type JavaRegion } from './jsp/extractJavaRegions';
import { buildTaglibIndex } from './jsp/taglibs/taglibIndex';
import { parseTaglibDirectives } from './jsp/taglibs/parseTaglibDirectives';
import { getStartTagContext } from './jsp/taglibs/startTagContext';
import type { TaglibIndex } from './jsp/taglibs/types';
import { validateTaglibUsageInJsp } from './jsp/taglibs/validateTaglibUsage';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

documents.listen(connection);

const htmlLanguageService = getHtmlLanguageService();
const cssLanguageService = getCSSLanguageService();
const documentContext: DocumentContext = {
  resolveReference: (ref: string, _base: string) => ref,
};

cssLanguageService.configure({ validate: true });

type PendingValidation = {
  timer: NodeJS.Timeout;
  version: number;
};

const pendingValidations = new Map<string, PendingValidation>();

let workspaceRoots: string[] = [];
let taglibIndex: TaglibIndex | undefined;
let taglibIndexBuild: Promise<void> | undefined;

function uriToFsPath(uri: string | null | undefined): string | undefined {
  if (!uri) {
    return undefined;
  }
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

async function ensureTaglibIndex(): Promise<TaglibIndex | undefined> {
  if (!workspaceRoots.length) {
    return undefined;
  }

  // Rebuild occasionally (helps when users add .tld files while VS Code is open).
  const isStale = !taglibIndex || Date.now() - taglibIndex.builtAtMs > 15_000;
  if (!taglibIndexBuild && isStale) {
    taglibIndexBuild = buildTaglibIndex(workspaceRoots)
      .then((idx) => {
        taglibIndex = idx;
        connection.console.log(
          `Taglib index built: ${idx.byUri.size} URIs (${idx.tldFileCount} .tld files, ${idx.parseErrorCount} parse errors)`,
        );
      })
      .catch((err) => {
        connection.console.error(`Taglib index build failed: ${String(err)}`);
      })
      .finally(() => {
        taglibIndexBuild = undefined;
      });
  }

  if (taglibIndexBuild) {
    await taglibIndexBuild;
  }

  return taglibIndex;
}

type ParsedDocumentCache = {
  version: number;
  htmlDocument: TextDocument;
  htmlParsed: unknown;
  cssRegions: Array<{ region: CssRegion; stylesheet: Stylesheet }>;
  javaRegions: JavaRegion[];
  pageImports: string[];
};

const parsedCache = new Map<string, ParsedDocumentCache>();

function getProjectedHtmlDocument(jspDocument: TextDocument): TextDocument {
  const htmlText = maskJspToHtml(jspDocument.getText());
  // Keep the same URI to simplify mapping; language service only cares about text + positions.
  return TextDocument.create(jspDocument.uri, 'html', jspDocument.version, htmlText);
}

function getOrCreateParsedCache(jspDocument: TextDocument): ParsedDocumentCache {
  const existing = parsedCache.get(jspDocument.uri);
  if (existing && existing.version === jspDocument.version) {
    return existing;
  }

  const { regions: javaRegions, pageImports } = extractJavaRegionsFromJsp(jspDocument.getText());

  const htmlDocument = getProjectedHtmlDocument(jspDocument);
  const htmlParsed = htmlLanguageService.parseHTMLDocument(htmlDocument);

  const cssRegions = extractCssRegionsFromProjectedHtml(htmlDocument).map((region) => {
    const stylesheet = cssLanguageService.parseStylesheet(region.cssDocument);
    return { region, stylesheet };
  });

  const next: ParsedDocumentCache = {
    version: jspDocument.version,
    htmlDocument,
    htmlParsed,
    cssRegions,
    javaRegions,
    pageImports,
  };
  parsedCache.set(jspDocument.uri, next);
  return next;
}

function findJavaRegionAtOffset(cached: ParsedDocumentCache, jspOffset: number): JavaRegion | undefined {
  return cached.javaRegions.find((r) => jspOffset >= r.jspContentStartOffset && jspOffset < r.jspContentEndOffset);
}

function isJavaScriptletRegion(region: JavaRegion): boolean {
  return (
    region.kind === 'scriptlet-statement' ||
    region.kind === 'scriptlet-expression' ||
    region.kind === 'scriptlet-declaration'
  );
}

function getJavaImplicitObjectCompletions(): CompletionList {
  // MVP (Feature 2 Phase 0): offer JSP implicit object identifiers only.
  const implicitObjects: Array<{ name: string; detail: string }> = [
    { name: 'request', detail: 'JSP implicit object (HttpServletRequest)' },
    { name: 'response', detail: 'JSP implicit object (HttpServletResponse)' },
    { name: 'session', detail: 'JSP implicit object (HttpSession)' },
    { name: 'pageContext', detail: 'JSP implicit object (PageContext)' },
    { name: 'application', detail: 'JSP implicit object (ServletContext)' },
    { name: 'out', detail: 'JSP implicit object (JspWriter)' },
    { name: 'config', detail: 'JSP implicit object (ServletConfig)' },
    { name: 'page', detail: 'JSP implicit object (Object)' },
    { name: 'exception', detail: 'JSP implicit object (Throwable; error pages only)' },
  ];

  const items: CompletionItem[] = implicitObjects.map(({ name, detail }) => ({
    label: name,
    kind: CompletionItemKind.Variable,
    detail,
  }));

  return { isIncomplete: false, items };
}

function getLinePrefix(doc: TextDocument, position: { line: number; character: number }): string {
  return doc.getText({
    start: { line: position.line, character: 0 },
    end: position,
  });
}

function makeReplaceSuffixEdit(doc: TextDocument, position: { line: number; character: number }, replaceLen: number): Range {
  const endOffset = doc.offsetAt(position);
  const startOffset = Math.max(0, endOffset - replaceLen);
  return { start: doc.positionAt(startOffset), end: doc.positionAt(endOffset) };
}

function getJspSnippetCompletions(doc: TextDocument, position: { line: number; character: number }): CompletionItem[] {
  const prefix = getLinePrefix(doc, position);

  // Offer snippets only when the user is obviously starting a JSP construct.
  // This keeps the HTML completion list clean.
  const suffixes: Array<{ suffix: string; replaceLen: number }> = [
    { suffix: '<%=', replaceLen: 3 },
    { suffix: '<%!', replaceLen: 3 },
    { suffix: '<%@', replaceLen: 3 },
    { suffix: '<%', replaceLen: 2 },
  ];

  const hit = suffixes.find((s) => prefix.endsWith(s.suffix));
  if (!hit) {
    return [];
  }

  const replaceRange = makeReplaceSuffixEdit(doc, position, hit.replaceLen);

  const mk = (label: string, insertText: string, detail: string): CompletionItem => ({
    label,
    kind: CompletionItemKind.Snippet,
    detail,
    insertTextFormat: InsertTextFormat.Snippet,
    textEdit: { range: replaceRange, newText: insertText },
  });

  // If the user already typed a more specific sigil (<%= / <%! / <%@), prefer only matching snippets.
  if (hit.suffix === '<%=') {
    return [mk('JSP: <%= ... %> (expression)', '<%= $0 %>', 'JSP expression scriptlet')];
  }
  if (hit.suffix === '<%!') {
    return [mk('JSP: <%! ... %> (declaration)', '<%! $0 %>', 'JSP declaration scriptlet')];
  }
  if (hit.suffix === '<%@') {
    return [mk('JSP: <%@ page import="..." %>', '<%@ page import="$1" %>$0', 'JSP page import directive')];
  }

  // Generic '<%' start: offer the common variants.
  return [
    mk('JSP: <% ... %> (scriptlet)', '<% $0 %>', 'JSP statement scriptlet'),
    mk('JSP: <%= ... %> (expression)', '<%= $0 %>', 'JSP expression scriptlet'),
    mk('JSP: <%! ... %> (declaration)', '<%! $0 %>', 'JSP declaration scriptlet'),
    mk('JSP: <%@ page import="..." %>', '<%@ page import="$1" %>$0', 'JSP page import directive'),
  ];
}

function findCssRegionAtOffset(
  cached: ParsedDocumentCache,
  jspOffset: number,
): { region: CssRegion; stylesheet: Stylesheet } | undefined {
  return cached.cssRegions.find(({ region }) => jspOffset >= region.jspStartOffset && jspOffset < region.jspEndOffset);
}

function mapRangeFromCssToJsp(
  jspDocument: TextDocument,
  region: CssRegion,
  cssDocument: TextDocument,
  range: Range,
): Range {
  const startCssOffset = cssDocument.offsetAt(range.start);
  const endCssOffset = cssDocument.offsetAt(range.end);

  const startJspOffset = region.jspStartOffset + Math.max(0, startCssOffset - region.cssContentStartOffset);
  const endJspOffset = region.jspStartOffset + Math.max(0, endCssOffset - region.cssContentStartOffset);

  return {
    start: jspDocument.positionAt(startJspOffset),
    end: jspDocument.positionAt(endJspOffset),
  };
}

function mapTextEditFromCssToJsp(
  jspDocument: TextDocument,
  region: CssRegion,
  cssDocument: TextDocument,
  edit: TextEdit,
): TextEdit {
  return {
    newText: edit.newText,
    range: mapRangeFromCssToJsp(jspDocument, region, cssDocument, edit.range),
  };
}

function isInsertReplaceEdit(value: unknown): value is InsertReplaceEdit {
  return !!value && typeof value === 'object' && 'insert' in (value as any) && 'replace' in (value as any);
}

function mapCompletionListFromCssToJsp(
  jspDocument: TextDocument,
  region: CssRegion,
  cssDocument: TextDocument,
  list: CompletionList,
): CompletionList {
  const items: CompletionItem[] = list.items.map((item) => {
    const next: CompletionItem = { ...item };

    if (next.textEdit) {
      if (isInsertReplaceEdit(next.textEdit)) {
        next.textEdit = {
          newText: next.textEdit.newText,
          insert: mapRangeFromCssToJsp(jspDocument, region, cssDocument, next.textEdit.insert),
          replace: mapRangeFromCssToJsp(jspDocument, region, cssDocument, next.textEdit.replace),
        };
      } else {
        next.textEdit = mapTextEditFromCssToJsp(jspDocument, region, cssDocument, next.textEdit);
      }
    }

    if (next.additionalTextEdits?.length) {
      next.additionalTextEdits = next.additionalTextEdits.map((e) => mapTextEditFromCssToJsp(jspDocument, region, cssDocument, e));
    }

    return next;
  });

  return { ...list, items };
}

function getTaglibCompletionItems(
  jspDocument: TextDocument,
  position: { line: number; character: number },
  index: TaglibIndex | undefined,
): CompletionItem[] {
  if (!index) {
    return [];
  }

  const jspText = jspDocument.getText();
  const offset = jspDocument.offsetAt(position);

  const prefixToUri = new Map<string, string>();
  for (const d of parseTaglibDirectives(jspText)) {
    prefixToUri.set(d.prefix, d.uri);
  }

  const ctx = getStartTagContext(jspText, offset);
  if (!ctx?.prefix) {
    return [];
  }

  const uri = prefixToUri.get(ctx.prefix);
  if (!uri) {
    return [];
  }

  const taglib = index.byUri.get(uri);
  if (!taglib) {
    return [];
  }

  // Tag name completion: `<prefix:...`
  if (ctx.isInTagName) {
    const typed = ctx.localNamePrefix ?? '';
    const replaceRange: Range = {
      start: jspDocument.positionAt(Math.max(0, offset - typed.length)),
      end: position,
    };

    const items: CompletionItem[] = [];
    for (const [name, tag] of taglib.tags) {
      if (typed && !name.toLowerCase().startsWith(typed.toLowerCase())) {
        continue;
      }
      items.push({
        label: name,
        kind: CompletionItemKind.Class,
        detail: `JSP tag (${ctx.prefix})${taglib.shortName ? ` — ${taglib.shortName}` : ''}`,
        documentation: tag.description,
        textEdit: { range: replaceRange, newText: name },
      });
    }
    return items;
  }

  // Attribute completion: `<prefix:tag ...`
  if (!ctx.localName) {
    return [];
  }

  const tagDef = taglib.tags.get(ctx.localName);
  if (!tagDef) {
    return [];
  }

  const typedAttr = ctx.attributeNamePrefix ?? '';
  const replaceRange: Range = {
    start: jspDocument.positionAt(Math.max(0, offset - typedAttr.length)),
    end: position,
  };

  const items: CompletionItem[] = [];
  for (const [name, attr] of tagDef.attributes) {
    if (ctx.existingAttributes.has(name)) {
      continue;
    }
    if (typedAttr && !name.toLowerCase().startsWith(typedAttr.toLowerCase())) {
      continue;
    }

    const req = attr.required ? 'required' : 'optional';
    items.push({
      label: name,
      kind: CompletionItemKind.Property,
      detail: `Attribute (${req})${attr.type ? `: ${attr.type}` : ''}`,
      documentation: attr.description,
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { range: replaceRange, newText: `${name}="$1"$0` },
    });
  }
  return items;
}

async function validateJspDocument(jspDocument: TextDocument): Promise<void> {
  const cached = getOrCreateParsedCache(jspDocument);

  const htmlDiagnostics = validateProjectedHtml(cached.htmlDocument, cached.htmlParsed);
  const cssDiagnostics = validateCssRegions(jspDocument, cached);

  const tldIndex = await ensureTaglibIndex();
  const taglibDiagnostics = validateTaglibUsageInJsp(jspDocument, tldIndex);

  connection.sendDiagnostics({
    uri: jspDocument.uri,
    diagnostics: [...htmlDiagnostics, ...cssDiagnostics, ...taglibDiagnostics],
  });
}

function validateCssRegions(jspDocument: TextDocument, cached: ParsedDocumentCache): Diagnostic[] {
  const out: Diagnostic[] = [];

  for (const { region, stylesheet } of cached.cssRegions) {
    const cssDoc = region.cssDocument;
    const diagnostics = cssLanguageService.doValidation(cssDoc, stylesheet, { validate: true });

    const cssContentStart = region.cssContentStartOffset;
    const cssContentEnd = cssContentStart + (region.jspEndOffset - region.jspStartOffset);

    for (const d of diagnostics) {
      // Inline style attributes are wrapped as `x{...}`.
      // Filter out diagnostics that refer only to the wrapper itself.
      const startOff = cssDoc.offsetAt(d.range.start);
      const endOff = cssDoc.offsetAt(d.range.end);
      if (endOff <= cssContentStart || startOff >= cssContentEnd) {
        continue;
      }

      // Map ranges (css doc -> jsp doc). Keep message/severity.
      const mappedRange = mapRangeFromCssToJsp(jspDocument, region, cssDoc, d.range);
      out.push({
        ...d,
        range: mappedRange,
        source: d.source ?? 'jsp-lang(css)',
      });
    }
  }

  return out;
}

/**
 * Minimal, conservative HTML diagnostics.
 *
 * The upstream `vscode-html-languageservice` does not currently ship a full HTML validator.
 * For Feature 01 MVP we provide token-level errors + clearly-wrong closing tags.
 *
 * Important: the HTML doc is a same-length projection of the JSP source, so ranges map 1:1.
 */
function validateProjectedHtml(htmlDocument: TextDocument, _parsed: unknown): Diagnostic[] {
  const text = htmlDocument.getText();
  const scanner = htmlLanguageService.createScanner(text, 0);

  const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
    'param', 'source', 'track', 'wbr',
  ]);

  const openStack: string[] = [];
  let lastStartTag: string | undefined;

  const diagnostics: Diagnostic[] = [];

  while (scanner.scan() !== TokenType.EOS) {
    const tokenError = scanner.getTokenError();
    if (tokenError) {
      diagnostics.push({
        message: tokenError,
        severity: DiagnosticSeverity.Error,
        range: {
          start: htmlDocument.positionAt(scanner.getTokenOffset()),
          end: htmlDocument.positionAt(scanner.getTokenEnd()),
        },
        source: 'jsp-lang(html)',
      });
      continue;
    }

    switch (scanner.getTokenType()) {
      case TokenType.StartTag: {
        const raw = scanner.getTokenText();
        const tag = raw.toLowerCase();
        lastStartTag = tag;
        if (!voidTags.has(tag)) {
          openStack.push(tag);
        }
        break;
      }

      case TokenType.StartTagSelfClose: {
        if (lastStartTag && openStack.length > 0 && openStack[openStack.length - 1] === lastStartTag) {
          openStack.pop();
        }
        lastStartTag = undefined;
        break;
      }

      case TokenType.EndTag: {
        const raw = scanner.getTokenText();
        const tag = raw.toLowerCase();
        lastStartTag = undefined;

        // Be conservative: only flag clearly-unmatched end tags.
        const top = openStack[openStack.length - 1];
        if (top === tag) {
          openStack.pop();
          break;
        }

        // If it's somewhere in the stack, treat it as recovery (don’t produce a diagnostic).
        if (openStack.includes(tag)) {
          while (openStack.length > 0 && openStack[openStack.length - 1] !== tag) {
            openStack.pop();
          }
          if (openStack.length > 0) {
            openStack.pop();
          }
          break;
        }

        diagnostics.push({
          message: `Unexpected closing tag </${tag}>.`,
          severity: DiagnosticSeverity.Error,
          range: {
            start: htmlDocument.positionAt(scanner.getTokenOffset()),
            end: htmlDocument.positionAt(scanner.getTokenEnd()),
          },
          source: 'jsp-lang(html)',
        });
        break;
      }

      default:
        lastStartTag = undefined;
        break;
    }
  }

  return diagnostics;
}

function scheduleValidation(jspDocument: TextDocument): void {
  const uri = jspDocument.uri;
  const existing = pendingValidations.get(uri);
  if (existing) {
    clearTimeout(existing.timer);
    pendingValidations.delete(uri);
  }

  const version = jspDocument.version;
  const timer = setTimeout(() => {
    const latest = documents.get(uri);
    if (!latest || latest.version !== version) {
      return;
    }
    void validateJspDocument(latest);
  }, 250);

  pendingValidations.set(uri, { timer, version });
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const roots: string[] = [];
  const wf = params.workspaceFolders ?? [];
  for (const f of wf) {
    const p = uriToFsPath(f.uri);
    if (p) {
      roots.push(p);
    }
  }
  const rootFromRootUri = uriToFsPath(params.rootUri);
  if (rootFromRootUri && !roots.includes(rootFromRootUri)) {
    roots.push(rootFromRootUri);
  }
  workspaceRoots = roots;

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['<', ' ', ':', '/', '"', "'", '='],
      },
      hoverProvider: true,
    },
  };

  connection.console.log(`JSP language server initialized (root: ${params.rootUri ?? 'n/a'})`);
  return result;
});

connection.onInitialized(() => {
  connection.console.log('JSP language server ready');
  // Build taglib index in the background.
  void ensureTaglibIndex();
});

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>) => {
  // Clear cached parse for this version. We'll rebuild lazily on demand.
  parsedCache.delete(change.document.uri);
  scheduleValidation(change.document);
});

documents.onDidClose((close: { document: TextDocument }) => {
  const pending = pendingValidations.get(close.document.uri);
  if (pending) {
    clearTimeout(pending.timer);
    pendingValidations.delete(close.document.uri);
  }
  parsedCache.delete(close.document.uri);
  connection.sendDiagnostics({ uri: close.document.uri, diagnostics: [] });
});

connection.onCompletion(async (params: CompletionParams): Promise<CompletionList> => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return { isIncomplete: false, items: [] };
  }

  const cached = getOrCreateParsedCache(doc);
  const offset = doc.offsetAt(params.position);

  const javaHit = findJavaRegionAtOffset(cached, offset);
  if (javaHit && isJavaScriptletRegion(javaHit)) {
    return getJavaImplicitObjectCompletions();
  }

  const cssHit = findCssRegionAtOffset(cached, offset);
  if (cssHit) {
    const { region, stylesheet } = cssHit;
    const cssDoc = region.cssDocument;

    const cssOffset = region.cssContentStartOffset + Math.max(0, offset - region.jspStartOffset);
    const cssPos = cssDoc.positionAt(cssOffset);

    const list = cssLanguageService.doComplete(cssDoc, cssPos, stylesheet);
    return mapCompletionListFromCssToJsp(doc, region, cssDoc, list);
  }

  const tldIndex = await ensureTaglibIndex();
  const taglibItems = getTaglibCompletionItems(doc, params.position, tldIndex);

  const jspSnippets = getJspSnippetCompletions(doc, params.position);
  const htmlList = htmlLanguageService.doComplete(cached.htmlDocument, params.position, cached.htmlParsed as any);
  if (!jspSnippets.length) {
    return {
      ...htmlList,
      items: [...taglibItems, ...htmlList.items],
    };
  }

  return {
    ...htmlList,
    items: [...jspSnippets, ...taglibItems, ...htmlList.items],
  };
});

connection.onHover((params: HoverParams): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const cached = getOrCreateParsedCache(doc);
  const offset = doc.offsetAt(params.position);

  const cssHit = findCssRegionAtOffset(cached, offset);
  if (cssHit) {
    const { region, stylesheet } = cssHit;
    const cssDoc = region.cssDocument;
    const cssOffset = region.cssContentStartOffset + Math.max(0, offset - region.jspStartOffset);
    const cssPos = cssDoc.positionAt(cssOffset);

    const hover = cssLanguageService.doHover(cssDoc, cssPos, stylesheet);
    if (!hover) {
      return null;
    }
    return {
      ...hover,
      range: hover.range ? mapRangeFromCssToJsp(doc, region, cssDoc, hover.range) : undefined,
    };
  }

  return htmlLanguageService.doHover(cached.htmlDocument, params.position, cached.htmlParsed as any);
});

connection.listen();
