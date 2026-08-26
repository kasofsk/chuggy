/**
 * The project event stream's hub: one reader of the durable change log per
 * process, fanning each row out as the changed resource's own representation to
 * the streams open on that row's partition.
 *
 * THE LOG IS READ PAST A CURSOR RATHER THAN FROM THE DOORBELL'S PAYLOAD.
 * `pg_notify` coalesces an identical payload, so a ring is a hint that there is
 * work and never the work itself. The bounded sweep is the same read on a
 * timer, which is what makes a missed ring cost latency instead of correctness.
 *
 * ONE READ PER PRINCIPAL, NOT PER BROWSER AND NOT PER PARTITION. Two streams
 * held by the same principal are answered the same thing and share one read; two
 * held by different principals do not, because access is revalidated by nothing
 * once a stream is open, and one principal's refusal read as everybody's would
 * tombstone a resource the others are entitled to. A batch is deduplicated by
 * kind and identity first, so a resource that moved twice is read once per
 * principal and sent once, under the newer sequence.
 *
 * A ROW NOBODY COULD BE READ FOR BECOMES A RESET, never a row skipped: the read
 * is retried within its budget, and a batch the hub could not finish delivering
 * leaves the cursor where it was, so the next read sees those rows again.
 *
 * THE HUB IS ALSO WHAT TRIMS THE LOG. Retention is a bounded delete rather than
 * work an append carries, and this is the one process in the installation that
 * already runs a timer over the whole log; a writer paying for it would pay per
 * row, on the transaction that wrote it.
 *
 * A RECOVERED DOORBELL RESETS RATHER THAN REPLAYS, unless nothing was appended
 * while it was down. Retention is a count per project, so the hub cannot prove
 * that every row it missed is still there to replay, and `reset` is the
 * contract's honest answer to a gap it cannot rule out — a browser answers one
 * by refetching, which a gap would have required anyway.
 *
 * EVERY DIMENSION IS BOUNDED: how many streams are open, how long one lives,
 * how many rows one read takes, how long a socket may stay behind, and how much
 * a behind socket keeps — the last by coalescing to the latest representation
 * per resource rather than by queueing every frame it missed.
 */

import {
  projectChangeDataSchemas,
  projectStreamVersion,
  type ProjectChangeKind,
  type ProjectSourceState,
  type ProjectStreamEvent,
} from "../contract/events.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { Principal } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";

export interface ProjectChangeRow {
  readonly sequence: number;
  readonly partition: Partition;
  readonly kind: ProjectChangeKind;
  readonly resource: string;
}

/** Bounded reads of the durable change log, none of which take a project lock. */
export interface ProjectChangeLog {
  latest(): Promise<number>;
  since(after: number, limit: number): Promise<readonly ProjectChangeRow[]>;
  /** Whether nothing above this sequence has been swept, which retention decides for the installation. */
  retains(sequence: number): Promise<boolean>;
  after(
    partition: Partition,
    sequence: number,
    limit: number,
  ): Promise<readonly ProjectChangeRow[]>;
  /** Trims the log to its retention, removing at most this many rows, and answers how many it removed. */
  sweep(rowsMax: number): Promise<number>;
}

/** What the doorbell's own connection tells the hub: that it rang, and how it is. */
export interface ProjectChangeWatcher {
  rang(): void;
  sourced(state: ProjectSourceState): void;
}

export interface ProjectChangeDoorbell {
  open(watcher: ProjectChangeWatcher): void;
  close(): Promise<void>;
}

/** One kind's GET, read for one resource: its body, or null once it is gone. */
export interface ProjectResourceReader {
  read(
    principal: Principal,
    partition: Partition,
    kind: ProjectChangeKind,
    resource: string,
  ): Promise<Readonly<Record<string, unknown>> | null>;
}

/** One open socket, which answers false as soon as it stops keeping up. */
export interface ProjectStreamSink {
  send(event: ProjectStreamEvent): boolean;
  beat(): boolean;
  whenDrained(drained: () => void): void;
  end(): void;
}

export interface ProjectStreamTimer {
  cancel(): void;
}

export interface ProjectStreamTimers {
  repeat(everyMs: number, tick: () => void): ProjectStreamTimer;
  once(afterMs: number, tick: () => void): ProjectStreamTimer;
  nowMs(): number;
}

