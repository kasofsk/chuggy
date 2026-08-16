/**
 * `model/domain.qnt`'s decision layer, pinned against
 * `model/tests/chuggy_test.qnt` at the consts of that suite's own instances.
 *
 * WHAT IS BEING MIRRORED, AND HOW. All 57 of the model's runs, CONJUNCT FOR
 * CONJUNCT, under the model's own run names, against fixtures built the way the
 * model builds them — by chaining the deciders where it chains them, and by
 * hand where it hands them (`chuggy_test` writes `cWorkFail`, `cChain`,
 * `cGateOcc` and the revoke fixtures as Core literals, and so does this file).
 * Three of the 57 are `measure.ts`'s and are mirrored in its suite
 * (`combinatorBranchesTest`, `measureArtifactBlindTest`,
 * `measureProjectBlindTest`); the other 54 are here — the 57th being
 * `handBuiltFixturesAccountedTest`, which the model gained with the fixture
 * accounting (#27) and which this suite mirrors over its own fixtures.
 *
 * The suite was written in two slices. s2a mirrored the runs whose subject is
 * an authoring-or-work decider and deferred the rest rather than paraphrasing
 * them against hand-built stand-ins for deciders that had not landed — the
 * divergent reimplementation issue #13 exists to retire. s2b closed the split
 * IN PLACE: a run that was split conjunct-wise is now one test carrying all of
 * its conjuncts, not two tests carrying halves.
 *
 * ONE PLACE THIS SUITE ANSWERS MORE STRICTLY THAN THE MODEL, noted at the test
 * that carries it (`staleStageCompletionNoopsTest`): the model's
 * `decideTaskDone` is total and absorbs a completion delivered to a ticket that
 * has left its task phase; here the phase guarantee the `taskDone` action
 * states is asserted, so the same call is refused. No machine step and no
 * golden trace can deliver one, because the action draws from `taskPhaseTickets`.
 *
 * EVERY FIXTURE ACCOUNTS FOR THE IDS IT HANDS ITSELF (ledger #17, resolved
 * Path A, landed in the model as #27). A literal task set or record never
 * passes through
 * `spawnOn`, the one site that bumps the ghost counter, so a hand-built fixture
 * states its own `spawned` — `record.length + tasks.length` — and every fixture
 * here does, the TypeScript-invented fleets included. It is not cosmetic:
 * `decideWorkReduce` stamps `ASome(retired.spawned)`, so the corrections MOVED
 * three artifact marks on both sides together (`dToEval`
 * `ASome(0)`→`ASome(2)`, `dBackToEval` `ASome(3)`→`ASome(5)`,
 * `decideWorkReduce(cFlatWork)` `ASome(0)`→`ASome(2)`). The model's fixtures
 * carry the correction as of #27, so every value here is read from the model in
 * this tree; `handBuiltFixturesAccountedTest` below keeps the next fixture
 * honest, and s2c inherits fixtures its `idsAccounted` accepts.
 *
 * THE RULE THIS SUITE LEAVES BEHIND, learned twice at review: AN EQUALITY
 * GUARD IS PINNED BY AN EXACT SET OVER ITS WHOLE DOMAIN, NEVER BY
 * COUNTER-EXAMPLES. A guard written as an equality on a phase agrees with a
 * widened inequality on every fixture that does not happen to hold the phase
 * the widening admits — and there are nine phases, so a counter-example
 * closes one of eight doors. Round 1 answered seven such findings with a
 * counter-example each and left five widenings alive; round 2 answered them
 * with `cAllPhases` and `cBehindADraft` below — one ticket per phase, and the
 * SET the guard answers with — which closes all of them at once and stays
 * closed when a tenth phase arrives.
 *
 * AND ITS TRANSPOSITION, learned the round after: AN EQUALITY GUARD OVER A
 * RELATION IS PINNED BY EXACT SETS OVER BOTH ENDS' DOMAINS. `depsDoneIn`
 * reads the DEPENDENCY's phase, so a fleet that varies the dependent's phase
 * pins nothing about it — `cAllPhases` has no dependencies and
 * `cBehindADraft` gives every ticket the same one, and between them four
 * dependency-phase widenings survived. `cAheadOfEach` is that fixture
 * transposed, and the same rule is why the fan-in cascade and the mixed
 * dependency set are here: a `forall` over a relation needs members that
 * disagree, not one more uniform set.
 *
 * s2b's three guards are relations too, and each arrives with both ends pinned
 * from the start: `leaseFreeIn` over resources AND phases (`cGateElsewhere`,
 * plus the per-phase sweep), `wrapUpStartableIn` over the queue phase AND the
 * lease it asks about (the same fixture pair), `retryableIn` over the phase,
 * the resume point AND the gas balance (`cAllResumable` and `resumeFleet`).
 *
 * THE EXPECTED VALUES ARE THE MODEL'S OWN. Structural expectations (labels,
 * transitions, effects, records, phases, accounts) are copied from the run
 * that pins them. Enablement-set values the model computes but does not pin in
 * a run were read out of `chuggy_domain` in the quint 0.32.0 REPL against the
 * same fixtures, never computed by this implementation. Measure claims are
 * mirrored as the model states them — descends, climbs, or exactly flat —
 * through `measure.ts`, which pins its own integers.
 *
 * WHAT IS DELIBERATELY ABSENT: the 24 domain invariants (s2c) — 24 rather than
 * 23 since `wrapUpWellFormed` joined `allInvariants` — and the model's
 * state-and-actions section — `init`, the thirteen actions and the ghosts are
 * the machine's, and the spine (s3) is where they land.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "./assert.ts";
import {
  cfgBudgeted,
  cfgDeadlineOnly,
  core,
  draft,
  er,
  escalated,
  et,
  jDone,
  jDraft,
  jEsc,
  jEval,
  jGated,
  jLand,
  jParkDep,
  jParkPre,
  jPend,
  jWork,
  mixedE0,
  progStaged,
  progU2,
  revokeOne,
  solo,
  wr,
  wt,
  wx1,
  wx2,
} from "./fixtures.test.ts";
import {
  boundsOf,
  canArriveIn,
  completeTicket,
  configAdmitsInit,
  decideArrive,
  decideCompleteDuplicate,
  decideDequeue,
  decideDispatch,
  decideEvalStageReduce,
  decideOpRetry,
  decideRelease,
  decideRevalFail,
  decideRevoke,
  decideTaskDone,
  decideWorkReduce,
  decideWrapUpResolve,
  decideWrapUpStart,
  defaultProgram,
  depArtifacts,
  dependableIn,
  depsDoneIn,
  dispatchableIn,
  deliverableTaskIds,
  doneIn,
  draftsIn,
  escalate,
  firstProjectId,
  freshTicket,
  holdingIn,
  isBlockedIn,
  isReadyIn,
  isValidProgram,
  leaseFreeIn,
  leaseOf,
  noResource,
  noop,
  reducibleEvalIn,
  reducibleWorkIn,
  readiesIn,
  projects,
  resumeCharge,
  retryableIn,
  retryablesIn,
  revocableIn,
  revocablesIn,
  stageChoices,
  taskPhaseIn,
  ticketAt,
  validPrograms,
  waitsOn,
  withTicket,
  wrapUpChoices,
  withWrapUpObs,
  wrapUpOutcomes,
  wrapUpStartableIn,
  wrapUpStartablesIn,
  type Config,
} from "./domain.ts";
import {
  hasOpenHumanTask,
  spawnTasks,
  sysMeasure,
  ticketMeasure,
  type ArtifactMark,
  type Bounds,
  type Core,
  type Stage,
  type Task,
  type Ticket,
} from "./measure.ts";

// === The suite's instances =================================================
// The reference instance (`chuggy_test`'s DB) and the DeadlineOnly one (its
// DD) live in `fixtures.test.ts`, which both suites read; the three below are
// this suite's alone.

/** `chuggy_test`'s DF — the FREE retry metering, which only the desk reads. */
const cfgDF: Config = {
  ...cfgBudgeted,
  nTickets: 1,
  opRetryPricing: "RetryFree",
};

/** `chuggy_test`'s DO — the single-project degeneration. */
const cfgDO: Config = { ...cfgBudgeted, nTickets: 1, nProjects: 1 };

/** `chuggy_test`'s DZ — the GASLESS graph, which has no initial state at all. */
const cfgDZ: Config = { ...cfgBudgeted, nTickets: 1, gas: 0 };

/** `chuggy_test`'s bB, which is exactly DB's bounds. */
const bB: Bounds = {
  reworkPolicy: { tag: "RWBudget", budget: 1 },
  nTasks: 2,
  maxStages: 2,
  wrapUpPricing: { tag: "Budgeted", budget: 1 },
};

/** `chuggy_test`'s bD, which is exactly DD's bounds. */
const bD: Bounds = { ...bB, wrapUpPricing: { tag: "DeadlineOnly" } };

/** `chuggy_test`'s mB. */
function mB(c: Core): number {
  return sysMeasure(bB, c.tickets);
}

/** `chuggy_test`'s mD — the DeadlineOnly fixtures are measured at their own bounds. */
function mD(c: Core): number {
  return sysMeasure(bD, c.tickets);
}

// === Fixture vocabulary ====================================================
// The builders and programs `chuggy_test` shares with the measure suite live
// in `fixtures.test.ts`; what is local below is what only this suite reads.

// === The happy path, decision by decision ==================================
// `chuggy_test`'s own chain, verbatim and whole: two arrivals, a release, the
// dispatch, both work completions, the work reduce, both eval completions, the
// eval reduce, and the landing — which the model's path takes QUIET, off the
// queue, because the solo ticket's branch never moved.

const cEmpty: Core = { tickets: new Map() };
const dArr1 = decideArrive(
  cfgBudgeted,
  cEmpty,
  new Set(),
  defaultProgram(cfgBudgeted),
  1,
  wx1,
);
const cA1 = dArr1.post;
const dArr2 = decideArrive(
  cfgBudgeted,
  cA1,
  new Set([1]),
  defaultProgram(cfgBudgeted),
  1,
  wx1,
);
const cA2 = dArr2.post;
const dRelease = decideRelease(cA2, 1);
const c0 = dRelease.post;
const dDispatch = decideDispatch(cfgBudgeted, c0, 1);
const c1 = dDispatch.post;
const dWork1 = decideTaskDone(c1, 1, 1, "VPass");
const c2 = dWork1.post;
const dWork2 = decideTaskDone(c2, 1, 2, "VPass");
const c3 = dWork2.post;
const dWorkReduce = decideWorkReduce(c3, 1);
const c4 = dWorkReduce.post;
const dEval1 = decideTaskDone(c4, 1, 3, "VPass");
const c5 = dEval1.post;
const dEval2 = decideTaskDone(c5, 1, 4, "VPass");
const c6 = dEval2.post;
const dEvalReduce = decideEvalStageReduce(cfgBudgeted, c6, 1);
const c7 = dEvalReduce.post;
const dComplete = decideWrapUpResolve(cfgBudgeted, c7, 1, "WOk", false);
const c8 = dComplete.post;

/**
 * The HELD twin of c7's landing: the same enqueued ticket, dequeued with the
 * environment drawing MOVED, so the gate opens and the resolution promotes out
 * of the slot. `chuggy_test` builds exactly this pair to keep the two landing
 * paths distinguishable at decider grain.
 */
const dGateOpen7 = decideWrapUpStart(c7, 1);
const cGated7 = dGateOpen7.post;
const dCompleteGated = decideWrapUpResolve(
  cfgBudgeted,
  cGated7,
  1,
  "WOk",
  true,
);

test("happyPathMeasureDescendsTest: every decision on the path strictly descends", () => {
  // The model's eight conjuncts, whole.
  const walk: readonly (readonly [string, Core, Core])[] = [
    ["dispatch (gas)", c0, c1],
    ["the first work completion (task count)", c1, c2],
    ["the second work completion", c2, c3],
    ["the work reduce (rank)", c3, c4],
    ["the first eval completion", c4, c5],
    ["the second eval completion", c5, c6],
    ["the eval reduce (rank)", c6, c7],
    ["the landing (rank)", c7, c8],
  ];
  for (const [what, pre, post] of walk) {
    assert.ok(mB(post) < mB(pre), `${what} does not descend`);
  }
});

test("happyPathRecordsTest: the records are golden-trace shaped, with phase flips only where the anatomy says", () => {
  assert.equal(dDispatch.rec.label, "dispatch");
  assert.deepEqual(dDispatch.rec.transitions, [
    { ticket: 1, from: "PPending", to: "PWorking" },
  ]);
  assert.equal(dWork1.rec.label, "task-done");
  assert.deepEqual(dWork1.rec.transitions, []);
  // A completion emits NOTHING: the task already ran: the record resolves
  // inside the phase and the world is told nothing new.
  assert.deepEqual(dWork1.rec.effects, []);
  assert.equal(dWorkReduce.rec.label, "work-passed");
  assert.deepEqual(dWorkReduce.rec.transitions, [
    { ticket: 1, from: "PWorking", to: "PEvaluating" },
  ]);
  assert.equal(dEvalReduce.rec.label, "eval-passed");
  assert.deepEqual(dEvalReduce.rec.transitions, [
    { ticket: 1, from: "PEvaluating", to: "PWrapUp" },
  ]);
  assert.equal(dComplete.rec.label, "ticket-done");
  assert.deepEqual(dComplete.rec.transitions, [
    { ticket: 1, from: "PWrapUp", to: "PDone" },
  ]);
  // THE SPAWN EFFECTS. The model pins these because nothing else does, and
  // records the mutation that made the case: dropping SpawnEvalTasks from
  // work-passed left all 54 of its other cases passing.
  assert.deepEqual(dDispatch.rec.effects, ["SpawnWorkTasks"]);
  assert.deepEqual(dWorkReduce.rec.effects, ["SpawnEvalTasks"]);
  assert.deepEqual(dEvalReduce.rec.effects, ["EnqueueWrapUp"]);
});

test("happyPathRetainedRecordTest: the work set is retired and the eval stage is live above it", () => {
  // The model's four conjuncts: the whole anatomy at Done, and the
  // intermediate shape at c4 where the work set is already retired under a
  // live eval stage.
  assert.deepEqual(ticketAt(c8, 1).record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
    et(3, 0, "TPassed"),
    et(4, 0, "TPassed"),
  ]);
  assert.deepEqual(ticketAt(c8, 1).tasks, []);
  assert.deepEqual(ticketAt(c4, 1).record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
  ]);
  assert.deepEqual(ticketAt(c4, 1).tasks, [er(3, 0), er(4, 0)]);
});

test("happyPathIdsAccountedTest: the ghost spawn counter equals retired + live at every step", () => {
  const accounted = (c: Core): boolean =>
    ticketAt(c, 1).spawned ===
    ticketAt(c, 1).record.length + ticketAt(c, 1).tasks.length;
  assert.equal(ticketAt(cA1, 1).spawned, 0); // a Draft has spawned nothing
  assert.equal(ticketAt(c1, 1).spawned, 2); // the work fan-out
  assert.ok(accounted(c1));
  assert.equal(ticketAt(c4, 1).spawned, 4); // + eval stage 0's fan-out
  assert.ok(accounted(c4));
  assert.equal(ticketAt(c8, 1).spawned, 4); // Done: all retired, none lost
  assert.ok(accounted(c8));
});

test("effectExclusivityHappyPathTest: exactly one completion effect, exactly at Done", () => {
  assert.equal(ticketAt(c8, 1).phase, "PDone");
  assert.equal(ticketAt(c8, 1).completions, 1);
  assert.deepEqual(dComplete.rec.effects, ["Complete"]);
});

test("wrapUpSuccessPathsEmitOneEffectTest: both routes in emit the one effect", () => {
  // Same terminal, same exclusivity counter, same single `Complete` — and a
  // different FROM-phase, which is the whole of what distinguishes the held
  // promotion from the quiet fast-path. The domain knows only that the step
  // succeeded and never which mechanism promoted anything, so the effect is
  // not drawn and not parameterised; the PATH is what the record carries.
  assert.deepEqual(dCompleteGated.rec.effects, ["Complete"]);
  assert.deepEqual(dCompleteGated.rec.transitions, [
    { ticket: 1, from: "PWrapUpHolding", to: "PDone" },
  ]);
  assert.equal(ticketAt(dCompleteGated.post, 1).phase, "PDone");
  assert.equal(ticketAt(dCompleteGated.post, 1).completions, 1);
  assert.deepEqual(dComplete.rec.effects, ["Complete"]);
  assert.deepEqual(dComplete.rec.transitions, [
    { ticket: 1, from: "PWrapUp", to: "PDone" },
  ]);
  // "AND NO OTHER", as a refusal rather than an observation: the path iff
  // `wrapUpIsolation` checks on every reachable step is asserted at the
  // decider, so neither resolution can fire off the other's phase.
  assert.throws(
    () => decideWrapUpResolve(cfgBudgeted, c7, 1, "WOk", true),
    AssertionError,
  );
  assert.throws(
    () => decideWrapUpResolve(cfgBudgeted, cGated7, 1, "WOk", false),
    AssertionError,
  );
});

