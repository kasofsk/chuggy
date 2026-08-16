/**
 * `model/domain.qnt`'s invariant block, made red before it is trusted.
 *
 * WHAT THIS SUITE IS FOR, AND WHY IT IS SHAPED UNLIKE ITS TWO NEIGHBOURS.
 * `measure.test.ts` and `domain.test.ts` mirror the model's own runs, conjunct
 * for conjunct, because the model pins values there. The model pins almost
 * nothing about the invariants directly: it asserts `allInvariants` on machine
 * TRACES (`model/tests/chuggy_witness_test.qnt`, and the randomized runs), which
 * is the conformance spine's obligation and the randomized layer's, not this
 * file's. The two invariant-asserting runs `model/tests/chuggy_test.qnt` does
 * carry — `happyPathIdsAccountedTest` and `handBuiltFixturesAccountedTest`, both
 * `idsAccounted` at fixture grain — are already mirrored in `domain.test.ts`
 * under their own names. So what is owed here is the other half of the bar:
 * every invariant shown FAILING against a tree carrying the defect it names.
 *
 * THE RED-PROOF CORPUS IS THE CENTRE OF THE FILE. Each entry carries a defect
 * tree, the corrected twin, and — this is the part that makes it evidence
 * rather than decoration — THE EXACT SET of bundle conjuncts the defect tree
 * turns red. That exact set is this tree's own guard-pinning rule
 * (`domain.test.ts`'s header: an equality guard is pinned by an exact set over
 * its whole domain, never by counter-examples) applied to the invariants
 * themselves, and it buys three things a bare red/green pair does not:
 *
 *   1. It proves THE DEFECT IS THE ONE NAMED. A tree that broke four
 *      invariants would red-prove any of them equally well and none of them
 *      honestly.
 *   2. It proves THE BUNDLE CARRIES THE CONJUNCT. If `allInvariants` had
 *      dropped one, that conjunct's defect tree would be the one tree in the
 *      corpus where the bundle and the roster disagree — and the agreement test
 *      below checks exactly that, on every tree in the corpus.
 *   3. It RECORDS THE COROLLARIES the model states in prose, and it TESTS them
 *      rather than believing them. Two invariants cannot be broken alone:
 *      `quietProjectLandsCleanly` is `wrapUpIsolation`'s failure-implies-moved
 *      conjunct in other words, and a structural deadlock is reachable only
 *      behind a revoked dep (`cascadeSafety`) or around a dependency cycle
 *      (`depsAcyclic`). Their entries name the companion rather than claiming an
 *      isolation no tree can have.
 *
 *      THE THIRD COROLLARY TURNED OUT NOT TO BE ONE, which is the whole argument
 *      for writing these sets down instead of reasoning about them.
 *      `revokedNeverCompletes` reads as a corollary of `completionExclusive`,
 *      and the derivation quietly needs `completions >= 0` — a floor no
 *      invariant states — so a negative ghost counter reds it ALONE. It carries
 *      both entries below: the companion tree the model's prose predicts, and
 *      the isolating one the prose does not. Model-question kasofsk#39.
 *
 * ONE CONJUNCT HAS NO DEFECT TREE AT ALL, and the model is why:
 * `stuckSubsetCovered` is a tautology over its own two walks, so no machine and
 * no fixture can make it false. Its red-proof is a mutation of the DEFINITIONS
 * it relates — the two mutations the model's own comment names — which is
 * precisely what the model says the invariant still guards. It has its own
 * section below and is excluded from the corpus by name.
 *
 * AND ONE FAILS LOUDER THAN THE MODEL RATHER THAN FALSE: every state whose
 * measure would be negative makes `measure.ts` throw first, so
 * `measureNonNegative`'s red-proof is a thrown `AssertionError`. The argument is
 * on the predicate; the proof is in its own section, for the same reason.
 *
 * THE FIXTURES ARE THE LANDED ONES, EXTENDED, NEVER RE-MINTED.
 * `fixtures.test.ts` is the fleet both other suites read, and nearly every
 * defect tree below is one field off one of its tickets. The one extension made
 * here is named where it is made: a wrap-up-phase ticket is given the artifact
 * mark a trace would have stamped before it reached the queue, because the
 * landed fixture carries `freshTicket`'s `ANone` and a landing out of it would
 * produce a Done ticket `artifactWellFormed` forbids. That is the same
 * unreachable-fixture class kasofsk PR #31 corrects for `cXDepDone`. The model's
 * `cQueueB`, `cGateB`, `cGateWall`, `cGateGasWall`, `cGateD`, `cGateDWall` and
 * `cGateOcc` are shaped the same way — `cGated7` is not, being machine-built —
 * and all of them are left exactly as the model writes them, because the model
 * leads. `cGateOcc` is the sharpest of them: it hand-builds three wrap-up-phase
 * tickets from `freshTicket`, and `leaseExclusiveGuardTest` lands its ticket 1
 * out of the gate, so the run's own last conjunct reads a post-state holding a
 * `PDone` ticket with `ANone`.
 *
 * A NOTE THE SPINE WILL WANT. The multi-ticket fleets in `domain.test.ts` red
 * `idsDense` at DB's consts, because `N_TICKETS` is 2 there and those fleets
 * carry three or four tickets. Nothing is wrong with them — they exist to pin
 * guards over a phase domain, and a guard does not ask about the arrival bound —
 * but the moment s3 asserts the bundle after every replayed step, a fleet
 * borrowed from that suite will red for a reason that has nothing to do with the
 * step. The fleets built here take `cfgFleet` for exactly that reason.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "./assert.ts";
import {
  boundsOf,
  decideDispatch,
  decideRelease,
  decideWrapUpResolve,
  projects,
  type Config,
} from "./domain.ts";
import {
  cfgBudgeted,
  cfgDeadlineOnly,
  cfgRetryFree,
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
  progStaged,
  progU2,
  revokeOne,
  solo,
  wr,
  wt,
  wx2,
} from "./fixtures.test.ts";
import {
  accountsBounded,
  allInvariants,
  artifactWellFormed,
  canFinishSet,
  cascadeSafety,
  completionExclusive,
  coveredSet,
  depsAcyclic,
  deskConsistent,
  idsAccounted,
  idsDense,
  leaseExclusive,
  measureDescends,
  measureNonNegative,
  noLeaseWithoutAKind,
  noStructuralDeadlock,
  programsWellFormed,
  projectsWellFormed,
  quietProjectLandsCleanly,
  recordMonotone,
  recordWellFormed,
  revokeDoomed,
  revokedNeverCompletes,
  stepDescends,
  stuckSet,
  stuckSubsetCovered,
  tasksWellFormed,
  terminalsAbsorbing,
  visEdges,
  wrapUpIsolation,
  wrapUpWallNamed,
  wrapUpWellFormed,
  type StepHistory,
} from "./invariants.ts";
import {
  evalStage,
  hasOpenHumanTask,
  runningCount,
  sysMeasure,
  type ArtifactMark,
  type Core,
  type Decision,
  type Phase,
  type StepRecord,
  type Task,
  type Ticket,
} from "./measure.ts";

// === The step-history harness ==============================================

/**
 * `model/domain.qnt`'s `currentRecords` — the snapshot `apply` carries into
 * `prevRecords`. It is written here rather than shipped because the model
 * declares it in the state-and-actions section, whose TypeScript home is the
 * spine; this file needs it only to BUILD a previous state to check against.
 */
function recordsOf(c: Core): ReadonlyMap<number, readonly Task[]> {
  return new Map([...c.tickets].map(([j, jb]) => [j, jb.record]));
}

/** The quiet fleet's stutter — a real model label, and the neutral step record. */
const settledStep: StepRecord = {
  label: "settled",
  transitions: [],
  effects: [],
  landing: { tag: "WONone" },
};

/** Everything the bundle reads, so a defect tree can be stated once and asked anything. */
type Subject = {
  readonly cfg: Config;
  readonly core: Core;
  readonly history: StepHistory;
};

/**
 * A subject whose STEP is uneventful, for the Core-shaped invariants: the
 * stutter step, records unchanged, and a previous measure one above the current.
 *
 * The previous measure is a strict climb-down rather than something an exemption
 * arm would forgive, deliberately: it makes `stepDescends` green for a reason
 * that has nothing to do with the `settled` arm, so no Core defect below is ever
 * being read through a measure exemption.
 */
function quiet(cfg: Config, c: Core): Subject {
  return {
    cfg,
    core: c,
    history: {
      lastStep: settledStep,
      prevMeasure: sysMeasure(boundsOf(cfg), c.tickets) + 1,
      prevRecords: recordsOf(c),
    },
  };
}

/** A subject whose STEP carries the defect, over a Core that is otherwise clean. */
function stepped(
  cfg: Config,
  c: Core,
  lastStep: StepRecord,
  prevMeasure = sysMeasure(boundsOf(cfg), c.tickets) + 1,
): Subject {
  return {
    cfg,
    core: c,
    history: { lastStep, prevMeasure, prevRecords: recordsOf(c) },
  };
}

/** The real pair a decider produces: its post-state and record, the pre-state's measure and records. */
function taken(cfg: Config, pre: Core, d: Decision): Subject {
  return {
    cfg,
    core: d.post,
    history: {
      lastStep: d.rec,
      prevMeasure: sysMeasure(boundsOf(cfg), pre.tickets),
      prevRecords: recordsOf(pre),
    },
  };
}

/**
 * The mark a trace has stamped by the time a ticket reaches the queue —
 * `decideWorkReduce` writes `ASome(retired.spawned)`, and at these consts the
 * work fan-out is 2. The landed wrap-up fixtures carry `freshTicket`'s `ANone`,
 * which is fine while nothing lands them and is a state `artifactWellFormed`
 * forbids the moment something does.
 */
const runMark: ArtifactMark = { tag: "ASome", id: 2 };

/** `jGated` as a trace reaches it: holding the slot, carrying what work produced. */
const jGatedRun: Ticket = { ...jGated, artifact: runMark };

/**
 * The reference instance with room for a FLEET, and nothing else changed.
 *
 * `cfgBudgeted` is the model's DB, whose arrival bound is 2 — which is right for
 * the deciders' own suite and wrong for a relation. An invariant that quantifies
 * over a DEPENDENCY needs at least a dependent, a dep that agrees and a dep that
 * disagrees, and at that size every fleet reds `idsDense` at DB's bound, which
 * would swamp the exact set of every tree built on one. `N_TICKETS` is the
 * arrival BOUND rather than a fleet size and the model varies it per instance, so
 * a wider instance is the model's own move, not a workaround.
 */
const cfgFleet: Config = { ...cfgBudgeted, nTickets: 4 };

/**
 * A work fan-out WIDER than the const it was spawned at, and RESOLVED.
 *
 * Resolved rather than running, and the difference is not cosmetic: a live task
 * set of three would trip `micro`'s own radix precondition (`running <= nTasks`)
 * before any invariant was asked, so the tree would throw where it is meant to
 * report. Resolved tasks leave `runningCount` at 0, which lets the width
 * equality be the only thing wrong with the state.
 */
const jWorkWide: Ticket = {
  ...jWork,
  tasks: [wt(1, "TPassed"), wt(2, "TPassed"), wt(3, "TPassed")],
  spawned: 3,
};

/** The same, on the eval arm: a stage fan-out wider than the program declares. */
const jEvalWide: Ticket = {
  ...jEval,
  tasks: [et(1, 0, "TPassed"), et(2, 0, "TFailed"), et(3, 0, "TPassed")],
  spawned: 3,
};

/** The nine phases, exhaustively: a tenth stops this object compiling. */
const phaseRoster: Readonly<Record<Phase, null>> = {
  PDraft: null,
  PPending: null,
  PWorking: null,
  PEvaluating: null,
  PWrapUp: null,
  PWrapUpHolding: null,
  PDone: null,
  PEscalated: null,
  PRevoked: null,
};
const allPhases = Object.keys(phaseRoster) as readonly Phase[];

/** Every phase but the ones named — the exact-set rule's usual right-hand side. */
function phasesExcept(...kept: readonly Phase[]): ReadonlySet<Phase> {
  return new Set(allPhases.filter((p) => !kept.includes(p)));
}

