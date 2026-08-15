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
import { er, et, progStaged, progU2, solo, wr, wt } from "./fixtures.test.ts";
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
  firstTaskId,
  hasOpenHumanTask,
  spawnTasks,
  sysMeasure,
  ticketMeasure,
  type ArtifactMark,
  type Bounds,
  type Core,
  type Decision,
  type Stage,
  type Task,
  type Ticket,
  type WrapUp,
} from "./measure.ts";

// === The suite's instances =================================================
// `chuggy_test` imports `chuggy_domain` five times. Three of those five are
// read here; the other two (DD, the DeadlineOnly pricing, and DF, the free
// retry metering) parameterize only s2b's deciders, and a config no test reads
// is a claim no test makes.

/** `chuggy_test`'s DB — the reference instance: Budgeted(1), charged retries. */
const cfgDB: Config = {
  nTickets: 2,
  nTasks: 2,
  reworkPolicy: { tag: "RWBudget", budget: 1 },
  gas: 3,
  wrapUpPricing: { tag: "Budgeted", budget: 1 },
  opRetryPricing: "RetryCharged",
  maxStages: 2,
  nRepos: 2,
};

/** `chuggy_test`'s DO — the single-repo degeneration. */
const cfgDO: Config = { ...cfgDB, nTickets: 1, nRepos: 1 };

/** `chuggy_test`'s DZ — the GASLESS graph, which has no initial state at all. */
const cfgDZ: Config = { ...cfgDB, nTickets: 1, gas: 0 };

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

const wx1: WrapUp = { tag: "WExclusive", resource: 1 };
const wx2: WrapUp = { tag: "WExclusive", resource: 2 };

/**
 * `DB::freshTicket(Set(), progU2, 1, WExclusive(1))`, the model's most-used
 * fixture, with its four arguments defaulted to the ones it passes most.
 */
function fresh(
  program: readonly Stage[] = progU2,
  repo = 1,
  resource = 1,
  deps: ReadonlySet<number> = new Set(),
): Ticket {
  return freshTicket(cfgDB, deps, program, repo, {
    tag: "WExclusive",
    resource,
  });
}

/** A Core over the given ids, in the model's `Map(...)` order. */
function core(entries: readonly (readonly [number, Ticket])[]): Core {
  return { tickets: new Map(entries) };
}

// === The happy path, decision by decision ==================================
// `chuggy_test`'s own chain, verbatim as far as this slice's deciders reach:
// two arrivals, a release, the dispatch, both work completions, the work
// reduce, then both eval completions. c7 (the eval-stage reduce) and c8 (the
// landing) are s2b's deciders and are not built here.

const cEmpty: Core = { tickets: new Map() };
const dArr1 = decideArrive(
  cfgDB,
  cEmpty,
  new Set(),
  defaultProgram(cfgDB),
  1,
  wx1,
);
const cA1 = dArr1.post;
const dArr2 = decideArrive(
  cfgDB,
  cA1,
  new Set([1]),
  defaultProgram(cfgDB),
  1,
  wx1,
);
const cA2 = dArr2.post;
const dRelease = decideRelease(cA2, 1);
const c0 = dRelease.post;
const dDispatch = decideDispatch(cfgDB, c0, 1);
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
  ...fresh(),
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
  ...fresh(progStaged),
  phase: "PWorking",
  gasLeft: 2,
  tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
});
const cFlatWork: Core = solo({
  ...fresh(),
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
  assert.equal(configAdmitsInit(cfgDB), true);
  for (const broken of [
    { ...cfgDB, gas: 0 },
    { ...cfgDB, nTasks: 0 },
    { ...cfgDB, nTickets: 0 },
    { ...cfgDB, maxStages: 0 },
    { ...cfgDB, nRepos: 0 },
  ]) {
    assert.equal(
      configAdmitsInit(broken),
      false,
      `init admits a configuration it should refuse: ${JSON.stringify(broken)}`,
    );
  }
});

