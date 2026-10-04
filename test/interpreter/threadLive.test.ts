/**
 * The thread live hub as a pure unit: a lane a case speaks through, a clock a
 * case advances, and sockets that record what they were sent.
 *
 * What a reader was sent is read two ways. The frames themselves say what was
 * sent and when, and `heldBy` folds them as a console does, which is what says
 * a reader was left holding what the hub holds.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionLiveEvent } from "../../src/contract/sessionLive.ts";
import {
  threadLiveHeard,
  threadLiveNothing,
  threadLiveVersion,
  type ThreadLiveHeld,
  type ThreadLiveStreamEvent,
} from "../../src/contract/threadLive.ts";
import {
  asSessionId,
  asSessionTurnId,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  threadLiveHub,
  threadLiveLimitsDefault,
  type ThreadLiveHub,
  type ThreadLiveLimits,
  type ThreadLiveNote,
  type ThreadLiveSource,
  type ThreadLiveWatcher,
} from "../../src/interpreter/threadLive.ts";
import {
  fakeSocket,
  fakeTimers,
  partitionOf,
  type FakeSocket,
  type FakeTimers,
} from "./projectStreamHarness.ts";

type Socket = FakeSocket<ThreadLiveStreamEvent>;

const project = partitionOf("project");
const one = asSessionId("session-1");
const two = asSessionId("session-2");
const turn = asSessionTurnId("turn-1");
const message = "message-1";

function begun(index = 0): SessionLiveEvent {
  return { live: "Block", message, index, kind: "Text" };
}

function text(offset: number, written: string, index = 0): SessionLiveEvent {
  return { live: "Text", message, index, offset, text: written };
}

const ended: SessionLiveEvent = { live: "End" };

function snapshotOf(held: ThreadLiveHeld): ThreadLiveStreamEvent {
  return { event: "snapshot", data: { version: threadLiveVersion, held } };
}

function liveOf(event: SessionLiveEvent): ThreadLiveStreamEvent {
  return { event: "live", data: { version: threadLiveVersion, turn, event } };
}

/** What the turn's one text block holds once `written` is all of it. */
function writing(written: string): ThreadLiveHeld {
  return {
    turn,
    message,
    blocks: [{ index: 0, kind: "Text", text: written, gapped: false }],
  };
}

/** What a reader holds after every frame it was sent, folded as a console folds them. */
function heldBy(socket: Socket): ThreadLiveHeld {
  let held: ThreadLiveHeld | undefined;
  for (const frame of socket.frames) {
    if (frame.event === "snapshot") held = frame.data.held;
    else {
      assert.ok(held !== undefined, "a live frame preceded the first snapshot");
      held = threadLiveHeard(held, frame.data.turn, frame.data.event);
    }
  }
  assert.ok(held !== undefined, "the reader was sent nothing");
  return held;
}

interface Rig {
  readonly hub: ThreadLiveHub;
  readonly timers: FakeTimers;
  readonly notes: ThreadLiveNote[];
  readonly laneClosed: () => boolean;
  hear(
    event: SessionLiveEvent,
    session?: SessionId,
    partition?: Partition,
  ): void;
  unread(): void;
  source(source: ThreadLiveSource): void;
}

function rigOf(limits: Partial<ThreadLiveLimits> = {}): Rig {
  const timers = fakeTimers();
  const notes: ThreadLiveNote[] = [];
  let watcher: ThreadLiveWatcher | undefined;
  let closed = false;
  const hub = threadLiveHub({
    lane: {
      open: (opened) => {
        watcher = opened;
      },
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    },
    timers: timers.timers,
    report: { noted: (note) => notes.push(note) },
    limits: { ...threadLiveLimitsDefault, ...limits },
  });
  return {
    hub,
    timers,
    notes,
    laneClosed: () => closed,
    hear: (event, session = one, partition = project) =>
      watcher?.heard({ partition, session, turn, event }),
    unread: () => watcher?.unread(),
    source: (source) => watcher?.sourced(source),
  };
}

/** A reader the hub admitted and gave a socket, on `session` of `partition`. */
function reading(
  rig: Rig,
  session = one,
  opening: { partition?: Partition; expiresAtMs?: number } = {},
): Socket {
  const socket: Socket = fakeSocket();
  const opened = rig.hub.open({
    partition: opening.partition ?? project,
    session,
    expiresAtMs: opening.expiresAtMs,
  });
  assert.equal(opened.opened, "Opened");
  if (opened.opened === "Opened") opened.connection.begin(socket.sink);
  return socket;
}

function noteNames(rig: Rig): string[] {
  return rig.notes.map((note) =>
    note.note === "Sourced" ? `Sourced:${note.source}` : note.note,
  );
}