test("gateOpenClassifiedTest: the gate OPENS as its own recorded step, charging nothing", () => {
  assert.equal(dGateOpen7.rec.label, "wrapup-started");
  assert.deepEqual(dGateOpen7.rec.transitions, [
    { ticket: 1, from: "PWrapUp", to: "PWrapUpHolding" },
  ]);
  assert.deepEqual(dGateOpen7.rec.effects, ["OpenGate"]);
  // No attempt is RESOLVED by the open: the choice it encoded surfaces on the
  // resolution's attribution, and the open itself carries none.
  assert.deepEqual(dGateOpen7.rec.landing, { tag: "WONone" });
  assert.equal(ticketAt(cGated7, 1).gasLeft, ticketAt(c7, 1).gasLeft);
  assert.equal(ticketAt(cGated7, 1).wrapUpLeft, ticketAt(c7, 1).wrapUpLeft);
  assert.ok(mB(cGated7) < mB(c7));
  assert.ok(mB(dCompleteGated.post) < mB(cGated7));
});

test("dequeueRoutesBothBranchesTest: the routing decider IS the quiet/moved route", () => {
  // Pinned as decision EQUALITIES plus the semantic content of each branch, so
  // a re-routed branch cannot hide behind self-consistent downstream checks —
  // the model's header has the p3 mutant that argument comes from.
  const moved = decideDequeue(cfgBudgeted, c7, 1, true);
  const quiet = decideDequeue(cfgBudgeted, c7, 1, false);
  assert.deepEqual(moved, decideWrapUpStart(c7, 1));
  assert.deepEqual(
    quiet,
    decideWrapUpResolve(cfgBudgeted, c7, 1, "WOk", false),
  );
  assert.equal(ticketAt(moved.post, 1).phase, "PWrapUpHolding");
  assert.equal(moved.rec.label, "wrapup-started");
  assert.equal(ticketAt(quiet.post, 1).phase, "PDone");
  assert.equal(quiet.rec.label, "ticket-done");
  assert.deepEqual(quiet.rec.effects, ["Complete"]);
  assert.deepEqual(quiet.rec.landing, {
    tag: "WOAttempt",
    project: 1,
    invalidated: false,
  });
  assert.equal(ticketAt(quiet.post, 1).completions, 1);
});

// === At-least-once: duplicates are idempotent stutters ======================

test("duplicateTaskDoneIdempotentTest: a duplicate completion for a resolved LIVE task changes nothing", () => {
  // Even with a CONTRADICTING verdict — first write wins.
  const dup = decideTaskDone(c2, 1, 1, "VFail");
  assert.deepEqual(dup.post, c2);
  assert.equal(dup.rec.label, "task-done-duplicate");
  assert.deepEqual(dup.rec.effects, []);
  assert.equal(mB(dup.post), mB(c2));
});

test("staleStageCompletionNoopsTest: a completion for a RETIRED id no-ops by identity", () => {
  // The model's c4 conjuncts: eval stage 0 is live (ids 3,4) and work ids 1,2
  // are retired, so a work completion arriving now finds no live running
  // match.
  const stale = decideTaskDone(c4, 1, 1, "VFail");
  assert.deepEqual(stale.post, c4);
  assert.equal(stale.rec.label, "task-done-duplicate");
  assert.equal(mB(stale.post), mB(c4));
  // THE c7 CONJUNCT, AND THE ONE PLACE THIS SUITE ANSWERS MORE STRICTLY THAN
  // THE MODEL. At c7 the ticket has left its task phase entirely (PWrapUp), and
  // the model's decider — total by construction — absorbs the stale eval
  // completion as the same stutter. s2a's `decideTaskDone` asserts the phase
  // guarantee the `taskDone` action states (`taskPhaseIn`, whose draw set the
  // model's own machine never leaves), so the event is REFUSED here rather than
  // absorbed. Strictly stronger, and unreachable either way: no machine step
  // and no golden trace can deliver it, because the action draws j from
  // `taskPhaseTickets` — and `model/refinement.qnt`'s `cmdEnabled` states the
  // same pair on its `JTaskDone` arm (`taskPhaseIn` and `deliverableTaskIds`),
  // which is the citation that matters for s3: the replayer will refuse the
  // command at the same two guards this refuses the call at, so the strictness
  // costs no conformance. The absorb-by-identity claim itself is
  // pinned above at c4, and inside the task phase at `cS1`
  // (staleStageDuplicateNoopsTest).
  assert.deepEqual(taskPhaseIn(c7), new Set());
  assert.throws(() => decideTaskDone(c7, 1, 3, "VFail"), AssertionError);
});

test("completeDuplicateExclusiveTest: a re-delivered completion for a Done ticket emits NOTHING", () => {
  const dup = decideCompleteDuplicate(c8, 1);
  assert.deepEqual(dup.post, c8);
  assert.equal(dup.rec.label, "complete-duplicate");
  assert.deepEqual(dup.rec.effects, []);
  assert.equal(ticketAt(dup.post, 1).completions, 1);
  assert.equal(mB(dup.post), mB(c8));
  // The absorber is the Done tickets' alone: a landing cannot be re-delivered
  // for a ticket that never landed — pinned at the OTHER terminal as well as
  // in the queue, because "not Done" and "not terminal" are different guards
  // and only a Revoked ticket separates them.
  assert.throws(() => decideCompleteDuplicate(c7, 1), AssertionError);
  assert.throws(
    () => decideCompleteDuplicate(revokeOne(jLand).post, 1),
    AssertionError,
  );
  assert.deepEqual(doneIn(revokeOne(jLand).post), new Set());
});

test("decideTaskDone writes the EVENT's verdict into the stored resolution", () => {
  // Both directions of the model's `match v { VPass => TPassed | VFail =>
  // TFailed }`, on a LIVE running task — the only place the mapping is
  // observable. Every other completion in this suite either passes or hits the
  // absorbing arm, where the verdict is discarded by design; read from the
  // model, whose post-state for the failing call is
  // `Set({1, TKWork, TSResolved(TFailed)}, {2, TKWork, TSRunning})`.
  const failed = decideTaskDone(c1, 1, 1, "VFail");
  assert.equal(failed.rec.label, "task-done");
  assert.deepEqual(ticketAt(failed.post, 1).tasks, [wt(1, "TFailed"), wr(2)]);
  const passed = decideTaskDone(c1, 1, 1, "VPass");
  assert.deepEqual(ticketAt(passed.post, 1).tasks, [wt(1, "TPassed"), wr(2)]);
});

test("noop is state-identical, not merely state-equal", () => {
  // The idempotent answer to a duplicate delivery returns the observed Core
  // itself. Equality would be enough for the model; identity is what makes a
  // replayed stutter provably touch nothing.
  const absorbed = noop(c4, "task-done-duplicate");
  assert.equal(absorbed.post, c4);
  assert.deepEqual(absorbed.rec, {
    label: "task-done-duplicate",
    transitions: [],
    effects: [],
    landing: { tag: "WONone" },
  });
});

// === The work wall: cycle-level, no below-cycle retries =====================

const cWorkFail: Core = solo({
  ...draft(cfgBudgeted),
  phase: "PWorking",
  gasLeft: 2,
  tasks: [wt(1, "TFailed"), wt(2, "TPassed")],
  spawned: 2,
});
const dWorkFail = decideWorkReduce(cWorkFail, 1);

test("workFailedWallTest: a failed work set escalates DIRECTLY at cycle level", () => {
  assert.equal(dWorkFail.rec.label, "ticket-escalated work_failed");
  const parked = ticketAt(dWorkFail.post, 1);
  assert.equal(parked.phase, "PEscalated");
  assert.equal(parked.reason, "RsWorkFailed");
  assert.equal(parked.resumeAt, "RWorking");
  assert.ok(hasOpenHumanTask(parked));
  assert.deepEqual(dWorkFail.rec.effects, ["OpenHumanTask"]);
  // The failed set is RETIRED, outcomes intact — the record shows WHICH task
  // failed, provenance the desk can read.
  assert.deepEqual(parked.record, [wt(1, "TFailed"), wt(2, "TPassed")]);
  assert.deepEqual(parked.tasks, []);
  assert.ok(mB(dWorkFail.post) < mB(cWorkFail));
});

// === The middle loop (budgeted eval rework) and its two walls ===============
// The model's `oneFailedE0` is NOT `fixtures.test.ts`'s `mixedE0`: the two
// stages disagree about WHICH task failed, and as sets they are different
// values. Both are the model's, used where it uses them.

const oneFailedE0: readonly Task[] = [et(1, 0, "TFailed"), et(2, 0, "TPassed")];

/**
 * A ticket mid-evaluation: a chosen program, a chosen stage set, and chosen
 * accounts. Every eval-reduce fixture below is one of these, because the arm
 * that fires is decided by exactly those three.
 */
function evaluating(
  program: readonly Stage[],
  tasks: readonly Task[],
  reworkLeft: number,
  gasLeft: number,
): Core {
  return solo({
    ...draft(cfgBudgeted, program),
    phase: "PEvaluating",
    reworkLeft,
    gasLeft,
    tasks,
    spawned: tasks.length,
  });
}

const cEvalFail = evaluating(progU2, oneFailedE0, 1, 2);
const dEvalRework = decideEvalStageReduce(cfgBudgeted, cEvalFail, 1);
const cReworkWall = evaluating(progU2, oneFailedE0, 0, 2);
const dReworkWall = decideEvalStageReduce(cfgBudgeted, cReworkWall, 1);
const cEvalGasWall = evaluating(progU2, oneFailedE0, 1, 0);
const dEvalGasWall = decideEvalStageReduce(cfgBudgeted, cEvalGasWall, 1);

test("evalReworkDescendsTest: 1 rework budget + 1 gas buy a new cycle", () => {
  assert.equal(dEvalRework.rec.label, "rework-started eval_failure");
  const reworking = ticketAt(dEvalRework.post, 1);
  assert.equal(reworking.phase, "PWorking");
  assert.equal(reworking.reworkLeft, 0);
  assert.equal(reworking.gasLeft, 1);
  // The failed stage is retired; the rework cycle's work set spawns at the
  // NEXT ids — new records, not overwrites.
  assert.deepEqual(reworking.record, oneFailedE0);
  assert.deepEqual(reworking.tasks, [wr(3), wr(4)]);
  assert.ok(mB(dEvalRework.post) < mB(cEvalFail));
});

test("the eval reduce's every arm emits the effect its edge owes", () => {
  // THE SPAWN AND DESK EFFECTS, pinned because nothing else pins them and a
  // spawn emitting no effect is a fan-out the world never hears about — the
  // model's own note on `happyPathRecordsTest`, applied to the arms that run
  // does not reach. Read from the model.
  assert.deepEqual(dEvalRework.rec.effects, ["SpawnWorkTasks"]);
  assert.deepEqual(dReworkWall.rec.effects, ["OpenHumanTask"]);
  assert.deepEqual(dEvalGasWall.rec.effects, ["OpenHumanTask"]);
});

test("the eval reduce indexes into the program the ticket really carries", () => {
  // `programsWellFormed` keeps every program non-empty and `tasksWellFormed`
  // keeps the live stage inside it, so `program[s]` is the running stage rather
  // than a possibility — asserted where it is indexed, because TypeScript's
  // types permit what the model's cannot express.
  const cEmptyProgram: Core = solo({
    ...draft(cfgBudgeted),
    program: [],
    phase: "PEvaluating",
    gasLeft: 2,
    tasks: [et(1, 0, "TPassed")],
    spawned: 1,
  });
  assert.deepEqual(reducibleEvalIn(cEmptyProgram), new Set([1]));
  assert.throws(
    () => decideEvalStageReduce(cfgBudgeted, cEmptyProgram, 1),
    AssertionError,
  );
});

test("evalWallsNamedTest: the budget wall is checked before the gas wall", () => {
  assert.equal(
    dReworkWall.rec.label,
    "ticket-escalated rework_budget_exhausted",
  );
  assert.equal(ticketAt(dReworkWall.post, 1).reason, "RsReworkBudgetExhausted");
  assert.equal(ticketAt(dReworkWall.post, 1).resumeAt, "REvaluating");
  assert.ok(mB(dReworkWall.post) < mB(cReworkWall));
  assert.equal(dEvalGasWall.rec.label, "ticket-escalated gas_exhausted");
  assert.equal(ticketAt(dEvalGasWall.post, 1).reason, "RsGasExhausted");
  assert.ok(mB(dEvalGasWall.post) < mB(cEvalGasWall));
  // THE ORDER IS A CLAIM, and only a ticket that has run out of BOTH can make
  // it: the model checks the budget wall first, so this parks behind the
  // rework wall rather than the deadline one. Read from the model.
  const bothGone = decideEvalStageReduce(
    cfgBudgeted,
    evaluating(progU2, oneFailedE0, 0, 0),
    1,
  );
  assert.equal(bothGone.rec.label, "ticket-escalated rework_budget_exhausted");
});

// === THE STAGED PROGRAM, walked stage by stage ==============================
// progStaged = [{1, unanimous}, {2, any}] at DB's consts: work's 2-wide set
// passes into a 1-wide stage 0, which advances into a 2-wide stage 1.

const cStagedWork: Core = solo({
  ...draft(cfgBudgeted, progStaged),
  phase: "PWorking",
  gasLeft: 2,
  tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
  spawned: 2,
});
const dToEval = decideWorkReduce(cStagedWork, 1);
const cS0 = dToEval.post;
const dS0Done = decideTaskDone(cS0, 1, 3, "VPass");
const dAdvance = decideEvalStageReduce(cfgBudgeted, dS0Done.post, 1);
const cS1 = dAdvance.post;
const dS1a = decideTaskDone(cS1, 1, 4, "VPass");
const dS1b = decideTaskDone(dS1a.post, 1, 5, "VFail");
const dStagedFinal = decideEvalStageReduce(cfgBudgeted, dS1b.post, 1);

test("stageAdvanceDescendsTest: the advance edge, exactly", () => {
  assert.equal(dAdvance.rec.label, "eval-stage-passed");
  assert.deepEqual(dAdvance.rec.transitions, [
    { ticket: 1, from: "PEvaluating", to: "PEvaluating" },
  ]);
  assert.deepEqual(dAdvance.rec.effects, ["SpawnEvalTasks"]);
  const advanced = ticketAt(cS1, 1);
  assert.equal(advanced.phase, "PEvaluating");
  assert.deepEqual(advanced.tasks, [er(4, 1), er(5, 1)]);
  assert.deepEqual(advanced.record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
    et(3, 0, "TPassed"),
  ]);
  // No account moved: stage progress is priced by the measure's stage digit,
  // not by gas or budget.
  assert.equal(advanced.gasLeft, 2);
  assert.equal(advanced.reworkLeft, 1);
  assert.ok(mB(cS1) < mB(dS0Done.post));
});

test("stagedProgramPassesTest: the FINAL stage passing lands the program", () => {
  assert.equal(dStagedFinal.rec.label, "eval-passed");
  assert.deepEqual(dStagedFinal.rec.transitions, [
    { ticket: 1, from: "PEvaluating", to: "PWrapUp" },
  ]);
  assert.deepEqual(ticketAt(dStagedFinal.post, 1).tasks, []);
  // Per-stage combinators applied: stage 1's CAnyPass passed on a mixed set,
  // and the mixed set is retained as it fell.
  assert.deepEqual(ticketAt(dStagedFinal.post, 1).record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
    et(3, 0, "TPassed"),
    et(4, 1, "TPassed"),
    et(5, 1, "TFailed"),
  ]);
  assert.ok(mB(dStagedFinal.post) < mB(dS1b.post));
});

