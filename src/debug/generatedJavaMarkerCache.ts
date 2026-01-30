import * as fs from 'node:fs';

import { parseTomcatGeneratedJavaMarkers, type TomcatJspMarker } from './tomcatJspSourceMap';

export type GeneratedJavaMarkerCacheOptions = {
  /** Max number of generated .java files to keep parsed markers for. */
  maxEntries: number;
  /**
   * Avoid calling stat() on every single stack-frame rewrite when the same file
   * appears repeatedly in the same response burst.
   */
  statDebounceMs: number;
};

export type ReadMarkersOptions = {
  /**
   * When true, bypasses the stat debounce and re-checks the file on disk.
   * Useful to ensure we refresh mappings promptly after JSP recompiles.
   */
  forceStat?: boolean;
};

type CacheEntry = {
  ino?: number;
  mtimeMs: number;
  size: number;
  markers: TomcatJspMarker[];
  lastStatCheckMs: number;
};

/**
 * Small LRU-ish cache for Tomcat/Jasper generated servlet marker parsing.
 *
 * Key goals:
 * - mtime-based refresh (fast)
 * - handle low mtime resolution (also compare file size)
 * - bounded memory (LRU eviction)
 */
export class GeneratedJavaMarkerCache {
  private map = new Map<string, CacheEntry>();
  private maxEntries: number;
  private statDebounceMs: number;

  constructor(opts?: Partial<GeneratedJavaMarkerCacheOptions>) {
    this.maxEntries = Math.max(1, opts?.maxEntries ?? 200);
    this.statDebounceMs = Math.max(0, opts?.statDebounceMs ?? 250);
  }

  updateOptions(opts: Partial<GeneratedJavaMarkerCacheOptions>): void {
    if (typeof opts.maxEntries === 'number') this.maxEntries = Math.max(1, opts.maxEntries);
    if (typeof opts.statDebounceMs === 'number') this.statDebounceMs = Math.max(0, opts.statDebounceMs);

    this.enforceMaxEntries();
  }

  clear(): void {
    this.map.clear();
  }

  invalidate(generatedJavaPath: string): void {
    this.map.delete(generatedJavaPath);
  }

  /** Returns cached marker list (and refreshes it when the underlying file changes). */
  readMarkersForGeneratedJavaFile(
    generatedJavaPath: string,
    opts?: ReadMarkersOptions,
  ): TomcatJspMarker[] | undefined {
    const now = Date.now();

    const existing = this.map.get(generatedJavaPath);
    if (
      !opts?.forceStat &&
      existing &&
      this.statDebounceMs > 0 &&
      now - existing.lastStatCheckMs < this.statDebounceMs
    ) {
      // Treat as fresh for a short window to avoid repeated stat() syscalls.
      this.touch(generatedJavaPath, existing);
      return existing.markers;
    }

    try {
      const stat = fs.statSync(generatedJavaPath);

      const statIno = typeof (stat as any).ino === 'number' ? ((stat as any).ino as number) : undefined;

      if (
        existing &&
        existing.mtimeMs === stat.mtimeMs &&
        existing.size === stat.size &&
        // If inode is available, treat a change as a replacement (atomic rewrite) even
        // when mtime/size are unchanged.
        (existing.ino === undefined || statIno === undefined || existing.ino === statIno)
      ) {
        existing.lastStatCheckMs = now;
        this.touch(generatedJavaPath, existing);
        return existing.markers;
      }

      const text = fs.readFileSync(generatedJavaPath, 'utf8');
      const markers = parseTomcatGeneratedJavaMarkers(text);

      const entry: CacheEntry = {
        ino: statIno,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        markers,
        lastStatCheckMs: now,
      };

      this.touch(generatedJavaPath, entry);
      this.enforceMaxEntries();

      return markers;
    } catch {
      // File missing or unreadable; drop stale cache entry.
      if (existing) this.map.delete(generatedJavaPath);
      return undefined;
    }
  }

  /** For tests / diagnostics only. */
  _debugKeys(): string[] {
    return [...this.map.keys()];
  }

  private touch(key: string, entry: CacheEntry): void {
    // LRU behavior: delete+set moves to end.
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, entry);
  }

  private enforceMaxEntries(): void {
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.map.delete(oldestKey);
    }
  }
}
