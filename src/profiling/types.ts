export type ProfilingEvent = {
  timestamp: string;
  request: string;
  jspPath: string;
  durationMs: number;
  status?: number;
  includeCount?: number;
  includes?: string[];
};

export type ProfilingParseResult = {
  events: ProfilingEvent[];
  errors: string[];
};

export type ProfilingStatsEntry = {
  jspPath: string;
  count: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  p99Ms: number;
  lastTimestamp?: string;
};

export type ProfilingStats = {
  byPath: Map<string, ProfilingStatsEntry>;
};
