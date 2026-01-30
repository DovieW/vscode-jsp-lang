import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { GeneratedJavaMarkerCache } from '../src/debug/generatedJavaMarkerCache';

function writeFileWithMtime(filePath: string, content: string, mtime: Date): void {
  fs.writeFileSync(filePath, content, 'utf8');
  // Keep atime aligned too; helps on some platforms.
  fs.utimesSync(filePath, mtime, mtime);
}

describe('GeneratedJavaMarkerCache', () => {
  test('refreshes markers when file size changes even if mtime stays the same (low mtime resolution)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-lang-cache-'));
    const file = path.join(dir, 'index_jsp.java');

    const fixedTime = new Date('2020-01-01T00:00:00.000Z');

    writeFileWithMtime(
      file,
      [
        'public class X {',
        '  // line 1 "/webapp/index.jsp"',
        '  void a() {}',
        '}',
      ].join('\n'),
      fixedTime,
    );

    const cache = new GeneratedJavaMarkerCache({ maxEntries: 10, statDebounceMs: 0 });

    const first = cache.readMarkersForGeneratedJavaFile(file);
    expect(first?.length).toBe(1);
    expect(first?.[0]).toMatchObject({ jspLine: 1, jspFile: '/webapp/index.jsp' });

    // Rewrite with different content, then force the mtime back to the same value.
    // On filesystems with 1s mtime granularity, this simulates “changed but same mtime”.
    writeFileWithMtime(
      file,
      [
        'public class X {',
        '  // line 2 "/webapp/index.jsp"',
        '  // line 3 "/webapp/index.jsp"',
        '  void a() {}',
        '}',
      ].join('\n'),
      fixedTime,
    );

    const second = cache.readMarkersForGeneratedJavaFile(file);
    expect(second?.length).toBe(2);
    expect(second?.[0]).toMatchObject({ jspLine: 2, jspFile: '/webapp/index.jsp' });
    expect(second?.[1]).toMatchObject({ jspLine: 3, jspFile: '/webapp/index.jsp' });
  });

  test('evicts least-recently-used entries when above maxEntries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-lang-cache-'));

    const fileA = path.join(dir, 'a.java');
    const fileB = path.join(dir, 'b.java');
    const fileC = path.join(dir, 'c.java');

    fs.writeFileSync(fileA, '// line 1 "/a.jsp"\n', 'utf8');
    fs.writeFileSync(fileB, '// line 1 "/b.jsp"\n', 'utf8');
    fs.writeFileSync(fileC, '// line 1 "/c.jsp"\n', 'utf8');

    const cache = new GeneratedJavaMarkerCache({ maxEntries: 2, statDebounceMs: 0 });

    cache.readMarkersForGeneratedJavaFile(fileA);
    cache.readMarkersForGeneratedJavaFile(fileB);
    // Cache is full: [A, B]

    cache.readMarkersForGeneratedJavaFile(fileC);
    // Now should have evicted A: [B, C]

    const keys = cache._debugKeys();
    expect(keys.length).toBe(2);
    expect(keys).toContain(fileB);
    expect(keys).toContain(fileC);
    expect(keys).not.toContain(fileA);
  });

  test('forceStat bypasses stat debounce so marker changes are picked up immediately after a recompile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-lang-cache-'));
    const file = path.join(dir, 'index_jsp.java');

    const fixedTime = new Date('2020-01-01T00:00:00.000Z');

    writeFileWithMtime(
      file,
      ['public class X {', '  // line 1 "/webapp/index.jsp"', '  void a() {}', '}'].join('\n'),
      fixedTime,
    );

    // Huge debounce to make the "stale" behavior deterministic.
    const cache = new GeneratedJavaMarkerCache({ maxEntries: 10, statDebounceMs: 1_000_000_000 });

    const first = cache.readMarkersForGeneratedJavaFile(file);
    expect(first?.[0]).toMatchObject({ jspLine: 1, jspFile: '/webapp/index.jsp' });

    // Recompile: update marker line, and ensure mtime is different so a stat() would detect it.
    const newTime = new Date('2020-01-01T00:00:10.000Z');
    writeFileWithMtime(
      file,
      ['public class X {', '  // line 2 "/webapp/index.jsp"', '  void a() {}', '}'].join('\n'),
      newTime,
    );

    // Without forceStat, we are inside the debounce window so we should still get the stale markers.
    const stale = cache.readMarkersForGeneratedJavaFile(file);
    expect(stale?.[0]).toMatchObject({ jspLine: 1, jspFile: '/webapp/index.jsp' });

    // With forceStat, we must refresh immediately.
    const refreshed = cache.readMarkersForGeneratedJavaFile(file, { forceStat: true });
    expect(refreshed?.[0]).toMatchObject({ jspLine: 2, jspFile: '/webapp/index.jsp' });
  });

  test('refreshes markers when file is atomically replaced (inode changes) even if mtime and size are the same', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-lang-cache-'));
    const file = path.join(dir, 'index_jsp.java');
    const tmp = path.join(dir, 'index_jsp.tmp');

    const fixedTime = new Date('2020-01-01T00:00:00.000Z');

    // Keep content length identical between versions so size stays the same.
    const v1 = ['public class X {', '  // line 1 "/webapp/index.jsp"', '  void a() {}', '}'].join('\n');
    const v2 = ['public class X {', '  // line 2 "/webapp/index.jsp"', '  void a() {}', '}'].join('\n');
    expect(Buffer.byteLength(v1, 'utf8')).toBe(Buffer.byteLength(v2, 'utf8'));

    writeFileWithMtime(file, v1, fixedTime);

    const cache = new GeneratedJavaMarkerCache({ maxEntries: 10, statDebounceMs: 0 });
    const first = cache.readMarkersForGeneratedJavaFile(file);
    expect(first?.[0]).toMatchObject({ jspLine: 1, jspFile: '/webapp/index.jsp' });

    // Simulate an atomic rewrite (common in compilers): write temp file then rename over original.
    writeFileWithMtime(tmp, v2, fixedTime);
    fs.renameSync(tmp, file);

    const second = cache.readMarkersForGeneratedJavaFile(file);
    expect(second?.[0]).toMatchObject({ jspLine: 2, jspFile: '/webapp/index.jsp' });
  });
});
