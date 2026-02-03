type JspBlockDelimiters = {
  start: number;
  endExclusive: number;
};

function replaceWithSpaces(input: string, start: number, endExclusive: number): string {
  if (start < 0 || endExclusive <= start) {
    return input;
  }
  return input.slice(0, start) + ' '.repeat(endExclusive - start) + input.slice(endExclusive);
}

function findJspBlock(source: string, fromIndex: number): JspBlockDelimiters | undefined {
  const start = source.indexOf('<%', fromIndex);
  if (start === -1) {
    return undefined;
  }

  // JSP comment: <%-- ... --%>
  if (source.startsWith('<%--', start)) {
    const end = source.indexOf('--%>', start + 4);
    if (end === -1) {
      return { start, endExclusive: source.length };
    }
    return { start, endExclusive: end + 4 };
  }

  // Everything else: <% ... %>
  const end = source.indexOf('%>', start + 2);
  if (end === -1) {
    return { start, endExclusive: source.length };
  }
  return { start, endExclusive: end + 2 };
}

function maskExpression(source: string, fromIndex: number): { start: number; endExclusive: number } | undefined {
  const idxDollar = source.indexOf('${', fromIndex);
  const idxHash = source.indexOf('#{', fromIndex);
  let start = -1;
  if (idxDollar !== -1 && idxHash !== -1) {
    start = Math.min(idxDollar, idxHash);
  } else {
    start = idxDollar !== -1 ? idxDollar : idxHash;
  }

  if (start === -1) {
    return undefined;
  }

  // Very simple: find the first closing brace.
  const endBrace = source.indexOf('}', start + 2);
  if (endBrace === -1) {
    return { start, endExclusive: source.length };
  }

  return { start, endExclusive: endBrace + 1 };
}

/**
 * Produces a projected HTML string from JSP source by masking JSP constructs with whitespace.
 *
 * Important property: projected output has the exact same length as the input.
 */
export function maskJspToHtml(source: string): string {
  let out = source;

  // 1) Mask <% ... %> blocks (directives/scriptlets/comments) entirely.
  let i = 0;
  while (true) {
    const block = findJspBlock(out, i);
    if (!block) {
      break;
    }
    out = replaceWithSpaces(out, block.start, block.endExclusive);
    i = block.start + 1;
  }

  // 2) Mask ${...} / #{...} expressions entirely to avoid HTML/CSS diagnostics noise.
  i = 0;
  while (true) {
    const expr = maskExpression(out, i);
    if (!expr) {
      break;
    }

    out = replaceWithSpaces(out, expr.start, expr.endExclusive);

    i = Math.max(expr.start + 2, expr.endExclusive);
  }

  return out;
}
