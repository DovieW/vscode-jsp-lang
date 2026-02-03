import { ProfilingEvent, ProfilingParseResult } from './types';

const REQUIRED_FIELDS = ['timestamp', 'request', 'jspPath', 'durationMs'] as const;

type RawEvent = Record<string, unknown>;

function coerceEvent(raw: RawEvent): ProfilingEvent | string {
  for (const field of REQUIRED_FIELDS) {
    if (raw[field] === undefined || raw[field] === null) {
      return `Missing required field: ${field}`;
    }
  }

  const durationMs = Number(raw.durationMs);
  if (!Number.isFinite(durationMs)) {
    return 'Invalid durationMs';
  }

  const event: ProfilingEvent = {
    timestamp: String(raw.timestamp),
    request: String(raw.request),
    jspPath: String(raw.jspPath),
    durationMs,
  };

  if (raw.status !== undefined) {
    const status = Number(raw.status);
    if (Number.isFinite(status)) {
      event.status = status;
    }
  }

  if (Array.isArray(raw.includes)) {
    event.includes = raw.includes.map((value) => String(value));
    event.includeCount = raw.includeCount ? Number(raw.includeCount) : raw.includes.length;
  } else if (raw.includeCount !== undefined) {
    const includeCount = Number(raw.includeCount);
    if (Number.isFinite(includeCount)) {
      event.includeCount = includeCount;
    }
  }

  return event;
}

export function parseProfilingLog(content: string): ProfilingParseResult {
  const events: ProfilingEvent[] = [];
  const errors: string[] = [];

  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmed) as RawEvent;
      const coerced = coerceEvent(parsed);
      if (typeof coerced === 'string') {
        errors.push(`Line ${index + 1}: Missing required fields (${coerced}).`);
        return;
      }
      events.push(coerced);
    } catch (error) {
      errors.push(`Line ${index + 1}: Invalid JSON.`);
    }
  });

  return { events, errors };
}

export function parseLivePayload(payload: string): ProfilingParseResult {
  const events: ProfilingEvent[] = [];
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    return { events, errors: ['Invalid JSON payload.'] };
  }

  const rawEvents: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { events?: unknown[] }).events)
      ? (parsed as { events: unknown[] }).events
      : null;

  if (!rawEvents) {
    return { events, errors: ['Payload does not contain an events array.'] };
  }

  rawEvents.forEach((raw: unknown, index: number) => {
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`Event ${index + 1}: Invalid event.`);
      return;
    }

    const coerced = coerceEvent(raw as RawEvent);
    if (typeof coerced === 'string') {
      errors.push(`Event ${index + 1}: Missing required fields (${coerced}).`);
      return;
    }
    events.push(coerced);
  });

  return { events, errors };
}
