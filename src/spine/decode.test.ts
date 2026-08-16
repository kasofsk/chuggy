/**
 * The two tiers decoding into one `Cmd` vocabulary.
 *
 * THE CENTRAL CASE IS A CROSS-VALIDATION, and it is the strongest evidence
 * available for the tier-2 reconstruction. A tier-1 trace carries the model's
 * OWN decision events — the action that fired and the picks it drew — so
 * reconstructing the same trace with those events hidden and requiring the same
 * commands back is the reconstruction checked against ground truth rather than
 * against its author's reasoning. Every committed tier-1 fixture is put through
 * it, which is every label sampling reaches.
 *
 * WHAT THAT CASE CANNOT COVER is the handful of labels only the witness traces
 * carry — the wrap-up budget wall, the free pipeline resume — because tier 2 is
 * where they live and there is no tier-1 twin to check them against. Those are
 * covered one layer up and end to end: a mis-reconstructed command produces a
 * different `StepRecord`, and `check-conformance.sh` replays every tier-2
 * fixture step for step.
 *
 * The rest of this file is refusals, which no corpus can contain.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  decodeSteps,
  reachableStepLabels,
  stepLabel,
  type StepPlan,
} from "./decode.ts";
import { DecodeError, decodeTrace, type DecodedTrace } from "./itf.ts";

/** The committed tier-1 fixtures, which are the ones carrying decision events. */
const tier1: readonly string[] = [
  "budgeted-cascade-park",
  "budgeted-dequeue-to-gate",
  "budgeted-landing-duplicate",
  "budgeted-gated-completion",
  "budgeted-eval-stage-advance",
  "budgeted-work-failed",
  "budgeted-desk-only-revoke",
  "deadline-only-gate-rework",
  "retryfree-settled",
];

function load(name: string): DecodedTrace {
  return decodeTrace(
    JSON.parse(readFileSync(`corpus/tier1/${name}.itf.json`, "utf8")),
    name,
  );
}

/** The same trace with its decision events hidden, which is what tier 2 is. */
function asWitness(trace: DecodedTrace): DecodedTrace {
  return {
    hasDecisionEvents: false,
    states: trace.states.map(({ action, picks, ...rest }) => {
      void action;
      void picks;
      return rest;
    }),
  };
}

/** A plan without the tier-1 pick that rides a stutter step. */
function withoutRecorded(plan: StepPlan): StepPlan {
  return plan.kind === "stutter"
    ? { kind: plan.kind, label: plan.label }
    : plan;
}

test("reconstruction agrees with the model's own decision events, fixture for fixture", () => {
  const seen = new Set<string>();
  for (const name of tier1) {
    const trace = load(name);
    assert.ok(trace.hasDecisionEvents, `${name} carries decision events`);
    // The recorded pick is dropped from both sides: it is what tier 1 has and
    // tier 2 structurally cannot, so comparing it would compare the tiers
    // rather than the commands. It is pinned on its own below.
    const native = decodeSteps(trace, name).map(withoutRecorded);
    const rebuilt = decodeSteps(asWitness(trace), name).map(withoutRecorded);
    assert.deepEqual(rebuilt, native, name);
    for (const state of trace.states) {
      seen.add(state.lastStep.label);
    }
  }
  // The agreement is over a real spread of labels rather than over one shape:
  // every label the tier-1 corpus reaches has been reconstructed here.
  for (const label of seen) {
    assert.ok(
      reachableStepLabels.includes(
        stepLabel(
          { label, transitions: [], effects: [], landing: { tag: "WONone" } },
          "roster",
        ),
      ),
    );
  }
  assert.ok(
    seen.size > tier1.length,
    "the fixtures cover more labels than there are of them",
  );
});

test("the stutter steps decode to a plan and not to a guessed pick", () => {
  // Tier 1 records the pick, and it rides along — the class is what checks the
  // step, and a recorded pick is one more member of it. Tier 2 has none, and
  // the plan is the same shape without it.
  const trace = load("budgeted-landing-duplicate");
  const native = decodeSteps(trace, "t");
  const stutters = native.filter((plan) => plan.kind === "stutter");
  assert.ok(stutters.length > 0);
  for (const plan of stutters) {
    assert.ok(plan.recorded !== undefined);
  }
  for (const plan of decodeSteps(asWitness(trace), "t")) {
    if (plan.kind === "stutter") {
      assert.equal(plan.recorded, undefined);
    }
  }
});

test("a settled step drives no command, in either tier", () => {
  const trace = load("retryfree-settled");
  for (const source of [trace, asWitness(trace)]) {
    const plans = decodeSteps(source, "t");
    const settled = plans.filter((plan) => plan.kind === "settled");
    assert.equal(settled.length, 1, "the emitter keeps one settled step");
  }
});

// === Refusals ==============================================================

