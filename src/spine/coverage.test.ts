/**
 * The coverage obligations, and the arm attribution that reads the shipped
 * `stepDescends` rather than restating it.
 *
 * THE ATTRIBUTION IS THE PART WORTH TESTING. It claims that a label plus a
 * pricing probe names the arm a step fired, and that claim is checkable in the
 * one way that matters: every arm of the model's roster must be attributed to
 * ITSELF, and a step under no arm must be attributed to none. The roster below
 * is `model/domain.qnt`'s, entry for entry, and `invariants.test.ts` walks the
 * same one for the predicate — this file walks it for the attribution.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Config } from "../domain/domain.ts";
import {
  cfgBudgeted,
  cfgRetryFree,
  jDraft,
  solo,
} from "../domain/fixtures.test.ts";
import type { Core, Phase, StepRecord } from "../domain/measure.ts";
import {
  CoverageBuilder,
  coverageGaps,
  exemptionArms,
  exemptionArmOf,
  mcInstances,
  type ExemptionArm,
} from "./coverage.ts";
import { reachableStepLabels, type StepLabel } from "./decode.ts";

const flat = (label: string): StepRecord => ({
  label,
  transitions: [],
  effects: [],
  attempt: { tag: "WONone" },
});

const moving = (label: string, from: Phase, to: Phase): StepRecord => ({
  ...flat(label),
  transitions: [{ ticket: 1, from, to }],
});

const c: Core = solo(jDraft);

/**
 * `model/domain.qnt`'s exemption roster as steps: one climbing step per arm,
 * at an instance where that arm can fire. Shared by the attribution case and
 * the obligation case, because it is one roster and a second copy of it would
 * be the drift this file is checking for.
 */
const armRows: readonly (readonly [ExemptionArm, Config, StepRecord])[] = [
  ["init", cfgBudgeted, flat("init")],
  ["task-done-duplicate", cfgBudgeted, flat("task-done-duplicate")],
  ["complete-duplicate", cfgBudgeted, flat("complete-duplicate")],
  ["settled", cfgBudgeted, flat("settled")],
  [
    "operator-retry, RPending flavor",
    cfgBudgeted,
    moving("operator-retry", "PEscalated", "PPending"),
  ],
  [
    "operator-retry, RetryFree pipeline flavor",
    cfgRetryFree,
    moving("operator-retry", "PEscalated", "PEvaluating"),
  ],
  ["ticket-arrived", cfgBudgeted, flat("ticket-arrived")],
  [
    "ticket-revoked, desk-only flat",
    cfgBudgeted,
    moving("ticket-revoked", "PEscalated", "PRevoked"),
  ],
];

test("exemptionArmOf: the model's eight arms, each attributed to itself", () => {
  for (const [arm, cfg, lastStep] of armRows) {
    assert.equal(exemptionArmOf(cfg, c, lastStep), arm, arm);
  }
  // EVERY ARM, and the roster is the one the obligation is checked against.
  assert.deepEqual(
    new Set(armRows.map(([arm]) => arm)),
    new Set(exemptionArms),
  );
});

test("exemptionArmOf: the pricing is what separates the two resume flavors", () => {
  // The pipeline resume is exempt only where it is free. Under RetryCharged the
  // same step fires no arm at all, which is what makes the probe an attribution
  // rather than a label lookup.
  const pipeline = moving("operator-retry", "PEscalated", "PEvaluating");
  assert.equal(
    exemptionArmOf(cfgRetryFree, c, pipeline),
    "operator-retry, RetryFree pipeline flavor",
  );
  assert.equal(exemptionArmOf(cfgBudgeted, c, pipeline), undefined);
  // The pre-work resume is free under BOTH, so it is attributed to the RPending
  // flavor even at the free instance.
  const preWork = moving("operator-retry", "PEscalated", "PPending");
  assert.equal(
    exemptionArmOf(cfgRetryFree, c, preWork),
    "operator-retry, RPending flavor",
  );
});

