/**
 * What the thread live hub retains, measured: the heap in use once events are
 * heard, against what the hub itself counts as held.
 *
 * Every event is parsed from its own JSON, as the lane parses a payload, so
 * each string the hub is handed is a new one that nothing else holds. The
 * collector is run by name before each reading, which a flag set at run time
 * allows: a reading taken without it measures when the collector last ran.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";

import type { SessionLiveEvent } from "../../src/contract/sessionLive.ts";
import {
  asSessionId,
  asSessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import {
  threadLiveHub,
  threadLiveLimitsDefault,
  type ThreadLiveNote,
  type ThreadLiveWatcher,
} from "../../src/interpreter/threadLive.ts";
import { fakeTimers, partitionOf } from "./projectStreamHarness.ts";

v8.setFlagsFromString("--expose-gc");
const collect = vm.runInNewContext("gc") as () => void;

function heapUsedBytes(): number {
  collect();
  collect();
  return process.memoryUsage().heapUsed;
}

const partition = partitionOf("project");
const message = "message-1";

/** What a reading may be out by for reasons that are not the hub's: the code a first run compiles, and what the runner itself allocates. */
const slackBytes = 1_048_576;

interface Rig {
  hear(session: number, event: SessionLiveEvent): void;
  /** What the hub counts as held now. */
  heldBytes(): number;
}

/** A hub with no reader, every bound on what it holds set past what a case writes, so that nothing is dropped. */
function rigOf(): Rig {
  const notes: ThreadLiveNote[] = [];
  let watcher: ThreadLiveWatcher | undefined;
  const hub = threadLiveHub({
    lane: {
      open: (opened) => {
        watcher = opened;
      },
      close: () => Promise.resolve(),
    },
    timers: fakeTimers().timers,
    report: { noted: (note) => notes.push(note) },
    framed: JSON.stringify,
    limits: {
      ...threadLiveLimitsDefault,
      connectionsMax: 1,
      sessionsHeldMax: 4_096,
      heldBytesMax: Number.MAX_SAFE_INTEGER,
      windowEventsMax: Number.MAX_SAFE_INTEGER,
    },
  });
  const admitted = (): Promise<boolean> => Promise.resolve(true);
  hub.open({ partition, session: asSessionId("held"), admitted });
  return {
    hear: (session, event) =>
      watcher?.heard({
        partition,
        session: asSessionId(`session-${String(session)}`),
        turn: asSessionTurnId("turn-1"),
        event: JSON.parse(JSON.stringify(event)) as SessionLiveEvent,
      }),
    heldBytes: () => {
      hub.open({ partition, session: asSessionId("refused"), admitted });
      return notes.pop()?.heldBytes ?? Number.NaN;
    },
  };
}

function begun(index = 0): SessionLiveEvent {
  return { live: "Block", message, index, kind: "Text" };
}

function text(offset: number, written: string): SessionLiveEvent {
  return { live: "Text", message, index: 0, offset, text: written };
}

/** A block of `units` characters in `session`, written `perEvent` at a time. */
function appended(
  rig: Rig,
  session: number,
  units: number,
  perEvent: number,
  unit: string,
): void {
  const written = unit.repeat(perEvent);
  rig.hear(session, begun());
  for (let offset = 0; offset < units; offset += perEvent)
    rig.hear(session, text(offset, written));
}

/**
 * What `sessions` sessions, each written by `written`, left on the heap, and
 * what the hub counts them as holding. One session is written first on a hub
 * that is thrown away, so that what a first run compiles is not read as held.
 */
function measured(
  sessions: number,
  written: (rig: Rig, session: number) => void,
): { readonly retained: number; readonly counted: number } {
  written(rigOf(), 0);
  const before = heapUsedBytes();
  const rig = rigOf();
  for (let session = 0; session < sessions; session += 1) written(rig, session);
  const retained = heapUsedBytes() - before;
  return { retained, counted: rig.heldBytes() };
}

for (const [script, unit] of [
  ["one byte wide", "a"],
  ["two bytes wide", "中"],
] as const)
  test(`text appended one character at a time, ${script}, is retained as no more than it is counted`, () => {
    const sessions = 32;
    const units = 8_192;
    const { retained, counted } = measured(sessions, (rig, session) => {
      appended(rig, session, units, 1, unit);
    });
    assert.ok(counted >= 2 * sessions * units);
    assert.ok(
      retained <= counted + slackBytes,
      `retained ${String(retained)} bytes, counted ${String(counted)}`,
    );
  });

test("a block cut back to a few characters retains none of what it held before", () => {
  const sessions = 64;
  const units = threadLiveLimitsDefault.sessionTextBytesMax / 2;
  const { retained, counted } = measured(sessions, (rig, session) => {
    appended(rig, session, units, 512, "中");
    rig.hear(session, text(13, "b"));
  });
  assert.ok(counted < slackBytes);
  assert.ok(
    retained <= counted + slackBytes,
    `retained ${String(retained)} bytes, counted ${String(counted)}`,
  );
});

test("sessions holding every block a message may have, each named, are retained as no more than they are counted", () => {
  const sessions = 256;
  const blocks = 64;
  const { retained, counted } = measured(sessions, (rig, session) => {
    for (let index = 0; index < blocks; index += 1)
      rig.hear(session, {
        live: "Block",
        message,
        index,
        kind: "ToolUse",
        name: `Tool${String(index)}`,
      });
  });
  assert.ok(
    retained <= counted,
    `retained ${String(retained)} bytes, counted ${String(counted)}`,
  );
});
