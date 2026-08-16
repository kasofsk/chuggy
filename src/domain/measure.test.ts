/**
 * The measure, pinned against `model/measure.qnt` at the consts of all three
 * instances in `model/mc/mc_chuggy.qnt`.
 *
 * WHAT IS BEING MIRRORED, AND FROM WHERE. `model/tests/chuggy_test.qnt` pins
 * the measure in two ways: as ORDERINGS across a decider's pre/post pair (the
 * descent table's rows, the named non-descending sets), and as pure
 * EQUALITIES over hand-built tickets (the two blindness runs, the combinator
 * run). The equalities are mirrored conjunct for conjunct. The orderings are
 * mirrored at MEASURE grain — the named model run is cited on every one, and
 * nothing here asserts a label, a transition, an effect or a guard: those are
 * the deciders' own, pinned in `domain.test.ts`, and deliberately absent here.
 *
 * EVERY POST-STATE COMES OUT OF THE DECIDER THAT DEFINES IT (issue #13, closed
 * at s2b). While the deciders were unwritten this file built them from s1's
 * plumbing the way `model/domain.qnt` builds them; with all thirteen landed,
 * that copy would be a divergent reimplementation whose pinned integers went on
 * passing while the decider moved. What is still built by hand is what no
 * decider defines: the measure vocabulary's own inputs, and the PRE-states the
 * deciders are applied to.
 *
 * TWO CLASSES OF FIXTURE, AND ONLY ONE OF THEM ACCOUNTS FOR ITS IDS. A fixture
 * standing for a MACHINE STATE states its own `spawned` (`record.length +
 * tasks.length`), per ledger #17's Path A and model PR #27 — every pre-state
 * below does. The MEASURE-VOCABULARY probes deliberately do not, and are
 * excluded by this label: they are inputs to a pure function of the fields they
 * name (`stagesLeft`, `evalStage`, `runningCount`, `retireLive`, `spawnOn`,
 * `combine`, the digit table's shapes), `spawned` is not among those fields,
 * and several are malformed on purpose — a scrambled task set, a stage index
 * past the program's end, an id 2^53 away — which is the whole of what they
 * pin. Giving an unreachable-by-design probe an accounted counter would dress
 * it as a state the machine could reach.
 *
 * THE EXPECTED INTEGERS ARE THE MODEL'S OWN. Every number pinned below was
 * read out of `chuggy_measure` itself, by evaluating the same fixture in the
 * quint 0.32.0 REPL against `model/measure.qnt` — not computed by this
 * implementation and not re-derived by hand. A test whose expectation comes
 * from the code it tests pins nothing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "./assert.ts";
import {
  decideDispatch,
  decideEvalStageReduce,
  decideOpRetry,
  decideRelease,
  decideTaskDone,
  decideWorkReduce,
  decideWrapUpResolve,
  decideWrapUpStart,
  ticketAt,
  type Config,
} from "./domain.ts";
import {
  cfgBudgeted,
  cfgDeadlineOnly,
  cfgRetryFree,
  draft,
  er,
  escalated,
  et,
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
} from "./fixtures.test.ts";
import {
  accountDigitsInRange,
  combine,
  evalStage,
  firstTaskId,
  hasOpenHumanTask,
  micro,
  microBound,
  nextTaskId,
  phaseRank,
  radix,
  rankCeiling,
  rankDraft,
  rankEvaluating,
  rankHolding,
  rankPending,
  rankSettled,
  rankWeight,
  rankWorking,
  rankWrapUp,
  resolveTask,
  retireLive,
  reworkBudget,
  runningCount,
  spawnOn,
  spawnTasks,
  stageWeight,
  stagesLeft,
  sysMeasure,
  taskPassed,
  ticketMeasure,
  wrapUpBudget,
  type ArtifactMark,
  type Bounds,
  type Combinator,
  type Core,
  type Decision,
  type Phase,
  type Reason,
  type Resume,
  type RetryPricing,
  type ReworkPolicy,
  type Stage,
  type StepRecord,
  type Task,
  type TaskKind,
  type TaskOutcome,
  type TaskSet,
  type TaskState,
  type Ticket,
  type Transition,
  type Verdict,
  type WrapUp,
  type WrapUpObs,
  type WrapUpOutcome,
  type WrapUpPricing,
} from "./measure.ts";

// === The three instances' consts ===========================================
// `Bounds` reads four of the eight machine consts. The other four — N_TICKETS,
// GAS, OP_RETRY_PRICING, N_REPOS — are the machine's, not the measure's, and
// the grants below carry GAS separately because a ticket's accounts are state
// rather than bounds.

/** `mc_chuggy_budgeted`, and identically `chuggy_test`'s reference instance `bB`. */
const bBudgeted: Bounds = {
  reworkPolicy: { tag: "RWBudget", budget: 1 },
  nTasks: 2,
  maxStages: 2,
  wrapUpPricing: { tag: "Budgeted", budget: 1 },
};

/** `mc_chuggy_deadline_only`, and identically `chuggy_test`'s `bD`. */
const bDeadlineOnly: Bounds = {
  reworkPolicy: { tag: "RWBudget", budget: 1 },
  nTasks: 2,
  maxStages: 2,
  wrapUpPricing: { tag: "DeadlineOnly" },
};

/** `mc_chuggy_retryfree`. Its GAS is 2 and its retry pricing is free; neither is a bound. */
const bRetryFree: Bounds = {
  reworkPolicy: { tag: "RWBudget", budget: 1 },
  nTasks: 2,
  maxStages: 2,
  wrapUpPricing: { tag: "DeadlineOnly" },
};

test("the retryfree instance's Bounds are the deadline-only instance's, exactly", () => {
  // Not a redundancy: it is what the measure NOT reading the retry pricing
  // looks like from outside. The free-resume climb of the CHURN set is visible
  // because the resume charges no gas, never because the bounds differ.
  assert.deepEqual(bRetryFree, bDeadlineOnly);
});

/**
 * The account GRANTS each instance starts a ticket with are no longer written
 * here at all: they are its CONSTS, and `draft` builds the Draft through
 * `freshTicket`, which reads them. `fixtures.test.ts` holds the three configs.
 */

// === Fixture vocabulary ====================================================
// `chuggy_test`'s four task builders and its two programs are shared with the
// domain suite, and live in `fixtures.test.ts`.

/**
 * ISSUE #13, CLOSED. Every post-state below is read out of the Decision the
 * decider that DEFINES it returns; none is hand-built any longer.
 *
 * The rule, from the issue: once the decider that defines a state ships, a
 * hand-built copy of it is a divergent reimplementation, and these pinned
 * integers would go on passing against the copy while the decider moved.
 * s2a rewired `escalated`, `revoked` and `draft` onto `escalate`,
 * `decideRevoke` and `freshTicket`; the rework re-entry was left because it
 * belongs to `decideEvalStageReduce` and `decideWrapUpResolve`, and with those
 * landed it — and every other hand-built post-state in this file — is rewired
 * here. NOT ONE PINNED INTEGER MOVED, which is the check that matters: a moved
 * pin would have meant the copy and the decider already disagreed.
 *
 * What is still built by hand is what no decider defines: the measure
 * vocabulary's own inputs (task sets, digit tables, account boundaries) and
 * the PRE-states a decider is then applied to.
 */
function stepped(d: Decision): Ticket {
  return ticketAt(d.post, 1);
}

/** The eval rework's re-entry: `decideEvalStageReduce`'s short-circuit arm. */
function reworkedFromEval(cfg: Config, j: Ticket): Ticket {
  return stepped(decideEvalStageReduce(cfg, solo(j), 1));
}

/** The gate eviction's re-entry: `decideWrapUpResolve`'s failure arm. */
function reworkedFromGate(cfg: Config, j: Ticket): Ticket {
  return stepped(decideWrapUpResolve(cfg, solo(j), 1, "WFailed", true));
}

/** The ticket `decideRevoke` leaves behind, read out of the Decision. */
function revoked(j: Ticket): Ticket {
  return ticketAt(revokeOne(j).post, 1);
}

/** The ticket an operator resume leaves behind, at a chosen metering. */
function resumedBy(cfg: Config, j: Ticket): Ticket {
  return stepped(decideOpRetry(cfg, solo(j), 1));
}

function measuresAt(b: Bounds, tickets: readonly Ticket[]): readonly number[] {
  return tickets.map((t) => ticketMeasure(b, t));
}

function descends(b: Bounds, pre: Ticket, post: Ticket): boolean {
  return ticketMeasure(b, post) < ticketMeasure(b, pre);
}

// === The vocabulary roster =================================================

/**
 * True only when `Listed` covers every member of `Union`. A constructor left
 * out of a roster below stops this from typechecking, so the enumerations are
 * complete by compilation rather than by having been counted once.
 */
type Covers<Union, Listed> = [Union] extends [Listed] ? true : false;