// === The green baseline ====================================================

/** The landed single-ticket family, by the name each carries in `fixtures.test.ts`. */
const landedFleet: readonly (readonly [string, Ticket])[] = [
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
];

test("every landed fixture is a state the bundle accepts", () => {
  // The family spans every stored phase but `PRevoked` and all three desk-reason
  // flavors, so this is the invariant block's whole domain over the tickets the
  // other two suites already read. `jDone` passes because of kasofsk PR #31's
  // one-field correction, mirrored on the fixture; before it, a landed ticket
  // held `ANone` and `artifactWellFormed` was right to refuse it.
  for (const [name, jb] of landedFleet) {
    const s = quiet(cfgBudgeted, solo(jb));
    assert.deepEqual(
      redConjuncts(s),
      new Set(),
      `${name} is not a state the bundle accepts`,
    );
  }
  // And the revoked terminal, which the family reaches only through the decider.
  const revoked = quiet(cfgBudgeted, revokeOne(jPend).post);
  assert.deepEqual(redConjuncts(revoked), new Set());
});

test("the bundle is green on real pre/post pairs, not only on hand-built states", () => {
  // Four deciders, four step pairs, each carrying its own `StepRecord` and the
  // pre-state's measure and records — the shape the spine will hand the bundle
  // after every replayed step.
  const beforeRelease = solo(jDraft);
  const beforeDispatch = solo(jPend);
  const beforeLanding = solo(jGatedRun);
  const pairs: readonly (readonly [string, Subject])[] = [
    [
      "ticket-released",
      taken(cfgBudgeted, beforeRelease, decideRelease(beforeRelease, 1)),
    ],
    [
      "dispatch",
      taken(
        cfgBudgeted,
        beforeDispatch,
        decideDispatch(cfgBudgeted, beforeDispatch, 1),
      ),
    ],
    [
      "ticket-done",
      taken(
        cfgBudgeted,
        beforeLanding,
        decideWrapUpResolve(cfgBudgeted, beforeLanding, 1, "WOk", true),
      ),
    ],
    ["ticket-revoked", taken(cfgBudgeted, solo(jPend), revokeOne(jPend))],
  ];
  for (const [label, s] of pairs) {
    assert.equal(s.history.lastStep.label, label);
    assert.deepEqual(
      redConjuncts(s),
      new Set(),
      `the bundle refuses the ${label} step pair`,
    );
  }
});

// === The bundle's roster ===================================================

/**
 * The conjuncts of `allInvariants`, in the model's order, each as the call the
 * bundle makes. It exists so the corpus below can name an EXACT SET
 * of failing conjuncts; the shipped bundle is a plain short-circuiting
 * conjunction, and the agreement test keeps the two from drifting apart.
 */
const bundleConjuncts: readonly (readonly [string, (s: Subject) => boolean])[] =
  [
    ["completionExclusive", (s) => completionExclusive(s.core)],
    ["revokedNeverCompletes", (s) => revokedNeverCompletes(s.core)],
    [
      "wrapUpIsolation",
      (s) => wrapUpIsolation(s.cfg, s.core, s.history.lastStep),
    ],
    [
      "quietProjectLandsCleanly",
      (s) => quietProjectLandsCleanly(s.history.lastStep),
    ],
    ["leaseExclusive", (s) => leaseExclusive(s.cfg, s.core)],
    ["noLeaseWithoutAKind", (s) => noLeaseWithoutAKind(s.core)],
    ["artifactWellFormed", (s) => artifactWellFormed(s.core)],
    ["projectsWellFormed", (s) => projectsWellFormed(s.cfg, s.core)],
    ["wrapUpWellFormed", (s) => wrapUpWellFormed(s.cfg, s.core)],
    ["terminalsAbsorbing", (s) => terminalsAbsorbing(s.history.lastStep)],
    ["deskConsistent", (s) => deskConsistent(s.core)],
    ["wrapUpWallNamed", (s) => wrapUpWallNamed(s.cfg, s.core)],
    ["accountsBounded", (s) => accountsBounded(s.cfg, s.core)],
    ["tasksWellFormed", (s) => tasksWellFormed(s.cfg, s.core)],
    ["recordWellFormed", (s) => recordWellFormed(s.core)],
    ["recordMonotone", (s) => recordMonotone(s.core, s.history.prevRecords)],
    ["idsAccounted", (s) => idsAccounted(s.core)],
    ["programsWellFormed", (s) => programsWellFormed(s.cfg, s.core)],
    ["depsAcyclic", (s) => depsAcyclic(s.core)],
    ["idsDense", (s) => idsDense(s.cfg, s.core)],
    ["stuckSubsetCovered", (s) => stuckSubsetCovered(s.core)],
    ["cascadeSafety", (s) => cascadeSafety(s.core)],
    ["noStructuralDeadlock", (s) => noStructuralDeadlock(s.core)],
    [
      "measureDescends",
      (s) =>
        measureDescends(
          s.cfg,
          s.core,
          s.history.lastStep,
          s.history.prevMeasure,
        ),
    ],
  ];

/** The exact set of bundle conjuncts a subject turns red. */
function redConjuncts(s: Subject): ReadonlySet<string> {
  return new Set(
    bundleConjuncts.filter(([, holds]) => !holds(s)).map(([name]) => name),
  );
}

test("the roster is the model's own conjunct list, name for name and in order", () => {
  // Read off `model/domain.qnt`'s `allInvariants`. The roster drives the exact
  // sets below, so a conjunct silently dropped from it would quietly stop being
  // checked by every one of them; this is where that is refused.
  assert.deepEqual(
    bundleConjuncts.map(([name]) => name),
    [
      "completionExclusive",
      "revokedNeverCompletes",
      "wrapUpIsolation",
      "quietProjectLandsCleanly",
      "leaseExclusive",
      "noLeaseWithoutAKind",
      "artifactWellFormed",
      "projectsWellFormed",
      "wrapUpWellFormed",
      "terminalsAbsorbing",
      "deskConsistent",
      "wrapUpWallNamed",
      "accountsBounded",
      "tasksWellFormed",
      "recordWellFormed",
      "recordMonotone",
      "idsAccounted",
      "programsWellFormed",
      "depsAcyclic",
      "idsDense",
      "stuckSubsetCovered",
      "cascadeSafety",
      "noStructuralDeadlock",
      "measureDescends",
    ],
  );
});

// === The red-proof corpus ==================================================

type RedProof = {
  /** The invariant this tree is the defect for. */
  readonly name: string;
  /** The named predicate itself, so the pair is checked at its own grain too. */
  readonly holds: (s: Subject) => boolean;
  readonly broken: Subject;
  readonly fixed: Subject;
  /** EXACTLY the bundle conjuncts `broken` turns red. Usually `[name]`. */
  readonly reds: readonly string[];
};

/** A one-ticket defect tree and its corrected twin, both at the reference instance. */
function oneTicket(
  broken: Ticket,
  fixed: Ticket,
): Pick<RedProof, "broken" | "fixed"> {
  return {
    broken: quiet(cfgBudgeted, solo(broken)),
    fixed: quiet(cfgBudgeted, solo(fixed)),
  };
}

/** A doomed dependent behind a revoked dep — the cascade's own two-ticket shape. */
function behindARevoke(dependent: Ticket): Core {
  return core([
    [1, { ...jDraft, phase: "PRevoked" }],
    [2, { ...dependent, deps: new Set([1]) }],
  ]);
}

/** A landing step record, at whatever attribution and path the caller is probing. */
function landingStep(
  label: string,
  from: Phase,
  project: number,
  invalidated: boolean,
): StepRecord {
  return {
    label,
    transitions: [{ ticket: 1, from, to: "PDone" }],
    effects: ["Complete"],
    landing: { tag: "WOAttempt", project, invalidated },
  };
}

