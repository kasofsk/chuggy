/**
 * THE RANDOMIZED LAYER — `check-model.sh`'s `--invariant=allInvariants` stage,
 * mirrored: seeded random legal action walks at each mc instance's consts, the
 * whole domain bundle after every step, and the model's three anti-vacuity
 * witnesses as expected-violation probes.
 *
 * WHY IT IS NOT ENOUGH TO HAVE THE CORPUS. `check-conformance.sh` replays the
 * traces the model emitted, so it can only re-ask the questions the model
 * already asked. The model's own header records what that misses: twice an
 * all-green deterministic suite hid a defect that only randomized exploration
 * found. This suite is the same net under the same machine, one layer up.
 *
 * THE INSTANCES ARE READ OUT OF THE MODEL, not written down here.
 * `mc/mc_chuggy.qnt` is where the three instances' consts live, and
 * `corpus.ts`'s reader is what the emitter already uses to check a fixture's
 * manifest entry against them — so "at the mc consts" is a fact this file
 * cannot drift from rather than a claim it makes. The three configurations in
 * `fixtures.test.ts` are deliberately NOT reused: two of them are
 * `chuggy_test`'s instances, which differ from the mc ones in `N_TICKETS`, and
 * a walk at the wrong fleet bound is a walk of a different machine.
 *
 * THE SEEDS AND BUDGETS ARE DATA, and the walks are run once at module scope
 * because several probes read them. `just check` is the whole of CI here, so
 * the budget below is what fits beside every other gate rather than what the
 * machine could absorb; the command that measures what it costs is at
 * `walkBudget`.
 *
 * WHAT THE SAMPLED WALKS REACH, AND WHAT THEY DO NOT. Uniform random action
 * choice at these consts is dominated by authoring churn — `revoke` is enabled
 * for every non-terminal ticket, so the fleet is settled long before a ticket
 * reaches a gate. That is the MODEL's profile too, not an artifact of this
 * implementation: the corpus's own manifest records that finding a
 * `wrapup-started` step by sampling took 20000 samples of 60 steps, against
 * 500 for a cascade park. So the rosters the walks are asserted to reach below
 * are the shallow half of the machine, and the deep half is covered exactly
 * where the model covers it — by deterministic traces, here and in the corpus.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../domain/domain.ts";
import type { Core } from "../domain/measure.ts";
import { jDone, solo } from "../domain/fixtures.test.ts";
import type { Stage, WrapUp } from "../domain/measure.ts";
import {
  CorpusError,
  configOf,
  mcSource,
  readAntiVacuityWitnesses,
  readModuleConsts,
} from "../tools/corpus.ts";
import { rosterDisagrees } from "../tools/verify.ts";
import { cmdEnabled, type Cmd } from "./cmd.ts";
import {
  CoverageBuilder,
  mcInstances,
  type Coverage,
  type ExemptionArm,
  type McInstance,
} from "./coverage.ts";
import type { StepLabel } from "./decode.ts";
import {
  currentMeasure,
  initStepRecord,
  initialState,
  stepWith,
  type MachineState,
} from "./machine.ts";
import {
  availableActions,
  driveTrace,
  hex,
  observeOnce,
  draw,
  showCmd,
  subsetsOf,
  taskIds,
  walkOnce,
  walkSeeds,
  witnessNames,
  type Available,
  type RunResult,
} from "./walk.test.ts";

// === The budget, and the seeds =============================================

/**
 * THE BUDGET, PER INSTANCE. Walks rather than steps is the knob that matters:
 * at these consts every walk in every run below ends on its own — a quiet fleet
 * or a dead end — well inside the step cap, so raising `steps` buys nothing and
 * raising `walks` buys everything.
 *
 * MEASURED, and this is the command that re-measures it:
 *
 *   time node --test src/spine/randomized.test.ts
 *
 * Re-run it after changing either number, and after any change to the
 * enumeration: the cost per step is dominated by filtering the arrival's
 * payload product through `cmdEnabled`, which is the largest single thing this
 * suite does.
 *
 * NOTHING CAPS THIS STAGE, so the budget is a judgement and not a limit obeyed,
 * and it is worth being exact about which ceiling is which. The per-suite cap
 * in `.chug/tasks/ci.sh` governs the SHELL-suite stage; the TypeScript tests
 * run uncapped inside `check-ts.sh`. What actually bounds the budget is `just
 * check` as a whole, and the comparison there is this: node runs the test files
 * in parallel, so this one file is now the wall clock of the test stage —
 * every other suite in the tree finishes inside it — while the stage as a whole
 * stays a fraction of `check-model.sh`, which remains by a wide margin the
 * slowest gate. `time ./.chug/tasks/check-ts.sh test` and `time
 * ./.chug/tasks/check-model.sh` are the two commands that check that ordering
 * has not changed.
 */
export const walkBudget = { walks: 300, steps: 40 } as const;

/**
 * ONE ROOT SEED PER INSTANCE, and the three are the pinned seeds this tree
 * already carries rather than new ones: `0x2a` is the seed most of
 * `corpus/manifest.json`'s sampled fixtures were emitted at (two of them carry
 * `0x1` — the manifest is the roster), and `0xb1` and `0xf1` are the two
 * resistance probes PLAN.md records. Which instance draws which is arbitrary —
 * a root is a starting point, not a property of a machine — and reusing them
 * keeps one set of pinned seeds in the tree instead of two.
 *
 * A ROOT PER INSTANCE RATHER THAN ONE FOR ALL THREE, because the budgeted and
 * deadline-only instances differ only in gate pricing — a difference no step
 * before a landing can see. Walked from the same root they would take the same
 * trace and the second run would be free of information; from different roots
 * they explore different parts of one shared shallow region.
 */
export const walkRoots: Readonly<Record<McInstance, number>> = {
  budgeted: 0x2a,
  deadline_only: 0xb1,
  retryfree: 0xf1,
};

// === The instances, read out of the model ==================================

const configs: Readonly<Record<McInstance, Config>> = {
  budgeted: instanceConfig("budgeted"),
  deadline_only: instanceConfig("deadline_only"),
  retryfree: instanceConfig("retryfree"),
};

function instanceConfig(instance: McInstance): Config {
  return configOf(
    readModuleConsts(mcSource, `mc_chuggy_${instance}`),
    `mc_chuggy_${instance}`,
  );
}

// === The runs ==============================================================

