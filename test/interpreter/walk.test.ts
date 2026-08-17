/**
 * One ticket driven from arrival to completion against the stub adapters, with
 * the at-least-once environment the model states injected in both directions.
 *
 * EVERY CONTROL HERE IS PAIRED WITH SOMETHING THAT FAILS IT. The ordering check
 * is run once against the walk and once against a sample list carrying an
 * emission before its append; the schedule is read for emissions closed by a
 * later checkpoint, of the walk's own plan and of that plan with a checkpoint
 * hoisted above the emissions it closes; the absorption reading is taken of the
 * walk and of a world that files by arrival; the duplicate delivery is asserted
 * to move nothing beside the first delivery, which must move something. A check
 * nothing fails is not evidence.
 *
 * The domain bundle and every refinement obligation are asserted either side of
 * every decision, by the same `assertStep` the crash-seam suites use, so the
 * walk is held to the model's own gate rather than to a reading of its own.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  jArrive,
  jCompleteDuplicate,
  jDequeue,
  jDispatch,
  jEvalReduce,
  jGateResolve,
  jRelease,
  jTaskDone,
  jWorkReduce,
  type Cmd,
} from "../../src/actor/command.ts";
import { coreEquals } from "../../src/actor/equality.ts";
import {
  actorInit,
  journalStep,
  memoryCore,
  type ActorState,
} from "../../src/actor/state.ts";
import { worldCompletions } from "../../src/actor/world.ts";
import { deskStub } from "../../src/adapters/deskStub.ts";
import { fabricStub } from "../../src/adapters/fabricStub.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { wExclusive } from "../../src/domain/wrapUp.ts";
import {
  decide,
  drain,
  drainPlan,
  recover,
} from "../../src/interpreter/executor.ts";
import type { JournalStore } from "../../src/interpreter/ports.ts";
import {
  assertStep,
  flatProgram,
  refinementInstance,
} from "../actor/harness.ts";
import { depsOf, id } from "../domain/fixtures.ts";
import {
  absorbed,
  emissionPrecedesCheckpoint,
  filingByArrival,
  journalPrecedesEffect,
  reading,
  wiring,
  type Wiring,
} from "./harness.ts";

const config = refinementInstance;

/** The arrival every run here begins with: no deps, one stage, a lease on the one project. */
const arrival: Cmd = jArrive(
  depsOf(),
  flatProgram,
  asProjectId(1),
  wExclusive(1),
);

/** One decision journaled and then drained, with the model's gate asserted at both states. */
async function step(
  wired: Wiring,
  state: ActorState,
  cmd: Cmd,
  label: string,
): Promise<ActorState> {
  const journaled = await decide(wired.executor, state, cmd);
  assert.equal(journaled.view.rec.label, label);
  assertStep(config, journaled, `${label} (journaled)`);
  const drained = await drain(wired.executor, journaled);
  assertStep(config, drained, `${label} (drained)`);
  assert.equal(drained.applied, drained.journal.length);
  return drained;
}

/** Arrival through dispatch: the prefix every run below shares. */
async function walkToWork(wired: Wiring): Promise<ActorState> {
  let state = await step(wired, actorInit(), arrival, "ticket-arrived");
  state = await step(wired, state, jRelease(id(1)), "ticket-released");
  return step(wired, state, jDispatch(id(1)), "dispatch");
}

/** The whole cycle, with the fabric delivering the work task's completion twice. */
async function walkToCompletion(wired: Wiring): Promise<ActorState> {
  let state = await walkToWork(wired);
  const first = jTaskDone(id(1), asTaskId(1), "VPass");
  state = await step(wired, state, first, "task-done");
  state = await step(wired, state, first, "task-done-duplicate");
  state = await step(wired, state, jWorkReduce(id(1)), "work-passed");
  state = await step(
    wired,
    state,
    jTaskDone(id(1), asTaskId(2), "VPass"),
    "task-done",
  );
  state = await step(wired, state, jEvalReduce(id(1)), "eval-passed");
  state = await step(wired, state, jDequeue(id(1), true), "wrapup-started");
  state = await step(wired, state, jGateResolve(id(1), "WOk"), "ticket-done");
  return step(wired, state, jCompleteDuplicate(id(1)), "complete-duplicate");
}

test("one ticket reaches completion, and the world was told once for each decision that asked", async () => {
  const wired = wiring(config);
  const state = await walkToCompletion(wired);

  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "PDone");
  assert.equal(state.applied, state.journal.length);
  assert.equal(worldCompletions(state, id(1)), 1);
  assert.equal(reading(wired).deliveries, reading(wired).held);
});

test("the desk holds one row per bookkeeping effect, each about the ticket its transition stepped", async () => {
  const wired = wiring(config);
  await walkToCompletion(wired);
  assert.deepEqual(
    [...wired.desk.board.values()].map((row) => [
      row.effect,
      row.emission.ticket,
    ]),
    [
      ["CreateDraft", id(1)],
      ["EnqueueWrapUp", id(1)],
      ["OpenGate", id(1)],
      ["Complete", id(1)],
    ],
  );
});

test("the fabric holds the two paid fan-outs and nothing else", async () => {
  const wired = wiring(config);
  await walkToCompletion(wired);
  assert.deepEqual(
    [...wired.fabric.running.values()].map((launch) => launch.set),
    ["Work", "Eval"],
  );
});

