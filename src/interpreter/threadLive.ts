/**
 * The thread live stream's hub: what each session is writing right now, as its
 * runner reported it, sent on to the readers open on that session.
 *
 * A reader holds what the hub holds. Every event that changes what the hub
 * holds is sent on as it was heard, and whatever a reader was not sent as an
 * event it is sent as a snapshot: its first frame, what it missed while its
 * socket was behind, and what is left when the hub keeps less than an event
 * wrote or drops what it held of the session.
 *
 * Nothing here is durable and nothing is queued. A session's runner and a
 * thread's reader are both on a member's own machine, so neither is trusted
 * with how much it makes this process hold or do, and each bound below is on
 * what one of them, or all of them together, can.
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
import { sessionLiveKey } from "./sessionPlane.ts";

/** One live event as the lane carried it: the session that wrote it, and the turn it is of. */
export interface ThreadLiveCarried {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly turn: SessionTurnId;
  readonly event: SessionLiveEvent;
}

/** Whether the lane is listening, or has lost whatever was published since it last was. */
export type ThreadLiveSource = "Live" | "Lost";

/**
 * What the lane tells the hub. It asks `arrived` of every payload before
 * reading it, and reads only one the hub answers for: then it says what the
 * payload carried, or that it could not be read.
 */
export interface ThreadLiveWatcher {
  arrived(): boolean;
  heard(carried: ThreadLiveCarried): void;
  unread(): void;
  sourced(source: ThreadLiveSource): void;
}

export interface ThreadLiveLane {
  open(watcher: ThreadLiveWatcher): void;
  close(): Promise<void>;
}

/**
 * One open socket, written frames as its transport encodes them. It answers
 * what it holds unwritten and what it has been written since it opened, and it
 * can be cut: closed so that nothing written to it is held anywhere.
 */
export interface ThreadLiveSink extends EventStreamSink<string> {
  pendingBytes(): number;
  sentBytes(): number;
  cut(): void;
}

export interface ThreadLiveLimits {
  /** The readers open at once, across every session. */
  readonly connectionsMax: number;
  /** The readers open at once on one session, which is what one event is written out to. */
  readonly sessionReadersMax: number;
  readonly maxAgeMs: number;
  readonly heartbeatMs: number;
  readonly slowClientWaitMs: number;
  /** What the sockets that are behind may hold unwritten between them. */
  readonly pendingBytesMax: number;
  /** What the open sockets may have been written between them, which is the most they can hold unread. */
  readonly sentBytesMax: number;
  readonly sessionsHeldMax: number;
  /** What is held across every session, counted as `threadLiveHeldBytes` counts it. */
  readonly heldBytesMax: number;
  /** The text one session may hold across its blocks, which bounds its snapshot. */
  readonly sessionTextBytesMax: number;
  readonly sessionIdleMs: number;
  /** The span the payloads that arrive are counted over. */
  readonly windowMs: number;
  /** The payloads read in one window, past which the hub is behind. */
  readonly windowEventsMax: number;
}

export const threadLiveLimitsDefault: ThreadLiveLimits = {
  connectionsMax: 256,
  sessionReadersMax: 8,
  maxAgeMs: 300_000,
  heartbeatMs: 20_000,
  slowClientWaitMs: 10_000,
  pendingBytesMax: 16_777_216,
  sentBytesMax: 33_554_432,
  sessionsHeldMax: 1_024,
  heldBytesMax: 16_777_216,
  sessionTextBytesMax: 131_072,
  sessionIdleMs: 300_000,
  windowMs: 1_000,
  windowEventsMax: 2_000,
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
  | { readonly note: "PendingClosed" }
  | { readonly note: "SentClosed" }
  | { readonly note: "Unread" }
  | { readonly note: "Shed" };

/** What an operator is told, each note carrying the totals current when it happened. */
export type ThreadLiveNote = ThreadLiveNoteDetail & {
  readonly connectionsOpen: number;
  readonly sessionsHeld: number;
  readonly heldBytes: number;
  readonly pendingBytes: number;
  readonly sentBytes: number;
  readonly eventsHeard: number;
  readonly payloadsUnread: number;
  readonly payloadsShed: number;
};

export interface ThreadLiveReport {
  noted(note: ThreadLiveNote): void;
}

export interface ThreadLiveOpening {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly expiresAtMs?: number | undefined;
  /** Whether this reader may still read the thread, which is asked again on every heartbeat. */
  readonly admitted: () => Promise<boolean>;
}

/**
 * A reader that has been admitted and has not been given a socket yet, so its
 * request can still be answered any way. It is closed when its request is.
 */
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
  /** How the transport encodes an event, asked once for an event however many readers it is sent to. */
  readonly framed: (event: ThreadLiveStreamEvent) => string;
  readonly limits?: ThreadLiveLimits;
}

