export type TaglibDirective = {
  prefix: string;
  uri: string;
  startOffset: number;
  endOffset: number;
};

function pickAttrValue(match: RegExpExecArray): string {
  // match[3] is "double quoted", match[4] is 'single quoted'
  return (match[3] ?? match[4] ?? '').trim();
}

/**
 * Parses JSP taglib directives like:
 *   <%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
 *
 * Notes:
 * - tolerant to whitespace and quote style
 * - returns directives with offsets for potential future diagnostics
 */
export function parseTaglibDirectives(jspText: string): TaglibDirective[] {
  const out: TaglibDirective[] = [];

  const re = /<%@\s*taglib\b([\s\S]*?)%>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(jspText))) {
    const full = m[0];
    const body = m[1] ?? '';
    const startOffset = m.index;
    const endOffset = startOffset + full.length;

    let prefix = '';
    let uri = '';

    const attrRe = /\b(prefix|uri)\s*=\s*("([^"]*)"|'([^']*)')/gi;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(body))) {
      const key = (a[1] ?? '').toLowerCase();
      const value = pickAttrValue(a);
      if (key === 'prefix') {
        prefix = value;
      } else if (key === 'uri') {
        uri = value;
      }
    }

    if (prefix && uri) {
      out.push({ prefix, uri, startOffset, endOffset });
    }
  }

  return out;
}
