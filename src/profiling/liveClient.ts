import { parseLivePayload } from './logParser';
import { ProfilingEvent } from './types';

export type LiveClientOptions = {
  endpoint: string;
  pollIntervalMs: number;
  onEvents: (events: ProfilingEvent[]) => void;
  onError: (message: string) => void;
};

export class ProfilingLiveClient {
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;

  constructor(private readonly options: LiveClientOptions) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.poll();
    }, this.options.pollIntervalMs);
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isRunning(): boolean {
    return Boolean(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(this.options.endpoint, { signal: controller.signal });
      if (!response.ok) {
        this.options.onError(`Profiling endpoint returned ${response.status}`);
        return;
      }
      const text = await response.text();
      const parsed = parseLivePayload(text);
      if (parsed.errors.length > 0) {
        this.options.onError(parsed.errors[0] ?? 'Failed to parse profiling payload.');
      }
      if (parsed.events.length > 0) {
        this.options.onEvents(parsed.events);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.onError(`Profiling poll failed: ${message}`);
    } finally {
      clearTimeout(timeout);
      this.inFlight = false;
    }
  }
}