test("a reader of a session that has written nothing is sent a snapshot of nothing, and then each event as it is heard", () => {
  const rig = rigOf();
  const socket = reading(rig);
  assert.deepEqual(socket.frames, [snapshotOf(threadLiveNothing)]);
  rig.hear(begun());
  rig.hear(text(0, "Hel"));
  rig.hear(text(3, "lo"));
  assert.deepEqual(socket.frames.slice(1), [
    liveOf(begun()),
    liveOf(text(0, "Hel")),
    liveOf(text(3, "lo")),
  ]);
  assert.deepEqual(heldBy(socket), writing("Hello"));
});

test("a reader that arrives while a message is being written is shown what was written before it arrived", () => {
  const rig = rigOf();
  rig.hear(begun());
  rig.hear(text(0, "Hel"));
  const socket = reading(rig);
  assert.deepEqual(socket.frames, [snapshotOf(writing("Hel"))]);
  rig.hear(text(3, "lo"));
  assert.deepEqual(heldBy(socket), writing("Hello"));
  assert.deepEqual(heldBy(reading(rig)), writing("Hello"));
});

test("text for a block that never began is held as a gap and never as text", () => {
  const rig = rigOf();
  rig.hear(text(5, "late"));
  assert.deepEqual(heldBy(reading(rig)), {
    turn,
    message,
    blocks: [{ index: 0, kind: "Text", text: "", gapped: true }],
  });
});

test("the end of the turn leaves nothing held", () => {
  const rig = rigOf();
  const socket = reading(rig);
  rig.hear(begun());
  rig.hear(text(0, "done"));
  rig.hear(ended);
  assert.deepEqual(heldBy(socket), threadLiveNothing);
  assert.deepEqual(reading(rig).frames, [snapshotOf(threadLiveNothing)]);
});

test("an event reaches the readers of its own session and no other's, under its own tenant and project", () => {
  const rig = rigOf();
  const mine = reading(rig);
  const another = reading(rig, two);
  const elsewhere = reading(rig, one, {
    partition: partitionOf("project", "other-tenant"),
  });
  const sibling = reading(rig, one, { partition: partitionOf("project-2") });
  rig.hear(begun());
  assert.deepEqual(mine.frames.slice(1), [liveOf(begun())]);
  for (const socket of [another, elsewhere, sibling])
    assert.deepEqual(socket.frames, [snapshotOf(threadLiveNothing)]);
});

test("a socket that falls behind is skipped, and is sent a snapshot of what is held once it drains", () => {
  const rig = rigOf();
  const socket = reading(rig);
  socket.stall();
  rig.hear(begun());
  rig.hear(text(0, "Hel"));
  rig.hear(text(3, "lo"));
  assert.deepEqual(socket.frames.slice(1), [liveOf(begun())]);
  socket.drain();
  assert.deepEqual(socket.frames.slice(2), [snapshotOf(writing("Hello"))]);
  rig.hear(text(5, "!"));
  assert.deepEqual(heldBy(socket), writing("Hello!"));
});

test("a socket that drains having missed nothing is sent nothing, by an event or by a heartbeat", () => {
  const rig = rigOf();
  const socket = reading(rig);
  socket.stall();
  rig.hear(begun());
  socket.drain();
  assert.deepEqual(socket.frames.slice(1), [liveOf(begun())]);

  socket.stall();
  rig.timers.advance(threadLiveLimitsDefault.heartbeatMs);
  assert.equal(socket.beats(), 1);
  socket.drain();
  assert.equal(socket.frames.length, 2);
  rig.hear(text(0, "on"));
  assert.deepEqual(heldBy(socket), writing("on"));
});

test("a snapshot a socket could not take at once is not sent again when it drains", () => {
  const rig = rigOf();
  rig.hear(begun());
  const socket: Socket = fakeSocket();
  socket.stall();
  const opened = rig.hub.open({ partition: project, session: one });
  assert.equal(opened.opened, "Opened");
  if (opened.opened === "Opened") opened.connection.begin(socket.sink);
  socket.drain();
  assert.deepEqual(socket.frames, [snapshotOf(writing(""))]);
});

test("a socket still behind when the wait runs out is closed and noted, and one that drained in time is not", () => {
  const wait = threadLiveLimitsDefault.slowClientWaitMs;
  const rig = rigOf();
  const slow = reading(rig);
  const recovered = reading(rig);
  slow.stall();
  recovered.stall();
  rig.hear(begun());
  rig.timers.advance(wait - 1);
  recovered.drain();
  assert.equal(slow.ended(), false);
  rig.timers.advance(1);
  assert.equal(slow.ended(), true);
  assert.equal(recovered.ended(), false);
  assert.deepEqual(noteNames(rig), ["SlowClientClosed"]);
  assert.equal(rig.notes[0]?.connectionsOpen, 1);
});

