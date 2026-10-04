/**
 * One server-sent stream, held open with `fetch` rather than `EventSource`.
 *
 * `EventSource` sends no `authorization` header, so the transport is a fetch
 * whose body is read to exhaustion and whose life is an `AbortController`'s.
 * What a frame means and what a refusal means are the caller's; what is here
 * is the open, the read and the ladder that opens the next one. Every wait is
 * bounded, and so is the number of consecutive opens that did not last.
 */

import { createStreamDecoder } from "./streamFrames.ts";
import type { StreamFrame } from "./streamFrames.ts";

export const streamReopenDelayMsMin = 1_000;
export const streamReopenDelayMsMax = 30_000;
export const streamOpenFailuresMax = 6;
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

async function streamAttempted(
  ports: StreamPorts,
  attempt: StreamAttempt,
  signal: AbortSignal,
): Promise<StreamEnd> {
  try {
    const response = await ports.fetch(attempt.url, {
      headers: attempt.headers(await ports.bearer()),
      signal,
    });
    const refused = attempt.refused(response.status);
    if (refused !== undefined) return refused;
    if (
      response.status < 200 ||
      response.status >= 300 ||
      response.body === null
    )
      return { reason: `the stream answered ${String(response.status)}` };
    attempt.opened();
    await streamDrained(response.body, attempt.frame);
    return { reason: "the stream closed" };
  } catch (failure: unknown) {
    return {
      reason: failure instanceof Error ? failure.message : "the stream failed",
    };
  }
}

/** One open after another until the signal aborts, an open is refused for
 * good, or too many in a row did not last. */
async function streamRun(
  ports: StreamPorts,
  attempt: StreamAttempt,
  ladder: StreamLadder,
  signal: AbortSignal,
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    ladder.opening();
    const openedAtMs = ports.nowMs();
    const end = await streamAttempted(ports, attempt, signal);
    if (signal.aborted) return;
    if (end.stop !== undefined) {
      ladder.stopped(end.stop);
      return;
    }
    failures = ports.nowMs() - openedAtMs >= streamStableMs ? 1 : failures + 1;
    if (failures >= streamOpenFailuresMax) {
      ladder.stopped("the stream would not stay open");
      return;
    }
    ladder.waiting(end.reason);
    try {
      await ports.sleepMs(streamDelayMs(failures), signal);
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
