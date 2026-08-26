/**
 * The doubles the project stream hub is driven through: a clock a case
 * advances, a log a case appends to, a doorbell a case rings, and sockets that
 * record what they were sent and can be made to stop draining.
 *
 * NOTHING HERE SLEEPS. The hub's work is started by a ring or a timer and
 * finished on the microtask queue, so a case drains that queue rather than
 * waiting an interval out — a case that waited would be asserting how fast the
 * machine is.
 */

import { setTimeout as delay } from "node:timers/promises";

import type {
  ProjectChangeDoorbell,
  ProjectChangeLog,
  ProjectChangeRow,
  ProjectChangeWatcher,
  ProjectResourceReader,
  ProjectStreamNote,
  ProjectStreamReport,
  ProjectStreamSink,
  ProjectStreamTimers,
} from "../../src/interpreter/projectStream.ts";
import type {
  ProjectSourceState,
  ProjectStreamEvent,
} from "../../src/contract/events.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/nativeWeb.ts";

export const streamPrincipal = asPrincipal("issuer\u0000subject");

/** A partition whose tenant a case may vary, because a project id alone is not one. */
export function partitionOf(project: string, tenant = "tenant"): Partition {
  return { tenant: asTenantId(tenant), project: asProjectId(project) };
}

/** A second principal, for the cases about what one stream's own read answers. */
export const otherStreamPrincipal = asPrincipal("issuer\u0000other-subject");

export function changeRow(
  sequence: number,
  partition: Partition,
  kind: ProjectChangeRow["kind"],
  resource: string,
): ProjectChangeRow {
  return { sequence, partition, kind, resource };
}

const settleTurnsMax = 20;

/** Drains the microtask and timer queues the hub finishes its reads on. */
export async function settled(): Promise<void> {
  for (let turn = 0; turn < settleTurnsMax; turn += 1) await delay(0);
}

interface Scheduled {
  at: number;
  readonly everyMs: number | undefined;
  readonly tick: () => void;
  cancelled: boolean;
}

export interface FakeTimers {
  readonly timers: ProjectStreamTimers;
  advance(byMs: number): void;
  setNowMs(nowMs: number): void;
}

export function fakeTimers(): FakeTimers {
  let nowMs = 0;
  const scheduled = new Set<Scheduled>();
  const add = (at: number, everyMs: number | undefined, tick: () => void) => {
    const entry: Scheduled = { at, everyMs, tick, cancelled: false };
    scheduled.add(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
        scheduled.delete(entry);
      },
    };
  };
  return {
    timers: {
      repeat: (everyMs, tick) => add(nowMs + everyMs, everyMs, tick),
      once: (afterMs, tick) => add(nowMs + afterMs, undefined, tick),
      nowMs: () => nowMs,
    },
    setNowMs: (value) => {
      nowMs = value;
    },
    advance: (byMs) => {
      const until = nowMs + byMs;
      for (;;) {
        const due = [...scheduled]
          .filter((entry) => !entry.cancelled && entry.at <= until)
          .sort((left, right) => left.at - right.at)[0];
        if (due === undefined) break;
        nowMs = due.at;
        if (due.everyMs === undefined) scheduled.delete(due);
        else due.at += due.everyMs;
        due.tick();
      }
      nowMs = until;
    },
  };
}

export interface FakeLog {
  readonly log: ProjectChangeLog;
  append(row: ProjectChangeRow): void;
  readonly swept: number[];
  /** What the next sweeps answer, so a case drives the note without moving rows. */
  removes(count: number): void;
  /** Makes every later sweep refuse, which is what a revoked grant looks like. */
  refusesSweeps(): void;
  /** Drops every row below the sequence, which is what retention does. */
  sweepBelow(sequence: number): void;
  /** Holds every later replay read until the returned release is called. */
  holdsReplays(): () => void;
  /** Makes every later replay read reject, which is a read that failed rather than a gap. */
  failsReplays(): void;
  readonly reads: string[];
}

export function fakeLog(seed: readonly ProjectChangeRow[] = []): FakeLog {
  let rows = [...seed];
  const reads: string[] = [];
  const swept: number[] = [];
  let removed = 0;
  let held: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let replaysFail = false;
  let refuses = false;
  const samePartition = (row: ProjectChangeRow, partition: Partition) =>
    row.partition.tenant === partition.tenant &&
    row.partition.project === partition.project;
  return {
    reads,
    swept,
    removes: (count) => {
      removed = count;
    },
    refusesSweeps: () => {
      refuses = true;
    },
    append: (row) => {
      rows.push(row);
    },
    sweepBelow: (sequence) => {
      rows = rows.filter((row) => row.sequence >= sequence);
    },
    holdsReplays: () => {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release?.();
    },
    failsReplays: () => {
      replaysFail = true;
    },
    log: {
      latest: () => Promise.resolve(rows.at(-1)?.sequence ?? 0),
      since: (after, limit) => {
        reads.push(`since:${String(after)}`);
        return Promise.resolve(
          rows.filter((row) => row.sequence > after).slice(0, limit),
        );
      },
      retains: (sequence) =>
        Promise.resolve(
          rows.length === 0 || sequence >= (rows[0]?.sequence ?? 1) - 1,
        ),
      after: async (partition, sequence, limit) => {
        const answer = rows
          .filter(
            (row) => samePartition(row, partition) && row.sequence > sequence,
          )
          .slice(0, limit);
        await held;
        if (replaysFail) throw new Error("the replay could not be read");
        return answer;
      },
      sweep: (rowsMax) => {
        swept.push(rowsMax);
        return refuses
          ? Promise.reject(new Error("the sweep was refused"))
          : Promise.resolve(Math.min(rowsMax, removed));
      },
    },
  };
}

