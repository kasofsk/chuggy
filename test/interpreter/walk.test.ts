/**
 * One ticket driven from release to completion against the stub adapters, with
 * the at-least-once environment the model states injected in both directions.
 *
 * EVERY CONTROL HERE IS PAIRED WITH SOMETHING THAT FAILS IT. The ordering check
 * is run once against the walk and once against a sample list carrying an
 * emission before its append; the schedule is read for emissions closed by a
 * later checkpoint, of the walk's own plan and of that plan with a checkpoint
 * hoisted above the emissions it closes; the absorption reading is taken of the
 * walk and of a world that files by arrival. A check nothing fails is not
 * evidence.
 *
 * The domain bundle and every refinement obligation are asserted either side of
 * every decision, by the same `assertStep` the crash-seam suites use, so the
 * walk is held to the model's own gate rather than to a reading of its own.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchEvent,
  evalReduceEvent,
  executionBlockedEvent,
  finalizationResultEvent,
  releaseTicketEvent,
  taskDoneEvent,
  workReduceEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
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
import { finalizerStub } from "../../src/adapters/finalizerStub.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import {
  decide,
  drain,
  drainPlan,
  recover,
} from "../../src/interpreter/executor.ts";
import type { JournalStore } from "../../src/interpreter/ports.ts";
import {
  assertStep,
  plainAuthoring,
  plainResult,
  refinementInstance,
} from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";
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

/** The release every run here begins with: no deps, one stage, a managed finalizer. */
const release: DecisionEvent = releaseTicketEvent(id(1), plainAuthoring);

/** One decision journaled and then drained, with the model's gate asserted at both states. */
async function step(
  wired: Wiring,
  state: ActorState,
  event: DecisionEvent,
  label: string,
): Promise<ActorState> {
  const journaled = await decide(wired.executor, state, event);
  assert.equal(journaled.view.rec.label, label);
  assertStep(config, journaled, `${label} (journaled)`);
  const drained = await drain(wired.executor, journaled);
  assertStep(config, drained, `${label} (drained)`);
  assert.equal(drained.applied, drained.journal.length);
  return drained;
}

/** Release through dispatch: the prefix every run below shares. */
async function walkToWork(wired: Wiring): Promise<ActorState> {
  const state = await step(wired, actorInit(), release, "ticket-released");
  return step(wired, state, dispatchEvent(id(1)), "dispatch");
}

/** The whole cycle: both task sets pass, the finalizer reports, the ticket lands. */
async function walkToCompletion(wired: Wiring): Promise<ActorState> {
  let state = await walkToWork(wired);
  state = await step(
    wired,
    state,
    taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
    "task-done",
  );
  state = await step(wired, state, workReduceEvent(id(1)), "work-passed");
  state = await step(
    wired,
    state,
    taskDoneEvent(id(1), asTaskId(2), "Pass", plainResult),
    "task-done",
  );
  state = await step(wired, state, evalReduceEvent(id(1)), "eval-passed");
  return step(
    wired,
    state,
    finalizationResultEvent(id(1), "FinalizationSucceeded"),
    "ticket-done",
  );
}

/** The one route in this suite that asks the desk for anything. */
async function walkToEscalation(wired: Wiring): Promise<ActorState> {
  const state = await walkToWork(wired);
  return step(
    wired,
    state,
    executionBlockedEvent(id(1), "TicketConfigIncompatible"),
    "ticket-escalated execution_blocked",
  );
}

test("one ticket reaches completion, and the world was told once for each decision that asked", async () => {
  const wired = wiring(config);
  const state = await walkToCompletion(wired);

  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(state.applied, state.journal.length);
  assert.equal(worldCompletions(state, id(1)), 1);
  assert.equal(reading(wired).deliveries, reading(wired).held);
});

test("completion asks the desk for nothing, because entering Done is the completion", async () => {
  const wired = wiring(config);
  await walkToCompletion(wired);
  assert.equal(wired.desk.deliveries.length, 0);
});

test("the desk holds one row per parked ticket, about the ticket its transition stepped", async () => {
  const wired = wiring(config);
  await walkToEscalation(wired);
  assert.deepEqual(
    [...wired.desk.board.values()].map((row) => [
      row.effect,
      row.emission.ticket,
    ]),
    [["OpenHumanTask", id(1)]],
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
    plan.some((one) => one.step === "Emit"),
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
  const closes = plan.findIndex(
    (one, index) =>
      one.step === "Checkpoint" &&
      plan
        .slice(0, index)
        .some(
          (earlier) =>
            earlier.step === "Emit" && earlier.planned.emission.seq === one.seq,
        ),
  );
  const closing = plan[closes];
  assert.ok(closing !== undefined, "the schedule closes no emission to hoist");
  const hoisted = [closing, ...plan.filter((_, index) => index !== closes)];
  assert.ok(
    !emissionPrecedesCheckpoint(hoisted),
    "a decision whose cursor moves before its effects are performed must fail this",
  );
});

test("an entry the store no longer holds emits nothing, whatever memory carries", async () => {
  const wired = wiring(config);
  const state = await decide(wired.executor, actorInit(), release);
  wired.store.rows.length = 0;
  await assert.rejects(
    () => drain(wired.executor, state),
    /not the one this actor holds/,
  );
  assert.equal(reading(wired).deliveries, 0);
});

test("a store journal of the right length but the wrong entries emits nothing either", async () => {
  const wired = wiring(config);
  let state = await step(wired, actorInit(), release, "ticket-released");
  state = await decide(wired.executor, state, dispatchEvent(id(1)));
  const before = reading(wired);

  /** A legal journal of the same length memory never took: a second release where memory dispatched. */
  const forked = journalStep(
    config,
    journalStep(config, actorInit(), release),
    releaseTicketEvent(id(2), plainAuthoring),
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
  const finalizer = finalizerStub();
  const refusing: JournalStore = {
    append: () => Promise.reject(new Error("the store took nothing")),
    load: () => Promise.resolve({ parsed: "Ok", value: [] }),
    loadCursor: () => Promise.resolve(0),
    saveCursor: () => Promise.resolve(),
  };
  const executor = {
    config,
    store: refusing,
    ports: { fabric, finalizer, desk },
  };
  const state = actorInit();

  await assert.rejects(
    () => decide(executor, state, release),
    /the store took nothing/,
  );
  assert.equal(state.journal.length, 0);
  const after = await drain(executor, state);
  assert.equal(after.applied, 0);
  assert.equal(
    desk.deliveries.length + fabric.requests.length + finalizer.requests.length,
    0,
  );
});

test("a task the fabric reports twice is refused the second time, and moves neither the fleet nor the world", async () => {
  const wired = wiring(config);
  let state = await walkToWork(wired);
  const delivery = taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult);

  const beforeFirst = memoryCore(state);
  state = await step(wired, state, delivery, "task-done");
  assert.ok(
    !coreEquals(memoryCore(state), beforeFirst),
    "the first delivery must move the fleet, or refusing the second says nothing",
  );

  const beforeSecond = memoryCore(state);
  const world = reading(wired);
  const rows = state.journal.length;
  await assert.rejects(
    () => decide(wired.executor, state, delivery),
    /TaskDone is refused/,
  );
  assert.ok(coreEquals(memoryCore(state), beforeSecond));
  assert.deepEqual(reading(wired), world);
  assert.equal(state.journal.length, rows);
  assert.equal(wired.store.rows.length, rows);
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