const PHASES = [
  "PDraft",
  "PPending",
  "PWorking",
  "PEvaluating",
  "PWrapUp",
  "PWrapUpHolding",
  "PDone",
  "PEscalated",
  "PRevoked",
] as const satisfies readonly Phase[];
const OUTCOMES = [
  "TPassed",
  "TFailed",
  "TCancelled",
] as const satisfies readonly TaskOutcome[];
const VERDICTS = ["VPass", "VFail"] as const satisfies readonly Verdict[];
const COMBINATORS = [
  "CUnanimousPass",
  "CAnyPass",
] as const satisfies readonly Combinator[];
const RETRY_PRICINGS = [
  "RetryCharged",
  "RetryFree",
] as const satisfies readonly RetryPricing[];
const RESUMES = [
  "RNone",
  "RPending",
  "RWorking",
  "REvaluating",
  "RWrapUp",
] as const satisfies readonly Resume[];
const REASONS = [
  "RsNone",
  "RsWorkFailed",
  "RsReworkBudgetExhausted",
  "RsWrapUpBudgetExhausted",
  "RsGasExhausted",
  "RsRevalidationFailed",
  "RsDependencyRevoked",
] as const satisfies readonly Reason[];
const WRAPUP_OUTCOMES = [
  "WOk",
  "WFailed",
] as const satisfies readonly WrapUpOutcome[];

test("the vocabulary is the model's, constructor for constructor", () => {
  // The eight all-nullary sums, covered by compilation: `Covers` is `false`
  // for any roster missing a member, and `false` is not assignable to `true`.
  const covered: readonly true[] = [
    true satisfies Covers<Phase, (typeof PHASES)[number]>,
    true satisfies Covers<TaskOutcome, (typeof OUTCOMES)[number]>,
    true satisfies Covers<Verdict, (typeof VERDICTS)[number]>,
    true satisfies Covers<Combinator, (typeof COMBINATORS)[number]>,
    true satisfies Covers<RetryPricing, (typeof RETRY_PRICINGS)[number]>,
    true satisfies Covers<Resume, (typeof RESUMES)[number]>,
    true satisfies Covers<Reason, (typeof REASONS)[number]>,
    true satisfies Covers<WrapUpOutcome, (typeof WRAPUP_OUTCOMES)[number]>,
  ];
  assert.equal(covered.length, 8);
  // Constructor names are distinct within each sum — the model gives a module
  // one constructor namespace, and a duplicated name here would be a typo that
  // narrowed a union without failing anything.
  for (const roster of [
    PHASES,
    OUTCOMES,
    VERDICTS,
    COMBINATORS,
    RETRY_PRICINGS,
    RESUMES,
    REASONS,
    WRAPUP_OUTCOMES,
  ]) {
    assert.equal(
      new Set(roster).size,
      roster.length,
      `constructor names repeat in [${roster.join(", ")}]`,
    );
  }
  assert.deepEqual(
    [
      PHASES.length,
      OUTCOMES.length,
      VERDICTS.length,
      COMBINATORS.length,
      RETRY_PRICINGS.length,
      RESUMES.length,
      REASONS.length,
      WRAPUP_OUTCOMES.length,
    ],
    [9, 3, 2, 2, 2, 5, 7, 2],
  );

  // The seven payload-carrying sums: every constructor built once, so a
  // renamed tag or a dropped payload field is a compile error here.
  const kinds: readonly TaskKind[] = [
    { tag: "TKWork" },
    { tag: "TKEval", stage: 0 },
  ];
  const states: readonly TaskState[] = [
    { tag: "TSRunning" },
    { tag: "TSResolved", outcome: "TPassed" },
  ];
  const pricings: readonly WrapUpPricing[] = [
    { tag: "Budgeted", budget: 1 },
    { tag: "DeadlineOnly" },
  ];
  const policies: readonly ReworkPolicy[] = [{ tag: "RWBudget", budget: 1 }];
  const landings: readonly WrapUpObs[] = [
    { tag: "WONone" },
    { tag: "WOAttempt", repo: 2, invalidated: true },
  ];
  const wrapUps: readonly WrapUp[] = [
    { tag: "WNone" },
    { tag: "WExclusive", resource: 1 },
  ];
  const marks: readonly ArtifactMark[] = [
    { tag: "ANone" },
    { tag: "ASome", id: 7 },
  ];
  assert.deepEqual(
    [kinds, states, pricings, policies, landings, wrapUps, marks].map(
      (r) => r.length,
    ),
    [2, 2, 2, 1, 2, 2, 2],
  );

  // The eight records, each built once. `Decision` and `StepRecord` carry no
  // behaviour in this slice — they exist so s2a's deciders have a return type
  // that already matches the golden-trace step schema.
  const stage: Stage = { fanout: 2, combinator: "CUnanimousPass" };
  const task: Task = {
    id: 1,
    kind: { tag: "TKWork" },
    state: { tag: "TSRunning" },
  };
  const ticket: Ticket = draft(cfgBudgeted);
  const core: Core = { tickets: new Map([[1, ticket]]) };
  const transition: Transition = { ticket: 1, from: "PDraft", to: "PPending" };
  const rec: StepRecord = {
    label: "ticket-released",
    transitions: [transition],
    effects: [],
    landing: { tag: "WONone" },
  };
  const decision: Decision = { rec, post: core };
  const bounds: Bounds = bBudgeted;
  assert.deepEqual(
    [stage.fanout, task.id, ticket.gasLeft, core.tickets.size, bounds.nTasks],
    [2, 1, 3, 1, 2],
  );
  assert.equal(decision.rec.transitions.length, 1);
  assert.equal(decision.rec.landing.tag, "WONone");
});

// === The weight chain, derived rather than chosen ==========================

test("the weights derive to the model's values at the mc consts", () => {
  // Read from the model: stageWeight 3, rankWeight 9, microBound 63 at
  // nTasks = 2, maxStages = 2, and identically on all three instances because
  // those two consts are identical across them.
  for (const [name, b] of [
    ["budgeted", bBudgeted],
    ["deadline_only", bDeadlineOnly],
    ["retryfree", bRetryFree],
  ] as const) {
    assert.deepEqual(
      [stageWeight(b), rankWeight(b), microBound(b)],
      [3, 9, 63],
      `the weight chain at mc_chuggy_${name}`,
    );
  }
  assert.equal(rankCeiling, 6);
  assert.equal(radix(rankCeiling), 7);
});

test("the weights are DERIVED, so they move with the bounds they are built from", () => {
  // A literal survives this; a derivation does not. Every combination in a
  // small grid, against the model's chain re-stated as inequalities rather
  // than as the same arithmetic.
  for (let nTasks = 0; nTasks <= 4; nTasks += 1) {
    for (let maxStages = 0; maxStages <= 4; maxStages += 1) {
      const b: Bounds = { ...bBudgeted, nTasks, maxStages };
      const at = `at nTasks=${String(nTasks)}, maxStages=${String(maxStages)}`;
      // stageWeight strictly dominates any running count.
      assert.ok(stageWeight(b) > nTasks, `stageWeight over the count ${at}`);
      // rankWeight strictly dominates the full stage digit plus any count.
      assert.ok(
        rankWeight(b) > maxStages * stageWeight(b) + nTasks,
        `rankWeight over stage digit + count ${at}`,
      );
      // microBound strictly dominates the largest micro the ladder allows.
      assert.ok(
        microBound(b) > rankCeiling * rankWeight(b) + rankWeight(b) - 1,
        `microBound over the ladder's largest micro ${at}`,
      );
    }
  }
});

test("the account sizers read the pricing and the policy", () => {
  assert.equal(wrapUpBudget({ tag: "Budgeted", budget: 1 }), 1);
  assert.equal(wrapUpBudget({ tag: "Budgeted", budget: 0 }), 0);
  assert.equal(wrapUpBudget({ tag: "DeadlineOnly" }), 0);
  assert.equal(reworkBudget({ tag: "RWBudget", budget: 1 }), 1);
  assert.equal(reworkBudget({ tag: "RWBudget", budget: 4 }), 4);
  // The account radices the measure flattens with, at the three instances.
  assert.equal(radix(wrapUpBudget(bBudgeted.wrapUpPricing)), 2);
  assert.equal(radix(wrapUpBudget(bDeadlineOnly.wrapUpPricing)), 1);
  assert.equal(radix(reworkBudget(bBudgeted.reworkPolicy)), 2);
});

// === The rank ladder =======================================================

test("the ladder is a strict chain and every phase takes its rung", () => {
  assert.deepEqual(
    [
      rankSettled,
      rankHolding,
      rankWrapUp,
      rankEvaluating,
      rankWorking,
      rankPending,
      rankDraft,
    ],
    [0, 1, 2, 3, 4, 5, 6],
  );
  const ranks = (
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
    ] satisfies Phase[]
  ).map(phaseRank);
  // The settled tier is the model's wildcard arm: Done, Escalated and Revoked
  // all take rankSettled — revoke and every wall drop straight to settled.
  assert.deepEqual(ranks, [6, 5, 4, 3, 2, 1, 0, 0, 0]);
});

