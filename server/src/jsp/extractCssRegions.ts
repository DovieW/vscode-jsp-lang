import { TextDocument } from 'vscode-languageserver-textdocument';
import { getLanguageService as getHtmlLanguageService, TokenType } from 'vscode-html-languageservice';

export type CssRegionKind = 'style-block' | 'inline-style-attr';

export type CssRegion = {
  kind: CssRegionKind;
  /** Start offset in the original JSP document (0-based). */
  jspStartOffset: number;
  /** End offset (exclusive) in the original JSP document (0-based). */
  jspEndOffset: number;
  /** CSS document used for language service operations. */
  cssDocument: TextDocument;
  /** Offset in cssDocument where the original content starts (0 for style blocks). */
  cssContentStartOffset: number;
};

const htmlLanguageService = getHtmlLanguageService();

function isQuote(ch: string | undefined): ch is '"' | "'" {
  return ch === '"' || ch === "'";
}

/**
 * Extract CSS regions from a *projected HTML* document.
 *
 * Notes:
 * - Offsets of the projection are assumed to match the JSP source 1:1.
 * - Inline style attributes are wrapped as `x{...}` to enable property/value completions.
 */
export function extractCssRegionsFromProjectedHtml(htmlDocument: TextDocument): CssRegion[] {
  const text = htmlDocument.getText();
  const scanner = htmlLanguageService.createScanner(text, 0);

  const regions: CssRegion[] = [];

  let lastAttrName: string | undefined;

  while (scanner.scan() !== TokenType.EOS) {
    switch (scanner.getTokenType()) {
      case TokenType.AttributeName: {
        lastAttrName = scanner.getTokenText().toLowerCase();
        break;
      }

      case TokenType.AttributeValue: {
        if (lastAttrName !== 'style') {
          break;
        }

        const raw = scanner.getTokenText();
        const start = scanner.getTokenOffset();
        const end = scanner.getTokenEnd();

        // The scanner includes quotes in AttributeValue.
        // Example: "color:red" or 'color:red'
        const first = raw[0];
        const last = raw[raw.length - 1];
        let contentStart = start;
        let contentEnd = end;
        if (isQuote(first) && last === first && raw.length >= 2) {
          contentStart = start + 1;
          contentEnd = end - 1;
        }

        if (contentEnd <= contentStart) {
          break;
        }

        const cssContent = text.slice(contentStart, contentEnd);

        const prefix = 'x{' ;
        const suffix = '}';
        const cssText = `${prefix}${cssContent}${suffix}`;
        const cssDocument = TextDocument.create(
          `${htmlDocument.uri}#inline-style@${contentStart}`,
          'css',
          htmlDocument.version,
          cssText,
        );

        regions.push({
          kind: 'inline-style-attr',
          jspStartOffset: contentStart,
          jspEndOffset: contentEnd,
          cssDocument,
          cssContentStartOffset: prefix.length,
        });

        break;
      }

      case TokenType.Styles: {
        const contentStart = scanner.getTokenOffset();
        const contentEnd = scanner.getTokenEnd();
        if (contentEnd <= contentStart) {
          break;
        }

        const cssContent = text.slice(contentStart, contentEnd);
        const cssDocument = TextDocument.create(
          `${htmlDocument.uri}#style@${contentStart}`,
          'css',
          htmlDocument.version,
          cssContent,
        );

        regions.push({
          kind: 'style-block',
          jspStartOffset: contentStart,
          jspEndOffset: contentEnd,
          cssDocument,
          cssContentStartOffset: 0,
        });
        break;
      }

      default:
        break;
    }
  }

  return regions;
}
