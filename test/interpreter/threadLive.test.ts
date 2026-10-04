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
import { sessionLiveKey } from "../../src/interpreter/sessionPlane.ts";
import {
  threadLiveHeldBytes,
  threadLiveHub,
  threadLiveLimitsDefault,
  type ThreadLiveHub,
  type ThreadLiveLimits,
  type ThreadLiveNote,
  type ThreadLiveOpened,
  type ThreadLiveSource,
  type ThreadLiveWatcher,
} from "../../src/interpreter/threadLive.ts";
import {
  fakeBeatBytes,
  fakeSocket,
  fakeTimers,
  partitionOf,
  settled,
  type FakeSocket,
  type FakeTimers,
} from "./projectStreamHarness.ts";

/** A reader's socket, with what it was written read back as the events the hub had encoded. */
interface Socket extends Omit<FakeSocket<string>, "frames"> {
  readonly frames: ThreadLiveStreamEvent[];
}

/** A socket no reader has been given yet, so a case can stall it first, holding `bytes` unwritten. */
function socketOf(stalledHoldingBytes?: number): Socket {
  const socket = fakeSocket<string>();
  if (stalledHoldingBytes !== undefined) {
    socket.stall();
    socket.holds(stalledHoldingBytes);
  }
  return {
    ...socket,
    get frames() {
      return socket.frames.map(
        (frame) => JSON.parse(frame) as ThreadLiveStreamEvent,
      );
    },
  };
}

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

interface Opening {
  readonly partition?: Partition;
  readonly expiresAtMs?: number;
  readonly admitted?: () => Promise<boolean>;
  readonly socket?: Socket;
}

interface Rig {
  readonly hub: ThreadLiveHub;
  readonly timers: FakeTimers;
  readonly notes: ThreadLiveNote[];
  readonly laneClosed: () => boolean;

  /** How many frames the hub has had encoded. */
  readonly encoded: () => number;

  /** Speaks as the lane does: the hub is asked whether the payload is read, and told what it carried only where it is. */
  hear(
    event: SessionLiveEvent,
    session?: SessionId,
    partition?: Partition,
    of?: string,
  ): void;
  unread(): void;
  source(source: ThreadLiveSource): void;
  open(session?: SessionId, opening?: Opening): ThreadLiveOpened;
}

function rigOf(limits: Partial<ThreadLiveLimits> = {}): Rig {
  const timers = fakeTimers();
  const notes: ThreadLiveNote[] = [];
  let watcher: ThreadLiveWatcher | undefined;
  let closed = false;
  let encoded = 0;
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
    framed: (event) => {
      encoded += 1;
      return JSON.stringify(event);
    },
    limits: { ...threadLiveLimitsDefault, ...limits },
  });
  return {
    hub,
    timers,
    notes,
    laneClosed: () => closed,
    encoded: () => encoded,
    hear: (event, session = one, partition = project, of = turn) => {
      if (watcher?.arrived() === true)
        watcher.heard({
          partition,
          session,
          turn: asSessionTurnId(of),
          event,
        });
    },
    unread: () => {
      if (watcher?.arrived() === true) watcher.unread();
    },
    source: (source) => watcher?.sourced(source),
    open: (session = one, opening = {}) =>
      hub.open({
        partition: opening.partition ?? project,
        session,
        expiresAtMs: opening.expiresAtMs,
        admitted: opening.admitted ?? (() => Promise.resolve(true)),
      }),
  };
}

/** A reader the hub admitted and gave a socket, on `session` of `partition`. */
function reading(rig: Rig, session = one, opening: Opening = {}): Socket {
  const socket = opening.socket ?? socketOf();
  const opened = rig.open(session, opening);
  assert.equal(opened.opened, "Opened");
  if (opened.opened === "Opened") opened.connection.begin(socket.sink);
  return socket;
}

function noteNames(rig: Rig): string[] {
  return rig.notes.map((note) =>
    note.note === "Sourced" ? `Sourced:${note.source}` : note.note,
  );
}

const probed = asSessionId("probed-for-totals");