test("hasOpenHumanTask is the parked phase and nothing else", () => {
  // THE WHOLE ROSTER, not a sample. The predicate is an iff over the nine
  // phases — PEscalated is THE parked phase — and asking only the four that
  // seemed interesting left it WIDENABLE: `=== "PEscalated" ||
  // === "PWrapUpHolding"` passed the suite unchanged. It is load-bearing
  // downstream (`model/domain.qnt` coveredSet; the CHURN set's boundedness
  // rests on every churn step needing an open desk task), so a widened
  // predicate would quietly widen that argument too.
  const j = draft(cfgBudgeted);
  for (const phase of PHASES) {
    assert.equal(
      hasOpenHumanTask({ ...j, phase }),
      phase === "PEscalated",
      `hasOpenHumanTask is an iff over the roster; ${phase} disagrees`,
    );
  }
  // PRevoked is the one a reader expects to be here and deliberately is not:
  // revocation is the author's settled choice, so the desk owes a revoked
  // ticket nothing (chuggy_test revokeFromEachPhaseTest's `revokedShape`).
  assert.ok(!hasOpenHumanTask({ ...j, phase: "PRevoked" }));
});

// === The digit functions ===================================================

test("runningCount counts only the running half of the lifecycle", () => {
  assert.equal(runningCount([]), 0);
  assert.equal(runningCount([wr(1), wr(2)]), 2);
  assert.equal(runningCount([wt(1, "TPassed"), wr(2)]), 1);
  assert.equal(runningCount([wt(1, "TPassed"), wt(2, "TFailed")]), 0);
  assert.equal(runningCount([wt(1, "TCancelled")]), 0);
});

test("evalStage derives the current stage from the live set's kind marks", () => {
  assert.equal(evalStage([]), 0);
  // A work set carries no eval mark, so the fold's base survives.
  assert.equal(evalStage([wr(1), wr(2)]), 0);
  assert.equal(evalStage([er(3, 0), er(4, 0)]), 0);
  assert.equal(evalStage([er(4, 1), er(5, 1)]), 1);
  assert.equal(evalStage([et(3, 0, "TPassed")]), 0);
});

test("stagesLeft is the stage digit: L - s while Evaluating, 0 everywhere else", () => {
  const j = draft(cfgBudgeted, progStaged);
  // Evaluating stage 0 of a two-stage program: two stages have not passed.
  assert.equal(
    stagesLeft({ ...j, phase: "PEvaluating", tasks: [er(1, 0)] }),
    2,
  );
  assert.equal(
    stagesLeft({ ...j, phase: "PEvaluating", tasks: [er(2, 1), er(3, 1)] }),
    1,
  );
  // The single-stage default program: the digit appears at 1.
  const flat = draft(cfgBudgeted);
  assert.equal(
    stagesLeft({ ...flat, phase: "PEvaluating", tasks: [er(1, 0), er(2, 0)] }),
    1,
  );
  // Zero in every other phase — including one carrying eval tasks, which no
  // reachable state does but which is what "0 in every other phase" means.
  for (const phase of [
    "PDraft",
    "PPending",
    "PWorking",
    "PWrapUp",
    "PWrapUpHolding",
    "PDone",
    "PEscalated",
    "PRevoked",
  ] satisfies Phase[]) {
    assert.equal(
      stagesLeft({ ...j, phase, tasks: [er(1, 0)] }),
      0,
      `the stage digit is 0 outside Evaluating; ${phase} disagrees`,
    );
  }
});

// === ticketMeasure and sysMeasure, pinned at the mc consts =================

test("a fresh Draft's whole measure, at each instance's grants", () => {
  // Budgeted: ((3*2 + 1)*2 + 1) * 63 + 6*9 = 15*63 + 54 = 999.
  assert.equal(ticketMeasure(bBudgeted, draft(cfgBudgeted)), 999);
  // DeadlineOnly: the gate account's radix collapses to 1.
  assert.equal(ticketMeasure(bDeadlineOnly, draft(cfgDeadlineOnly)), 495);
  // RetryFree: same bounds as deadline-only, two gas rather than three.
  assert.equal(ticketMeasure(bRetryFree, draft(cfgRetryFree)), 369);
});

test("sysMeasure sums the fleet, order-independently", () => {
  const one = draft(cfgBudgeted);
  const two: Ticket = { ...one, deps: new Set([1]) };
  assert.equal(sysMeasure(bBudgeted, new Map()), 0);
  assert.equal(
    sysMeasure(bBudgeted, new Map([[1, one]])),
    ticketMeasure(bBudgeted, one),
  );
  assert.equal(
    sysMeasure(
      bBudgeted,
      new Map([
        [1, one],
        [2, two],
      ]),
    ),
    1998,
  );
  // Addition commutes, so the map's iteration order cannot be read out.
  assert.equal(
    sysMeasure(
      bBudgeted,
      new Map([
        [2, two],
        [1, one],
      ]),
    ),
    1998,
  );
});

// === The blindness pins ====================================================
// The revoke suite's part-spent fixtures come from `fixtures.test.ts` — the
// model has one `jDraft` and so does this tree.

test("the revoke fixtures' measures, phase by phase (the ladder, flattened)", () => {
  // Read from the model. The account digits are the same across all seven, so
  // the spread between them IS the rank ladder times rankWeight, plus jWork's
  // two running tasks and jEval's stage digit.
  assert.deepEqual(
    measuresAt(bBudgeted, [jDraft, jPend, jWork, jEval, jLand, jGated, jEsc]),
    [684, 675, 668, 660, 648, 639, 630],
  );
  assert.deepEqual(
    [jDraft, jPend, jWork, jEval, jLand, jGated, jEsc].map((j) =>
      micro(bBudgeted, j),
    ),
    [54, 45, 38, 30, 18, 9, 0],
  );
});

test("measureArtifactBlindTest: the artifact mark is vocabulary, not a digit", () => {
  const withMark = (j: Ticket, id: number): Ticket => ({
    ...j,
    artifact: { tag: "ASome", id },
  });
  assert.equal(
    ticketMeasure(bBudgeted, jPend),
    ticketMeasure(bBudgeted, withMark(jPend, 3)),
  );
  assert.equal(
    ticketMeasure(bBudgeted, jWork),
    ticketMeasure(bBudgeted, withMark(jWork, 9)),
  );
  assert.equal(
    ticketMeasure(bBudgeted, jEval),
    ticketMeasure(bBudgeted, withMark(jEval, 1)),
  );
  assert.equal(
    ticketMeasure(bBudgeted, jLand),
    ticketMeasure(bBudgeted, withMark(jLand, 4)),
  );
  assert.equal(
    ticketMeasure(bDeadlineOnly, jWork),
    ticketMeasure(bDeadlineOnly, withMark(jWork, 2)),
  );
  // Two DIFFERENT marks, so a measure reading the mark's value fails here even
  // if it happened to treat ANone and ASome alike.
  assert.equal(
    ticketMeasure(bBudgeted, withMark(jEval, 1)),
    ticketMeasure(bBudgeted, withMark(jEval, 99)),
  );
});

test("measureRepoBlindTest: no digit, weight or account radix reads the repo", () => {
  const elsewhere = (j: Ticket): Ticket => ({ ...j, repo: 2 });
  const escLanding = escalated(
    { ...draft(cfgBudgeted), gasLeft: 2 },
    "RsGasExhausted",
    "RWrapUp",
    "ticket-escalated gas_exhausted",
  );
  for (const j of [jDraft, jPend, jWork, jEval, jLand, jGated, escLanding]) {
    assert.equal(
      ticketMeasure(bBudgeted, j),
      ticketMeasure(bBudgeted, elsewhere(j)),
      `the measure reads the repo from ${j.phase}`,
    );
  }
  // And under the other gate pricing, where the account radices differ.
  assert.equal(
    ticketMeasure(bDeadlineOnly, jWork),
    ticketMeasure(bDeadlineOnly, elsewhere(jWork)),
  );
  // The model's own figure for that cross-instance evaluation. LOAD-BEARING,
  // and precisely: `jWork` under these bounds is the only fixture in the file
  // with a NON-ZERO wrapUpLeft measured under bounds whose two account radices
  // DIFFER — `radix(wrapUpBudget(DeadlineOnly))` is 1 against
  // `radix(reworkBudget(RWBudget(1)))` of 2. That combination is what catches
  // the two radices being swapped, because the swap changes the flattening by
  // `wrapUpLeft * (rework radix - wrapUp radix)` and nothing else: with the
  // middle digit 0 the two multiplications commute, and under Budgeted bounds
  // the radices are equal, so every other absolute pin in the file (495, 324,
  // 227, 315, 333, 369 included) survives the swap unchanged. Verified: the
  // swap reddens this one line, 416 against 353, and nothing else in 44 tests.
  // Do not delete it as redundant.
  assert.equal(ticketMeasure(bDeadlineOnly, jWork), 416);
});

