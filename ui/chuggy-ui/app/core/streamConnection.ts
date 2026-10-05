/**
 * One server-sent stream, held open with `fetch` rather than `EventSource`.
 *
 * `EventSource` sends no `authorization` header, so the transport is a fetch
 * whose body is read to exhaustion and whose life is an `AbortController`'s.
 * What a frame means and what a refusal means are the caller's; what is here
 * is the open, the read and the ladder that opens the next one. Every wait is
 * bounded, and so is the number of consecutive opens that did not last.
 *
 * A READ THAT FAILS IS A CLOSE. A connection reset under a read and a body
 * that ends are the same thing to the ladder: the open is over, nothing is
 * thrown to the caller, and the next one is opened.
 *
 * WHAT MAKES AN OPEN ONE THAT LASTED IS THE STREAM'S TO SAY. Left unsaid, it
 * is having stayed open for `streamStableMs`. A stream whose server cuts it
 * as a matter of course says so with `cut`, and for it an open that handed a
 * frame over is never counted towards giving up, however soon it ended. One
 * that had stayed open that long is opened again at once. One that had not
 * waits on the ladder, a rung higher for each such open in a row and back to
 * the floor after one that stayed open, so a server cutting every open — or
 * sending a frame that ends every open — is asked more and more rarely and
 * is still never given up on. A server with no room for such a stream names
 * a wait: the next open is no sooner than it, up to the ladder's own ceiling,
 * and answers of that kind are counted apart under their own bound.
 *
 * A FRAME IS HANDED OVER ONCE THE CALLER HAS TAKEN IT. An open whose first
 * frame the caller threw on handed nothing over and is one that failed.
 */

import { createStreamDecoder } from "./streamFrames.ts";
import type { StreamFrame } from "./streamFrames.ts";

export const streamReopenDelayMsMin = 1_000;
export const streamReopenDelayMsMax = 30_000;
export const streamOpenFailuresMax = 6;
/** The answers in a row naming a wait that a cut stream waits out. */
export const streamBusyOpensMax = 32;
export const streamStableMs = 30_000;
export const streamMediaType = "text/event-stream";

export interface StreamReader {
  read(): Promise<{
    readonly done: boolean;
    readonly value?: Uint8Array | undefined;
  }>;
  cancel(): Promise<void>;
}

export interface StreamBody {
  getReader(): StreamReader;
}

export interface StreamResponse {
  readonly status: number;
  readonly body: StreamBody | null;
  /** The `retry-after` header as it was answered, where there was one. */
  readonly retryAfter?: string | undefined;
}

export interface StreamPorts {
  readonly fetch: (
    url: string,
    init: {
      readonly headers: Record<string, string>;
      readonly signal: AbortSignal;
    },
  ) => Promise<StreamResponse>;
  readonly bearer: () => Promise<string | undefined>;
  readonly sleepMs: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly nowMs: () => number;
}

export interface StreamHandle {
  readonly stop: () => void;
  readonly finished: Promise<void>;
}

/** How one open ended: `stop` is a refusal no later open would be answered
 * differently, and `reason` is anything the ladder opens again after. */
export interface StreamEnd {
  readonly stop?: string;
  readonly reason?: string;
  /** Whether a frame was handed over before the open ended. */
  readonly heard?: boolean;
  /** The wait a server with no room named, in milliseconds. */
  readonly waitMs?: number;
}

/** What one stream is, as the transport needs it said. */
export interface StreamAttempt {
  readonly url: string;
  /** Asked at every open, because what a reopen carries can have moved. */
  readonly headers: (bearer: string | undefined) => Record<string, string>;
  /** What a status means where it ends the open before any stream byte, and
   * nothing where the status is left to the transport. */
  readonly refused: (status: number) => StreamEnd | undefined;
  readonly opened: () => void;
  /** A frame this throws on ends the connection rather than being skipped. */
  readonly frame: (frame: StreamFrame) => void;
  /** Whether the server cuts a stream it is still serving, and names a wait
   * when it has no room for one. */
  readonly cut?: boolean;
}

/** What the ladder says of itself as it climbs. */
export interface StreamLadder {
  readonly opening: () => void;
  readonly waiting: (reason: string | undefined) => void;
  readonly stopped: (reason: string) => void;
}

/** Doubling from the floor, capped, so a server that is down is asked rarely. */
export function streamDelayMs(failures: number): number {
  const doubled = streamReopenDelayMsMin * 2 ** Math.max(failures - 1, 0);
  return Math.min(doubled, streamReopenDelayMsMax);
}

export function streamHeaders(
  bearer: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { accept: streamMediaType };
  if (bearer !== undefined) headers["authorization"] = `Bearer ${bearer}`;
  return headers;
}