test("every reader keeping up is beaten on the heartbeat, and one behind is not", () => {
  const beat = threadLiveLimitsDefault.heartbeatMs;
  const rig = rigOf({ slowClientWaitMs: 2 * beat });
  const kept = reading(rig);
  const behind = reading(rig, two);
  behind.stall();
  rig.hear(begun(), two);
  rig.timers.advance(beat);
  assert.equal(kept.beats(), 1);
  assert.equal(behind.beats(), 0);
  assert.equal(behind.ended(), false);
});

test("past the sessions it may hold, the hub drops the one heard from longest ago and tells its readers", () => {
  const rig = rigOf({ sessionsHeldMax: 2 });
  const three = asSessionId("session-3");
  const first = reading(rig, one);
  const second = reading(rig, two);
  rig.hear(begun(), one);
  rig.hear(begun(), two);
  rig.hear(text(0, "again"), one);
  rig.hear(begun(), three);
  assert.deepEqual(second.frames.at(-1), snapshotOf(threadLiveNothing));
  assert.deepEqual(heldBy(first), writing("again"));
  assert.deepEqual(heldBy(reading(rig, one)), writing("again"));
  assert.deepEqual(heldBy(reading(rig, two)), threadLiveNothing);
  assert.deepEqual(heldBy(reading(rig, three)), writing(""));
});

/** Every character `writing(written)` holds: its turn, its message and its text. */
function weightOf(written: string): number {
  return turn.length + message.length + written.length;
}

test("the text held across every session is bounded, each session's turn, message and block names counted with its text", () => {
  const named: SessionLiveEvent = {
    live: "Block",
    message,
    index: 1,
    kind: "ToolUse",
    name: "Read",
  };
  const rig = rigOf({ textHeldCharsMax: weightOf("abcd") + weightOf("Read") });
  const first = reading(rig, one);
  rig.hear(begun(), one);
  rig.hear(text(0, "abcd"), one);
  rig.hear(named, two);
  assert.deepEqual(heldBy(first), writing("abcd"));
  rig.hear(begun(), two);
  rig.hear(text(0, "x"), two);
  assert.deepEqual(first.frames.at(-1), snapshotOf(threadLiveNothing));
  assert.deepEqual(heldBy(reading(rig, one)), threadLiveNothing);
  assert.equal(heldBy(reading(rig, two)).blocks.length, 2);
});

test("a session that alone holds more than the hub may is itself dropped, after every other", () => {
  const rig = rigOf({ textHeldCharsMax: weightOf("abcd") });
  const other = reading(rig, two);
  const heavy = reading(rig, one);
  rig.hear(begun(), two);
  rig.hear(begun(), one);
  rig.hear(text(0, "abcd"), one);
  assert.deepEqual(heldBy(heavy), writing("abcd"));
  assert.deepEqual(heldBy(other), threadLiveNothing);
  rig.hear(text(4, "e"), one);
  assert.deepEqual(heavy.frames.slice(-2), [
    liveOf(text(4, "e")),
    snapshotOf(threadLiveNothing),
  ]);
  assert.deepEqual(heldBy(reading(rig, one)), threadLiveNothing);
});

test("a session nothing is heard from for the idle bound is dropped, whether a reader arrives or the heartbeat comes first", () => {
  const idle = 1_000;
  const arriving = rigOf({ sessionIdleMs: idle, heartbeatMs: 10 * idle });
  arriving.hear(begun());
  arriving.timers.advance(idle - 1);
  assert.deepEqual(heldBy(reading(arriving)), writing(""));
  arriving.hear(text(0, "more"));
  arriving.timers.advance(idle - 1);
  assert.deepEqual(heldBy(reading(arriving)), writing("more"));
  arriving.timers.advance(1);
  assert.deepEqual(heldBy(reading(arriving)), threadLiveNothing);

  const beaten = rigOf({ sessionIdleMs: idle, heartbeatMs: idle });
  const socket = reading(beaten);
  beaten.hear(begun());
  beaten.timers.advance(idle);
  assert.deepEqual(socket.frames.slice(1), [
    liveOf(begun()),
    snapshotOf(threadLiveNothing),
  ]);
});

test("an event heard after its session went idle is folded onto nothing", () => {
  const idle = 1_000;
  const rig = rigOf({ sessionIdleMs: idle, heartbeatMs: 10 * idle });
  rig.hear(begun());
  rig.hear(text(0, "Hel"));
  rig.timers.advance(idle);
  rig.hear(text(3, "lo"));
  assert.deepEqual(heldBy(reading(rig)).blocks, [
    { index: 0, kind: "Text", text: "", gapped: true },
  ]);
});

