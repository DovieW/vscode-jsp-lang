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

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('JSP Language Server');
  context.subscriptions.push(outputChannel);

  // Feature 04 (Milestone 1): when debugging Java, attempt to rewrite stack frames from
  // Tomcat-generated servlet sources back to .jsp/.jspf paths + lines.
  registerJavaStackFrameRewriter(context, outputChannel);

  // Feature 04 (Milestone 2): when setting breakpoints in .jsp/.jspf/.tag files during Java debugging,
  // translate them to breakpoints in the corresponding Tomcat/Jasper generated servlet source.
  registerJavaBreakpointTranslator(context, outputChannel);

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
  };

  client = new LanguageClient(
    'jspLanguageServer',
    'JSP Language Server',
    serverOptions,
    clientOptions,
  );

  await client.start();
  context.subscriptions.push(client);
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