const redProofs: readonly RedProof[] = [
  {
    name: "completionExclusive",
    holds: (s) => completionExclusive(s.core),
    // Two completion effects for one ticket: the at-most-once half.
    ...oneTicket({ ...jDone, completions: 2 }, jDone),
    reds: ["completionExclusive"],
  },
  {
    name: "revokedNeverCompletes",
    holds: (s) => revokedNeverCompletes(s.core),
    // A revoked ticket that emitted a completion. The model states this one as
    // a corollary of `completionExclusive` — completions == 1 iff Done, and
    // Revoked is not Done — so the same tree necessarily reds both, and the
    // exact set below records that rather than hiding it.
    ...oneTicket(
      { ...jDraft, phase: "PRevoked", completions: 1 },
      { ...jDraft, phase: "PRevoked" },
    ),
    reds: ["completionExclusive", "revokedNeverCompletes"],
  },
  {
    name: "revokedNeverCompletes (isolated)",
    holds: (s) => revokedNeverCompletes(s.core),
    // ...AND THE COROLLARY HAS A FLOOR THE MODEL NEVER STATES, which is what
    // makes this one isolable after all. The derivation runs "completions == 1
    // iff Done, completions <= 1, Revoked is not Done, therefore completions ==
    // 0" — and that last step needs `completions >= 0`, which no invariant
    // asserts. A NEGATIVE ghost counter satisfies `completionExclusive` in both
    // halves and reds this one alone. Parity with the model, filed as
    // model-question kasofsk#39; mirrored here rather than repaired, because the
    // model leads and a floor invented in TypeScript would be the divergence.
    ...oneTicket(
      { ...jDraft, phase: "PRevoked", completions: -1 },
      { ...jDraft, phase: "PRevoked" },
    ),
    reds: ["revokedNeverCompletes"],
  },
  {
    name: "wrapUpIsolation",
    holds: (s) => wrapUpIsolation(s.cfg, s.core, s.history.lastStep),
    // The attribution names a project the stepped ticket is not in — the
    // own-project conjunct, and the one a constant-stamping mutant would break.
    // Chosen over the failure-implies-moved conjunct precisely because it is
    // isolable: that one is `quietProjectLandsCleanly` in other words.
    broken: stepped(
      cfgBudgeted,
      solo(jDone),
      landingStep("ticket-done", "PWrapUp", 2, false),
    ),
    fixed: stepped(
      cfgBudgeted,
      solo(jDone),
      landingStep("ticket-done", "PWrapUp", 1, false),
    ),
    reds: ["wrapUpIsolation"],
  },
  {
    name: "quietProjectLandsCleanly",
    holds: (s) => quietProjectLandsCleanly(s.history.lastStep),
    // An attempt the environment chose QUIET that resolved as anything but the
    // success. The model calls this a corollary of `wrapUpIsolation`'s
    // failure-implies-moved conjunct, so both go red on the one tree.
    broken: stepped(cfgBudgeted, solo(jLand), {
      label: "rework-started wrapup_failure",
      transitions: [{ ticket: 1, from: "PWrapUp", to: "PWorking" }],
      effects: ["SpawnWorkTasks"],
      landing: { tag: "WOAttempt", project: 1, invalidated: false },
    }),
    fixed: stepped(cfgBudgeted, solo(jLand), {
      label: "rework-started wrapup_failure",
      transitions: [{ ticket: 1, from: "PWrapUpHolding", to: "PWorking" }],
      effects: ["SpawnWorkTasks"],
      landing: { tag: "WOAttempt", project: 1, invalidated: true },
    }),
    reds: ["wrapUpIsolation", "quietProjectLandsCleanly"],
  },
  {
    name: "leaseExclusive",
    holds: (s) => leaseExclusive(s.cfg, s.core),
    // Two tickets in the gate slot of the SAME resource. The twin moves one of
    // them to the other resource rather than out of the phase: different
    // resources are independent by design, and that is the half a mutant
    // counting holders fleet-wide would break.
    broken: quiet(
      cfgBudgeted,
      core([
        [1, jGated],
        [2, jGated],
      ]),
    ),
    fixed: quiet(
      cfgBudgeted,
      core([
        [1, jGated],
        [2, { ...jGated, wrapUp: wx2 }],
      ]),
    ),
    reds: ["leaseExclusive"],
  },
  {
    name: "noLeaseWithoutAKind",
    holds: (s) => noLeaseWithoutAKind(s.core),
    // A kindless ticket enqueued for a gate it has no stake in.
    ...oneTicket({ ...jLand, wrapUp: { tag: "WNone" } }, jLand),
    reds: ["noLeaseWithoutAKind"],
  },
  {
    name: "artifactWellFormed",
    holds: (s) => artifactWellFormed(s.core),
    // A landed ticket that produced nothing — which is exactly the fixture
    // kasofsk PR #31 corrects, written here as the defect it is.
    ...oneTicket({ ...jDone, artifact: { tag: "ANone" } }, jDone),
    reds: ["artifactWellFormed"],
  },
  {
    name: "projectsWellFormed",
    holds: (s) => projectsWellFormed(s.cfg, s.core),
    // A target outside the bounded universe — the arrival refusal, evaded.
    ...oneTicket(
      { ...jDraft, project: cfgBudgeted.nProjects + 1 },
      { ...jDraft, project: cfgBudgeted.nProjects },
    ),
    reds: ["projectsWellFormed"],
  },
  {
    name: "wrapUpWellFormed",
    holds: (s) => wrapUpWellFormed(s.cfg, s.core),
    // A lease on a resource no universe contains. The model's argument for this
    // conjunct is that `leaseExclusive` counts holders per MEMBER of `projects`,
    // so such a lease is serialized against nothing — which is why the exact set
    // here is a single name and the dedicated test below shows the gap.
    ...oneTicket(
      {
        ...jDraft,
        wrapUp: { tag: "WExclusive", resource: cfgBudgeted.nProjects + 1 },
      },
      { ...jDraft, wrapUp: wx2 },
    ),
    reds: ["wrapUpWellFormed"],
  },
  {
    name: "terminalsAbsorbing",
    holds: (s) => terminalsAbsorbing(s.history.lastStep),
    // A transition OUT of a terminal, on the observed record.
    broken: stepped(cfgBudgeted, solo(jDraft), {
      label: "ticket-released",
      transitions: [{ ticket: 1, from: "PDone", to: "PPending" }],
      effects: [],
      landing: { tag: "WONone" },
    }),
    fixed: stepped(cfgBudgeted, solo(jDraft), {
      label: "ticket-released",
      transitions: [{ ticket: 1, from: "PDraft", to: "PPending" }],
      effects: [],
      landing: { tag: "WONone" },
    }),
    reds: ["terminalsAbsorbing"],
  },
  {
    name: "deskConsistent",
    holds: (s) => deskConsistent(s.core),
    // Parked with no wall named: the reason-iff-parked half.
    ...oneTicket({ ...jEsc, reason: "RsNone" }, jEsc),
    reds: ["deskConsistent"],
  },
  {
    name: "wrapUpWallNamed",
    holds: (s) => wrapUpWallNamed(s.cfg, s.core),
    // The gate-budget wall named at an instance that has no gate account. The
    // twin keeps the park and changes the wall to one `DeadlineOnly` does have.
    broken: quiet(
      cfgDeadlineOnly,
      solo(
        escalated(
          draft(cfgDeadlineOnly),
          "RsWrapUpBudgetExhausted",
          "RWrapUp",
          "ticket-escalated wrapup_budget_exhausted",
        ),
      ),
    ),
    fixed: quiet(
      cfgDeadlineOnly,
      solo(
        escalated(
          draft(cfgDeadlineOnly),
          "RsGasExhausted",
          "RWrapUp",
          "ticket-escalated gas_exhausted",
        ),
      ),
    ),
    reds: ["wrapUpWallNamed"],
  },
  {
    name: "accountsBounded",
    holds: (s) => accountsBounded(s.cfg, s.core),
    // A refunded account: gas above the grant. The floor is the other half and
    // is refused one level louder — see the negative-account section below.
    ...oneTicket({ ...jDraft, gasLeft: cfgBudgeted.gas + 1 }, jDraft),
    reds: ["accountsBounded"],
  },
  {
    name: "tasksWellFormed",
    holds: (s) => tasksWellFormed(s.cfg, s.core),
    // A work fan-out narrower than the const it is spawned at. `spawned` moves
    // with it, so `idsAccounted` stays green and the defect is this one alone.
    ...oneTicket({ ...jWork, tasks: [wr(1)], spawned: 1 }, jWork),
    reds: ["tasksWellFormed"],
  },
  {
    name: "tasksWellFormed (work width, from ABOVE)",
    holds: (s) => tasksWellFormed(s.cfg, s.core),
    // THE WIDTH IS AN EQUALITY AND IS PINNED FROM BOTH SIDES. A fan-out narrower
    // than the const is the obvious defect and the one above is the dangerous
    // one: the measure's digit-order argument rests on `runningCount <= nTasks`,
    // so a set the anatomy admitted at width `nTasks + 1` is a state whose micro
    // digit can escape its radix.
    ...oneTicket(jWorkWide, jWork),
    reds: ["tasksWellFormed"],
  },
  {
    name: "tasksWellFormed (eval fan-out, from ABOVE)",
    holds: (s) => tasksWellFormed(s.cfg, s.core),
    // The same equality on the eval arm, where the width is the PROGRAM's rather
    // than the const's — the interpreter running the program as written.
    ...oneTicket(jEvalWide, jEval),
    reds: ["tasksWellFormed"],
  },
  {
    name: "recordWellFormed",
    holds: (s) => recordWellFormed(s.core),
    // Something retired while still running: the record is the RESOLVED log.
    ...oneTicket(
      { ...jDraft, record: [wr(1)], spawned: 1 },
      { ...jDraft, record: [wt(1, "TPassed")], spawned: 1 },
    ),
    reds: ["recordWellFormed"],
  },
  {
    name: "recordMonotone",
    holds: (s) => recordMonotone(s.core, s.history.prevRecords),
    // A settled outcome rewritten under the record's own id — the sharpest of
    // the three shapes, since nothing shrinks and no id moves.
    broken: {
      ...quiet(
        cfgBudgeted,
        solo({ ...jDraft, record: [wt(1, "TFailed")], spawned: 1 }),
      ),
      history: {
        lastStep: settledStep,
        prevMeasure: Number.MAX_SAFE_INTEGER,
        prevRecords: new Map([[1, [wt(1, "TPassed")]]]),
      },
    },
    fixed: {
      ...quiet(
        cfgBudgeted,
        solo({ ...jDraft, record: [wt(1, "TFailed")], spawned: 1 }),
      ),
      history: {
        lastStep: settledStep,
        prevMeasure: Number.MAX_SAFE_INTEGER,
        prevRecords: new Map([[1, [wt(1, "TFailed")]]]),
      },
    },
    reds: ["recordMonotone"],
  },
  {
    name: "idsAccounted",
    holds: (s) => idsAccounted(s.core),
    // The ghost counter ahead of retired + live: what a decider that DROPPED a
    // task set instead of retiring it would leave behind.
    ...oneTicket({ ...jWork, spawned: jWork.spawned + 1 }, jWork),
    reds: ["idsAccounted"],
  },
  {
    name: "programsWellFormed",
    holds: (s) => programsWellFormed(s.cfg, s.core),
    // The empty program `validPrograms` refuses at authoring time.
    ...oneTicket({ ...jDraft, program: [] }, jDraft),
    reds: ["programsWellFormed"],
  },
  {
    name: "depsAcyclic",
    holds: (s) => depsAcyclic(s.core),
    // A dependency pointing UPWARD, which arrival cannot author: deps name only
    // ids that already exist, and ids are minted ascending.
    broken: quiet(
      cfgBudgeted,
      core([
        [1, { ...jDraft, deps: new Set([2]) }],
        [2, jDraft],
      ]),
    ),
    fixed: quiet(
      cfgBudgeted,
      core([
        [1, jDraft],
        [2, { ...jDraft, deps: new Set([1]) }],
      ]),
    ),
    reds: ["depsAcyclic"],
  },
  {
    name: "idsDense",
    holds: (s) => idsDense(s.cfg, s.core),
    // A fleet past the arrival bound. The OTHER half — a hole in the ids — has
    // its own test, because the doomed walk asserts on a fleet with one rather
    // than reporting it.
    broken: quiet(
      cfgBudgeted,
      core([
        [1, jDraft],
        [2, jDraft],
        [3, jDraft],
      ]),
    ),
    fixed: quiet(
      cfgBudgeted,
      core([
        [1, jDraft],
        [2, jDraft],
      ]),
    ),
    reds: ["idsDense"],
  },
  {
    name: "cascadeSafety",
    holds: (s) => cascadeSafety(s.core),
    // A doomed dependent parked behind the WRONG wall. It is the isolating
    // tree: the ticket has an open desk task, so `noStructuralDeadlock` is
    // satisfied and only the cascade's own claim — parked with the wall the
    // cascade names — sees the breach. (The other shape, a doomed dependent
    // left PENDING, reds both, and is swept over every phase below.)
    broken: quiet(cfgBudgeted, behindARevoke(jEsc)),
    fixed: quiet(cfgBudgeted, behindARevoke(jParkDep)),
    reds: ["cascadeSafety"],
  },
  {
    name: "noStructuralDeadlock",
    holds: (s) => noStructuralDeadlock(s.core),
    // A dependency CYCLE: neither member's `forall` is ever satisfied, so
    // neither enters `canFinishSet` and neither has any continuation at all.
    // `cascadeSafety` is VACUOUSLY GREEN here — nothing is revoked — which is
    // what makes this the tree that separates the two, and `depsAcyclic` is red
    // because a cycle is the only way to build a deadlock that a revoke did not.
    broken: quiet(
      cfgBudgeted,
      core([
        [1, { ...jDraft, phase: "PPending", deps: new Set([2]) }],
        [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
      ]),
    ),
    fixed: quiet(
      cfgBudgeted,
      core([
        [1, { ...jDraft, phase: "PPending" }],
        [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
      ]),
    ),
    reds: ["depsAcyclic", "noStructuralDeadlock"],
  },
  {
    name: "stepDescends",
    holds: (s) =>
      stepDescends(s.cfg, s.core, s.history.lastStep, s.history.prevMeasure),
    // A step under no exemption arm whose measure did not move. `dispatch` is a
    // real label and a real climb-down when it happens; here it is flat, which
    // is what the descent half exists to refuse.
    broken: stepped(
      cfgBudgeted,
      solo(jWork),
      {
        label: "dispatch",
        transitions: [{ ticket: 1, from: "PPending", to: "PWorking" }],
        effects: ["SpawnWorkTasks"],
        landing: { tag: "WONone" },
      },
      sysMeasure(boundsOf(cfgBudgeted), solo(jWork).tickets),
    ),
    fixed: stepped(
      cfgBudgeted,
      solo(jWork),
      {
        label: "dispatch",
        transitions: [{ ticket: 1, from: "PPending", to: "PWorking" }],
        effects: ["SpawnWorkTasks"],
        landing: { tag: "WONone" },
      },
      sysMeasure(boundsOf(cfgBudgeted), solo(jWork).tickets) + 1,
    ),
    reds: ["measureDescends"],
  },
];

test("each invariant is red on the tree carrying its defect, and green on the corrected twin", () => {
  for (const p of redProofs) {
    assert.equal(
      p.holds(p.broken),
      false,
      `${p.name} holds on the tree carrying its own defect`,
    );
    assert.equal(
      p.holds(p.fixed),
      true,
      `${p.name} fails on the corrected twin`,
    );
  }
});

test("each defect tree reds EXACTLY the conjuncts it is named for, and the twin reds none", () => {
  for (const p of redProofs) {
    assert.deepEqual(
      redConjuncts(p.broken),
      new Set(p.reds),
      `${p.name}'s defect tree does not red exactly its named set`,
    );
    assert.deepEqual(
      redConjuncts(p.fixed),
      new Set(),
      `${p.name}'s corrected twin is not clean`,
    );
  }
});

test("the bundle agrees with the roster on every tree in the corpus", () => {
  // THE BUNDLE-MEMBERSHIP GUARD. `allInvariants` is a hand-written conjunction;
  // this is what stops it from omitting one. A dropped conjunct shows up here as
  // the bundle staying green on the one defect tree the roster reds, and nowhere
  // else — which is why the corpus needs an entry per conjunct and why the sets
  // above must be exact.
  const corpus: readonly Subject[] = [
    ...redProofs.flatMap((p) => [p.broken, p.fixed]),
    ...landedFleet.map(([, jb]) => quiet(cfgBudgeted, solo(jb))),
  ];
  for (const s of corpus) {
    assert.equal(
      allInvariants(s.cfg, s.core, s.history),
      redConjuncts(s).size === 0,
      "the bundle and the roster disagree",
    );
  }
});

test("the corpus carries a defect tree for every bundle conjunct but the tautology", () => {
  // The completeness check on the corpus itself. `stuckSubsetCovered` is the one
  // exclusion and it is excluded by name, because the model proves no tree can
  // red it; `measureNonNegative` is inside `measureDescends`, whose entry is the
  // `stepDescends` half — the other half is refused by assertion and is proved
  // in its own section.
  const covered = new Set(redProofs.flatMap((p) => p.reds));
  const bundled = bundleConjuncts.map(([name]) => name);
  assert.deepEqual(
    new Set(bundled.filter((name) => !covered.has(name))),
    new Set(["stuckSubsetCovered"]),
  );
});

test("exactly the conjuncts the model calls corollaries are the ones no tree isolates", () => {
  // THE HONEST LIMIT OF THE MEMBERSHIP GUARD, stated rather than left to be
  // discovered. The agreement test above catches a conjunct dropped from the
  // bundle only where some tree reds THAT conjunct ALONE. Three cannot be
  // isolated by any tree, and the model names the reason for each:
  //
  //   quietProjectLandsCleanly — a corollary of wrapUpIsolation's
  //                              failure-implies-moved conjunct, which is the
  //                              same condition in other words, stated
  //                              separately because it is the gate's own claim.
  //   stuckSubsetCovered       — a tautology over its two walks; no machine can
  //                              red it, which is the model's own finding.
  //   noStructuralDeadlock     — a ticket leaves canFinishSet only behind a
  //                              revoked dep (cascadeSafety sees it) or around a
  //                              cycle or dangling dep (depsAcyclic does), so
  //                              every tree that reds it reds a companion.
  //
  // `revokedNeverCompletes` READ AS UN-ISOLABLE AND IS NOT, which is why this
  // list is asserted rather than asserted-in-prose: its corollary derivation
  // needs `completions >= 0`, a floor no invariant states, so a negative ghost
  // counter reds it alone. That tree is in the corpus above and the
  // model-question is kasofsk#39.
  //
  // Reviewing the bundle beside the model's `and { ... }` is what covers the
  // three that remain. The set is pinned so that a FOURTH appearing is a
  // finding — and so that one leaving it, as this one just did, is visible too.
  const isolated = new Set(
    redProofs.filter((p) => p.reds.length === 1).flatMap((p) => p.reds),
  );
  assert.deepEqual(
    new Set(
      bundleConjuncts.map(([name]) => name).filter((n) => !isolated.has(n)),
    ),
    new Set([
      "quietProjectLandsCleanly",
      "stuckSubsetCovered",
      "noStructuralDeadlock",
    ]),
  );
});

test("the redundancy roster: conjuncts mirrored from the model that no state can red", () => {
  // THE RECORD THE TWO PREDICATES FORWARD-REFERENCE. Three mirrored conjuncts
  // cannot answer false on any tree, each because a TypeScript definition below
  // them is stricter or more total than the Quint one the model had to write
  // around. They are kept, because the model's arm has them and because the
  // assertion each leans on could be relaxed; they are named here so that a
  // reader who cannot find their red-proof learns why there is none, and so that
  // the mutation sweep's expected-survivor set has a home in the tree.
  //
  //   tasksWellFormed  `t.kind.stage === s`  — `evalStage` asserts the live set
  //                                            carries one stage's marks, so a
  //                                            set that reached here is uniform.
  //   tasksWellFormed  `s >= 0`              — `evalStage` asserts each mark is
  //                                            a count and answers 0 for a set
  //                                            with no marks at all.
  //   recordMonotone   `record.length >=`    — `sameTask` is total on an absent
  //                                            entry, so the walk already
  //                                            refuses a shrunk record. Quint
  //                                            errors on an out-of-range index,
  //                                            which is why the model needs it.
  //
  // Each claim below is the assertion that makes its conjunct redundant, so if
  // one is relaxed this test fails and the conjunct needs a red-proof again.
  assert.throws(
    () => evalStage([et(1, 0, "TPassed"), et(2, 1, "TPassed")]),
    AssertionError,
  );
  assert.equal(evalStage([]), 0);
  assert.equal(evalStage([wt(1, "TPassed")]), 0);
  assert.throws(() => evalStage([et(1, -1, "TPassed")]), AssertionError);
  // `sameTask`'s totality, read through the predicate that uses it: a previous
  // record longer than the current one is refused by the entry walk alone.
  assert.equal(
    recordMonotone(
      solo({ ...jDraft, record: [], spawned: 0 }),
      new Map([[1, [wt(1, "TPassed")]]]),
    ),
    false,
  );
});

// === measureNonNegative: refused louder than the model refuses it ==========

test("measureNonNegative: a negative account is refused by assertion, not reported false", () => {
  // The well-foundedness half cannot return false on this tree, and the reason
  // is `measure.ts`: every account it sums is asserted to be a count, and every
  // other digit is a rank, a bounded stage index or a running count. So the
  // states the model would call negative fail one level louder here — the same
  // answer `configAdmitsInit` gives a negative grant.
  for (const account of ["gasLeft", "reworkLeft", "wrapUpLeft"] as const) {
    const negative = solo({ ...jDraft, [account]: -1 });
    assert.throws(
      () => measureNonNegative(cfgBudgeted, negative),
      AssertionError,
      `a negative ${account} is answered rather than refused`,
    );
    // The corrected twin, through the same call: non-negative, reported so.
    assert.ok(measureNonNegative(cfgBudgeted, solo(jDraft)));
  }
  // AND THE BUNDLE STILL ANSWERS FALSE RATHER THAN THROWING, because of the
  // conjunct ORDER it inherits from the model: `accountsBounded` is conjoined
  // ahead of `measureDescends`, and the floor the first one states is exactly
  // the condition the second one's measure asserts. So every
  // tree that would throw is already refused by name, and the throw is reachable
  // only by asking the half directly — which is what makes it a louder refusal
  // rather than a hole.
  const negative = solo({ ...jDraft, gasLeft: -1 });
  // `measureDescends` conjoins this half FIRST, so it inherits the refusal even
  // on a step an exemption arm covers — a step under which the descent half
  // short-circuits and never takes a measure at all. That is what makes the
  // conjunction of the two halves observable rather than a formality.
  assert.throws(
    () => measureDescends(cfgBudgeted, negative, settledStep, 0),
    AssertionError,
  );
  assert.equal(accountsBounded(cfgBudgeted, negative), false);
  assert.equal(
    allInvariants(
      cfgBudgeted,
      negative,
      quiet(cfgBudgeted, solo(jDraft)).history,
    ),
    false,
  );
});

test("accountsBounded holds every account at both ends, one account at a time", () => {
  // Three accounts, two ends each. The ceilings come from the instance, so they
  // are read off the config rather than written as numerals.
  const ceilings: readonly (readonly [string, Ticket])[] = [
    ["gasLeft", { ...jDraft, gasLeft: cfgBudgeted.gas + 1 }],
    ["reworkLeft", { ...jDraft, reworkLeft: jDraft.reworkLeft + 2 }],
    ["wrapUpLeft", { ...jDraft, wrapUpLeft: jDraft.wrapUpLeft + 1 }],
  ];
  for (const [account, jb] of ceilings) {
    assert.equal(
      accountsBounded(cfgBudgeted, solo(jb)),
      false,
      `${account} is not held below its grant`,
    );
  }
  // And a ticket at both extremes of every account at once is accepted: the
  // bounds are inclusive, which is what "nothing refunds" means at a full grant.
  assert.ok(accountsBounded(cfgBudgeted, solo(draft(cfgBudgeted))));
  assert.ok(
    accountsBounded(
      cfgBudgeted,
      solo({ ...jDraft, gasLeft: 0, reworkLeft: 0, wrapUpLeft: 0 }),
    ),
  );
});

// === wrapUpIsolation, conjunct by conjunct =================================

test("wrapUpIsolation: every conjunct of both arms, each with the step that breaks it", () => {
  const onQueue = solo(jLand);
  const done = solo(jDone);
  // --- The WONone arm: a landing is never resolved off-record.
  // A completion carrying no attribution is legitimate for a WNone ticket and
  // for no other — the one `ticket-done` that resolves no attempt at all.
  const doneOffRecord: StepRecord = {
    label: "ticket-done",
    transitions: [{ ticket: 1, from: "PEvaluating", to: "PDone" }],
    effects: ["Complete"],
    landing: { tag: "WONone" },
  };
  assert.equal(wrapUpIsolation(cfgBudgeted, done, doneOffRecord), false);
  assert.ok(
    wrapUpIsolation(
      cfgBudgeted,
      solo({ ...jDone, wrapUp: { tag: "WNone" } }),
      doneOffRecord,
    ),
  );
  // Two transitions under the same label: the WNone completion moves one ticket.
  assert.equal(
    wrapUpIsolation(cfgBudgeted, solo({ ...jDone, wrapUp: { tag: "WNone" } }), {
      ...doneOffRecord,
      transitions: [
        ...doneOffRecord.transitions,
        { ticket: 1, from: "PEvaluating", to: "PDone" },
      ],
    }),
    false,
  );
  // The two uniquely-landing labels may not appear without an attempt at all.
  for (const label of [
    "rework-started wrapup_failure",
    "ticket-escalated wrapup_budget_exhausted",
  ]) {
    assert.equal(
      wrapUpIsolation(cfgBudgeted, onQueue, {
        ...settledStep,
        label,
      }),
      false,
      `${label} is accepted off-record`,
    );
  }
  // `gas_exhausted` is deliberately NOT among them: it is shared with the eval
  // side, so it is legitimately attribution-free there.
  assert.ok(
    wrapUpIsolation(cfgBudgeted, onQueue, {
      ...settledStep,
      label: "ticket-escalated gas_exhausted",
    }),
  );
  // --- The WOAttempt arm, one conjunct at a time.
  // The attribution is inside the project universe — asked of a ticket that
  // AGREES with the attribution, because otherwise the own-project conjunct
  // answers first and this one is never reached. Both ends of the universe.
  for (const project of [0, cfgBudgeted.nProjects + 1]) {
    assert.equal(
      wrapUpIsolation(
        cfgBudgeted,
        solo({ ...jDone, project }),
        landingStep("ticket-done", "PWrapUp", project, false),
      ),
      false,
      `project ${String(project)} is accepted as an attribution`,
    );
    // ...and the own-project conjunct is the one that catches a DISAGREEMENT,
    // which is the mutant a constant stamp would be.
    assert.equal(
      wrapUpIsolation(
        cfgBudgeted,
        done,
        landingStep("ticket-done", "PWrapUp", project, false),
      ),
      false,
    );
  }
  // An attempt moves at least one ticket, and exactly one.
  assert.equal(
    wrapUpIsolation(cfgBudgeted, done, {
      ...landingStep("ticket-done", "PWrapUp", 1, false),
      transitions: [],
    }),
    false,
  );
  assert.equal(
    wrapUpIsolation(cfgBudgeted, done, {
      ...landingStep("ticket-done", "PWrapUp", 1, false),
      transitions: [
        { ticket: 1, from: "PWrapUp", to: "PDone" },
        { ticket: 1, from: "PWrapUp", to: "PDone" },
      ],
    }),
    false,
  );
  // The label is one of the four the attempt may resolve under.
  assert.equal(
    wrapUpIsolation(
      cfgBudgeted,
      done,
      landingStep("ticket-released", "PWrapUp", 1, false),
    ),
    false,
  );
  // A gate FAILURE carries invalidated — there is no cross-project path to one.
  assert.equal(
    wrapUpIsolation(
      cfgBudgeted,
      done,
      landingStep("ticket-escalated gas_exhausted", "PWrapUp", 1, false),
    ),
    false,
  );
  // THE PATH IFF, both directions: moved resolves from the gate, quiet from the
  // queue, and neither is accepted on the other's slot.
  assert.ok(
    wrapUpIsolation(
      cfgBudgeted,
      done,
      landingStep("ticket-done", "PWrapUpHolding", 1, true),
    ),
  );
  assert.equal(
    wrapUpIsolation(
      cfgBudgeted,
      done,
      landingStep("ticket-done", "PWrapUp", 1, true),
    ),
    false,
  );
  assert.equal(
    wrapUpIsolation(
      cfgBudgeted,
      done,
      landingStep("ticket-done", "PWrapUpHolding", 1, false),
    ),
    false,
  );
});

test("wrapUpWellFormed is what makes leaseExclusive's quantifier cover every lease", () => {
  // The model's argument for the conjunct, made checkable: two tickets holding
  // a lease on a resource OUTSIDE the universe are serialized against nothing,
  // because `leaseExclusive` counts holders per member of `projects` — so the
  // depth-1 claim stays GREEN on a fleet that plainly violates it, and only
  // `wrapUpWellFormed` sees the breach.
  const offUniverse: Ticket = {
    ...jGated,
    wrapUp: { tag: "WExclusive", resource: cfgBudgeted.nProjects + 1 },
  };
  const c = core([
    [1, offUniverse],
    [2, offUniverse],
  ]);
  assert.ok(leaseExclusive(cfgBudgeted, c));
  assert.equal(wrapUpWellFormed(cfgBudgeted, c), false);
  // Inside the universe the same fleet is caught by the depth-1 claim itself.
  const inUniverse = core([
    [1, jGated],
    [2, jGated],
  ]);
  assert.equal(leaseExclusive(cfgBudgeted, inUniverse), false);
  assert.ok(wrapUpWellFormed(cfgBudgeted, inUniverse));
});

// === The phase-shaped conjuncts, as exact sets over all nine phases ========
// `domain.test.ts`'s rule, applied to the invariants: a conjunct that is an
// EQUALITY over the phases is pinned by the exact set of phases it refuses, not
// by one counter-example. There are nine phases, so a counter-example closes one
// of eight doors.

/** The exact set of phases on which a one-ticket claim fails, over all nine. */
function refusedPhases(
  at: (p: Phase) => Ticket,
  holds: (c: Core) => boolean,
): ReadonlySet<Phase> {
  return new Set(allPhases.filter((p) => !holds(solo(at(p)))));
}

test("completionExclusive and revokedNeverCompletes, over every phase", () => {
  // A ticket carrying one completion effect is well-formed at Done and nowhere
  // else — the iff, over its whole domain rather than against Revoked alone.
  assert.deepEqual(
    refusedPhases(
      (phase) => ({ ...jDraft, phase, completions: 1 }),
      completionExclusive,
    ),
    phasesExcept("PDone"),
  );
  // And the exclusivity half sees exactly one of those nine.
  assert.deepEqual(
    refusedPhases(
      (phase) => ({ ...jDraft, phase, completions: 1 }),
      revokedNeverCompletes,
    ),
    new Set(["PRevoked"]),
  );
  // The at-most-once half is blind to the phase, which is the other thing the
  // sweep has to show: a second completion is refused everywhere.
  assert.deepEqual(
    refusedPhases(
      (phase) => ({ ...jDraft, phase, completions: 2 }),
      completionExclusive,
    ),
    new Set(allPhases),
  );
  // AND THE IFF IN ITS OTHER DIRECTION. Everything above varies the COUNT away
  // from the phase; this varies the phase away from the count, so `Done implies
  // one completion` is pinned rather than only `one completion implies Done`. A
  // landed ticket that emitted nothing is refused at Done and, being a plain
  // uncompleted ticket anywhere else, is well-formed at the other eight.
  assert.deepEqual(
    refusedPhases(
      (phase) => ({ ...jDone, phase, completions: 0 }),
      completionExclusive,
    ),
    new Set(["PDone"]),
  );
});

test("artifactWellFormed, noLeaseWithoutAKind and deskConsistent, over every phase", () => {
  // A ticket that produced nothing is refused at Done alone. A Revoked ticket
  // may hold `ANone`: it may never have run.
  assert.deepEqual(
    refusedPhases((phase) => ({ ...jDraft, phase }), artifactWellFormed),
    new Set(["PDone"]),
  );
  // A kindless ticket is refused in the two wrap-up phases and nowhere else.
  assert.deepEqual(
    refusedPhases(
      (phase) => ({ ...jDraft, phase, wrapUp: { tag: "WNone" } }),
      noLeaseWithoutAKind,
    ),
    new Set(["PWrapUp", "PWrapUpHolding"]),
  );
  // A named wall with a resume point belongs to the desk phase alone — both
  // iffs, swept together, since a ticket carrying either off the desk is wrong.
  assert.deepEqual(
    refusedPhases(
      (phase) => ({
        ...jDraft,
        phase,
        reason: "RsWorkFailed",
        resumeAt: "RWorking",
      }),
      deskConsistent,
    ),
    phasesExcept("PEscalated"),
  );
  // And the dependency_revoked wall is the one park with no resume: give it one
  // and the desk is inconsistent at the desk phase itself.
  assert.equal(
    deskConsistent(solo({ ...jParkDep, resumeAt: "RPending" })),
    false,
  );
  assert.equal(deskConsistent(solo({ ...jEsc, resumeAt: "RNone" })), false);
});

test("tasksWellFormed: dead live-task state is refused in every phase but the two that carry it", () => {
  // A resolved WORK set is the Working anatomy and nothing else's — including
  // Evaluating's, which is what separates the two task phases by their kind mark
  // rather than by the phase alone.
  assert.deepEqual(
    refusedPhases(
      (phase) => ({
        ...jDraft,
        phase,
        tasks: [wt(1, "TPassed"), wt(2, "TPassed")],
        spawned: 2,
      }),
      (c) => tasksWellFormed(cfgBudgeted, c),
    ),
    phasesExcept("PWorking"),
  );
  // And a resolved EVAL set at stage 0 is Evaluating's alone.
  assert.deepEqual(
    refusedPhases(
      (phase) => ({ ...jEval, phase }),
      (c) => tasksWellFormed(cfgBudgeted, c),
    ),
    phasesExcept("PEvaluating"),
  );
  // BOTH WIDTHS ARE EQUALITIES, AND BOTH ARE NOW PINNED FROM ABOVE AS WELL AS
  // FROM BELOW. Only the narrow side had a fixture, and the wide side is the one
  // that matters more: `micro`'s digit-order argument holds `runningCount` below
  // `nTasks`, so an anatomy that admitted a wider set would admit states whose
  // measure digit escapes its radix. Both fixtures carry RESOLVED tasks, which
  // is what lets the invariant answer at all — a live set of three trips that
  // same precondition inside the measure before any invariant is asked.
  assert.equal(tasksWellFormed(cfgBudgeted, solo(jWorkWide)), false);
  assert.equal(tasksWellFormed(cfgBudgeted, solo(jEvalWide)), false);
  assert.equal(runningCount(jWorkWide.tasks), 0);
  assert.equal(runningCount(jEvalWide.tasks), 0);
  // AND THE WIDTH IS SWEPT AS AN EXACT SET OVER ITS OWN DOMAIN, which is what
  // this tree's rule asks for and what two fixtures either side of the const
  // cannot give. Pinned at `nTasks - 1` and `nTasks + 1` alone, the equality
  // agrees with any predicate that happens to admit those two — a modulo, or an
  // equality widened by two. Swept from the empty set to `nTasks + 2`, the
  // verdict is a set and there is nowhere left for such a reading to hide.
  const widths = [0, 1, 2, 3, 4];
  const acceptedWorkWidths = new Set(
    widths.filter((w) =>
      tasksWellFormed(
        cfgBudgeted,
        solo({
          ...jWork,
          tasks: Array.from({ length: w }, (_, i) => wt(i + 1, "TPassed")),
          spawned: w,
        }),
      ),
    ),
  );
  assert.deepEqual(acceptedWorkWidths, new Set([cfgBudgeted.nTasks]));
  // The same sweep on the eval arm, where the width is the PROGRAM's rather
  // than the const's — `progU2`'s only stage declares a fan-out of 2.
  const acceptedEvalWidths = new Set(
    widths.filter((w) =>
      tasksWellFormed(
        cfgBudgeted,
        solo({
          ...jEval,
          tasks: Array.from({ length: w }, (_, i) => et(i + 1, 0, "TPassed")),
          spawned: w,
        }),
      ),
    ),
  );
  assert.deepEqual(acceptedEvalWidths, new Set([progU2[0]?.fanout]));
  // The width, the kind, the outcome and the id run, each alone.
  const badEvals: readonly (readonly [string, Ticket])[] = [
    [
      "a narrow fan-out",
      { ...jEval, tasks: [et(1, 0, "TPassed")], spawned: 1 },
    ],
    [
      "a cancelled live task",
      { ...jEval, tasks: [et(1, 0, "TCancelled"), et(2, 0, "TPassed")] },
    ],
    [
      "a stage past the program's end",
      { ...jEval, tasks: [et(1, 9, "TPassed"), et(2, 9, "TFailed")] },
    ],
    [
      "an id run that does not sit above the record",
      { ...jEval, tasks: [et(2, 0, "TPassed"), et(3, 0, "TFailed")] },
    ],
  ];
  for (const [what, jb] of badEvals) {
    assert.equal(
      tasksWellFormed(cfgBudgeted, solo(jb)),
      false,
      `${what} is accepted as a live eval set`,
    );
  }
  // A cancelled live WORK task, the same claim on the other arm.
  assert.equal(
    tasksWellFormed(
      cfgBudgeted,
      solo({ ...jWork, tasks: [wt(1, "TCancelled"), wt(2, "TPassed")] }),
    ),
    false,
  );
  // A staged program's LATER stage is well-formed at its own width: the stage
  // index is read from the marks, so nothing here is pinned to stage 0.
  assert.ok(
    tasksWellFormed(
      cfgBudgeted,
      solo({
        ...jDraft,
        phase: "PEvaluating",
        program: progStaged,
        record: [wt(1, "TPassed"), wt(2, "TPassed"), et(3, 0, "TPassed")],
        tasks: [et(4, 1, "TPassed"), et(5, 1, "TFailed")],
        spawned: 5,
      }),
    ),
  );
});

test("tasksWellFormed: a live set carrying two different stage marks is refused by assertion", () => {
  // The one place `measure.ts` is stricter than the model, and the negative
  // space this invariant is what excludes: the model's `evalStage` folds over a
  // set, so a MIXED set's answer depends on the fold's pick order, and this
  // invariant is what forbids the mixed case on every reachable state. A
  // deterministic implementation cannot mirror a nondeterministic answer, so the
  // case is refused where the stage is derived rather than reported false here.
  assert.throws(
    () =>
      tasksWellFormed(
        cfgBudgeted,
        solo({ ...jEval, tasks: [et(1, 0, "TPassed"), et(2, 1, "TFailed")] }),
      ),
    AssertionError,
  );
});

test("terminalsAbsorbing, over every phase a transition could leave", () => {
  assert.deepEqual(
    new Set(
      allPhases.filter(
        (from) =>
          !terminalsAbsorbing({
            ...settledStep,
            label: "operator-retry",
            transitions: [{ ticket: 1, from, to: "PPending" }],
          }),
      ),
    ),
    new Set(["PDone", "PRevoked"]),
  );
  // Every transition on the step is read, not only the first.
  assert.equal(
    terminalsAbsorbing({
      ...settledStep,
      label: "ticket-revoked",
      transitions: [
        { ticket: 1, from: "PPending", to: "PRevoked" },
        { ticket: 2, from: "PDone", to: "PEscalated" },
      ],
    }),
    false,
  );
  // And a step that moves nothing absorbs nothing.
  assert.ok(terminalsAbsorbing(settledStep));
});

test("leaseExclusive is a relation over resources AND phases, pinned at both ends", () => {
  // THE PHASE END: two tickets on one resource collide in the holding phase and
  // in no other, so an occupancy predicate widened past `PWrapUpHolding` is
  // caught wherever it was widened to.
  assert.deepEqual(
    new Set(
      allPhases.filter(
        (phase) =>
          !leaseExclusive(
            cfgBudgeted,
            core([
              [1, jGated],
              [2, { ...jGated, phase }],
            ]),
          ),
      ),
    ),
    new Set(["PWrapUpHolding"]),
  );
  // THE RESOURCE END: the same two holders collide only while they name the
  // same resource, over the whole universe plus the answer `leaseOf` gives a
  // kind that needs none.
  assert.deepEqual(
    new Set(
      [0, 1, 2].filter(
        (resource) =>
          !leaseExclusive(
            cfgBudgeted,
            core([
              [1, jGated],
              [2, { ...jGated, wrapUp: { tag: "WExclusive", resource } }],
            ]),
          ),
      ),
    ),
    new Set([1]),
  );
  // AND THE COLLISION ITSELF IS SWEPT OVER THE UNIVERSE, not pinned to the
  // first project. Every fixture above holds resource 1, so a walk that counted
  // holders of resource 1 alone would agree with all of them. THE SWEEP IS
  // DERIVED FROM `projects` RATHER THAN WRITTEN OUT, because a literal `[1, 2]`
  // is indistinguishable from the universe at every instance this suite
  // configures — and a quantifier hard-coded to that same pair would pass a
  // hard-coded sweep for the same reason.
  const collideOn = (cfg: Config, resource: number): boolean => {
    const both: Ticket = { ...jGated, wrapUp: { tag: "WExclusive", resource } };
    return leaseExclusive(
      cfg,
      core([
        [1, both],
        [2, both],
      ]),
    );
  };
  for (const resource of projects(cfgBudgeted)) {
    assert.equal(
      collideOn(cfgBudgeted, resource),
      false,
      `a collision on resource ${String(resource)} is not counted`,
    );
  }
  // ...AND AT AN INSTANCE WHOSE UNIVERSE IS WIDER THAN THIS SUITE'S. Deriving
  // the sweep is not sufficient on its own, and the wider instance is what
  // closes it: every config here has two projects, so `projects` and the literal
  // pair enumerate the same values, and a collision on a THIRD is counted only
  // by a quantifier that really reads the instance. The derived loop above stays
  // as the right style — it is what tracks a universe that widens later — rather
  // than as the thing that catches the hard-coded quantifier.
  const cfgThreeProjects: Config = { ...cfgBudgeted, nProjects: 3 };
  const third = cfgThreeProjects.nProjects;
  assert.ok(!projects(cfgBudgeted).has(third));
  assert.ok(projects(cfgThreeProjects).has(third));
  assert.equal(collideOn(cfgThreeProjects, third), false);
  // The same fleet reds that conjunct and no other: a lease on the third
  // resource is authorable at this instance, so nothing else objects to it.
  const both: Ticket = {
    ...jGated,
    wrapUp: { tag: "WExclusive", resource: third },
  };
  assert.deepEqual(
    redConjuncts(
      quiet(
        cfgThreeProjects,
        core([
          [1, both],
          [2, both],
        ]),
      ),
    ),
    new Set(["leaseExclusive"]),
  );
});

// === Dependencies that DISAGREE ============================================
// `domain.test.ts`'s `cMixedDeps` lesson, inherited: "a `forall` over a relation
// needs members that disagree, not one more uniform set". Every quantifier over
// a dep set — `anyEdgeIn`'s exists, `everyDepIn`'s forall, and the two walks
// that read a dep list to its end — answers identically on every single-dep
// fleet, whichever way it is written. Only a ticket with two deps that disagree
// tells them apart, and in each fleet below the DISCRIMINATING dep is the second
// one, so a walk that stops at the first is caught as well as one that swaps its
// quantifier.

/** A healthy dep and a PARKED one, in that order, under one dependent. */
const cMixedStuck: Core = core([
  [1, { ...jDraft, phase: "PPending" }],
  [2, jEsc],
  [3, { ...jDraft, phase: "PPending", deps: new Set([1, 2]) }],
]);

/** A dep that FINISHED and one that never will, in that order, under one dependent. */
const cMixedFinish: Core = core([
  [1, jDone],
  [2, { ...jDraft, phase: "PRevoked" }],
  [3, { ...jDraft, phase: "PPending", deps: new Set([1, 2]) }],
]);

/**
 * The same pair TRANSPOSED: the dep that never finishes comes first.
 *
 * "Second of two" is also "last of two", so `cMixedFinish` alone is satisfied by
 * a walk that reads only the last dep exactly as a single-dep fleet is satisfied
 * by one reading only the first. Both walks over a dep list are asked in both
 * orders, and neither order is the one that happens to work.
 */
const cRevokedFirst: Core = core([
  [1, { ...jDraft, phase: "PRevoked" }],
  [2, jDone],
  [3, { ...jDraft, phase: "PPending", deps: new Set([1, 2]) }],
]);

test("the visibility walks quantify with EXISTS over a dep set, and read it to the end", () => {
  // A dependent is stuck behind ONE parked dep, not only behind all of them —
  // and the parked dep is the second, so the walk has to get past a healthy one
  // to find it. A forall here would answer {2}, and a first-dep-only walk would
  // answer {2} as well.
  assert.deepEqual(stuckSet(cMixedStuck), new Set([2, 3]));
  // Coverage propagates the same way and through EVERY phase, so it agrees.
  assert.deepEqual(coveredSet(cMixedStuck), new Set([2, 3]));
  assert.ok(stuckSubsetCovered(cMixedStuck));
  // And the other direction of the same quantifier: no parked dep anywhere in
  // the chain leaves the dependent unstuck, however many deps it has.
  const healthy = core([
    [1, { ...jDraft, phase: "PPending" }],
    [2, { ...jDraft, phase: "PPending" }],
    [3, { ...jDraft, phase: "PPending", deps: new Set([1, 2]) }],
  ]);
  assert.deepEqual(stuckSet(healthy), new Set());
  assert.deepEqual(coveredSet(healthy), new Set());
});

test("the two walks differ by exactly one conjunct, and a dispatched dependent shows it", () => {
  // THE ASYMMETRY `stuckSubsetCovered` IS KEPT TO GUARD, as a value rather than
  // as a containment. `stuckSet`'s inductive arm is `coveredSet`'s plus the
  // `PPending` conjunct, and every fleet whose dependents are all Pending
  // answers the same with or without it. A dependent that has already
  // DISPATCHED is the shape that separates them: its measure is descending on
  // its own work, so it is not stuck — but it is still covered, because
  // coverage propagates through every phase and deliberately has no phase guard.
  const dispatched = core([
    [1, jEsc],
    [2, { ...jWork, deps: new Set([1]) }],
  ]);
  assert.deepEqual(stuckSet(dispatched), new Set([1]));
  assert.deepEqual(coveredSet(dispatched), new Set([1, 2]));
  // Containment still holds, and holds STRICTLY — which is the point: a
  // containment assertion alone is satisfied by dropping the conjunct, and only
  // the two values say which walk is which.
  assert.ok(stuckSubsetCovered(dispatched));
  assert.ok(stuckSet(dispatched).size < coveredSet(dispatched).size);
  // The guard is on the PHASE and not on having-dependencies: the same
  // dependent, Pending, is stuck.
  assert.deepEqual(
    stuckSet(
      core([
        [1, jEsc],
        [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
      ]),
    ),
    new Set([1, 2]),
  );
});

test("canFinishSet quantifies with FORALL over a dep set, and revokeDoomed reads it to the end", () => {
  // THE MACHINE THEOREM. A ticket can finish only when EVERY gate dep can — one
  // Done dep is not enough while another is Revoked, and swapping this forall
  // for an exists would report the deadlocked ticket as live. The Revoked dep is
  // second, so a walk that stopped at the Done one would agree with the exists.
  assert.deepEqual(canFinishSet(cMixedFinish), new Set([1]));
  assert.equal(noStructuralDeadlock(cMixedFinish), false);
  // The doom walk reads the same dep list to its end, for the same reason.
  assert.deepEqual(revokeDoomed(cMixedFinish), new Set([3]));
  assert.equal(cascadeSafety(cMixedFinish), false);
  // Those two are the whole of what this fleet reds — the deadlock and the
  // cascade, which is the pairing the model argues for and nothing else.
  assert.deepEqual(
    redConjuncts(quiet(cfgFleet, cMixedFinish)),
    new Set(["cascadeSafety", "noStructuralDeadlock"]),
  );
  // TRANSPOSED: the same claims with the Revoked dep FIRST, so neither walk is
  // pinned only at the last position it reads. `canFinishSet` still admits the
  // Done dep and still refuses the dependent; `revokeDoomed` still finds the
  // doom although an impeccable dep follows it.
  assert.deepEqual(canFinishSet(cRevokedFirst), new Set([2]));
  assert.equal(noStructuralDeadlock(cRevokedFirst), false);
  assert.deepEqual(revokeDoomed(cRevokedFirst), new Set([3]));
  assert.equal(cascadeSafety(cRevokedFirst), false);
  assert.deepEqual(
    redConjuncts(quiet(cfgFleet, cRevokedFirst)),
    new Set(["cascadeSafety", "noStructuralDeadlock"]),
  );
  // And the forall's other direction: EVERY dep Done puts the dependent back in
  // the fixpoint, which is what stops this being a claim about dep COUNT.
  const allDone = core([
    [1, jDone],
    [2, jDone],
    [3, { ...jDraft, phase: "PPending", deps: new Set([1, 2]) }],
  ]);
  assert.deepEqual(canFinishSet(allDone), new Set([1, 2, 3]));
  assert.ok(noStructuralDeadlock(allDone));
  assert.deepEqual(revokeDoomed(allDone), new Set());
});

// === The dependency relation, pinned at both ends ==========================

test("depsAcyclic reads the dep's existence AND its id order, over both ends", () => {
  // A three-ticket fleet, one dependent at a time naming one dep at a time. The
  // claim holds exactly on the pairs where the dep exists and points downward,
  // which is a set over BOTH ends rather than a counter-example at either.
  const fleet = (j: number, d: number): Core =>
    core([
      [1, j === 1 ? { ...jDraft, deps: new Set([d]) } : jDraft],
      [2, j === 2 ? { ...jDraft, deps: new Set([d]) } : jDraft],
      [3, j === 3 ? { ...jDraft, deps: new Set([d]) } : jDraft],
    ]);
  const ids = [1, 2, 3];
  const held = new Set(
    ids.flatMap((j) =>
      ids
        .filter((d) => depsAcyclic(fleet(j, d)))
        .map((d) => `${String(j)}<-${String(d)}`),
    ),
  );
  assert.deepEqual(held, new Set(["2<-1", "3<-1", "3<-2"]));
  // A dep naming a ticket the fleet does not hold is refused ABOVE the
  // dependent, where the id order already refuses it...
  assert.equal(depsAcyclic(fleet(3, 4)), false);
  // ...and BELOW it, where nothing but the existence conjunct can. A dep that
  // points downward at an id the fleet is missing is the tombstone case, and it
  // is the only shape that tells the two conjuncts apart.
  assert.equal(
    depsAcyclic(
      core([
        [1, jDraft],
        [3, { ...jDraft, deps: new Set([2]) }],
      ]),
    ),
    false,
  );
  // AND THE WALK READS THE DEP SET TO ITS END. Every fleet above gives a ticket
  // one dep, so a walk that inspected only the first would agree with all of
  // them. Here the first dep is impeccable and the second carries the breach —
  // once for each of the two conjuncts, so neither is pinned only at position 0.
  const secondDepIsBad = (bad: number): Core =>
    core([
      [1, jDraft],
      [2, jDraft],
      [3, { ...jDraft, deps: new Set([1, bad]) }],
      [4, jDraft],
    ]);
  assert.equal(depsAcyclic(secondDepIsBad(4)), false); // points upward
  assert.equal(depsAcyclic(secondDepIsBad(9)), false); // names no ticket
  // The same fleet with a good second dep is accepted, so the two assertions
  // above are about the dep and not about having two of them.
  assert.ok(depsAcyclic(secondDepIsBad(2)));
  // AND THE BREACH IS PUT FIRST AS WELL AS LAST. "Second of two" is also "last
  // of two", so the fixtures above are satisfied by a walk that reads only the
  // LAST dep just as the single-dep fixtures were satisfied by one reading only
  // the first. Transposing the dep set closes the remaining reading: here the
  // breach is at position 0 and an impeccable dep follows it.
  const firstDepIsBad = (bad: number): Core =>
    core([
      [1, jDraft],
      [2, jDraft],
      [3, { ...jDraft, deps: new Set([bad, 2]) }],
      [4, jDraft],
    ]);
  assert.equal(depsAcyclic(firstDepIsBad(4)), false); // points upward
  assert.equal(depsAcyclic(firstDepIsBad(9)), false); // names no ticket
  assert.ok(depsAcyclic(firstDepIsBad(1)));
  // And a ticket with NO deps is accepted at every position.
  assert.ok(
    depsAcyclic(
      core([
        [1, jDraft],
        [2, jDraft],
        [3, jDraft],
      ]),
    ),
  );
});

test("cascadeSafety is a relation over the dep's phase AND the dependent's, pinned at both", () => {
  // THE DEP END: only a REVOKED dep dooms. An escalated one does not — the
  // model's cascade is about the author's settlement, not about the desk.
  assert.deepEqual(
    new Set(
      allPhases.filter(
        (phase) =>
          !cascadeSafety(
            core([
              [1, { ...jDraft, phase }],
              [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
            ]),
          ),
      ),
    ),
    new Set(["PRevoked"]),
  );
  // THE DEPENDENT END: a doomed ticket is acceptable only revoked itself, or
  // parked behind its own named wall. Swept with `RsNone`, so only the first
  // disjunct can pass; the parked answer is the twin below.
  assert.deepEqual(
    new Set(
      allPhases.filter(
        (phase) => !cascadeSafety(behindARevoke({ ...jDraft, phase })),
      ),
    ),
    phasesExcept("PRevoked"),
  );
  // The park passes only with the wall the cascade actually names.
  assert.ok(cascadeSafety(behindARevoke(jParkDep)));
  assert.equal(cascadeSafety(behindARevoke(jEsc)), false);
  // A doomed dependent left PENDING reds BOTH halves at once, and the cascade's
  // own park repairs both in one field. That pairing is the model's argument for
  // the cascade being ATOMIC with the revoke: there is no reachable in-between
  // state where a doomed ticket waits invisibly.
  const waiting = behindARevoke({ ...jDraft, phase: "PPending" });
  assert.equal(cascadeSafety(waiting), false);
  assert.equal(noStructuralDeadlock(waiting), false);
  assert.ok(noStructuralDeadlock(behindARevoke(jParkDep)));
  // TRANSITIVELY: the doom reaches a dependent's dependent, which is what makes
  // `revokeDoomed` a closure rather than a one-hop read.
  const chain = core([
    [1, { ...jDraft, phase: "PRevoked" }],
    [2, { ...jParkDep, deps: new Set([1]) }],
    [3, { ...jDraft, phase: "PPending", deps: new Set([2]) }],
  ]);
  assert.deepEqual(revokeDoomed(chain), new Set([2, 3]));
  assert.equal(cascadeSafety(chain), false);
});

test("noStructuralDeadlock: the terminal a dependent cannot survive, over every phase", () => {
  // A Pending ticket behind ONE dep, swept over that dep's nine phases. Only a
  // revoked dep leaves it with no continuation — an escalated one is
  // over-approximated into `canFinishSet` on purpose, because this is a deadlock
  // net rather than a liveness oracle.
  assert.deepEqual(
    new Set(
      allPhases.filter(
        (phase) =>
          !noStructuralDeadlock(
            core([
              [1, { ...jDraft, phase }],
              [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
            ]),
          ),
      ),
    ),
    new Set(["PRevoked"]),
  );
  // And the dependent's OWN desk task is the other way out: the cascade's park
  // repairs the same tree without the dep changing at all.
  assert.ok(noStructuralDeadlock(behindARevoke(jParkDep)));
  assert.ok(hasOpenHumanTask(jParkDep));
  // `canFinishSet` reaches Done through a chain, and stops at the cycle.
  const chain = core([
    [1, { ...jDone, deps: new Set() }],
    [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
    [3, { ...jDraft, phase: "PPending", deps: new Set([2]) }],
  ]);
  assert.deepEqual(canFinishSet(chain), new Set([1, 2, 3]));
  const cycle = core([
    [1, { ...jDraft, phase: "PPending", deps: new Set([2]) }],
    [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
  ]);
  assert.deepEqual(canFinishSet(cycle), new Set());
});

// === recordMonotone, over both ends of the history relation ================

test("recordMonotone refuses a shrink, a rewrite and a vanished ticket", () => {
  const twoEntries: readonly Task[] = [wt(1, "TPassed"), wt(2, "TFailed")];
  const withRecord = (record: readonly Task[]): Core =>
    solo({ ...jDraft, record, spawned: record.length });
  const previous = new Map([[1, twoEntries]]);
  // Nothing shrinks.
  assert.equal(recordMonotone(withRecord([wt(1, "TPassed")]), previous), false);
  // Nothing settled is rewritten — outcome, kind or id.
  assert.equal(
    recordMonotone(withRecord([wt(1, "TPassed"), wt(2, "TPassed")]), previous),
    false,
  );
  assert.equal(
    recordMonotone(
      withRecord([wt(1, "TPassed"), et(2, 0, "TFailed")]),
      previous,
    ),
    false,
  );
  assert.equal(
    recordMonotone(withRecord([wt(1, "TPassed"), wt(3, "TFailed")]), previous),
    false,
  );
  // A running entry replacing a settled one is a rewrite too — the state is
  // compared, not only the outcome inside it.
  assert.equal(
    recordMonotone(withRecord([wt(1, "TPassed"), wr(2)]), previous),
    false,
  );
  // AND THE KIND IS COMPARED INSIDE ITS CONSTRUCTOR, not only by constructor.
  // Every rewrite above changes the tag, the id or the outcome, so a comparison
  // that read `TKEval` as one value — ignoring the stage it carries — would
  // agree with all of them. A stage rewritten UNDER the same id is the shape
  // that tells them apart, and it is the shape that matters: the stage mark is
  // what makes history's provenance readable, so a step that quietly renumbered
  // it would rewrite which stage a retired task belonged to.
  const stagedPrevious = new Map([[1, [et(1, 0, "TPassed")]]]);
  assert.equal(
    recordMonotone(withRecord([et(1, 1, "TPassed")]), stagedPrevious),
    false,
  );
  assert.ok(recordMonotone(withRecord([et(1, 0, "TPassed")]), stagedPrevious));
  // Tickets are never deleted, so the previous domain always survives.
  assert.equal(
    recordMonotone(withRecord(twoEntries), new Map([[2, []]])),
    false,
  );
  // APPENDING is the whole of what is allowed, and an unchanged record is the
  // stutter's answer.
  assert.ok(recordMonotone(withRecord(twoEntries), previous));
  assert.ok(
    recordMonotone(withRecord([...twoEntries, et(3, 0, "TPassed")]), previous),
  );
  // An empty previous snapshot constrains nothing, which is what makes the
  // first step of a run green rather than special-cased.
  assert.ok(recordMonotone(withRecord(twoEntries), new Map()));
});

// === recordWellFormed, idsAccounted and programsWellFormed ================

test("recordWellFormed reads the id, the lifecycle and the stage of every entry", () => {
  const withRecord = (record: readonly Task[]): Core =>
    solo({ ...jDraft, record, spawned: record.length });
  // The chronological log IS the identity order, 1-indexed.
  assert.equal(recordWellFormed(withRecord([wt(2, "TPassed")])), false);
  assert.equal(
    recordWellFormed(withRecord([wt(1, "TPassed"), wt(3, "TFailed")])),
    false,
  );
  // Nothing retired is still running.
  assert.equal(recordWellFormed(withRecord([wr(1)])), false);
  assert.equal(recordWellFormed(withRecord([er(1, 0)])), false);
  // A retired eval task names a stage its ticket's program actually has.
  assert.equal(recordWellFormed(withRecord([et(1, 1, "TPassed")])), false);
  assert.ok(recordWellFormed(withRecord([et(1, 0, "TPassed")])));
  // A work entry carries no stage to dangle, so it passes at any program.
  assert.ok(recordWellFormed(withRecord([wt(1, "TCancelled")])));
  // The whole run is read, not the first entry.
  assert.equal(
    recordWellFormed(withRecord([wt(1, "TPassed"), et(2, 4, "TPassed")])),
    false,
  );
});

test("idsAccounted counts the record AND the live set, on both sides of the equality", () => {
  // Short by one and long by one, from the same ticket: a mutant that dropped a
  // task set leaves the counter high, a mutant that double-counted leaves it low.
  assert.equal(idsAccounted(solo({ ...jWork, spawned: 1 })), false);
  assert.equal(idsAccounted(solo({ ...jWork, spawned: 3 })), false);
  assert.ok(idsAccounted(solo(jWork)));
  // Both halves of the sum are read: retiring the live set into the record keeps
  // the total, and that is exactly what the invariant claims.
  assert.ok(
    idsAccounted(
      solo({
        ...jDraft,
        record: [wt(1, "TPassed"), wt(2, "TPassed")],
        tasks: [],
        spawned: 2,
      }),
    ),
  );
  assert.equal(
    idsAccounted(
      solo({
        ...jDraft,
        record: [wt(1, "TPassed"), wt(2, "TPassed")],
        tasks: [],
        spawned: 4,
      }),
    ),
    false,
  );
  // Every ticket is quantified over, not the first.
  assert.equal(
    idsAccounted(
      core([
        [1, jDraft],
        [2, { ...jWork, spawned: 0 }],
      ]),
    ),
    false,
  );
});

test("programsWellFormed holds the program's length and every fan-out, at both ends", () => {
  const withProgram = (program: Ticket["program"]): Core =>
    solo({ ...jDraft, program });
  assert.equal(programsWellFormed(cfgBudgeted, withProgram([])), false);
  assert.equal(
    programsWellFormed(
      cfgBudgeted,
      withProgram(
        Array.from({ length: cfgBudgeted.maxStages + 1 }, () => ({
          fanout: 1,
          combinator: "CUnanimousPass" as const,
        })),
      ),
    ),
    false,
  );
  for (const fanout of [0, cfgBudgeted.nTasks + 1]) {
    assert.equal(
      programsWellFormed(
        cfgBudgeted,
        withProgram([{ fanout, combinator: "CUnanimousPass" }]),
      ),
      false,
      `a fan-out of ${String(fanout)} is accepted`,
    );
  }
  // Every stage is read, not the first: the second one carries the breach here.
  assert.equal(
    programsWellFormed(
      cfgBudgeted,
      withProgram([
        { fanout: 1, combinator: "CUnanimousPass" },
        { fanout: cfgBudgeted.nTasks + 1, combinator: "CAnyPass" },
      ]),
    ),
    false,
  );
  // Both authored programs the fixtures use are inside the bounds.
  assert.ok(programsWellFormed(cfgBudgeted, withProgram(progStaged)));
});

test("idsDense: the arrival bound, and the hole the doomed walk asserts on", () => {
  const dense = core([
    [1, jDraft],
    [2, jDraft],
  ]);
  assert.ok(idsDense(cfgBudgeted, dense));
  // A hole in the ids is refused.
  assert.equal(
    idsDense(
      cfgBudgeted,
      core([
        [1, jDraft],
        [3, jDraft],
      ]),
    ),
    false,
  );
  // And so is a fleet that never reached id 1.
  assert.equal(idsDense(cfgBudgeted, core([[2, jDraft]])), false);
  // The empty fleet is dense: `1.to(0)` is empty on both sides.
  assert.ok(idsDense(cfgBudgeted, core([])));
  // THE CONJUNCT ORDER IS LOAD-BEARING, and this is why it is pinned. Every
  // ascending-id fold is sound only over dense ids, so the doomed walk reads
  // `ticketAt` on a range it assumes complete and ASSERTS when it is not —
  // exactly as `decideRevoke` does over the same range. The bundle never reaches
  // that assertion, because `idsDense` is conjoined before `cascadeSafety` and
  // the conjunction short-circuits.
  const holed = core([
    [1, jDraft],
    [3, jDraft],
  ]);
  assert.throws(() => cascadeSafety(holed), AssertionError);
  // THE HOLED FLEET GETS ITS OWN HISTORY, and that is the whole of what makes
  // this an order pin. Handed the DENSE fleet's history it would red
  // `recordMonotone` first — a ticket in the previous snapshot that the current
  // state does not hold — and the bundle would return false long before reaching
  // either conjunct this is about. With its own history every conjunct ahead of
  // `idsDense` is green, so `idsDense` is what reds and `cascadeSafety` is what
  // is never reached; hoisting the doomed walk above the density claim turns
  // this answer into the throw above.
  const holedHistory = quiet(cfgBudgeted, holed).history;
  assert.ok(recordMonotone(holed, holedHistory.prevRecords));
  assert.equal(allInvariants(cfgBudgeted, holed, holedHistory), false);
  assert.deepEqual(
    redConjuncts({ cfg: cfgBudgeted, core: dense, history: holedHistory }),
    new Set(["recordMonotone"]),
  );
});

// === stuckSubsetCovered: the two walks, and the mutations it exists to catch

test("stuckSubsetCovered cannot be made false by any state, and the walks say why", () => {
  // The model is explicit that this is a TAUTOLOGY over the two definitions:
  // `stuckSet`'s base case is `PEscalated`, `coveredSet`'s is `hasOpenHumanTask`
  // which IS that phase, both walk the same edges, and `stuckSet`'s inductive arm
  // is `coveredSet`'s plus one conjunct. No tree can separate them, so the
  // corpus above has no entry for it and this is the evidence instead.
  const trees: readonly Core[] = [
    solo(jEsc),
    solo(jParkDep),
    behindARevoke(jParkDep),
    core([
      [1, jEsc],
      [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
      [3, { ...jDraft, phase: "PPending", deps: new Set([2]) }],
    ]),
    ...allPhases.map((phase) => solo({ ...jDraft, phase })),
  ];
  for (const c of trees) {
    assert.ok(stuckSubsetCovered(c));
  }
  // A CHAIN behind a parked ticket is where it has content rather than being
  // trivially empty on both sides: the stuck set propagates through Pending.
  const chain = core([
    [1, jEsc],
    [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
    [3, { ...jDraft, phase: "PPending", deps: new Set([2]) }],
  ]);
  assert.deepEqual(stuckSet(chain), new Set([1, 2, 3]));
  assert.deepEqual(coveredSet(chain), new Set([1, 2, 3]));
  // A HEALTHY Blocked ticket is deliberately not stuck: its measure sits flat
  // while its deps run, and it progresses vicariously.
  const healthy = core([
    [1, { ...jDraft, phase: "PWorking", tasks: [wr(1), wr(2)], spawned: 2 }],
    [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
  ]);
  assert.deepEqual(stuckSet(healthy), new Set());
  assert.deepEqual(coveredSet(healthy), new Set());
});

test("stuckSubsetCovered goes red on the two edits the model says it guards", () => {
  // RED-PROOF BY MUTATION OF THE DEFINITIONS, because no state can do it. Both
  // mutants below are the ones the model's own comment names as what the
  // invariant is kept for.
  const chain = core([
    [1, jEsc],
    [2, { ...jDraft, phase: "PPending", deps: new Set([1]) }],
  ]);
  const sweepCount = (c: Core): number => c.tickets.size;
  // MUTANT 1: a phase guard on `coveredSet`'s inductive arm. Coverage stops
  // propagating along the edges that `stuckSet` still walks, and the containment
  // breaks on the very next dependent.
  const guardedCover = (c: Core): ReadonlySet<number> => {
    let covered: ReadonlySet<number> = new Set();
    for (let sweep = 0; sweep < sweepCount(c); sweep += 1) {
      const next = new Set<number>();
      for (const [j, jb] of c.tickets) {
        const inherits =
          jb.phase === "PWorking" &&
          [...visEdges(c, j)].some((d) => covered.has(d));
        if (hasOpenHumanTask(jb) || inherits) {
          next.add(j);
        }
      }
      covered = next;
    }
    return covered;
  };
  assert.deepEqual(stuckSet(chain), new Set([1, 2]));
  assert.deepEqual(guardedCover(chain), new Set([1]));
  assert.ok(![...stuckSet(chain)].every((j) => guardedCover(chain).has(j)));
  // ...and the shipped pair is green on the very same tree.
  assert.ok(stuckSubsetCovered(chain));
  // MUTANT 2: a `stuckSet` base case that is not a desk phase. A Draft is
  // neither stuck nor covering, so admitting it to the base case admits a
  // member nothing covers.
  const draftsAreStuck = (c: Core): ReadonlySet<number> => {
    let stuck: ReadonlySet<number> = new Set();
    for (let sweep = 0; sweep < sweepCount(c); sweep += 1) {
      const next = new Set<number>();
      for (const [j, jb] of c.tickets) {
        const inherits =
          jb.phase === "PPending" &&
          [...visEdges(c, j)].some((d) => stuck.has(d));
        if (jb.phase === "PEscalated" || jb.phase === "PDraft" || inherits) {
          next.add(j);
        }
      }
      stuck = next;
    }
    return stuck;
  };
  const lone = solo(jDraft);
  assert.deepEqual(draftsAreStuck(lone), new Set([1]));
  assert.deepEqual(coveredSet(lone), new Set());
  assert.ok(![...draftsAreStuck(lone)].every((j) => coveredSet(lone).has(j)));
  assert.ok(stuckSubsetCovered(lone));
});

// === stepDescends, arm for arm ============================================

/** A step under a label, moving one ticket between two phases. */
function movingStep(label: string, from: Phase, to: Phase): StepRecord {
  return {
    label,
    transitions: [{ ticket: 1, from, to }],
    effects: [],
    landing: { tag: "WONone" },
  };
}

/** Does the arm fire? A climbing step is exempt exactly when an arm covers it. */
function exemptOnAClimb(cfg: Config, lastStep: StepRecord): boolean {
  const c = solo(jDraft);
  // The previous measure is BELOW the current one, so nothing but an exemption
  // arm can make the predicate hold. That is what makes each row below a claim
  // about the arm and not about the measure.
  return stepDescends(
    cfg,
    c,
    lastStep,
    sysMeasure(boundsOf(cfg), c.tickets) - 1,
  );
}

test("stepDescends: the model's eight roster entries, each firing and each needed", () => {
  // THE ROSTER, from `model/domain.qnt`'s comment above the disjunction: eight
  // entries over seven disjuncts, because `operator-retry` contributes two
  // flavors under one label test. Each row is a climbing step the arm exempts.
  const exempted: readonly (readonly [string, Config, StepRecord])[] = [
    ["init", cfgBudgeted, { ...settledStep, label: "init" }],
    [
      "task-done-duplicate",
      cfgBudgeted,
      { ...settledStep, label: "task-done-duplicate" },
    ],
    [
      "complete-duplicate",
      cfgBudgeted,
      { ...settledStep, label: "complete-duplicate" },
    ],
    ["settled", cfgBudgeted, settledStep],
    [
      "operator-retry, RPending flavor",
      cfgBudgeted,
      movingStep("operator-retry", "PEscalated", "PPending"),
    ],
    [
      "operator-retry, RetryFree pipeline flavor",
      cfgRetryFree,
      movingStep("operator-retry", "PEscalated", "PEvaluating"),
    ],
    [
      "ticket-arrived",
      cfgBudgeted,
      { ...settledStep, label: "ticket-arrived" },
    ],
    [
      "ticket-revoked, desk-only flat",
      cfgBudgeted,
      movingStep("ticket-revoked", "PEscalated", "PRevoked"),
    ],
  ];
  for (const [entry, cfg, lastStep] of exempted) {
    assert.ok(exemptOnAClimb(cfg, lastStep), `the ${entry} arm does not fire`);
  }
  // EIGHT ENTRIES, and no more: a label outside the roster is not exempt, so a
  // widened arm is caught by the labels it starts admitting.
  const notExempted: readonly (readonly [string, Config, StepRecord])[] = [
    ["dispatch", cfgBudgeted, movingStep("dispatch", "PPending", "PWorking")],
    [
      "ticket-released",
      cfgBudgeted,
      movingStep("ticket-released", "PDraft", "PPending"),
    ],
    ["task-done", cfgBudgeted, { ...settledStep, label: "task-done" }],
    [
      "work-passed",
      cfgBudgeted,
      movingStep("work-passed", "PWorking", "PEvaluating"),
    ],
    [
      "eval-stage-passed",
      cfgBudgeted,
      movingStep("eval-stage-passed", "PEvaluating", "PEvaluating"),
    ],
    ["ticket-done", cfgBudgeted, movingStep("ticket-done", "PWrapUp", "PDone")],
    // The CHARGED pipeline resume: the same step the RetryFree row exempts, at
    // the instance where it pays. This is the pricing conjunct, alone.
    [
      "operator-retry into the pipeline, charged",
      cfgBudgeted,
      movingStep("operator-retry", "PEscalated", "PEvaluating"),
    ],
    // The WORKING resume always pays, under BOTH meterings — which is why the
    // RetryFree arm's inner test excludes it by target phase.
    [
      "operator-retry into Working, free",
      cfgRetryFree,
      movingStep("operator-retry", "PEscalated", "PWorking"),
    ],
    // A STEP THAT MOVES NOTHING is exempted by neither operator-retry flavor,
    // and both flavors are asked. The model's condition is `foldl(false, …)`,
    // whose base is what decides the empty case: an `operator-retry` carrying no
    // transition has resumed nothing, so there is no target phase to read and no
    // flavor to claim. A fold based at `true` — an `every` where the model has a
    // `some` — would exempt it, and every other fixture in this table carries a
    // transition and so cannot tell the two apart.
    [
      "operator-retry that moved nothing, charged",
      cfgBudgeted,
      { ...settledStep, label: "operator-retry" },
    ],
    [
      "operator-retry that moved nothing, free",
      cfgRetryFree,
      { ...settledStep, label: "operator-retry" },
    ],
    // A revoke that drags a LIVE rank down gets no exemption at all: the cascade
    // park is exactly such a transition.
    [
      "ticket-revoked with a live-rank transition",
      cfgBudgeted,
      {
        ...settledStep,
        label: "ticket-revoked",
        transitions: [
          { ticket: 1, from: "PEscalated", to: "PRevoked" },
          { ticket: 2, from: "PPending", to: "PEscalated" },
        ],
      },
    ],
  ];
  for (const [entry, cfg, lastStep] of notExempted) {
    assert.equal(
      exemptOnAClimb(cfg, lastStep),
      false,
      `${entry} is exempted, and the roster does not name it`,
    );
  }
});

test("stepDescends: the desk-only revoke arm, over every phase a transition can leave", () => {
  // The arm's condition is `phaseRank(from) == rankSettled` on EVERY transition,
  // so it fires exactly on the three settled-rank phases and on no live rank.
  assert.deepEqual(
    new Set(
      allPhases.filter((from) =>
        exemptOnAClimb(
          cfgBudgeted,
          movingStep("ticket-revoked", from, "PRevoked"),
        ),
      ),
    ),
    new Set(["PDone", "PEscalated", "PRevoked"]),
  );
});

test("stepDescends: outside every arm, only a strict descent passes", () => {
  const c = solo(jWork);
  const now = sysMeasure(boundsOf(cfgBudgeted), c.tickets);
  const dispatch = movingStep("dispatch", "PPending", "PWorking");
  assert.ok(stepDescends(cfgBudgeted, c, dispatch, now + 1));
  assert.equal(stepDescends(cfgBudgeted, c, dispatch, now), false);
  assert.equal(stepDescends(cfgBudgeted, c, dispatch, now - 1), false);
  // `measureDescends` is both halves, so it answers false wherever this does.
  assert.equal(measureDescends(cfgBudgeted, c, dispatch, now), false);
  assert.ok(measureDescends(cfgBudgeted, c, dispatch, now + 1));
});
