/**
 * The thread live stream's hub: what each session is writing right now, as its
 * runner reported it, sent on to the readers open on that session.
 *
 * A reader holds what the hub holds. Every event the hub folds is sent on as it
 * was heard, and whatever a reader was not sent as an event it is sent as a
 * snapshot: its first frame, what it missed while its socket was behind, and
 * the nothing left when the hub drops what it held of the session.
 *
 * Nothing here is durable, and nothing is queued for a socket that is behind.
 */

import type { SessionLiveEvent } from "../contract/sessionLive.ts";
import {
  threadLiveHeard,
  threadLiveNothing,
  threadLiveVersion,
  type ThreadLiveHeld,
  type ThreadLiveStreamEvent,
} from "../contract/threadLive.ts";
import type { SessionId, SessionTurnId } from "./agentSession.ts";
import type {
  EventStreamSink,
  ProjectStreamTimer,
  ProjectStreamTimers,
} from "./projectStream.ts";
import type { Partition } from "./projectStore.ts";

/** One live event as the lane carried it: the session that wrote it, and the turn it is of. */
export interface ThreadLiveCarried {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly turn: SessionTurnId;
  readonly event: SessionLiveEvent;
}

/** Whether the lane is listening, or has lost whatever was published since it last was. */
export type ThreadLiveSource = "Live" | "Lost";

/** What the lane tells the hub: each event it carried, each payload it could not read, and how it is. */
export interface ThreadLiveWatcher {
  heard(carried: ThreadLiveCarried): void;
  unread(): void;
  sourced(source: ThreadLiveSource): void;
}

export interface ThreadLiveLane {
  open(watcher: ThreadLiveWatcher): void;
  close(): Promise<void>;
}

export type ThreadLiveSink = EventStreamSink<ThreadLiveStreamEvent>;

export interface ThreadLiveLimits {
  readonly connectionsMax: number;
  readonly maxAgeMs: number;
  readonly heartbeatMs: number;
  readonly slowClientWaitMs: number;
  readonly sessionsHeldMax: number;
  readonly textHeldCharsMax: number;
  readonly sessionIdleMs: number;
}

export const threadLiveLimitsDefault: ThreadLiveLimits = {
  connectionsMax: 256,
  maxAgeMs: 300_000,
  heartbeatMs: 20_000,
  slowClientWaitMs: 10_000,
  sessionsHeldMax: 1_024,
  textHeldCharsMax: 16_777_216,
  sessionIdleMs: 300_000,
};