test("the WNone route: a kindless ticket completes at the eval pass, taking no lease", () => {
  // THE OTHER HALF OF THE WRAP-UP ROUTE, which no run in `chuggy_test` reaches
  // because every fixture there authors `WExclusive(1)`. A `WNone` ticket's
  // effect already happened during work, so evaluation passing IS its
  // completion: it enters neither wrap-up phase, records a wrap-up it did not
  // perform, nor queues for a lease it has no stake in (`noLeaseWithoutAKind`
  // is the invariant that makes it structural). Every value read from the
  // model.
  const cKindless: Core = solo({
    ...freshTicket(cfgBudgeted, new Set(), progU2, 1, { tag: "WNone" }),
    phase: "PEvaluating",
    gasLeft: 2,
    tasks: [et(1, 0, "TPassed"), et(2, 0, "TPassed")],
    spawned: 2,
  });
  const d = decideEvalStageReduce(cfgBudgeted, cKindless, 1);
  assert.equal(d.rec.label, "ticket-done");
  assert.deepEqual(d.rec.transitions, [
    { ticket: 1, from: "PEvaluating", to: "PDone" },
  ]);
  assert.deepEqual(d.rec.effects, ["Complete"]);
  // A COMPLETION IS NOT ALWAYS AN ATTEMPT: this is the one ticket-done that
  // legitimately carries no attribution, because no landing attempt resolved.
  assert.deepEqual(d.rec.landing, { tag: "WONone" });
  const landed = ticketAt(d.post, 1);
  assert.equal(landed.phase, "PDone");
  assert.equal(landed.completions, 1);
  assert.equal(landed.gasLeft, 2); // the route charges nothing
  // ON THE RETIRED TICKET, not the live one: skipping the wrap-up phases skips
  // the retirement they would have done, and a Done ticket holding live eval
  // tasks breaks `tasksWellFormed`. The model's header records that the random
  // layer is what caught it.
  assert.deepEqual(landed.tasks, []);
  assert.deepEqual(landed.record, [et(1, 0, "TPassed"), et(2, 0, "TPassed")]);
  // And the kind answers outside every resource universe, so it can never
  // collide with a real holder.
  assert.equal(leaseOf(ticketAt(cKindless, 1)), noResource);
  assert.ok(leaseFreeIn(d.post, noResource));
});

test("a stage FAILS above index 0: the short-circuit fires from the running stage", () => {
  // Every failing-stage fixture in the model's suite and in this one fails at
  // index 0, where "the running stage" and "the program's first stage" are the
  // same list entry. Stage 1 is CAnyPass, so both of its tasks must fail — and
  // then the same rework economy applies, from an index that tells the two
  // readings apart. Read from the model.
  const failed = decideTaskDone(
    decideTaskDone(cS1, 1, 4, "VFail").post,
    1,
    5,
    "VFail",
  );
  const d = decideEvalStageReduce(cfgBudgeted, failed.post, 1);
  assert.equal(d.rec.label, "rework-started eval_failure");
  assert.deepEqual(d.rec.transitions, [
    { ticket: 1, from: "PEvaluating", to: "PWorking" },
  ]);
  const reworking = ticketAt(d.post, 1);
  assert.equal(reworking.reworkLeft, 0); // the same price as a stage-0 failure
  assert.equal(reworking.gasLeft, 1);
  // The failed stage is retired UNDER its own index, and the rework's work set
  // spawns above the whole history — ids 6 and 7, not 4 and 5.
  assert.deepEqual(reworking.record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
    et(3, 0, "TPassed"),
    et(4, 1, "TFailed"),
    et(5, 1, "TFailed"),
  ]);
  assert.deepEqual(reworking.tasks, [wr(6), wr(7)]);
  assert.equal(reworking.spawned, 7);
});

// --- The short-circuit: stage 0 fails, stage 1 is never created -------------

const dS0Fail = decideTaskDone(cS0, 1, 3, "VFail");
const dShort = decideEvalStageReduce(cfgBudgeted, dS0Fail.post, 1);
const cAfterShort = dShort.post;

test("shortCircuitRoutesToReworkTest: the later stages are skipped, not failed", () => {
  assert.equal(dShort.rec.label, "rework-started eval_failure");
  assert.deepEqual(dShort.rec.transitions, [
    { ticket: 1, from: "PEvaluating", to: "PWorking" },
  ]);
  const reworking = ticketAt(cAfterShort, 1);
  assert.equal(reworking.reworkLeft, 0); // paid 1 rework
  assert.equal(reworking.gasLeft, 1); // paid 1 gas
  assert.equal(reworking.wrapUpLeft, 1); // gate untouched
  // "no task records exist for them": stage 1 never spawned, so the record
  // holds no TKEval(1) entry — the same price as the flat case, and one fewer
  // task than a machine that had launched the later stage to fail it.
  assert.deepEqual(reworking.record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
    et(3, 0, "TFailed"),
  ]);
  assert.ok(
    reworking.record.every(
      (t) => t.kind.tag !== "TKEval" || t.kind.stage !== 1,
    ),
  );
  assert.deepEqual(reworking.tasks, [wr(4), wr(5)]);
  assert.ok(mB(cAfterShort) < mB(dS0Fail.post));
});

const dReworkW1 = decideTaskDone(cAfterShort, 1, 4, "VPass");
const dReworkW2 = decideTaskDone(dReworkW1.post, 1, 5, "VPass");
const dBackToEval = decideWorkReduce(dReworkW2.post, 1);

test("reworkRestartsLowestStageTest: the next cycle restarts from stage 0", () => {
  // Stages are recomputed per cycle, never resumed mid-sequence — so the
  // reduce spawns the LOWEST stage's fan-out (1 wide), never stage 1's.
  assert.equal(dBackToEval.rec.label, "work-passed");
  assert.deepEqual(ticketAt(dBackToEval.post, 1).tasks, [er(6, 0)]);
  assert.deepEqual(ticketAt(dBackToEval.post, 1).record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
    et(3, 0, "TFailed"),
    wt(4, "TPassed"),
    wt(5, "TPassed"),
  ]);
});

test("stagedShortCircuitEscalatesTest: the same short-circuit against an empty account", () => {
  // The golden fixture's exact shape — stage-0 fails, stage 1 never launched,
  // escalate — hitting the EXISTING wall: no new wall, no new account.
  const cStagedNoBudget: Core = solo({
    ...draft(cfgBudgeted, progStaged),
    phase: "PEvaluating",
    reworkLeft: 0,
    gasLeft: 2,
    record: [wt(1, "TPassed"), wt(2, "TPassed")],
    tasks: [et(3, 0, "TFailed")],
    spawned: 3,
  });
  const dStagedWall = decideEvalStageReduce(cfgBudgeted, cStagedNoBudget, 1);
  assert.equal(
    dStagedWall.rec.label,
    "ticket-escalated rework_budget_exhausted",
  );
  const parked = ticketAt(dStagedWall.post, 1);
  assert.equal(parked.phase, "PEscalated");
  assert.equal(parked.resumeAt, "REvaluating");
  assert.deepEqual(parked.record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
    et(3, 0, "TFailed"),
  ]);
  assert.ok(
    parked.record.every((t) => t.kind.tag !== "TKEval" || t.kind.stage !== 1),
  );
  assert.ok(mB(dStagedWall.post) < mB(cStagedNoBudget));
});

test("evaluatorCrashTicketPaysTest: an evaluator's own death is priced as a failed verdict", () => {
  // The short-circuit above IS the crash case read as infrastructure death:
  // the same TFailed, the same decision, and the account deltas are the claim
  // — exactly 1 rework + 1 gas, same as any product failure, no new machinery.
  const before = ticketAt(cStagedWork, 1);
  const after = ticketAt(cAfterShort, 1);
  assert.equal(before.reworkLeft - after.reworkLeft, 1);
  assert.equal(before.gasLeft - after.gasLeft, 1);
  assert.equal(before.wrapUpLeft, after.wrapUpLeft);
});

test("staleStageDuplicateNoopsTest: a retired STAGE-0 id absorbs while stage 1 runs", () => {
  // Inside the task phase, unlike the c7 case: stage 1 is live (ids 4,5) and
  // stage 0's task 3 is retired, so a re-delivered completion for it — with a
  // contradicting verdict — finds no live running match.
  const stale = decideTaskDone(cS1, 1, 3, "VFail");
  assert.deepEqual(stale.post, cS1);
  assert.equal(stale.rec.label, "task-done-duplicate");
  assert.equal(mB(stale.post), mB(cS1));
});

// === PROGRAM-AS-DATA at machine level =======================================
// ONE machine instance, two tickets identical but for the program on their
// record: different decisions. `cStagedWork` is the staged section's, reused
// here exactly as the model reuses it.

const cFlatWork: Core = solo({
  ...draft(cfgBudgeted),
  phase: "PWorking",
  gasLeft: 2,
  tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
  spawned: 2,
});

test("programAsDataStructureTest: the same passed work set spawns the program's own lowest stage", () => {
  assert.deepEqual(ticketAt(decideWorkReduce(cFlatWork, 1).post, 1).tasks, [
    er(3, 0),
    er(4, 0),
  ]);
  assert.deepEqual(ticketAt(decideWorkReduce(cStagedWork, 1).post, 1).tasks, [
    er(3, 0),
  ]);
});

/** `chuggy_test`'s progA2 — the any-pass twin of the default program. */
const progA2: readonly Stage[] = [{ fanout: 2, combinator: "CAnyPass" }];
const allFailedE0: readonly Task[] = [et(1, 0, "TFailed"), et(2, 0, "TFailed")];

test("programAsDataCombinatorTest: the same mixed set passes or reworks by the program's combinator", () => {
  const anyPass = decideEvalStageReduce(
    cfgBudgeted,
    evaluating(progA2, mixedE0, 1, 2),
    1,
  );
  const unanimous = decideEvalStageReduce(
    cfgBudgeted,
    evaluating(progU2, mixedE0, 1, 2),
    1,
  );
  assert.equal(anyPass.rec.label, "eval-passed");
  assert.equal(ticketAt(anyPass.post, 1).phase, "PWrapUp");
  assert.equal(unanimous.rec.label, "rework-started eval_failure");
  assert.equal(ticketAt(unanimous.post, 1).phase, "PWorking");
  assert.equal(ticketAt(unanimous.post, 1).gasLeft, 1);
});

test("anyPassNotAlwaysPassTest: an all-failed set still walls under CAnyPass", () => {
  // A program is not "always pass": the rework path is taken.
  const d = decideEvalStageReduce(
    cfgBudgeted,
    evaluating(progA2, allFailedE0, 1, 2),
    1,
  );
  assert.equal(d.rec.label, "rework-started eval_failure");
});

// === The outer loop, priced per WrapUpPricing ===============================
// R5: failures fire from the HELD lease, so these fixtures sit in the occupied
// slot; every account delta is byte-identical to the pre-gate pricing.

/** An occupant of its project's gate slot, at chosen accounts. */
function holding(cfg: Config, wrapUpLeft: number, gasLeft: number): Core {
  return solo({
    ...draft(cfg),
    phase: "PWrapUpHolding",
    wrapUpLeft,
    gasLeft,
  });
}

const cGateB = holding(cfgBudgeted, 1, 2);
const dGateRework = decideWrapUpResolve(
  cfgBudgeted,
  cGateB,
  1,
  "WFailed",
  true,
);
const cGateWall = holding(cfgBudgeted, 0, 2);
const dGateWall = decideWrapUpResolve(
  cfgBudgeted,
  cGateWall,
  1,
  "WFailed",
  true,
);
const cGateGasWall = holding(cfgBudgeted, 1, 0);
const dGateGasWall = decideWrapUpResolve(
  cfgBudgeted,
  cGateGasWall,
  1,
  "WFailed",
  true,
);

test("gateReworkBudgetedDescendsTest: a landing failure spends 1 gate budget AND 1 gas", () => {
  assert.equal(dGateRework.rec.label, "rework-started wrapup_failure");
  const reworking = ticketAt(dGateRework.post, 1);
  assert.equal(reworking.phase, "PWorking");
  assert.equal(reworking.wrapUpLeft, 0);
  assert.equal(reworking.gasLeft, 1);
  // A fresh incarnation at fresh ids — and ids 1,2 because the eval set was
  // already retired when the ticket enqueued, so this ticket's history is
  // empty. Nothing is retired at the eviction.
  assert.deepEqual(reworking.tasks, [wr(1), wr(2)]);
  assert.deepEqual(reworking.record, []);
  // The eviction's spawn is announced: a fresh cycle the world never hears
  // about is the same hole `happyPathRecordsTest` pins on the other spawns.
  assert.deepEqual(dGateRework.rec.effects, ["SpawnWorkTasks"]);
  assert.ok(mB(dGateRework.post) < mB(cGateB));
});

test("gateWallsNamedTest: the gate-budget wall and the gas wall, each with its name", () => {
  assert.equal(dGateWall.rec.label, "ticket-escalated wrapup_budget_exhausted");
  assert.equal(ticketAt(dGateWall.post, 1).reason, "RsWrapUpBudgetExhausted");
  // The landing resume RE-ENQUEUES: back to the queue, never into the gate.
  assert.equal(ticketAt(dGateWall.post, 1).resumeAt, "RWrapUp");
  assert.ok(mB(dGateWall.post) < mB(cGateWall));
  assert.equal(dGateGasWall.rec.label, "ticket-escalated gas_exhausted");
  assert.equal(ticketAt(dGateGasWall.post, 1).reason, "RsGasExhausted");
  assert.deepEqual(dGateWall.rec.effects, ["OpenHumanTask"]);
  assert.deepEqual(dGateGasWall.rec.effects, ["OpenHumanTask"]);
  assert.ok(mB(dGateGasWall.post) < mB(cGateGasWall));
  // The gate account is checked before the gas account here too. Read from the
  // model: a ticket out of both parks behind the wrap-up budget wall.
  const bothGone = decideWrapUpResolve(
    cfgBudgeted,
    holding(cfgBudgeted, 0, 0),
    1,
    "WFailed",
    true,
  );
  assert.equal(bothGone.rec.label, "ticket-escalated wrapup_budget_exhausted");
});

const cGateD = holding(cfgDeadlineOnly, 0, 2);
const cGateDWall = holding(cfgDeadlineOnly, 0, 0);

test("gateReworkDeadlineOnlyTest: with no gate account, gas alone meters the loop", () => {
  const dGateD = decideWrapUpResolve(
    cfgDeadlineOnly,
    cGateD,
    1,
    "WFailed",
    true,
  );
  assert.equal(dGateD.rec.label, "rework-started wrapup_failure");
  assert.equal(ticketAt(dGateD.post, 1).phase, "PWorking");
  assert.equal(ticketAt(dGateD.post, 1).wrapUpLeft, 0); // no gate account
  assert.equal(ticketAt(dGateD.post, 1).gasLeft, 1);
  assert.ok(mD(dGateD.post) < mD(cGateD));
  const dGateDWall = decideWrapUpResolve(
    cfgDeadlineOnly,
    cGateDWall,
    1,
    "WFailed",
    true,
  );
  assert.equal(dGateDWall.rec.label, "ticket-escalated gas_exhausted");
  assert.equal(ticketAt(dGateDWall.post, 1).reason, "RsGasExhausted");
  assert.ok(mD(dGateDWall.post) < mD(cGateDWall));
  // And the wall that exists only under Budgeted never fires here: the whole
  // of DeadlineOnly's difference is which accounts it can spend.
  assert.notEqual(dGateDWall.rec.label, dGateWall.rec.label);
});

// === The human desk: parks, retries, and the metering parameter =============

const cFresh: Core = solo({ ...draft(cfgBudgeted), phase: "PPending" });
const dPark = decideRevalFail(cFresh, 1);
const dParkResume = decideOpRetry(cfgBudgeted, dPark.post, 1);

/** `chuggy_test`'s escLanding and escWorking, through the real `escalate`. */
const escLanding: Ticket = escalated(
  { ...draft(cfgBudgeted), gasLeft: 2 },
  "RsGasExhausted",
  "RWrapUp",
  "ticket-escalated gas_exhausted",
);
const escWorking: Ticket = escalated(
  { ...draft(cfgBudgeted), gasLeft: 2 },
  "RsWorkFailed",
  "RWorking",
  "ticket-escalated work_failed",
);
const cEscB: Core = solo(escLanding);
const cEscWorking: Core = solo(escWorking);

