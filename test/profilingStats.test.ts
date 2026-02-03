import { describe, expect, test } from 'vitest';

import { aggregateProfilingStats } from '../src/profiling/stats';

const events = [
  { timestamp: 't1', request: '/a', jspPath: '/a.jsp', durationMs: 10, status: 200 },
  { timestamp: 't2', request: '/a', jspPath: '/a.jsp', durationMs: 30, status: 200 },
  { timestamp: 't3', request: '/a', jspPath: '/a.jsp', durationMs: 50, status: 200 },
  { timestamp: 't4', request: '/b', jspPath: '/b.jsp', durationMs: 5, status: 200 },
];

describe('profiling stats aggregation', () => {
  test('aggregates per jspPath with counts and averages', () => {
    const stats = aggregateProfilingStats(events);
    const a = stats.byPath.get('/a.jsp');

    expect(a).toBeTruthy();
    expect(a!.count).toBe(3);
    expect(a!.avgMs).toBeCloseTo(30, 2);
    expect(a!.minMs).toBe(10);
    expect(a!.maxMs).toBe(50);
  });

  test('computes p95 and p99 using nearest-rank', () => {
    const stats = aggregateProfilingStats(events);
    const a = stats.byPath.get('/a.jsp');

    expect(a).toBeTruthy();
    expect(a!.p95Ms).toBe(50);
    expect(a!.p99Ms).toBe(50);
  });
});