/** What a session is charged for besides its strings: its place in the hub and the record of what it holds. */
const sessionRecordBytes = 512;

/** What a block is charged for besides its text and its name. */
const blockRecordBytes = 128;

/** What a string is charged for each UTF-16 unit, which is the most a string held flat occupies for one. */
const unitBytes = 2;

/** What a session's blocks hold of text, as the hub counts text. */
function textBytes(held: ThreadLiveHeld): number {
  let units = 0;
  for (const block of held.blocks) units += block.text.length;
  return unitBytes * units;
}

/**
 * What holding `held` under `key` is counted as occupying. Every string is
 * counted at its widest, so the count is never under what is retained as long
 * as every text held is flat and shares nothing, which `unshared` sees to.
 */
export function threadLiveHeldBytes(key: string, held: ThreadLiveHeld): number {
  let units =
    key.length + (held.turn?.length ?? 0) + (held.message?.length ?? 0);
  for (const block of held.blocks) units += block.name?.length ?? 0;
  return (
    sessionRecordBytes +
    blockRecordBytes * held.blocks.length +
    unitBytes * units +
    textBytes(held)
  );
}

/**
 * `text` in storage of its own. A text the fold appended to or cut is a rope
 * or a slice, which keeps alive everything it was made from; joined from its
 * two halves it is written out as one string that shares nothing.
 */
function unshared(text: string): string {
  if (text.length < 2) return text;
  const middle = Math.floor(text.length / 2);
  return [text.slice(0, middle), text.slice(middle)].join("");
}

/** What is held of one session: its fold, what that is counted as occupying, and when it was last heard from. */
interface HeldSession {
  readonly held: ThreadLiveHeld;
  readonly bytes: number;
  readonly heardAtMs: number;
}

interface OpenConnection {
  readonly key: string;
  readonly admitted: () => Promise<boolean>;
  sink: ThreadLiveSink | undefined;
  lifetime: ProjectStreamTimer | undefined;
  behind: ProjectStreamTimer | undefined;
  pendingBytes: number;
  sentBytes: number;
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
  heldBytes: number;
  pendingBytes: number;
  sentBytes: number;
  eventsHeard: number;
  payloadsUnread: number;
  payloadsUnreadNoted: number;
  payloadsShed: number;
  payloadsShedNoted: number;
  windowAtMs: number;
  windowPayloads: number;
  asking: boolean;
  stopped: boolean;
  heartbeat: ProjectStreamTimer | undefined;
}

function noted(state: HubState, detail: ThreadLiveNoteDetail): void {
  state.parts.report.noted({
    ...detail,
    connectionsOpen: state.connectionsOpen,
    sessionsHeld: state.sessions.size,
    heldBytes: state.heldBytes,
    pendingBytes: state.pendingBytes,
    sentBytes: state.sentBytes,
    eventsHeard: state.eventsHeard,
    payloadsUnread: state.payloadsUnread,
    payloadsShed: state.payloadsShed,
  });
}

/** Records what one socket holds unwritten, in the total across every socket. */
function pending(
  state: HubState,
  connection: OpenConnection,
  bytes: number,
): void {
  state.pendingBytes += bytes - connection.pendingBytes;
  connection.pendingBytes = bytes;
}