async function streamDrained(
  body: StreamBody,
  frame: (frame: StreamFrame) => void,
): Promise<void> {
  const decoder = createStreamDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) return;
      if (step.value === undefined) continue;
      for (const decoded of decoder.push(step.value)) frame(decoded);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** The wait a server with no room named, where it answered that and named
 * one in whole seconds. */
function streamBusyWaitMs(response: StreamResponse): number | undefined {
  const named = response.retryAfter?.trim();
  if (response.status !== 503 || named === undefined) return undefined;
  if (!/^\d+$/u.test(named)) return undefined;
  return Math.min(Number(named) * 1_000, streamReopenDelayMsMax);
}

async function streamAttempted(
  ports: StreamPorts,
  attempt: StreamAttempt,
  signal: AbortSignal,
): Promise<StreamEnd> {
  let heard = false;
  try {
    const response = await ports.fetch(attempt.url, {
      headers: attempt.headers(await ports.bearer()),
      signal,
    });
    const refused = attempt.refused(response.status);
    if (refused !== undefined) return refused;
    const waitMs =
      attempt.cut === true ? streamBusyWaitMs(response) : undefined;
    if (waitMs !== undefined)
      return { reason: "the stream had no room", waitMs };
    if (
      response.status < 200 ||
      response.status >= 300 ||
      response.body === null
    )
      return { reason: `the stream answered ${String(response.status)}` };
    attempt.opened();
    await streamDrained(response.body, (frame) => {
      attempt.frame(frame);
      heard = true;
    });
    return { reason: "the stream closed", heard };
  } catch (failure: unknown) {
    return {
      reason: failure instanceof Error ? failure.message : "the stream failed",
      heard,
    };
  }
}

/** What the ladder is counting, each a run of opens in a row: those that did
 * not last, those answered with a wait, and those that worked and ended soon. */
interface StreamCounts {
  readonly failures: number;
  readonly busy: number;
  readonly brief: number;
}

/**
 * What follows one open that ended with no refusal: the counts as they now
 * stand and the wait before the next open, or the reason there is none.
 * `openMs` is how long the open lasted.
 */
function streamNext(
  counts: StreamCounts,
  end: StreamEnd,
  openMs: number,
  cut: boolean,
):
  | { readonly counts: StreamCounts; readonly delayMs: number }
  | { readonly stop: string } {
  if (end.waitMs !== undefined) {
    const busy = counts.busy + 1;
    if (busy >= streamBusyOpensMax) return { stop: "the stream had no room" };
    const delayMs = Math.max(end.waitMs, streamDelayMs(busy));
    return { counts: { ...counts, busy }, delayMs };
  }
  const stable = openMs >= streamStableMs;
  if (cut && end.heard === true) {
    const brief = stable ? 0 : counts.brief + 1;
    return {
      counts: { failures: 0, busy: 0, brief },
      delayMs: stable ? 0 : streamDelayMs(brief),
    };
  }
  const failures = stable ? 1 : counts.failures + 1;
  if (failures >= streamOpenFailuresMax)
    return { stop: "the stream would not stay open" };
  return { counts: { ...counts, failures }, delayMs: streamDelayMs(failures) };
}

/** One open after another until the signal aborts, an open is refused for
 * good, or too many in a row did not last. */
async function streamRun(
  ports: StreamPorts,
  attempt: StreamAttempt,
  ladder: StreamLadder,
  signal: AbortSignal,
): Promise<void> {
  let counts: StreamCounts = { failures: 0, busy: 0, brief: 0 };
  while (!signal.aborted) {
    ladder.opening();
    const openedAtMs = ports.nowMs();
    const end = await streamAttempted(ports, attempt, signal);
    if (signal.aborted) return;
    const next =
      end.stop === undefined
        ? streamNext(
            counts,
            end,
            ports.nowMs() - openedAtMs,
            attempt.cut === true,
          )
        : { stop: end.stop };
    if ("stop" in next) {
      ladder.stopped(next.stop);
      return;
    }
    counts = next.counts;
    ladder.waiting(end.reason);
    try {
      await ports.sleepMs(next.delayMs, signal);
    } catch {
      return;
    }
  }
}

/** The stream, opened and kept open until it is stopped or refused. Stopping
 * aborts the request in flight. */
export function openStream(
  ports: StreamPorts,
  attempt: StreamAttempt,
  ladder: StreamLadder,
): StreamHandle {
  const controller = new AbortController();
  const finished = streamRun(ports, attempt, ladder, controller.signal);
  return {
    stop: () => {
      controller.abort(new Error("the stream was closed by its caller"));
    },
    finished,
  };
}
