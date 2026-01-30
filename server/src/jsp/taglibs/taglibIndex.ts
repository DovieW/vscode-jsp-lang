import * as fs from 'node:fs/promises';
import fg from 'fast-glob';
import * as path from 'node:path';

import yauzl from 'yauzl';

import { parseTldXml } from './parseTld';
import type { Taglib, TaglibIndex } from './types';

export type TaglibIndexOptions = {
  roots: string[];
  /** Glob patterns (workspace-relative) for locating .tld files. */
  tldGlobs?: string[];
  /** Enable scanning *.jar / *.zip files for META-INF/*.tld entries. */
  enableJarScanning?: boolean;
  /** Glob patterns (workspace-relative) for locating .jar files. */
  jarGlobs?: string[];
};

const DEFAULT_IGNORE_GLOBS = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/.next/**',
];

const DEFAULT_TLD_GLOBS = ['**/*.tld'];
const DEFAULT_JAR_GLOBS = ['**/WEB-INF/lib/**/*.jar'];

async function findFilesByGlob(roots: string[], patterns: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const r of roots) {
    const hits = await fg(patterns, {
      cwd: r,
      absolute: true,
      onlyFiles: true,
      dot: true,
      ignore: DEFAULT_IGNORE_GLOBS,
      suppressErrors: true,
      followSymbolicLinks: false,
    });
    for (const h of hits) {
      // fast-glob can return mixed separators depending on platform.
      out.add(path.normalize(String(h)));
    }
  }
  return [...out];
}

function isJarPath(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith('.jar') || lower.endsWith('.zip');
}

function readZipEntryToString(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, readStream) => {
      if (err || !readStream) {
        reject(err ?? new Error('Failed to open zip entry stream'));
        return;
      }

      const chunks: Buffer[] = [];
      readStream.on('error', reject);
      readStream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      readStream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  });
}

async function scanJarForTlds(jarPath: string, onTldXml: (xml: string, source: string) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(jarPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('Failed to open jar'));
        return;
      }

      zipfile.on('error', reject);

      zipfile.readEntry();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        // Skip directories.
        if (name.endsWith('/')) {
          zipfile.readEntry();
          return;
        }

        // We only care about META-INF/*.tld
        // (Most taglibs are located directly under META-INF, but allow nested paths too.)
        const normalized = name.replace(/\\/g, '/');
        const isTld = /^(?:META-INF\/).+\.tld$/i.test(normalized);
        if (!isTld) {
          zipfile.readEntry();
          return;
        }

        void readZipEntryToString(zipfile, entry)
          .then((xml) => {
            onTldXml(xml, `jar:${jarPath}!/${normalized}`);
          })
          .catch(() => {
            // Swallow per-entry errors; jar scanning is best-effort.
          })
          .finally(() => {
            zipfile.readEntry();
          });
      });

      zipfile.on('end', () => {
        try {
          zipfile.close();
        } catch {
          // ignore
        }
        resolve();
      });
    });
  });
}

export async function buildTaglibIndex(options: TaglibIndexOptions): Promise<TaglibIndex> {
  const roots = options.roots ?? [];
  const tldGlobs = options.tldGlobs?.length ? options.tldGlobs : DEFAULT_TLD_GLOBS;
  const enableJarScanning = !!options.enableJarScanning;
  const jarGlobs = options.jarGlobs?.length ? options.jarGlobs : DEFAULT_JAR_GLOBS;

  const byUri = new Map<string, Taglib>();
  let parseErrorCount = 0;

  const tldFiles = await findFilesByGlob(roots, tldGlobs);

  // Parse sequentially for simplicity (and to avoid overwhelming I/O in big repos).
  for (const filePath of tldFiles) {
    try {
      const xml = await fs.readFile(filePath, 'utf8');
      const tld = parseTldXml(xml, filePath);
      if (tld.uri) {
        byUri.set(tld.uri, tld);
      }
    } catch {
      parseErrorCount++;
    }
  }

  if (enableJarScanning) {
    const jarFiles = (await findFilesByGlob(roots, jarGlobs)).filter(isJarPath);
    for (const jarPath of jarFiles) {
      try {
        await scanJarForTlds(jarPath, (xml, source) => {
          try {
            const tld = parseTldXml(xml, source);
            if (tld.uri) {
              byUri.set(tld.uri, tld);
            }
          } catch {
            parseErrorCount++;
          }
        });
      } catch {
        // Best-effort.
        parseErrorCount++;
      }
    }
  }

  return {
    byUri,
    builtAtMs: Date.now(),
    tldFileCount: tldFiles.length,
    parseErrorCount,
    roots: [...roots],
  };
}