test("the accounts of a Budgeted ticket escape their radix under DeadlineOnly bounds", () => {
  // Why `ticketMeasure` asserts no upper account bound: the model's blindness
  // runs measure a Budgeted(1)-born ticket at DeadlineOnly bounds, where the
  // gate digit's radix is 1 and the digit is 1. The blindness still holds —
  // both sides climb identically — so the pin above is real, but the
  // lexicographic reading of the flattening is not owed there. The predicate
  // says so out loud rather than the code assuming it.
  assert.ok(accountDigitsInRange(bBudgeted, jWork));
  assert.ok(!accountDigitsInRange(bDeadlineOnly, jWork));
  assert.ok(accountDigitsInRange(bDeadlineOnly, draft(cfgDeadlineOnly)));
  // Gas has a lower bound only: it is the top digit and Bounds carries no
  // grant for it.
  assert.ok(accountDigitsInRange(bBudgeted, { ...jWork, gasLeft: 99 }));
  assert.ok(!accountDigitsInRange(bBudgeted, { ...jWork, gasLeft: -1 }));
  // ONE CONJUNCT PER LINE, all five. Three of them — both reworkLeft bounds
  // and wrapUpLeft's lower one — could be deleted with the suite still green
  // when only the other two were pinned. s2a/s2b are the callers that will
  // rely on this predicate to know when the flattening may be read
  // lexicographically, so an unpinned conjunct is a promise nothing keeps.
  assert.ok(!accountDigitsInRange(bBudgeted, { ...jWork, wrapUpLeft: -1 }));
  assert.ok(!accountDigitsInRange(bBudgeted, { ...jWork, reworkLeft: -1 }));
  assert.ok(
    !accountDigitsInRange(bBudgeted, {
      ...jWork,
      reworkLeft: reworkBudget(bBudgeted.reworkPolicy) + 1,
    }),
  );
  // And the boundary itself is IN range on both accounts — a `<` written for
  // a `<=` would pass every negative case above.
  assert.ok(
    accountDigitsInRange(bBudgeted, {
      ...jWork,
      wrapUpLeft: wrapUpBudget(bBudgeted.wrapUpPricing),
      reworkLeft: reworkBudget(bBudgeted.reworkPolicy),
    }),
  );
});

// === The descent table, row by row, at measure grain =======================
// Each row cites the label from `model/measure.qnt`'s descent table and the
// `chuggy_test` run whose measure conjunct it mirrors.

test("happyPathMeasureDescendsTest: every step of the happy path descends", () => {
  // THE WALK IS THE DECIDERS' OWN, one solo Core stepped through the model's
  // chain: release, dispatch, both work completions, the work reduce, both
  // eval completions, the eval reduce, and the quiet landing. What this file
  // adds is the measure at each state; what the state IS belongs to the
  // decider that produced it (issue #13).
  const cA = draft(cfgBudgeted);
  const cP = stepped(decideRelease(solo(cA), 1));
  const cW = stepped(decideDispatch(cfgBudgeted, solo(cP), 1));
  const cW1 = stepped(decideTaskDone(solo(cW), 1, 1, "VPass"));
  const cW2 = stepped(decideTaskDone(solo(cW1), 1, 2, "VPass"));
  const cE = stepped(decideWorkReduce(solo(cW2), 1));
  const cE1 = stepped(decideTaskDone(solo(cE), 1, 3, "VPass"));
  const cE2 = stepped(decideTaskDone(solo(cE1), 1, 4, "VPass"));
  const cL = stepped(decideEvalStageReduce(cfgBudgeted, solo(cE2), 1));
  const cD = stepped(
    decideWrapUpResolve(cfgBudgeted, solo(cL), 1, "WOk", false),
  );

  // The model's own figures for the whole walk, in order.
  assert.deepEqual(
    measuresAt(bBudgeted, [cA, cP, cW, cW1, cW2, cE, cE1, cE2, cL, cD]),
    [999, 990, 731, 730, 729, 725, 724, 723, 711, 693],
  );
  // ticket-released (rank 6->5), dispatch (gas), task-done x2 (count),
  // work-passed (rank 4->3 over the appearing stage digit AND the fan-out),
  // task-done x2, eval-passed (rank 3->2), ticket-done (rank 2->0).
  const walk = [cA, cP, cW, cW1, cW2, cE, cE1, cE2, cL, cD];
  for (let i = 1; i < walk.length; i += 1) {
    const pre = walk[i - 1];
    const post = walk[i];
    assert.ok(pre !== undefined && post !== undefined);
    assert.ok(descends(bBudgeted, pre, post), `step ${String(i)} descends`);
  }
  // The intermediate anatomy the model pins alongside: the work set is retired
  // and the eval stage is live above it (happyPathRetainedRecordTest), and the
  // ghost counter equals retired + live at every point
  // (happyPathIdsAccountedTest).
  assert.deepEqual(cE.record, [wt(1, "TPassed"), wt(2, "TPassed")]);
  assert.deepEqual(cE.tasks, [er(3, 0), er(4, 0)]);
  assert.deepEqual(cD.record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
    et(3, 0, "TPassed"),
    et(4, 0, "TPassed"),
  ]);
  assert.deepEqual(
    [cA.spawned, cW.spawned, cE.spawned, cD.spawned],
    [0, 2, 4, 4],
  );
  for (const c of [cA, cW, cE, cD]) {
    assert.equal(
      c.spawned,
      c.record.length + c.tasks.length,
      `spawned != retired + live at ${c.phase}`,
    );
  }
});

test("workFailedWallTest / evalWallsNamedTest: every wall descends by rank", () => {
  const base = draft(cfgBudgeted);
  const workFail: Ticket = {
    ...base,
    phase: "PWorking",
    gasLeft: 2,
    tasks: [wt(1, "TFailed"), wt(2, "TPassed")],
    spawned: 2,
  };
  assert.deepEqual(
    measuresAt(bBudgeted, [
      workFail,
      escalated(
        workFail,
        "RsWorkFailed",
        "RWorking",
        "ticket-escalated work_failed",
      ),
    ]),
    [729, 693],
  );

  const oneFailedE0: TaskSet = [et(1, 0, "TFailed"), et(2, 0, "TPassed")];
  const reworkWall: Ticket = {
    ...base,
    phase: "PEvaluating",
    reworkLeft: 0,
    gasLeft: 2,
    tasks: oneFailedE0,
    spawned: 2,
  };
  assert.deepEqual(
    measuresAt(bBudgeted, [
      reworkWall,
      escalated(
        reworkWall,
        "RsReworkBudgetExhausted",
        "REvaluating",
        "ticket-escalated rework_budget_exhausted",
      ),
    ]),
    [660, 630],
  );

  const gasWall: Ticket = { ...reworkWall, reworkLeft: 1, gasLeft: 0 };
  assert.deepEqual(
    measuresAt(bBudgeted, [
      gasWall,
      escalated(
        gasWall,
        "RsGasExhausted",
        "REvaluating",
        "ticket-escalated gas_exhausted",
      ),
    ]),
    [219, 189],
  );
});

test("gateWallsNamedTest: both gate walls descend out of the held lease", () => {
  // The eval-side walls are pinned above; these are the LANDING-side pair, and
  // they were claimed as mirrored in round 0 without actually being written.
  // The budget wall is the one PLAN.md records as unreachable by trace
  // sampling (`ticket-escalated wrapup_budget_exhausted`), which makes a unit
  // pin on it worth more than the usual, not less.
  const base = draft(cfgBudgeted);
  const budgetWall: Ticket = {
    ...base,
    phase: "PWrapUpHolding",
    wrapUpLeft: 0,
    gasLeft: 2,
  };
  assert.deepEqual(
    measuresAt(bBudgeted, [
      budgetWall,
      escalated(
        budgetWall,
        "RsWrapUpBudgetExhausted",
        "RWrapUp",
        "ticket-escalated wrapup_budget_exhausted",
      ),
    ]),
    [576, 567],
  );
  // Budgeted, gas wall: the gate account remains and the gas is gone. Rank
  // 1 -> 0 with every account still, so the descent is the rank's alone.
  const gasWall: Ticket = { ...budgetWall, wrapUpLeft: 1, gasLeft: 0 };
  assert.deepEqual(
    measuresAt(bBudgeted, [
      gasWall,
      escalated(
        gasWall,
        "RsGasExhausted",
        "RWrapUp",
        "ticket-escalated gas_exhausted",
      ),
    ]),
    [198, 189],
  );
});

test("stagedProgramPassesTest: the FINAL stage passing lands the program", () => {
  // eval-passed reached from a STAGED program rather than the flat one the
  // happy path walks: rank 3 -> 2 AND the stage digit 1 -> 0 together.
  const finalStage: Ticket = {
    ...draft(cfgBudgeted, progStaged),
    phase: "PEvaluating",
    gasLeft: 2,
    record: [wt(1, "TPassed"), wt(2, "TPassed"), et(3, 0, "TPassed")],
    spawned: 5,
    tasks: [et(4, 1, "TPassed"), et(5, 1, "TFailed")],
    artifact: { tag: "ASome", id: 2 },
  };
  const landed = stepped(
    decideEvalStageReduce(cfgBudgeted, solo(finalStage), 1),
  );
  assert.ok(descends(bBudgeted, finalStage, landed));
  assert.deepEqual(measuresAt(bBudgeted, [finalStage, landed]), [723, 711]);
  // The whole anatomy is in the log, per-stage combinators applied — stage 1's
  // CAnyPass passed on a mixed set, and the mixed set is retained as it fell.
  assert.deepEqual(landed.record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
    et(3, 0, "TPassed"),
    et(4, 1, "TPassed"),
    et(5, 1, "TFailed"),
  ]);
  assert.ok(combine("CAnyPass", finalStage.tasks));
  assert.ok(!combine("CUnanimousPass", finalStage.tasks));
});