/** One instance's whole run: every walk, folded. */
type InstanceRun = {
  readonly instance: McInstance;
  readonly walks: readonly RunResult[];
  readonly coverage: Coverage;
  readonly firings: ReadonlyMap<string, string>;
  readonly findings: readonly string[];
  readonly steps: number;
};

const runs: readonly InstanceRun[] = mcInstances.map((instance) =>
  runInstance(instance),
);

function runInstance(instance: McInstance): InstanceRun {
  const cfg = configs[instance];
  const walks = walkSeeds(walkRoots[instance], walkBudget.walks).map((seed) =>
    walkOnce(cfg, instance, seed, walkBudget.steps),
  );
  return { instance, walks, ...fold(walks) };
}

/**
 * The union of a run of walks — rosters unioned, witnesses kept at their first
 * firing, and the findings folded to ONE COUNTEREXAMPLE IN FULL.
 *
 * THE FOLD IS WHERE A CONCATENATION WOULD BE WRONG. A defect in a decider is
 * not found by one walk, it is found by a third of them, and every one of those
 * findings is the same defect wearing a different seed — so concatenating them
 * puts hundreds of lines in front of a reader who needs one, and buries the
 * seed that reproduces it in the middle. What is kept is the shape this file
 * argues for one level down: the first finding whole, and then the count of
 * walks that also found something, which is what separates "a defect on one
 * exotic path" from "a defect on every path". Every one of those walks is
 * reproducible from its own seed, which is why none of them has to be printed.
 *
 * A COUNT AND NOT A ROSTER, and the distinction is the one this tree draws
 * elsewhere: a roster is owed where the entries are the EVIDENCE — which
 * decider, which label, which arm — and a list of two hundred seeds that all
 * reproduce the same step is not evidence, it is the same evidence two hundred
 * times.
 */
function fold(results: readonly RunResult[]): {
  readonly coverage: Coverage;
  readonly firings: ReadonlyMap<string, string>;
  readonly findings: readonly string[];
  readonly steps: number;
} {
  const coverage = new CoverageBuilder();
  const firings = new Map<string, string>();
  let first: string | undefined = undefined;
  let alsoFound = 0;
  let steps = 0;
  for (const result of results) {
    coverage.absorb(result.coverage);
    steps += result.steps;
    const [finding] = result.findings;
    if (finding !== undefined) {
      if (first === undefined) {
        first = finding;
      } else {
        alsoFound += 1;
      }
    }
    for (const firing of result.firings) {
      if (!firings.has(firing.witness)) {
        firings.set(
          firing.witness,
          `${result.where} step ${String(firing.step)} (${firing.label})`,
        );
      }
    }
  }
  const findings =
    first === undefined
      ? []
      : alsoFound === 0
        ? [first]
        : [
            first,
            `and ${String(alsoFound)} of the run\u2019s other ${String(results.length - 1)} walks found something too, each reproducible from its own seed`,
          ];
  return { coverage: coverage.taken(), firings, findings, steps };
}

// === The walks =============================================================

test("the seeded walks hold allInvariants at every step, on all three mc instances", () => {
  for (const run of runs) {
    // ONE WHOLE FINDING, never a bare count: what `fold` keeps is the first
    // walk's finding entire — its seed, its step index, the command taken and
    // the conjuncts that went red — and this is the assertion that puts it in
    // front of whoever reads the failure.
    assert.deepEqual(
      run.findings,
      [],
      `${run.instance}: the walk found something`,
    );
    assert.ok(run.steps > 0, `${run.instance}: the walk took no steps at all`);
  }
});

test("every walk is reproducible from its seed alone, and two seeds are two walks", () => {
  // THE POINT OF THE SEEDED GENERATOR, asserted rather than assumed: a defect
  // this layer reports is worth reporting only if the walk that found it can be
  // re-run. Same seed, same walk — the whole result, trace and rosters and
  // witness firings alike.
  const cfg = configs.budgeted;
  const [first, second] = walkSeeds(0x2a, 2);
  assert.ok(first !== undefined && second !== undefined);
  const once = walkOnce(cfg, "budgeted", first, walkBudget.steps);
  const again = walkOnce(cfg, "budgeted", first, walkBudget.steps);
  assert.deepEqual(again, once);
  // AND THE OTHER HALF, ASKED OF THE TRACE RATHER THAN THE COVERAGE. Two
  // different walks routinely reach the same label set — the shallow region is
  // small — so a coverage comparison here would be asking whether two runs
  // COLLIDED in a lossy signature, and would pass or fail on how coarse that
  // signature happens to be. The step sequence is the run itself.
  const other = walkOnce(cfg, "budgeted", second, walkBudget.steps);
  assert.notDeepEqual(other.trace, once.trace);
});

test("each instance's walk reaches the roster it is stated to reach", () => {
  // ROSTERS, NOT COUNTS: what the exploration reached, entry by entry, so that
  // a walk that quietly stopped reaching a decider is a red gate rather than a
  // number nobody compares. Stated as a floor rather than as an exact set —
  // exploration that reaches MORE is not a regression, and pinning the exact
  // set would make every improvement a failure.
  for (const run of runs) {
    assert.deepEqual(
      sampledDeciders.filter((d) => !run.coverage.deciders.has(d)),
      [],
      `${run.instance}: the walk stopped reaching a decider it used to`,
    );
    assert.deepEqual(
      sampledLabels.filter((l) => !run.coverage.labels.has(l)),
      [],
      `${run.instance}: the walk stopped reaching a step label it used to`,
    );
    assert.deepEqual(
      sampledArms.filter((a) => !run.coverage.arms.has(a)),
      [],
      `${run.instance}: the walk stopped firing an exemption arm it used to`,
    );
  }
});

/**
 * WHAT UNIFORM SAMPLING REACHES AT THESE CONSTS, on EVERY one of the three
 * instances — the intersection, measured at the budget and roots above. The
 * budgeted root reaches more than this (its walks also pass an evaluation and
 * land a ticket outright), and the floor deliberately does not say so. Those
 * two entries are one walk in three hundred each — the same thinness the
 * `work-passed` caveat below describes, and here it is the reason for leaving
 * them out rather than a caveat on keeping them in: an entry one run reaches
 * and the others do not is a claim about one seed rather than about the
 * exploration.
 *
 * THE FLOORS ARE INSTANCE-BLIND BY CONSTRUCTION — one shared list checked
 * against all three runs — and that is a decision rather than an omission. What
 * distinguishes the three instances is gate pricing and retry pricing, and
 * neither is visible in the region uniform sampling reaches; the per-instance
 * facts are held by the PROBES instead, which is where they belong. The
 * `RetryFree` churn arm is the case in point: it is an arm only the retryfree
 * instance has, no floor names it, and what keeps it live is the free-climb
 * probe below, which reds when the arm stops firing.
 *
 * A FLOOR ENTRY CAN BE THIN, and one is: `work-passed` is reached by a single
 * one of the retryfree run's walks. That is fine while the roots are pinned —
 * the run is deterministic — but it means these floors are DERIVED FROM the
 * roots above rather than independent of them. Changing a root, the budget or
 * the enumeration obliges re-deriving them, by running the suite and reading
 * what the assertion reports missing.
 *
 * The deep half of the machine — the wrap-up phases, the rework economy's walls
 * — is not here at all, and the file header says why: this is the model's own
 * sampling profile, and what covers the deep half is the deterministic half of
 * both layers.
 */