test("preWorkParkAndResumeClassifiedTest: the pre-work park and its free resume", () => {
  assert.equal(dPark.rec.label, "ticket-escalated revalidation_failed");
  assert.deepEqual(dPark.rec.effects, ["OpenHumanTask"]);
  const parked = ticketAt(dPark.post, 1);
  assert.equal(parked.phase, "PEscalated");
  assert.equal(parked.reason, "RsRevalidationFailed");
  // RPending: back to the waiting room, never to a pipeline phase, because
  // nothing pipeline ever ran.
  assert.equal(parked.resumeAt, "RPending");
  assert.ok(hasOpenHumanTask(parked)); // derived, not stored
  assert.ok(mB(dPark.post) < mB(cFresh));
  assert.equal(dParkResume.rec.label, "operator-retry");
  // THE PRE-WORK RESUME EMITS NOTHING — the one resume flavor with no effect,
  // because nothing is respawned and nothing is enqueued. An empty list is a
  // claim like any other, and only pinning it refuses a spurious effect.
  assert.deepEqual(dParkResume.rec.effects, []);
  assert.deepEqual(dParkResume.rec.transitions, [
    { ticket: 1, from: "PEscalated", to: "PPending" },
  ]);
  const resumed = ticketAt(dParkResume.post, 1);
  assert.equal(resumed.phase, "PPending");
  assert.equal(resumed.reason, "RsNone");
  assert.equal(resumed.resumeAt, "RNone");
  assert.equal(resumed.gasLeft, parked.gasLeft); // FREE
  assert.ok(!hasOpenHumanTask(resumed));
  assert.ok(mB(dParkResume.post) > mB(dPark.post)); // CHURN: climbs, by design
  // The park is a Ready-phase edge: the world changes under a ticket that
  // would start, and nowhere else.
  assert.throws(() => decideRevalFail(dPark.post, 1), AssertionError);
});

test("preWorkResumeFreeAtZeroGasTest: the pre-work resume is free under BOTH meterings", () => {
  const cParkNoGas: Core = solo({ ...ticketAt(dPark.post, 1), gasLeft: 0 });
  assert.ok(retryableIn(cfgBudgeted, cParkNoGas, 1));
  assert.ok(retryableIn(cfgDF, cParkNoGas, 1));
  const resumed = decideOpRetry(cfgBudgeted, cParkNoGas, 1);
  assert.equal(ticketAt(resumed.post, 1).phase, "PPending");
  assert.equal(ticketAt(resumed.post, 1).gasLeft, 0);
  // The contrast — the permanently-parked corner: a CHARGING resume at zero
  // gas is not retryable.
  assert.ok(!retryableIn(cfgBudgeted, solo({ ...escLanding, gasLeft: 0 }), 1));
});

test("opRetryChargedDescendsTest: under the default metering every pipeline resume pays", () => {
  const landing = decideOpRetry(cfgBudgeted, cEscB, 1);
  assert.equal(landing.rec.label, "operator-retry");
  assert.deepEqual(landing.rec.effects, ["EnqueueWrapUp"]);
  assert.equal(ticketAt(landing.post, 1).phase, "PWrapUp");
  assert.equal(ticketAt(landing.post, 1).gasLeft, 1); // charged
  assert.ok(!hasOpenHumanTask(ticketAt(landing.post, 1)));
  assert.ok(mB(landing.post) < mB(cEscB));
  const working = decideOpRetry(cfgBudgeted, cEscWorking, 1);
  assert.equal(ticketAt(working.post, 1).phase, "PWorking");
  assert.equal(ticketAt(working.post, 1).gasLeft, 1);
  assert.deepEqual(working.rec.effects, ["SpawnWorkTasks"]);
  // The respawn is the FULL work width, at ids continuing the ticket's own
  // history — 1 and 2 here, because this park never ran. Read from the model.
  assert.deepEqual(ticketAt(working.post, 1).tasks, [wr(1), wr(2)]);
  assert.equal(ticketAt(working.post, 1).spawned, 2);
  assert.ok(mB(working.post) < mB(cEscWorking));
});

test("opRetryEvalFreshFanoutTest: the Evaluating resume is a FRESH fan-out of the lowest stage", () => {
  const escEval: Ticket = escalated(
    {
      ...draft(cfgBudgeted, progStaged),
      gasLeft: 2,
      reworkLeft: 0,
      record: [wt(1, "TPassed"), wt(2, "TPassed"), et(3, 0, "TFailed")],
      spawned: 3,
    },
    "RsReworkBudgetExhausted",
    "REvaluating",
    "ticket-escalated rework_budget_exhausted",
  );
  const d = decideOpRetry(cfgBudgeted, solo(escEval), 1);
  assert.equal(d.rec.label, "operator-retry");
  assert.deepEqual(d.rec.effects, ["SpawnEvalTasks"]);
  assert.equal(ticketAt(d.post, 1).phase, "PEvaluating");
  assert.equal(ticketAt(d.post, 1).gasLeft, 1); // charged
  // Stages are never resumed mid-sequence: the LOWEST stage, at a fresh id,
  // with the retired stage-0 failure still on the record.
  assert.deepEqual(ticketAt(d.post, 1).tasks, [er(4, 0)]);
  assert.deepEqual(ticketAt(d.post, 1).record, escEval.record);
  assert.ok(mB(d.post) < mB(solo(escEval)));
  // The lowest stage is the program's first, so a ticket with no program has
  // no fan-out to respawn — refused where it is indexed, on
  // `decideWorkReduce`'s precedent.
  assert.throws(
    () => decideOpRetry(cfgBudgeted, solo({ ...escEval, program: [] }), 1),
    AssertionError,
  );
});

test("opRetryFreeClassifiedTest: under RetryFree the pipeline resume CLIMBS", () => {
  const free = decideOpRetry(cfgDF, cEscB, 1);
  assert.equal(ticketAt(free.post, 1).phase, "PWrapUp");
  assert.equal(ticketAt(free.post, 1).gasLeft, 2); // NOT charged
  assert.ok(mB(free.post) > mB(cEscB)); // CHURN: climbs
  // The Working resume still pays: entry to Working always meters.
  const working = decideOpRetry(cfgDF, cEscWorking, 1);
  assert.equal(ticketAt(working.post, 1).gasLeft, 1);
  assert.ok(mB(working.post) < mB(cEscWorking));
});

test("the metering parameter changes the price and NOTHING else", () => {
  // THE CONFIG-DOMAIN TRANSPOSITION of the exact-set rule: the deciders take a
  // `Config`, so a value leaking from the wrong field of it is a widening like
  // any other — and it hides wherever an instance is asked only the questions
  // its pricing already answers. DF is asked for the two respawns DB is asked
  // for, and must answer the same SETS at a different price.
  const working = decideOpRetry(cfgDF, cEscWorking, 1);
  assert.deepEqual(ticketAt(working.post, 1).tasks, [wr(1), wr(2)]);
  assert.deepEqual(working.rec.effects, ["SpawnWorkTasks"]);
  const escEval: Ticket = escalated(
    {
      ...draft(cfgBudgeted, progStaged),
      gasLeft: 2,
      reworkLeft: 0,
      record: [wt(1, "TPassed"), wt(2, "TPassed"), et(3, 0, "TFailed")],
      spawned: 3,
    },
    "RsReworkBudgetExhausted",
    "REvaluating",
    "ticket-escalated rework_budget_exhausted",
  );
  const evaluating = decideOpRetry(cfgDF, solo(escEval), 1);
  assert.deepEqual(ticketAt(evaluating.post, 1).tasks, [er(4, 0)]);
  assert.equal(ticketAt(evaluating.post, 1).gasLeft, 2); // free, and the SAME fan-out
  assert.deepEqual(evaluating.rec.effects, ["SpawnEvalTasks"]);
});

test("DeadlineOnly resolves a landing SUCCESS exactly as Budgeted does", () => {
  // The gate pricing is asked only about FAILURES anywhere else, so a pricing
  // leak into the success arm would sit in the half of the config domain
  // nothing exercises. Read from the model: same label, same effect, same
  // attribution, same counter.
  const d = decideWrapUpResolve(cfgDeadlineOnly, cGateD, 1, "WOk", true);
  assert.equal(d.rec.label, "ticket-done");
  assert.deepEqual(d.rec.effects, ["Complete"]);
  assert.deepEqual(d.rec.transitions, [
    { ticket: 1, from: "PWrapUpHolding", to: "PDone" },
  ]);
  assert.deepEqual(d.rec.landing, {
    tag: "WOAttempt",
    project: 1,
    invalidated: true,
  });
  assert.equal(ticketAt(d.post, 1).completions, 1);
  assert.ok(mD(d.post) < mD(cGateD));
});

// === The authoring lifecycle ================================================

test("gasRequiredTest: a gasless graph is INVALID — the machine admits no initial state", () => {
  assert.equal(configAdmitsInit(cfgDZ), false);
  // And the refusal reaches every ticket that configuration could ever hold,
  // which is the model's own argument for checking it at init: arrival funds a
  // ticket from the grant, so the seam refuses first.
  assert.throws(
    () => freshTicket(cfgDZ, new Set(), progU2, 1, wx1),
    AssertionError,
    "a gasless configuration built a ticket",
  );
  // The other four well-formedness conjuncts, each alone. A configuration
  // failing any one of them has no initial state either.
  assert.equal(configAdmitsInit(cfgBudgeted), true);
  for (const broken of [
    { ...cfgBudgeted, gas: 0 },
    { ...cfgBudgeted, nTasks: 0 },
    { ...cfgBudgeted, nTickets: 0 },
    { ...cfgBudgeted, maxStages: 0 },
    { ...cfgBudgeted, nProjects: 0 },
  ]) {
    assert.equal(
      configAdmitsInit(broken),
      false,
      `init admits a configuration it should refuse: ${JSON.stringify(broken)}`,
    );
  }
});

test("freshTicket grants each account from ITS OWN const, at a split-grant instance", () => {
  // DB grants 1 and 1, so its Draft cannot tell the two budgets apart. DD is
  // the instance where they differ — `wrapUpBudget(DeadlineOnly)` is 0 while
  // `reworkBudget(RWBudget(1))` is 1 — and the model's own answer there is
  // gasLeft 3, reworkLeft 1, wrapUpLeft 0.
  const born = draft(cfgDeadlineOnly);
  assert.deepEqual([born.gasLeft, born.reworkLeft, born.wrapUpLeft], [3, 1, 0]);
  const budgeted = draft(cfgBudgeted);
  assert.deepEqual(
    [budgeted.gasLeft, budgeted.reworkLeft, budgeted.wrapUpLeft],
    [3, 1, 1],
  );
  // And the rest of the seam: a Draft with no history, its authored fields
  // riding the arrival.
  assert.deepEqual(
    [born.phase, born.resumeAt, born.reason, born.completions, born.spawned],
    ["PDraft", "RNone", "RsNone", 0, 0],
  );
});

test("configAdmitsInit refuses a negative grant louder than `false`", () => {
  // The model's conjuncts are `reworkBudget(...) >= 0` and
  // `wrapUpBudget(...) >= 0`. s1 made a negative grant an assertion at the
  // reader rather than a boolean, so the refusal arrives as a throw — which
  // this pins, because a documented behaviour nothing exercises is a comment.
  assert.throws(
    () =>
      configAdmitsInit({
        ...cfgBudgeted,
        reworkPolicy: { tag: "RWBudget", budget: -1 },
      }),
    AssertionError,
  );
  assert.throws(
    () =>
      configAdmitsInit({
        ...cfgBudgeted,
        wrapUpPricing: { tag: "Budgeted", budget: -1 },
      }),
    AssertionError,
  );
});

test("the authoring universes are the model's, and `bounds` is DB's", () => {
  // projects and the two draw universes, read out of chuggy_domain at DB's
  // consts. The model pins `projects` twice in runs (wrapUpOutcomesDrawRuleTest,
  // oneProjectDegenerationTest); the other two are the arrival's draw sets.
  assert.deepEqual(projects(cfgBudgeted), new Set([1, 2]));
  assert.deepEqual(projects(cfgDO), new Set([1]));
  assert.deepEqual(wrapUpChoices(cfgBudgeted), [{ tag: "WNone" }, wx1, wx2]);
  assert.deepEqual(wrapUpChoices(cfgDO), [{ tag: "WNone" }, wx1]);
  assert.deepEqual(stageChoices(cfgBudgeted), [
    { fanout: 1, combinator: "CUnanimousPass" },
    { fanout: 1, combinator: "CAnyPass" },
    { fanout: 2, combinator: "CUnanimousPass" },
    { fanout: 2, combinator: "CAnyPass" },
  ]);
  assert.deepEqual(boundsOf(cfgBudgeted), bB);
  // DB's two widths are both 2, so the equality above cannot tell them apart.
  // A config where they differ can.
  assert.deepEqual(boundsOf({ ...cfgBudgeted, maxStages: 3 }), {
    ...bB,
    maxStages: 3,
  });
});

test("defaultProgramIsUnanimousSingleStageTest: ONE stage, full fan-out, unanimous", () => {
  assert.deepEqual(defaultProgram(cfgBudgeted), progU2);
  assert.ok(isValidProgram(cfgBudgeted, defaultProgram(cfgBudgeted)));
});

test("validProgramsRefusalTest: the set IS the arrival-refusal rule", () => {
  assert.ok(isValidProgram(cfgBudgeted, progU2));
  assert.ok(isValidProgram(cfgBudgeted, progStaged));
  assert.ok(!isValidProgram(cfgBudgeted, [])); // empty program
  assert.ok(
    !isValidProgram(cfgBudgeted, [{ fanout: 0, combinator: "CUnanimousPass" }]),
  ); // zero fan-out
  assert.ok(
    !isValidProgram(cfgBudgeted, [{ fanout: 3, combinator: "CUnanimousPass" }]),
  ); // fan-out > N_TASKS
  assert.ok(
    !isValidProgram(cfgBudgeted, [
      { fanout: 1, combinator: "CUnanimousPass" },
      { fanout: 1, combinator: "CUnanimousPass" },
      { fanout: 1, combinator: "CUnanimousPass" },
    ]),
  ); // length > MAX_STAGES
  // At N_TASKS = 2, MAX_STAGES = 2 there are exactly 4 stage choices, hence
  // 4 + 16 = 20 programs. The length is the SET's size only because the
  // enumeration holds no duplicate, which is checked here rather than assumed.
  assert.equal(validPrograms(cfgBudgeted).length, 20);
  assert.equal(
    new Set(validPrograms(cfgBudgeted).map((p) => JSON.stringify(p))).size,
    20,
  );
  // And the refusal is durable: an arrival cannot carry one.
  assert.throws(
    () => decideArrive(cfgBudgeted, cEmpty, new Set(), [], 1, wx1),
    AssertionError,
  );
});

test("arrivalTest: the freshTicket seam — dense ids, full accounts, authored program, and the AUTHORING climb", () => {
  assert.equal(dArr1.rec.label, "ticket-arrived");
  assert.deepEqual(dArr1.rec.transitions, []); // a birth, not an edge
  assert.deepEqual(dArr1.rec.effects, ["CreateDraft"]);
  assert.deepEqual([...cA1.tickets.keys()], [1]);
  const born = ticketAt(cA1, 1);
  assert.equal(born.phase, "PDraft");
  assert.equal(born.gasLeft, 3); // full grant, nothing spent
  assert.equal(born.reworkLeft, 1);
  assert.equal(born.wrapUpLeft, 1);
  assert.deepEqual(born.program, defaultProgram(cfgBudgeted)); // eval is data, authored
  assert.deepEqual(born.record, []); // no history yet
  assert.deepEqual([...cA2.tickets.keys()], [1, 2]); // dense: next id = size + 1
  assert.deepEqual(ticketAt(cA2, 2).deps, new Set([1])); // a dep on an UNRELEASED ticket is legal
  assert.ok(mB(cA1) > mB(cEmpty)); // AUTHORING: climbs
  assert.ok(mB(cA2) > mB(cA1));
});

test("arrivalCarriesProjectTest: the authored target project rides the arrival", () => {
  assert.equal(ticketAt(cA1, 1).project, 1);
  const elsewhere = decideArrive(
    cfgBudgeted,
    cEmpty,
    new Set(),
    defaultProgram(cfgBudgeted),
    2,
    wx2,
  );
  assert.equal(ticketAt(elsewhere.post, 1).project, 2);
  assert.equal(elsewhere.rec.label, "ticket-arrived");
  // Out of the universe is refused at authoring time, like an ill-formed
  // program (`projectsWellFormed` makes the refusal durable).
  assert.throws(
    () =>
      decideArrive(
        cfgBudgeted,
        cEmpty,
        new Set(),
        defaultProgram(cfgBudgeted),
        3,
        wx1,
      ),
    AssertionError,
  );
  assert.throws(
    () => decideArrive(cfgDO, cEmpty, new Set(), defaultProgram(cfgDO), 1, wx2),
    AssertionError,
    "a lease outside the resource universe was authorable",
  );
});

