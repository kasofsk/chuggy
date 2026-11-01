/**
 * The project event stream, and how it recovers.
 *
 * Recovery is the contract's: the last sequence seen — a change's, or the one
 * a `ready` or `reset` names — goes back as `Last-Event-ID`, a `reset` says the
 * replay is past retention, and `source` says whether the log behind the
 * stream is live. The transport and the ladder that reopens it are
 * `streamConnection.ts`'s.
 *
 * THE SERVER CUTS THIS STREAM AS A MATTER OF COURSE, at the greatest age it
 * lets one reach and when the bearer it was opened with expires, and it sends
 * a heartbeat comment every `projectStreamHeartbeatMs`. So an open that ends
 * is routine, a body silent for several heartbeats is a connection that died
 * without saying so, and nothing but a refused session stops the ladder: a
 * project is followed for as long as it is open in front of a reader.
 *
 * WHAT THIS STREAM HAS LEARNT IS THE CALLER'S TO HOLD, because a token
 * renewal replaces the run under a reader who has gone nowhere: the next run
 * replays from where the last one stopped, and knows it is not a first open.
 *
 * A FRAME THAT WILL NOT PARSE IS SKIPPED, not thrown on: its id still moves
 * the replay past it and the caller is told to read the partition again, so a
 * console older than the API it reads is not replayed the same frame forever.
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
  StreamCause,
  StreamEnd,
  StreamHandle,
  StreamLadder,
  StreamPorts,
} from "./streamConnection.ts";
import type { StreamFrame } from "./streamFrames.ts";

export const streamPathSegment = "events";

export const projectStreamHeartbeatMs = 20_000;
export const projectStreamSilenceMs = 3 * projectStreamHeartbeatMs;

export type ProjectStreamConnection =
  "Opening" | "Open" | "Waiting" | "Stopped";

export interface ProjectStreamStatus {
  readonly connection: ProjectStreamConnection;
  readonly source: ProjectSourceState | "unknown";
  /** Why the last open ended, where the connection is waiting or stopped. */
  readonly cause: StreamCause | undefined;
  /** Whether an attempt to open has ended since this console started following
   * this partition — opened, been refused, or failed. Until one has, the
   * console knows nothing about the stream, which is a different thing from
   * knowing something bad about it. */
  readonly answered: boolean;
}

/** What one partition's stream has learnt, held by the caller across every run
 * of it and begun again for another partition. */
export interface ProjectStreamHeld {
  lastSequence: number | undefined;
  source: ProjectSourceState | "unknown";
  answered: boolean;
}

export function projectStreamHeldInitial(): ProjectStreamHeld {
  return { lastSequence: undefined, source: "unknown", answered: false };
}

/**
 * Whether what the screens show is arriving. The bounded fallback reads while
 * this has been false for the grace, and the shell's banner speaks then too —
 * one decision about `Opening` seen from two sides, kept in one place because
 * the two disagreeing is what left a reopening console stale under a banner
 * with nothing reading behind it.
 */
export function projectStreamCarrying(status: ProjectStreamStatus): boolean {
  return status.connection === "Open" && status.source === "live";
}

/** Whether the stream is open and has answered, so it holds a position every
 * frame after it is replayed from — which a quiet stream does too. */
