export type JavaRegionKind =
  | 'scriptlet-statement'
  | 'scriptlet-expression'
  | 'scriptlet-declaration'
  | 'directive'
  | 'directive-page-import';

export type JavaRegion = {
  kind: JavaRegionKind;

  /** Start offset of the full JSP block, including delimiters (0-based). */
  jspStartOffset: number;

  /** End offset (exclusive) of the full JSP block, including delimiters (0-based). */
  jspEndOffset: number;

  /** Start offset of the inner content (excluding `<%`, `%>` etc). */
  jspContentStartOffset: number;

  /** End offset (exclusive) of the inner content (excluding `<%`, `%>` etc). */
  jspContentEndOffset: number;

  /** For `<%@ page import="..." %>` directives. */
  imports?: string[];
};

export type ExtractedJavaRegions = {
  regions: JavaRegion[];
  /** Aggregated imports extracted from `<%@ page import="..." %>` directives. */
  pageImports: string[];
};

type JspBlockDelimiters = {
  start: number;
  endExclusive: number;
  kind: 'comment' | 'code';
};

function findNextJspBlock(source: string, fromIndex: number): JspBlockDelimiters | undefined {
  const start = source.indexOf('<%', fromIndex);
  if (start === -1) {
    return undefined;
  }

  // JSP comment: <%-- ... --%>
  if (source.startsWith('<%--', start)) {
    const end = source.indexOf('--%>', start + 4);
    if (end === -1) {
      return { start, endExclusive: source.length, kind: 'comment' };
    }
    return { start, endExclusive: end + 4, kind: 'comment' };
  }

  // Everything else: <% ... %>
  const end = source.indexOf('%>', start + 2);
  if (end === -1) {
    return { start, endExclusive: source.length, kind: 'code' };
  }
  return { start, endExclusive: end + 2, kind: 'code' };
}

function extractPageImportList(directiveBody: string): string[] {
  // Very small, forgiving parser for e.g.
  //   page import="java.util.List, java.time.Instant"
  // Attribute ordering is ignored.
  const m = directiveBody.match(/\bpage\b[\s\S]*/i);
  if (!m) {
    return [];
  }

  const pageBody = m[0];
  const attr = pageBody.match(/\bimport\b\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!attr) {
    return [];
  }

  const raw = (attr[2] ?? attr[3] ?? '').trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function extractJavaRegionsFromJsp(source: string): ExtractedJavaRegions {
  const regions: JavaRegion[] = [];
  const pageImports: string[] = [];

  let i = 0;
  while (true) {
    const block = findNextJspBlock(source, i);
    if (!block) {
      break;
    }

    // Ignore JSP comments entirely for Feature 2.
    if (block.kind === 'comment') {
      i = block.start + 2;
      continue;
    }

    const jspStartOffset = block.start;
    const jspEndOffset = block.endExclusive;

    const sigil = source[jspStartOffset + 2];
    const isExpr = sigil === '=';
    const isDecl = sigil === '!';
    const isDirective = sigil === '@';

    const kind: JavaRegionKind = isExpr
      ? 'scriptlet-expression'
      : isDecl
        ? 'scriptlet-declaration'
        : isDirective
          ? 'directive'
          : 'scriptlet-statement';

    const jspContentStartOffset = Math.min(
      jspEndOffset,
      jspStartOffset + 2 + (isExpr || isDecl || isDirective ? 1 : 0),
    );
    const jspContentEndOffset = Math.max(jspContentStartOffset, jspEndOffset - 2);

    const region: JavaRegion = {
      kind,
      jspStartOffset,
      jspEndOffset,
      jspContentStartOffset,
      jspContentEndOffset,
    };

    if (isDirective) {
      const body = source.slice(jspContentStartOffset, jspContentEndOffset);
      const imports = extractPageImportList(body);
      if (imports.length) {
        region.kind = 'directive-page-import';
        region.imports = imports;
        pageImports.push(...imports);
      }
    }

    regions.push(region);
    i = jspStartOffset + 2;
  }

  return { regions, pageImports };
}
