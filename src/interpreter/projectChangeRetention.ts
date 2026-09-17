/** Bounded maintenance of the historical project-change table. */

export interface ProjectChangeRetention {
  sweep(rowsMax: number): Promise<number>;
}

export interface ProjectChangeRetentionPacing {
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface ProjectChangeRetentionConfig {
  readonly intervalMs: number;
  readonly rowsMax: number;
}

export const projectChangeRetentionDefaults: ProjectChangeRetentionConfig = {
  intervalMs: 5_000,
  rowsMax: 1_000,
};

export interface ProjectChangeRetentionMaintenance {
  start(): void;
  stop(): Promise<void>;
}

export function projectChangeRetentionMaintenance(
  retention: ProjectChangeRetention,
  pacing: ProjectChangeRetentionPacing,
  config: ProjectChangeRetentionConfig = projectChangeRetentionDefaults,
  failed: (failure: unknown) => void = () => undefined,
): ProjectChangeRetentionMaintenance {
  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;
  const loop = async (signal: AbortSignal): Promise<void> => {
    while (!signal.aborted) {
      try {
        await retention.sweep(config.rowsMax);
      } catch (failure: unknown) {
        if (!signal.aborted) failed(failure);
      }
      await pacing.wait(config.intervalMs, signal);
    }
  };
  return {
    start: () => {
      if (running !== undefined) return;
      controller = new AbortController();
      running = loop(controller.signal);
    },
    stop: async () => {
      controller?.abort();
      await running;
      controller = undefined;
      running = undefined;
    },
  };
}
