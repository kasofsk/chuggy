/**
 * The hub's own claims, against fakes for the log, the doorbell and the clock:
 * what a resuming consumer is told, what a failed read becomes, and what a
 * stream past capacity is answered with.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectStreamEvent } from "../../src/contract/events.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  projectStreamHub,
  projectStreamLimitsDefault,
  type ProjectChangeRow,
  type ProjectChangeWatcher,
  type ProjectStreamLimits,
  type ProjectStreamNote,
  type ProjectStreamParts,
  type ProjectStreamSink,
} from "../../src/interpreter/projectStream.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const principal = asPrincipal("reader");

function row(sequence: number, resource: string): ProjectChangeRow {
  return { sequence, partition, kind: "Ticket", resource };
}

/** A socket that keeps up, recording every frame it is handed. */
function recordingSink(): ProjectStreamSink & {
  readonly frames: readonly ProjectStreamEvent[];
} {
  const frames: ProjectStreamEvent[] = [];
  return {
    frames,
    send: (event) => {
      frames.push(event);
      return true;
    },
    beat: () => true,
    whenDrained: () => undefined,
    end: () => undefined,
  };
}

interface Harness {
  readonly parts: ProjectStreamParts;
  readonly notes: readonly ProjectStreamNote[];
  readonly reads: readonly string[];
  watcher: ProjectChangeWatcher | undefined;
}

function harness(
  over: {
    readonly latest?: readonly number[];
    readonly retains?: boolean;
    readonly replay?: readonly ProjectChangeRow[];
    readonly since?: readonly ProjectChangeRow[];
    readonly read?: () => Promise<Readonly<Record<string, unknown>> | null>;
    readonly limits?: Partial<ProjectStreamLimits>;
  } = {},
): Harness {
  const notes: ProjectStreamNote[] = [];
  const reads: string[] = [];
  let pending = over.since ?? [];
  const latest = [...(over.latest ?? [])];
  const held: Harness = {
    watcher: undefined,
    notes,
    reads,
    parts: {
      log: {
        latest: () => Promise.resolve(latest.shift() ?? 0),
        since: () => {
          const batch = pending;
          pending = [];
          return Promise.resolve(batch);
        },
        retains: () => Promise.resolve(over.retains ?? true),
        after: () => Promise.resolve(over.replay ?? []),
      },
      doorbell: {
        open: (watcher) => {
          held.watcher = watcher;
        },
        close: () => Promise.resolve(),
      },
      reader: {
        read: (_principal, _partition, _kind, resource) => {
          reads.push(resource);
          return over.read === undefined
            ? Promise.resolve({ resource })
            : over.read();
        },
      },
      timers: {
        repeat: () => ({ cancel: () => undefined }),
        once: () => ({ cancel: () => undefined }),
        nowMs: () => 0,
      },
      report: {
        noted: (note) => {
          notes.push(note);
        },
      },
      limits: { ...projectStreamLimitsDefault, ...over.limits },
    },
  };
  return held;
}

test("a cursor the log no longer retains is reset rather than replayed", async () => {
  const held = harness({ retains: false, replay: [row(2, "7")] });
  const hub = projectStreamHub(held.parts);
  const opened = await hub.open({ partition, principal, after: 1 });
  assert.equal(opened.opened, "Opened");
  if (opened.opened !== "Opened") throw new Error("expected an opened stream");
  const sink = recordingSink();
  opened.stream.begin(sink);
  assert.deepEqual(
    sink.frames.map((frame) => frame.event),
    ["reset", "source"],
    "a consumer past retention is told to reload, not handed a partial replay",
  );
  assert.deepEqual(held.reads, [], "nothing past retention is read for replay");
  await hub.close();
});

test("a cursor inside retention replays its partition's rows", async () => {
  const held = harness({ retains: true, replay: [row(2, "7")] });
  const hub = projectStreamHub(held.parts);
  const opened = await hub.open({ partition, principal, after: 1 });
  if (opened.opened !== "Opened") throw new Error("expected an opened stream");
  const sink = recordingSink();
  opened.stream.begin(sink);
  assert.deepEqual(
    sink.frames.map((frame) => frame.event),
    ["Ticket", "source"],
    "a retained cursor is replayed rather than reset",
  );
  await hub.close();
});

