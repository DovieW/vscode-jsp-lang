import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

import { registerJavaStackFrameRewriter } from './debug/javaStackFrameRewriter';
import { registerJavaBreakpointTranslator } from './debug/javaBreakpointTranslator';
import { registerProfiling } from './profiling';

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;

function getTaglibsConfig(): { tldGlobs: string[]; enableJarScanning: boolean; jarGlobs: string[] } {
  const cfg = vscode.workspace.getConfiguration('jsp');
  const tldGlobs = cfg.get<string[]>('taglibs.tldGlobs', ['**/*.tld']);
  const enableJarScanning = cfg.get<boolean>('taglibs.enableJarScanning', false);
  const jarGlobs = cfg.get<string[]>('taglibs.jarGlobs', ['**/WEB-INF/lib/**/*.jar']);
  return { tldGlobs, enableJarScanning, jarGlobs };
}

function getLintConfig(): {
  enable: boolean;
  rules: Record<string, string>;
  scriptlets: { maxCount: number; maxLines: number; maxNesting: number };
  java: { enableSyntaxDiagnostics: boolean };
} {
  const cfg = vscode.workspace.getConfiguration('jsp');
  const enable = cfg.get<boolean>('lint.enable', true);
  const rules = cfg.get<Record<string, string>>('lint.rules', {});
  const maxCount = cfg.get<number>('lint.scriptlets.maxCount', 5);
  const maxLines = cfg.get<number>('lint.scriptlets.maxLines', 30);
  const maxNesting = cfg.get<number>('lint.scriptlets.maxNesting', 3);
  const enableSyntaxDiagnostics = cfg.get<boolean>('lint.java.enableSyntaxDiagnostics', false);
  return {
    enable,
    rules,
    scriptlets: { maxCount, maxLines, maxNesting },
    java: { enableSyntaxDiagnostics },
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('JSP Language Server');
  context.subscriptions.push(outputChannel);

  // Feature 04 (Milestone 1): when debugging Java, attempt to rewrite stack frames from
  // Tomcat-generated servlet sources back to .jsp/.jspf paths + lines.
  registerJavaStackFrameRewriter(context, outputChannel);

  // Feature 04 (Milestone 2): when setting breakpoints in .jsp/.jspf/.tag files during Java debugging,
  // translate them to breakpoints in the corresponding Tomcat/Jasper generated servlet source.
  registerJavaBreakpointTranslator(context, outputChannel);

  registerProfiling(context);

  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));

  const debugOptions = {
    execArgv: ['--nolazy', '--inspect=6009'],
  };

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  const clientOptions: LanguageClientOptions = {
    // Important: don't restrict schemes. In remote workspaces (WSL/SSH/containers),
    // documents often use `vscode-remote` (or other) schemes.
    // If we restrict to `file`, the client never attaches and features like hover won't fire.
    documentSelector: [{ language: 'jsp' }],
    outputChannel,
    initializationOptions: {
      taglibs: getTaglibsConfig(),
      lint: getLintConfig(),
    },
  };

  client = new LanguageClient(
    'jspLanguageServer',
    'JSP Language Server',
    serverOptions,
    clientOptions,
  );

  await client.start();
  context.subscriptions.push(client);

  // Forward settings changes to the server so taglib discovery updates without reload.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!client) {
        return;
      }
      if (e.affectsConfiguration('jsp.taglibs')) {
        void client.sendNotification('jsp/taglibsConfig', getTaglibsConfig());
      }

      if (e.affectsConfiguration('jsp.lint')) {
        void client.sendNotification('jsp/lintConfig', getLintConfig());
      }
    }),
  );
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
