import {
  type CompletionList,
  type CompletionParams,
  type CompletionItem,
  CompletionItemKind,
  DidChangeWatchedFilesNotification,
  type Diagnostic,
  DiagnosticSeverity,
  type DocumentSymbol,
  type Hover,
  type HoverParams,
  type InitializeParams,
  type InitializeResult,
  InsertTextFormat,
  type Location,
  MarkupKind,
  type InsertReplaceEdit,
  type Range,
  type ReferenceParams,
  type RenameParams,
  type SymbolInformation,
  SymbolKind,
  type TextDocumentChangeEvent,
  TextDocumentSyncKind,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
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
import {
  buildPrefixRenameEdits,
  findIncludePathAtOffset,
  findTaglibDefinitionLocation,
  findTaglibDirectivePrefixValueAtOffset,
  scanTagUsagesInWorkspace,
  scanTagPrefixUsagesInText,
} from './jsp/navigation/taglibNavigation';

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

type TaglibsConfig = {
  tldGlobs?: string[];
  enableJarScanning?: boolean;
  jarGlobs?: string[];
};

let taglibsConfig: TaglibsConfig = {};

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
    taglibIndexBuild = buildTaglibIndex({
      roots: workspaceRoots,
      tldGlobs: taglibsConfig.tldGlobs,
      enableJarScanning: taglibsConfig.enableJarScanning,
      jarGlobs: taglibsConfig.jarGlobs,
    })
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

  const ltOffset = ctx.ltOffset;

  const uri = prefixToUri.get(ctx.prefix);
  if (!uri) {
    return [];
  }

  const taglib = index.byUri.get(uri);
  if (!taglib) {
    return [];
  }

  function getAttributeValueContext(): { attrName: string; valuePrefix: string; replaceRange: Range } | undefined {
    // Try to detect `<prefix:tag attr="...|"` situations.
    // We'll match the LAST attribute assignment before the cursor where the quote is not closed yet.
    const tagEnd = jspText.indexOf('>', ltOffset);
    if (tagEnd === -1 || offset > tagEnd) {
      return undefined;
    }

    const beforeCursor = jspText.slice(ltOffset, offset);
    // Example match groups:
    //  1: attribute name
    //  2: quote
    //  3: current value prefix (may be empty)
    const m = /(?:\s|^)([A-Za-z_][\w:.-]*)\s*=\s*(["'])([^"']*)$/.exec(beforeCursor);
    if (!m) {
      return undefined;
    }

    const attrName = m[1];
    const valuePrefix = m[3] ?? '';
    const replaceRange: Range = {
      start: jspDocument.positionAt(Math.max(0, offset - valuePrefix.length)),
      end: position,
    };

    return { attrName, valuePrefix, replaceRange };
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

  // Attribute *value* completion (e.g. boolean `true|false`).
  // Note: this is intentionally conservative; we only complete inside quotes.
  const valueCtx = getAttributeValueContext();
  if (valueCtx) {
    const attrDef = tagDef.attributes.get(valueCtx.attrName);
    if (!attrDef) {
      return [];
    }

    const t = (attrDef.type ?? '').toLowerCase();
    if (t === 'boolean' || t === 'java.lang.boolean') {
      const items: CompletionItem[] = ['true', 'false']
        .filter((v) => !valueCtx.valuePrefix || v.startsWith(valueCtx.valuePrefix.toLowerCase()))
        .map((v) => ({
          label: v,
          kind: CompletionItemKind.Value,
          detail: 'boolean',
          textEdit: { range: valueCtx.replaceRange, newText: v },
        }));
      return items;
    }

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

function getTaglibHover(
  jspDocument: TextDocument,
  position: { line: number; character: number },
  index: TaglibIndex | undefined,
): Hover | null {
  if (!index) {
    return null;
  }

  const jspText = jspDocument.getText();
  const offset = jspDocument.offsetAt(position);

  // Must be within a tag.
  const lt = jspText.lastIndexOf('<', Math.max(0, offset));
  if (lt === -1) {
    return null;
  }
  const gtBefore = jspText.lastIndexOf('>', Math.max(0, offset));
  if (gtBefore > lt) {
    return null;
  }
  const tagEnd = jspText.indexOf('>', lt);
  if (tagEnd === -1 || offset > tagEnd) {
    return null;
  }

  // Skip JSP blocks like `<% ... %>` and processing instructions.
  const next = jspText[lt + 1] ?? '';
  if (next === '%' || next === '!' || next === '?') {
    return null;
  }

  // Parse tag name (supports both start and end tags).
  let i = lt + 1;
  while (i < jspText.length && /\s/.test(jspText[i] ?? '')) i++;
  if (jspText[i] === '/') {
    i++;
    while (i < jspText.length && /\s/.test(jspText[i] ?? '')) i++;
  }
  const nameStart = i;
  while (i < jspText.length && /[A-Za-z0-9_.:-]/.test(jspText[i] ?? '')) i++;
  const nameEnd = i;
  const fullName = jspText.slice(nameStart, nameEnd);
  if (!fullName.includes(':')) {
    return null;
  }

  const colon = fullName.indexOf(':');
  const prefix = fullName.slice(0, colon);
  const localName = fullName.slice(colon + 1);

  const prefixToUri = new Map<string, string>();
  for (const d of parseTaglibDirectives(jspText)) {
    prefixToUri.set(d.prefix, d.uri);
  }

  const uri = prefixToUri.get(prefix);
  if (!uri) {
    return null;
  }
  const taglib = index.byUri.get(uri);
  if (!taglib) {
    return null;
  }
  const tagDef = taglib.tags.get(localName);
  if (!tagDef) {
    return null;
  }

  // Hovering tag name?
  if (offset >= nameStart && offset <= nameEnd) {
    const md = [
      `**<${prefix}:${localName}>**`,
      taglib.uri ? `\n\nURI: \`${taglib.uri}\`` : '',
      tagDef.description ? `\n\n${tagDef.description}` : '',
    ].join('');
    return {
      contents: { kind: MarkupKind.Markdown, value: md },
      range: { start: jspDocument.positionAt(nameStart), end: jspDocument.positionAt(nameEnd) },
    };
  }

  // Hovering an attribute name?
  const between = jspText.slice(nameEnd, tagEnd);
  const rel = offset - nameEnd;
  if (rel < 0 || rel > between.length) {
    return null;
  }

  const attrRe = /(?:^|\s)([A-Za-z_][\w:.-]*)(?=\s*=)/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(between))) {
    const attrName = m[1];
    const attrStartRel = m.index + (m[0].length - attrName.length);
    const attrEndRel = attrStartRel + attrName.length;

    if (rel >= attrStartRel && rel <= attrEndRel) {
      const attrDef = tagDef.attributes.get(attrName);
      if (!attrDef) {
        return null;
      }

      const bits: string[] = [`**${attrName}**`];
      if (attrDef.type) bits.push(`\n\nType: \`${attrDef.type}\``);
      if (attrDef.required != null) bits.push(`\n\nRequired: ${attrDef.required ? 'yes' : 'no'}`);
      if (attrDef.description) bits.push(`\n\n${attrDef.description}`);

      const start = nameEnd + attrStartRel;
      const end = nameEnd + attrEndRel;
      return {
        contents: { kind: MarkupKind.Markdown, value: bits.join('') },
        range: { start: jspDocument.positionAt(start), end: jspDocument.positionAt(end) },
      };
    }
  }

  return null;
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

  // Optional extension-provided config.
  // We keep this best-effort so the server can still run without any init options.
  const init = (params.initializationOptions ?? {}) as any;
  const cfg = init?.taglibs;
  if (cfg && typeof cfg === 'object') {
    taglibsConfig = {
      tldGlobs: Array.isArray(cfg.tldGlobs) ? cfg.tldGlobs.filter((x: any) => typeof x === 'string') : undefined,
      enableJarScanning: typeof cfg.enableJarScanning === 'boolean' ? cfg.enableJarScanning : undefined,
      jarGlobs: Array.isArray(cfg.jarGlobs) ? cfg.jarGlobs.filter((x: any) => typeof x === 'string') : undefined,
    };
  }

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['<', ' ', ':', '/', '"', "'", '='],
      },
      hoverProvider: true,
      // Feature 05 (Milestone 1–2, taglib/navigation MVP)
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: true,
      documentSymbolProvider: true,
    },
  };

  connection.console.log(`JSP language server initialized (root: ${params.rootUri ?? 'n/a'})`);
  return result;
});

