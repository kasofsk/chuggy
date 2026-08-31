/**
 * The project stream hub: what a stream is told when it opens, what reaches it
 * while it is open, and every bound that ends it.
 *
 * EVERY CASE READS THE FRAMES A SOCKET WAS SENT rather than the hub's own
 * state, because the frames are the whole of what a browser can act on and a
 * hub whose bookkeeping was right and whose sockets were silent would pass any
 * case written the other way.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  projectStreamHub,
  projectStreamLimitsDefault,
  type ProjectChangeRow,
  type ProjectStreamHub,
  type ProjectStreamLimits,
} from "../../src/interpreter/projectStream.ts";
import type { Principal } from "../../src/interpreter/nativeWeb.ts";
import {
  changeRow,
  fakeDoorbell,
  fakeLog,
  fakeReader,
  fakeReport,
  fakeSocket,
  fakeTimers,
  frameNames,
  partitionOf,
  settled,
  otherStreamPrincipal,
  streamPrincipal,
  streamTicketInstants,
  type FakeDoorbell,
  type FakeLog,
  type FakeReader,
  type FakeReport,
  type FakeSocket,
  type FakeTimers,
} from "./projectStreamHarness.ts";

const one = partitionOf("one");
const other = partitionOf("other");
const namesake = partitionOf("one", "other-tenant");

interface Rig {
  readonly hub: ProjectStreamHub;
  readonly log: FakeLog;
  readonly doorbell: FakeDoorbell;
  readonly reader: FakeReader;
  readonly timers: FakeTimers;
  readonly report: FakeReport;
}

function rigOf(
  seed: readonly ProjectChangeRow[] = [],
  limits: Partial<ProjectStreamLimits> = {},
): Rig {
  const log = fakeLog(seed);
  const doorbell = fakeDoorbell();
  const reader = fakeReader();
  const timers = fakeTimers();
  const report = fakeReport();
  return {
    log,
    doorbell,
    reader,
    timers,
    report,
    hub: projectStreamHub({
      log: log.log,
      doorbell: doorbell.doorbell,
      reader: reader.reader,
      timers: timers.timers,
      report: report.report,
      limits: { ...projectStreamLimitsDefault, ...limits },
    }),
  };
}

async function opened(
  rig: Rig,
  partition = one,
  opening: {
    after?: number;
    expiresAtMs?: number;
    principal?: Principal;
  } = {},
): Promise<FakeSocket> {
  const socket = fakeSocket();
  const { principal, ...rest } = opening;
  const result = await rig.hub.open({
    partition,
    principal: principal ?? streamPrincipal,
    ...rest,
  });
  assert.equal(result.opened, "Opened");
  if (result.opened === "Opened") result.stream.begin(socket.sink);
  return socket;
}

test("a fresh stream is told it is ready and then hears live changes", async () => {
  const rig = rigOf();
  const socket = await opened(rig);
  assert.deepEqual(frameNames(socket), ["ready", "source:live"]);
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(frameNames(socket), ["ready", "source:live", "Ticket:7:1"]);
  assert.deepEqual(socket.frames.at(-1)?.data, {
    version: 1,
    resource: "7",
    representation: {
      ticket: 7,
      phase: "Working",
      sequence: 1,
      ...streamTicketInstants,
    },
  });
});

test("a reconnect from a retained id replays only what it missed", async () => {
  const rig = rigOf([
    changeRow(1, one, "Ticket", "7"),
    changeRow(2, one, "Ticket", "8"),
    changeRow(3, other, "Ticket", "9"),
  ]);
  const socket = await opened(rig, one, { after: 1 });
  assert.deepEqual(frameNames(socket), ["Ticket:8:2", "source:live"]);
});

test("a reconnect from a swept id is reset rather than served a gap", async () => {
  const rig = rigOf([changeRow(9, one, "Ticket", "7")]);
  rig.log.sweepBelow(9);
  const socket = await opened(rig, one, { after: 3 });
  assert.deepEqual(frameNames(socket), ["reset", "source:live"]);
});

test("a change reaches only the streams of its own partition", async () => {
  const rig = rigOf();
  const mine = await opened(rig, one);
  const theirs = await opened(rig, other);
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(frameNames(mine).at(-1), "Ticket:7:1");
  assert.deepEqual(frameNames(theirs), ["ready", "source:live"]);
});

test("two streams on one partition share a single read of the resource", async () => {
  const rig = rigOf();
  const first = await opened(rig, one);
  const second = await opened(rig, one);
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(rig.reader.reads, ["Ticket:7"]);
  assert.equal(frameNames(first).at(-1), "Ticket:7:1");
  assert.equal(frameNames(second).at(-1), "Ticket:7:1");
});

test("a batch sends one frame per resource, under the newest sequence", async () => {
  const rig = rigOf();
  const socket = await opened(rig, one);
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.log.append(changeRow(2, one, "Project", "one"));
  rig.log.append(changeRow(3, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(frameNames(socket).slice(2), [
    "Project:one:2",
    "Ticket:7:3",
  ]);
  assert.deepEqual(rig.reader.reads, ["Project:one", "Ticket:7"]);
});

test("a resource that has gone is sent as the tombstone, not withheld", async () => {
  const rig = rigOf();
  const socket = await opened(rig, one);
  rig.reader.tombstone("7");
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(socket.frames.at(-1)?.data, {
    version: 1,
    resource: "7",
    representation: null,
  });
});

test("past its cap the hub opens no stream at all", async () => {
  const rig = rigOf([], { connectionsMax: 1 });
  await opened(rig, one);
  const result = await rig.hub.open({
    partition: one,
    principal: streamPrincipal,
  });
  assert.equal(result.opened, "AtCapacity");
  assert.equal(rig.report.notes.at(-1)?.note, "Refused");
});

test("a closed stream returns its slot to the cap", async () => {
  const rig = rigOf([], { connectionsMax: 1 });
  const socket = fakeSocket();
  const first = await rig.hub.open({
    partition: one,
    principal: streamPrincipal,
  });
  assert.equal(first.opened, "Opened");
  if (first.opened === "Opened") {
    first.stream.begin(socket.sink);
    first.stream.close();
  }
  assert.equal(socket.ended(), true);
  await opened(rig, one);
});

test("a quiet stream is kept alive by the hub's own heartbeat", async () => {
  const rig = rigOf([], { heartbeatMs: 1_000 });
  const socket = await opened(rig, one);
  assert.equal(socket.beats(), 0);
  rig.timers.advance(2_500);
  assert.equal(socket.beats(), 2);
});

test("a socket that stops draining keeps the latest per resource, in order", async () => {
  const rig = rigOf([], { slowClientWaitMs: 5_000 });
  const socket = await opened(rig, one);
  socket.stall();
  for (const row of [
    changeRow(1, one, "Ticket", "7"),
    changeRow(2, one, "Ticket", "7"),
    changeRow(3, one, "Ticket", "8"),
    changeRow(4, one, "Ticket", "7"),
  ]) {
    rig.log.append(row);
    rig.doorbell.ring();
    await settled();
  }
  assert.deepEqual(frameNames(socket).slice(2), ["Ticket:7:1"]);
  socket.drain();
  assert.deepEqual(frameNames(socket).slice(2), [
    "Ticket:7:1",
    "Ticket:8:3",
    "Ticket:7:4",
  ]);
  assert.equal(socket.ended(), false);
});

test("a socket that never drains is closed rather than held forever", async () => {
  const rig = rigOf([], { slowClientWaitMs: 5_000 });
  const socket = await opened(rig, one);
  socket.stall();
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  rig.timers.advance(4_999);
  assert.equal(socket.ended(), false);
  rig.timers.advance(2);
  assert.equal(socket.ended(), true);
  assert.equal(rig.report.notes.at(-1)?.note, "SlowClientClosed");
});

test("a lost doorbell degrades every stream and a recovered one resets it", async () => {
  const rig = rigOf();
  const socket = await opened(rig, one);
  rig.doorbell.source("degraded");
  assert.equal(frameNames(socket).at(-1), "source:degraded");
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.source("live");
  await settled();
  assert.deepEqual(frameNames(socket).slice(2), [
    "source:degraded",
    "source:live",
    "reset",
  ]);
});

test("a doorbell that came back having missed nothing resets nobody", async () => {
  const rig = rigOf();
  const socket = await opened(rig, one);
  rig.doorbell.source("degraded");
  rig.doorbell.source("live");
  await settled();
  assert.deepEqual(frameNames(socket).slice(2), [
    "source:degraded",
    "source:live",
  ]);
});

test("a stream never outlives the bearer that opened it", async () => {
  const rig = rigOf([], { maxAgeMs: 300_000 });
  const socket = await opened(rig, one, { expiresAtMs: 4_000 });
  rig.timers.advance(3_999);
  assert.equal(socket.ended(), false);
  rig.timers.advance(2);
  assert.equal(socket.ended(), true);
});

test("a stream ends at its own age when the bearer outlasts it", async () => {
  const rig = rigOf([], { maxAgeMs: 1_000 });
  const socket = await opened(rig, one, { expiresAtMs: 900_000 });
  rig.timers.advance(1_001);
  assert.equal(socket.ended(), true);
});

test("the sweep reads the log even when nothing rang", async () => {
  const rig = rigOf([], { sweepMs: 2_000 });
  const socket = await opened(rig, one);
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.timers.advance(2_000);
  await settled();
  assert.equal(frameNames(socket).at(-1), "Ticket:7:1");
});

test("the same timer trims the log and says how much it took", async () => {
  const rig = rigOf([], { sweepMs: 2_000, sweepRowsMax: 32 });
  await opened(rig, one);
  rig.log.removes(7);
  rig.timers.advance(2_000);
  await settled();
  assert.deepEqual(rig.log.swept, [32]);
  assert.deepEqual(rig.report.notes.at(-1), {
    note: "Swept",
    removed: 7,
    streamsOpen: 1,
    rowsRead: 0,
  });
});

test("a sweep that removed nothing is not worth telling an operator", async () => {
  const rig = rigOf([], { sweepMs: 2_000 });
  await opened(rig, one);
  rig.timers.advance(2_000);
  await settled();
  assert.equal(rig.log.swept.length, 1);
  assert.deepEqual(rig.report.notes, []);
});

test("a refused sweep is reported and the streams keep hearing changes", async () => {
  const rig = rigOf([], { sweepMs: 2_000 });
  const socket = await opened(rig, one);
  rig.log.refusesSweeps();
  rig.timers.advance(2_000);
  await settled();
  assert.equal(rig.report.notes.at(-1)?.note, "ReadFailed");
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.equal(frameNames(socket).at(-1), "Ticket:7:1");
});

test("a replay past the bound is reset rather than quietly truncated", async () => {
  const rows = [1, 2, 3, 4].map((sequence) =>
    changeRow(sequence, one, "Ticket", String(sequence)),
  );
  const rig = rigOf(rows, { replayRowsMax: 2 });
  const socket = await opened(rig, one, { after: 1 });
  assert.deepEqual(frameNames(socket), ["reset", "source:live"]);
  const shorter = rigOf(rows, { replayRowsMax: 3 });
  const inside = await opened(shorter, one, { after: 1 });
  assert.deepEqual(frameNames(inside), [
    "Ticket:2:2",
    "Ticket:3:3",
    "Ticket:4:4",
    "source:live",
  ]);
});

test("a row nobody could be read for resets its partition and stops nothing", async () => {
  const rig = rigOf([], { rowAttemptsMax: 1 });
  const socket = await opened(rig, one);
  const elsewhere = await opened(rig, other);
  rig.reader.fails("9");
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.log.append(changeRow(2, one, "Ticket", "9"));
  rig.log.append(changeRow(3, one, "Ticket", "8"));
  rig.log.append(changeRow(4, other, "Ticket", "5"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(frameNames(socket).slice(2), [
    "Ticket:7:1",
    "reset",
    "Ticket:8:3",
  ]);
  assert.equal(rig.report.notes.at(-1)?.note, "ReadFailed");
  assert.equal(frameNames(elsewhere).at(-1), "Ticket:5:4");
});

test("a row that reads on a later attempt is sent, not reset", async () => {
  const rig = rigOf([], { rowAttemptsMax: 3 });
  const socket = await opened(rig, one);
  rig.reader.failsOnce("7");
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(frameNames(socket).slice(2), ["Ticket:7:1"]);
  assert.deepEqual(rig.report.notes, []);
});

test("a batch the hub could not deliver is read again, not stepped over", async () => {
  const rig = rigOf();
  const socket = await opened(rig, one);
  socket.breaks();
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(frameNames(socket).slice(2), []);
  socket.mends();
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(frameNames(socket).slice(2), ["Ticket:7:1"]);
});

test("one stream losing its access tombstones nothing for the others", async () => {
  const rig = rigOf();
  const mine = await opened(rig, one);
  const theirs = await opened(rig, one, { principal: otherStreamPrincipal });
  rig.reader.refuses(streamPrincipal);
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(mine.frames.at(-1)?.data, {
    version: 1,
    resource: "7",
    representation: null,
  });
  assert.deepEqual(theirs.frames.at(-1)?.data, {
    version: 1,
    resource: "7",
    representation: {
      ticket: 7,
      phase: "Working",
      sequence: 1,
      ...streamTicketInstants,
    },
  });
});

test("streams sharing a principal share one read of the resource", async () => {
  const rig = rigOf();
  await opened(rig, one);
  await opened(rig, one);
  await opened(rig, one, { principal: otherStreamPrincipal });
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(rig.reader.reads, ["Ticket:7", "Ticket:7"]);
});

test("a change never crosses a tenant, whatever the project is called", async () => {
  const rig = rigOf();
  const mine = await opened(rig, one);
  const theirs = await opened(rig, namesake);
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  assert.equal(frameNames(mine).at(-1), "Ticket:7:1");
  assert.deepEqual(frameNames(theirs), ["ready", "source:live"]);
  rig.log.append(changeRow(2, namesake, "Ticket", "8"));
  rig.doorbell.ring();
  await settled();
  assert.equal(frameNames(theirs).at(-1), "Ticket:8:2");
  assert.equal(frameNames(mine).at(-1), "Ticket:7:1");
});

test("a replay never crosses a tenant either", async () => {
  const rig = rigOf([
    changeRow(1, one, "Ticket", "7"),
    changeRow(2, namesake, "Ticket", "8"),
  ]);
  const socket = await opened(rig, namesake, { after: 1 });
  assert.deepEqual(frameNames(socket), ["Ticket:8:2", "source:live"]);
});

test("the cursor is the sequence the log gave, not a count of rows", async () => {
  const rig = rigOf();
  const socket = await opened(rig, one);
  rig.log.append(changeRow(10, one, "Ticket", "7"));
  rig.doorbell.ring();
  await settled();
  rig.log.append(changeRow(11, one, "Ticket", "8"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(frameNames(socket).slice(2), ["Ticket:7:10", "Ticket:8:11"]);
});

test("a full batch is read again without waiting for another ring", async () => {
  const rig = rigOf([], { batchRowsMax: 1, sweepMs: 900_000 });
  const socket = await opened(rig, one);
  rig.log.append(changeRow(1, one, "Ticket", "7"));
  rig.log.append(changeRow(2, one, "Ticket", "8"));
  rig.doorbell.ring();
  await settled();
  assert.deepEqual(frameNames(socket).slice(2), ["Ticket:7:1", "Ticket:8:2"]);
});

test("a socket that never arrives holds a bounded number of resources", async () => {
  const rig = rigOf([], { heldResourcesMax: 2 });
  const socket = fakeSocket();
  const result = await rig.hub.open({
    partition: one,
    principal: streamPrincipal,
  });
  assert.equal(result.opened, "Opened");
  for (const sequence of [1, 2, 3]) {
    rig.log.append(changeRow(sequence, one, "Ticket", String(sequence)));
    rig.doorbell.ring();
    await settled();
  }
  assert.equal(rig.report.notes.at(-1)?.note, "SlowClientClosed");
  if (result.opened === "Opened") result.stream.begin(socket.sink);
  assert.deepEqual(socket.frames, []);
  assert.equal(socket.ended(), true);
});

test("a change that lands while a stream opens follows its opening frames", async () => {
  const rig = rigOf([changeRow(1, one, "Ticket", "7")]);
  const release = rig.log.holdsReplays();
  const socket = fakeSocket();
  const opening = rig.hub.open({
    partition: one,
    principal: streamPrincipal,
    after: 0,
  });
  await settled();
  rig.log.append(changeRow(2, one, "Ticket", "8"));
  rig.doorbell.ring();
  await settled();
  release();
  const result = await opening;
  assert.equal(result.opened, "Opened");
  if (result.opened === "Opened") result.stream.begin(socket.sink);
  assert.deepEqual(frameNames(socket), [
    "Ticket:7:1",
    "source:live",
    "Ticket:8:2",
  ]);
});

test("closing the hub ends every stream and stops listening", async () => {
  const rig = rigOf();
  const first = await opened(rig, one);
  const second = await opened(rig, other);
  await rig.hub.close();
  assert.equal(first.ended(), true);
  assert.equal(second.ended(), true);
  assert.equal(rig.doorbell.closed(), true);
});

test("limits are checked when the hub is built, not when a stream opens", () => {
  assert.throws(
    () =>
      projectStreamHub({
        log: fakeLog().log,
        doorbell: fakeDoorbell().doorbell,
        reader: fakeReader().reader,
        timers: fakeTimers().timers,
        report: fakeReport().report,
        limits: { ...projectStreamLimitsDefault, connectionsMax: 0 },
      }),
    RangeError,
  );
});