test("a lane that is lost leaves nothing held and tells every reader that held something, and is noted once each way", () => {
  const rig = rigOf();
  rig.source("Lost");
  assert.deepEqual(noteNames(rig), []);
  rig.source("Live");
  const writingReader = reading(rig, one);
  const idleReader = reading(rig, two);
  rig.hear(begun());
  rig.hear(text(0, "Hel"));
  rig.source("Lost");
  rig.source("Lost");
  assert.deepEqual(writingReader.frames.at(-1), snapshotOf(threadLiveNothing));
  assert.deepEqual(idleReader.frames, [snapshotOf(threadLiveNothing)]);
  assert.deepEqual(heldBy(reading(rig)), threadLiveNothing);
  rig.source("Live");
  assert.deepEqual(noteNames(rig), [
    "Sourced:Live",
    "Sourced:Lost",
    "Sourced:Live",
  ]);
  assert.equal(rig.notes[1]?.sessionsHeld, 0);
  rig.hear(text(3, "lo"));
  assert.deepEqual(heldBy(writingReader).blocks, [
    { index: 0, kind: "Text", text: "", gapped: true },
  ]);
});

test("a reader past the connections the hub may hold is refused and noted, and a closed one gives its place back", () => {
  const rig = rigOf({ connectionsMax: 1 });
  const first = rig.hub.open({ partition: project, session: one });
  assert.equal(first.opened, "Opened");
  assert.equal(
    rig.hub.open({ partition: project, session: two }).opened,
    "AtCapacity",
  );
  assert.deepEqual(noteNames(rig), ["Refused"]);
  if (first.opened === "Opened") {
    first.connection.close();
    first.connection.close();
  }
  assert.equal(
    rig.hub.open({ partition: project, session: two }).opened,
    "Opened",
  );
  assert.equal(
    rig.hub.open({ partition: project, session: one }).opened,
    "AtCapacity",
  );
});

test("a reader closed before it was given a socket ends the socket it is handed and is sent nothing", () => {
  const rig = rigOf();
  const opened = rig.hub.open({ partition: project, session: one });
  assert.equal(opened.opened, "Opened");
  if (opened.opened !== "Opened") return;
  opened.connection.close();
  const socket: Socket = fakeSocket();
  opened.connection.begin(socket.sink);
  assert.equal(socket.ended(), true);
  assert.deepEqual(socket.frames, []);
});

test("a connection ends at its greatest age, or when its bearer expires if that is sooner", () => {
  const age = threadLiveLimitsDefault.maxAgeMs;
  const rig = rigOf();
  const aged = reading(rig);
  const expiring = reading(rig, one, { expiresAtMs: 1_000 });
  const outliving = reading(rig, one, { expiresAtMs: 2 * age });
  const expired = reading(rig, one, { expiresAtMs: -1 });
  rig.timers.advance(1);
  assert.equal(expired.ended(), true);
  rig.timers.advance(998);
  assert.equal(expiring.ended(), false);
  rig.timers.advance(1);
  assert.equal(expiring.ended(), true);
  rig.timers.advance(age - 1_001);
  assert.equal(aged.ended(), false);
  rig.timers.advance(1);
  assert.equal(aged.ended(), true);
  assert.equal(outliving.ended(), true);
});

test("payloads the lane could not read are counted, and noted once a heartbeat while the count moves", () => {
  const beat = threadLiveLimitsDefault.heartbeatMs;
  const rig = rigOf();
  rig.unread();
  rig.unread();
  rig.unread();
  assert.deepEqual(noteNames(rig), []);
  rig.timers.advance(beat);
  assert.deepEqual(noteNames(rig), ["Unread"]);
  assert.equal(rig.notes[0]?.payloadsUnread, 3);
  rig.timers.advance(beat);
  assert.deepEqual(noteNames(rig), ["Unread"]);
  rig.unread();
  rig.hear(begun());
  rig.timers.advance(beat);
  assert.deepEqual(noteNames(rig), ["Unread", "Unread"]);
  assert.deepEqual(
    [rig.notes[1]?.payloadsUnread, rig.notes[1]?.eventsHeard],
    [4, 1],
  );
});

test("closing the hub ends every reader, closes the lane, and leaves it deaf and shut", async () => {
  const rig = rigOf();
  const socket = reading(rig);
  await rig.hub.close();
  await rig.hub.close();
  assert.equal(socket.ended(), true);
  assert.equal(rig.laneClosed(), true);
  rig.hear(begun());
  rig.source("Live");
  rig.timers.advance(threadLiveLimitsDefault.heartbeatMs);
  assert.deepEqual(socket.frames, [snapshotOf(threadLiveNothing)]);
  assert.equal(socket.beats(), 0);
  assert.equal(
    rig.hub.open({ partition: project, session: one }).opened,
    "AtCapacity",
  );
});

test("a bound no hub could run within is refused at construction", () => {
  for (const what of Object.keys(threadLiveLimitsDefault))
    for (const value of [0, -1, 1.5, Number.NaN])
      assert.throws(
        () => rigOf({ [what]: value }),
        new RangeError(`${what} must be a positive integer`),
      );
});