export interface FakeDoorbell {
  readonly doorbell: ProjectChangeDoorbell;
  ring(): void;
  source(state: ProjectSourceState): void;
  readonly closed: () => boolean;
}

export function fakeDoorbell(): FakeDoorbell {
  let watcher: ProjectChangeWatcher | undefined;
  let closed = false;
  return {
    closed: () => closed,
    ring: () => watcher?.rang(),
    source: (state) => watcher?.sourced(state),
    doorbell: {
      open: (opened) => {
        watcher = opened;
      },
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    },
  };
}

export interface FakeReader {
  readonly reader: ProjectResourceReader;
  readonly reads: string[];
  tombstone(resource: string): void;
  /** Makes every read under this principal answer as the GET's not-found does. */
  refuses(principal: Principal): void;
  /** Makes every read of this resource reject, which is a fault rather than a refusal. */
  fails(resource: string): void;
  /** Makes the next read of this resource reject and every later one succeed. */
  failsOnce(resource: string): void;
}

/**
 * The two kinds the hub's own cases use, as the bodies their GET routes answer
 * with. Every other kind throws, because a body the contract does not describe
 * is a frame the hub refuses, and a case meaning to send one should say so
 * rather than discover it.
 */
function representation(
  partition: Partition,
  kind: ProjectChangeRow["kind"],
  resource: string,
): Readonly<Record<string, unknown>> {
  if (kind === "Project")
    return { tenant: partition.tenant, project: partition.project };
  if (kind === "Ticket")
    return { ticket: Number(resource), phase: "Working", sequence: 1 };
  throw new Error(`the stream harness has no ${kind} representation`);
}

export function fakeReader(): FakeReader {
  const reads: string[] = [];
  const gone = new Set<string>();
  const refused = new Set<Principal>();
  const failing = new Set<string>();
  const failingOnce = new Set<string>();
  return {
    reads,
    tombstone: (resource) => gone.add(resource),
    refuses: (principal) => refused.add(principal),
    fails: (resource) => failing.add(resource),
    failsOnce: (resource) => failingOnce.add(resource),
    reader: {
      read: (principal, partition, kind, resource) => {
        reads.push(`${kind}:${resource}`);
        if (failing.has(resource) || failingOnce.delete(resource))
          return Promise.reject(new Error(`${resource} could not be read`));
        return Promise.resolve(
          gone.has(resource) || refused.has(principal)
            ? null
            : representation(partition, kind, resource),
        );
      },
    },
  };
}

export interface FakeSocket {
  readonly sink: ProjectStreamSink;
  readonly frames: ProjectStreamEvent[];
  beats(): number;
  ended(): boolean;
  stall(): void;
  drain(): void;
  /** Makes every later write throw, which is what a socket torn down mid-write does. */
  breaks(): void;
  mends(): void;
}

export function fakeSocket(): FakeSocket {
  const frames: ProjectStreamEvent[] = [];
  let beats = 0;
  let ended = false;
  let draining = true;
  let broken = false;
  let drained: (() => void) | undefined;
  return {
    frames,
    breaks: () => {
      broken = true;
    },
    mends: () => {
      broken = false;
    },
    beats: () => beats,
    ended: () => ended,
    stall: () => {
      draining = false;
    },
    drain: () => {
      draining = true;
      const waiting = drained;
      drained = undefined;
      waiting?.();
    },
    sink: {
      send: (event) => {
        if (broken) throw new Error("the socket is gone");
        frames.push(event);
        return draining;
      },
      beat: () => {
        beats += 1;
        return draining;
      },
      whenDrained: (handler) => {
        drained = handler;
      },
      end: () => {
        ended = true;
      },
    },
  };
}

export interface FakeReport {
  readonly report: ProjectStreamReport;
  readonly notes: ProjectStreamNote[];
}

export function fakeReport(): FakeReport {
  const notes: ProjectStreamNote[] = [];
  return { notes, report: { noted: (note) => notes.push(note) } };
}

/** The kinds and resources a socket was sent, which is what every case reads. */
export function frameNames(socket: FakeSocket): string[] {
  return socket.frames.map((event) =>
    event.event === "ready" || event.event === "reset"
      ? event.event
      : event.event === "source"
        ? `source:${event.data.state}`
        : `${event.event}:${event.data.resource}:${String(event.sequence)}`,
  );
}