const sampledDeciders: readonly string[] = [
  "decideArrive",
  "decideRelease",
  "decideRevoke",
  "decideDispatch",
  "decideTaskDone",
  "decideWorkReduce",
  "decideRevalFail",
  "decideOpRetry",
];

const sampledLabels: readonly StepLabel[] = [
  "init",
  "ticket-arrived",
  "ticket-released",
  "ticket-revoked",
  "dispatch",
  "task-done",
  "task-done-duplicate",
  "work-passed",
  "ticket-escalated work_failed",
  "ticket-escalated revalidation_failed",
  "operator-retry",
  "settled",
];

const sampledArms: readonly ExemptionArm[] = [
  "init",
  "task-done-duplicate",
  "settled",
  "operator-retry, RPending flavor",
  "ticket-arrived",
  "ticket-revoked, desk-only flat",
];

// === The anti-vacuity witnesses ============================================

test("cascadeParkNever is violated by sampling, on every instance", () => {
  // THE EXPECTED VIOLATION, and the probe fails when it stops happening: a
  // revoke that parks no dependent would make `cascadeSafety` vacuously true
  // wherever `revokeDoomed` stayed empty, and every green walk above would go
  // on passing. This one witness IS reachable by sampling, and comfortably so
  // on all three instances, though not equally: the rate runs from about a
  // twelfth of the retryfree walks — where a two-ticket fleet is the whole
  // supply of dependents — to about a quarter of the other two. Re-read
  // the rate by counting `firings` per walk rather than folding them; the probe
  // itself asks only that the shape occurred, which is the claim the witness
  // makes.
  for (const run of runs) {
    assert.ok(
      run.firings.has("cascadeParkNever"),
      `${run.instance}: no walk revoked a ticket with a dependent behind it — the cascade witness has gone vacuous`,
    );
  }
});

// === The two shapes sampling cannot reach ==================================
//
// Driven deterministically — the model's own fallback, and its own traces.
//
// `chuggy_witness_test.qnt` exists because the model needed exactly this: the
// no-arm-without-a-witness rule requires every `stepDescends` exemption arm to
// be fired by a deterministic run, and both shapes below sit behind chains of
// correctly-drawn steps that uniform sampling does not find at this budget. PLAN.md records
// the search that established it for the free climb — not reached across
// roughly 240000 model traces, at budgets to 200000 samples of 100 steps. The
// stage advance is the same story one order of magnitude in: the runs above
// reach it zero times, and so does a tenfold extension of them from the same
// roots — the first firing appears somewhere between 3000 and 6000 walks per
// instance, on every one of the three (raise `walkBudget.walks` and count the
// `stageAdvanceNever` firings to re-measure). So it IS reachable by sampling —
// just not at a budget this suite can afford, which makes a sampled probe for
// it one that goes quiet under a reseed rather than under a defect.
//
// Each script is the model's `run` with its `do*` drivers read as the `Cmd`s
// they are, at the same consts, step for step.

const progFlat1: readonly Stage[] = [
  { fanout: 1, combinator: "CUnanimousPass" },
];

const progStaged2: readonly Stage[] = [
  { fanout: 2, combinator: "CUnanimousPass" },
  { fanout: 1, combinator: "CUnanimousPass" },
];

/**
 * `chuggy_witness_free_test::freeClimbDeterministicTest`, at
 * `mc_chuggy_retryfree`: a ticket burns both accounts to zero, parks from a
 * PIPELINE phase, and the operator resumes it FREE — the measure climbing on
 * the resume step, which is the `RetryFree` CHURN arm of `stepDescends`
 * exempting exactly that climb.
 */