/** Records what one socket has been written, in the total across every open socket. */
function sent(
  state: HubState,
  connection: OpenConnection,
  bytes: number,
): void {
  state.sentBytes += bytes - connection.sentBytes;
  connection.sentBytes = bytes;
}

/**
 * A reader closed while the hub runs is cut, because nothing says how much of
 * what its socket was written its peer has read, and a socket that is ended
 * goes on holding that. Only a hub that is stopping ends its readers.
 */
function closeConnection(
  state: HubState,
  connection: OpenConnection,
  how: "Cut" | "Ended" = "Cut",
): void {
  if (connection.closed) return;
  connection.closed = true;
  connection.lifetime?.cancel();
  connection.behind?.cancel();
  pending(state, connection, 0);
  sent(state, connection, 0);
  const readers = state.readers.get(connection.key);
  readers?.delete(connection);
  if (readers?.size === 0) state.readers.delete(connection.key);
  state.connectionsOpen -= 1;
  if (how === "Cut") connection.sink?.cut();
  else connection.sink?.end();
}

/**
 * A socket that took a frame past what it will buffer is behind: it is written
 * no more until it drains, and is closed if it has not by the end of the wait.
 * Where what the sockets behind hold unwritten between them is now past its
 * bound, this one is cut at once, which frees what it took.
 */
