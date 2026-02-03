# JSP Profiling (Feature 08) — Design

Date: 2026-02-02

## Summary
Implement a lightweight profiling workflow for JSP rendering based on JSONL log import and optional live polling. The extension parses events, aggregates per JSP path stats, and surfaces results in a tree view and a simple webview report. This avoids container-specific instrumentation while delivering practical performance insight.

## Architecture & data flow
- **Log format:** JSONL (one JSON object per line) with required fields: `timestamp`, `request`, `jspPath`, `durationMs`, `status`. Optional fields may be ignored for MVP.
- **Parsing:** Read lines, parse JSON, validate required fields, coerce `durationMs` to number. Invalid lines are collected and reported but do not abort import.
- **Store:** A central in-memory store holds events and computed aggregates. UI reads from the store and subscribes to change events.
- **Aggregation:** Per `jspPath` stats: count, avg, min/max, p95, p99. Percentiles use a simple nearest-rank calculation on sorted durations.
- **Path resolution:** Open JSP on click by resolving absolute paths or workspace-relative paths. If resolution fails, show a message and keep stats in the view.

## Live polling
- Command starts a polling loop against a URL (from config or prompt).
- Accepts JSON arrays or `{ events: [...] }` payloads.
- Merges new events into the store and refreshes views.
- Command stops polling and disposes timers.

## UI
- **Tree view** in Explorer (`jspProfiling`):
  - Root groups: “Slowest pages (p95)” and “Most frequent pages”.
  - Child items show path + short stats (p95, avg, count). Click opens JSP.
- **Webview panel** (“JSP Profiling Report”):
  - Simple HTML table of aggregate stats.
  - Re-renders on store update.

## Commands & config
- Commands:
  - `jsp.profiling.importLog`
  - `jsp.profiling.startLive`
  - `jsp.profiling.stopLive`
  - `jsp.profiling.showReport`
- Configuration:
  - `jsp.profiling.live.endpoint` (string)
  - `jsp.profiling.live.pollIntervalMs` (number, default 2000)

## Testing (TDD)
- Unit tests for:
  - JSONL parser (valid lines, invalid lines, missing fields)
  - Aggregation (counts, averages, percentiles)
- UI integration tests skipped for MVP.

## Security & privacy
- Logs may contain sensitive data. No telemetry is sent; data remains local to VS Code.
- Errors are surfaced as notifications without storing raw logs.
