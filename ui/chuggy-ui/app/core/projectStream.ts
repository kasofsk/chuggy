/**
 * The project event stream, held open with `fetch` rather than `EventSource`.
 *
 * `EventSource` sends no `authorization` header, so the transport is a fetch
 * whose body is read to exhaustion and whose life is an `AbortController`'s.
 * Recovery is the contract's: the last sequence seen goes back as
 * `Last-Event-ID`, a `reset` says the cursor was not replayable, and `source`
 * says whether the log behind the stream is live. Every wait here is bounded,
 * and so is the number of consecutive opens that did not last.
 *
 * A `reset` DROPS THE CURSOR RATHER THAN KEEPING IT. The server answers a
 * cursor it cannot replay with one `reset` and no rows, so resuming from that
 * same cursor would be answered the same way for as long as the connection kept
 * being replaced. Forgetting it is what makes the next open a first open, which
 * is the request the server can always answer.
 */

import { parseProjectStreamEvent } from "../../../../src/contract/events.ts";
import type {
  ProjectSourceState,
  ProjectStreamEvent,
} from "../../../../src/contract/events.ts";
import { partitionPath } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";

import { createStreamDecoder } from "./streamFrames.ts";

export const streamReopenDelayMsMin = 1_000;
export const streamReopenDelayMsMax = 30_000;
export const streamOpenFailuresMax = 6;
export const streamStableMs = 30_000;
export const streamPathSegment = "events";
export const streamMediaType = "text/event-stream";

export type ProjectStreamConnection =
  "Opening" | "Open" | "Waiting" | "Stopped";

/**
 * How the connection in hand came by what it is carrying: opened from nothing,
 * resumed from a cursor the server replayed, or resumed from one it refused to
 * replay and answered with a `reset` instead.
 */
export type ProjectStreamResume = "Fresh" | "Replayed" | "Reset";

export interface ProjectStreamStatus {
  readonly connection: ProjectStreamConnection;
  readonly source: ProjectSourceState | "unknown";
  readonly reason: string | undefined;
  readonly lastSequence: number | undefined;
  /** Which of the two answers a resumed open was given, which the frames
   * themselves say only at the moment they arrive. */
  readonly resume: ProjectStreamResume;
  /** Whether an attempt to open has ended since this console started following
   * this partition — opened, been refused, or failed. Until one has, the
   * console knows nothing about the stream, which is a different thing from
   * knowing something bad about it. */
  readonly answered: boolean;
}

/**
 * Whether what the screens show is arriving. The bounded fallback reads while
 * this is false, and the shell's banner says so while this is false and the
 * stream has opened at least once — one decision about `Opening` seen from two
 * sides, kept in one place because the two disagreeing is what left a reopening
 * console stale under a banner with nothing reading behind it.
 */
export function projectStreamCarrying(status: ProjectStreamStatus): boolean {
  return status.connection === "Open" && status.source === "live";
}

/**
 * A first open that has not settled: a connection that has never had the chance
 * to fail. Nothing has stopped arriving and there is nothing to warn a reader
 * about — which a reopen, on a ladder whose every rung passes back through
 * `Opening`, is not.
 */
export function projectStreamUnanswered(status: ProjectStreamStatus): boolean {
  return status.connection === "Opening" && !status.answered;
}

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