function fellBehind(state: HubState, connection: OpenConnection): void {
  const sink = connection.sink;
  if (sink === undefined || connection.behind !== undefined) return;
  pending(state, connection, sink.pendingBytes());
  if (state.pendingBytes > state.limits.pendingBytesMax) {
    closeConnection(state, connection);
    noted(state, { note: "PendingClosed" });
    return;
  }
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

/**
 * Cuts the socket written the most where what the open sockets were written is
 * past its bound, which brings it back within: that socket was written at least
 * what was just written. Nothing says how much of what a socket was written its
 * peer has read, here or in the kernel, so it is the one that can be holding
 * the most.
 */
function sentBounded(state: HubState): void {
  if (state.sentBytes <= state.limits.sentBytesMax) return;
  let most: OpenConnection | undefined;
  for (const readers of state.readers.values())
    for (const connection of readers)
      if (most === undefined || connection.sentBytes > most.sentBytes)
        most = connection;
  if (most === undefined) return;
  closeConnection(state, most);
  noted(state, { note: "SentClosed" });
}

/** Writes one frame to a reader that is keeping up, and marks a reader that is behind as having missed it. */
function deliver(
  state: HubState,
  connection: OpenConnection,
  frame: string,
): void {
  const sink = connection.sink;
  if (connection.closed || sink === undefined) return;
  if (connection.behind !== undefined) {
    connection.missed = true;
    return;
  }
  const taken = sink.send(frame);
  sent(state, connection, sink.sentBytes());
  if (!taken) fellBehind(state, connection);
  sentBounded(state);
}

/** What is held of one session now, as the frame every reader owed it is sent. */
function snapshotFramed(state: HubState, key: string): string {
  const held = state.sessions.get(key)?.held ?? threadLiveNothing;
  return state.parts.framed({
    event: "snapshot",
    data: { version: threadLiveVersion, held },
  });
}

/** Sends one frame to every reader of a session, where it has any. */
function broadcast(state: HubState, key: string, framed: () => string): void {
  const readers = state.readers.get(key);
  if (readers === undefined) return;
  const frame = framed();
  for (const connection of [...readers]) deliver(state, connection, frame);
}

/** A reader that missed nothing while behind is sent nothing: a snapshot its socket cannot buffer would otherwise be sent on every drain. */
function drained(state: HubState, connection: OpenConnection): void {
  if (connection.closed) return;
  connection.behind?.cancel();
  connection.behind = undefined;
  pending(state, connection, 0);
  const missed = connection.missed;
  connection.missed = false;
  if (missed) deliver(state, connection, snapshotFramed(state, connection.key));
}

/** Drops what is held of one session, and tells its readers that nothing is. */
function forgot(state: HubState, key: string): void {
  const session = state.sessions.get(key);
  if (session === undefined) return;
  state.sessions.delete(key);
  state.heldBytes -= session.bytes;
  broadcast(state, key, () => snapshotFramed(state, key));
}

function forgotAll(state: HubState): void {
  for (const key of [...state.sessions.keys()]) forgot(state, key);
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
  const { sessionsHeldMax, heldBytesMax } = state.limits;
  while (
    state.sessions.size > sessionsHeldMax ||
    state.heldBytes > heldBytesMax
  ) {
    const oldest = state.sessions.keys().next();
    if (oldest.done === true) return;
    forgot(state, oldest.value);
  }
}

/**
 * What the hub keeps of a fold a text event changed, and whether that is the
 * fold itself. The block the event wrote is kept in storage of its own, or is
 * left gapped where its text takes the session past what one may hold.
 */
function kept(
  state: HubState,
  folded: ThreadLiveHeld,
  index: number,
): { readonly held: ThreadLiveHeld; readonly whole: boolean } {
  const whole = textBytes(folded) <= state.limits.sessionTextBytesMax;
  return {
    whole,
    held: {
      ...folded,
      blocks: folded.blocks.map((block) =>
        block.index !== index || block.text === ""
          ? block
          : whole
            ? { ...block, text: unshared(block.text) }
            : { ...block, text: "", gapped: true },
      ),
    },
  };
}

function heard(state: HubState, carried: ThreadLiveCarried): void {
  if (state.stopped) return;
  state.eventsHeard += 1;
  idleForgotten(state);
  const { event, turn } = carried;
  const key = sessionLiveKey(carried.partition, carried.session);
  const before = state.sessions.get(key);
  const folded = threadLiveHeard(
    before?.held ?? threadLiveNothing,
    turn,
    event,
  );
  const heardAtMs = state.parts.timers.nowMs();
  state.sessions.delete(key);
  if (before !== undefined && folded === before.held) {
    state.sessions.set(key, { ...before, heardAtMs });
    return;
  }
  if (before === undefined && folded === threadLiveNothing) return;
  const { held, whole } =
    event.live === "Text"
      ? kept(state, folded, event.index)
      : { held: folded, whole: true };
  const bytes = held.turn === undefined ? 0 : threadLiveHeldBytes(key, held);
  state.heldBytes += bytes - (before?.bytes ?? 0);
  if (held.turn !== undefined)
    state.sessions.set(key, { held, bytes, heardAtMs });
  broadcast(state, key, () =>
    whole
      ? state.parts.framed({
          event: "live",
          data: { version: threadLiveVersion, turn, event },
        })
      : snapshotFramed(state, key),
  );
  evicted(state);
}

/**
 * Whether the payload that just arrived is read. Past what the hub reads in
 * one window it reads no more until the window turns, and since what an unread
 * payload carried is unknown, nothing held can be shown to be whole: it is all
 * dropped, as it is when the lane is lost.
 */
function arrived(state: HubState): boolean {
  if (state.stopped) return false;
  const nowMs = state.parts.timers.nowMs();
  const sinceMs = nowMs - state.windowAtMs;
  if (sinceMs < 0 || sinceMs >= state.limits.windowMs) {
    state.windowAtMs = nowMs;
    state.windowPayloads = 0;
  }
  state.windowPayloads += 1;
  if (state.windowPayloads <= state.limits.windowEventsMax) return true;
  state.payloadsShed += 1;
  forgotAll(state);
  return false;
}

/** Whatever was published while the lane was lost is gone, so nothing held can be shown to be whole. */
function sourced(state: HubState, source: ThreadLiveSource): void {
  if (state.stopped || source === state.source) return;
  state.source = source;
  if (source === "Lost") forgotAll(state);
  noted(state, { note: "Sourced", source });
}

/** One reader's answer to whether it may still read. An answer that fails, or has not come by the next heartbeat, closes nobody. */
function asked(state: HubState, connection: OpenConnection): Promise<boolean> {
  return new Promise((resolve) => {
    const waited = state.parts.timers.once(state.limits.heartbeatMs, () => {
      resolve(true);
    });
    const answered = (admitted: boolean): void => {
      waited.cancel();
      resolve(admitted);
    };
    void connection.admitted().then(answered, () => {
      answered(true);
    });
  });
}

/**
 * Asks of every reader, one at a time, whether it may still read, and closes
 * each that may not. A round still asking when the next heartbeat comes is left
 * to finish.
 */
async function readmitted(state: HubState): Promise<void> {
  if (state.asking) return;
  state.asking = true;
  const connections = [...state.readers.values()].flatMap((readers) => [
    ...readers,
  ]);
  for (const connection of connections)
    if (!connection.closed && !(await asked(state, connection)))
      closeConnection(state, connection);
  state.asking = false;
}

/** Notes what was not read since the last heartbeat, each kind once however many there were. */
function countsNoted(state: HubState): void {
  if (state.payloadsUnread !== state.payloadsUnreadNoted) {
    state.payloadsUnreadNoted = state.payloadsUnread;
    noted(state, { note: "Unread" });
  }
  if (state.payloadsShed !== state.payloadsShedNoted) {
    state.payloadsShedNoted = state.payloadsShed;
    noted(state, { note: "Shed" });
  }
}

function ticked(state: HubState): void {
  idleForgotten(state);
  for (const readers of state.readers.values())
    for (const connection of [...readers])
      if (connection.behind === undefined && connection.sink?.beat() === false)
        fellBehind(state, connection);
  countsNoted(state);
  void readmitted(state);
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
  deliver(state, connection, snapshotFramed(state, connection.key));
}

/** Whether another reader of `key` is past what the hub, or that one session, may have open. */
function atCapacity(state: HubState, key: string): boolean {
  const { connectionsMax, sessionReadersMax } = state.limits;
  return (
    state.stopped ||
    state.connectionsOpen >= connectionsMax ||
    (state.readers.get(key)?.size ?? 0) >= sessionReadersMax
  );
}

function openConnection(
  state: HubState,
  opening: ThreadLiveOpening,
): ThreadLiveOpened {
  const key = sessionLiveKey(opening.partition, opening.session);
  if (atCapacity(state, key)) {
    noted(state, { note: "Refused" });
    return { opened: "AtCapacity" };
  }
  const connection: OpenConnection = {
    key,
    admitted: opening.admitted,
    sink: undefined,
    lifetime: undefined,
    behind: undefined,
    pendingBytes: 0,
    sentBytes: 0,
    missed: false,
    closed: false,
  };
  connection.lifetime = state.parts.timers.once(
    lifetimeMs(state, opening),
    () => {
      closeConnection(state, connection);
    },
  );
  const readers = state.readers.get(key) ?? new Set();
  readers.add(connection);
  state.readers.set(key, readers);
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
    for (const connection of [...readers])
      closeConnection(state, connection, "Ended");
  await state.parts.lane.close();
}

function hubState(parts: ThreadLiveParts): HubState {
  return {
    parts,
    limits: checkedThreadLiveLimits(parts.limits ?? threadLiveLimitsDefault),
    sessions: new Map(),
    readers: new Map(),
    source: "Lost",
    connectionsOpen: 0,
    heldBytes: 0,
    pendingBytes: 0,
    sentBytes: 0,
    eventsHeard: 0,
    payloadsUnread: 0,
    payloadsUnreadNoted: 0,
    payloadsShed: 0,
    payloadsShedNoted: 0,
    windowAtMs: 0,
    windowPayloads: 0,
    asking: false,
    stopped: false,
    heartbeat: undefined,
  };
}

/**
 * The lane is opened here rather than by the first reader, so a reader that
 * arrives while a message is being written is shown what was written before it
 * arrived.
 */
export function threadLiveHub(parts: ThreadLiveParts): ThreadLiveHub {
  const state = hubState(parts);
  state.heartbeat = parts.timers.repeat(state.limits.heartbeatMs, () => {
    ticked(state);
  });
  parts.lane.open({
    arrived: () => arrived(state),
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