export interface ProjectStreamLimits {
  readonly connectionsMax: number;
  readonly maxAgeMs: number;
  readonly heartbeatMs: number;
  readonly slowClientWaitMs: number;
  readonly sweepMs: number;
  readonly batchRowsMax: number;
  readonly replayRowsMax: number;
  readonly sweepRowsMax: number;
  readonly rowAttemptsMax: number;
  readonly heldResourcesMax: number;
}

export const projectStreamLimitsDefault: ProjectStreamLimits = {
  connectionsMax: 256,
  maxAgeMs: 300_000,
  heartbeatMs: 20_000,
  slowClientWaitMs: 10_000,
  sweepMs: 5_000,
  batchRowsMax: 500,
  replayRowsMax: 1_000,
  sweepRowsMax: 1_000,
  rowAttemptsMax: 2,
  heldResourcesMax: 2_000,
};

export function checkedProjectStreamLimits(
  limits: ProjectStreamLimits,
): ProjectStreamLimits {
  for (const [what, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`${what} must be a positive integer`);
  return limits;
}

export type ProjectStreamNoteDetail =
  | { readonly note: "Sourced"; readonly state: ProjectSourceState }
  | { readonly note: "Refused" }
  | { readonly note: "SlowClientClosed" }
  | { readonly note: "Swept"; readonly removed: number }
  | { readonly note: "ReadFailed"; readonly failure: string };

/** What an operator is told, each note carrying the totals current when it happened. */
export type ProjectStreamNote = ProjectStreamNoteDetail & {
  readonly streamsOpen: number;
  readonly rowsRead: number;
};

export interface ProjectStreamReport {
  noted(note: ProjectStreamNote): void;
}

export interface ProjectStreamOpening {
  readonly partition: Partition;
  readonly principal: Principal;
  readonly after?: number | undefined;
  readonly expiresAtMs?: number | undefined;
}

/**
 * A stream that has been admitted and has read everything it opens with, and
 * has not been given a socket yet. Nothing it holds has been written, so a
 * caller that has not answered its request can still answer it any way it likes.
 */
export interface ProjectStream {
  begin(sink: ProjectStreamSink): void;
  close(): void;
}

export type ProjectStreamOpened =
  | { readonly opened: "Opened"; readonly stream: ProjectStream }
  | { readonly opened: "AtCapacity" };

export interface ProjectStreamHub {
  open(opening: ProjectStreamOpening): Promise<ProjectStreamOpened>;
  close(): Promise<void>;
}

export interface ProjectStreamParts {
  readonly log: ProjectChangeLog;
  readonly doorbell: ProjectChangeDoorbell;
  readonly reader: ProjectResourceReader;
  readonly timers: ProjectStreamTimers;
  readonly report: ProjectStreamReport;
  readonly limits?: ProjectStreamLimits;
}

interface OpenStream {
  readonly partition: Partition;
  readonly principal: Principal;
  sink: ProjectStreamSink | undefined;
  lifetime: ProjectStreamTimer | undefined;
  held: Map<string, ProjectStreamEvent> | undefined;
  behind: ProjectStreamTimer | undefined;
  closed: boolean;
}

interface HubState {
  readonly parts: ProjectStreamParts;
  readonly limits: ProjectStreamLimits;
  readonly partitions: Map<string, Set<OpenStream>>;
  cursor: number;
  source: ProjectSourceState;
  rowsRead: number;
  streamsOpen: number;
  pumping: boolean;
  pumpAgain: boolean;
  stopped: boolean;
  starting: Promise<void> | undefined;
  heartbeat: ProjectStreamTimer | undefined;
  sweep: ProjectStreamTimer | undefined;
}

function partitionKey(partition: Partition): string {
  return `${String(partition.tenant.length)}:${partition.tenant}${partition.project}`;
}

/** Control frames share one slot each, so a coalescing hold never drops one. */
function eventKey(event: ProjectStreamEvent): string {
  return event.event === "ready" ||
    event.event === "reset" ||
    event.event === "source"
    ? ` ${event.event}`
    : `${event.event} ${event.data.resource}`;
}

/**
 * One frame, parsed by the schema the contract pins for that kind, so a
 * representation the contract does not describe is a fault here rather than a
 * shape a browser has to survive.
 */
function changeEvent(
  row: ProjectChangeRow,
  representation: Readonly<Record<string, unknown>> | null,
): ProjectStreamEvent {
  const schemas = projectChangeDataSchemas;
  const sequence = row.sequence;
  const carried = {
    version: projectStreamVersion,
    resource: row.resource,
    representation,
  };
  switch (row.kind) {
    case "Operation":
      return {
        event: row.kind,
        sequence,
        data: schemas.Operation.parse(carried),
      };
    case "Ticket":
      return { event: row.kind, sequence, data: schemas.Ticket.parse(carried) };
    case "Draft":
      return { event: row.kind, sequence, data: schemas.Draft.parse(carried) };
    case "Configuration":
      return {
        event: row.kind,
        sequence,
        data: schemas.Configuration.parse(carried),
      };
    case "Project":
      return {
        event: row.kind,
        sequence,
        data: schemas.Project.parse(carried),
      };
    case "Execution":
      return {
        event: row.kind,
        sequence,
        data: schemas.Execution.parse(carried),
      };
    default:
      return assertNever(row.kind);
  }
}

function readyEvent(): ProjectStreamEvent {
  return { event: "ready", data: { version: projectStreamVersion } };
}

function resetEvent(): ProjectStreamEvent {
  return { event: "reset", data: { version: projectStreamVersion } };
}

function sourceEvent(state: ProjectSourceState): ProjectStreamEvent {
  return { event: "source", data: { version: projectStreamVersion, state } };
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : "unknown failure";
}

/** Newest wins per identity, at the newest one's place in the batch's order. */
function deduplicated(
  rows: readonly ProjectChangeRow[],
): readonly ProjectChangeRow[] {
  const latest = new Map<string, ProjectChangeRow>();
  for (const row of rows) {
    const key = `${row.kind} ${row.resource}`;
    latest.delete(key);
    latest.set(key, row);
  }
  return [...latest.values()];
}

function noted(state: HubState, detail: ProjectStreamNoteDetail): void {
  state.parts.report.noted({
    ...detail,
    streamsOpen: state.streamsOpen,
    rowsRead: state.rowsRead,
  });
}

function closeStream(state: HubState, stream: OpenStream): void {
  if (stream.closed) return;
  stream.closed = true;
  stream.lifetime?.cancel();
  stream.behind?.cancel();
  const key = partitionKey(stream.partition);
  const streams = state.partitions.get(key);
  if (streams?.delete(stream) === true && streams.size === 0)
    state.partitions.delete(key);
  state.streamsOpen -= 1;
  stream.sink?.end();
}

function fellBehind(state: HubState, stream: OpenStream): void {
  if (stream.behind !== undefined || stream.closed) return;
  stream.held ??= new Map();
  const sink = stream.sink;
  if (sink === undefined) return;
  stream.behind = state.parts.timers.once(state.limits.slowClientWaitMs, () => {
    noted(state, { note: "SlowClientClosed" });
    closeStream(state, stream);
  });
  sink.whenDrained(() => {
    flush(state, stream);
  });
}

function deliver(
  state: HubState,
  stream: OpenStream,
  event: ProjectStreamEvent,
): void {
  if (stream.closed) return;
  const sink = stream.sink;
  if (stream.held !== undefined || sink === undefined) {
    const held = (stream.held ??= new Map());
    const key = eventKey(event);
    held.delete(key);
    held.set(key, event);
    if (held.size > state.limits.heldResourcesMax) {
      noted(state, { note: "SlowClientClosed" });
      closeStream(state, stream);
    }
    return;
  }
  if (!sink.send(event)) fellBehind(state, stream);
}

function flush(state: HubState, stream: OpenStream): void {
  if (stream.closed) return;
  const held = stream.held;
  stream.held = undefined;
  stream.behind?.cancel();
  stream.behind = undefined;
  for (const event of held?.values() ?? []) deliver(state, stream, event);
}

function broadcast(state: HubState, event: ProjectStreamEvent): void {
  for (const streams of state.partitions.values())
    for (const stream of [...streams]) deliver(state, stream, event);
}

/**
 * One row read under every principal watching its partition, once each rather
 * than once per stream, so a stream that has lost its access is told about its
 * own read and no other stream is told about that one.
 */
async function readRow(
  state: HubState,
  streams: ReadonlySet<OpenStream>,
  row: ProjectChangeRow,
): Promise<ReadonlyMap<Principal, ProjectStreamEvent>> {
  const seen = new Map<Principal, ProjectStreamEvent>();
  for (const stream of [...streams]) {
    if (stream.closed || seen.has(stream.principal)) continue;
    const representation = await state.parts.reader.read(
      stream.principal,
      row.partition,
      row.kind,
      row.resource,
    );
    seen.set(stream.principal, changeEvent(row, representation));
  }
  return seen;
}

/**
 * The frames a row becomes, retried within its budget; nothing when the row
 * could not be read at all, which is a reset rather than a row dropped in
 * silence — silence is a gap the recovery model has no answer for.
 */
async function framesForRow(
  state: HubState,
  streams: ReadonlySet<OpenStream>,
  row: ProjectChangeRow,
): Promise<ReadonlyMap<Principal, ProjectStreamEvent> | undefined> {
  for (let attempt = 1; attempt <= state.limits.rowAttemptsMax; attempt += 1) {
    try {
      return await readRow(state, streams, row);
    } catch (failure: unknown) {
      if (attempt === state.limits.rowAttemptsMax)
        noted(state, { note: "ReadFailed", failure: failureText(failure) });
    }
  }
  return undefined;
}

async function fanOut(
  state: HubState,
  rows: readonly ProjectChangeRow[],
): Promise<void> {
  for (const [key, streams] of [...state.partitions]) {
    const mine = rows.filter((row) => partitionKey(row.partition) === key);
    for (const row of deduplicated(mine)) {
      const frames = await framesForRow(state, streams, row);
      for (const stream of [...streams]) {
        const event = frames?.get(stream.principal);
        deliver(state, stream, event ?? resetEvent());
      }
    }
  }
}

async function readOnce(state: HubState): Promise<void> {
  const rows = await state.parts.log.since(
    state.cursor,
    state.limits.batchRowsMax,
  );
  if (rows.length === 0) return;
  await fanOut(state, rows);
  state.rowsRead += rows.length;
  state.cursor = rows[rows.length - 1]?.sequence ?? state.cursor;
  if (rows.length === state.limits.batchRowsMax) state.pumpAgain = true;
}

async function pump(state: HubState): Promise<void> {
  if (state.stopped) return;
  if (state.pumping) {
    state.pumpAgain = true;
    return;
  }
  state.pumping = true;
  try {
    do {
      state.pumpAgain = false;
      await readOnce(state);
    } while (state.pumpAgain && !state.stopped);
  } catch (failure: unknown) {
    noted(state, { note: "ReadFailed", failure: failureText(failure) });
  } finally {
    state.pumping = false;
  }
}

async function trim(state: HubState): Promise<void> {
  try {
    const removed = await state.parts.log.sweep(state.limits.sweepRowsMax);
    if (removed > 0) noted(state, { note: "Swept", removed });
  } catch (failure: unknown) {
    noted(state, { note: "ReadFailed", failure: failureText(failure) });
  }
}

async function recovered(state: HubState): Promise<void> {
  const latest = await state.parts.log.latest();
  if (latest === state.cursor) return;
  state.cursor = latest;
  broadcast(state, resetEvent());
}

function sourced(state: HubState, source: ProjectSourceState): void {
  if (source === state.source) return;
  state.source = source;
  noted(state, { note: "Sourced", state: source });
  broadcast(state, sourceEvent(source));
  if (source !== "live") return;
  void recovered(state).catch((failure: unknown) => {
    noted(state, { note: "ReadFailed", failure: failureText(failure) });
  });
}

function beatAll(state: HubState): void {
  for (const streams of state.partitions.values())
    for (const stream of [...streams])
      if (stream.held === undefined && stream.sink?.beat() === false)
        fellBehind(state, stream);
}

async function listen(state: HubState): Promise<void> {
  state.cursor = await state.parts.log.latest();
  state.parts.doorbell.open({
    rang: () => void pump(state),
    sourced: (source) => {
      sourced(state, source);
    },
  });
  const timers = state.parts.timers;
  state.heartbeat = timers.repeat(state.limits.heartbeatMs, () => {
    beatAll(state);
  });
  state.sweep = timers.repeat(state.limits.sweepMs, () => {
    void pump(state);
    void trim(state);
  });
}

function started(state: HubState): Promise<void> {
  state.starting ??= listen(state);
  return state.starting;
}

/** Everything a stream opens with, read before it has a socket to fail on. */
async function openingFrames(
  state: HubState,
  stream: OpenStream,
  after: number | undefined,
): Promise<readonly ProjectStreamEvent[]> {
  if (after === undefined) return [readyEvent()];
  if (!(await state.parts.log.retains(after))) return [resetEvent()];
  const rows = await state.parts.log.after(
    stream.partition,
    after,
    state.limits.replayRowsMax + 1,
  );
  if (rows.length > state.limits.replayRowsMax) return [resetEvent()];
  const frames: ProjectStreamEvent[] = [];
  for (const row of deduplicated(rows)) {
    const representation = await state.parts.reader.read(
      stream.principal,
      row.partition,
      row.kind,
      row.resource,
    );
    frames.push(changeEvent(row, representation));
  }
  return frames;
}

function lifetimeMs(state: HubState, opening: ProjectStreamOpening): number {
  const remaining =
    opening.expiresAtMs === undefined
      ? state.limits.maxAgeMs
      : opening.expiresAtMs - state.parts.timers.nowMs();
  return Math.max(1, Math.min(state.limits.maxAgeMs, remaining));
}

function admit(state: HubState, opening: ProjectStreamOpening): OpenStream {
  const stream: OpenStream = {
    partition: opening.partition,
    principal: opening.principal,
    sink: undefined,
    lifetime: undefined,
    held: new Map(),
    behind: undefined,
    closed: false,
  };
  stream.lifetime = state.parts.timers.once(lifetimeMs(state, opening), () => {
    closeStream(state, stream);
  });
  const key = partitionKey(opening.partition);
  const streams = state.partitions.get(key) ?? new Set<OpenStream>();
  streams.add(stream);
  state.partitions.set(key, streams);
  state.streamsOpen += 1;
  return stream;
}

async function openStream(
  state: HubState,
  opening: ProjectStreamOpening,
): Promise<ProjectStreamOpened> {
  if (state.stopped || state.streamsOpen >= state.limits.connectionsMax) {
    noted(state, { note: "Refused" });
    return { opened: "AtCapacity" };
  }
  await started(state);
  const stream = admit(state, opening);
  let frames: readonly ProjectStreamEvent[];
  try {
    frames = await openingFrames(state, stream, opening.after);
  } catch (failure: unknown) {
    closeStream(state, stream);
    throw failure;
  }
  return {
    opened: "Opened",
    stream: {
      begin: (sink) => {
        begin(state, stream, sink, frames);
      },
      close: () => {
        closeStream(state, stream);
      },
    },
  };
}

/**
 * Attaches the socket and writes the opening frames before anything the stream
 * held while it was being read for, so a live event never precedes the `ready`
 * or `reset` that answers the request.
 */
function begin(
  state: HubState,
  stream: OpenStream,
  sink: ProjectStreamSink,
  frames: readonly ProjectStreamEvent[],
): void {
  if (stream.closed) {
    sink.end();
    return;
  }
  stream.sink = sink;
  let draining = true;
  for (const frame of [...frames, sourceEvent(state.source)])
    draining = sink.send(frame) && draining;
  if (draining) flush(state, stream);
  else fellBehind(state, stream);
}

async function closeHub(state: HubState): Promise<void> {
  state.stopped = true;
  state.heartbeat?.cancel();
  state.sweep?.cancel();
  for (const streams of [...state.partitions.values()])
    for (const stream of [...streams]) closeStream(state, stream);
  if (state.starting !== undefined) await state.parts.doorbell.close();
}

export function projectStreamHub(parts: ProjectStreamParts): ProjectStreamHub {
  const state: HubState = {
    parts,
    limits: checkedProjectStreamLimits(
      parts.limits ?? projectStreamLimitsDefault,
    ),
    partitions: new Map(),
    cursor: 0,
    source: "live",
    rowsRead: 0,
    streamsOpen: 0,
    pumping: false,
    pumpAgain: false,
    stopped: false,
    starting: undefined,
    heartbeat: undefined,
    sweep: undefined,
  };
  return {
    open: (opening) => openStream(state, opening),
    close: () => closeHub(state),
  };
}