test("evalReworkDescendsTest: the eval rework's account drop dominates its micro reset", () => {
  // rank 3->4, the stage digit to 0 and a fresh work fan-out all CLIMB micro;
  // one rework plus one gas outweigh the lot.
  const pre: Ticket = {
    ...draft(cfgBudgeted),
    phase: "PEvaluating",
    reworkLeft: 1,
    gasLeft: 2,
    tasks: [et(1, 0, "TFailed"), et(2, 0, "TPassed")],
    spawned: 2,
  };
  const post = reworkedFromEval(cfgBudgeted, pre);
  assert.deepEqual(measuresAt(bBudgeted, [pre, post]), [723, 416]);
  // The charge is the DECIDER's now, not this file's: one rework and one gas.
  assert.deepEqual([post.reworkLeft, post.gasLeft], [0, 1]);
  // The rework cycle's work set spawns at the NEXT ids — new records, not
  // overwrites (evalReworkDescendsTest pins exactly this).
  assert.deepEqual(post.tasks, [wr(3), wr(4)]);
  assert.deepEqual(post.record, [et(1, 0, "TFailed"), et(2, 0, "TPassed")]);
});

test("gateReworkBudgetedDescendsTest / gateReworkDeadlineOnlyTest: the eviction is priced by gas either way", () => {
  const budgeted: Ticket = {
    ...draft(cfgBudgeted),
    phase: "PWrapUpHolding",
    wrapUpLeft: 1,
    gasLeft: 2,
  };
  const evicted = reworkedFromGate(cfgBudgeted, budgeted);
  assert.deepEqual(measuresAt(bBudgeted, [budgeted, evicted]), [702, 353]);
  assert.deepEqual([evicted.wrapUpLeft, evicted.gasLeft], [0, 1]);
  // DeadlineOnly: no gate account to spend, so gas alone meters the loop.
  const deadlineOnly: Ticket = {
    ...draft(cfgDeadlineOnly),
    phase: "PWrapUpHolding",
    gasLeft: 2,
  };
  const evictedFree = reworkedFromGate(cfgDeadlineOnly, deadlineOnly);
  assert.deepEqual(
    measuresAt(bDeadlineOnly, [deadlineOnly, evictedFree]),
    [324, 227],
  );
  assert.equal(evictedFree.gasLeft, 1);
});

test("gateOpenClassifiedTest: the dequeue and the landing each descend by rank alone", () => {
  const enqueued: Ticket = { ...draft(cfgBudgeted), phase: "PWrapUp" };
  const held = stepped(decideWrapUpStart(solo(enqueued), 1));
  const done = stepped(
    decideWrapUpResolve(cfgBudgeted, solo(held), 1, "WOk", true),
  );
  // No account moves at the gate: it charges nothing until it fails.
  assert.deepEqual(
    [held.gasLeft, held.wrapUpLeft],
    [enqueued.gasLeft, enqueued.wrapUpLeft],
  );
  assert.ok(descends(bBudgeted, enqueued, held));
  assert.ok(descends(bBudgeted, held, done));
});

test("revokeMeasureClassifiedTest: revoke descends from every live rank and is flat from the desk", () => {
  for (const j of [jDraft, jPend, jWork, jEval, jLand, jGated]) {
    assert.ok(descends(bBudgeted, j, revoked(j)), `revoke from ${j.phase}`);
  }
  // The desk flavors are rank 0 already: revoking a parked ticket with nobody
  // to cascade onto is exactly flat — the AUTHORING set's bounded member.
  for (const j of [jEsc, jParkPre, jParkDep]) {
    assert.equal(
      ticketMeasure(bBudgeted, revoked(j)),
      ticketMeasure(bBudgeted, j),
      `the desk-only revoke is not flat for reason ${j.reason}`,
    );
  }
  // Revoke charges nothing, account by account (chuggy_test
  // `accountsUntouched`), which is why the flat cases are flat.
  const after = revoked(jGated);
  assert.deepEqual(
    [after.gasLeft, after.reworkLeft, after.wrapUpLeft],
    [jGated.gasLeft, jGated.reworkLeft, jGated.wrapUpLeft],
  );
});

test("releaseDescendsTest / arrivalTest: authoring's one descent and its one climb", () => {
  const arrived = draft(cfgBudgeted);
  const released = stepped(decideRelease(solo(arrived), 1));
  assert.ok(descends(bBudgeted, arrived, released));
  // AUTHORING: arrival climbs by the fresh Draft's WHOLE ticketMeasure, which
  // is what makes it the set's only climbing member and why it is bounded by
  // the arrival cap rather than by a digit.
  const empty = new Map<number, Ticket>();
  const one = new Map([[1, arrived]]);
  const two = new Map([
    [1, arrived],
    [2, { ...arrived, deps: new Set([1]) }],
  ]);
  assert.ok(sysMeasure(bBudgeted, one) > sysMeasure(bBudgeted, empty));
  assert.ok(sysMeasure(bBudgeted, two) > sysMeasure(bBudgeted, one));
  assert.equal(
    sysMeasure(bBudgeted, two) - sysMeasure(bBudgeted, one),
    ticketMeasure(bBudgeted, arrived),
  );
});

// === The named non-descending sets =========================================

test("STUTTER: a duplicate or stale completion leaves the measure exactly unchanged", () => {
  // duplicateTaskDoneIdempotentTest / staleStageCompletionNoopsTest /
  // staleStageDuplicateNoopsTest, at the grain that owns the idempotence:
  // first write wins, so the post-state IS the pre-state.
  const live: TaskSet = [wt(1, "TPassed"), wr(2)];
  const contradicting = resolveTask(live, 1, "TFailed");
  assert.deepEqual(contradicting, live);
  // A completion for an id already retired out of the live set finds no
  // running match and absorbs the same way.
  const retired = resolveTask(live, 9, "TFailed");
  assert.deepEqual(retired, live);

  const working: Ticket = {
    ...draft(cfgBudgeted),
    phase: "PWorking",
    tasks: live,
    spawned: live.length,
  };
  const after: Ticket = { ...working, tasks: contradicting };
  assert.equal(
    ticketMeasure(bBudgeted, after),
    ticketMeasure(bBudgeted, working),
  );
  // And through the decider that owns the absorption, where the claim is
  // identity rather than equal measure: a re-delivered completion for a
  // resolved task returns the observed ticket itself.
  assert.deepEqual(
    stepped(decideTaskDone(solo(working), 1, 1, "VFail")),
    working,
  );
});

test("CHURN: the pre-work resume is free and climbs; a charged resume descends", () => {
  // preWorkParkAndResumeClassifiedTest: the park descends (rank 5->0, free),
  // and the RPending resume climbs back by exactly the same rank — nothing was
  // ever spent on a pre-work park.
  const pending: Ticket = { ...draft(cfgBudgeted), phase: "PPending" };
  const parked = escalated(
    pending,
    "RsRevalidationFailed",
    "RPending",
    "ticket-escalated revalidation_failed",
  );
  const resumed = resumedBy(cfgBudgeted, parked);
  assert.deepEqual(
    measuresAt(bBudgeted, [pending, parked, resumed]),
    [990, 945, 990],
  );
  assert.ok(descends(bBudgeted, pending, parked));
  assert.ok(
    ticketMeasure(bBudgeted, resumed) > ticketMeasure(bBudgeted, parked),
  );
  assert.equal(resumed.gasLeft, parked.gasLeft);

  // opRetryChargedDescendsTest: under the default metering a pipeline resume
  // pays one gas, and the gas drop dominates the rank climb back.
  const escLanding = escalated(
    { ...draft(cfgBudgeted), gasLeft: 2 },
    "RsGasExhausted",
    "RWrapUp",
    "ticket-escalated gas_exhausted",
  );
  const chargedResume = resumedBy(cfgBudgeted, escLanding);
  assert.deepEqual(
    measuresAt(bBudgeted, [escLanding, chargedResume]),
    [693, 459],
  );
  assert.equal(chargedResume.gasLeft, escLanding.gasLeft - 1);
  assert.ok(descends(bBudgeted, escLanding, chargedResume));
});