test("canArriveIn: the arrival bound, and the refusal at it", () => {
  // N_TICKETS = 2 on DB, so the fleet closes at cA2 — read from the model.
  assert.equal(canArriveIn(cfgBudgeted, cEmpty), true);
  assert.equal(canArriveIn(cfgBudgeted, cA1), true);
  assert.equal(canArriveIn(cfgBudgeted, cA2), false);
  assert.throws(
    () =>
      decideArrive(
        cfgBudgeted,
        cA2,
        new Set(),
        defaultProgram(cfgBudgeted),
        1,
        wx1,
      ),
    AssertionError,
  );
});

test("releaseDescendsTest: release goes Draft -> Pending, and Ready re-derives", () => {
  assert.equal(dRelease.rec.label, "ticket-released");
  assert.deepEqual(dRelease.rec.transitions, [
    { ticket: 1, from: "PDraft", to: "PPending" },
  ]);
  assert.deepEqual(dRelease.rec.effects, []); // release charges and emits nothing
  assert.ok(mB(c0) < mB(cA2));
  assert.ok(isReadyIn(c0, 1)); // no deps: Ready derives
  // Release leaves from Draft alone.
  assert.throws(() => decideRelease(c0, 1), AssertionError);
});

const cRel2: Core = decideRelease(cA2, 2).post; // 2 Pending, its dep 1 still Draft

test("unreleasedDepBlocksTest: a dependency on an UNRELEASED ticket blocks", () => {
  assert.ok(isBlockedIn(cRel2, 2));
  assert.ok(!isReadyIn(cRel2, 2));
  // The model's positive control: release ticket 2 at c8, where its dependency
  // has LANDED through the whole pipeline rather than been hand-built Done, and
  // Ready derives.
  assert.ok(isReadyIn(decideRelease(c8, 2).post, 2));
});

// === Revoke, from every live phase ==========================================
// The model's single-ticket fixtures — one per live phase and all THREE
// desk-reason flavors of the one parked phase — plus its hand-built landed
// ticket, all from `fixtures.test.ts`, which both suites read.

test("revokeFromEachPhaseTest: every non-terminal revokes, settles, and opens no desk task", () => {
  const live = [jDraft, jPend, jWork, jEval, jLand, jGated];
  const desk = [jEsc, jParkPre, jParkDep];
  for (const j of [...live, ...desk]) {
    const d = revokeOne(j);
    assert.equal(d.rec.label, "ticket-revoked", `from ${j.phase}`);
    assert.deepEqual(d.rec.transitions, [
      { ticket: 1, from: j.phase, to: "PRevoked" },
    ]);
    // "Revoke" alone — no OpenHumanTask for the revoked ticket itself.
    assert.deepEqual(d.rec.effects, ["Revoke"]);
    const after = ticketAt(d.post, 1);
    // revokedShape: Revoked RUNS nothing, and opens NO human task —
    // revocation is the author's settled choice.
    assert.equal(after.phase, "PRevoked");
    assert.deepEqual(after.tasks, []);
    assert.equal(after.resumeAt, "RNone");
    assert.equal(after.reason, "RsNone");
    assert.ok(!hasOpenHumanTask(after));
    // accountsUntouched: revoke charges no gas and spends no budget in either
    // direction.
    assert.deepEqual(
      [after.gasLeft, after.reworkLeft, after.wrapUpLeft],
      [j.gasLeft, j.reworkLeft, j.wrapUpLeft],
      `revoke moved an account from ${j.phase}`,
    );
    assert.equal(after.completions, 0);
  }
  // The model's ninth conjunct: revoking the gate's occupant frees the slot by
  // PHASE ALONE — occupancy is derived, so there is no cleanup step to forget.
  assert.ok(leaseFreeIn(revokeOne(jGated).post, 1));
});

test("revokeRetainsRecordTest: the record survives the author's settlement", () => {
  // A mid-flight revoke force-closes the still-running tasks as TCancelled;
  // already-resolved outcomes are preserved unchanged.
  assert.deepEqual(ticketAt(revokeOne(jWork).post, 1).record, [
    wt(1, "TCancelled"),
    wt(2, "TCancelled"),
  ]);
  assert.deepEqual(ticketAt(revokeOne(jEval).post, 1).record, [
    et(1, 0, "TPassed"),
    et(2, 0, "TFailed"),
  ]);
  assert.deepEqual(ticketAt(revokeOne(jDraft).post, 1).record, []); // never ran
});

test("revokeMeasureClassifiedTest: strict descent from every live rank, exactly flat from the desk", () => {
  const mOne = (j: Ticket): number => ticketMeasure(bB, j);
  const mAfter = (j: Ticket): number =>
    ticketMeasure(bB, ticketAt(revokeOne(j).post, 1));
  for (const j of [jDraft, jPend, jWork, jEval, jLand, jGated]) {
    assert.ok(mAfter(j) < mOne(j), `revoke from ${j.phase} does not descend`);
  }
  for (const j of [jEsc, jParkPre, jParkDep]) {
    assert.equal(
      mAfter(j),
      mOne(j),
      `the desk-only revoke is not flat for reason ${j.reason}`,
    );
  }
});

test("revocableExactlyNonTerminalTest: the absorbing terminals are exactly the unrevocable phases", () => {
  assert.ok(revocableIn(solo(jDraft), 1));
  assert.ok(revocableIn(solo(jEsc), 1));
  // The Done case AT c8, which is where the model reads it: a ticket that
  // landed through the pipeline is beyond revoke's reach. s2a pinned the same
  // phase from the model's own hand-built Done fixture, which is kept — a
  // hand-built PDone and a landed one must answer the same, and only the pair
  // says so.
  assert.ok(!revocableIn(c8, 1));
  assert.ok(!revocableIn(solo(jDone), 1));
  assert.ok(!revocableIn(revokeOne(jDraft).post, 1)); // Revoked
  assert.throws(() => decideRevoke(solo(jDone), 1), AssertionError);
  assert.throws(() => decideRevoke(c8, 1), AssertionError);
});

test("revokedNeverCompletesTest: revoking a ticket ON the landing strip emits no completion effect", () => {
  assert.equal(ticketAt(revokeOne(jLand).post, 1).completions, 0);
  assert.deepEqual(revokeOne(jLand).rec.effects, ["Revoke"]);
  // Its contrast, and what makes the zero above a claim rather than a default:
  // the landed ticket's counter is 1.
  assert.equal(ticketAt(c8, 1).completions, 1);
});

// === THE CASCADE, end-to-end on a 3-ticket chain ============================
// 1 <- 2 <- 3: ticket 1 released, ticket 2 released behind it, ticket 3 still a
// Draft behind 2.

const cChain: Core = core([
  [1, { ...draft(cfgBudgeted), phase: "PPending" }],
  [2, { ...draft(cfgBudgeted, progU2, 1, 1, new Set([1])), phase: "PPending" }],
  [3, draft(cfgBudgeted, progU2, 1, 1, new Set([2]))],
]);
const dCascade = decideRevoke(cChain, 1);
const cParked = dCascade.post;

test("cascadeEndToEndTest: one atomic decision settles the ticket and parks both transitive dependents", () => {
  assert.equal(dCascade.rec.label, "ticket-revoked");
  // One StepRecord, ascending: the revoke then both parks — atomic.
  assert.deepEqual(dCascade.rec.transitions, [
    { ticket: 1, from: "PPending", to: "PRevoked" },
    { ticket: 2, from: "PPending", to: "PEscalated" },
    { ticket: 3, from: "PDraft", to: "PEscalated" },
  ]);
  // A desk task per parked dependent; NONE for the revoked ticket.
  assert.deepEqual(dCascade.rec.effects, [
    "Revoke",
    "OpenHumanTask",
    "OpenHumanTask",
  ]);
  const settled = ticketAt(cParked, 1);
  assert.equal(settled.phase, "PRevoked");
  assert.ok(!hasOpenHumanTask(settled));
  for (const k of [2, 3]) {
    const dependent = ticketAt(cParked, k);
    assert.equal(dependent.phase, "PEscalated");
    assert.equal(dependent.reason, "RsDependencyRevoked");
    assert.equal(dependent.resumeAt, "RNone"); // no modeled resume: the exit is revoke
    assert.ok(hasOpenHumanTask(dependent));
    // The cascade spends nothing on anyone.
    const before = ticketAt(cChain, k);
    assert.deepEqual(
      [dependent.gasLeft, dependent.reworkLeft, dependent.wrapUpLeft],
      [before.gasLeft, before.reworkLeft, before.wrapUpLeft],
    );
  }
  // And the whole step strictly descends (three ranks fall to 0).
  assert.ok(mB(cParked) < mB(cChain));
});

test("cascadeSettleByRevokeTest: a human settles a parked dependent by revoking it", () => {
  // The parked dependents' walls resolve by REVOKE, not retry: no modeled
  // resume exists behind a revoked dependency (deps are immutable), while the
  // revalidation wall stays retryable. That contrast is the whole reason the
  // settlement below is the only exit.
  assert.ok(!retryableIn(cfgBudgeted, cParked, 2));
  assert.ok(!retryableIn(cfgBudgeted, cParked, 3));
  assert.ok(retryableIn(cfgBudgeted, dPark.post, 1));
  const dSettle2 = decideRevoke(cParked, 2);
  assert.deepEqual(dSettle2.rec.transitions, [
    { ticket: 2, from: "PEscalated", to: "PRevoked" },
  ]);
  assert.deepEqual(dSettle2.rec.effects, ["Revoke"]); // no re-park of already-parked 3
  assert.equal(mB(dSettle2.post), mB(cParked)); // desk revoke: flat, pinned
  assert.equal(ticketAt(dSettle2.post, 3).phase, "PEscalated"); // 3 untouched
  assert.ok(hasOpenHumanTask(ticketAt(dSettle2.post, 3)));
});

test("the cascade reaches a FAN-IN dependent: one doomed dep is enough", () => {
  // cChain is a straight line, and a straight line cannot tell "some dep is
  // doomed" from "every dep is doomed". This is the model's shape that can:
  // 1 <- 2, 3 independent, and 4 waiting on BOTH 2 and 3. Revoking 1 parks 2
  // (direct) and 4 (transitive, through one of its two deps) and leaves 3
  // alone — the model's own transitions and effects, read from it.
  const pending = (deps: ReadonlySet<number>): Ticket => ({
    ...draft(cfgBudgeted, progU2, 1, 1, deps),
    phase: "PPending",
  });
  const cFanIn: Core = core([
    [1, pending(new Set())],
    [2, pending(new Set([1]))],
    [3, pending(new Set())],
    [4, draft(cfgBudgeted, progU2, 1, 1, new Set([2, 3]))],
  ]);
  const d = decideRevoke(cFanIn, 1);
  assert.deepEqual(d.rec.transitions, [
    { ticket: 1, from: "PPending", to: "PRevoked" },
    { ticket: 2, from: "PPending", to: "PEscalated" },
    { ticket: 4, from: "PDraft", to: "PEscalated" },
  ]);
  assert.deepEqual(d.rec.effects, ["Revoke", "OpenHumanTask", "OpenHumanTask"]);
  assert.equal(ticketAt(d.post, 4).reason, "RsDependencyRevoked");
  // The undoomed sibling is untouched — no phase, no reason, no desk task.
  assert.deepEqual(ticketAt(d.post, 3), ticketAt(cFanIn, 3));
});

test("the cascade parks the PRE-FLIGHT dependents and only those", () => {
  // The model's filter is `PDraft or PPending`, and its header argues the two
  // are exhaustive on reachable states — a transitive dependent of a
  // non-Done ticket can never have dispatched. The decider is still total over
  // the state that argument excludes, so this pins what it does there: a
  // mid-flight dependent is NOT parked, its live tasks are NOT retired, and no
  // desk task opens for it. Read from the model.
  const cMidFlight: Core = core([
    [1, { ...draft(cfgBudgeted), phase: "PPending" }],
    [
      2,
      {
        ...draft(cfgBudgeted, progU2, 1, 1, new Set([1])),
        phase: "PWorking",
        tasks: [wr(1), wr(2)],
        spawned: 2,
      },
    ],
    [3, draft(cfgBudgeted, progU2, 1, 1, new Set([2]))],
  ]);
  const d = decideRevoke(cMidFlight, 1);
  // THE FILTER AND THE BREADTH ARE DIFFERENT CLAIMS, and ticket 3 is what
  // separates them: the doom set reaches it THROUGH the mid-flight ticket,
  // which is doomed and unparked. A filter that also parked ticket 2 would
  // fail the first assertion; a doom set that stopped at the unparked ticket
  // would fail the second.
  assert.deepEqual(d.rec.transitions, [
    { ticket: 1, from: "PPending", to: "PRevoked" },
    { ticket: 3, from: "PDraft", to: "PEscalated" },
  ]);
  assert.deepEqual(d.rec.effects, ["Revoke", "OpenHumanTask"]);
  assert.deepEqual(ticketAt(d.post, 2), ticketAt(cMidFlight, 2));
  assert.equal(ticketAt(d.post, 3).reason, "RsDependencyRevoked");
});

test("dependableIn: an arrival may not depend on a tombstone", () => {
  // Read from the model: every live ticket is dependable before the cascade,
  // and none of the three is after it (the revoked ticket and both
  // cascade-parked dependents are exactly the transitively-doomed set).
  assert.deepEqual(dependableIn(cA2), new Set([1, 2]));
  assert.deepEqual(dependableIn(cParked), new Set());
  assert.deepEqual(dependableIn(solo(jParkPre)), new Set([1])); // a park with a resume is fine
  // Both tombstone flavors refuse an arrival that names them. One ticket per
  // fixture, because two would hit the arrival bound first and prove nothing.
  for (const [what, tombstone] of [
    ["revoked", ticketAt(cParked, 1)],
    ["cascade-parked", ticketAt(cParked, 2)],
  ] as const) {
    assert.throws(
      () =>
        decideArrive(
          cfgBudgeted,
          solo(tombstone),
          new Set([1]),
          defaultProgram(cfgBudgeted),
          1,
          wx1,
        ),
      AssertionError,
      `an arrival depended on a ${what} ticket`,
    );
  }
});

// === THE WRAP-UP: the depth-1 gate ==========================================

/** Project 1's slot held, one more project-1 ticket enqueued behind it, and one on project 2. */
const cGateOcc: Core = core([
  [1, { ...draft(cfgBudgeted), phase: "PWrapUpHolding" }],
  [2, { ...draft(cfgBudgeted), phase: "PWrapUp" }],
  [3, { ...draft(cfgBudgeted, progU2, 2, 2), phase: "PWrapUp" }],
]);

test("leaseExclusiveGuardTest: an occupied gate refuses every SAME-project dequeue", () => {
  assert.ok(!leaseFreeIn(cGateOcc, 1));
  assert.ok(leaseFreeIn(cGateOcc, 2));
  assert.ok(!wrapUpStartableIn(cGateOcc, 2)); // same project: REFUSED — depth 1
  assert.ok(wrapUpStartableIn(cGateOcc, 3)); // other project: independent
  assert.ok(!wrapUpStartableIn(cGateOcc, 1)); // the occupant is not enqueued
  assert.deepEqual(wrapUpStartablesIn(cGateOcc), new Set([3]));
  // Once the slot frees — here the occupant lands, gated — the refusal lifts
  // in the SAME post-state: occupancy is phase, and nothing cleans up.
  const landed = decideWrapUpResolve(cfgBudgeted, cGateOcc, 1, "WOk", true);
  assert.ok(wrapUpStartableIn(landed.post, 2));
  assert.deepEqual(wrapUpStartablesIn(landed.post), new Set([2, 3]));
  // And the refusal is not advice: the dequeue asserts the guard it names.
  assert.throws(() => decideWrapUpStart(cGateOcc, 2), AssertionError);
  assert.throws(
    () => decideDequeue(cfgBudgeted, cGateOcc, 2, false),
    AssertionError,
  );
});

