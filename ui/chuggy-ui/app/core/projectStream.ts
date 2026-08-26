/**
 * The project event stream, held open with `fetch` rather than `EventSource`.
 *
 * `EventSource` sends no `authorization` header, so the transport is a fetch
 * whose body is read to exhaustion and whose life is an `AbortController`'s.
 * Recovery is the contract's: the last sequence seen goes back as
 * `Last-Event-ID`, a `reset` says the replay is past retention, and `source`
 * says whether the log behind the stream is live. Every wait here is bounded,
 * and so is the number of consecutive opens that did not last.
 */

import { partitionPath } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { parseProjectStreamEvent } from "../../../../src/contract/events.ts";
import type {
  ProjectSourceState,
  ProjectStreamEvent,
} from "../../../../src/contract/events.ts";

import { createStreamDecoder } from "./streamFrames.ts";

export const streamReopenDelayMsMin = 1_000;
export const streamReopenDelayMsMax = 30_000;
export const streamOpenFailuresMax = 6;
export const streamStableMs = 30_000;
export const streamPathSegment = "events";
export const streamMediaType = "text/event-stream";

export type ProjectStreamConnection =
  "Opening" | "Open" | "Waiting" | "Stopped";

export interface ProjectStreamStatus {
  readonly connection: ProjectStreamConnection;
  readonly source: ProjectSourceState | "unknown";
  readonly reason: string | undefined;
  readonly lastSequence: number | undefined;
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
  };
}

function projectStreamDispatch(
  held: StreamHeld,
  handlers: ProjectStreamHandlers,
  event: ProjectStreamEvent,
): void {
  if (event.event === "source") held.source = event.data.state;
  else if (event.event !== "ready" && event.event !== "reset")
    held.lastSequence = event.sequence;
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
): Promise<void> {
  const held: StreamHeld = { lastSequence: undefined, source: "unknown" };
  const url = projectStreamUrl(partition);
  let failures = 0;
  while (!signal.aborted) {
    handlers.onStatus(projectStreamStatus("Opening", held, undefined));
    const openedAtMs = ports.nowMs();
    const end = await projectStreamOnce(ports, url, held, handlers, signal);
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
 * token refresh both do before opening the next one.
 */
export function openProjectStream(
  ports: ProjectStreamPorts,
  partition: PartitionIdentity,
  handlers: ProjectStreamHandlers,
): ProjectStreamHandle {
  const controller = new AbortController();
  const finished = projectStreamRun(
    ports,
    partition,
    handlers,
    controller.signal,
  );
  return {
    stop: () => {
      controller.abort(new Error("the stream was closed by its caller"));
    },
    finished,
  };
}