test("opRetryFreeClassifiedTest: under RetryFree the pipeline resume CLIMBS", () => {
  // The exemption arm the retryfree instance exists to keep exercised. The
  // bounds are the deadline-only ones — nothing about the measure changed; the
  // resume simply charged nothing.
  const escLanding = escalated(
    { ...draft(cfgRetryFree), gasLeft: 2 },
    "RsGasExhausted",
    "RWrapUp",
    "ticket-escalated gas_exhausted",
  );
  const freeResume = resumedBy(cfgRetryFree, escLanding);
  assert.deepEqual(
    measuresAt(bRetryFree, [escLanding, freeResume]),
    [315, 333],
  );
  assert.equal(freeResume.gasLeft, escLanding.gasLeft); // NOT charged
  assert.ok(
    ticketMeasure(bRetryFree, freeResume) >
      ticketMeasure(bRetryFree, escLanding),
  );
  // Charged, the same resume descends — which is the whole of the difference
  // between the two meterings, priced in gas rather than in bounds. The config
  // below differs from the free one in the retry pricing and nothing else, so
  // the comparison isolates exactly that parameter.
  const chargedResume = resumedBy(
    { ...cfgRetryFree, opRetryPricing: "RetryCharged" },
    escLanding,
  );
  assert.equal(chargedResume.gasLeft, freeResume.gasLeft - 1);
  assert.ok(descends(bRetryFree, escLanding, chargedResume));
});

// === The digit-order argument ==============================================
// The two dominance claims `model/measure.qnt`'s header derives the weights
// from. Each is stated as a descent that a FLATTENED weight would reverse.

test("stageAdvanceDescendsTest: one stage step outweighs the whole next fan-out", () => {
  // The advance retires a fully-resolved stage (running 0) and spawns the next
  // stage's fan-out, so the count JUMPS 0 -> 2 in the same step while
  // stagesLeft falls by exactly 1. With stageWeight flattened to the count's
  // own weight the step would CLIMB and the machine's cleanest progress step
  // would need an exemption.
  const staged: Ticket = {
    ...draft(cfgBudgeted, progStaged),
    phase: "PEvaluating",
    gasLeft: 2,
    record: [wt(1, "TPassed"), wt(2, "TPassed")],
    spawned: 3,
    tasks: [et(3, 0, "TPassed")],
    artifact: { tag: "ASome", id: 2 },
  };
  const advanced = stepped(decideEvalStageReduce(cfgBudgeted, solo(staged), 1));
  assert.deepEqual([stagesLeft(staged), runningCount(staged.tasks)], [2, 0]);
  assert.deepEqual(
    [stagesLeft(advanced), runningCount(advanced.tasks)],
    [1, 2],
  );
  // THE CLAIM, asserted before any pinned integer, so that flattening the
  // weight is shown to reverse the ORDER rather than merely to move a constant.
  assert.ok(descends(bBudgeted, staged, advanced));
  assert.ok(micro(bBudgeted, advanced) < micro(bBudgeted, staged));
  assert.deepEqual(
    [micro(bBudgeted, staged), micro(bBudgeted, advanced)],
    [33, 32],
  );
  assert.deepEqual(measuresAt(bBudgeted, [staged, advanced]), [726, 725]);
  // No account moved: stage progress is priced by the digit, not by gas.
  assert.deepEqual(
    [advanced.gasLeft, advanced.reworkLeft, advanced.wrapUpLeft],
    [staged.gasLeft, staged.reworkLeft, staged.wrapUpLeft],
  );
  assert.deepEqual(advanced.tasks, [er(4, 1), er(5, 1)]);
  assert.deepEqual(advanced.record, [
    wt(1, "TPassed"),
    wt(2, "TPassed"),
    et(3, 0, "TPassed"),
  ]);
});

test("work-passed: one rank step outweighs the stage digit APPEARING and the fan-out spawning at once", () => {
  // The bound rankWeight is defined to exceed: entering Evaluating takes
  // stagesLeft from 0 to L <= maxStages while running goes 0 -> fanout, and
  // the single rank step 4 -> 3 must dominate both together.
  const worked: Ticket = {
    ...draft(cfgBudgeted, progStaged),
    phase: "PWorking",
    gasLeft: 2,
    tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
    spawned: 2,
  };
  const evaluating = stepped(decideWorkReduce(solo(worked), 1));
  assert.deepEqual([stagesLeft(worked), runningCount(worked.tasks)], [0, 0]);
  assert.deepEqual(
    [stagesLeft(evaluating), runningCount(evaluating.tasks)],
    [2, 1],
  );
  // THE CLAIM first, the pinned integers after — the same reason as above.
  assert.ok(descends(bBudgeted, worked, evaluating));
  assert.ok(micro(bBudgeted, evaluating) < micro(bBudgeted, worked));
  assert.deepEqual(measuresAt(bBudgeted, [worked, evaluating]), [729, 727]);

  // The worst case the bound is written for, stated directly: the maximum
  // stage digit plus the maximum count still costs less than one rank step.
  const b = bBudgeted;
  assert.ok(rankWeight(b) > b.maxStages * stageWeight(b) + b.nTasks);
});

test("one unit of any account outweighs the whole of micro", () => {
  // The domination chain above micro: micro < microBound, so one reworkLeft
  // outweighs any within-cycle climb, one wrapUpLeft outweighs any rework
  // refill, and one gas outweighs everything below it. Stated as the extreme
  // pair: the largest micro a ticket can carry, against one more unit of the
  // account above it.
  const topMicro: Ticket = {
    ...draft(cfgBudgeted),
    phase: "PDraft",
    reworkLeft: 0,
    wrapUpLeft: 0,
    gasLeft: 0,
  };
  const oneRework: Ticket = { ...topMicro, phase: "PDone", reworkLeft: 1 };
  const oneWrapUp: Ticket = {
    ...topMicro,
    phase: "PDone",
    wrapUpLeft: 1,
    reworkLeft: 1,
  };
  const oneGas: Ticket = { ...topMicro, phase: "PDone", gasLeft: 1 };
  assert.ok(micro(bBudgeted, topMicro) < microBound(bBudgeted));
  assert.ok(
    ticketMeasure(bBudgeted, oneRework) > ticketMeasure(bBudgeted, topMicro),
  );
  assert.ok(
    ticketMeasure(bBudgeted, oneWrapUp) >
      ticketMeasure(bBudgeted, { ...topMicro, reworkLeft: 1 }),
  );
  assert.ok(
    ticketMeasure(bBudgeted, oneGas) >
      ticketMeasure(bBudgeted, { ...topMicro, wrapUpLeft: 1, reworkLeft: 1 }),
  );
});