// Custom notification from the VS Code extension when jsp.taglibs.* settings change.
connection.onNotification('jsp/taglibsConfig', (cfg: any) => {
  taglibsConfig = {
    tldGlobs: Array.isArray(cfg?.tldGlobs) ? cfg.tldGlobs.filter((x: any) => typeof x === 'string') : undefined,
    enableJarScanning: typeof cfg?.enableJarScanning === 'boolean' ? cfg.enableJarScanning : undefined,
    jarGlobs: Array.isArray(cfg?.jarGlobs) ? cfg.jarGlobs.filter((x: any) => typeof x === 'string') : undefined,
  };

  taglibIndex = undefined;
  // Revalidate open docs so completions/diagnostics update quickly.
  for (const d of documents.all()) {
    scheduleValidation(d);
  }
});

function getTaglibNameAndAttrAtOffset(
  jspText: string,
  offset: number,
):
  | {
      nameStart: number;
      nameEnd: number;
      prefix: string;
      localName: string;
      attrNameAtCursor?: { name: string; start: number; end: number };
    }
  | undefined {
  // Must be within a tag.
  const lt = jspText.lastIndexOf('<', Math.max(0, offset));
  if (lt === -1) return undefined;
  const gtBefore = jspText.lastIndexOf('>', Math.max(0, offset));
  if (gtBefore > lt) return undefined;
  const tagEnd = jspText.indexOf('>', lt);
  if (tagEnd === -1 || offset > tagEnd) return undefined;

  // Skip JSP blocks like `<% ... %>` and processing instructions.
  const next = jspText[lt + 1] ?? '';
  if (next === '%' || next === '!' || next === '?') return undefined;

  // Parse tag name.
  let i = lt + 1;
  while (i < jspText.length && /\s/.test(jspText[i] ?? '')) i++;
  if (jspText[i] === '/') {
    i++;
    while (i < jspText.length && /\s/.test(jspText[i] ?? '')) i++;
  }
  const nameStart = i;
  while (i < jspText.length && /[A-Za-z0-9_.:-]/.test(jspText[i] ?? '')) i++;
  const nameEnd = i;
  const fullName = jspText.slice(nameStart, nameEnd);
  const colon = fullName.indexOf(':');
  if (colon === -1) return undefined;

  const prefix = fullName.slice(0, colon);
  const localName = fullName.slice(colon + 1);

  // Attribute under cursor?
  const between = jspText.slice(nameEnd, tagEnd);
  const rel = offset - nameEnd;
  let attrNameAtCursor: { name: string; start: number; end: number } | undefined;
  if (rel >= 0 && rel <= between.length) {
    const attrRe = /(?:^|\s)([A-Za-z_][\w:.-]*)(?=\s*=)/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(between))) {
      const attrName = m[1];
      const attrStartRel = m.index + (m[0].length - attrName.length);
      const attrEndRel = attrStartRel + attrName.length;
      if (rel >= attrStartRel && rel <= attrEndRel) {
        const start = nameEnd + attrStartRel;
        const end = nameEnd + attrEndRel;
        attrNameAtCursor = { name: attrName, start, end };
        break;
      }
    }
  }

  return { nameStart, nameEnd, prefix, localName, attrNameAtCursor };
}