export function projectStreamHolding(status: ProjectStreamStatus): boolean {
  return status.connection === "Open" && status.answered;
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

export type ProjectStreamNotice =
  | { readonly notice: "Quiet" }
  | { readonly notice: "Reconnecting" }
  | { readonly notice: "NotLive"; readonly detail?: string };

/** Why the stream is not live, where a reader can act on or wait out why. */
function projectStreamNotLive(
  status: ProjectStreamStatus,
): ProjectStreamNotice {
  if (status.source === "degraded")
    return { notice: "NotLive", detail: "Updates delayed" };
  if (status.cause === "Refused")
    return { notice: "NotLive", detail: "Refused" };
  return { notice: "NotLive" };
}

/**
 * What the reader is told: nothing while the stream carries, while a first
 * open is unanswered, or until `lapsed` says it has not carried for the grace;
 * then that it is reconnecting while the ladder is climbing and the fallback
 * reading, and that it is not live once neither is.
 */
export function projectStreamNotice(
  status: ProjectStreamStatus,
  lapsed: boolean,
  exhausted: boolean,
): ProjectStreamNotice {
  if (!lapsed || projectStreamCarrying(status)) return { notice: "Quiet" };
  if (projectStreamUnanswered(status)) return { notice: "Quiet" };
  if (exhausted) return { notice: "NotLive", detail: "Reload to catch up" };
  const reconnecting =
    status.connection === "Opening" || status.connection === "Waiting";
  return reconnecting
    ? { notice: "Reconnecting" }
    : projectStreamNotLive(status);
}

export interface ProjectStreamHandlers {
  readonly onEvent: (event: ProjectStreamEvent) => void;
  /** Published only when it differs from the last one published. */
  readonly onStatus: (status: ProjectStreamStatus) => void;
  /** A frame was skipped, so what it changed is the partition's to read again. */
  readonly onSkipped: () => void;
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

type ProjectStreamPublish = (
  connection: ProjectStreamConnection,
  cause: StreamCause | undefined,
) => void;

function projectStreamPublisher(
  held: ProjectStreamHeld,
  handlers: ProjectStreamHandlers,
): ProjectStreamPublish {
  let published: ProjectStreamStatus | undefined;
  return (connection, cause) => {
    const status = {
      connection,
      source: held.source,
      cause,
      answered: held.answered,
    };
    if (
      published?.connection === status.connection &&
      published.source === status.source &&
      published.cause === status.cause &&
      published.answered === status.answered
    )
      return;
    published = status;
    handlers.onStatus(status);
  };
}

/** The frame as the contract reads it, or nothing where it will not parse. */
function projectStreamParsed(
  frame: StreamFrame,
): ProjectStreamEvent | undefined {
  try {
    return parseProjectStreamEvent({
      event: frame.event,
      id: frame.id,
      data: JSON.parse(frame.data) as unknown,
    });
  } catch {
    return undefined;
  }
}

/** The sequence a frame's id names, where it names one at all. */
function projectStreamFrameSequence(
  id: string | undefined,
): number | undefined {
  if (id === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(id)) return undefined;
  const sequence = Number(id);
  return Number.isSafeInteger(sequence) ? sequence : undefined;
}

function projectStreamTaken(
  held: ProjectStreamHeld,
  handlers: ProjectStreamHandlers,
  publish: ProjectStreamPublish,
  frame: StreamFrame,
): void {
  const event = projectStreamParsed(frame);
  if (event === undefined) {
    held.lastSequence =
      projectStreamFrameSequence(frame.id) ?? held.lastSequence;
    handlers.onSkipped();
    return;
  }
  if (event.event === "source") held.source = event.data.state;
  else held.lastSequence = event.sequence ?? held.lastSequence;
  handlers.onEvent(event);
  publish("Open", undefined);
}

/** A session refused before any stream byte ends the attempt for good. A
 * status the API cannot serve the stream through marks the source degraded
 * and is left to the transport, which waits out a wait it names. */
function projectStreamRefused(
  held: ProjectStreamHeld,
  status: number,
): StreamEnd | undefined {
  if (status === 401) return { stop: "Refused" };
  if (status === 503) held.source = "degraded";
  return undefined;
}

function projectStreamAttempt(
  partition: PartitionIdentity,
  held: ProjectStreamHeld,
  handlers: ProjectStreamHandlers,
  publish: ProjectStreamPublish,
): StreamAttempt {
  return {
    url: projectStreamUrl(partition),
    headers: (bearer) => projectStreamHeaders(bearer, held.lastSequence),
    refused: (status) => projectStreamRefused(held, status),
    cut: true,
    persists: true,
    silenceMs: projectStreamSilenceMs,
    opened: () => {
      held.answered = true;
      publish("Open", undefined);
    },
    frame: (frame) => {
      projectStreamTaken(held, handlers, publish, frame);
    },
  };
}

/** Every rung after the first open is one an attempt has ended before, which
 * is what `answered` records. */
function projectStreamLadder(
  held: ProjectStreamHeld,
  publish: ProjectStreamPublish,
): StreamLadder {
  return {
    opening: () => {
      publish("Opening", undefined);
    },
    waiting: (cause) => {
      held.answered = true;
      publish("Waiting", cause);
    },
    stopped: (cause) => {
      held.answered = true;
      publish("Stopped", cause);
    },
  };
}

/**
 * The stream, opened and kept open until it is stopped or its session is
 * refused, reading and writing `held` as it goes.
 *
 * Stopping aborts the request in flight, which is what a project change and a
 * token refresh both do before opening the next one; the caller hands the
 * next run the same `held` for a renewal and a new one for another project.
 */
export function openProjectStream(
  ports: StreamPorts,
  partition: PartitionIdentity,
  handlers: ProjectStreamHandlers,
  held: ProjectStreamHeld = projectStreamHeldInitial(),
): StreamHandle {
  const publish = projectStreamPublisher(held, handlers);
  return openStream(
    ports,
    projectStreamAttempt(partition, held, handlers, publish),
    projectStreamLadder(held, publish),
  );
}
