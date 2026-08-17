/**
 * The drive's own promises: one serialized writer, journal-before-ack, a drop
 * that answers, and the bounded retry behind a failed drain.
 *
 * The wake capability is a recorder here, so a booked retry is data a case
 * runs by hand — which is also what lets the ladder's end be read rather than
 * waited for.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { jArrive, jRelease } from "../../src/actor/command.ts";
import { journalLegalOn } from "../../src/actor/journal.ts";
import {
  actorInit,
  journalStep,
  type ActorState,
} from "../../src/actor/state.ts";
import { deskStub, type DeskStub } from "../../src/adapters/deskStub.ts";
import { fabricStub } from "../../src/adapters/fabricStub.ts";
import {
  journalStoreStub,
  type JournalStoreStub,
} from "../../src/adapters/journalStoreStub.ts";
import { wrapUpStub } from "../../src/adapters/wrapUpStub.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { wExclusive } from "../../src/domain/wrapUp.ts";
import type { Executor } from "../../src/interpreter/executor.ts";
import type { Inbound } from "../../src/interpreter/inbound.ts";
import type { JournalStore } from "../../src/interpreter/ports.ts";
import { boot } from "../../src/runtime/boot.ts";
import {
  drive,
  driveDrainRetryDelaysMs,
  type WakeAfter,
} from "../../src/runtime/drive.ts";
import { flatProgram, refinementInstance } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

const config = refinementInstance;

/** One booked wake: when it was asked for, and the work it would run. */
interface BookedWake {
  readonly delayMs: number;
  readonly wake: () => Promise<void>;
}

/** A drive over the given store and fresh stubs — from the empty state unless a booted one is handed — with every wake recorded. */
function wiring(
  store: JournalStore,
  booted: ActorState = actorInit(),
): {
  inbound: Inbound;
  desk: DeskStub;
  wakes: BookedWake[];
} {
  const desk = deskStub();
  const wakes: BookedWake[] = [];
  const wakeAfter: WakeAfter = (delayMs, wake) => {
    wakes.push({ delayMs, wake });
  };
  const executor: Executor = {
    config,
    store,
    ports: { fabric: fabricStub(), desk, wrapUp: wrapUpStub() },
  };
  return { inbound: drive(executor, wakeAfter, booted), desk, wakes };
}

/** A store whose cursor writes fail the given number of times before behaving. */
function cursorFlakyStore(
  store: JournalStoreStub,
  failures: number,
): JournalStore {
  let left = failures;
  return {
    append: (entry) => store.append(entry),
    load: () => store.load(),
    loadCursor: () => store.loadCursor(),
    saveCursor: (applied) => {
      if (left > 0) {
        left -= 1;
        return Promise.reject(new Error("the cursor write failed"));
      }
      return store.saveCursor(applied);
    },
  };
}

test("Accepted carries the appended seq, and the follow-ups journal behind the answer", async () => {
  const store = journalStoreStub();
  const wired = wiring(store);
  const arrived = await wired.inbound.arrive(
    [],
    flatProgram,
    asProjectId(1),
    wExclusive(1),
  );
  assert.deepEqual(arrived, { submitted: "Accepted", seq: 1 });
  const released = await wired.inbound.release(id(1));
  assert.deepEqual(released, { submitted: "Accepted", seq: 2 });
  const loaded = await store.load();
  assert.ok(loaded.parsed === "Ok");
  assert.equal(loaded.value.length, 3);
  assert.equal(loaded.value.at(-1)?.cmd.cmd, "JDispatch");
});

test("a submission enablement refuses is answered Dropped with the reason, and journals nothing", async () => {
  const store = journalStoreStub();
  const wired = wiring(store);
  const answer = await wired.inbound.release(id(1));
  assert.ok(answer.submitted === "Dropped" && answer.why.includes("JRelease"));
  assert.equal(store.rows.length, 0);
  assert.equal(wired.desk.deliveries.length, 0);
});

test("a completion naming a ticket outside its task phase is dropped, not journaled", async () => {
  const store = journalStoreStub();
  const wired = wiring(store);
  await wired.inbound.arrive([], flatProgram, asProjectId(1), wExclusive(1));
  const rows = store.rows.length;
  const answer = await wired.inbound.taskDone(id(1), asTaskId(1), "VPass");
  assert.equal(answer.submitted, "Dropped");
  assert.equal(store.rows.length, rows);
});

