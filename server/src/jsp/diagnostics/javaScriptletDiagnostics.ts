import type { Diagnostic } from 'vscode-languageserver';
import { DiagnosticSeverity } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import type { JavaRegion } from '../extractJavaRegions';

// java-parser is a tolerant Java 8+ grammar parser built on Chevrotain.
// We only use it for syntax errors (no type info).
import { parse } from 'java-parser';

function isScriptletRegion(region: JavaRegion): boolean {
  return (
    region.kind === 'scriptlet-statement' ||
    region.kind === 'scriptlet-expression' ||
    region.kind === 'scriptlet-declaration'
  );
}

type WrappedSource = {
  source: string;
  contentStartLine1: number; // 1-based
};

function buildWrappedJavaSource(args: {
  region: JavaRegion;
  content: string;
  imports: string[];
}): WrappedSource {
  const { region, content, imports } = args;

  const importLines = (imports ?? []).map((i) => `import ${i};`);

  if (region.kind === 'scriptlet-declaration') {
    const header = [...importLines, 'class __Jsp {'];
    const contentStartLine1 = header.length + 1;
    const footer = ['}'];
    return {
      source: [...header, content, ...footer].join('\n'),
      contentStartLine1,
    };
  }

  // statement / expression: wrap in a method.
  const header = [...importLines, 'class __Jsp {', 'void __m() {'];
  const contentStartLine1 = header.length + 1;

  let contentLine = content;
  if (region.kind === 'scriptlet-expression') {
    // Make expressions parseable as a statement.
    contentLine = `Object __jspExpr = (${content});`;
  }

  const footer = ['}', '}'];
  return {
    source: [...header, contentLine, ...footer].join('\n'),
    contentStartLine1,
  };
}

function extractChevrotainLoc(err: any):
  | { startLine: number; startColumn: number; endLine: number; endColumn: number; message: string }
  | undefined {
  // Common shapes observed from Chevrotain-based parsers.
  const message = String(err?.message ?? 'Java syntax error');

  const tok = err?.token ?? err?.previousToken ?? err?.resyncedTokens?.[0];
  if (tok && Number.isFinite(tok.startLine) && Number.isFinite(tok.startColumn)) {
    const startLine = tok.startLine;
    const startColumn = tok.startColumn;
    const endLine = Number.isFinite(tok.endLine) ? tok.endLine : startLine;
    const endColumn = Number.isFinite(tok.endColumn) ? tok.endColumn : startColumn + 1;
    return { startLine, startColumn, endLine, endColumn, message };
  }

  // Some errors expose "context" tokens.
  const ctx = err?.context?.token;
  if (ctx && Number.isFinite(ctx.startLine) && Number.isFinite(ctx.startColumn)) {
    const startLine = ctx.startLine;
    const startColumn = ctx.startColumn;
    const endLine = Number.isFinite(ctx.endLine) ? ctx.endLine : startLine;
    const endColumn = Number.isFinite(ctx.endColumn) ? ctx.endColumn : startColumn + 1;
    return { startLine, startColumn, endLine, endColumn, message };
  }

  return undefined;
}

export function validateJavaScriptletSyntax(args: {
  doc: TextDocument;
  javaRegions: JavaRegion[];
  pageImports: string[];
  severity?: DiagnosticSeverity;
}): Diagnostic[] {
  const { doc, javaRegions, pageImports } = args;
  const severity = args.severity ?? DiagnosticSeverity.Error;
  const out: Diagnostic[] = [];

  const text = doc.getText();

  for (const region of javaRegions) {
    if (!isScriptletRegion(region)) {
      continue;
    }

    const content = text.slice(region.jspContentStartOffset, region.jspContentEndOffset);
    if (!content.trim()) {
      continue;
    }

    const wrapped = buildWrappedJavaSource({ region, content, imports: pageImports });

    try {
      parse(wrapped.source);
    } catch (e: any) {
      const errors = Array.isArray(e?.errors) ? e.errors : [e];
      const jspContentPos = doc.positionAt(region.jspContentStartOffset);

      // Limit to a few diagnostics per region to avoid spam.
      for (const raw of errors.slice(0, 3)) {
        const loc = extractChevrotainLoc(raw);

        if (!loc) {
          out.push({
            message: String(raw?.message ?? 'Java syntax error in scriptlet.'),
            severity,
            range: {
              start: doc.positionAt(region.jspStartOffset),
              end: doc.positionAt(Math.min(region.jspStartOffset + 3, region.jspEndOffset)),
            },
            source: 'jsp-lang(java)',
            code: 'jsp.java.syntax',
          });
          continue;
        }

        const relStartLine = loc.startLine - wrapped.contentStartLine1;
        const relEndLine = loc.endLine - wrapped.contentStartLine1;

        const startLine = Math.max(0, jspContentPos.line + relStartLine);
        const endLine = Math.max(0, jspContentPos.line + relEndLine);

        const startChar = relStartLine === 0 ? Math.max(0, jspContentPos.character + (loc.startColumn - 1)) : Math.max(0, loc.startColumn - 1);
        const endChar = relEndLine === 0 ? Math.max(startChar + 1, jspContentPos.character + (loc.endColumn - 1)) : Math.max(loc.endColumn - 1, (loc.startColumn - 1) + 1);

        out.push({
          message: loc.message,
          severity,
          range: {
            start: { line: startLine, character: startChar },
            end: { line: endLine, character: endChar },
          },
          source: 'jsp-lang(java)',
          code: 'jsp.java.syntax',
        });
      }
    }
  }

  return out;
}
