import { describe, expect, test } from 'vitest';

import { parseProfilingLog, parseLivePayload } from '../src/profiling/logParser';

const validLine = JSON.stringify({
  timestamp: '2026-02-02T12:00:00.000Z',
  request: '/app/index.jsp?foo=1',
  jspPath: '/webapp/index.jsp',
  durationMs: 42,
  status: 200,
});

describe('profiling log parser', () => {
  test('parses JSONL events and ignores blank lines', () => {
    const input = `${validLine}\n\n${validLine}`;
    const result = parseProfilingLog(input);

    expect(result.errors.length).toBe(0);
    expect(result.events.length).toBe(2);
    expect(result.events[0]?.durationMs).toBe(42);
  });

  test('reports invalid JSON lines without throwing', () => {
    const input = `${validLine}\n{not-json}`;
    const result = parseProfilingLog(input);

    expect(result.events.length).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/invalid json/i);
  });

  test('reports missing required fields', () => {
    const badLine = JSON.stringify({ request: '/app', durationMs: 12 });
    const result = parseProfilingLog(`${badLine}`);

    expect(result.events.length).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/missing required/i);
  });

  test('parses live payload arrays', () => {
    const payload = JSON.stringify([JSON.parse(validLine)]);
    const result = parseLivePayload(payload);

    expect(result.errors.length).toBe(0);
    expect(result.events.length).toBe(1);
  });
});
