import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  mapJavaLineToJsp,
  parseTomcatGeneratedJavaMarkers,
} from '../src/debug/tomcatJspSourceMap';

describe('tomcatJspSourceMap', () => {
  test('parses common Jasper marker comment formats', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'tomcat-generated', 'index_jsp.java');
    const text = fs.readFileSync(fixturePath, 'utf8');

    const markers = parseTomcatGeneratedJavaMarkers(text);

    // We expect to detect the 4 marker lines in the fixture.
    expect(markers.length).toBe(4);

    expect(markers[0]).toMatchObject({ javaLine: 8, jspLine: 1, jspFile: '/webapp/index.jsp' });
    expect(markers[1]).toMatchObject({ javaLine: 11, jspLine: 2, jspFile: '/webapp/index.jsp' });
    expect(markers[2]).toMatchObject({ javaLine: 14, jspLine: 3, jspFile: '/webapp/index.jsp' });
    expect(markers[3]).toMatchObject({ javaLine: 17, jspLine: 10, jspFile: 'WEB-INF/jspf/header.jspf' });
  });

  test('maps a generated Java line to nearest marker at or before it', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'tomcat-generated', 'index_jsp.java');
    const text = fs.readFileSync(fixturePath, 'utf8');
    const markers = parseTomcatGeneratedJavaMarkers(text);

    expect(mapJavaLineToJsp(markers, 8)).toMatchObject({ jspLine: 1, jspFile: '/webapp/index.jsp' });
    // Line 9 is after the marker at 8, before the next marker at 11.
    expect(mapJavaLineToJsp(markers, 9)).toMatchObject({ jspLine: 1, jspFile: '/webapp/index.jsp' });
    expect(mapJavaLineToJsp(markers, 16)).toMatchObject({ jspLine: 3, jspFile: '/webapp/index.jsp' });
    expect(mapJavaLineToJsp(markers, 18)).toMatchObject({ jspLine: 10, jspFile: 'WEB-INF/jspf/header.jspf' });
  });

  test('returns undefined when no earlier marker exists', () => {
    const markers = parseTomcatGeneratedJavaMarkers('public class X {}');
    expect(mapJavaLineToJsp(markers, 1)).toBeUndefined();
  });
});
