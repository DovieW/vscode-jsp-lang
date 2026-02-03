import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';


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

function getIncludeConfig(): { webRoots: string[]; resolveStrategy: string } {
  const cfg = vscode.workspace.getConfiguration('jsp');
  const webRoots = cfg.get<string[]>('webRoots', ['.', 'src/main/webapp', 'WebContent']);
  const resolveStrategy = cfg.get<string>('includes.resolveStrategy', 'both');
  return { webRoots, resolveStrategy };
}

function resolveWebRoots(webRoots: string[], workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined): string[] {
  if (!workspaceFolders?.length) {
    return webRoots;
  }

  const out: string[] = [];
  for (const folder of workspaceFolders) {
    for (const root of webRoots) {
      if (path.isAbsolute(root)) {
        out.push(root);
      } else {
        out.push(path.join(folder.uri.fsPath, root));
      }
    }
  }
  return out;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('JSP Language Server');
  context.subscriptions.push(outputChannel);

  const diagnoseCommand = vscode.commands.registerCommand('jsp.diagnoseConfig', () => {
    const taglibs = getTaglibsConfig();
    const lint = getLintConfig();
    const includes = getIncludeConfig();

    const roots = resolveWebRoots(includes.webRoots, vscode.workspace.workspaceFolders);

    outputChannel?.appendLine('JSP configuration diagnostics');
    outputChannel?.appendLine(`- Web roots (configured): ${includes.webRoots.join(', ') || '(none)'}`);
    outputChannel?.appendLine(`- Web roots (resolved): ${roots.join(', ') || '(none)'}`);
    outputChannel?.appendLine(`- Include strategy: ${includes.resolveStrategy}`);
    outputChannel?.appendLine(`- Taglib TLD globs: ${taglibs.tldGlobs.join(', ')}`);
    outputChannel?.appendLine(`- Taglib jar scanning: ${taglibs.enableJarScanning ? 'enabled' : 'disabled'}`);
    outputChannel?.appendLine(`- Taglib jar globs: ${taglibs.jarGlobs.join(', ')}`);
    outputChannel?.appendLine(`- Lint enabled: ${lint.enable ? 'yes' : 'no'}`);

    outputChannel?.show(true);
  });
  context.subscriptions.push(diagnoseCommand);

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
      includes: getIncludeConfig(),
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

      if (e.affectsConfiguration('jsp.webRoots') || e.affectsConfiguration('jsp.includes')) {
        void client.sendNotification('jsp/includeConfig', getIncludeConfig());
      }
    }),
  );
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
