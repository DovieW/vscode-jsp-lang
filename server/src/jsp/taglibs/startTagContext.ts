export type StartTagContext = {
  ltOffset: number;
  tagName: string;
  prefix?: string;
  localName?: string;
  /** True when cursor is still within the tag name (before whitespace). */
  isInTagName: boolean;
  /** Typed portion after `prefix:` when cursor is in tag name. */
  localNamePrefix?: string;
  /** Set of attribute names already present before the cursor. */
  existingAttributes: Set<string>;
  /** Typed portion of the current attribute name token (if any). */
  attributeNamePrefix?: string;
};

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isQuote(ch: string): boolean {
  return ch === '"' || ch === '\'';
}

function isLikelyTagNameChar(ch: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(ch);
}

function isAttributeNameChar(ch: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(ch);
}

function isCursorInsideQuotedString(text: string): boolean {
  // Very small heuristic: count unescaped quotes.
  // Good enough for our MVP (we only use it to avoid noisy attr completions).
  let q: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isQuote(ch)) {
      if (!q) {
        q = ch;
      } else if (q === ch) {
        q = undefined;
      }
    }
  }
  return !!q;
}

/**
 * Returns a best-effort context when the cursor is within an HTML/JSP start tag.
 *
 * Examples:
 *  - `<c:forEach|` => isInTagName=true, prefix=c, localNamePrefix="forEach"
 *  - `<c:forEach it|` => isInTagName=false, attributeNamePrefix="it"
 */
export function getStartTagContext(jspText: string, cursorOffset: number): StartTagContext | undefined {
  const lt = jspText.lastIndexOf('<', Math.max(0, cursorOffset - 1));
  if (lt === -1) {
    return undefined;
  }

  const gt = jspText.lastIndexOf('>', Math.max(0, cursorOffset - 1));
  if (gt > lt) {
    return undefined;
  }

  const next = jspText[lt + 1] ?? '';
  // Ignore closing tags, declarations, processing instructions, JSP blocks.
  if (next === '/' || next === '!' || next === '?' || next === '%') {
    return undefined;
  }

  // Extract the current tag slice (from '<' to cursor).
  const slice = jspText.slice(lt + 1, cursorOffset);
  if (!slice.length) {
    return undefined;
  }

  // Parse tag name.
  let i = 0;
  while (i < slice.length && isWhitespace(slice[i])) i++;
  const nameStart = i;
  while (i < slice.length && isLikelyTagNameChar(slice[i])) i++;
  const tagName = slice.slice(nameStart, i);
  if (!tagName) {
    return undefined;
  }

  const rest = slice.slice(i);
  const isInTagName = rest.length === 0;

  let prefix: string | undefined;
  let localName: string | undefined;
  let localNamePrefix: string | undefined;
  const colon = tagName.indexOf(':');
  if (colon !== -1) {
    prefix = tagName.slice(0, colon);
    localName = tagName.slice(colon + 1);
    localNamePrefix = localName;
  }

  const existingAttributes = new Set<string>();
  let attributeNamePrefix: string | undefined;

  if (!isInTagName) {
    // If we're inside quotes, don't attempt attribute completion.
    if (isCursorInsideQuotedString(rest)) {
      return {
        ltOffset: lt,
        tagName,
        prefix,
        localName,
        isInTagName,
        localNamePrefix,
        existingAttributes,
      };
    }

    // Collect attribute names already present (best-effort).
    // We look for patterns like: ` name=` or `name=`
    const attrRe = /(?:^|\s)([A-Za-z_][\w:.-]*)(?=\s*=)/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(rest))) {
      existingAttributes.add(m[1]);
    }

    // Determine currently-typed attribute name token (if any).
    let j = rest.length - 1;
    while (j >= 0 && isWhitespace(rest[j])) j--;
    // If cursor is just after '=' or within value, skip.
    if (j >= 0 && rest[j] !== '=') {
      // Walk back over name chars.
      let k = j;
      while (k >= 0 && isAttributeNameChar(rest[k])) k--;
      const token = rest.slice(k + 1, j + 1);
      if (token.length) {
        attributeNamePrefix = token;
      }
    }
  }

  return {
    ltOffset: lt,
    tagName,
    prefix,
    localName,
    isInTagName,
    localNamePrefix,
    existingAttributes,
    attributeNamePrefix,
  };
}
