/**
 * The refetch loop that stands in for a stream that is not carrying changes.
 *
 * It runs only while the source is degraded or the connection is not open, and
 * it is bounded twice over: by its interval and by how many refetches it will
 * ever do, because a console polling forever behind a broken stream is a load
 * nobody asked for and a screen nobody trusts.
 */

export const fallbackIntervalMs = 10_000;
export const fallbackRefetchesMax = 60;

export type ProjectFallbackEnd = "Stopped" | "Exhausted";

export interface ProjectFallbackPorts {
  readonly sleepMs: (ms: number, signal: AbortSignal) => Promise<void>;
}

export async function runProjectFallback(
  ports: ProjectFallbackPorts,
  refetch: () => void,
  signal: AbortSignal,
): Promise<ProjectFallbackEnd> {
  for (let done = 0; done < fallbackRefetchesMax; done += 1) {
    if (signal.aborted) return "Stopped";
    try {
      await ports.sleepMs(fallbackIntervalMs, signal);
    } catch {
      return "Stopped";
    }
    if (signal.aborted) return "Stopped";
    refetch();
  }
  return "Exhausted";
}