function parseTaglibPrefixToUri(jspText: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of parseTaglibDirectives(jspText)) {
    m.set(d.prefix, d.uri);
  }
  return m;
}

function resolveIncludeTargetToFileUri(doc: TextDocument, includePath: string): string | undefined {
  const docFsPath = uriToFsPath(doc.uri);
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
        return pathToFileURL(candidate).toString();
      }
    }

    // Fallback: treat as relative to the current file's directory.
    const fallback = path.join(docDir, rel);
    if (fsSync.existsSync(fallback)) {
      return pathToFileURL(fallback).toString();
    }

    return undefined;
  }

  const candidate = path.resolve(docDir, includePath);
  if (fsSync.existsSync(candidate)) {
    return pathToFileURL(candidate).toString();
  }

  return undefined;
}

function buildDirectiveSymbols(doc: TextDocument): DocumentSymbol[] {
  const text = doc.getText();
  const symbols: DocumentSymbol[] = [];
  const re = /<%@\s*(page|include|taglib)\b([\s\S]*?)%>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const kind = (m[1] ?? '').toLowerCase();
    const body = m[2] ?? '';
    const startOffset = m.index;
    const endOffset = m.index + m[0].length;

    let name = `@${kind}`;
    if (kind === 'taglib') {
      const pm = /\bprefix\s*=\s*(["'])([^"']+)\1/i.exec(body);
      const um = /\buri\s*=\s*(["'])([^"']+)\1/i.exec(body);
      const prefix = pm?.[2];
      const uri = um?.[2];
      if (prefix && uri) name = `@taglib ${prefix} → ${uri}`;
      else if (prefix) name = `@taglib ${prefix}`;
    }
    if (kind === 'include') {
      const fm = /\bfile\s*=\s*(["'])([^"']+)\1/i.exec(body);
      const file = fm?.[2];
      if (file) name = `@include ${file}`;
    }

    symbols.push({
      name,
      kind: SymbolKind.Namespace,
      range: { start: doc.positionAt(startOffset), end: doc.positionAt(endOffset) },
      selectionRange: { start: doc.positionAt(startOffset), end: doc.positionAt(endOffset) },
      children: [],
    });
  }
  return symbols;
}

connection.onDefinition(async (params): Promise<Location | Location[] | null> => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const jspText = doc.getText();
  const offset = doc.offsetAt(params.position);

  // 1) Taglib navigation: <prefix:tag> and known attributes.
  const hit = getTaglibNameAndAttrAtOffset(jspText, offset);
  if (hit) {
    const tldIndex = await ensureTaglibIndex();
    if (!tldIndex) {
      return null;
    }

    const prefixToUri = parseTaglibPrefixToUri(jspText);
    const uri = prefixToUri.get(hit.prefix);
    if (!uri) {
      return null;
    }

    const taglib = tldIndex.byUri.get(uri);
    if (!taglib) {
      return null;
    }

    const loc = findTaglibDefinitionLocation({
      tldFilePath: taglib.source,
      tagName: hit.localName,
      attributeName: hit.attrNameAtCursor?.name,
    });

    return loc ? (loc as Location) : null;
  }

  // 2) Include navigation: <%@ include file="..." %> and <jsp:include page="..." />
  const includeHit = findIncludePathAtOffset(jspText, offset);
  if (includeHit) {
    const targetUri = resolveIncludeTargetToFileUri(doc, includeHit.path);
    if (targetUri) {
      return {
        uri: targetUri,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      };
    }
  }

  return null;
});

connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }

  const jspText = doc.getText();
  const offset = doc.offsetAt(params.position);
  const hit = getTaglibNameAndAttrAtOffset(jspText, offset);
  if (hit) {
    // Best-effort: treat references as "all occurrences of this <prefix:tag> in the workspace".
    const refs = await scanTagUsagesInWorkspace({
      roots: workspaceRoots,
      prefix: hit.prefix,
      tagName: hit.localName,
      maxFiles: 5_000,
    });

    return refs as unknown as Location[];
  }

  // File-local references: when invoked on the taglib directive prefix value.
  const dirHit = findTaglibDirectivePrefixValueAtOffset(jspText, offset);
  if (!dirHit) {
    return [];
  }

  const spans = scanTagPrefixUsagesInText(jspText, dirHit.prefix);
  const out: Location[] = spans.map((s) => ({
    uri: doc.uri,
    range: { start: doc.positionAt(s.startOffset), end: doc.positionAt(s.endOffset) },
  }));

  if (params.context?.includeDeclaration) {
    out.unshift({
      uri: doc.uri,
      range: { start: doc.positionAt(dirHit.startOffset), end: doc.positionAt(dirHit.endOffset) },
    });
  }

  return out;
});

connection.onRenameRequest(async (params: RenameParams): Promise<WorkspaceEdit | null> => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const newName = params.newName?.trim();
  if (!newName) {
    return null;
  }

  const jspText = doc.getText();
  const offset = doc.offsetAt(params.position);

  // For now: only support renaming taglib prefixes file-locally.
  // We allow triggering rename either on <prefix:tag> usage OR on the directive prefix value itself.
  let oldPrefix: string | undefined;

  const hit = getTaglibNameAndAttrAtOffset(jspText, offset);
  if (hit) {
    oldPrefix = hit.prefix;
  } else {
    const dirHit = findTaglibDirectivePrefixValueAtOffset(jspText, offset);
    if (dirHit) {
      oldPrefix = dirHit.prefix;
    }
  }

  if (!oldPrefix) {
    return null;
  }

  // Require that the prefix is actually declared in this document.
  const prefixToUri = parseTaglibPrefixToUri(jspText);
  if (!prefixToUri.has(oldPrefix)) {
    return null;
  }

  const edits = buildPrefixRenameEdits(doc, oldPrefix, newName);
  if (!edits.length) {
    return null;
  }

  return {
    changes: {
      [doc.uri]: edits,
    },
  };
});

