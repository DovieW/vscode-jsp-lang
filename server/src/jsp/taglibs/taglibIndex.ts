import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { parseTldXml } from './parseTld';
import type { Taglib, TaglibIndex } from './types';

const DEFAULT_IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.next']);

async function walkForTldFiles(root: string, out: string[], depth: number): Promise<void> {
  if (depth <= 0) {
    return;
  }

  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (DEFAULT_IGNORE_DIRS.has(ent.name)) {
        continue;
      }
      await walkForTldFiles(path.join(root, ent.name), out, depth - 1);
      continue;
    }
    if (ent.isFile() && ent.name.toLowerCase().endsWith('.tld')) {
      out.push(path.join(root, ent.name));
    }
  }
}

export async function buildTaglibIndex(roots: string[]): Promise<TaglibIndex> {
  const tldFiles: string[] = [];
  for (const r of roots) {
    await walkForTldFiles(r, tldFiles, 18);
  }

  const byUri = new Map<string, Taglib>();
  let parseErrorCount = 0;

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

  return {
    byUri,
    builtAtMs: Date.now(),
    tldFileCount: tldFiles.length,
    parseErrorCount,
    roots: [...roots],
  };
}