test("exemptionArmOf: a step under no arm is attributed to none", () => {
  const rows: readonly StepRecord[] = [
    moving("dispatch", "PPending", "PWorking"),
    moving("ticket-released", "PDraft", "PPending"),
    flat("task-done"),
    moving("ticket-done", "PWrapUp", "PDone"),
    // A revoke that drags a LIVE rank down is not the desk-only arm, and the
    // label alone could not tell the two apart.
    {
      ...flat("ticket-revoked"),
      transitions: [
        { ticket: 1, from: "PEscalated", to: "PRevoked" },
        { ticket: 2, from: "PPending", to: "PEscalated" },
      ],
    },
  ];
  for (const lastStep of rows) {
    assert.equal(
      exemptionArmOf(cfgBudgeted, c, lastStep),
      undefined,
      lastStep.label,
    );
  }
});

test("coverageGaps: a full corpus has none, and each roster is checked both ways", () => {
  // Observed through the real accumulator rather than a hand-built set: what
  // the gate reports is what this builder holds. Every decider is reached by
  // observing every command, which is `cmd.test.ts`'s pin rather than a second
  // roster here.
  const full = new CoverageBuilder();
  for (const label of reachableStepLabels) {
    full.observeLabel(label);
  }
  for (const instance of mcInstances) {
    full.observeInstance(instance);
  }
  for (const [, cfg, lastStep] of armRows) {
    full.observeArm(cfg, c, lastStep);
  }
  full.observeCmd({
    tag: "JArrive",
    deps: new Set(),
    program: [],
    project: 1,
    wrapUp: { tag: "WNone" },
  });
  full.observeCmd({ tag: "JRelease", ticket: 1 });
  full.observeCmd({ tag: "JRevoke", ticket: 1 });
  full.observeCmd({ tag: "JDispatch", ticket: 1 });
  full.observeCmd({ tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VPass" });
  full.observeCmd({ tag: "JWorkReduce", ticket: 1 });
  full.observeCmd({ tag: "JEvalReduce", ticket: 1 });
  full.observeCmd({ tag: "JDequeue", ticket: 1, moved: true });
  full.observeCmd({ tag: "JDequeue", ticket: 1, moved: false });
  full.observeCmd({ tag: "JGateResolve", ticket: 1, out: "WOk" });
  full.observeCmd({ tag: "JCompleteDuplicate", ticket: 1 });
  full.observeCmd({ tag: "JRevalFail", ticket: 1 });
  full.observeCmd({ tag: "JOpRetry", ticket: 1 });
  // Every nondet draw the machine's actions make, which is the fourth
  // obligation: a tier-1 trace is the only place a pick is decoded at all.
  full.observePicks({
    deps: new Set(),
    program: [],
    project: 1,
    wrapUp: { tag: "WNone" },
    ticket: 1,
    tid: 1,
    verdict: "VPass",
    moved: true,
    out: "WOk",
  });
  assert.deepEqual(coverageGaps(full.taken()), []);

  // One entry short of each roster, and the gap names it.
  const short = new CoverageBuilder();
  const missing = coverageGaps(short.taken());
  const obligations = new Set(missing.map((gap) => gap.obligation));
  assert.deepEqual(
    obligations,
    new Set([
      "decider",
      "step label",
      "stepDescends exemption arm",
      "mc instance",
      "nondet binder",
    ]),
  );

  // And a roster entry reached that no roster names is reported too — the
  // direction that catches this tree's rosters drifting from the machine's.
  const strange = new CoverageBuilder();
  strange.observeLabel("ticket-teleported" as StepLabel);
  assert.ok(
    coverageGaps(strange.taken()).some((gap) =>
      gap.missing.includes("ticket-teleported"),
    ),
  );
});

test("observePicks: the binder roster is the decoder's own table", () => {
  // A tier-1 trace is the only place a pick is decoded, so the binders it
  // bound are a coverage roster in their own right — and the names come from
  // `itf.ts`'s table rather than from a second list, so the roster the gate
  // reports and the roster the decoder demands cannot drift apart.
  const builder = new CoverageBuilder();
  builder.observePicks({ ticket: 1, moved: true });
  assert.deepEqual(builder.taken().binders, new Set(["j", "moved"]));

  // The obligation is stated over the whole table: a corpus that stopped
  // binding one draw is a decode arm nothing exercises.
  const gaps = coverageGaps(builder.taken()).filter(
    (gap) => gap.obligation === "nondet binder",
  );
  assert.deepEqual(
    new Set(gaps.map((gap) => gap.missing.split(" ")[0])),
    new Set(["deps_", "prog", "project_", "wrapUp_", "tid", "v", "out"]),
  );
});
