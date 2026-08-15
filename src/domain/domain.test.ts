/**
 * `model/domain.qnt`'s authoring-and-work half, pinned against
 * `model/tests/chuggy_test.qnt` at the consts of that suite's own instances.
 *
 * WHAT IS BEING MIRRORED, AND HOW. The model's 56 runs split by SUBJECT across
 * s2a and s2b, and the split closes when s2b lands. A run whose subject is a
 * decider or predicate this slice delivers is mirrored here CONJUNCT FOR
 * CONJUNCT, under the model's own run name, against fixtures built the way the
 * model builds them — by chaining the deciders where it chains them, and by
 * hand where it hands them (`chuggy_test` writes `cWorkFail`, `cChain`,
 * `cGateOcc` and the revoke fixtures as Core literals, and so does this file).
 *
 * A run whose fixture chain needs a decider from the other half is NOT
 * paraphrased here against a hand-built stand-in for that decider's output —
 * that would be a second, unchecked copy of s2b's logic, which is the defect
 * issue #13 exists to retire. Those runs, and the individual conjuncts of
 * mixed runs, are named in the PR's enumeration and land with s2b. Where a
 * claim of MINE would otherwise go unpinned because the model happens to pin
 * it from an s2b-derived state, it is pinned here from the model's own
 * hand-built fixture for the same shape, and the divergence is noted at the
 * test.
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
 * THE EXPECTED VALUES ARE THE MODEL'S OWN. Structural expectations (labels,
 * transitions, effects, records, phases, accounts) are copied from the run
 * that pins them. Enablement-set values the model computes but does not pin in
 * a run were read out of `chuggy_domain` in the quint 0.32.0 REPL against the
 * same fixtures, never computed by this implementation. Measure claims are
 * mirrored as the model states them — descends, climbs, or exactly flat —
 * through `measure.ts`, which pins its own integers.
 *
 * WHAT IS DELIBERATELY ABSENT: the 23 domain invariants (s2c), and every
 * eval/gate/desk decider and predicate (s2b).
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
  configAdmitsInit,
  decideArrive,
  decideDispatch,
  decideRelease,
  decideRevoke,
  decideTaskDone,
  decideWorkReduce,
  defaultProgram,
  depArtifacts,
  dependableIn,
  depsDoneIn,
  dispatchableIn,
  deliverableTaskIds,
  draftsIn,
  escalate,
  freshTicket,
  isBlockedIn,
  isReadyIn,
  isValidProgram,
  noop,
  reducibleWorkIn,
  readiesIn,
  repos,
  revocableIn,
  revocablesIn,
  stageChoices,
  taskPhaseIn,
  ticketAt,
  validPrograms,
  waitsOn,
  withTicket,
  wrapUpChoices,
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
  type Ticket,
} from "./measure.ts";

// === The suite's instances =================================================
// The reference instance (`chuggy_test`'s DB) and the DeadlineOnly one (its
// DD) live in `fixtures.test.ts`, which both suites read; the two below are
// this suite's alone. DF — the free retry metering — parameterizes only s2b's
// deciders, and a config no test reads is a claim no test makes.

/** `chuggy_test`'s DO — the single-repo degeneration. */
const cfgDO: Config = { ...cfgBudgeted, nTickets: 1, nRepos: 1 };

/** `chuggy_test`'s DZ — the GASLESS graph, which has no initial state at all. */
const cfgDZ: Config = { ...cfgBudgeted, nTickets: 1, gas: 0 };

/** `chuggy_test`'s bB, which is exactly DB's bounds. */
const bB: Bounds = {
  reworkPolicy: { tag: "RWBudget", budget: 1 },
  nTasks: 2,
  maxStages: 2,
  wrapUpPricing: { tag: "Budgeted", budget: 1 },
};

/** `chuggy_test`'s mB. */
function mB(c: Core): number {
  return sysMeasure(bB, c.tickets);
}

