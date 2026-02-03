import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { parseProfilingLog } from './logParser';
import { ProfilingLiveClient } from './liveClient';
import { ProfilingStore } from './store';
import { ProfilingTreeProvider } from './treeView';
import { ProfilingReportPanel } from './webview';

const DEFAULT_POLL_INTERVAL = 2000;

export function registerProfiling(context: vscode.ExtensionContext): void {
  const store = new ProfilingStore();
  const provider = new ProfilingTreeProvider(store);
  const reportPanel = new ProfilingReportPanel(store);

  context.subscriptions.push(vscode.window.registerTreeDataProvider('jspProfiling', provider));

  let liveClient: ProfilingLiveClient | undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand('jsp.profiling.importLog', async () => {
      const picks = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
          'Profiling Logs': ['log', 'jsonl', 'txt'],
        },
        openLabel: 'Import Profiling Log',
      });
      if (!picks || picks.length === 0) {
        return;
      }

      const fileUri = picks[0]!;
      const content = await fs.readFile(fileUri.fsPath, 'utf8');
      const parsed = parseProfilingLog(content);
      store.replaceEvents(parsed.events);

      if (parsed.errors.length > 0) {
        vscode.window.showWarningMessage(
          `Imported with ${parsed.errors.length} issues. First: ${parsed.errors[0]}`,
        );
      } else {
        vscode.window.showInformationMessage(`Imported ${parsed.events.length} profiling events.`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jsp.profiling.showReport', () => {
      reportPanel.show();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jsp.profiling.startLive', async () => {
      if (liveClient?.isRunning()) {
        vscode.window.showInformationMessage('Live profiling is already running.');
        return;
      }

      const config = vscode.workspace.getConfiguration('jsp');
      const defaultEndpoint = config.get<string>('profiling.live.endpoint', '');
      const endpoint =
        defaultEndpoint ||
        (await vscode.window.showInputBox({
          prompt: 'Enter profiling endpoint URL',
          placeHolder: 'http://localhost:8080/__jsp_profile/events',
        }));

      if (!endpoint) {
        return;
      }

      const pollIntervalMs = config.get<number>(
        'profiling.live.pollIntervalMs',
        DEFAULT_POLL_INTERVAL,
      );

      liveClient = new ProfilingLiveClient({
        endpoint,
        pollIntervalMs,
        onEvents: (events) => store.appendEvents(events),
        onError: (message) => vscode.window.showWarningMessage(message),
      });

      liveClient.start();
      vscode.window.showInformationMessage('Live profiling started.');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jsp.profiling.stopLive', () => {
      if (!liveClient?.isRunning()) {
        vscode.window.showInformationMessage('Live profiling is not running.');
        return;
      }
      liveClient.stop();
      vscode.window.showInformationMessage('Live profiling stopped.');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jsp.profiling.openJsp', async (jspPath: string) => {
      const uri = resolveJspUri(jspPath);
      if (!uri) {
        vscode.window.showWarningMessage(`Unable to resolve JSP path: ${jspPath}`);
        return;
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }),
  );
}

function resolveJspUri(jspPath: string): vscode.Uri | undefined {
  const normalized = jspPath.replace(/\\/g, '/');
  if (path.isAbsolute(normalized)) {
    const absolutePath = path.normalize(normalized);
    if (exists(absolutePath)) {
      return vscode.Uri.file(absolutePath);
    }
  }

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const relativePath = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  for (const folder of workspaceFolders) {
    const candidate = path.join(folder.uri.fsPath, relativePath);
    if (exists(candidate)) {
      return vscode.Uri.file(candidate);
    }
  }

  return undefined;
}

function exists(filePath: string): boolean {
  return fsSync.existsSync(filePath);
}
