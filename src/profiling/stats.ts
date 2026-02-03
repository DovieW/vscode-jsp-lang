import { ProfilingEvent, ProfilingStats, ProfilingStatsEntry } from './types';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

export function aggregateProfilingStats(events: ProfilingEvent[]): ProfilingStats {
  const byPath = new Map<string, ProfilingStatsEntry>();

  const grouped = new Map<string, ProfilingEvent[]>();
  for (const event of events) {
    if (!grouped.has(event.jspPath)) {
      grouped.set(event.jspPath, []);
    }
    grouped.get(event.jspPath)!.push(event);
  }

  for (const [jspPath, group] of grouped) {
    const durations = group.map((event) => event.durationMs).sort((a, b) => a - b);
    const count = durations.length;
    const total = durations.reduce((sum, value) => sum + value, 0);

    const entry: ProfilingStatsEntry = {
      jspPath,
      count,
      avgMs: count ? total / count : 0,
      minMs: count ? durations[0]! : 0,
      maxMs: count ? durations[count - 1]! : 0,
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      lastTimestamp: group[group.length - 1]?.timestamp,
    };

    byPath.set(jspPath, entry);
  }

  return { byPath };
}
