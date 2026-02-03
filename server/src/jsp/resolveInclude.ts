import * as fsSync from 'node:fs';
import * as path from 'node:path';

export type IncludeResolveStrategy = 'relative-first' | 'relative-only' | 'webRoot-only';

export type IncludeResolveArgs = {
  docFsPath: string;
  workspaceRoots: string[];
  webRoots?: string[];
  includePath: string;
  strategy: IncludeResolveStrategy;
};

function findExistingPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function effectiveWebRoots(webRoots: string[] | undefined, workspaceRoots: string[]): string[] {
  if (webRoots && webRoots.length > 0) {
    return webRoots;
  }
  return workspaceRoots;
}

export function resolveIncludeTargetToFsPath(args: IncludeResolveArgs): string | undefined {
  const { docFsPath, workspaceRoots, includePath, strategy } = args;
  if (!docFsPath || !includePath) {
    return undefined;
  }

  const webRoots = effectiveWebRoots(args.webRoots, workspaceRoots);
  const docDir = path.dirname(docFsPath);

  const isWebRootPath = includePath.startsWith('/');
  const stripped = includePath.replace(/^\/+/, '');

  const tryWebRoot = (): string | undefined =>
    findExistingPath(webRoots.map((root) => path.join(root, stripped || includePath)));

  const tryRelative = (): string | undefined => {
    if (isWebRootPath) {
      return undefined;
    }
    return findExistingPath([path.resolve(docDir, includePath)]);
  };

  if (strategy === 'webRoot-only') {
    return tryWebRoot();
  }

  if (strategy === 'relative-only') {
    return tryRelative();
  }

  // relative-first
  return tryRelative() ?? tryWebRoot();
}