/**
 * THE LEASE IS ON THE RESOURCE, NOT ON THE TICKET'S PROJECT, and this is the
 * fleet that can tell them apart: the holder is project 1 / resource 2, the
 * queue head is project 2 / resource 1, so `leaseOf` and `project` disagree on
 * BOTH ends. Every other gate fixture in this suite and in the model's authors
 * `WExclusive(project)`, where a guard reading the ticket's project agrees with
 * one reading its resource on every state — the model's own `leaseExclusive`
 * comment names that narrowing, and says it in the word this rename KEPT ("the
 * resource is whatever the wrap-up kind names, never a repo by definition: a
 * per-repo merge queue is one instance of this lease"), because renaming the
 * resource would assert the identification the sentence exists to deny. Reading
 * the general form off that one instance is how it gets lost.
 */
const cCrossKind: Core = core([
  [1, { ...draft(cfgBudgeted, progU2, 1, 2), phase: "PWrapUpHolding" }],
  [2, { ...draft(cfgBudgeted, progU2, 2, 1), phase: "PWrapUp" }],
  [3, { ...draft(cfgBudgeted, progU2, 1, 2), phase: "PWrapUp" }],
]);

test("the dequeue guard asks about the RESOURCE its kind names, not the project", () => {
  // Read from the model: the queue head whose resource is free is startable and
  // the one whose resource is held is not — which is the exact reverse of what
  // a project-reading guard answers on this fleet.
  assert.deepEqual(wrapUpStartablesIn(cCrossKind), new Set([2]));
  assert.ok(wrapUpStartableIn(cCrossKind, 2));
  assert.ok(!wrapUpStartableIn(cCrossKind, 3));
  assert.deepEqual(
    new Set([0, 1, 2, 3].filter((r) => !leaseFreeIn(cCrossKind, r))),
    new Set([2]),
  );
  // The projects and the resources really do disagree, so the sets above cannot
  // agree by accident.
  assert.deepEqual(
    [...cCrossKind.tickets.values()].map((jb) => [jb.project, leaseOf(jb)]),
    [
      [1, 2],
      [2, 1],
      [1, 2],
    ],
  );
  // And both decider sites that consume the guard read it the same way.
  assert.equal(
    ticketAt(decideWrapUpStart(cCrossKind, 2).post, 2).phase,
    "PWrapUpHolding",
  );
  assert.throws(() => decideWrapUpStart(cCrossKind, 3), AssertionError);
  assert.equal(
    ticketAt(decideDequeue(cfgBudgeted, cCrossKind, 2, false).post, 2).phase,
    "PDone",
  );
  assert.throws(
    () => decideDequeue(cfgBudgeted, cCrossKind, 3, false),
    AssertionError,
  );
});

// === PROJECT ISOLATION at the landing boundary ==============================

/** A quiet-dequeue fixture: PWrapUp — the queue the fast-path resolves off. */
const cQueueB: Core = solo({
  ...draft(cfgBudgeted),
  phase: "PWrapUp",
  wrapUpLeft: 1,
  gasLeft: 2,
});

/** The same single-ticket fixture, re-targeted at project 2 — the only difference. */
function onProject2(c: Core): Core {
  return solo({ ...ticketAt(c, 1), project: 2 });
}

test("wrapUpOutcomesDrawRuleTest: the SET is the refusal", () => {
  assert.deepEqual(wrapUpOutcomes(false), new Set(["WOk"]));
  assert.deepEqual(wrapUpOutcomes(true), new Set(["WOk", "WFailed"]));
  // The load-bearing refusal: a valid artifact has no failure to draw.
  assert.ok(!wrapUpOutcomes(false).has("WFailed"));
  // And an invalidated one is not FORCED to fail — re-validation may pass.
  assert.ok(wrapUpOutcomes(true).has("WOk"));
  assert.deepEqual(projects(cfgBudgeted), new Set([1, 2]));
  // The refusal is durable at the decider, not merely stated by the set: the
  // one combination the draw rule forbids cannot be resolved.
  assert.throws(
    () => decideWrapUpResolve(cfgBudgeted, cQueueB, 1, "WFailed", false),
    AssertionError,
  );
});

test("landingAttributionStampsOwnProjectTest: EVERY arm stamps the attempt's own project", () => {
  // Project 2 throughout, so a constant-stamping mutant would say 1. The combos
  // are the PATH-legal ones only: quiet+WOk off the queue, moved+WOk/WFailed
  // out of the lease.
  const attempt = (project: number, invalidated: boolean) => ({
    tag: "WOAttempt" as const,
    project,
    invalidated,
  });
  const quietOk = decideWrapUpResolve(
    cfgBudgeted,
    onProject2(cQueueB),
    1,
    "WOk",
    false,
  );
  assert.deepEqual(quietOk.rec.landing, attempt(2, false));
  assert.deepEqual(quietOk.rec.effects, ["Complete"]);
  // Success under a MOVED branch is drawable and honestly attributed: the move
  // makes failure POSSIBLE, never certain.
  const movedOk = decideWrapUpResolve(
    cfgBudgeted,
    onProject2(cGateB),
    1,
    "WOk",
    true,
  );
  assert.deepEqual(movedOk.rec.landing, attempt(2, true));
  assert.deepEqual(movedOk.rec.effects, ["Complete"]);
  // Failure: the wrap-up rework carries the project AND the cause.
  const reworked = decideWrapUpResolve(
    cfgBudgeted,
    onProject2(cGateB),
    1,
    "WFailed",
    true,
  );
  assert.equal(reworked.rec.label, "rework-started wrapup_failure");
  assert.deepEqual(reworked.rec.landing, attempt(2, true));
  // Both landing walls carry it too — the attempt that PARKED the ticket is
  // attributable like the one that reworked it, and the gas wall is the one
  // `wrapUpIsolation`'s completeness cannot reach (it shares its label with
  // the eval side), so a stamp-drop there is visible only here.
  const budgetWall = decideWrapUpResolve(
    cfgBudgeted,
    onProject2(cGateWall),
    1,
    "WFailed",
    true,
  );
  assert.equal(
    budgetWall.rec.label,
    "ticket-escalated wrapup_budget_exhausted",
  );
  assert.deepEqual(budgetWall.rec.landing, attempt(2, true));
  const gasWall = decideWrapUpResolve(
    cfgBudgeted,
    onProject2(cGateGasWall),
    1,
    "WFailed",
    true,
  );
  assert.deepEqual(gasWall.rec.landing, attempt(2, true));
  // DeadlineOnly's landing gas wall attributes the same way, on project 1.
  const deadlineWall = decideWrapUpResolve(
    cfgDeadlineOnly,
    cGateDWall,
    1,
    "WFailed",
    true,
  );
  assert.deepEqual(deadlineWall.rec.landing, attempt(1, true));
});

test("oneProjectDegenerationTest: the collapsed universe and the intact draw rule", () => {
  // The model states the draw rule per instance (`DO::wrapUpOutcomes`) because
  // Quint gives every instance its own copy; here the rule reads no config at
  // all, so the two conjuncts below are the whole instance's answer and the
  // degeneration is in `projects` alone.
  assert.deepEqual(projects(cfgDO), new Set([1]));
  assert.deepEqual(wrapUpOutcomes(false), new Set(["WOk"]));
  assert.deepEqual(wrapUpOutcomes(true), new Set(["WOk", "WFailed"]));
  // And the collapse reaches the lease: at one project every authorable exclusive
  // kind names resource 1, so the gate is the single-project machine's.
  const soleKind = wrapUpChoices(cfgDO);
  assert.deepEqual(soleKind, [{ tag: "WNone" }, wx1]);
  assert.deepEqual(
    soleKind.map((w) => leaseOf({ ...draft(cfgDO), wrapUp: w })),
    [noResource, 1],
  );
});

// === The derived waiting room and the enablement sets =======================

const cXDepPre: Core = core([
  [1, { ...draft(cfgBudgeted), phase: "PWrapUp" }],
  [2, { ...draft(cfgBudgeted, progU2, 2, 2, new Set([1])), phase: "PPending" }],
]);
const cXDepDone: Core = core([
  [1, { ...draft(cfgBudgeted), phase: "PDone", completions: 1 }],
  [2, { ...draft(cfgBudgeted, progU2, 2, 2, new Set([1])), phase: "PPending" }],
]);

test("crossProjectDepGateLocationBlindTest: the dep gate reads Done-ness, never location", () => {
  assert.ok(isBlockedIn(cXDepPre, 2));
  assert.ok(!isReadyIn(cXDepPre, 2));
  assert.ok(isReadyIn(cXDepDone, 2));
  assert.ok(!isBlockedIn(cXDepDone, 2));
  // The projects are genuinely different, so a location-reading gate would fail
  // above rather than agreeing by accident.
  assert.equal(ticketAt(cXDepDone, 1).project, 1);
  assert.equal(ticketAt(cXDepDone, 2).project, 2);
});

test("a ticket waiting on MIXED dependencies is Blocked: every dep, not some dep", () => {
  // No fixture in the model's suite has a ticket whose deps disagree, and a
  // uniform dep set cannot tell `forall` from `exists`. This one can: dep 1 is
  // Done, dep 2 is Pending. Read from the model — depsDoneIn false, isReadyIn
  // false, isBlockedIn true, and the ready room holds the DEP, not the
  // dependent.
  const cMixedDeps: Core = core([
    [1, jDone],
    [2, { ...draft(cfgBudgeted), phase: "PPending" }],
    [
      3,
      {
        ...draft(cfgBudgeted, progU2, 1, 1, new Set([1, 2])),
        phase: "PPending",
      },
    ],
  ]);
  assert.equal(depsDoneIn(cMixedDeps, 3), false);
  assert.equal(isReadyIn(cMixedDeps, 3), false);
  assert.equal(isBlockedIn(cMixedDeps, 3), true);
  assert.deepEqual(readiesIn(cMixedDeps), new Set([2]));
  assert.throws(
    () => decideDispatch(cfgBudgeted, cMixedDeps, 3),
    AssertionError,
  );
});

test("Ready, Blocked and releasable are each inside ONE phase, not outside another", () => {
  // Every predicate below is an equality on its phase in the model, and a
  // loosened inequality would agree with it on the fixtures that have only two
  // phases in play. These are the states that tell them apart; every value was
  // read from the model.
  //
  // A terminal is not Ready, however finished its (absent) dependencies are:
  assert.deepEqual(readiesIn(cXDepDone), new Set([2]));
  assert.equal(isReadyIn(cXDepDone, 1), false);
  // A Draft is neither Ready nor Blocked — the waiting room is inside Pending:
  assert.equal(isReadyIn(cA2, 2), false);
  assert.equal(isBlockedIn(cA2, 2), false);
  // Releasable is Draft, not merely not-Pending: ticket 1 is Working at c1.
  assert.deepEqual(draftsIn(c1), new Set([2]));
  // A held gate slot is not a task phase, however much it looks like one:
  assert.deepEqual(
    taskPhaseIn(
      core([
        [1, jGated],
        [2, jWork],
      ]),
    ),
    new Set([2]),
  );
  assert.deepEqual(taskPhaseIn(solo(jEval)), new Set([1]));
  // And the work reduce is Working's, not any fully-resolved phase's: jEval is
  // fully resolved and Evaluating, which is the EVAL reduce's business, not
  // this one's.
  assert.deepEqual(reducibleWorkIn(solo(jEval)), new Set());
  assert.throws(() => decideWorkReduce(solo(jEval), 1), AssertionError);
});

test("waitsOn and depsDoneIn: one definition of what a ticket waits on", () => {
  assert.deepEqual(waitsOn(cA2, 2), new Set([1]));
  assert.deepEqual(waitsOn(cA2, 1), new Set());
  assert.equal(depsDoneIn(cRel2, 2), false); // read from the model
  assert.equal(depsDoneIn(cXDepDone, 2), true);
  assert.equal(depsDoneIn(cXDepDone, 1), true); // no deps: vacuously done
});

test("depArtifacts: what this ticket's dependencies produced, derived and set-valued", () => {
  // At c4 the dep has passed work, so its mark is stamped: the model answers
  // Set(ASome(2)) here.
  assert.deepEqual(depArtifacts(c4, 2), [{ tag: "ASome", id: 2 }]);
  assert.deepEqual(depArtifacts(cA2, 2), [{ tag: "ANone" }]);
  assert.deepEqual(depArtifacts(cA2, 1), []);
  // THE ORDER IS THE SET'S, NOT THE DEPENDENCIES'. Two Cores whose model
  // answers are the same set — same marks, different deps producing them —
  // must answer with the same array here, or a future consumer compares two
  // equal sets and disagrees with the model — no decider reads `depArtifacts`
  // yet, which is why this is pinned now rather than when one does. Read from
  // the model: both are
  // `Set(ASome(2), ASome(5))`, and the model calls them `==`.
  const withMark = (id: number): Ticket => ({
    ...jDone,
    artifact: { tag: "ASome", id },
  });
  const dependent: Ticket = {
    ...draft(cfgBudgeted, progU2, 1, 1, new Set([1, 2])),
    phase: "PPending",
  };
  const marksAB: Core = core([
    [1, withMark(5)],
    [2, withMark(2)],
    [3, dependent],
  ]);
  const marksBA: Core = core([
    [1, withMark(2)],
    [2, withMark(5)],
    [3, dependent],
  ]);
  assert.deepEqual(depArtifacts(marksAB, 3), depArtifacts(marksBA, 3));
  assert.deepEqual(depArtifacts(marksAB, 3), [
    { tag: "ASome", id: 2 },
    { tag: "ASome", id: 5 },
  ]);
  // The order is LEXICOGRAPHIC ON THE KEY, which is not numeric order on the
  // mark, and this is the case where the two visibly disagree: `ASome:10`
  // sorts before `ASome:2`. Deliberate — canonicity needs the order to be a
  // function of the set's contents, and it does not need to be pretty. The
  // model's answer is the SET `Set(ASome(2), ASome(10))`, which is the same
  // set either way.
  const marksWide: Core = core([
    [1, withMark(10)],
    [2, withMark(2)],
    [3, dependent],
  ]);
  assert.deepEqual(depArtifacts(marksWide, 3), [
    { tag: "ASome", id: 10 },
    { tag: "ASome", id: 2 },
  ]);
  // Two dependencies carrying the SAME mark collapse to one element, because
  // the model's read is a set-valued map. Read from the model: Set(ANone).
  const cTwoDeps: Core = core([
    [1, jDone],
    [2, jDone],
    [
      3,
      {
        ...draft(cfgBudgeted, progU2, 1, 1, new Set([1, 2])),
        phase: "PPending",
      },
    ],
  ]);
  const marks: readonly ArtifactMark[] = depArtifacts(cTwoDeps, 3);
  assert.deepEqual(marks, [{ tag: "ANone" }]);
  assert.ok(isReadyIn(cTwoDeps, 3));
});

test("the enablement sets are the model's, on the model's fixtures", () => {
  // Every value below was read out of chuggy_domain in the REPL against the
  // same fixture. Each set is `keys().filter(<its predicate>)`, so a predicate
  // that drifts moves its set here.
  assert.deepEqual(draftsIn(cA2), new Set([1, 2]));
  assert.deepEqual(draftsIn(c0), new Set([2]));
  assert.deepEqual(revocablesIn(cChain), new Set([1, 2, 3]));
  assert.deepEqual(revocablesIn(core([[1, jDone]])), new Set());
  assert.deepEqual(readiesIn(c0), new Set([1]));
  assert.deepEqual(readiesIn(cRel2), new Set());
  assert.deepEqual(taskPhaseIn(c0), new Set());
  assert.deepEqual(taskPhaseIn(c1), new Set([1])); // Working
  assert.deepEqual(taskPhaseIn(c4), new Set([1])); // Evaluating
  assert.deepEqual(reducibleWorkIn(c1), new Set()); // two tasks still running
  assert.deepEqual(reducibleWorkIn(c2), new Set()); // one still running
  assert.deepEqual(reducibleWorkIn(c3), new Set([1])); // fully resolved
  assert.deepEqual(reducibleWorkIn(cWorkFail), new Set([1])); // resolved, not passed
  assert.deepEqual(reducibleWorkIn(c4), new Set()); // Evaluating is not Working
  // The reduce is enabled by that set and by nothing else: a Working ticket
  // mid-flight has a decision to make about its tasks, not about its phase.
  assert.throws(() => decideWorkReduce(c1, 1), AssertionError);
  assert.throws(() => decideWorkReduce(c4, 1), AssertionError);
});