export interface ProjectStreamPorts {
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

export interface ProjectStreamHandlers {
  readonly onEvent: (event: ProjectStreamEvent) => void;
  readonly onStatus: (status: ProjectStreamStatus) => void;
}

export interface ProjectStreamHandle {
  readonly stop: () => void;
  readonly finished: Promise<void>;
}

interface StreamHeld {
  lastSequence: number | undefined;
  source: ProjectSourceState | "unknown";
  resume: ProjectStreamResume;
  answered: boolean;
}

interface StreamEnd {
  readonly stop?: string;
  readonly reason?: string;
}

export function projectStreamUrl(partition: PartitionIdentity): string {
  return `${partitionPath(partition)}/${streamPathSegment}`;
}

/** Doubling from the floor, capped, so a server that is down is asked rarely. */
export function projectStreamDelayMs(failures: number): number {
  const doubled = streamReopenDelayMsMin * 2 ** Math.max(failures - 1, 0);
  return Math.min(doubled, streamReopenDelayMsMax);
}

export function projectStreamHeaders(
  bearer: string | undefined,
  lastSequence: number | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { accept: streamMediaType };
  if (bearer !== undefined) headers["authorization"] = `Bearer ${bearer}`;
  if (lastSequence !== undefined)
    headers["last-event-id"] = String(lastSequence);
  return headers;
}

function projectStreamStatus(
  connection: ProjectStreamConnection,
  held: StreamHeld,
  reason: string | undefined,
): ProjectStreamStatus {
  return {
    connection,
    source: held.source,
    reason,
    lastSequence: held.lastSequence,
    resume: held.resume,
    answered: held.answered,
  };
}

/** A `reset` answers the cursor rather than the partition, so the cursor goes
 * and the next open asks for everything. */
function projectStreamResumed(
  held: StreamHeld,
  event: ProjectStreamEvent,
): void {
  if (event.event === "source") held.source = event.data.state;
  else if (event.event === "reset") {
    held.lastSequence = undefined;
    held.resume = "Reset";
  } else if (event.event !== "ready") held.lastSequence = event.sequence;
}

function projectStreamDispatch(
  held: StreamHeld,
  handlers: ProjectStreamHandlers,
  event: ProjectStreamEvent,
): void {
  projectStreamResumed(held, event);
  handlers.onEvent(event);
  handlers.onStatus(projectStreamStatus("Open", held, undefined));
}

/** A frame the contract rejects ends the connection rather than being skipped. */
async function projectStreamDrain(
  body: StreamBody,
  held: StreamHeld,
  handlers: ProjectStreamHandlers,
): Promise<void> {
  const decoder = createStreamDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) return;
      if (step.value === undefined) continue;
      for (const frame of decoder.push(step.value))
        projectStreamDispatch(
          held,
          handlers,
          parseProjectStreamEvent({
            event: frame.event,
            id: frame.id,
            data: JSON.parse(frame.data) as unknown,
          }),
        );
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** A refusal the API states before any stream byte ends the attempt for good. */
function projectStreamRefusal(status: number): string | undefined {
  if (status === 401) return "the API refused this session";
  if (status === 404) return "the API has no such project";
  return undefined;
}

async function projectStreamOnce(
  ports: ProjectStreamPorts,
  url: string,
  held: StreamHeld,
  handlers: ProjectStreamHandlers,
  signal: AbortSignal,
): Promise<StreamEnd> {
  try {
    held.resume = held.lastSequence === undefined ? "Fresh" : "Replayed";
    const response = await ports.fetch(url, {
      headers: projectStreamHeaders(await ports.bearer(), held.lastSequence),
      signal,
    });
    const refusal = projectStreamRefusal(response.status);
    if (refusal !== undefined) return { stop: refusal };
    if (response.status === 503) {
      held.source = "degraded";
      return { reason: "the API cannot serve the stream" };
    }
    if (
      response.status < 200 ||
      response.status >= 300 ||
      response.body === null
    )
      return { reason: `the stream answered ${String(response.status)}` };
    held.answered = true;
    handlers.onStatus(projectStreamStatus("Open", held, undefined));
    await projectStreamDrain(response.body, held, handlers);
    return { reason: "the stream closed" };
  } catch (failure: unknown) {
    return {
      reason: failure instanceof Error ? failure.message : "the stream failed",
    };
  }
}

async function projectStreamRun(
  ports: ProjectStreamPorts,
  partition: PartitionIdentity,
  handlers: ProjectStreamHandlers,
  signal: AbortSignal,
  answered: boolean,
): Promise<void> {
  const held: StreamHeld = {
    lastSequence: undefined,
    source: "unknown",
    resume: "Fresh",
    answered,
  };
  const url = projectStreamUrl(partition);
  let failures = 0;
  while (!signal.aborted) {
    handlers.onStatus(projectStreamStatus("Opening", held, undefined));
    const openedAtMs = ports.nowMs();
    const end = await projectStreamOnce(ports, url, held, handlers, signal);
    held.answered = true;
    if (signal.aborted) return;
    if (end.stop !== undefined) {
      handlers.onStatus(projectStreamStatus("Stopped", held, end.stop));
      return;
    }
    failures = ports.nowMs() - openedAtMs >= streamStableMs ? 1 : failures + 1;
    if (failures >= streamOpenFailuresMax) {
      handlers.onStatus(
        projectStreamStatus("Stopped", held, "the stream would not stay open"),
      );
      return;
    }
    handlers.onStatus(projectStreamStatus("Waiting", held, end.reason));
    try {
      await ports.sleepMs(projectStreamDelayMs(failures), signal);
    } catch {
      return;
    }
  }
}

/**
 * The stream, opened and kept open until it is stopped or refused.
 *
 * Stopping aborts the request in flight, which is what a project change and a
 * token refresh both do before opening the next one — so `answered` is what the
 * caller already learnt about this partition's stream, a run counting from
 * nothing having no way to tell that reopen from a first open.
 */
export function openProjectStream(
  ports: ProjectStreamPorts,
  partition: PartitionIdentity,
  handlers: ProjectStreamHandlers,
  answered = false,
): ProjectStreamHandle {
  const controller = new AbortController();
  const finished = projectStreamRun(
    ports,
    partition,
    handlers,
    controller.signal,
    answered,
  );
  return {
    stop: () => {
      controller.abort(new Error("the stream was closed by its caller"));
    },
    finished,
  };
}