export function checkedThreadLiveLimits(
  limits: ThreadLiveLimits,
): ThreadLiveLimits {
  for (const [what, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`${what} must be a positive integer`);
  return limits;
}

export type ThreadLiveNoteDetail =
  | { readonly note: "Sourced"; readonly source: ThreadLiveSource }
  | { readonly note: "Refused" }
  | { readonly note: "SlowClientClosed" }
  | { readonly note: "Unread" };

/** What an operator is told, each note carrying the totals current when it happened. */
export type ThreadLiveNote = ThreadLiveNoteDetail & {
  readonly connectionsOpen: number;
  readonly sessionsHeld: number;
  readonly eventsHeard: number;
  readonly payloadsUnread: number;
};

export interface ThreadLiveReport {
  noted(note: ThreadLiveNote): void;
}

export interface ThreadLiveOpening {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly expiresAtMs?: number | undefined;
}

/** A reader that has been admitted and has not been given a socket yet, so its request can still be answered any way. */
export interface ThreadLiveConnection {
  begin(sink: ThreadLiveSink): void;
  close(): void;
}

export type ThreadLiveOpened =
  | { readonly opened: "Opened"; readonly connection: ThreadLiveConnection }
  | { readonly opened: "AtCapacity" };

export interface ThreadLiveHub {
  open(opening: ThreadLiveOpening): ThreadLiveOpened;
  close(): Promise<void>;
}

export interface ThreadLiveParts {
  readonly lane: ThreadLiveLane;
  readonly timers: ProjectStreamTimers;
  readonly report: ThreadLiveReport;
  readonly limits?: ThreadLiveLimits;
}

/** What is held of one session: its fold, what that weighs against the text bound, and when it was last heard from. */
interface HeldSession {
  readonly held: ThreadLiveHeld;
  readonly chars: number;
  readonly heardAtMs: number;
}

interface OpenConnection {
  readonly key: string;
  sink: ThreadLiveSink | undefined;
  lifetime: ProjectStreamTimer | undefined;
  behind: ProjectStreamTimer | undefined;
  missed: boolean;
  closed: boolean;
}

interface HubState {
  readonly parts: ThreadLiveParts;
  readonly limits: ThreadLiveLimits;

  /** Keyed by session, the least recently heard first. */
  readonly sessions: Map<string, HeldSession>;
  readonly readers: Map<string, Set<OpenConnection>>;
  source: ThreadLiveSource;
  connectionsOpen: number;
  textHeldChars: number;
  eventsHeard: number;
  payloadsUnread: number;
  payloadsUnreadNoted: number;
  stopped: boolean;
  heartbeat: ProjectStreamTimer | undefined;
}

function sessionKey(partition: Partition, session: SessionId): string {
  const { tenant, project } = partition;
  return `${String(tenant.length)}:${tenant}${String(project.length)}:${project}${session}`;
}

/** Every character a fold holds: its turn, its message, and each block's name and text. */
function heldChars(held: ThreadLiveHeld): number {
  let chars = (held.turn?.length ?? 0) + (held.message?.length ?? 0);
  for (const block of held.blocks)
    chars += block.text.length + (block.name?.length ?? 0);
  return chars;
}

function noted(state: HubState, detail: ThreadLiveNoteDetail): void {
  state.parts.report.noted({
    ...detail,
    connectionsOpen: state.connectionsOpen,
    sessionsHeld: state.sessions.size,
    eventsHeard: state.eventsHeard,
    payloadsUnread: state.payloadsUnread,
  });
}

function closeConnection(state: HubState, connection: OpenConnection): void {
  if (connection.closed) return;
  connection.closed = true;
  connection.lifetime?.cancel();
  connection.behind?.cancel();
  const readers = state.readers.get(connection.key);
  readers?.delete(connection);
  if (readers?.size === 0) state.readers.delete(connection.key);
  state.connectionsOpen -= 1;
  connection.sink?.end();
}

/** A frame the socket took past what it will buffer starts the wait a slow reader is closed after. */
function fellBehind(state: HubState, connection: OpenConnection): void {
  const sink = connection.sink;
  if (sink === undefined || connection.behind !== undefined) return;
  connection.behind = state.parts.timers.once(
    state.limits.slowClientWaitMs,
    () => {
      closeConnection(state, connection);
      noted(state, { note: "SlowClientClosed" });
    },
  );
  sink.whenDrained(() => {
    drained(state, connection);
  });
}

/** Writes one frame to a reader that is keeping up, and marks a reader that is behind as having missed it. */
function deliver(
  state: HubState,
  connection: OpenConnection,
  event: ThreadLiveStreamEvent,
): void {
  const sink = connection.sink;
  if (connection.closed || sink === undefined) return;
  if (connection.behind !== undefined) {
    connection.missed = true;
    return;
  }
  if (!sink.send(event)) fellBehind(state, connection);
}

function snapshot(state: HubState, connection: OpenConnection): void {
  const held = state.sessions.get(connection.key)?.held ?? threadLiveNothing;
  deliver(state, connection, {
    event: "snapshot",
    data: { version: threadLiveVersion, held },
  });
}

/** A reader that missed nothing while behind is sent nothing: a snapshot its socket cannot buffer would otherwise be sent on every drain. */
function drained(state: HubState, connection: OpenConnection): void {
  if (connection.closed) return;
  connection.behind?.cancel();
  connection.behind = undefined;
  const missed = connection.missed;
  connection.missed = false;
  if (missed) snapshot(state, connection);
}

/** Drops what is held of one session, and tells its readers that nothing is. */
function forgot(state: HubState, key: string): void {
  const session = state.sessions.get(key);
  if (session === undefined) return;
  state.sessions.delete(key);
  state.textHeldChars -= session.chars;
  for (const connection of [...(state.readers.get(key) ?? [])])
    snapshot(state, connection);
}

function idleForgotten(state: HubState): void {
  const nowMs = state.parts.timers.nowMs();
  for (const [key, session] of state.sessions) {
    if (nowMs - session.heardAtMs < state.limits.sessionIdleMs) return;
    forgot(state, key);
  }
}

/** The session just heard is the last to go, so it is dropped only when it alone is past a bound. */
function evicted(state: HubState): void {
  const { sessionsHeldMax, textHeldCharsMax } = state.limits;
  while (
    state.sessions.size > sessionsHeldMax ||
    state.textHeldChars > textHeldCharsMax
  ) {
    const oldest = state.sessions.keys().next();
    if (oldest.done === true) return;
    forgot(state, oldest.value);
  }
}

function heard(state: HubState, carried: ThreadLiveCarried): void {
  if (state.stopped) return;
  state.eventsHeard += 1;
  idleForgotten(state);
  const key = sessionKey(carried.partition, carried.session);
  const before = state.sessions.get(key);
  const held = threadLiveHeard(
    before?.held ?? threadLiveNothing,
    carried.turn,
    carried.event,
  );
  const chars = heldChars(held);
  state.sessions.delete(key);
  state.textHeldChars += chars - (before?.chars ?? 0);
  if (held.turn !== undefined)
    state.sessions.set(key, {
      held,
      chars,
      heardAtMs: state.parts.timers.nowMs(),
    });
  for (const connection of [...(state.readers.get(key) ?? [])])
    deliver(state, connection, {
      event: "live",
      data: {
        version: threadLiveVersion,
        turn: carried.turn,
        event: carried.event,
      },
    });
  evicted(state);
}

/** Whatever was published while the lane was lost is gone, so nothing held can be shown to be whole. */
function sourced(state: HubState, source: ThreadLiveSource): void {
  if (state.stopped || source === state.source) return;
  state.source = source;
  if (source === "Lost")
    for (const key of [...state.sessions.keys()]) forgot(state, key);
  noted(state, { note: "Sourced", source });
}

function ticked(state: HubState): void {
  idleForgotten(state);
  for (const readers of state.readers.values())
    for (const connection of [...readers])
      if (connection.behind === undefined && connection.sink?.beat() === false)
        fellBehind(state, connection);
  if (state.payloadsUnread === state.payloadsUnreadNoted) return;
  state.payloadsUnreadNoted = state.payloadsUnread;
  noted(state, { note: "Unread" });
}

function lifetimeMs(state: HubState, opening: ThreadLiveOpening): number {
  const { maxAgeMs } = state.limits;
  if (opening.expiresAtMs === undefined) return maxAgeMs;
  const remainingMs = opening.expiresAtMs - state.parts.timers.nowMs();
  return Math.max(1, Math.min(maxAgeMs, remainingMs));
}

function begin(
  state: HubState,
  connection: OpenConnection,
  sink: ThreadLiveSink,
): void {
  if (connection.closed) {
    sink.end();
    return;
  }
  idleForgotten(state);
  connection.sink = sink;
  snapshot(state, connection);
}

function openConnection(
  state: HubState,
  opening: ThreadLiveOpening,
): ThreadLiveOpened {
  if (state.stopped || state.connectionsOpen >= state.limits.connectionsMax) {
    noted(state, { note: "Refused" });
    return { opened: "AtCapacity" };
  }
  const connection: OpenConnection = {
    key: sessionKey(opening.partition, opening.session),
    sink: undefined,
    lifetime: undefined,
    behind: undefined,
    missed: false,
    closed: false,
  };
  connection.lifetime = state.parts.timers.once(
    lifetimeMs(state, opening),
    () => {
      closeConnection(state, connection);
    },
  );
  const readers = state.readers.get(connection.key) ?? new Set();
  readers.add(connection);
  state.readers.set(connection.key, readers);
  state.connectionsOpen += 1;
  return {
    opened: "Opened",
    connection: {
      begin: (sink) => {
        begin(state, connection, sink);
      },
      close: () => {
        closeConnection(state, connection);
      },
    },
  };
}

async function closeHub(state: HubState): Promise<void> {
  if (state.stopped) return;
  state.stopped = true;
  state.heartbeat?.cancel();
  for (const readers of [...state.readers.values()])
    for (const connection of [...readers]) closeConnection(state, connection);
  await state.parts.lane.close();
}

/**
 * The lane is opened here rather than by the first reader, so a reader that
 * arrives while a message is being written is shown what was written before it
 * arrived.
 */
export function threadLiveHub(parts: ThreadLiveParts): ThreadLiveHub {
  const state: HubState = {
    parts,
    limits: checkedThreadLiveLimits(parts.limits ?? threadLiveLimitsDefault),
    sessions: new Map(),
    readers: new Map(),
    source: "Lost",
    connectionsOpen: 0,
    textHeldChars: 0,
    eventsHeard: 0,
    payloadsUnread: 0,
    payloadsUnreadNoted: 0,
    stopped: false,
    heartbeat: undefined,
  };
  state.heartbeat = parts.timers.repeat(state.limits.heartbeatMs, () => {
    ticked(state);
  });
  parts.lane.open({
    heard: (carried) => {
      heard(state, carried);
    },
    unread: () => {
      state.payloadsUnread += 1;
    },
    sourced: (source) => {
      sourced(state, source);
    },
  });
  return {
    open: (opening) => openConnection(state, opening),
    close: () => closeHub(state),
  };
}