// === Fixture vocabulary ====================================================
// The builders and programs `chuggy_test` shares with the measure suite live
// in `fixtures.test.ts`; what is local below is what only this suite reads.

// === The happy path, decision by decision ==================================
// `chuggy_test`'s own chain, verbatim as far as this slice's deciders reach:
// two arrivals, a release, the dispatch, both work completions, the work
// reduce, then both eval completions. c7 (the eval-stage reduce) and c8 (the
// landing) are s2b's deciders and are not built here.

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

test("happyPathMeasureDescendsTest: every decision on the path strictly descends", () => {
  // The model's eight conjuncts, of which these six are this slice's. The
  // remaining two — mB(c7) < mB(c6) and mB(c8) < mB(c7) — are the eval reduce
  // and the landing, s2b's.
  const walk: readonly (readonly [string, Core, Core])[] = [
    ["dispatch (gas)", c0, c1],
    ["the first work completion (task count)", c1, c2],
    ["the second work completion", c2, c3],
    ["the work reduce (rank)", c3, c4],
    ["the first eval completion", c4, c5],
    ["the second eval completion", c5, c6],
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
  assert.equal(dWorkReduce.rec.label, "work-passed");
  assert.deepEqual(dWorkReduce.rec.transitions, [
    { ticket: 1, from: "PWorking", to: "PEvaluating" },
  ]);
  // THE SPAWN EFFECTS. The model pins these because nothing else does, and
  // records the mutation that made the case: dropping SpawnEvalTasks from
  // work-passed left all 54 of its other cases passing.
  assert.deepEqual(dDispatch.rec.effects, ["SpawnWorkTasks"]);
  assert.deepEqual(dWorkReduce.rec.effects, ["SpawnEvalTasks"]);
});

test("happyPathRetainedRecordTest: the work set is retired and the eval stage is live above it", () => {
  // The model's c4 conjuncts. Its c8 pair (the whole anatomy at Done) needs
  // the eval reduce and the landing: s2b's.
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
  // match. Its c7 conjunct (a stale eval completion after the eval reduce)
  // needs that reduce: s2b's.
  const stale = decideTaskDone(c4, 1, 1, "VFail");
  assert.deepEqual(stale.post, c4);
  assert.equal(stale.rec.label, "task-done-duplicate");
  assert.equal(mB(stale.post), mB(c4));
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

// === PROGRAM-AS-DATA at machine level =======================================

const cStagedWork: Core = solo({
  ...draft(cfgBudgeted, progStaged),
  phase: "PWorking",
  gasLeft: 2,
  tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
});
const cFlatWork: Core = solo({
  ...draft(cfgBudgeted),
  phase: "PWorking",
  gasLeft: 2,
  tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
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
    { ...cfgBudgeted, nRepos: 0 },
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
  // repos and the two draw universes, read out of chuggy_domain at DB's
  // consts. The model pins `repos` twice in runs (wrapUpOutcomesDrawRuleTest,
  // oneRepoDegenerationTest); the other two are the arrival's draw sets.
  assert.deepEqual(repos(cfgBudgeted), new Set([1, 2]));
  assert.deepEqual(repos(cfgDO), new Set([1]));
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

test("arrivalCarriesRepoTest: the authored target repo rides the arrival", () => {
  assert.equal(ticketAt(cA1, 1).repo, 1);
  const elsewhere = decideArrive(
    cfgBudgeted,
    cEmpty,
    new Set(),
    defaultProgram(cfgBudgeted),
    2,
    wx2,
  );
  assert.equal(ticketAt(elsewhere.post, 1).repo, 2);
  assert.equal(elsewhere.rec.label, "ticket-arrived");
  // Out of the universe is refused at authoring time, like an ill-formed
  // program (`reposWellFormed` makes the refusal durable).
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
  // The model's positive control releases ticket 2 at c8, where its dep has
  // LANDED — that state is s2b's. The same claim from a hand-built Done dep is
  // crossRepoDepGateLocationBlindTest below, which is mirrored whole.
});

// === Revoke, from every live phase ==========================================
// The model's eight single-ticket fixtures — one per live phase and all THREE
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
  // The model's ninth conjunct — that revoking the gate's occupant frees the
  // slot by phase alone — reads `leaseFreeIn`, which is s2b's.
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
  // The model reads the Done case off c8, which the landing decider builds
  // (s2b). The same phase from the model's own hand-built Done fixture:
  assert.ok(!revocableIn(solo(jDone), 1));
  assert.ok(!revocableIn(revokeOne(jDraft).post, 1)); // Revoked
  assert.throws(() => decideRevoke(solo(jDone), 1), AssertionError);
});

test("revokedNeverCompletesTest: revoking a ticket ON the landing strip emits no landing effect", () => {
  assert.equal(ticketAt(revokeOne(jLand).post, 1).completions, 0);
  assert.deepEqual(revokeOne(jLand).rec.effects, ["Revoke"]);
  // Its contrast — the landed ticket's counter at 1 — is s2b's c8.
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
  const dSettle2 = decideRevoke(cParked, 2);
  assert.deepEqual(dSettle2.rec.transitions, [
    { ticket: 2, from: "PEscalated", to: "PRevoked" },
  ]);
  assert.deepEqual(dSettle2.rec.effects, ["Revoke"]); // no re-park of already-parked 3
  assert.equal(mB(dSettle2.post), mB(cParked)); // desk revoke: flat, pinned
  assert.equal(ticketAt(dSettle2.post, 3).phase, "PEscalated"); // 3 untouched
  assert.ok(hasOpenHumanTask(ticketAt(dSettle2.post, 3)));
  // That these two walls are not retryable — and the revalidation wall is —
  // reads `retryableIn`: s2b's.
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

// === The derived waiting room and the enablement sets =======================

const cXDepPre: Core = core([
  [1, { ...draft(cfgBudgeted), phase: "PWrapUp" }],
  [2, { ...draft(cfgBudgeted, progU2, 2, 2, new Set([1])), phase: "PPending" }],
]);
const cXDepDone: Core = core([
  [1, { ...draft(cfgBudgeted), phase: "PDone", completions: 1 }],
  [2, { ...draft(cfgBudgeted, progU2, 2, 2, new Set([1])), phase: "PPending" }],
]);

test("crossRepoDepGateLocationBlindTest: the dep gate reads Done-ness, never location", () => {
  assert.ok(isBlockedIn(cXDepPre, 2));
  assert.ok(!isReadyIn(cXDepPre, 2));
  assert.ok(isReadyIn(cXDepDone, 2));
  assert.ok(!isBlockedIn(cXDepDone, 2));
  // The repos are genuinely different, so a location-reading gate would fail
  // above rather than agreeing by accident.
  assert.equal(ticketAt(cXDepDone, 1).repo, 1);
  assert.equal(ticketAt(cXDepDone, 2).repo, 2);
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
  // fully resolved and Evaluating, which is s2b's reduce, not this one.
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
  // must answer with the same array here, or s2b's release read compares two
  // equal sets and disagrees with the model. Read from the model: both are
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
    },
  ],
  [4, { ...draft(cfgBudgeted), phase: "PEvaluating", tasks: mixedE0 }],
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
  // The supersession half — a second cycle stamping a DIFFERENT mark — walks
  // through the eval rework, which is s2b's.
});

test("nonLandingStepsCarryNoAttributionTest: attribution appears at the landing boundary and nowhere else", () => {
  // This slice's seven of the model's twelve conjuncts. The other five
  // (eval-stage-passed, eval-passed, the eval-side gas wall, the gate open and
  // the absorbed landing duplicate) are s2b's deciders.
  for (const d of [
    dArr1,
    dRelease,
    dDispatch,
    dWork1,
    dWorkReduce,
    dCascade,
    dWorkFail,
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
    () => repos({ ...cfgBudgeted, nRepos: 1.5 }),
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
