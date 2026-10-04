/**
 * The project event stream, and how it recovers.
 *
 * Recovery is the contract's: the last sequence seen goes back as
 * `Last-Event-ID`, a `reset` says the replay is past retention, and `source`
 * says whether the log behind the stream is live. The transport and the
 * ladder that reopens it are `streamConnection.ts`'s.
 */

import { partitionPath } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { parseProjectStreamEvent } from "../../../../src/contract/events.ts";
import type {
  ProjectSourceState,
  ProjectStreamEvent,
} from "../../../../src/contract/events.ts";

import { openStream, streamHeaders } from "./streamConnection.ts";
import type {
  StreamAttempt,
  StreamEnd,
  StreamHandle,
  StreamLadder,
  StreamPorts,
} from "./streamConnection.ts";

export const streamPathSegment = "events";

export type ProjectStreamConnection =
  "Opening" | "Open" | "Waiting" | "Stopped";

export interface ProjectStreamStatus {
  readonly connection: ProjectStreamConnection;
  readonly source: ProjectSourceState | "unknown";
  readonly reason: string | undefined;
  readonly lastSequence: number | undefined;
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

export interface ProjectStreamHandlers {
  readonly onEvent: (event: ProjectStreamEvent) => void;
  readonly onStatus: (status: ProjectStreamStatus) => void;
}

interface StreamHeld {
  lastSequence: number | undefined;
  source: ProjectSourceState | "unknown";
  answered: boolean;
}

export function projectStreamUrl(partition: PartitionIdentity): string {
  return `${partitionPath(partition)}/${streamPathSegment}`;
}

export function projectStreamHeaders(
  bearer: string | undefined,
  lastSequence: number | undefined,
): Record<string, string> {
  const headers = streamHeaders(bearer);
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
    answered: held.answered,
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

/** A refusal the API states before any stream byte ends the attempt for good,
 * and one it cannot serve the stream through marks the source degraded. */
function projectStreamRefused(
  held: StreamHeld,
  status: number,
): StreamEnd | undefined {
  if (status === 401) return { stop: "the API refused this session" };
  if (status === 404) return { stop: "the API has no such project" };
  if (status !== 503) return undefined;
  held.source = "degraded";
  return { reason: "the API cannot serve the stream" };
}

function projectStreamAttempt(
  partition: PartitionIdentity,
  held: StreamHeld,
  handlers: ProjectStreamHandlers,
): StreamAttempt {
  return {
    url: projectStreamUrl(partition),
    headers: (bearer) => projectStreamHeaders(bearer, held.lastSequence),
    refused: (status) => projectStreamRefused(held, status),
    opened: () => {
      held.answered = true;
      handlers.onStatus(projectStreamStatus("Open", held, undefined));
    },
    frame: (frame) => {
      projectStreamDispatch(
        held,
        handlers,
        parseProjectStreamEvent({
          event: frame.event,
          id: frame.id,
          data: JSON.parse(frame.data) as unknown,
        }),
      );
    },
  };
}

/** Every rung after the first open is one an attempt has ended before, which
 * is what `answered` records. */
function projectStreamLadder(
  held: StreamHeld,
  handlers: ProjectStreamHandlers,
): StreamLadder {
  return {
    opening: () => {
      handlers.onStatus(projectStreamStatus("Opening", held, undefined));
    },
    waiting: (reason) => {
      held.answered = true;
      handlers.onStatus(projectStreamStatus("Waiting", held, reason));
    },
    stopped: (reason) => {
      held.answered = true;
      handlers.onStatus(projectStreamStatus("Stopped", held, reason));
    },
  };
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
  ports: StreamPorts,
  partition: PartitionIdentity,
  handlers: ProjectStreamHandlers,
  answered = false,
): StreamHandle {
  const held: StreamHeld = {
    lastSequence: undefined,
    source: "unknown",
    answered,
  };
  return openStream(
    ports,
    projectStreamAttempt(partition, held, handlers),
    projectStreamLadder(held, handlers),
  );
}