test("concurrent submissions journal in some serial order with dense seqs", async () => {
  const store = journalStoreStub();
  const wired = wiring(store);
  const submit = (): ReturnType<Inbound["arrive"]> =>
    wired.inbound.arrive([], flatProgram, asProjectId(1), wExclusive(1));
  const answers = await Promise.all([submit(), submit()]);
  const seqs = answers.map((answer) => {
    assert.ok(answer.submitted === "Accepted");
    return answer.seq;
  });
  assert.deepEqual(
    [...seqs].sort((left, right) => left - right),
    [1, 2],
  );
  const loaded = await store.load();
  assert.ok(loaded.parsed === "Ok");
  assert.ok(journalLegalOn(config, loaded.value));
});

test("the answer waits for the append: nothing is acked while the entry is not yet durable", async () => {
  const store = journalStoreStub();
  const held: (() => void)[] = [];
  const holding: JournalStore = {
    append: (entry) =>
      new Promise((resolve) => {
        held.push(() => {
          void store.append(entry).then(resolve);
        });
      }),
    load: () => store.load(),
    loadCursor: () => store.loadCursor(),
    saveCursor: (applied) => store.saveCursor(applied),
  };
  const wired = wiring(holding);
  let answered = false;
  const answer = wired.inbound
    .arrive([], flatProgram, asProjectId(1), wExclusive(1))
    .then((submitted) => {
      answered = true;
      return submitted;
    });
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  assert.equal(held.length, 1, "the submission never reached the store");
  assert.equal(
    answered,
    false,
    "the drive answered before the append resolved",
  );
  for (const release of held) release();
  assert.deepEqual(await answer, { submitted: "Accepted", seq: 1 });
});

test("a failed drain still answers Accepted, and the booked retry catches the cursor up", async () => {
  const store = journalStoreStub();
  const wired = wiring(cursorFlakyStore(store, 1));
  const answer = await wired.inbound.arrive(
    [],
    flatProgram,
    asProjectId(1),
    wExclusive(1),
  );
  assert.deepEqual(answer, { submitted: "Accepted", seq: 1 });
  assert.equal(await store.loadCursor(), 0);
  const booked = wired.wakes.at(0);
  assert.ok(booked !== undefined, "no retry was booked for the failed drain");
  assert.equal(booked.delayMs, driveDrainRetryDelaysMs.at(0));
  await booked.wake();
  assert.equal(await store.loadCursor(), 1);
  assert.equal(wired.wakes.length, 1);
});

test("running off the ladder's end surfaces the failure through the timer", async () => {
  const store = journalStoreStub();
  const wired = wiring(cursorFlakyStore(store, Number.MAX_SAFE_INTEGER));
  const answer = await wired.inbound.arrive(
    [],
    flatProgram,
    asProjectId(1),
    wExclusive(1),
  );
  assert.equal(answer.submitted, "Accepted");
  for (let attempt = 0; attempt < driveDrainRetryDelaysMs.length; attempt++) {
    const booked = wired.wakes.at(attempt);
    assert.ok(booked !== undefined, "a retry stopped booking its successor");
    await booked.wake();
  }
  assert.equal(wired.wakes.length, driveDrainRetryDelaysMs.length + 1);
  const last = wired.wakes.at(-1);
  assert.ok(last !== undefined && last.delayMs === 0);
  await assert.rejects(() => last.wake(), /the cursor write failed/);
});

test("construction pumps a recovered mid-follow-up state before the first submission", async () => {
  const store = journalStoreStub();
  let interrupted = actorInit();
  interrupted = journalStep(
    config,
    interrupted,
    jArrive([], flatProgram, asProjectId(1), wExclusive(1)),
  );
  interrupted = journalStep(config, interrupted, jRelease(id(1)));
  for (const entry of interrupted.journal) await store.append(entry);

  const booted = await boot({
    config,
    store,
    ports: { fabric: fabricStub(), desk: deskStub(), wrapUp: wrapUpStub() },
  });
  const wired = wiring(store, booted);
  const answer = await wired.inbound.arrive(
    [],
    flatProgram,
    asProjectId(1),
    wExclusive(1),
  );
  assert.deepEqual(answer, { submitted: "Accepted", seq: 4 });
  const loaded = await store.load();
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(
    loaded.value.map((entry) => entry.cmd.cmd),
    ["JArrive", "JRelease", "JDispatch", "JArrive"],
  );
});