connection.onDocumentSymbol((params): Array<DocumentSymbol> | Array<SymbolInformation> => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }
  return buildDirectiveSymbols(doc);
});

connection.onInitialized(() => {
  connection.console.log('JSP language server ready');
  // Build taglib index in the background.
  void ensureTaglibIndex();

  // Watch for .tld file changes so taglib completions/diagnostics update without reload.
  // VS Code supports dynamic registration for file watching.
  void connection.client
    .register(DidChangeWatchedFilesNotification.type, {
      watchers: [{ globPattern: '**/*.tld' }],
    })
    .then(() => {
      connection.console.log('Registered .tld file watcher');
    })
    .catch((err) => {
      // Non-fatal: the server will still periodically rebuild the taglib index.
      connection.console.warn(`Failed to register .tld watcher: ${String(err)}`);
    });
});

connection.onDidChangeWatchedFiles((params) => {
  const hasTldChange = params.changes.some((c) => c.uri.toLowerCase().endsWith('.tld'));
  if (!hasTldChange) {
    return;
  }

  // Invalidate and rebuild lazily.
  taglibIndex = undefined;

  // Kick diagnostics refresh for currently-open docs so users see updates immediately.
  for (const d of documents.all()) {
    scheduleValidation(d);
  }
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

connection.onHover(async (params: HoverParams): Promise<Hover | null> => {
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

  const tldIndex = await ensureTaglibIndex();
  const taglibHover = getTaglibHover(doc, params.position, tldIndex);
  if (taglibHover) {
    return taglibHover;
  }

  return htmlLanguageService.doHover(cached.htmlDocument, params.position, cached.htmlParsed as any);
});

connection.listen();