test("the flattened integer order IS the lexicographic order, exhaustively at the mc consts", () => {
  // The whole claim the radix weighting exists to make, checked over every
  // realizable digit combination at these bounds rather than argued. The
  // oracle is independent: each shape DECLARES its (rank, stagesLeft, running)
  // triple, the declaration is checked against the derivations, and the
  // lexicographic comparison then reads the declaration.
  type Shape = {
    readonly phase: Phase;
    readonly program: readonly Stage[];
    readonly tasks: TaskSet;
    readonly digits: readonly [number, number, number];
  };
  const evalShape = (
    stage: number,
    fanout: number,
    running: number,
    program: readonly Stage[],
    stagesDigit: number,
  ): Shape => ({
    phase: "PEvaluating",
    program,
    tasks: Array.from({ length: fanout }, (_, i) =>
      i < running ? er(i + 1, stage) : et(i + 1, stage, "TPassed"),
    ),
    digits: [rankEvaluating, stagesDigit, running],
  });
  const shapes: readonly Shape[] = [
    { phase: "PDraft", program: progU2, tasks: [], digits: [rankDraft, 0, 0] },
    {
      phase: "PPending",
      program: progU2,
      tasks: [],
      digits: [rankPending, 0, 0],
    },
    {
      phase: "PWrapUp",
      program: progU2,
      tasks: [],
      digits: [rankWrapUp, 0, 0],
    },
    {
      phase: "PWrapUpHolding",
      program: progU2,
      tasks: [],
      digits: [rankHolding, 0, 0],
    },
    { phase: "PDone", program: progU2, tasks: [], digits: [rankSettled, 0, 0] },
    ...[0, 1, 2].map((running) => ({
      phase: "PWorking" as const,
      program: progU2,
      tasks: Array.from({ length: 2 }, (_, i) =>
        i < running ? wr(i + 1) : wt(i + 1, "TPassed"),
      ),
      digits: [rankWorking, 0, running] as const,
    })),
    ...[0, 1, 2].map((r) => evalShape(0, 2, r, progU2, 1)),
    ...[0, 1].map((r) => evalShape(0, 1, r, progStaged, 2)),
    ...[0, 1, 2].map((r) => evalShape(1, 2, r, progStaged, 1)),
  ];

  const b = bBudgeted;
  const space: { ticket: Ticket; digits: readonly number[] }[] = [];
  for (let gas = 0; gas <= cfgBudgeted.gas; gas += 1) {
    for (let wrapUp = 0; wrapUp <= wrapUpBudget(b.wrapUpPricing); wrapUp += 1) {
      for (
        let rework = 0;
        rework <= reworkBudget(b.reworkPolicy);
        rework += 1
      ) {
        for (const shape of shapes) {
          const ticket: Ticket = {
            ...draft(cfgBudgeted, shape.program),
            phase: shape.phase,
            tasks: shape.tasks,
            gasLeft: gas,
            wrapUpLeft: wrapUp,
            reworkLeft: rework,
          };
          // The declaration IS the oracle, so it is checked first.
          const where = `${ticket.phase} with ${String(ticket.tasks.length)} task(s) over a ${String(ticket.program.length)}-stage program, accounts (${String(gas)}, ${String(wrapUp)}, ${String(rework)})`;
          assert.deepEqual(
            [
              phaseRank(ticket.phase),
              stagesLeft(ticket),
              runningCount(ticket.tasks),
            ],
            [...shape.digits],
            `the shape's declared digits disagree with the derivations: ${where}`,
          );
          assert.ok(
            accountDigitsInRange(b, ticket),
            `the enumerated space must stay inside the radices: ${where}`,
          );
          space.push({
            ticket,
            digits: [gas, wrapUp, rework, ...shape.digits],
          });
        }
      }
    }
  }
  assert.equal(space.length, 4 * 2 * 2 * 16);

  const lexCompare = (x: readonly number[], y: readonly number[]): number => {
    for (let i = 0; i < x.length; i += 1) {
      const a = x[i];
      const c = y[i];
      // Guarded, not `assert.ok(cond, msg)` — the same eager-message shape the
      // outer loop already avoids, and it landed here in the round-1 fix. This
      // is the INNER loop: two `Array.join`s per digit index per pair, so the
      // message that never prints was the most expensive thing in the test.
      if (a === undefined || c === undefined) {
        assert.fail(
          `digit tuples are the same width; index ${String(i)} is missing from one of [${x.join(",")}] / [${y.join(",")}]`,
        );
      }
      if (a !== c) {
        return a < c ? -1 : 1;
      }
    }
    return 0;
  };
  for (const left of space) {
    for (const right of space) {
      // The failing case is NAMED — with 65,536 pairs a bare `1 !== -1` is a
      // failure the reader then has to re-derive the inputs for — but the
      // message is built only when the comparison actually disagrees. An
      // `assert.equal(a, b, msg)` here would interpolate two tuples and two
      // extra measures on every one of the 65,536 passes, which is the same
      // eager-message cost this slice just hoisted out of `stagesLeft`.
      const got = Math.sign(
        ticketMeasure(b, left.ticket) - ticketMeasure(b, right.ticket),
      );
      const want = lexCompare(left.digits, right.digits);
      if (got !== want) {
        assert.fail(
          `integer order and lexicographic order disagree: digits [${left.digits.join(",")}] (measure ${String(ticketMeasure(b, left.ticket))}) vs [${right.digits.join(",")}] (measure ${String(ticketMeasure(b, right.ticket))}) — got ${String(got)}, want ${String(want)}`,
        );
      }
    }
  }
});

// === The task plumbing =====================================================

test("spawnTasks / nextTaskId / spawnOn keep identity sequential across the whole history", () => {
  assert.equal(firstTaskId, 1);
  const fresh = draft(cfgBudgeted);
  assert.equal(nextTaskId(fresh), 1);
  const dispatched = spawnOn(fresh, { tag: "TKWork" }, 2);
  assert.deepEqual(dispatched.tasks, [wr(1), wr(2)]);
  assert.equal(dispatched.spawned, 2);
  assert.equal(nextTaskId(dispatched), 3);
  // The next fan-out continues the history rather than restarting it — ids are
  // never reused across stages, cycles or operator retries, which is what lets
  // a stale completion no-op by identity.
  const evaluating = spawnOn(
    retireLive({
      ...dispatched,
      tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
    }),
    { tag: "TKEval", stage: 0 },
    2,
  );
  assert.deepEqual(evaluating.tasks, [er(3, 0), er(4, 0)]);
  assert.equal(evaluating.spawned, 4);
  assert.equal(nextTaskId(evaluating), 5);
  // A zero-width fan-out is empty rather than an error: the model's
  // `start.to(start - 1)` is the empty set.
  assert.deepEqual(spawnTasks({ tag: "TKWork" }, firstTaskId, 0), []);
});

test("opRetryEvalFreshFanoutTest: a resume spawns above the retired history", () => {
  // The Evaluating resume re-enters with a FRESH fan-out of the LOWEST stage,
  // at new ids, leaving the failed history untouched in the record.
  const parked: Ticket = {
    ...draft(cfgBudgeted, progStaged),
    phase: "PEscalated",
    resumeAt: "REvaluating",
    reason: "RsReworkBudgetExhausted",
    gasLeft: 2,
    reworkLeft: 0,
    record: [wt(1, "TPassed"), wt(2, "TPassed"), et(3, 0, "TFailed")],
    spawned: 3,
  };
  assert.equal(nextTaskId(parked), 4);
  const resumed = resumedBy(cfgBudgeted, parked);
  assert.deepEqual(resumed.tasks, [er(4, 0)]);
  assert.equal(resumed.gasLeft, parked.gasLeft - 1);
  assert.deepEqual(resumed.record, parked.record);
  assert.equal(resumed.spawned, 4);
  // AND IT DESCENDS. This is the descent table's operator-retry row at its
  // WORST case — the one `model/measure.qnt`'s header calls out by name: the
  // REvaluating resume climbs rank 0 -> 3 AND brings the stage digit back at
  // its maximum L AND respawns a fan-out, all in one step, and the single gas
  // unit still outweighs the lot. Leaving it unpinned left the header's
  // hardest domination claim resting on the two easier ones.
  assert.ok(descends(bBudgeted, parked, resumed));
  assert.deepEqual(measuresAt(bBudgeted, [parked, resumed]), [630, 412]);
  assert.deepEqual([stagesLeft(resumed), runningCount(resumed.tasks)], [2, 1]);
});

test("revokeRetainsRecordTest: retireLive force-closes the running and preserves the resolved", () => {
  // A mid-flight revoke force-closes still-running tasks as TCancelled — a
  // synthetic resolution recording that the revoke, not a verdict, retired
  // them — while already-resolved outcomes survive unchanged.
  assert.deepEqual(revoked(jWork).record, [
    wt(1, "TCancelled"),
    wt(2, "TCancelled"),
  ]);
  assert.deepEqual(revoked(jEval).record, [
    et(1, 0, "TPassed"),
    et(2, 0, "TFailed"),
  ]);
  assert.deepEqual(revoked(jDraft).record, []);
  // The live set is empty afterwards in every case: Revoked runs nothing.
  for (const j of [jWork, jEval, jDraft]) {
    assert.deepEqual(
      revoked(j).tasks,
      [],
      `Revoked runs nothing, but the live set survived from ${j.phase}`,
    );
  }
  // Retirement appends in id order, so record entry i keeps id firstTaskId + i.
  const twice = retireLive(
    spawnOn(retireLive(jWork), { tag: "TKEval", stage: 0 }, 2),
  );
  assert.deepEqual(
    twice.record.map((t) => t.id),
    [1, 2, 3, 4],
  );
});

test("resolveTask is first-write-wins, and the write is the only edge", () => {
  const live: TaskSet = [wr(1), wr(2)];
  assert.deepEqual(resolveTask(live, 1, "TPassed"), [wt(1, "TPassed"), wr(2)]);
  assert.deepEqual(resolveTask(live, 2, "TFailed"), [wr(1), wt(2, "TFailed")]);
  // Resolution is final: a second, contradicting delivery changes nothing.
  const once = resolveTask(live, 1, "TPassed");
  assert.deepEqual(resolveTask(once, 1, "TFailed"), once);
  // And an id that is not live at all absorbs identically.
  assert.deepEqual(resolveTask(once, 7, "TPassed"), once);
  assert.deepEqual(resolveTask([], 1, "TPassed"), []);
});

test("combinatorBranchesTest: both branches of the combinator vocabulary are distinct", () => {
  const allPassed: TaskSet = [et(1, 0, "TPassed"), et(2, 0, "TPassed")];
  const allFailed: TaskSet = [et(1, 0, "TFailed"), et(2, 0, "TFailed")];
  assert.ok(combine("CUnanimousPass", allPassed));
  assert.ok(!combine("CUnanimousPass", mixedE0));
  assert.ok(combine("CAnyPass", mixedE0));
  assert.ok(!combine("CAnyPass", allFailed));
  // taskPassed is a verdict earned this incarnation: a cancellation is not one,
  // and neither combinator can be talked into treating it as one.
  assert.deepEqual(
    [
      taskPassed(wt(1, "TPassed")),
      taskPassed(wt(1, "TFailed")),
      taskPassed(wt(1, "TCancelled")),
      taskPassed(wr(1)),
    ],
    [true, false, false, false],
  );
  assert.ok(!combine("CUnanimousPass", [wt(1, "TCancelled")]));
  assert.ok(!combine("CAnyPass", [wt(1, "TCancelled")]));
  // The empty set, as the model's forall/exists give it. No stage can be
  // empty — programsWellFormed caps fan-out at 1 or more — so this pins the
  // edge rather than a reachable case.
  assert.ok(combine("CUnanimousPass", []));
  assert.ok(!combine("CAnyPass", []));
});