test("the authoring universes are the model's, and `bounds` is DB's", () => {
  // repos and the two draw universes, read out of chuggy_domain at DB's
  // consts. The model pins `repos` twice in runs (wrapUpOutcomesDrawRuleTest,
  // oneRepoDegenerationTest); the other two are the arrival's draw sets.
  assert.deepEqual(repos(cfgDB), new Set([1, 2]));
  assert.deepEqual(repos(cfgDO), new Set([1]));
  assert.deepEqual(wrapUpChoices(cfgDB), [{ tag: "WNone" }, wx1, wx2]);
  assert.deepEqual(wrapUpChoices(cfgDO), [{ tag: "WNone" }, wx1]);
  assert.deepEqual(stageChoices(cfgDB), [
    { fanout: 1, combinator: "CUnanimousPass" },
    { fanout: 1, combinator: "CAnyPass" },
    { fanout: 2, combinator: "CUnanimousPass" },
    { fanout: 2, combinator: "CAnyPass" },
  ]);
  assert.deepEqual(boundsOf(cfgDB), bB);
  // DB's two widths are both 2, so the equality above cannot tell them apart.
  // A config where they differ can.
  assert.deepEqual(boundsOf({ ...cfgDB, maxStages: 3 }), {
    ...bB,
    maxStages: 3,
  });
});

test("defaultProgramIsUnanimousSingleStageTest: ONE stage, full fan-out, unanimous", () => {
  assert.deepEqual(defaultProgram(cfgDB), progU2);
  assert.ok(isValidProgram(cfgDB, defaultProgram(cfgDB)));
});

