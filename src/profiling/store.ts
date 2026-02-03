import * as vscode from 'vscode';

import { ProfilingEvent, ProfilingStats } from './types';
import { aggregateProfilingStats } from './stats';

export class ProfilingStore {
  private events: ProfilingEvent[] = [];
  private stats: ProfilingStats = { byPath: new Map() };
  private readonly emitter = new vscode.EventEmitter<ProfilingStats>();

  readonly onDidChange = this.emitter.event;

  getStats(): ProfilingStats {
    return this.stats;
  }

  getEvents(): ProfilingEvent[] {
    return [...this.events];
  }

  replaceEvents(events: ProfilingEvent[]): void {
    this.events = events;
    this.recompute();
  }

  appendEvents(events: ProfilingEvent[]): void {
    if (events.length === 0) {
      return;
    }
    this.events = [...this.events, ...events];
    this.recompute();
  }

  clear(): void {
    this.events = [];
    this.recompute();
  }

  private recompute(): void {
    this.stats = aggregateProfilingStats(this.events);
    this.emitter.fire(this.stats);
  }
}