// === The negative space ====================================================
// Every assertion this module carries, shown firing, WITH ONE STATED
// EXCEPTION. An assertion nothing can trip is a comment with a stack trace
// attached — so the roster is walked here rather than sampled, and the one
// assertion that cannot be tripped through the public API is named below
// instead of being quietly counted as covered.
//
// THE EXCEPTION is `micro`'s postcondition, `0 <= value < microBound(b)`. It
// is not an independent check but the CONCLUSION of the two preconditions
// asserted immediately above it plus `phaseRank <= rankCeiling`, which holds
// for every `Phase` by the ladder's construction: with the stage digit at most
// `maxStages` and the count at most `nTasks`, `micro <= rankCeiling*rankWeight
// + maxStages*stageWeight + nTasks < radix(rankCeiling)*rankWeight`. Reaching
// it therefore means one of the three has already fired. It is kept because it
// is the claim the whole flattening rests on and it costs a comparison, and it
// is named here because "shown firing" would otherwise be a false claim about
// it.

test("the digit bounds are checked, not assumed", () => {
  const b = bBudgeted;
  const overFanned: Ticket = {
    ...draft(cfgBudgeted),
    phase: "PWorking",
    tasks: [wr(1), wr(2), wr(3)],
  };
  assert.throws(() => micro(b, overFanned), AssertionError);
  const overStaged: Ticket = {
    ...draft(cfgBudgeted, [...progStaged, ...progStaged]),
    phase: "PEvaluating",
    tasks: [er(1, 0)],
  };
  assert.throws(() => micro(b, overStaged), AssertionError);
  // A stage mark past the end of the program leaves the digit negative.
  const pastEnd: Ticket = {
    ...draft(cfgBudgeted),
    phase: "PEvaluating",
    tasks: [er(1, 5)],
  };
  assert.throws(() => stagesLeft(pastEnd), AssertionError);
});

test("the accounts are checked for the lower bound the measure needs", () => {
  const j = draft(cfgBudgeted);
  for (const broken of [
    { ...j, gasLeft: -1 },
    { ...j, wrapUpLeft: -1 },
    { ...j, reworkLeft: -1 },
    { ...j, gasLeft: 1.5 },
  ]) {
    assert.throws(() => ticketMeasure(bBudgeted, broken), AssertionError);
  }
  assert.throws(() => radix(-1), AssertionError);
  assert.throws(
    () => wrapUpBudget({ tag: "Budgeted", budget: -1 }),
    AssertionError,
  );
  assert.throws(
    () => reworkBudget({ tag: "RWBudget", budget: -1 }),
    AssertionError,
  );
});

test("a task set that is not a set is refused", () => {
  // Descending ids, and a duplicate id: both would make array equality mean
  // something other than set equality.
  assert.throws(() => runningCount([wr(2), wr(1)]), AssertionError);
  assert.throws(() => runningCount([wr(1), wr(1)]), AssertionError);
  assert.throws(() => runningCount([wr(0)]), AssertionError);
  // An id that ORDERS correctly but is not an integer, and one past 2^53 where
  // `+ 1` stops moving. Both slip through the ascending check — 1.5 > 0 — so
  // the count conjunct is the only thing catching them, and an id that cannot
  // be incremented exactly is one `nextTaskId` would mint a collision from.
  assert.throws(() => runningCount([{ ...wr(1), id: 1.5 }]), AssertionError);
  assert.throws(
    () => runningCount([{ ...wr(1), id: 2 ** 60 }]),
    AssertionError,
  );
  assert.throws(
    () => spawnTasks({ tag: "TKWork" }, firstTaskId - 1, 1),
    AssertionError,
  );
  assert.throws(
    () => spawnTasks({ tag: "TKWork" }, firstTaskId, -1),
    AssertionError,
  );
});

test("every reader of a task set checks the canonical form, by name", () => {
  // ONE CASE PER CALL SITE. `assertTaskSet`'s docstring claims every reader
  // calls it — including the ones that only count — and until this test
  // existed five of the six calls could be deleted with the suite green, which
  // made the F4 fix (`nextTaskId`'s call) a silent no-op the moment it landed.
  // Each case asserts the `where` label, so deleting one call reddens exactly
  // its own line rather than some distant equality.
  const scrambled: TaskSet = [wr(2), wr(1)];
  const ticketWith = (tasks: TaskSet): Ticket => ({ ...jDraft, tasks });
  assert.throws(() => runningCount(scrambled), {
    name: "AssertionError",
    message: /^runningCount: a task set is ascending/,
  });
  assert.throws(() => evalStage([er(2, 0), er(1, 0)]), {
    name: "AssertionError",
    message: /^evalStage: a task set is ascending/,
  });
  assert.throws(() => resolveTask(scrambled, 1, "TPassed"), {
    name: "AssertionError",
    message: /^resolveTask: a task set is ascending/,
  });
  assert.throws(
    () => combine("CUnanimousPass", [wt(2, "TPassed"), wt(1, "TPassed")]),
    { name: "AssertionError", message: /^combine: a task set is ascending/ },
  );
  assert.throws(() => nextTaskId(ticketWith(scrambled)), {
    name: "AssertionError",
    message: /^nextTaskId: a task set is ascending/,
  });
  assert.throws(() => retireLive(ticketWith(scrambled)), {
    name: "AssertionError",
    message: /^retireLive: a task set is ascending/,
  });
});

test("the caller guarantees the model states in prose are enforced here", () => {
  // evalStage: two different stage marks in one live set is the only shape the
  // model's fold answers order-dependently, and tasksWellFormed forbids it.
  assert.throws(() => evalStage([er(1, 0), er(2, 1)]), AssertionError);
  // spawnOn: the previous set is retired before a fresh fan-out.
  assert.throws(() => spawnOn(jWork, { tag: "TKWork" }, 2), AssertionError);
  // combine: the caller reduces a fully-resolved set.
  assert.throws(() => combine("CUnanimousPass", [wr(1)]), AssertionError);
  // evalStage: a stage index is a count, so a negative or fractional mark is
  // refused before it can become a negative stage digit.
  assert.throws(() => evalStage([er(1, -1)]), AssertionError);
  assert.throws(() => evalStage([er(1, 0.5)]), AssertionError);
  // retireLive: live ids are contiguous above the record.
  assert.throws(
    () => retireLive({ ...jDraft, tasks: [wr(4)] }),
    AssertionError,
  );
});

test("the arithmetic is refused rather than silently rounded past 2^53", () => {
  // `ticketMeasure` and `sysMeasure` both claim their result is a count. The
  // model's ints are unbounded; JavaScript's stop being integers at 2^53, and
  // past that a measure comparison starts answering `equal` for states that
  // are not — which would make a descent proof read as a stutter. Neither
  // assertion is decorative: a gas grant is a machine const, so nothing about
  // the type system stops one arriving large enough.
  const huge: Ticket = {
    ...draft(cfgBudgeted),
    gasLeft: Number.MAX_SAFE_INTEGER,
  };
  assert.throws(() => ticketMeasure(bBudgeted, huge), AssertionError);
  // The fleet sum overflows where no single ticket does: each of these is a
  // fine measure on its own.
  const large: Ticket = {
    ...draft(cfgBudgeted),
    gasLeft: Math.floor(Number.MAX_SAFE_INTEGER / 300),
  };
  assert.ok(Number.isSafeInteger(ticketMeasure(bBudgeted, large)));
  assert.throws(
    () =>
      sysMeasure(
        bBudgeted,
        new Map([
          [1, large],
          [2, large],
          [3, large],
        ]),
      ),
    AssertionError,
  );
});

test("the assertNever arms name a tag TypeScript proved could not arrive", () => {
  // These are the arms a DECODED GOLDEN TRACE can reach in s3: its tags come
  // from outside TypeScript's knowledge, so the casts below are the shape of
  // the real hazard rather than a contrivance — the same argument
  // `assert.ts`'s own suite makes for `assertNever`.
  const rogueKind = { tag: "TKNonsense" } as unknown as TaskKind;
  assert.throws(
    () => evalStage([{ id: 1, kind: rogueKind, state: { tag: "TSRunning" } }]),
    AssertionError,
  );
  assert.throws(
    () => wrapUpBudget({ tag: "Metered" } as unknown as WrapUpPricing),
    AssertionError,
  );
  assert.throws(() => phaseRank("PParked" as Phase), AssertionError);
  assert.throws(
    () => combine("CMajorityPass" as Combinator, []),
    AssertionError,
  );
  // The message carries the tag that arrived, which is the whole point of the
  // arm: a replay failure has to say WHICH constructor the corpus held.
  assert.throws(() => phaseRank("PParked" as Phase), {
    name: "AssertionError",
    message: 'unhandled Phase: "PParked"',
  });
});
