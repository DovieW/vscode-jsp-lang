export type ElRegion = {
  /** Start offset of the full EL expression including delimiters (0-based). */
  jspStartOffset: number;
  /** End offset (exclusive) of the full EL expression including delimiters (0-based). */
  jspEndOffset: number;
  /** Start offset of the inner EL content (excluding `${` or `#{`). */
  jspContentStartOffset: number;
  /** End offset (exclusive) of the inner EL content (excluding `}`). */
  jspContentEndOffset: number;
};

export type ElImplicitObject = {
  name: string;
  detail: string;
  description: string;
};

export const EL_IMPLICIT_OBJECTS: ElImplicitObject[] = [
  {
    name: 'pageScope',
    detail: 'EL implicit object (page-scoped attributes)',
    description: 'Map of attributes in page scope.',
  },
  {
    name: 'requestScope',
    detail: 'EL implicit object (request-scoped attributes)',
    description: 'Map of attributes in request scope.',
  },
  {
    name: 'sessionScope',
    detail: 'EL implicit object (session-scoped attributes)',
    description: 'Map of attributes in session scope.',
  },
  {
    name: 'applicationScope',
    detail: 'EL implicit object (application-scoped attributes)',
    description: 'Map of attributes in application scope.',
  },
  {
    name: 'param',
    detail: 'EL implicit object (request parameters)',
    description: 'Map of request parameter names to single String values.',
  },
  {
    name: 'paramValues',
    detail: 'EL implicit object (request parameters)',
    description: 'Map of request parameter names to String array values.',
  },
  {
    name: 'header',
    detail: 'EL implicit object (request headers)',
    description: 'Map of request header names to single String values.',
  },
  {
    name: 'headerValues',
    detail: 'EL implicit object (request headers)',
    description: 'Map of request header names to String array values.',
  },
  {
    name: 'cookie',
    detail: 'EL implicit object (cookies)',
    description: 'Map of cookie names to Cookie objects.',
  },
  {
    name: 'initParam',
    detail: 'EL implicit object (context init params)',
    description: 'Map of context initialization parameters.',
  },
];

function findNextElStart(source: string, fromIndex: number): number {
  const idxDollar = source.indexOf('${', fromIndex);
  const idxHash = source.indexOf('#{', fromIndex);

  if (idxDollar === -1 && idxHash === -1) {
    return -1;
  }
  if (idxDollar === -1) {
    return idxHash;
  }
  if (idxHash === -1) {
    return idxDollar;
  }
  return Math.min(idxDollar, idxHash);
}

export function extractElRegionsFromJsp(source: string): ElRegion[] {
  const regions: ElRegion[] = [];

  let i = 0;
  while (true) {
    const start = findNextElStart(source, i);
    if (start === -1) {
      break;
    }

    const endBrace = source.indexOf('}', start + 2);
    const jspStartOffset = start;
    const jspEndOffset = endBrace === -1 ? source.length : endBrace + 1;

    const jspContentStartOffset = Math.min(jspEndOffset, jspStartOffset + 2);
    const jspContentEndOffset = Math.max(jspContentStartOffset, jspEndOffset - 1);

    regions.push({
      jspStartOffset,
      jspEndOffset,
      jspContentStartOffset,
      jspContentEndOffset,
    });

    i = Math.max(jspStartOffset + 2, jspEndOffset);
  }

  return regions;
}

function findElRegionAtOffset(regions: ElRegion[], offset: number): ElRegion | undefined {
  return regions.find((r) => offset >= r.jspContentStartOffset && offset <= r.jspContentEndOffset);
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_]/.test(ch);
}

export function findElIdentifierAtOffset(
  source: string,
  regions: ElRegion[],
  offset: number,
): { name: string; startOffset: number; endOffset: number } | undefined {
  const region = findElRegionAtOffset(regions, offset);
  if (!region) {
    return undefined;
  }

  const contentStart = region.jspContentStartOffset;
  const contentEnd = region.jspContentEndOffset;
  if (offset < contentStart || offset > contentEnd) {
    return undefined;
  }

  const charAt = source[offset];
  const charBefore = offset > 0 ? source[offset - 1] : undefined;

  if (!isWordChar(charAt) && !isWordChar(charBefore)) {
    return undefined;
  }

  if (!isWordChar(charAt) && isWordChar(charBefore)) {
    if (!charAt || /\s|[)}\]]/.test(charAt)) {
      // ok: cursor is right after an identifier
    } else {
      return undefined;
    }
  }

  let start = isWordChar(charAt) ? offset : Math.max(contentStart, offset - 1);
  while (start > contentStart && isWordChar(source[start - 1])) {
    start -= 1;
  }

  let end = start;
  while (end < contentEnd && isWordChar(source[end])) {
    end += 1;
  }

  const name = source.slice(start, end);
  if (!/^[A-Za-z_]/.test(name)) {
    return undefined;
  }

  return { name, startOffset: start, endOffset: end };
}

export function isElIdentifierContext(source: string, regions: ElRegion[], offset: number): boolean {
  return !!findElIdentifierAtOffset(source, regions, offset);
}