test("the eval, gate and desk sets are the model's, along the model's own path", () => {
  // The same treatment for the other eight, on the chain the model builds
  // rather than on a fixture minted for them. Every value read out of
  // chuggy_domain in the REPL against the same state.
  assert.deepEqual(reducibleEvalIn(c4), new Set()); // two eval tasks running
  assert.deepEqual(reducibleEvalIn(c5), new Set()); // one still running
  assert.deepEqual(reducibleEvalIn(c6), new Set([1])); // fully resolved
  assert.deepEqual(reducibleEvalIn(c3), new Set()); // Working is not Evaluating
  assert.deepEqual(reducibleEvalIn(c7), new Set()); // and neither is the queue
  assert.throws(
    () => decideEvalStageReduce(cfgBudgeted, c4, 1),
    AssertionError,
  );
  assert.throws(
    () => decideEvalStageReduce(cfgBudgeted, c3, 1),
    AssertionError,
  );
  // The queue, the slot and the terminal, along the same path.
  assert.deepEqual(wrapUpStartablesIn(c7), new Set([1]));
  assert.deepEqual(wrapUpStartablesIn(cGated7), new Set()); // it holds the slot
  assert.deepEqual(holdingIn(c7), new Set());
  assert.deepEqual(holdingIn(cGated7), new Set([1]));
  assert.deepEqual(doneIn(c7), new Set());
  assert.deepEqual(doneIn(c8), new Set([1]));
  // The desk, on the model's own park.
  assert.deepEqual(retryablesIn(cfgBudgeted, dPark.post), new Set([1]));
  assert.deepEqual(retryablesIn(cfgBudgeted, cParked), new Set());
});

// === Every phase, at once ===================================================
// THE GUARD-PINNING RULE THIS SUITE LEAVES BEHIND: a guard that is an EQUALITY
// over the nine phases is pinned by an EXACT SET over its whole domain, never
// by counter-examples. A counter-example excludes one wrong phase; the guard
// has eight wrong phases, and round 1 shipped a fixture per guard that
// excluded exactly one of them — after which four widenings still survived on
// states the suite already held. One Core with one ticket per phase, and the
// set the guard answers with, closes all eight at once and stays closed when a
// tenth phase arrives.

/** One ticket per phase, no dependencies: the enablement sets' whole domain. */
const cAllPhases: Core = core([
  [1, draft(cfgBudgeted)],
  [2, { ...draft(cfgBudgeted), phase: "PPending" }],
  [
    3,
    {
      ...draft(cfgBudgeted),
      phase: "PWorking",
      tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
      spawned: 2,
    },
  ],
  [
    4,
    {
      ...draft(cfgBudgeted),
      phase: "PEvaluating",
      tasks: mixedE0,
      spawned: 2,
    },
  ],
  [5, { ...draft(cfgBudgeted), phase: "PWrapUp" }],
  [6, { ...draft(cfgBudgeted), phase: "PWrapUpHolding" }],
  [7, { ...draft(cfgBudgeted), phase: "PDone", completions: 1 }],
  [
    8,
    {
      ...draft(cfgBudgeted),
      phase: "PEscalated",
      reason: "RsDependencyRevoked",
    },
  ],
  [9, { ...draft(cfgBudgeted), phase: "PRevoked" }],
]);

test("every phase-shaped guard, as an EXACT SET over all nine phases", () => {
  // Ids are the phase ladder in order: 1 Draft, 2 Pending, 3 Working,
  // 4 Evaluating, 5 WrapUp, 6 WrapUpHolding, 7 Done, 8 Escalated (the cascade
  // wall), 9 Revoked. Tickets 3 and 4 carry FULLY RESOLVED sets, so the two
  // reduce-shaped guards are separated by their phase conjunct alone. Every
  // set below was read out of the model against this same Core.
  assert.deepEqual(draftsIn(cAllPhases), new Set([1]));
  assert.deepEqual(readiesIn(cAllPhases), new Set([2]));
  assert.deepEqual(taskPhaseIn(cAllPhases), new Set([3, 4]));
  assert.deepEqual(reducibleWorkIn(cAllPhases), new Set([3]));
  assert.deepEqual(revocablesIn(cAllPhases), new Set([1, 2, 3, 4, 5, 6, 8]));
  assert.deepEqual(dependableIn(cAllPhases), new Set([1, 2, 3, 4, 5, 6, 7]));
  // The three per-ticket predicates, as the same kind of exact set.
  const where = (p: (j: number) => boolean): ReadonlySet<number> =>
    new Set([...cAllPhases.tickets.keys()].filter(p));
  assert.deepEqual(
    where((j) => isReadyIn(cAllPhases, j)),
    new Set([2]),
  );
  assert.deepEqual(
    where((j) => isBlockedIn(cAllPhases, j)),
    new Set(),
  );
  assert.deepEqual(
    where((j) => dispatchableIn(cAllPhases, j)),
    new Set([2]),
  );
  assert.deepEqual(
    where((j) => revocableIn(cAllPhases, j)),
    new Set([1, 2, 3, 4, 5, 6, 8]),
  );
  // The eval, gate and desk guards, over the same nine. Every ticket here
  // authors `WExclusive(1)`, so ticket 6 holds project 1's slot and the enqueued
  // ticket 5 is refused by the depth-1 rule — which is why `wrapUpStartablesIn`
  // is EMPTY rather than {5}, and why the fleet below exists to separate the
  // phase conjunct from the lease conjunct.
  assert.deepEqual(reducibleEvalIn(cAllPhases), new Set([4]));
  assert.deepEqual(holdingIn(cAllPhases), new Set([6]));
  assert.deepEqual(doneIn(cAllPhases), new Set([7]));
  assert.deepEqual(wrapUpStartablesIn(cAllPhases), new Set());
  // Ticket 8 is the cascade wall, whose `resumeAt` is `RNone`: no ticket here
  // has a modeled resume, so the desk set is empty for a reason that is about
  // the resume and not about the phase. `cAllResumable` is the transposition.
  assert.deepEqual(retryablesIn(cfgBudgeted, cAllPhases), new Set());
});

/**
 * `cAllPhases` with the gate's occupant holding the OTHER resource, which
 * separates the two conjuncts of `wrapUpStartableIn` and both ends of
 * `leaseFreeIn`.
 *
 * `leaseFreeIn` is a RELATION over resources AND phases, so the exact-set rule's
 * transposition applies: one exact set over the resources, one over the phases.
 * Here the phase end is answered by a single value — every one of the nine
 * tickets authors resource 1, so `leaseFreeIn(·, 1)` being TRUE says that none
 * of the eight non-holding phases occupies anything, all eight at once.
 */
const cGateElsewhere: Core = core([
  ...cAllPhases.tickets,
  [6, { ...ticketAt(cAllPhases, 6), wrapUp: wx2 }],
]);

test("the lease is a relation over resources AND phases, pinned at both ends", () => {
  // THE RESOURCE END, as the exact set of held resources over a domain that
  // includes both the `leaseOf` answer for a kind that needs none (0) and a
  // resource outside the universe (3). Read from the model.
  const heldIn = (c: Core): ReadonlySet<number> =>
    new Set([0, 1, 2, 3].filter((r) => !leaseFreeIn(c, r)));
  assert.deepEqual(heldIn(cAllPhases), new Set([1]));
  assert.deepEqual(heldIn(cGateElsewhere), new Set([2]));
  assert.deepEqual(heldIn(cGateOcc), new Set([1]));
  // THE PHASE END: of the nine phases, exactly one occupies its resource. Each
  // ticket is asked alone, so the answer is its phase's and nothing else's.
  const occupiers = new Set(
    [...cAllPhases.tickets.keys()].filter(
      (j) => !leaseFreeIn(solo(ticketAt(cAllPhases, j)), 1),
    ),
  );
  assert.deepEqual(occupiers, new Set([6]));
  // And what the two ends buy: with the slot taken by the other project, the
  // enqueued ticket is startable again — the dequeue guard's phase conjunct,
  // now visible on its own.
  assert.ok(leaseFreeIn(cGateElsewhere, 1));
  assert.ok(!leaseFreeIn(cGateElsewhere, 2));
  assert.deepEqual(wrapUpStartablesIn(cGateElsewhere), new Set([5]));
  // `leaseOf` over its whole domain, and the property the model's `0` rests
  // on: no resource universe contains it.
  assert.equal(
    leaseOf({ ...draft(cfgBudgeted), wrapUp: { tag: "WNone" } }),
    noResource,
  );
  assert.equal(leaseOf({ ...draft(cfgBudgeted), wrapUp: wx1 }), 1);
  assert.equal(leaseOf({ ...draft(cfgBudgeted), wrapUp: wx2 }), 2);
  // THE PROPERTY IS THE FLOOR, NOT MEMBERSHIP AT ONE INSTANCE: a value merely
  // outside DB's universe (3, say) is a real resource at `nProjects = 3`, which
  // `configAdmitsInit` admits. What holds at every admissible instance is that
  // the kindless answer sits below the universe's first id.
  assert.ok(noResource < firstProjectId);
  assert.ok(!projects(cfgBudgeted).has(noResource));
  assert.ok(!projects({ ...cfgBudgeted, nProjects: 9 }).has(noResource));
  // ONE WIDENING IN THIS FAMILY IS EQUIVALENT, and is recorded rather than
  // hunted: admitting `PWrapUpHolding` into `wrapUpStartableIn`'s phase
  // conjunct changes no answer, because a holding ticket holds its own
  // resource — `leaseFreeIn(c, leaseOf(jb))` is false for it by the definition
  // above, whatever its kind, so the widened set gains no member. The
  // conclusion is checkable even though the mutant is not: no occupant is ever
  // startable.
  for (const j of holdingIn(cGateOcc)) {
    assert.ok(!wrapUpStartableIn(cGateOcc, j));
  }
});

/**
 * `cAllPhases` with EVERY ticket carrying an affordable pipeline resume.
 *
 * `retryableIn` is a relation too — over the phase, the resume point and the
 * gas — and `cAllPhases` pins only the resume end, because no ticket there has
 * a resume at all. This fleet varies the phase with the resume held fixed, so
 * the set IS the phase test. The states are unreachable (`deskConsistent`
 * forbids a resume point outside the desk) and the predicate is total over
 * them, exactly as `cAllPhases`'s own mid-flight tickets are.
 */
const cAllResumable: Core = core(
  [...cAllPhases.tickets].map(([j, jb]): readonly [number, Ticket] => [
    j,
    { ...jb, resumeAt: "RWorking", reason: "RsWorkFailed", gasLeft: 2 },
  ]),
);

/** One parked ticket per Resume flavor, at a chosen gas balance. */
function resumeFleet(gasLeft: number): Core {
  return core(
    (["RNone", "RPending", "RWorking", "REvaluating", "RWrapUp"] as const).map(
      (resumeAt, i): readonly [number, Ticket] => [
        i + 1,
        {
          ...draft(cfgBudgeted),
          phase: "PEscalated",
          resumeAt,
          reason: "RsWorkFailed",
          gasLeft,
        },
      ],
    ),
  );
}

test("retryable is a relation over the phase, the resume and the gas — all three pinned", () => {
  // THE PHASE END: only the parked ticket is retryable, however affordable the
  // resume the other eight carry. Read from the model.
  assert.deepEqual(retryablesIn(cfgBudgeted, cAllResumable), new Set([8]));
  // THE RESUME END, over all five flavors at a gas balance that affords every
  // one of them: everything but `RNone`, whose wall has no modeled resume.
  assert.deepEqual(
    retryablesIn(cfgBudgeted, resumeFleet(2)),
    new Set([2, 3, 4, 5]),
  );
  // THE GAS END, which is where the two meterings visibly differ. At zero gas
  // under the default charge only the pre-work resume (id 2) is affordable;
  // under RetryFree the pipeline resumes join it and the Working resume does
  // NOT, because entry to Working always meters.
  assert.deepEqual(retryablesIn(cfgBudgeted, resumeFleet(0)), new Set([2]));
  assert.deepEqual(retryablesIn(cfgDF, resumeFleet(0)), new Set([2, 4, 5]));
  assert.deepEqual(retryablesIn(cfgDF, resumeFleet(2)), new Set([2, 3, 4, 5]));
});

test("resumeCharge: the pricing table, both meterings, over every flavor", () => {
  // The model's table, read out of it. `RNone` is priced by the wildcard arm
  // it falls through — unreachable, and answered rather than refused, because
  // `decideOpRetry`'s guarded arm is what the model writes.
  const table = (cfg: Config): readonly number[] =>
    (["RNone", "RPending", "RWorking", "REvaluating", "RWrapUp"] as const).map(
      (at) => resumeCharge(cfg, at),
    );
  assert.deepEqual(table(cfgBudgeted), [1, 0, 1, 1, 1]);
  assert.deepEqual(table(cfgDF), [0, 0, 1, 0, 0]);
});

test("decideOpRetry's guarded-unreachable arm answers as the model writes it", () => {
  // The `dependency_revoked` wall: `retryableIn` refuses it at any gas, and the
  // decider — total, as in the model — absorbs the call as a labelled no-op
  // rather than moving anything. No machine step reaches it, because `opRetry`
  // draws from `retryablesIn`.
  for (const gasLeft of [0, 3]) {
    const cWall: Core = solo({ ...jParkDep, gasLeft });
    assert.ok(!retryableIn(cfgBudgeted, cWall, 1));
    assert.ok(!retryableIn(cfgDF, cWall, 1));
    const d = decideOpRetry(cfgBudgeted, cWall, 1);
    assert.equal(d.post, cWall); // state-identical, not merely state-equal
    assert.equal(d.rec.label, "operator-retry-unreachable");
    assert.deepEqual(d.rec.effects, []);
    assert.deepEqual(d.rec.transitions, []);
  }
  // What the guard DOES refuse: a park whose charging resume it cannot afford,
  // which would otherwise overdraw the gas account.
  const broke: Core = solo({ ...escLanding, gasLeft: 0 });
  assert.ok(!retryableIn(cfgBudgeted, broke, 1));
  assert.throws(() => decideOpRetry(cfgBudgeted, broke, 1), AssertionError);
  // Under the free metering the same park is affordable, and the same call
  // resumes it — the refusal above is the pricing's, not the phase's.
  assert.ok(retryableIn(cfgDF, broke, 1));
  assert.equal(
    ticketAt(decideOpRetry(cfgDF, broke, 1).post, 1).phase,
    "PWrapUp",
  );
});

/**
 * The same nine phases, each waiting on an unfinished Draft (id 1). Blocked is
 * the one guard whose SECOND conjunct hides the first: on a fleet with no
 * dependencies, `isBlockedIn` answers empty for every phase, so admitting a
 * wrong phase changes nothing and the exact set above proves nothing about it.
 * Here every ticket's deps are unfinished, so the set IS the phase test.
 */
const cBehindADraft: Core = core([
  [1, draft(cfgBudgeted)],
  ...(
    [
      "PDraft",
      "PPending",
      "PWorking",
      "PEvaluating",
      "PWrapUp",
      "PWrapUpHolding",
      "PDone",
      "PEscalated",
      "PRevoked",
    ] as const
  ).map((phase, i): readonly [number, Ticket] => [
    i + 2,
    { ...draft(cfgBudgeted, progU2, 1, 1, new Set([1])), phase },
  ]),
]);

test("Blocked is the Pending ones, over a fleet where everything waits", () => {
  // Read from the model: only the Pending ticket (id 3) is Blocked, nobody is
  // Ready, and the only ticket whose dependencies are done is the one with
  // none. A widened Blocked admits its phase's ticket here and nowhere else.
  const where = (p: (j: number) => boolean): ReadonlySet<number> =>
    new Set([...cBehindADraft.tickets.keys()].filter(p));
  assert.deepEqual(
    where((j) => isBlockedIn(cBehindADraft, j)),
    new Set([3]),
  );
  assert.deepEqual(
    where((j) => isReadyIn(cBehindADraft, j)),
    new Set(),
  );
  assert.deepEqual(
    where((j) => depsDoneIn(cBehindADraft, j)),
    new Set([1]),
  );
  assert.deepEqual(readiesIn(cBehindADraft), new Set());
  assert.deepEqual(draftsIn(cBehindADraft), new Set([1, 2]));
});

/**
 * The TRANSPOSE of `cBehindADraft`: `cAllPhases` with one Pending dependent
 * behind each of the nine phases (ids 10..18 waiting on 1..9 in order).
 *
 * `depsDoneIn` is an equality on the DEPENDENCY's phase, and neither fleet
 * above varies it — `cAllPhases` has no dependencies at all, and every
 * `cBehindADraft` ticket waits on the same Draft. So both pin the DEPENDENT's
 * end of the relation and neither pins the other, which left four "this
 * dependency counts as Done" widenings alive: a dependent whose dependency is
 * still Working or Evaluating, holding the gate, or parked on the desk would
 * have gone Ready and dispatchable while the thing it waits on had produced
 * nothing — `depArtifacts` reading `ANone` for an artifact that does not
 * exist yet.
 */