test("nothing reached the world before the decision that asked for it was durable", async () => {
  const wired = wiring(config);
  const state = await walkToCompletion(wired);
  assert.ok(
    wired.witness.some((told) => told > 0),
    "every sample is zero, so the check below asked nothing of this run",
  );
  assert.ok(journalPrecedesEffect(config, state.journal, wired.witness));
});

test("and the ordering check is one an emission before its append fails", async () => {
  const wired = wiring(config);
  const state = await walkToCompletion(wired);
  const early = [...wired.witness];
  early[0] = 1;
  assert.ok(
    !journalPrecedesEffect(config, state.journal, early),
    "a world told something before the first entry was durable must fail this",
  );
});

test("every emission is scheduled before the checkpoint that closes its own decision", async () => {
  const wired = wiring(config);
  const state = await walkToCompletion(wired);
  const plan = drainPlan(config, state.journal, 0);
  assert.ok(
    plan.some((step) => step.step === "Emit"),
    "the schedule asks the world for nothing, so the check below reads nothing",
  );
  assert.ok(
    emissionPrecedesCheckpoint(plan),
    "a checkpoint scheduled before its own entry's emissions advances the cursor past effects a crash then loses for good",
  );
});

test("and the scheduling check is one a checkpoint above its own emissions fails", async () => {
  const wired = wiring(config);
  const state = await walkToCompletion(wired);
  const plan = drainPlan(config, state.journal, 0);
  const closes = plan.findIndex((step) => step.step === "Checkpoint");
  const closing = plan[closes];
  assert.ok(closing !== undefined, "the schedule closes no entry to hoist");
  const hoisted = [closing, ...plan.filter((_, index) => index !== closes)];
  assert.ok(
    !emissionPrecedesCheckpoint(hoisted),
    "a decision whose cursor moves before its effects are performed must fail this",
  );
});

test("an entry the store no longer holds emits nothing, whatever memory carries", async () => {
  const wired = wiring(config);
  const state = await decide(wired.executor, actorInit(), arrival);
  wired.store.rows.length = 0;
  await assert.rejects(
    () => drain(wired.executor, state),
    /not the one this actor holds/,
  );
  assert.equal(reading(wired).deliveries, 0);
});

test("a store journal of the right length but the wrong entries emits nothing either", async () => {
  const wired = wiring(config);
  let state = await step(wired, actorInit(), arrival, "ticket-arrived");
  state = await decide(wired.executor, state, jRelease(id(1)));
  const before = reading(wired);

  /** A legal journal of the same length that memory never took: two arrivals where memory released. */
  const forked = journalStep(
    config,
    journalStep(config, actorInit(), arrival),
    arrival,
  );
  wired.store.rows.length = 0;
  for (const entry of forked.journal) await wired.store.append(entry);

  await assert.rejects(
    () => drain(wired.executor, state),
    /not the one this actor holds/,
  );
  assert.deepEqual(reading(wired), before);
});

test("a decision the store refuses reaches neither the world nor a state any caller holds", async () => {
  const desk = deskStub();
  const fabric = fabricStub();
  const refusing: JournalStore = {
    append: () => Promise.reject(new Error("the store took nothing")),
    load: () => Promise.resolve({ parsed: "Ok", value: [] }),
    loadCursor: () => Promise.resolve(0),
    saveCursor: () => Promise.resolve(),
  };
  const executor = { config, store: refusing, ports: { fabric, desk } };
  const state = actorInit();

  await assert.rejects(
    () => decide(executor, state, arrival),
    /the store took nothing/,
  );
  assert.equal(state.journal.length, 0);
  const after = await drain(executor, state);
  assert.equal(after.applied, 0);
  assert.equal(desk.deliveries.length + fabric.requests.length, 0);
});

test("a duplicate task completion is absorbed, and the first delivery is not", async () => {
  const wired = wiring(config);
  let state = await walkToWork(wired);
  const delivery = jTaskDone(id(1), asTaskId(1), "VPass");

  const beforeFirst = memoryCore(state);
  state = await step(wired, state, delivery, "task-done");
  assert.ok(
    !coreEquals(memoryCore(state), beforeFirst),
    "the first delivery must move the fleet, or absorbing the second says nothing",
  );

  const beforeSecond = memoryCore(state);
  const world = reading(wired);
  const rows = state.journal.length;
  state = await step(wired, state, delivery, "task-done-duplicate");
  assert.ok(coreEquals(memoryCore(state), beforeSecond));
  assert.deepEqual(reading(wired), world);
  assert.equal(state.journal.length, rows + 1);
});

test("a lost checkpoint re-delivers the whole prefix, and the world absorbs all of it", async () => {
  const wired = wiring(config);
  const walked = await walkToCompletion(wired);
  const before = reading(wired);

  await wired.store.saveCursor(0);
  let state = await recover(wired.executor);
  assert.ok(
    coreEquals(memoryCore(state), memoryCore(walked)),
    "recovery through the store and the parse rebuilt a different fleet",
  );

  state = await drain(wired.executor, state);
  const after = reading(wired);
  assert.ok(absorbed(before, after));
  assert.equal(after.deliveries, before.deliveries * 2);
  assert.equal(worldCompletions(state, id(1)), 1);
  assertStep(config, state, "after the lost checkpoint");
});

test("and the absorption reading is one a world filing by arrival fails", () => {
  const world = filingByArrival();
  const emission = { seq: 1, effectIndex: 0, ticket: id(1) };
  world.record(emission);
  const before = world.reading();
  world.record(emission);
  assert.ok(
    !absorbed(before, world.reading()),
    "a world that files a re-delivery as a second instruction must fail this",
  );
});
