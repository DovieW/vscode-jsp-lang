import { describe, expect, test } from 'vitest';

import {
  EL_IMPLICIT_OBJECTS,
  extractElRegionsFromJsp,
  findElIdentifierAtOffset,
  isElIdentifierContext,
} from '../server/src/jsp/elSupport';

describe('EL support', () => {
  test('extractElRegionsFromJsp finds ${...} and #{...} regions', () => {
    const jsp = '<div>${pageScope.user}</div><c:out value="#{param.foo}" />';

    const regions = extractElRegionsFromJsp(jsp);

    expect(regions.length).toBe(2);
    expect(jsp.slice(regions[0]!.jspContentStartOffset, regions[0]!.jspContentEndOffset)).toBe('pageScope.user');
    expect(jsp.slice(regions[1]!.jspContentStartOffset, regions[1]!.jspContentEndOffset)).toBe('param.foo');
  });

  test('extractElRegionsFromJsp is tolerant of missing closing brace', () => {
    const jsp = 'Hello ${param';

    const regions = extractElRegionsFromJsp(jsp);

    expect(regions.length).toBe(1);
    expect(regions[0]!.jspEndOffset).toBe(jsp.length);
  });

  test('findElIdentifierAtOffset returns implicit object name when cursor is on it', () => {
    const jsp = 'Hello ${requestScope.user}';
    const offset = jsp.indexOf('requestScope') + 2;
    const regions = extractElRegionsFromJsp(jsp);

    const hit = findElIdentifierAtOffset(jsp, regions, offset);

    expect(hit).toBeTruthy();
    expect(hit!.name).toBe('requestScope');
    expect(jsp.slice(hit!.startOffset, hit!.endOffset)).toBe('requestScope');
  });

  test('findElIdentifierAtOffset returns undefined when cursor is on a delimiter', () => {
    const jsp = 'Hello ${requestScope.user}';
    const offset = jsp.indexOf('.');
    const regions = extractElRegionsFromJsp(jsp);

    const hit = findElIdentifierAtOffset(jsp, regions, offset);

    expect(hit).toBeUndefined();
  });

  test('isElIdentifierContext is true only when cursor is on identifier-ish position', () => {
    const jsp = 'Hello ${param.foo + 1}';
    const regions = extractElRegionsFromJsp(jsp);

    const onParam = jsp.indexOf('param') + 1;
    const onPlus = jsp.indexOf('+') + 1;

    expect(isElIdentifierContext(jsp, regions, onParam)).toBe(true);
    expect(isElIdentifierContext(jsp, regions, onPlus)).toBe(false);
  });

  test('EL implicit object list includes expected names', () => {
    const names = new Set(EL_IMPLICIT_OBJECTS.map((obj) => obj.name));

    expect(names.has('pageScope')).toBe(true);
    expect(names.has('requestScope')).toBe(true);
    expect(names.has('param')).toBe(true);
    expect(names.has('initParam')).toBe(true);
  });
});
