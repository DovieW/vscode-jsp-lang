import * as path from 'node:path';
import * as vscode from 'vscode';

import { ProfilingStatsEntry } from './types';
import { ProfilingStore } from './store';

const ROOT_SLOWEST = 'slowest';
const ROOT_FREQUENT = 'frequent';

type RootNode = {
  kind: 'root';
  id: typeof ROOT_SLOWEST | typeof ROOT_FREQUENT;
  label: string;
};

type EntryNode = {
  kind: 'entry';
  entry: ProfilingStatsEntry;
};

type ProfilingNode = RootNode | EntryNode;

export class ProfilingTreeProvider implements vscode.TreeDataProvider<ProfilingNode> {
  private readonly emitter = new vscode.EventEmitter<ProfilingNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: ProfilingStore) {
    this.store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: ProfilingNode): vscode.TreeItem {
    if (element.kind === 'root') {
      return new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
    }

    const entry = element.entry;
    const label = path.basename(entry.jspPath) || entry.jspPath;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `p95 ${entry.p95Ms.toFixed(0)}ms • avg ${entry.avgMs.toFixed(0)}ms • n=${entry.count}`;
    item.tooltip = entry.jspPath;
    item.command = {
      command: 'jsp.profiling.openJsp',
      title: 'Open JSP',
      arguments: [entry.jspPath],
    };
    return item;
  }

  getChildren(element?: ProfilingNode): Thenable<ProfilingNode[]> {
    if (!element) {
      return Promise.resolve([
        { kind: 'root', id: ROOT_SLOWEST, label: 'Slowest pages (p95)' },
        { kind: 'root', id: ROOT_FREQUENT, label: 'Most frequent pages' },
      ]);
    }

    if (element.kind === 'root') {
      const entries = Array.from(this.store.getStats().byPath.values());
      if (element.id === ROOT_SLOWEST) {
        return Promise.resolve(
          entries
            .sort((a, b) => b.p95Ms - a.p95Ms)
            .slice(0, 25)
            .map((entry) => ({ kind: 'entry', entry })),
        );
      }
      return Promise.resolve(
        entries
          .sort((a, b) => b.count - a.count)
          .slice(0, 25)
          .map((entry) => ({ kind: 'entry', entry })),
      );
    }

    return Promise.resolve([]);
  }
}
