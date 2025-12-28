import * as process from 'node:process';
import esbuild from 'esbuild';

const args = new Set(process.argv.slice(2));
const isWatch = args.has('--watch');
const isProd = args.has('--prod');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: !isProd,
  sourcesContent: false,
  logLevel: 'info',
  external: ['vscode'],
};

/**
 * NOTE: Some VS Code language-service libraries ship UMD/AMD bundles that use
 * runtime relative requires like `./parser/htmlScanner`. When fully bundled into
 * a single `dist/server.js`, those relative requires can break at runtime.
 *
 * For the LSP server we prefer leaving these packages external so Node resolves
 * them from `node_modules/` in the extension install.
 */
const serverExternal = [
  'vscode',
  'vscode-html-languageservice',
  'vscode-css-languageservice',
  'vscode-languageserver',
  'vscode-languageserver/node',
  'vscode-languageserver-textdocument',
  'vscode-languageserver-protocol',
  'vscode-languageserver-types',
  'vscode-jsonrpc',
  'vscode-uri',
];

const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
  },
  {
    ...common,
    external: serverExternal,
    entryPoints: ['server/src/server.ts'],
    outfile: 'dist/server.js',
  },
];

if (isWatch) {
  const ctxs = [];
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    ctxs.push(ctx);
  }
  // keep process alive
  process.stdin.resume();
} else {
  for (const options of builds) {
    await esbuild.build(options);
  }
}
