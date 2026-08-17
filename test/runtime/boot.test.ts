/**
 * Boot against journals a crash could leave: a holder gets its gate re-handed
 * under the emission's original identity, a fleet with no holder gets nothing,
 * and a lost cursor is drained before the re-hand so both deliveries land.
 *
 * The crash is played by rewiring the surviving store to fresh port stubs, so
 * everything the reborn world holds arrived through boot alone.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  jArrive,
  jDequeue,
  jDispatch,
  jEvalReduce,
  jGateResolve,
  jRelease,
  jTaskDone,
  jWorkReduce,
  type Cmd,
} from "../../src/actor/command.ts";
import { actorInit, type ActorState } from "../../src/actor/state.ts";
import { deskStub } from "../../src/adapters/deskStub.ts";
import { fabricStub } from "../../src/adapters/fabricStub.ts";
import {
  journalStoreStub,
  type JournalStoreStub,
} from "../../src/adapters/journalStoreStub.ts";
import { wrapUpStub, type WrapUpStub } from "../../src/adapters/wrapUpStub.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { wExclusive } from "../../src/domain/wrapUp.ts";
import {
  decide,
  drain,
  type Executor,
} from "../../src/interpreter/executor.ts";
import { boot } from "../../src/runtime/boot.ts";
import { flatProgram, refinementInstance } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

const config = refinementInstance;

/** The cycle's decisions up to the holding phase; the resolve would leave no holder behind. */
const toHolding: readonly Cmd[] = [
  jArrive([], flatProgram, asProjectId(1), wExclusive(1)),
  jRelease(id(1)),
  jDispatch(id(1)),
  jTaskDone(id(1), asTaskId(1), "VPass"),
  jWorkReduce(id(1)),
  jTaskDone(id(1), asTaskId(2), "VPass"),
  jEvalReduce(id(1)),
  jDequeue(id(1), true),
];

/** The failed first attempt and the rework cycle behind it, so the journal holds a second wrapup-started. */
const toSecondHolding: readonly Cmd[] = [
  ...toHolding,
  jGateResolve(id(1), "WFailed"),
  jTaskDone(id(1), asTaskId(3), "VPass"),
  jWorkReduce(id(1)),
  jTaskDone(id(1), asTaskId(4), "VPass"),
  jEvalReduce(id(1)),
  jDequeue(id(1), true),
];

/** A store left behind by a run that decided and drained the given commands. */
async function survivingStore(cmds: readonly Cmd[]): Promise<JournalStoreStub> {
  const store = journalStoreStub();
  const executor: Executor = {
    config,
    store,
    ports: { fabric: fabricStub(), desk: deskStub(), wrapUp: wrapUpStub() },
  };
  let state: ActorState = actorInit();
  for (const cmd of cmds) {
    state = await decide(executor, state, cmd);
    state = await drain(executor, state);
  }
  return store;
}

/** A fresh world over the surviving store, booted. */
async function reboot(store: JournalStoreStub): Promise<{
  state: ActorState;
  wrapUp: WrapUpStub;
  arrivals: number;
}> {
  const desk = deskStub();
  const fabric = fabricStub();
  const wrapUp = wrapUpStub();
  const state = await boot({
    config,
    store,
    ports: { fabric, desk, wrapUp },
  });
  return {
    state,
    wrapUp,
    arrivals:
      desk.deliveries.length + fabric.requests.length + wrapUp.handed.length,
  };
}

test("a journal ending in a holding ticket has its gate re-handed under its original identity", async () => {
  const store = await survivingStore(toHolding);
  const { state, wrapUp, arrivals } = await reboot(store);

  assert.equal(state.applied, state.journal.length);
  assert.equal(wrapUp.handed.length, 1);
  assert.equal(arrivals, 1, "boot delivered more than the one re-handed gate");
  const note = wrapUp.handed.at(0);
  assert.ok(note !== undefined);
  assert.equal(note.effect, "OpenGate");

  const opened = state.journal.find(
    (entry) => entry.rec.label === "wrapup-started",
  );
  assert.ok(opened !== undefined, "the walk journaled no wrapup-started entry");
  assert.deepEqual(note.emission, {
    seq: opened.seq,
    effectIndex: opened.rec.effects.indexOf("OpenGate"),
    ticket: id(1),
  });
});

test("after a failed attempt and a rework, the re-handed gate is the second wrapup-started's", async () => {
  const store = await survivingStore(toSecondHolding);
  const { state, wrapUp } = await reboot(store);

  const opened = state.journal.filter(
    (entry) => entry.rec.label === "wrapup-started",
  );
  assert.equal(
    opened.length,
    2,
    "the walk did not open the gate twice, so the scan below has one target",
  );
  const second = opened.at(1);
  assert.ok(second !== undefined);
  assert.equal(wrapUp.handed.length, 1);
  assert.deepEqual(wrapUp.handed.at(0)?.emission, {
    seq: second.seq,
    effectIndex: second.rec.effects.indexOf("OpenGate"),
    ticket: id(1),
  });
});

test("a journal whose fleet holds no lease re-hands nothing", async () => {
  const store = await survivingStore([
    ...toHolding,
    jGateResolve(id(1), "WOk"),
  ]);
  const { state, wrapUp } = await reboot(store);
  assert.equal(state.applied, state.journal.length);
  assert.equal(wrapUp.handed.length, 0);
});

test("a lost cursor is drained first, and both gate deliveries share one identity", async () => {
  const store = await survivingStore(toHolding);
  await store.saveCursor(0);
  const { state, wrapUp } = await reboot(store);

  assert.equal(state.applied, state.journal.length);
  assert.equal(wrapUp.held.size, 2);
  const gates = wrapUp.handed.filter((note) => note.effect === "OpenGate");
  assert.equal(gates.length, 2);
  assert.deepEqual(gates.at(0)?.emission, gates.at(1)?.emission);
});