const freeClimbScript: readonly Cmd[] = [
  arrive(progFlat1),
  { tag: "JRelease", ticket: 1 },
  { tag: "JDispatch", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VPass" },
  // The same task's completion re-delivered with the other verdict:
  // first-write-wins discards it whole, and the STUTTER arm fires.
  { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VFail" },
  { tag: "JTaskDone", ticket: 1, tid: 2, verdict: "VPass" },
  { tag: "JWorkReduce", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 3, verdict: "VFail" },
  // The short-circuit buys the one budgeted rework: rework and gas both empty
  // from here on.
  { tag: "JEvalReduce", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 4, verdict: "VPass" },
  { tag: "JTaskDone", ticket: 1, tid: 5, verdict: "VPass" },
  { tag: "JWorkReduce", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 6, verdict: "VFail" },
  // The stage fails with the rework account empty: parked at gas 0, resume
  // point REvaluating — retryable only because RetryFree prices it at nothing.
  { tag: "JEvalReduce", ticket: 1 },
  // THE WITNESSED STEP.
  { tag: "JOpRetry", ticket: 1 },
];

/**
 * `chuggy_witness_stage_test::stageAdvanceDeterministicTest`, at
 * `mc_chuggy_budgeted`: a two-stage program's stage-0 unanimous pass advancing
 * to stage 1 — the interpreter's advance edge and the measure's stage digit —
 * then run through to Done and past it, so the staged program's whole lifecycle
 * closes.
 */
const stageAdvanceScript: readonly Cmd[] = [
  arrive(progStaged2),
  { tag: "JRelease", ticket: 1 },
  { tag: "JDispatch", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VPass" },
  { tag: "JTaskDone", ticket: 1, tid: 2, verdict: "VPass" },
  { tag: "JWorkReduce", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 3, verdict: "VPass" },
  { tag: "JTaskDone", ticket: 1, tid: 4, verdict: "VPass" },
  // THE WITNESSED STEP: stage 0 passes unanimously with a later stage left.
  { tag: "JEvalReduce", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 5, verdict: "VPass" },
  // The final stage passes: no advance this time, the program passed.
  { tag: "JEvalReduce", ticket: 1 },
  // The dequeue draws QUIET: the skip fast-path resolves the landing outright.
  { tag: "JDequeue", ticket: 1, moved: false },
  // At-least-once: a stale completion after Done, absorbed with no effect.
  { tag: "JCompleteDuplicate", ticket: 1 },
];

/**
 * The arrival every script opens with: project 1, that project's lease, and by
 * default no dependencies.
 *
 * `deps` is a parameter rather than a spread over the result, because `Cmd` is
 * a union and spreading one widens every arm's fields into the record — which
 * typechecks as nothing at all.
 */
function arrive(
  program: readonly Stage[],
  deps: ReadonlySet<number> = new Set(),
  wrapUp: WrapUp = { tag: "WExclusive", resource: 1 },
): Cmd {
  return { tag: "JArrive", deps, program, project: 1, wrapUp };
}

/**
 * THE WRAP-UP RESUME, at `mc_chuggy_retryfree`: a ticket that reaches the
 * wrap-up queue, fails the gate until gas runs out, parks on the
 * `gas_exhausted` wall with `resumeAt = RWrapUp`, and is resumed FREE — back
 * into the queue, re-enqueued.
 *
 * IT IS HERE BECAUSE THE CORPUS CANNOT HOLD IT, and that is a fact about the
 * two tiers rather than about the machine. Tier 1 is a uniform sampled search
 * and this is a long chain of correctly-drawn steps; tier 2 exports the
 * model's own witness runs, and none of them drives an operator retry off a
 * wrap-up wall. `coverage.ts` declares the arm beyond the corpus with that
 * argument and a refutation trigger; this is what exercises it meanwhile, at
 * the highest tier this tree can reach without a model PR — the shipped
 * deciders, step by step, with the whole domain bundle after every one.
 *
 * WHAT IT PROVES THAT NO ROSTER CAN. Deleting the `EnqueueWrapUp` effect from
 * `decideOpRetry`'s `RWrapUp` arm was measured to leave the entire tree green
 * but one hand-written assertion: every label, decider and exemption arm stays
 * covered, because an effect list is not a roster entry. The final record is
 * asserted below for exactly that reason.
 */
const wrapUpResumeScript: readonly Cmd[] = [
  arrive(progFlat1),
  { tag: "JRelease", ticket: 1 },
  { tag: "JDispatch", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VPass" },
  { tag: "JTaskDone", ticket: 1, tid: 2, verdict: "VPass" },
  { tag: "JWorkReduce", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 3, verdict: "VPass" },
  // The program passes: the ticket takes its lease and joins the queue.
  { tag: "JEvalReduce", ticket: 1 },
  // The environment moved under the candidate, so the gate opens.
  { tag: "JDequeue", ticket: 1, moved: true },
  // The eviction, priced under DeadlineOnly: gas alone, and there is gas left.
  { tag: "JGateResolve", ticket: 1, out: "WFailed" },
  { tag: "JTaskDone", ticket: 1, tid: 4, verdict: "VPass" },
  { tag: "JTaskDone", ticket: 1, tid: 5, verdict: "VPass" },
  { tag: "JWorkReduce", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 6, verdict: "VPass" },
  { tag: "JEvalReduce", ticket: 1 },
  { tag: "JDequeue", ticket: 1, moved: true },
  // The second eviction with gas at zero: the wall, stamping resumeAt RWrapUp.
  { tag: "JGateResolve", ticket: 1, out: "WFailed" },
  // THE ARM UNDER TEST.
  { tag: "JOpRetry", ticket: 1 },
];

/**
 * The pre-work resume at the same consts, and it is the DISCRIMINATING half of
 * the free-climb witness rather than a second example of it.
 *
 * `freeClimbNever` deliberately excludes the `RPending` flavor: that resume
 * climbs for free under BOTH meterings, so admitting it would let a charged
 * instance violate the witness without ever exercising the `RetryFree` arm the
 * witness exists to prove alive. The exclusion is a claim, and a claim with no
 * probe is `cascadeParkNever`'s transitions conjunct before its own pair was
 * written: this trace climbs, at RetryFree, on an `operator-retry` step, and
 * the witness must NOT fire.
 */
const preWorkResumeScript: readonly Cmd[] = [
  arrive(progFlat1),
  { tag: "JRelease", ticket: 1 },
  // The world changed under the ticket before it ever ran: the pre-work park.
  { tag: "JRevalFail", ticket: 1 },
  { tag: "JOpRetry", ticket: 1 },
];

const freeClimb = driveTrace(
  configs.retryfree,
  "retryfree",
  "free-climb (deterministic)",
  freeClimbScript,
);

const wrapUpResume = driveTrace(
  configs.retryfree,
  "retryfree",
  "wrap-up resume (deterministic)",
  wrapUpResumeScript,
);

const preWorkResume = driveTrace(
  configs.retryfree,
  "retryfree",
  "pre-work resume (deterministic)",
  preWorkResumeScript,
);

const stageAdvance = driveTrace(
  configs.budgeted,
  "budgeted",
  "stage-advance (deterministic)",
  stageAdvanceScript,
);

test("freeClimbNever is violated on the free-climb trace, and no other witness is", () => {
  assert.deepEqual(freeClimb.findings, []);
  assert.equal(freeClimb.steps, freeClimbScript.length);
  // THE WITNESS FIRES, on the step the model's own run witnesses it on: the
  // free pipeline resume, climbing. The other two do not fire here, which is
  // the exact set this asserts — a trace that also parked a dependent or
  // advanced a stage would be proving three things at once and none of them
  // separately.
  assert.deepEqual(
    freeClimb.firings.map((f) => [f.witness, f.step, f.label]),
    [["freeClimbNever", freeClimbScript.length, "operator-retry"]],
  );
  // AND THE BUNDLE HOLDS ON THE CLIMBING STEP — checked by the run itself,
  // which asserts it after every step. That pairing is the whole content of
  // the witness: the climb is real AND `stepDescends` exempts it, which is
  // what tells a dead arm from a live one.
  assert.ok(
    freeClimb.coverage.arms.has("operator-retry, RetryFree pipeline flavor"),
    "the RetryFree pipeline exemption arm did not fire on the free climb",
  );
});

test("the RWrapUp resume re-enqueues the wrap-up, and the free climb fires on its own disjunct", () => {
  assert.deepEqual(wrapUpResume.findings, []);
  assert.equal(wrapUpResume.steps, wrapUpResumeScript.length);

  // THE RECORD THE ARM PRODUCED, which is the model's own text for it: back to
  // PWrapUp from the desk, re-enqueuing. `EnqueueWrapUp` is the whole of what
  // distinguishes this arm from the RPending one, and no roster in this tree
  // can ask for it.
  assert.deepEqual(wrapUpResume.final.lastStep, {
    label: "operator-retry",
    transitions: [{ ticket: 1, from: "PEscalated", to: "PWrapUp" }],
    effects: ["EnqueueWrapUp"],
    attempt: { tag: "WONone" },
  });
  // The resume point is spent: `resumeAt` is RNone again and the desk reason
  // with it, which is what makes the arm a resume rather than a second park.
  const resumed = wrapUpResume.final.core.tickets.get(1);
  assert.ok(resumed !== undefined, "the fleet still holds the resumed ticket");
  assert.equal(resumed.resumeAt, "RNone");
  assert.equal(resumed.reason, "RsNone");
  // AND IT COST NOTHING, which is the RetryFree pricing: the wall it resumes
  // from is the gas wall, so a charged resume could not have been taken at all.
  assert.equal(resumed.gasLeft, 0);

  // THE WITNESS FIRES ON THE `PWrapUp` DISJUNCT — the half of `freeClimbNever`
  // that was dead: the model writes the free churn set as the Evaluating AND
  // WrapUp resumes, and until this trace existed only the first was ever
  // exercised, in this file and in the corpus alike.
  assert.deepEqual(
    wrapUpResume.firings.map((f) => [f.witness, f.step, f.label]),
    [["freeClimbNever", wrapUpResumeScript.length, "operator-retry"]],
  );
  // And the exemption that lets the climb be legal is the RetryFree pipeline
  // arm, in its wrap-up flavor: the pairing IS the witness's content, exactly
  // as on the free-climb trace above.
  assert.ok(
    wrapUpResume.coverage.arms.has("operator-retry, RetryFree pipeline flavor"),
    "the RetryFree pipeline exemption arm did not fire on the wrap-up resume",
  );
  // The resume roster records which arm of `decideOpRetry` was taken, which is
  // the obligation `coverage.ts` declares beyond the corpus.
  assert.ok(wrapUpResume.coverage.resumes.has("RWrapUp"));
});

test("freeClimbNever discriminates: the pre-work resume climbs at RetryFree and does not fire it", () => {
  // WHAT THE FREE-CLIMB TRACE ALONE CANNOT SAY, and `cascadeParkNever` has had
  // the same pair since it was written. `freeClimbNever` excludes the RPending
  // flavor deliberately — that resume is free under BOTH meterings, so a
  // witness admitting it would fire on a charged instance and prove nothing
  // about the RetryFree arm. Drop the phase conjunct and this trace starts
  // firing it; the exclusion is what this short script holds in place.
  assert.deepEqual(preWorkResume.findings, []);
  assert.equal(preWorkResume.steps, preWorkResumeScript.length);
  assert.deepEqual(preWorkResume.final.lastStep, {
    label: "operator-retry",
    transitions: [{ ticket: 1, from: "PEscalated", to: "PPending" }],
    effects: [],
    attempt: { tag: "WONone" },
  });
  // THE CLIMB IS REAL, which is what makes the non-firing a discrimination
  // rather than a trace that never got near the witness: the measure is higher
  // after the resume than the step before it, at RetryFree, on an
  // `operator-retry` step — every conjunct of the witness but the phase one.
  assert.ok(
    currentMeasure(configs.retryfree, preWorkResume.final.core) >
      preWorkResume.final.prevMeasure,
    "the pre-work resume did not climb, so the exclusion is undriven",
  );
  assert.deepEqual(preWorkResume.firings, []);
  // And the arm it fired is the RPending one, told apart from the free flavor
  // by the pricing probe rather than by the label they share.
  assert.ok(
    preWorkResume.coverage.arms.has("operator-retry, RPending flavor"),
    "the RPending exemption arm did not fire on the pre-work resume",
  );
  assert.ok(preWorkResume.coverage.resumes.has("RPending"));
});

test("stageAdvanceNever is violated on the stage-advance trace, and no other witness is", () => {
  assert.deepEqual(stageAdvance.findings, []);
  assert.equal(stageAdvance.steps, stageAdvanceScript.length);
  // The advance is mid-trace rather than last: the run goes on past it, and
  // the step after is where `stageAdvanceNever` HOLDS again — the final stage
  // passing is not an advance. Both readings are in this one exact set.
  assert.deepEqual(
    stageAdvance.firings.map((f) => [f.witness, f.step, f.label]),
    [["stageAdvanceNever", 9, "eval-stage-passed"]],
  );
  // The trace closes the lifecycle the sampled walks never reach, and the
  // roster is the evidence: the two labels past evaluation, the landing that
  // resolves without opening a gate, and the absorbed duplicate.
  const closingLabels: readonly StepLabel[] = [
    "eval-passed",
    "ticket-done",
    "complete-duplicate",
  ];
  assert.deepEqual(
    closingLabels.filter((l) => !stageAdvance.coverage.labels.has(l)),
    [],
  );
  // AND THE EIGHTH EXEMPTION ARM, which no sampled walk in this file fires.
  // The reason is the SUBSEQUENT DRAW rather than the landing: the arm needs a
  // landed ticket AND the re-delivery drawn on it before the run ends, and
  // while the budgeted root's walks do land one, none of them goes on to draw
  // the duplicate — `walk.test.ts`'s `settle` note argues the same shape for
  // the same arm. With this the two deterministic traces and the sampled walks
  // together fire all eight arms of `stepDescends` — the roster PLAN.md's
  // coverage obligation names.
  assert.ok(
    stageAdvance.coverage.arms.has("complete-duplicate"),
    "the complete-duplicate exemption arm did not fire on the absorbed duplicate",
  );
});

// === The alarm path ========================================================

test("a run refuses an illegal command and names it", () => {
  // THE FINDING PATH, exercised: every probe above asserts that a run found
  // NOTHING, so nothing above would notice a run that could not report at all.
  // A command no state enables is the cheapest way to make one talk — here,
  // releasing a ticket the empty fleet does not hold.
  const refused = driveTrace(configs.budgeted, "budgeted", "illegal", [
    { tag: "JRelease", ticket: 1 },
  ]);
  assert.deepEqual(refused.findings, [
    "illegal: step 1: JRelease ticket=1 is scripted here and cmdEnabled does not admit it",
    "illegal: the run took 0 of the 1 scripted steps",
  ]);
});

test("a seed prints as the model's own --seed spelling", () => {
  assert.equal(hex(walkRoots.budgeted), "0x2a");
  assert.equal(hex(-1), "0xffffffff");
});

// === The enumeration's own properties ======================================
//
// THE PROPERTIES THE WALKER'S HEADERS CALL LOAD-BEARING, each with the case
// that makes the word true. Every one of them was measured to survive its own
// mutation: the walker would have gone on reporting the same rosters, the same
// witnesses and the same reproductions over a narrower exploration, which is
// the `offered` alarm's failure one level down — a control nobody has checked.
// A walk cannot report any of them, because a walk only ever takes what the
// enumeration hands it.

/** The state a command list leaves the machine in, each step required to be taken. */
function driveTo(cfg: Config, script: readonly Cmd[]): MachineState {
  let state = initialState(cfg);
  for (const [k, cmd] of script.entries()) {
    const stepped = stepWith(cfg, state, cmd);
    assert.ok(stepped !== undefined, `step ${String(k + 1)}: ${cmd.tag}`);
    state = stepped;
  }
  return state;
}

test("the enumeration offers the never-issued task id, and cmdEnabled refuses it", () => {
  // `taskIds` runs to `spawned + 1`, and that extra id is the whole of what
  // makes the walker's `cmdEnabled` exercise a REFUSAL rather than a series of
  // admissions. Drop it and the walker asks only about ids the ticket really
  // issued — a smaller question, asked at the same scale, with nothing to say
  // so.
  const dispatched = driveTo(configs.budgeted, [
    arrive(progFlat1),
    { tag: "JRelease", ticket: 1 },
    { tag: "JDispatch", ticket: 1 },
  ]);
  const jb = dispatched.core.tickets.get(1);
  assert.ok(jb !== undefined);
  assert.ok(jb.spawned > 0, "the ticket has issued task ids");
  const ids = taskIds(dispatched.core, 1);
  assert.ok(ids.includes(jb.spawned + 1), "the never-issued id is enumerated");
  // AND IT IS REFUSED, which is the promise the enumeration is exercising.
  assert.equal(
    cmdEnabled(configs.budgeted, dispatched.core, {
      tag: "JTaskDone",
      ticket: 1,
      tid: jb.spawned + 1,
      verdict: "VPass",
    }),
    false,
  );
});

test("subsetsOf is the powerset, not a sample of it", () => {
  // The model draws an arrival's deps from `powerset(dependableIn(c))`, so a
  // narrower enumeration explores a narrower arrival space — and nothing else
  // in this file would notice, because every roster it asserts is reached by
  // arrivals with no deps at all.
  const subsets = subsetsOf(new Set([1, 2])).map((set) =>
    [...set].sort((a, b) => a - b),
  );
  assert.deepEqual(subsets.map((ids) => ids.join(",")).sort(), [
    "",
    "1",
    "1,2",
    "2",
  ]);
});

/**
 * A fleet driven all the way to a dead end: one ticket landed, the other
 * revoked, the id space full — so nothing but a self-loop is enabled and
 * `quiet` is true. The last two commands are the same absorbed duplicate: the
 * run takes one and declines the other.
 */
const quietFleetScript: readonly Cmd[] = [
  arrive(progFlat1, new Set(), { tag: "WNone" }),
  { tag: "JRelease", ticket: 1 },
  { tag: "JDispatch", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VPass" },
  { tag: "JTaskDone", ticket: 1, tid: 2, verdict: "VPass" },
  { tag: "JWorkReduce", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 3, verdict: "VPass" },
  // A `WNone` ticket lands straight off the passing evaluation: no lease, no
  // queue, no gate.
  { tag: "JEvalReduce", ticket: 1 },
  arrive(progFlat1, new Set(), { tag: "WNone" }),
  { tag: "JRevoke", ticket: 2 },
  { tag: "JCompleteDuplicate", ticket: 1 },
  { tag: "JCompleteDuplicate", ticket: 1 },
];

test("a script that runs past a quiet fleet is cut one step after it", () => {
  // `ended = quiet(...)` is read BEFORE the step, so a run takes exactly one
  // step out of a dead end and stops: every action a quiet fleet enables is a
  // self-loop, and the one step is kept because the `settled` and
  // `complete-duplicate` exemption arms are reachable nowhere else. The
  // stage-advance script ends on the first of those steps and fits exactly;
  // one duplicate MORE is the step the run declines to take.
  const run = driveTrace(
    configs.retryfree,
    "retryfree",
    "past quiet",
    quietFleetScript,
  );
  const upToTheDeadEnd = quietFleetScript.length - 1;
  assert.equal(run.steps, upToTheDeadEnd);
  assert.deepEqual(run.findings, [
    `past quiet: the run took ${String(upToTheDeadEnd)} of the ${String(quietFleetScript.length)} scripted steps`,
  ]);
  // The step it DID take is the representative one, and the exemption arm it
  // fires is reachable nowhere else — which is why the dead end costs a step
  // rather than none.
  assert.ok(run.coverage.arms.has("complete-duplicate"));
});

test("showCmd is canonical in both orderings, so two equal decisions print alike", () => {
  // `offered` compares commands by this string, so an ordering that leaked
  // through would make the enumeration's own command and a script's hand-built
  // twin read as different decisions — the alarm firing on a gap that is not
  // there, which is how an alarm gets muted.
  //
  // THE SET, built in two insertion orders.
  assert.equal(
    showCmd(arrive(progFlat1, new Set([2, 1]))),
    showCmd(arrive(progFlat1, new Set([1, 2]))),
  );
  // THE RECORD'S KEYS, declared in two orders. `Object.entries` follows
  // declaration order, so this is the sort and nothing else.
  const byOneOrder: Cmd = {
    tag: "JTaskDone",
    ticket: 1,
    tid: 2,
    verdict: "VPass",
  };
  const byAnother: Cmd = {
    tag: "JTaskDone",
    verdict: "VPass",
    tid: 2,
    ticket: 1,
  };
  assert.equal(showCmd(byOneOrder), showCmd(byAnother));
  // ...and the canonical form still tells two DIFFERENT decisions apart, which
  // is the other half of what `offered` needs from it.
  assert.notEqual(
    showCmd(byOneOrder),
    showCmd({ tag: "JTaskDone", ticket: 1, tid: 2, verdict: "VFail" }),
  );
});

test("walkSeeds splits rather than stepping, so no two walks are one sliding window", () => {
  // THE SUBSTITUTION THE DOC ARGUES AGAINST, driven. Seeding walk `k` with the
  // `k`-th STATE of the root generator would make walk `k + 1`'s draws walk
  // `k`'s offset by one — a run of walks reporting the coverage of many and
  // exploring roughly one, with every probe in this file green over it.
  const seeds = walkSeeds(walkRoots.budgeted, 2);
  const [first, second] = seeds;
  assert.ok(first !== undefined && second !== undefined);
  const streamFrom = (seed: number, n: number): readonly number[] => {
    let gen = seed;
    const values: number[] = [];
    for (let k = 0; k < n; k += 1) {
      const drawn = draw(gen);
      gen = drawn.gen;
      values.push(drawn.value);
    }
    return values;
  };
  assert.notDeepEqual(streamFrom(second, 4), streamFrom(first, 5).slice(1));
  // The control: the two streams are not equal either, so the assertion above
  // is about the OFFSET rather than about the seeds merely differing.
  assert.notDeepEqual(streamFrom(second, 4), streamFrom(first, 4));
});

// === The model's anti-vacuity witnesses ====================================

/**
 * A model fragment holding the witnesses named, in the model's own shape: a
 * marker comment, the header prose it opens, and the `val` under it.
 *
 * IT IS A FIXTURE FILE AND NOT AN EDIT OF `model/`, which is the rule this
 * whole tree runs on — the spec is read, never written. `corpus.test.ts` builds
 * the same kind of fragment for `readModuleConsts`' module bound, and for the
 * same reason: the reader's refusals need shapes the real model does not have.
 */
function witnessFixture(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "chuggy-witness-")), "w.qnt");
  writeFileSync(path, body, "utf8");
  return path;
}

function witnessVal(name: string): string {
  return [
    `  /// ANTI-VACUITY WITNESS, not an invariant of the machine: the model`,
    `  /// states each of these as a numbered series under this marker.`,
    `  val ${name}: bool =`,
    `    not(lastStep.label == "x")`,
    "",
  ].join("\n");
}

/** The disagreement between the model's witnesses and this tree's, both ways. */
function witnessesDisagree(path?: string): readonly string[] {
  return rosterDisagrees(
    "anti-vacuity witness",
    witnessNames,
    readAntiVacuityWitnesses(path),
  );
}

test("the anti-vacuity witnesses are the model's own, in both directions", () => {
  // THE ROSTER NO OTHER ALARM COULD SEE. A witness is not a decider, not a code
  // literal, not a conjunct of any bundle and not an arm of any sum type — it
  // is a plain `val` the model expects to be VIOLATED — so every reader in
  // `corpus.ts` passed over all three, and `witnessNames` beside them was a
  // hand-typed copy nothing held to the model. A fourth witness added upstream
  // arrives with no fixture and no obligation, so nothing anywhere reds: the
  // roster alarm's own failure mode, on the surface that says which green
  // invariants are vacuous.
  assert.deepEqual(witnessesDisagree(), []);
  // ...and the read is a real read of the real model rather than a constant
  // this file could satisfy by agreeing with itself.
  assert.deepEqual([...readAntiVacuityWitnesses()], [...witnessNames]);
});

const witnessRosterCases: readonly {
  readonly case: string;
  readonly body: string;
  readonly findings: readonly string[];
}[] = [
  {
    // The mutation a model PR actually makes, and it reds both halves of one
    // exact-set comparison from one edit.
    case: "a witness the model renamed",
    body: [
      witnessVal("freeClimbNever"),
      witnessVal("cascadeParksNever"),
      witnessVal("stageAdvanceNever"),
    ].join("\n"),
    findings: [
      "model: anti-vacuity witness cascadeParksNever — the model has it and this tree's roster does not",
      "model: anti-vacuity witness cascadeParkNever — this tree's roster has it and the model does not",
    ],
  },
  {
    // THE LIVE DIRECTION, in the packet's own words: a FOURTH witness, added
    // under the model's no-arm-without-a-witness rule, that this tree neither
    // mirrors nor probes.
    case: "a witness the model gained",
    body: [
      witnessVal("freeClimbNever"),
      witnessVal("cascadeParkNever"),
      witnessVal("stageAdvanceNever"),
      witnessVal("leaseTakenNever"),
    ].join("\n"),
    findings: [
      "model: anti-vacuity witness leaseTakenNever — the model has it and this tree's roster does not",
    ],
  },
  {
    case: "a witness the model dropped",
    body: [witnessVal("freeClimbNever"), witnessVal("stageAdvanceNever")].join(
      "\n",
    ),
    findings: [
      "model: anti-vacuity witness cascadeParkNever — this tree's roster has it and the model does not",
    ],
  },
];

for (const witness of witnessRosterCases) {
  test(`the anti-vacuity witness roster reds on ${witness.case}`, () => {
    assert.deepEqual(
      witnessesDisagree(witnessFixture(witness.body)),
      witness.findings,
    );
  });
}

test("a witness roster the parse cannot see is could-not-run, never an empty roster", () => {
  // `readModuleConsts`' rule, on the reader this roster needed. An empty answer
  // would red all three at once and blame the tree for a defect in the reader;
  // a marker that has drifted away from its `val` would roster whatever came
  // next.
  assert.throws(
    () =>
      witnessesDisagree(witnessFixture("  val freeClimbNever: bool = true\n")),
    (error: unknown) =>
      error instanceof CorpusError &&
      /no ANTI-VACUITY WITNESS comment$/.test(error.message),
  );
  assert.throws(
    () =>
      witnessesDisagree(
        witnessFixture(
          "  /// ANTI-VACUITY WITNESS, and then nothing of the kind:\n  pure def notAVal(c: Core): bool = true\n",
        ),
      ),
    (error: unknown) =>
      error instanceof CorpusError &&
      /is followed by no bool val$/.test(error.message),
  );
});

// === The walker's own alarms ===============================================
//
// EVERY PROBE ABOVE ASSERTS THAT A RUN FOUND NOTHING, so nothing above would
// notice a run that could not report. `a run refuses an illegal command` covers
// the refusal path. What remains is the guarded regions of `observe` — the
// unrostered label, the arm attribution, the bundle — and, outside it,
// `driveTrace`'s enumeration-completeness alarm.
//
// NONE OF THEM CAN FIRE FROM A CORRECT TREE, which is why each needs a case
// built rather than a walk run. Every state a run reaches is a shipped
// decider's own output, so a correct roster, a correct measure and a correct
// bundle are true over all of them; and every command a script names is one a
// correct enumeration offered. That is the replayer's situation one layer up,
// and it has the same two answers: hand the OBSERVER a state no decider would
// produce, and hand a RUN an enumeration that is deliberately short. One case
// per region, because muting any of them leaves a walk green.

test("the walker's unrostered-label alarm fires, and names the label it could not place", () => {
  // A LABEL THE MACHINE COULD ONLY EMIT BY GROWING ONE. `stepLabel` throws on
  // it because the decoder is reading a trace it cannot place; here the label
  // came out of this tree's own step, so the throw is a finding to report and
  // not an exception to let past the run. Muted, a decider that started
  // emitting a label the corpus's roster does not know would walk green.
  const teleported: MachineState = {
    ...initialState(configs.budgeted),
    lastStep: { ...initStepRecord, label: "ticket-teleported" },
  };
  assert.deepEqual(observeOnce(configs.budgeted, teleported), [
    'probe step 0 after init: "ticket-teleported" is outside the reachable step-label roster',
  ]);
});

test("the walker's arm-attribution alarm fires, and carries the assertion that stopped it", () => {
  // THE REGION BETWEEN THE OTHER TWO, and the one with the most reachable
  // assertions behind it: attributing the exemption arm asks `stepDescends`
  // twice through `sysMeasure`, so every account precondition in `measure.ts`
  // is one call from this line. A walker exists to reach states nobody wrote a
  // precondition for, so an assertion firing here is the run's most valuable
  // result — and muted, it is the result that takes the whole file down with it
  // carrying no seed, no step and no command.
  const spent: MachineState = {
    ...initialState(configs.budgeted),
    core: solo({ ...jDone, gasLeft: -1 }),
  };
  assert.deepEqual(observeOnce(configs.budgeted, spent), [
    "probe step 0 after init: the exemption arm could not be read: ticketMeasure: gasLeft is a non-negative safe integer, got -1",
  ]);
});

test("the walker's bundle alarm fires, and names the conjuncts that went red", () => {
  // THE OTHER HALF OF WHAT A WALK IS FOR. The bundle after every step is the
  // whole point of the randomized layer, and a run that stopped asking it would
  // still report its rosters, its witnesses and its reproductions — all green.
  // The finding carries the conjunct names because a randomized failure whose
  // text is "expected true" has found a defect and thrown away the copy.
  const doubled: MachineState = {
    ...initialState(configs.budgeted),
    core: solo({ ...jDone, completions: 2 }),
  };
  assert.deepEqual(observeOnce(configs.budgeted, doubled), [
    "probe step 0 after init: allInvariants is false; red conjuncts: completionExclusive",
  ]);
});

test("the walker's enumeration-completeness alarm fires, and names the command that was withheld", () => {
  // THE REGION OUTSIDE `observe`, and the one with the widest blast radius:
  // `offered` is
  // the sole guardian of the sampled walks' PAYLOAD SPACE. Every other probe in
  // this file asks what a walk REACHED, and a walk only ever takes what the
  // enumeration hands it — so an enumeration that quietly stopped offering the
  // dequeue's quiet arm, or a lease-taking arrival, would explore less than it
  // claims with every roster still complete and every witness still firing.
  //
  // A correct enumeration never fires it, which is why the enumeration is a
  // parameter of `driveTrace`: the alarm is driven by handing one run a short
  // enumeration, exactly as the three regions above are driven by handing the
  // observer a state no decider would produce.
  const withoutQuietDequeue = (cfg: Config, c: Core): readonly Available[] =>
    availableActions(cfg, c).flatMap((option) => {
      if (option.kind !== "cmd" || option.tag !== "JDequeue") {
        return [option];
      }
      const picks = option.picks.filter(
        (pick) => pick.tag === "JDequeue" && pick.moved,
      );
      return picks.length === 0 ? [] : [{ ...option, picks }];
    });
  const withheld = driveTrace(
    configs.budgeted,
    "budgeted",
    "withheld dequeue",
    stageAdvanceScript,
    withoutQuietDequeue,
  );
  assert.deepEqual(withheld.findings, [
    "withheld dequeue: step 12: JDequeue moved=false ticket=1 is enabled here and the enumeration did not offer it",
    "withheld dequeue: the run took 12 of the 13 scripted steps",
  ]);
  // The control: the SAME script under the real enumeration says nothing, so
  // the finding is attributable to the withheld row and not to the script.
  assert.deepEqual(stageAdvance.findings, []);
});

test("the walker's observer is silent on a state the machine really reaches", () => {
  // The control for the two above: the same observer, over `init` at the same
  // consts, says nothing — so the findings above are attributable to the
  // states and not to the probe.
  assert.deepEqual(
    observeOnce(configs.budgeted, initialState(configs.budgeted)),
    [],
  );
});

// === The cascade witness's discriminating power ============================

const loneRevoke: readonly Cmd[] = [
  arrive(progFlat1),
  { tag: "JRevoke", ticket: 1 },
];

const cascadingRevoke: readonly Cmd[] = [
  arrive(progFlat1),
  arrive(progFlat1, new Set([1])),
  { tag: "JRevoke", ticket: 1 },
];

test("cascadeParkNever discriminates: a lone revoke does not fire it, a cascading one does", () => {
  // WHAT THE SAMPLED PROBE ABOVE CANNOT SAY. It asks only that the witness
  // FIRED somewhere in three hundred walks, and every revoke in the machine
  // carries a `ticket-revoked` label — so dropping the transitions conjunct,
  // which is the whole of what makes this a CASCADE witness, leaves that probe
  // green and turns the witness into "a revoke happened". These two traces are
  // the pair that tells them apart: same decider, same label, one dependent
  // between them.
  const lone = driveTrace(
    configs.budgeted,
    "budgeted",
    "lone revoke (deterministic)",
    loneRevoke,
  );
  assert.deepEqual(lone.findings, []);
  assert.equal(lone.steps, loneRevoke.length);
  // The exact set, and it is EMPTY: a revoke that parked nobody is not the
  // shape `cascadeSafety` needs a witness for.
  assert.deepEqual(lone.firings, []);

  const cascade = driveTrace(
    configs.budgeted,
    "budgeted",
    "cascading revoke (deterministic)",
    cascadingRevoke,
  );
  assert.deepEqual(cascade.findings, []);
  assert.deepEqual(
    cascade.firings.map((f) => [f.witness, f.step, f.label]),
    [["cascadeParkNever", cascadingRevoke.length, "ticket-revoked"]],
  );
});
