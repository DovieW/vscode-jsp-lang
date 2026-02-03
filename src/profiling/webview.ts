import * as vscode from 'vscode';

import { ProfilingStore } from './store';
import { ProfilingStatsEntry } from './types';

export class ProfilingReportPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly store: ProfilingStore) {}

  show(): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (this.panel) {
      this.panel.reveal(column);
      this.render();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'jspProfilingReport',
      'JSP Profiling Report',
      column,
      { enableScripts: false },
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.store.onDidChange(() => this.render());
    this.render();
  }

  private render(): void {
    if (!this.panel) {
      return;
    }

    const entries = Array.from(this.store.getStats().byPath.values()).sort(
      (a, b) => b.p95Ms - a.p95Ms,
    );
    this.panel.webview.html = buildHtml(entries);
  }
}

function buildHtml(entries: ProfilingStatsEntry[]): string {
  const rows = entries
    .map(
      (entry) => `
      <tr>
        <td>${escapeHtml(entry.jspPath)}</td>
        <td>${entry.count}</td>
        <td>${entry.avgMs.toFixed(1)}</td>
        <td>${entry.p95Ms.toFixed(1)}</td>
        <td>${entry.p99Ms.toFixed(1)}</td>
        <td>${entry.minMs.toFixed(1)}</td>
        <td>${entry.maxMs.toFixed(1)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>JSP Profiling Report</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 16px;
      color: var(--vscode-foreground);
    }
    h1 {
      font-size: 1.2rem;
      margin: 0 0 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th, td {
      border-bottom: 1px solid var(--vscode-editorWidget-border);
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
    }
    .muted {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <h1>JSP Profiling Report</h1>
  <p class="muted">Sorted by p95 render time (descending).</p>
  <table>
    <thead>
      <tr>
        <th>JSP</th>
        <th>Count</th>
        <th>Avg (ms)</th>
        <th>p95 (ms)</th>
        <th>p99 (ms)</th>
        <th>Min (ms)</th>
        <th>Max (ms)</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="7">No profiling data loaded.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
