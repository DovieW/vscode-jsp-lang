import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveIncludeTargetToFsPath } from '../server/src/jsp/resolveInclude';

describe('include resolution', () => {
  test('relative-first resolves relative path before webRoots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-include-'));
    const webRoot = path.join(root, 'webapp');
    const docDir = path.join(root, 'views');

    fs.mkdirSync(webRoot, { recursive: true });
    fs.mkdirSync(docDir, { recursive: true });

    const relTarget = path.join(docDir, 'partials', 'header.jspf');
    fs.mkdirSync(path.dirname(relTarget), { recursive: true });
    fs.writeFileSync(relTarget, 'header', 'utf8');

    const webTarget = path.join(webRoot, 'partials', 'header.jspf');
    fs.mkdirSync(path.dirname(webTarget), { recursive: true });
    fs.writeFileSync(webTarget, 'header-web', 'utf8');

    const docFsPath = path.join(docDir, 'index.jsp');
    fs.writeFileSync(docFsPath, 'index', 'utf8');

    const resolved = resolveIncludeTargetToFsPath({
      docFsPath,
      workspaceRoots: [root],
      webRoots: [webRoot],
      includePath: 'partials/header.jspf',
      strategy: 'relative-first',
    });

    expect(resolved).toBe(relTarget);
  });

  test('webRoot-only resolves from webRoots for absolute include paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-include-'));
    const webRoot = path.join(root, 'webapp');
    const docDir = path.join(root, 'views');

    fs.mkdirSync(webRoot, { recursive: true });
    fs.mkdirSync(docDir, { recursive: true });

    const webTarget = path.join(webRoot, 'partials', 'header.jspf');
    fs.mkdirSync(path.dirname(webTarget), { recursive: true });
    fs.writeFileSync(webTarget, 'header-web', 'utf8');

    const docFsPath = path.join(docDir, 'index.jsp');
    fs.writeFileSync(docFsPath, 'index', 'utf8');

    const resolved = resolveIncludeTargetToFsPath({
      docFsPath,
      workspaceRoots: [root],
      webRoots: [webRoot],
      includePath: '/partials/header.jspf',
      strategy: 'webRoot-only',
    });

    expect(resolved).toBe(webTarget);
  });

  test('relative-only ignores webRoots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-include-'));
    const webRoot = path.join(root, 'webapp');
    const docDir = path.join(root, 'views');

    fs.mkdirSync(webRoot, { recursive: true });
    fs.mkdirSync(docDir, { recursive: true });

    const webTarget = path.join(webRoot, 'partials', 'header.jspf');
    fs.mkdirSync(path.dirname(webTarget), { recursive: true });
    fs.writeFileSync(webTarget, 'header-web', 'utf8');

    const docFsPath = path.join(docDir, 'index.jsp');
    fs.writeFileSync(docFsPath, 'index', 'utf8');

    const resolved = resolveIncludeTargetToFsPath({
      docFsPath,
      workspaceRoots: [root],
      webRoots: [webRoot],
      includePath: 'partials/header.jspf',
      strategy: 'relative-only',
    });

    expect(resolved).toBeUndefined();
  });
});
