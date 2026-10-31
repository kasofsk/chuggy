/**
 * The refetch loop that stands in for a stream that is not carrying changes.
 *
 * It runs only once the stream has not carried for the grace, and it is
 * bounded twice over: by its interval and by how many refetches it will ever
 * do, because a console polling forever behind a broken stream is a load
 * nobody asked for and a screen nobody trusts. A tick whose reads all failed
 * doubles the interval before the next, up to its ceiling, and one that read
 * anything puts it back.
 */

export const fallbackIntervalMs = 10_000;
export const fallbackIntervalMsMax = 160_000;
export const fallbackRefetchesMax = 60;

export type ProjectFallbackEnd = "Stopped" | "Exhausted";

/** What one tick's reads came to. */
export type ProjectFallbackTick = "Read" | "Failed";

export interface ProjectFallbackPorts {
  readonly sleepMs: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function fallbackIntervalNextMs(
  intervalMs: number,
  tick: ProjectFallbackTick,
): number {
  return tick === "Failed"
    ? Math.min(intervalMs * 2, fallbackIntervalMsMax)
    : fallbackIntervalMs;
}

export async function runProjectFallback(
  ports: ProjectFallbackPorts,
  refetch: () => Promise<ProjectFallbackTick>,
  signal: AbortSignal,
): Promise<ProjectFallbackEnd> {
  let intervalMs = fallbackIntervalMs;
  for (let done = 0; done < fallbackRefetchesMax; done += 1) {
    if (signal.aborted) return "Stopped";
    try {
      await ports.sleepMs(intervalMs, signal);
    } catch {
      return "Stopped";
    }
    if (signal.aborted) return "Stopped";
    intervalMs = fallbackIntervalNextMs(intervalMs, await refetch());
  }
  return "Exhausted";
}
