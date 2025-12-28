import {
  type CompletionList,
  type CompletionParams,
  type CompletionItem,
  type Diagnostic,
  DiagnosticSeverity,
  type Hover,
  type HoverParams,
  type InitializeParams,
  type InitializeResult,
  type InsertReplaceEdit,
  type Range,
  type TextDocumentChangeEvent,
  TextDocumentSyncKind,
  type TextEdit,
} from 'vscode-languageserver';
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

type ParsedDocumentCache = {
  version: number;
  htmlDocument: TextDocument;
  htmlParsed: unknown;
  cssRegions: Array<{ region: CssRegion; stylesheet: Stylesheet }>;
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
  };
  parsedCache.set(jspDocument.uri, next);
  return next;
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

function validateJspDocument(jspDocument: TextDocument): void {
  const cached = getOrCreateParsedCache(jspDocument);

  const htmlDiagnostics = validateProjectedHtml(cached.htmlDocument, cached.htmlParsed);
  const cssDiagnostics = validateCssRegions(jspDocument, cached);

  connection.sendDiagnostics({ uri: jspDocument.uri, diagnostics: [...htmlDiagnostics, ...cssDiagnostics] });
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
    validateJspDocument(latest);
  }, 250);

  pendingValidations.set(uri, { timer, version });
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
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

connection.onCompletion((params: CompletionParams): CompletionList => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return { isIncomplete: false, items: [] };
  }

  const cached = getOrCreateParsedCache(doc);
  const offset = doc.offsetAt(params.position);

  const cssHit = findCssRegionAtOffset(cached, offset);
  if (cssHit) {
    const { region, stylesheet } = cssHit;
    const cssDoc = region.cssDocument;

    const cssOffset = region.cssContentStartOffset + Math.max(0, offset - region.jspStartOffset);
    const cssPos = cssDoc.positionAt(cssOffset);

    const list = cssLanguageService.doComplete(cssDoc, cssPos, stylesheet);
    return mapCompletionListFromCssToJsp(doc, region, cssDoc, list);
  }

  return htmlLanguageService.doComplete(cached.htmlDocument, params.position, cached.htmlParsed as any);
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