test("a stream opening with no cursor is told it is ready", async () => {
  const held = harness();
  const hub = projectStreamHub(held.parts);
  const opened = await hub.open({ partition, principal });
  if (opened.opened !== "Opened") throw new Error("expected an opened stream");
  const sink = recordingSink();
  opened.stream.begin(sink);
  assert.deepEqual(
    sink.frames.map((frame) => frame.event),
    ["ready", "source"],
  );
  await hub.close();
});

test("a resource that moved twice is read once and sent once", async () => {
  const held = harness({ since: [row(1, "7"), row(2, "7"), row(3, "8")] });
  const hub = projectStreamHub(held.parts);
  const opened = await hub.open({ partition, principal });
  if (opened.opened !== "Opened") throw new Error("expected an opened stream");
  const sink = recordingSink();
  opened.stream.begin(sink);
  held.watcher?.rang();
  await new Promise((settled) => setImmediate(settled));
  assert.deepEqual(
    held.reads,
    ["7", "8"],
    "a resource that moved twice in one batch is read once",
  );
  assert.deepEqual(
    sink.frames.flatMap((frame) =>
      frame.event === "Ticket" ? [frame.sequence] : [],
    ),
    [2, 3],
    "the newer sequence is the one delivered",
  );
  await hub.close();
});

test("a row that could not be read becomes a reset, never a row dropped", async () => {
  const held = harness({
    since: [row(1, "7")],
    read: () => Promise.reject(new Error("the read failed")),
    limits: { rowAttemptsMax: 1 },
  });
  const hub = projectStreamHub(held.parts);
  const opened = await hub.open({ partition, principal });
  if (opened.opened !== "Opened") throw new Error("expected an opened stream");
  const sink = recordingSink();
  opened.stream.begin(sink);
  held.watcher?.rang();
  await new Promise((settled) => setImmediate(settled));
  assert.deepEqual(
    sink.frames.map((frame) => frame.event),
    ["ready", "source", "reset"],
    "a row nobody could be read for is a reset rather than silence",
  );
  assert.deepEqual(
    held.notes.map((note) => note.note),
    ["ReadFailed"],
  );
  await hub.close();
});

test("a stream past the connection bound is refused before it holds one", async () => {
  const held = harness({ limits: { connectionsMax: 1 } });
  const hub = projectStreamHub(held.parts);
  const first = await hub.open({ partition, principal });
  assert.equal(first.opened, "Opened");
  const second = await hub.open({ partition, principal });
  assert.equal(
    second.opened,
    "AtCapacity",
    "a refusal is decided before a socket is handed over",
  );
  assert.deepEqual(
    held.notes.map((note) => note.note),
    ["Refused"],
  );
  await hub.close();
});

/** What one open stream was told across a doorbell losing and regaining itself. */
async function acrossARecovery(latest: readonly number[]) {
  const held = harness({ latest });
  const hub = projectStreamHub(held.parts);
  const opened = await hub.open({ partition, principal });
  if (opened.opened !== "Opened") throw new Error("expected an opened stream");
  const sink = recordingSink();
  opened.stream.begin(sink);
  held.watcher?.sourced("degraded");
  held.watcher?.sourced("live");
  await new Promise((settled) => setImmediate(settled));
  await hub.close();
  return { held, events: sink.frames.map((frame) => frame.event) };
}

test("a doorbell that recovered over an append resets rather than replays", async () => {
  const { held, events } = await acrossARecovery([0, 9]);
  assert.deepEqual(
    events,
    ["ready", "source", "source", "source", "reset"],
    "a gap the hub cannot rule out is answered with a reset, not a replay",
  );
  assert.deepEqual(held.reads, [], "nothing across the gap is read for replay");
});

test("a doorbell that recovered over nothing resets no stream", async () => {
  const { events } = await acrossARecovery([4, 4]);
  assert.deepEqual(
    events,
    ["ready", "source", "source", "source"],
    "a doorbell that missed no append costs its streams nothing",
  );
});

test("every limit must be a positive whole number", () => {
  const held = harness({ limits: { batchRowsMax: 0 } });
  assert.throws(() => projectStreamHub(held.parts), RangeError);
});