const cAheadOfEach: Core = core([
  ...cAllPhases.tickets,
  ...[...cAllPhases.tickets.keys()].map((d): readonly [number, Ticket] => [
    d + cAllPhases.tickets.size,
    { ...draft(cfgBudgeted, progU2, 1, 1, new Set([d])), phase: "PPending" },
  ]),
]);

test("Done is the only dependency phase that unblocks, over all nine of them", () => {
  const where = (p: (j: number) => boolean): ReadonlySet<number> =>
    new Set([...cAheadOfEach.tickets.keys()].filter(p));
  // Read from the model. The nine leaders have no dependencies, so their deps
  // are vacuously done; of the nine dependents only 16 — the one behind the
  // PDone ticket — joins them.
  assert.deepEqual(
    where((j) => depsDoneIn(cAheadOfEach, j)),
    new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 16]),
  );
  assert.deepEqual(readiesIn(cAheadOfEach), new Set([2, 16]));
  assert.deepEqual(
    where((j) => isBlockedIn(cAheadOfEach, j)),
    new Set([10, 11, 12, 13, 14, 15, 17, 18]),
  );
  // And what the guard is FOR: nothing waiting on an unfinished dependency is
  // dispatchable, whatever phase that dependency is in.
  assert.deepEqual(
    where((j) => dispatchableIn(cAheadOfEach, j)),
    new Set([2, 16]),
  );
});

test("the parked and the revoked are outside the waiting room, not inside it", () => {
  // cParked is the cascade's own post-state: ticket 1 Revoked, tickets 2 and 3
  // parked behind it. A Revoked dependency is NOT Done — unobservable through
  // any consumer today, because cascadeSafety keeps the dependent parked, but
  // wrong on a state the machine really reaches. And a parked ticket is
  // neither Ready nor Blocked: the waiting room is inside Pending.
  assert.equal(depsDoneIn(cParked, 2), false);
  assert.equal(isBlockedIn(cParked, 2), false);
  assert.equal(isReadyIn(cParked, 2), false);
});

test("dispatchableIn: Ready with gas to charge, and the gas conjunct bites", () => {
  assert.ok(dispatchableIn(c0, 1));
  assert.ok(!dispatchableIn(cRel2, 2)); // Blocked
  const cNoGas: Core = solo({
    ...draft(cfgBudgeted),
    phase: "PPending",
    gasLeft: 0,
  });
  // Read from the model: Ready, in readiesIn, and NOT dispatchable.
  assert.ok(isReadyIn(cNoGas, 1));
  assert.deepEqual(readiesIn(cNoGas), new Set([1]));
  assert.ok(!dispatchableIn(cNoGas, 1));
  assert.throws(() => decideDispatch(cfgBudgeted, cNoGas, 1), AssertionError);
  // The threshold is ONE unit, not two: a ticket holding the last gas in its
  // account dispatches, and spends it. Every other fixture asks with a full
  // account, where `> 0` and `> 1` agree; `configAdmitsInit` admits GAS = 1,
  // so this is a configuration the machine can really be given. Read from the
  // model: dispatchable, and gasLeft 0 afterwards.
  const cGasOne: Core = solo({
    ...draft(cfgBudgeted),
    phase: "PPending",
    gasLeft: 1,
  });
  assert.ok(dispatchableIn(cGasOne, 1));
  assert.equal(
    ticketAt(decideDispatch(cfgBudgeted, cGasOne, 1).post, 1).gasLeft,
    0,
  );
});

test("deliverableTaskIds: the delivery range an at-least-once fabric may name", () => {
  // Read from the model: nothing spawned, the work set, then the whole history.
  assert.deepEqual(deliverableTaskIds(c0, 1), new Set());
  assert.deepEqual(deliverableTaskIds(c1, 1), new Set([1, 2]));
  assert.deepEqual(deliverableTaskIds(c4, 1), new Set([1, 2, 3, 4]));
  // A completion naming an id the ticket never issued is outside the
  // adversary's scope entirely, and is refused rather than absorbed.
  assert.throws(() => decideTaskDone(c4, 1, 5, "VPass"), AssertionError);
  // And a ticket that has LEFT its task phase receives none either, even for
  // an id it really did issue: the parked ticket below still owns tasks 1 and
  // 2, so this refusal is the phase guard's alone.
  assert.deepEqual(deliverableTaskIds(dWorkFail.post, 1), new Set([1, 2]));
  assert.throws(
    () => decideTaskDone(dWorkFail.post, 1, 1, "VPass"),
    AssertionError,
  );
});

test("dispatch charges exactly one gas and spawns the full work width", () => {
  // The happy path pins the record; this pins the state it leaves behind.
  const before = ticketAt(c0, 1);
  const after = ticketAt(c1, 1);
  assert.equal(after.gasLeft, before.gasLeft - 1);
  assert.deepEqual(after.tasks, [wr(1), wr(2)]);
  assert.equal(after.spawned, 2);
  assert.equal(after.reworkLeft, before.reworkLeft); // no other account moves
  assert.equal(after.wrapUpLeft, before.wrapUpLeft);
});

test("artifactStampedAndSupersededTest: work-passed stamps the artifact it produced", () => {
  assert.deepEqual(ticketAt(c1, 1).artifact, { tag: "ANone" });
  assert.deepEqual(ticketAt(c4, 1).artifact, { tag: "ASome", id: 2 });
  // THE SUPERSESSION HALF, which is what makes the mark an identity rather
  // than a flag: the staged chain walks a second cycle through the eval
  // rework, and its product differs from the first. A stamp-once mutant fails
  // the last conjunct. Read from the model: ASome(5) against ASome(2).
  const second = ticketAt(dBackToEval.post, 1).artifact;
  assert.notDeepEqual(second, { tag: "ANone" });
  assert.notDeepEqual(second, ticketAt(dWorkReduce.post, 1).artifact);
  assert.deepEqual(second, { tag: "ASome", id: 5 });
});

test("nonLandingStepsCarryNoAttributionTest: attribution appears at the landing boundary and nowhere else", () => {
  // All twelve of the model's conjuncts. Most pointedly: the eval-side
  // "ticket-escalated gas_exhausted" carries the SAME label string as the
  // landing gas wall — the attribution field, not the label, marks the
  // boundary — eval-passed only ENQUEUES the landing, the gate OPEN resolves
  // no attempt, and the absorbed complete-duplicate emits nothing at all.
  for (const d of [
    dArr1,
    dRelease,
    dDispatch,
    dWork1,
    dWorkReduce,
    dAdvance,
    dEvalReduce,
    dCascade,
    dWorkFail,
    dEvalGasWall,
    dGateOpen7,
    decideCompleteDuplicate(c8, 1),
  ]) {
    assert.deepEqual(
      d.rec.landing,
      { tag: "WONone" },
      `${d.rec.label} carries a landing attribution`,
    );
  }
});

// === The plumbing's own promises ============================================

test("withTicket updates a live ticket and refuses to create one", () => {
  const updated = withTicket(c0, 1, { ...ticketAt(c0, 1), gasLeft: 1 });
  assert.equal(ticketAt(updated, 1).gasLeft, 1);
  assert.equal(updated.tickets.size, c0.tickets.size);
  assert.equal(ticketAt(updated, 2).phase, "PDraft"); // the rest is untouched
  // Quint's `set` requires the key; arrival is the only source of a ticket.
  assert.throws(() => withTicket(cEmpty, 1, jDraft), AssertionError);
  assert.throws(() => withTicket(c0, 3, jDraft), AssertionError);
});

test("escalate retires the live set, names the wall, and opens the desk task", () => {
  // The plumbing under decideWorkReduce's wall, called directly on a ticket
  // whose set is still running — the retirement that force-closes it is
  // `retireLive`'s, and every reachable escalation reaches it fully resolved.
  const d = escalate(
    solo({
      ...draft(cfgBudgeted),
      phase: "PWorking",
      tasks: spawnTasks({ tag: "TKWork" }, 1, 2),
      spawned: 2,
    }),
    1,
    "RWorking",
    "RsWorkFailed",
    "ticket-escalated work_failed",
  );
  assert.deepEqual(d.rec.transitions, [
    { ticket: 1, from: "PWorking", to: "PEscalated" },
  ]);
  assert.deepEqual(d.rec.effects, ["OpenHumanTask"]);
  assert.deepEqual(d.rec.landing, { tag: "WONone" });
  const parked = ticketAt(d.post, 1);
  assert.deepEqual(parked.tasks, []);
  assert.deepEqual(parked.record, [wt(1, "TCancelled"), wt(2, "TCancelled")]);
  assert.equal(parked.resumeAt, "RWorking");
  assert.equal(parked.reason, "RsWorkFailed");
  assert.ok(hasOpenHumanTask(parked));
});

test("withWrapUpObs stamps the record and passes the post-state through untouched", () => {
  // The attribution is an OBSERVATION: it lives in the StepRecord and in no
  // ticket field, so the decision it wraps keeps its post-state — identically,
  // not merely equally, which is what says the stamp rebuilt nothing.
  const inner = completeTicket(cQueueB, 1);
  const stamped = withWrapUpObs(inner, 2, true);
  assert.equal(stamped.post, inner.post);
  assert.deepEqual(stamped.rec.landing, {
    tag: "WOAttempt",
    project: 2,
    invalidated: true,
  });
  // And the rest of the record survives the stamp: label, transitions and
  // effects are the wrapped decision's.
  assert.equal(stamped.rec.label, inner.rec.label);
  assert.deepEqual(stamped.rec.transitions, inner.rec.transitions);
  assert.deepEqual(stamped.rec.effects, inner.rec.effects);
});

test("what the model's types forbid is checked here, where TypeScript's do not", () => {
  // Quint's `int` is not JavaScript's `number`, and a Quint program is
  // non-empty by construction. Each gap below is a value the model cannot
  // express and this implementation therefore has to refuse.
  assert.throws(
    () =>
      isValidProgram(cfgBudgeted, [
        { fanout: 1.5, combinator: "CUnanimousPass" },
      ]),
    AssertionError,
    "a fractional fan-out was keyed",
  );
  assert.throws(
    () =>
      decideArrive(
        cfgBudgeted,
        cEmpty,
        new Set(),
        defaultProgram(cfgBudgeted),
        1,
        {
          tag: "WExclusive",
          resource: 1.5,
        },
      ),
    AssertionError,
    "a fractional resource was keyed",
  );
  assert.throws(
    () => projects({ ...cfgBudgeted, nProjects: 1.5 }),
    AssertionError,
    "a fractional universe size named a range",
  );
  // `programsWellFormed` keeps every program non-empty, so `program[0]` is the
  // lowest stage rather than a possibility — asserted where it is indexed.
  const emptyProgram: Core = solo({
    ...draft(cfgBudgeted),
    program: [],
    phase: "PWorking",
    gasLeft: 2,
    tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
    spawned: 2,
  });
  assert.throws(() => decideWorkReduce(emptyProgram, 1), AssertionError);
  // Ids are dense and never reused, so the next one is the fleet's size + 1.
  // A fleet that has lost id 1 would have an arrival collide with id 2.
  assert.throws(
    () =>
      decideArrive(
        cfgBudgeted,
        core([[2, jDraft]]),
        new Set(),
        defaultProgram(cfgBudgeted),
        1,
        wx1,
      ),
    AssertionError,
    "an arrival reused a live id",
  );
});

test("ticketAt is total: a fleet with a hole fails loudly, it does not skip", () => {
  // decideRevoke walks 1..size and reads every id, which is sound only because
  // ids are dense. A hole there would silently drop a doomed dependent.
  const holed: Core = core([
    [1, { ...draft(cfgBudgeted), phase: "PPending" }],
    [
      3,
      { ...draft(cfgBudgeted, progU2, 1, 1, new Set([1])), phase: "PPending" },
    ],
  ]);
  assert.throws(() => ticketAt(holed, 2), AssertionError);
  assert.throws(() => decideRevoke(holed, 1), AssertionError);
});

// === Every hand-built fixture accounts for its own ids ======================

/**
 * `model/domain.qnt`'s `idsAccounted`, one ticket at a time — the same equality
 * the machine invariant quantifies over the fleet, usable on a fixture the
 * machine never produced. The invariant proper is s2c's; this is the fixture
 * hygiene that keeps s2c's job possible, and it mirrors the guard the model
 * carries on its own side under the same name.
 */
function accountedTicket(j: Ticket): boolean {
  return j.spawned === j.record.length + j.tasks.length;
}

test("handBuiltFixturesAccountedTest: every named fixture states the ids it hands itself", () => {
  // Hand-built fixtures AND decider-derived ones, because the derived states
  // inherit any deficit below them — which is exactly how the model's own
  // short fixtures went unnoticed. A new one cannot repeat it quietly.
  const fleets: readonly (readonly [string, Core])[] = [
    ["cEmpty", cEmpty],
    ["cA1", cA1],
    ["cA2", cA2],
    ["c0", c0],
    ["c1", c1],
    ["c2", c2],
    ["c3", c3],
    ["c4", c4],
    ["c5", c5],
    ["c6", c6],
    ["c7", c7],
    ["c8", c8],
    ["cGated7", cGated7],
    ["cWorkFail", cWorkFail],
    ["dWorkFail.post", dWorkFail.post],
    ["cEvalFail", cEvalFail],
    ["dEvalRework.post", dEvalRework.post],
    ["cReworkWall", cReworkWall],
    ["dReworkWall.post", dReworkWall.post],
    ["cEvalGasWall", cEvalGasWall],
    ["dEvalGasWall.post", dEvalGasWall.post],
    ["cStagedWork", cStagedWork],
    ["cS0", cS0],
    ["cS1", cS1],
    ["dStagedFinal.post", dStagedFinal.post],
    ["cAfterShort", cAfterShort],
    ["dBackToEval.post", dBackToEval.post],
    ["cFlatWork", cFlatWork],
    ["cGateB", cGateB],
    ["dGateRework.post", dGateRework.post],
    ["cGateWall", cGateWall],
    ["cGateGasWall", cGateGasWall],
    ["cGateD", cGateD],
    ["cGateDWall", cGateDWall],
    ["cFresh", cFresh],
    ["dPark.post", dPark.post],
    ["dParkResume.post", dParkResume.post],
    ["cEscB", cEscB],
    ["cEscWorking", cEscWorking],
    ["cRel2", cRel2],
    ["cChain", cChain],
    ["cParked", cParked],
    ["cGateOcc", cGateOcc],
    ["cQueueB", cQueueB],
    ["cCrossKind", cCrossKind],
    ["cXDepPre", cXDepPre],
    ["cXDepDone", cXDepDone],
    ["cAllPhases", cAllPhases],
    ["cGateElsewhere", cGateElsewhere],
    ["cAllResumable", cAllResumable],
    ["cBehindADraft", cBehindADraft],
    ["cAheadOfEach", cAheadOfEach],
    ["resumeFleet(0)", resumeFleet(0)],
    ["resumeFleet(2)", resumeFleet(2)],
  ];
  for (const [name, c] of fleets) {
    for (const [j, jb] of c.tickets) {
      assert.ok(
        accountedTicket(jb),
        `${name} ticket ${String(j)}: spawned ${String(jb.spawned)} against ${String(jb.record.length)} retired + ${String(jb.tasks.length)} live`,
      );
    }
  }
  // The single-ticket fixtures both suites share, and the two desk fixtures
  // built here.
  const solos: readonly (readonly [string, Ticket])[] = [
    ["jDraft", jDraft],
    ["jPend", jPend],
    ["jWork", jWork],
    ["jEval", jEval],
    ["jLand", jLand],
    ["jGated", jGated],
    ["jEsc", jEsc],
    ["jParkPre", jParkPre],
    ["jParkDep", jParkDep],
    ["jDone", jDone],
    ["escLanding", escLanding],
    ["escWorking", escWorking],
  ];
  for (const [name, jb] of solos) {
    assert.ok(accountedTicket(jb), `${name} does not account for its ids`);
  }
  // And the guard bites: the defect it names is one field wide.
  assert.ok(!accountedTicket({ ...jWork, spawned: 0 }));
});
