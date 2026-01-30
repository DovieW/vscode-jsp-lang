import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import yazl from 'yazl';

import { buildTaglibIndex } from '../server/src/jsp/taglibs/taglibIndex';

function writeZip(filePath: string, files: Array<{ zipPath: string; content: string }>): Promise<void> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    for (const f of files) {
      zipfile.addBuffer(Buffer.from(f.content, 'utf8'), f.zipPath);
    }

    const out = fs.createWriteStream(filePath);
    out.on('error', reject);
    zipfile.outputStream.pipe(out).on('close', () => resolve());
    zipfile.end();
  });
}

describe('Feature 03 — jar scanning (META-INF/*.tld)', () => {
  test('indexes taglibs from META-INF/*.tld inside .jar when enabled', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-lang-jar-'));
    const libDir = path.join(tmpRoot, 'WEB-INF', 'lib');
    fs.mkdirSync(libDir, { recursive: true });

    const jarPath = path.join(libDir, 'demo.jar');

    const tld = `<?xml version="1.0" encoding="UTF-8"?>
<taglib>
  <uri>http://example.com/tld/from-jar</uri>
  <short-name>jarDemo</short-name>
  <tag>
    <name>hello</name>
    <description>Hello from jar</description>
    <attribute>
      <name>enabled</name>
      <type>boolean</type>
    </attribute>
  </tag>
</taglib>`;

    await writeZip(jarPath, [{ zipPath: 'META-INF/demo.tld', content: tld }]);

    const idx = await buildTaglibIndex({
      roots: [tmpRoot],
      tldGlobs: ['**/*.tld'],
      enableJarScanning: true,
      jarGlobs: ['**/*.jar'],
    });

    const lib = idx.byUri.get('http://example.com/tld/from-jar');
    expect(lib).toBeTruthy();
    expect(lib!.shortName).toBe('jarDemo');
    expect(lib!.tags.get('hello')).toBeTruthy();
    expect(lib!.tags.get('hello')!.attributes.get('enabled')!.type).toBe('boolean');
  });

  test('does not scan jars when jar scanning is disabled', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-lang-jar-'));
    const libDir = path.join(tmpRoot, 'WEB-INF', 'lib');
    fs.mkdirSync(libDir, { recursive: true });

    const jarPath = path.join(libDir, 'demo.jar');
    await writeZip(jarPath, [{ zipPath: 'META-INF/demo.tld', content: '<taglib><uri>x</uri></taglib>' }]);

    const idx = await buildTaglibIndex({
      roots: [tmpRoot],
      tldGlobs: ['**/*.tld'],
      enableJarScanning: false,
      jarGlobs: ['**/*.jar'],
    });

    expect(idx.byUri.get('x')).toBeUndefined();
  });
});