const genesis = {
  core: { tickets: new Map() },
  lastStep: {
    label: "init",
    transitions: [],
    effects: [],
    landing: { tag: "WONone" as const },
  },
  prevMeasure: 0,
  prevRecords: new Map(),
};

function traceOf(
  hasDecisionEvents: boolean,
  second: Partial<DecodedTrace["states"][number]>,
): DecodedTrace {
  return {
    hasDecisionEvents,
    states: [genesis, { ...genesis, ...second }],
  };
}

test("a label outside the reachable roster is a decode failure", () => {
  // `operator-retry-unreachable` is the model's guarded no-op: the machine
  // cannot emit it, so a trace carrying it is not a trace of this machine.
  for (const label of ["operator-retry-unreachable", "ticket-teleported"]) {
    assert.throws(
      () =>
        decodeSteps(
          traceOf(false, { lastStep: { ...genesis.lastStep, label } }),
          "t",
        ),
      (error: unknown) =>
        error instanceof DecodeError && error.message.includes(label),
      label,
    );
  }
});

test("an action outside the machine's roster is a decode failure", () => {
  assert.throws(
    () =>
      decodeSteps(
        traceOf(true, {
          action: "teleport",
          picks: {},
          lastStep: { ...genesis.lastStep, label: "ticket-released" },
        }),
        "t",
      ),
    (error: unknown) =>
      error instanceof DecodeError && /teleport/.test(error.message),
  );
});

test("an action whose pick the trace did not bind is a decode failure", () => {
  assert.throws(
    () =>
      decodeSteps(
        traceOf(true, {
          action: "release",
          picks: {},
          lastStep: { ...genesis.lastStep, label: "ticket-released" },
        }),
        "t",
      ),
    (error: unknown) =>
      error instanceof DecodeError && /draws j/.test(error.message),
  );
});

test("a stutter label under the wrong action is a decode failure", () => {
  // The label and the action are two independent carriers of the same fact, and
  // a trace where they disagree is one this decoder must not read past.
  assert.throws(
    () =>
      decodeSteps(
        traceOf(true, {
          action: "release",
          picks: { ticket: 1 },
          lastStep: { ...genesis.lastStep, label: "complete-duplicate" },
        }),
        "t",
      ),
    (error: unknown) =>
      error instanceof DecodeError && /completeDuplicate/.test(error.message),
  );
});

test("a landing route whose observation and from-phase disagree is a decode failure", () => {
  // `ticket-done` arrives by three routes and the landing observation picks
  // one; the from-phase is checked against it rather than trusted.
  assert.throws(
    () =>
      decodeSteps(
        traceOf(false, {
          lastStep: {
            label: "ticket-done",
            transitions: [{ ticket: 1, from: "PWrapUp", to: "PDone" }],
            effects: ["Complete"],
            landing: { tag: "WOAttempt", project: 1, invalidated: true },
          },
        }),
        "t",
      ),
    (error: unknown) =>
      error instanceof DecodeError && /PWrapUpHolding/.test(error.message),
  );
});

test("a landing failure that records no invalidated attempt is a decode failure", () => {
  // `wrapUpOutcomes` makes a quiet failure undrawable, so a failing landing
  // that claims a valid attempt is not a step this machine takes.
  assert.throws(
    () =>
      decodeSteps(
        traceOf(false, {
          lastStep: {
            label: "rework-started wrapup_failure",
            transitions: [
              { ticket: 1, from: "PWrapUpHolding", to: "PWorking" },
            ],
            effects: ["SpawnWorkTasks"],
            landing: { tag: "WOAttempt", project: 1, invalidated: false },
          },
        }),
        "t",
      ),
    DecodeError,
  );
});

test("a step whose label steps a ticket and records no transition is a decode failure", () => {
  assert.throws(
    () =>
      decodeSteps(
        traceOf(false, {
          lastStep: { ...genesis.lastStep, label: "dispatch" },
        }),
        "t",
      ),
    (error: unknown) =>
      error instanceof DecodeError &&
      /records no transition/.test(error.message),
  );
});

test("a task completion that resolved no live task is a decode failure", () => {
  // The reconstruction reads the one running task that became resolved. None
  // and two are both refused, because neither is one delivery.
  assert.throws(
    () =>
      decodeSteps(
        traceOf(false, {
          lastStep: { ...genesis.lastStep, label: "task-done" },
        }),
        "t",
      ),
    (error: unknown) =>
      error instanceof DecodeError &&
      /exactly one live task/.test(error.message),
  );
});

test("an arrival that did not densely extend the fleet is a decode failure", () => {
  assert.throws(
    () =>
      decodeSteps(
        traceOf(false, {
          lastStep: { ...genesis.lastStep, label: "ticket-arrived" },
        }),
        "t",
      ),
    (error: unknown) =>
      error instanceof DecodeError && /no ticket 1 arrived/.test(error.message),
  );
});