test("validProgramsRefusalTest: the set IS the arrival-refusal rule", () => {
  assert.ok(isValidProgram(cfgDB, progU2));
  assert.ok(isValidProgram(cfgDB, progStaged));
  assert.ok(!isValidProgram(cfgDB, [])); // empty program
  assert.ok(
    !isValidProgram(cfgDB, [{ fanout: 0, combinator: "CUnanimousPass" }]),
  ); // zero fan-out
  assert.ok(
    !isValidProgram(cfgDB, [{ fanout: 3, combinator: "CUnanimousPass" }]),
  ); // fan-out > N_TASKS
  assert.ok(
    !isValidProgram(cfgDB, [
      { fanout: 1, combinator: "CUnanimousPass" },
      { fanout: 1, combinator: "CUnanimousPass" },
      { fanout: 1, combinator: "CUnanimousPass" },
    ]),
  ); // length > MAX_STAGES
  // At N_TASKS = 2, MAX_STAGES = 2 there are exactly 4 stage choices, hence
  // 4 + 16 = 20 programs. The length is the SET's size only because the
  // enumeration holds no duplicate, which is checked here rather than assumed.
  assert.equal(validPrograms(cfgDB).length, 20);
  assert.equal(
    new Set(validPrograms(cfgDB).map((p) => JSON.stringify(p))).size,
    20,
  );
  // And the refusal is durable: an arrival cannot carry one.
  assert.throws(
    () => decideArrive(cfgDB, cEmpty, new Set(), [], 1, wx1),
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
  assert.deepEqual(born.program, defaultProgram(cfgDB)); // eval is data, authored
  assert.deepEqual(born.record, []); // no history yet
  assert.deepEqual([...cA2.tickets.keys()], [1, 2]); // dense: next id = size + 1
  assert.deepEqual(ticketAt(cA2, 2).deps, new Set([1])); // a dep on an UNRELEASED ticket is legal
  assert.ok(mB(cA1) > mB(cEmpty)); // AUTHORING: climbs
  assert.ok(mB(cA2) > mB(cA1));
});

test("arrivalCarriesRepoTest: the authored target repo rides the arrival", () => {
  assert.equal(ticketAt(cA1, 1).repo, 1);
  const elsewhere = decideArrive(
    cfgDB,
    cEmpty,
    new Set(),
    defaultProgram(cfgDB),
    2,
    wx2,
  );
  assert.equal(ticketAt(elsewhere.post, 1).repo, 2);
  assert.equal(elsewhere.rec.label, "ticket-arrived");
  // Out of the universe is refused at authoring time, like an ill-formed
  // program (`reposWellFormed` makes the refusal durable).
  assert.throws(
    () => decideArrive(cfgDB, cEmpty, new Set(), defaultProgram(cfgDB), 3, wx1),
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
  assert.equal(canArriveIn(cfgDB, cEmpty), true);
  assert.equal(canArriveIn(cfgDB, cA1), true);
  assert.equal(canArriveIn(cfgDB, cA2), false);
  assert.throws(
    () => decideArrive(cfgDB, cA2, new Set(), defaultProgram(cfgDB), 1, wx1),
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
// The model's eight single-ticket fixtures: one per live phase and all THREE
// desk-reason flavors of the one parked phase. Accounts are deliberately
// part-spent so the no-leakage equality is not vacuously "full grant == full
// grant".

function spent(j: Ticket): Ticket {
  return { ...j, gasLeft: 2, reworkLeft: 0, wrapUpLeft: 1 };
}

const jDraft: Ticket = spent(fresh());
const jPend: Ticket = { ...jDraft, phase: "PPending" };
const jWork: Ticket = {
  ...jDraft,
  phase: "PWorking",
  tasks: spawnTasks({ tag: "TKWork" }, firstTaskId, 2),
};
const mixedE0: readonly Task[] = [et(1, 0, "TPassed"), et(2, 0, "TFailed")];
const jEval: Ticket = { ...jDraft, phase: "PEvaluating", tasks: mixedE0 };
const jLand: Ticket = { ...jDraft, phase: "PWrapUp" };
const jGated: Ticket = { ...jDraft, phase: "PWrapUpHolding" };
const jEsc: Ticket = {
  ...jDraft,
  phase: "PEscalated",
  resumeAt: "REvaluating",
  reason: "RsReworkBudgetExhausted",
};
const jParkPre: Ticket = {
  ...jDraft,
  phase: "PEscalated",
  resumeAt: "RPending",
  reason: "RsRevalidationFailed",
};
/** resumeAt stays RNone: the cascade wall stamps no modeled resume. */
const jParkDep: Ticket = {
  ...jDraft,
  phase: "PEscalated",
  reason: "RsDependencyRevoked",
};
/** The model's cXDepDone ticket 1 — a landed ticket, hand-built. */
const jDone: Ticket = { ...fresh(), phase: "PDone", completions: 1 };

function revokeOne(j: Ticket): Decision {
  return decideRevoke(solo(j), 1);
}

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
  [1, { ...fresh(), phase: "PPending" }],
  [2, { ...fresh(progU2, 1, 1, new Set([1])), phase: "PPending" }],
  [3, fresh(progU2, 1, 1, new Set([2]))],
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
          cfgDB,
          solo(tombstone),
          new Set([1]),
          defaultProgram(cfgDB),
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
  [1, { ...fresh(), phase: "PWrapUp" }],
  [2, { ...fresh(progU2, 2, 2, new Set([1])), phase: "PPending" }],
]);
const cXDepDone: Core = core([
  [1, { ...fresh(), phase: "PDone", completions: 1 }],
  [2, { ...fresh(progU2, 2, 2, new Set([1])), phase: "PPending" }],
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
  // Two dependencies carrying the SAME mark collapse to one element, because
  // the model's read is a set-valued map. Read from the model: Set(ANone).
  const cTwoDeps: Core = core([
    [1, jDone],
    [2, jDone],
    [3, { ...fresh(progU2, 1, 1, new Set([1, 2])), phase: "PPending" }],
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

test("dispatchableIn: Ready with gas to charge, and the gas conjunct bites", () => {
  assert.ok(dispatchableIn(c0, 1));
  assert.ok(!dispatchableIn(cRel2, 2)); // Blocked
  const cNoGas: Core = solo({ ...fresh(), phase: "PPending", gasLeft: 0 });
  // Read from the model: Ready, in readiesIn, and NOT dispatchable.
  assert.ok(isReadyIn(cNoGas, 1));
  assert.deepEqual(readiesIn(cNoGas), new Set([1]));
  assert.ok(!dispatchableIn(cNoGas, 1));
  assert.throws(() => decideDispatch(cfgDB, cNoGas, 1), AssertionError);
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
      ...fresh(),
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
      isValidProgram(cfgDB, [{ fanout: 1.5, combinator: "CUnanimousPass" }]),
    AssertionError,
    "a fractional fan-out was keyed",
  );
  assert.throws(
    () =>
      decideArrive(cfgDB, cEmpty, new Set(), defaultProgram(cfgDB), 1, {
        tag: "WExclusive",
        resource: 1.5,
      }),
    AssertionError,
    "a fractional resource was keyed",
  );
  assert.throws(
    () => repos({ ...cfgDB, nRepos: 1.5 }),
    AssertionError,
    "a fractional universe size named a range",
  );
  // `programsWellFormed` keeps every program non-empty, so `program[0]` is the
  // lowest stage rather than a possibility — asserted where it is indexed.
  const emptyProgram: Core = solo({
    ...fresh(),
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
        cfgDB,
        core([[2, jDraft]]),
        new Set(),
        defaultProgram(cfgDB),
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
    [1, { ...fresh(), phase: "PPending" }],
    [3, { ...fresh(progU2, 1, 1, new Set([1])), phase: "PPending" }],
  ]);
  assert.throws(() => ticketAt(holed, 2), AssertionError);
  assert.throws(() => decideRevoke(holed, 1), AssertionError);
});