/** The hub's totals now, read off the note a refused reader leaves: a session nothing writes is filled with readers and one more is asked for. */
function totals(rig: Rig): ThreadLiveNote {
  let opened = rig.open(probed);
  while (opened.opened === "Opened") opened = rig.open(probed);
  const note = rig.notes.pop();
  assert.equal(note?.note, "Refused");
  return note;
}

/** What the hub counts `held` of `session` as occupying. */
function weightOf(session: SessionId, held: ThreadLiveHeld): number {
  return threadLiveHeldBytes(sessionLiveKey(project, session), held);
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
  assert.deepEqual([totals(rig).sessionsHeld, totals(rig).heldBytes], [0, 0]);
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

test("an event that changes nothing held is sent to nobody, and still counts as hearing from its session", () => {
  const idle = 1_000;
  const rig = rigOf({ sessionIdleMs: idle, heartbeatMs: 10 * idle });
  const socket = reading(rig);
  rig.hear(begun());
  rig.hear(text(0, "Hel"));
  rig.hear(text(3, "lo"));
  const sent = socket.frames.length;
  rig.timers.advance(idle - 1);
  rig.hear(begun());
  rig.hear(text(0, "Hel"));
  rig.hear(ended, one, project, "turn-0");
  assert.equal(socket.frames.length, sent);
  rig.timers.advance(idle - 1);
  assert.deepEqual(heldBy(reading(rig)), writing("Hello"));
});

test("an event is encoded once however many readers it is sent to, and not at all for a session nobody reads", () => {
  const rig = rigOf();
  rig.hear(begun(), two);
  assert.equal(rig.encoded(), 0);
  const sockets = [reading(rig), reading(rig), reading(rig)];
  const opened = rig.encoded();
  rig.hear(begun());
  assert.equal(rig.encoded(), opened + 1);
  for (const socket of sockets)
    assert.deepEqual(socket.frames.slice(1), [liveOf(begun())]);
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
  const socket = reading(rig, one, { socket: socketOf(0) });
  socket.drain();
  assert.deepEqual(socket.frames, [snapshotOf(writing(""))]);
});

test("a socket still behind when the wait runs out is cut and noted, and one that drained in time is not", () => {
  const wait = threadLiveLimitsDefault.slowClientWaitMs;
  const rig = rigOf();
  const slow = reading(rig);
  const recovered = reading(rig);
  slow.stall();
  recovered.stall();
  rig.hear(begun());
  rig.timers.advance(wait - 1);
  recovered.drain();
  assert.equal(slow.wasCut(), false);
  rig.timers.advance(1);
  assert.deepEqual([slow.wasCut(), slow.ended()], [true, false]);
  assert.deepEqual([recovered.wasCut(), recovered.ended()], [false, false]);
  assert.deepEqual(noteNames(rig), ["SlowClientClosed"]);
  assert.equal(rig.notes[0]?.connectionsOpen, 1);
});

test("a socket that falls behind while the sockets behind hold more than they may between them is cut at once, and one keeping up never is", () => {
  const rig = rigOf({ pendingBytesMax: 100 });
  const keeping = reading(rig);
  const first = reading(rig, one, { socket: socketOf(60) });
  const second = reading(rig, one, { socket: socketOf(40) });
  assert.deepEqual([first.wasCut(), second.wasCut()], [false, false]);
  const third = reading(rig, one, { socket: socketOf(1) });
  assert.deepEqual([third.wasCut(), third.ended()], [true, false]);
  assert.deepEqual(noteNames(rig), ["PendingClosed"]);
  assert.deepEqual(
    [rig.notes[0]?.pendingBytes, rig.notes[0]?.connectionsOpen],
    [100, 3],
  );
  rig.hear(begun());
  assert.deepEqual([keeping.wasCut(), keeping.ended()], [false, false]);
  assert.deepEqual(keeping.frames.slice(1), [liveOf(begun())]);
});

test("a socket that drains, or is closed, gives back what it held unwritten", () => {
  const wait = threadLiveLimitsDefault.slowClientWaitMs;
  const rig = rigOf({ pendingBytesMax: 100 });
  const first = reading(rig, one, { socket: socketOf(60) });
  const second = reading(rig, one, { socket: socketOf(40) });
  first.drain();
  const third = reading(rig, one, { socket: socketOf(60) });
  assert.equal(third.wasCut(), false);
  assert.equal(totals(rig).pendingBytes, 100);
  rig.timers.advance(wait);
  assert.deepEqual(
    [first.wasCut(), second.wasCut(), third.wasCut()],
    [false, true, true],
  );
  assert.deepEqual(noteNames(rig), ["SlowClientClosed", "SlowClientClosed"]);
  assert.deepEqual(
    rig.notes.map((note) => note.pendingBytes),
    [60, 0],
  );
});

/** What a socket here counts one frame as having written. */
function frameBytes(event: ThreadLiveStreamEvent): number {
  return JSON.stringify(event).length;
}

test("past what the open sockets may have been written between them, the one written the most is cut though it kept up, and every other goes on reading", () => {
  const opening = frameBytes(snapshotOf(threadLiveNothing));
  const event = frameBytes(liveOf(begun()));
  const rig = rigOf({ sentBytesMax: 3 * opening + event });
  const most = reading(rig, one);
  const less = reading(rig, two);
  rig.hear(begun(), one);
  const third = reading(rig, asSessionId("session-3"));
  assert.deepEqual(
    [most.wasCut(), less.wasCut(), third.wasCut()],
    [false, false, false],
  );
  const fourth = reading(rig, asSessionId("session-4"));
  assert.deepEqual([most.wasCut(), most.ended()], [true, false]);
  assert.deepEqual(
    [less.wasCut(), third.wasCut(), fourth.wasCut()],
    [false, false, false],
  );
  assert.deepEqual(noteNames(rig), ["SentClosed"]);
  assert.deepEqual(
    [rig.notes[0]?.sentBytes, rig.notes[0]?.connectionsOpen],
    [3 * opening, 3],
  );
  rig.hear(begun(), two);
  assert.deepEqual(less.frames.slice(1), [liveOf(begun())]);
  assert.deepEqual(noteNames(rig), ["SentClosed"]);
});

test("a socket written more at once than every open socket may have been is itself cut, and the others are left", () => {
  const opening = frameBytes(snapshotOf(threadLiveNothing));
  const rig = rigOf({ sentBytesMax: 2 * opening });
  const other = reading(rig, two);
  rig.hear(begun());
  rig.hear(text(0, "Hello"));
  const arriving = reading(rig);
  assert.deepEqual([arriving.wasCut(), other.wasCut()], [true, false]);
  assert.equal(totals(rig).sentBytes, opening);
});

test("what a socket was written is what it says it was, heartbeats and all, and a socket that closes gives it back", () => {
  const beat = threadLiveLimitsDefault.heartbeatMs;
  const opening = frameBytes(snapshotOf(threadLiveNothing));
  const rig = rigOf();
  const staying = reading(rig);
  const leaving = rig.open(two);
  assert.ok(leaving.opened === "Opened");
  leaving.connection.begin(socketOf().sink);
  assert.equal(totals(rig).sentBytes, 2 * opening);
  rig.timers.advance(beat);
  rig.hear(begun());
  assert.equal(staying.beats(), 1);
  assert.equal(
    totals(rig).sentBytes,
    2 * opening + fakeBeatBytes + frameBytes(liveOf(begun())),
  );
  leaving.connection.close();
  assert.equal(
    totals(rig).sentBytes,
    opening + fakeBeatBytes + frameBytes(liveOf(begun())),
  );
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

const named: SessionLiveEvent = {
  live: "Block",
  message,
  index: 1,
  kind: "ToolUse",
  name: "Read",
};

/** What a session holds once `named` is all it has heard. */
const naming: ThreadLiveHeld = {
  turn,
  message,
  blocks: [
    { index: 1, kind: "ToolUse", name: "Read", text: "", gapped: false },
  ],
};

test("a session is counted at two bytes for every unit of its key, turn, message, names and text, over a charge for itself and for each block", () => {
  const session = threadLiveHeldBytes("", threadLiveNothing);
  const over = (held: ThreadLiveHeld, key = ""): number =>
    threadLiveHeldBytes(key, held) - session;
  assert.ok(session > 0);
  assert.equal(over(threadLiveNothing, "abc"), 6);
  assert.equal(over({ turn: "t", message: "mm", blocks: [] }), 6);
  const block = over(writing("")) - over({ turn, message, blocks: [] });
  assert.ok(block > 0);
  assert.equal(over(writing("abcd")) - over(writing("")), 8);
  assert.equal(over(naming) - over(writing("")), 8);
  assert.equal(
    over({
      turn,
      message,
      blocks: [...writing("ab").blocks, ...naming.blocks],
    }),
    over(writing("ab")) + block + 8,
  );
});

test("what the hub counts as held is what its sessions hold, whatever was written, rewritten, ended and dropped", () => {
  const rig = rigOf();
  rig.hear(begun(), one);
  rig.hear(text(0, "Hello"), one);
  rig.hear(named, two);
  assert.equal(
    totals(rig).heldBytes,
    weightOf(one, writing("Hello")) + weightOf(two, naming),
  );
  rig.hear(text(1, "i"), one);
  assert.deepEqual(heldBy(reading(rig, one)), writing("Hi"));
  assert.equal(
    totals(rig).heldBytes,
    weightOf(one, writing("Hi")) + weightOf(two, naming),
  );
  rig.hear(ended, one);
  assert.equal(totals(rig).heldBytes, weightOf(two, naming));
  rig.source("Live");
  rig.source("Lost");
  assert.equal(totals(rig).heldBytes, 0);
});

test("what is held across every session is bounded, and the session heard from longest ago is dropped first", () => {
  const rig = rigOf({
    heldBytesMax: weightOf(one, writing("abcd")) + weightOf(two, naming),
  });
  const first = reading(rig, one);
  rig.hear(begun(), one);
  rig.hear(text(0, "abcd"), one);
  rig.hear(named, two);
  assert.deepEqual(heldBy(first), writing("abcd"));
  rig.hear(begun(), two);
  assert.deepEqual(first.frames.at(-1), snapshotOf(threadLiveNothing));
  assert.deepEqual(heldBy(reading(rig, one)), threadLiveNothing);
  assert.equal(heldBy(reading(rig, two)).blocks.length, 2);
});

test("a session that alone holds more than the hub may is itself dropped, after every other", () => {
  const rig = rigOf({ heldBytesMax: weightOf(one, writing("abcd")) });
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
  assert.equal(totals(rig).heldBytes, 0);
});

test("text that takes a session past what one may hold leaves its block gapped, and its readers are sent what is held and not the event", () => {
  const unitsMax = 8;
  const rig = rigOf({ sessionTextBytesMax: 2 * unitsMax });
  const socket = reading(rig);
  rig.hear(begun());
  rig.hear(text(0, "abcd"));
  rig.hear(begun(1));
  rig.hear(text(0, "efgh", 1));
  assert.deepEqual(
    heldBy(socket).blocks.map((block) => block.text),
    ["abcd", "efgh"],
  );
  rig.hear(text(4, "i", 1));
  const gapped: ThreadLiveHeld = {
    turn,
    message,
    blocks: [
      { index: 0, kind: "Text", text: "abcd", gapped: false },
      { index: 1, kind: "Text", text: "", gapped: true },
    ],
  };
  assert.deepEqual(socket.frames.at(-1), snapshotOf(gapped));
  assert.equal(totals(rig).heldBytes, weightOf(one, gapped));
  const sent = socket.frames.length;
  rig.hear(text(5, "j", 1));
  assert.equal(socket.frames.length, sent);
  rig.hear(begun(1));
  rig.hear(text(0, "wxyz", 1));
  assert.deepEqual(
    heldBy(socket).blocks.map((block) => [block.text, block.gapped]),
    [
      ["abcd", false],
      ["wxyz", false],
    ],
  );
  assert.deepEqual(heldBy(reading(rig)), heldBy(socket));
});

test("text that takes a session past what one may hold again within a window of the last time leaves every block gapped, and its readers are sent that and not all it held", () => {
  const unitsMax = 8;
  const window = 1_000;
  const rig = rigOf({
    sessionTextBytesMax: 2 * unitsMax,
    windowMs: window,
    heartbeatMs: 100 * window,
    sessionIdleMs: 100 * window,
  });
  const socket = reading(rig);
  const other = reading(rig, two);
  const texts = (reader: Socket): (readonly [string, boolean])[] =>
    heldBy(reader).blocks.map((block) => [block.text, block.gapped] as const);
  /** Fills both blocks to what the session may hold, then writes one unit more to the second. */
  const past = (session: SessionId): void => {
    rig.hear(begun(), session);
    rig.hear(text(0, "abcd"), session);
    rig.hear(begun(1), session);
    rig.hear(text(0, "efgh", 1), session);
    rig.hear(text(4, "i", 1), session);
  };
  const oneGapped = [
    ["abcd", false],
    ["", true],
  ];
  const allGapped = [
    ["", true],
    ["", true],
  ];

  past(one);
  assert.deepEqual(texts(socket), oneGapped);
  rig.timers.advance(window - 1);
  past(two);
  assert.deepEqual(texts(other), oneGapped);
  past(one);
  assert.deepEqual(texts(socket), allGapped);
  assert.deepEqual(
    socket.frames.at(-1),
    snapshotOf({
      turn,
      message,
      blocks: [
        { index: 0, kind: "Text", text: "", gapped: true },
        { index: 1, kind: "Text", text: "", gapped: true },
      ],
    }),
  );
  assert.equal(
    totals(rig).heldBytes,
    weightOf(one, heldBy(socket)) + weightOf(two, heldBy(other)),
  );
  assert.deepEqual(heldBy(reading(rig)), heldBy(socket));

  rig.timers.advance(window - 1);
  past(one);
  assert.deepEqual(texts(socket), allGapped);
  rig.timers.advance(window);
  past(one);
  assert.deepEqual(texts(socket), oneGapped);
  assert.deepEqual(heldBy(reading(rig)), heldBy(socket));
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

test("past the payloads one window reads, the hub reads no more until the window turns, and drops what it held", () => {
  const window = 1_000;
  const rig = rigOf({
    windowMs: window,
    windowEventsMax: 3,
    heartbeatMs: 10 * window,
  });
  const socket = reading(rig);
  const other = reading(rig, two);
  rig.hear(begun());
  rig.hear(text(0, "Hel"));
  rig.hear(begun(), two);
  assert.deepEqual(heldBy(socket), writing("Hel"));
  rig.hear(text(3, "lo"));
  for (const reader of [socket, other])
    assert.deepEqual(reader.frames.at(-1), snapshotOf(threadLiveNothing));
  const sent = socket.frames.length;
  rig.hear(text(5, "!"));
  rig.unread();
  rig.timers.advance(window - 1);
  rig.hear(text(6, "?"));
  assert.equal(socket.frames.length, sent);
  assert.deepEqual(heldBy(reading(rig)), threadLiveNothing);

  rig.timers.advance(1);
  rig.hear(text(7, "."));
  assert.deepEqual(heldBy(socket).blocks, [
    { index: 0, kind: "Text", text: "", gapped: true },
  ]);
  rig.hear(begun(1));
  rig.hear(text(0, "new", 1));
  assert.deepEqual(heldBy(socket).blocks[1], {
    index: 1,
    kind: "Text",
    text: "new",
    gapped: false,
  });
  rig.hear(text(3, "er", 1));
  assert.deepEqual(heldBy(socket), threadLiveNothing);
});

test("a clock that steps back begins a new window, and does not leave the hub reading nothing until it catches up", () => {
  const rig = rigOf({ windowMs: 1_000, windowEventsMax: 1 });
  rig.timers.setNowMs(50_000);
  rig.hear(begun());
  rig.timers.setNowMs(10_000);
  const socket = reading(rig);
  rig.hear(text(0, "on"));
  assert.deepEqual(heldBy(socket), writing("on"));
});

test("payloads left unread past a window are counted apart from those that could not be read, and noted once a heartbeat while the count moves", () => {
  const beat = threadLiveLimitsDefault.heartbeatMs;
  const rig = rigOf({ windowMs: beat, windowEventsMax: 1 });
  rig.hear(begun());
  rig.hear(text(0, "a"));
  rig.unread();
  assert.deepEqual(noteNames(rig), []);
  rig.timers.advance(beat);
  assert.deepEqual(noteNames(rig), ["Shed"]);
  assert.deepEqual(
    [
      rig.notes[0]?.payloadsShed,
      rig.notes[0]?.payloadsUnread,
      rig.notes[0]?.eventsHeard,
      rig.notes[0]?.sessionsHeld,
    ],
    [2, 0, 1, 0],
  );
  rig.timers.advance(beat);
  assert.deepEqual(noteNames(rig), ["Shed"]);
});

test("a reader past the connections the hub may hold is refused and noted, and a closed one gives its place back", () => {
  const rig = rigOf({ connectionsMax: 1 });
  const first = rig.open(one);
  assert.equal(first.opened, "Opened");
  assert.equal(rig.open(two).opened, "AtCapacity");
  assert.deepEqual(noteNames(rig), ["Refused"]);
  if (first.opened === "Opened") {
    first.connection.close();
    first.connection.close();
  }
  assert.equal(rig.open(two).opened, "Opened");
  assert.equal(rig.open(one).opened, "AtCapacity");
});

test("a reader past the readers one session may have is refused and noted, while another session's reader is admitted", () => {
  const rig = rigOf({ sessionReadersMax: 2 });
  const first = rig.open(one);
  assert.equal(rig.open(one).opened, "Opened");
  assert.equal(rig.open(one).opened, "AtCapacity");
  assert.deepEqual(noteNames(rig), ["Refused"]);
  assert.equal(rig.open(two).opened, "Opened");
  const namesake = { partition: partitionOf("project", "other-tenant") };
  assert.equal(rig.open(one, namesake).opened, "Opened");
  if (first.opened === "Opened") first.connection.close();
  assert.equal(rig.open(one).opened, "Opened");
  assert.equal(rig.open(one).opened, "AtCapacity");
});

test("a reader closed before it was given a socket ends the socket it is handed and is sent nothing", () => {
  const rig = rigOf();
  const opened = rig.open(one);
  assert.equal(opened.opened, "Opened");
  if (opened.opened !== "Opened") return;
  opened.connection.close();
  const socket = socketOf();
  opened.connection.begin(socket.sink);
  assert.equal(socket.ended(), true);
  assert.deepEqual(socket.frames, []);
});

test("a connection is cut at its greatest age, or when its bearer expires if that is sooner, and is never left ended", () => {
  const age = threadLiveLimitsDefault.maxAgeMs;
  const rig = rigOf();
  const aged = reading(rig);
  const expiring = reading(rig, one, { expiresAtMs: 1_000 });
  const outliving = reading(rig, one, { expiresAtMs: 2 * age });
  const expired = reading(rig, one, { expiresAtMs: -1 });
  rig.timers.advance(1);
  assert.equal(expired.wasCut(), true);
  rig.timers.advance(998);
  assert.equal(expiring.wasCut(), false);
  rig.timers.advance(1);
  assert.equal(expiring.wasCut(), true);
  rig.timers.advance(age - 1_001);
  assert.equal(aged.wasCut(), false);
  rig.timers.advance(1);
  assert.equal(aged.wasCut(), true);
  assert.equal(outliving.wasCut(), true);
  assert.deepEqual(
    [aged, expiring, outliving, expired].map((socket) => socket.ended()),
    [false, false, false, false],
  );
});

test("a reader whose request closes is cut, since nothing says it read what it was written, and is cut once", () => {
  const rig = rigOf();
  const opened = rig.open(one);
  assert.ok(opened.opened === "Opened");
  const socket = socketOf();
  let cuts = 0;
  opened.connection.begin({
    ...socket.sink,
    cut: () => {
      cuts += 1;
    },
  });
  opened.connection.close();
  opened.connection.close();
  assert.deepEqual([cuts, socket.ended()], [1, false]);
  rig.hear(begun());
  assert.deepEqual(socket.frames, [snapshotOf(threadLiveNothing)]);
});

/** A reader whose standing a case answers, counting how often it was asked. */
function standing(answer: () => Promise<boolean>): {
  readonly admitted: () => Promise<boolean>;
  readonly asked: () => number;
} {
  let asked = 0;
  return {
    asked: () => asked,
    admitted: () => {
      asked += 1;
      return answer();
    },
  };
}

test("whether each reader may still read is asked again on every heartbeat, and one refused is cut and gives its place back", async () => {
  const beat = threadLiveLimitsDefault.heartbeatMs;
  const rig = rigOf({ sessionReadersMax: 1 });
  let member = true;
  const staying = standing(() => Promise.resolve(true));
  const leaving = standing(() => Promise.resolve(member));
  const kept = reading(rig, one, staying);
  const removed = reading(rig, two, leaving);
  assert.deepEqual([staying.asked(), leaving.asked()], [0, 0]);
  rig.timers.advance(beat);
  await settled();
  assert.deepEqual([staying.asked(), leaving.asked()], [1, 1]);
  assert.deepEqual([kept.wasCut(), removed.wasCut()], [false, false]);
  member = false;
  rig.timers.advance(beat);
  await settled();
  assert.deepEqual([kept.wasCut(), removed.wasCut()], [false, true]);
  assert.equal(removed.ended(), false);
  assert.equal(rig.open(two).opened, "Opened");
  rig.timers.advance(beat);
  await settled();
  assert.deepEqual([staying.asked(), leaving.asked()], [3, 2]);
});

test("a standing read that fails, or has not answered by the next heartbeat, closes nobody, and the readers after it are asked once it has", async () => {
  const beat = threadLiveLimitsDefault.heartbeatMs;
  const rig = rigOf();
  const failing = standing(() => Promise.reject(new Error("the read failed")));
  const silent = standing(() => new Promise<boolean>(() => undefined));
  const refused = standing(() => Promise.resolve(false));
  const sockets = [
    reading(rig, one, failing),
    reading(rig, one, silent),
    reading(rig, two, refused),
  ];
  const closed = (): boolean[] => sockets.map((socket) => socket.wasCut());
  rig.timers.advance(beat);
  await settled();
  assert.deepEqual(closed(), [false, false, false]);
  assert.deepEqual(
    [failing.asked(), silent.asked(), refused.asked()],
    [1, 1, 0],
  );
  rig.timers.advance(beat);
  await settled();
  assert.deepEqual(closed(), [false, false, true]);
  assert.deepEqual(
    [failing.asked(), silent.asked(), refused.asked()],
    [1, 1, 1],
  );
  rig.timers.advance(beat);
  await settled();
  assert.deepEqual([failing.asked(), silent.asked()], [2, 2]);
});

test("a reader that went away while another's standing was being asked is not asked", async () => {
  const beat = threadLiveLimitsDefault.heartbeatMs;
  const rig = rigOf();
  let answer: (admitted: boolean) => void = () => undefined;
  const waited = standing(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
  );
  const after = standing(() => Promise.resolve(true));
  reading(rig, one, waited);
  const gone = rig.open(two, after);
  rig.timers.advance(beat);
  await settled();
  if (gone.opened === "Opened") gone.connection.close();
  answer(true);
  await settled();
  assert.deepEqual([waited.asked(), after.asked()], [1, 0]);
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

test("closing the hub ends every reader without cutting it, closes the lane, and leaves it deaf and shut", async () => {
  const rig = rigOf();
  const socket = reading(rig);
  await rig.hub.close();
  await rig.hub.close();
  assert.deepEqual([socket.ended(), socket.wasCut()], [true, false]);
  assert.equal(rig.laneClosed(), true);
  rig.hear(begun());
  rig.source("Live");
  rig.timers.advance(threadLiveLimitsDefault.heartbeatMs);
  assert.deepEqual(socket.frames, [snapshotOf(threadLiveNothing)]);
  assert.equal(socket.beats(), 0);
  assert.equal(rig.open(one).opened, "AtCapacity");
  assert.deepEqual(noteNames(rig), ["Refused"]);
  assert.deepEqual(
    [rig.notes[0]?.eventsHeard, rig.notes[0]?.payloadsShed],
    [0, 0],
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
