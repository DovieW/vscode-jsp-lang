import { XMLParser } from 'fast-xml-parser';

import type { Taglib, TaglibAttribute, TaglibTag } from './types';

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length ? t : undefined;
  }
  // Some XML parsers can return objects like { '#text': '...' }
  if (typeof value === 'object' && value && '#text' in (value as any)) {
    const t = String((value as any)['#text']).trim();
    return t.length ? t : undefined;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (value == null) {
    return undefined;
  }
  const s = String(value).trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return undefined;
}

/**
 * Parses a Tag Library Descriptor (.tld) XML into a lightweight in-memory model.
 *
 * We intentionally do NOT do schema validation here; the goal is tolerant parsing.
 */
export function parseTldXml(xml: string, source: string): Taglib {
  const parser = new XMLParser({
    ignoreAttributes: true,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
    allowBooleanAttributes: true,
  });

  const parsed = parser.parse(xml);
  const root = (parsed?.taglib ?? parsed?.['jsp:taglib'] ?? parsed) as any;

  const tags = new Map<string, TaglibTag>();

  for (const t of asArray<any>(root?.tag)) {
    const name = textValue(t?.name);
    if (!name) {
      continue;
    }

    const attributes = new Map<string, TaglibAttribute>();
    for (const a of asArray<any>(t?.attribute)) {
      const attrName = textValue(a?.name);
      if (!attrName) {
        continue;
      }
      const attr: TaglibAttribute = {
        name: attrName,
        required: toBoolean(a?.required),
        rtexprvalue: toBoolean(a?.rtexprvalue),
        type: textValue(a?.type),
        description: textValue(a?.description),
      };
      attributes.set(attrName, attr);
    }

    const tag: TaglibTag = {
      name,
      description: textValue(t?.description),
      attributes,
    };
    tags.set(name, tag);
  }

  const taglib: Taglib = {
    source,
    uri: textValue(root?.uri),
    shortName: textValue(root?.['short-name'] ?? root?.shortName),
    displayName: textValue(root?.['display-name'] ?? root?.displayName),
    tags,
  };

  return taglib;
}
