/**
 * `model/measure.qnt` in TypeScript: the record vocabulary, the termination
 * measure, and the task plumbing they share.
 *
 * THE MODEL IS THE SPEC AND ITS HEADER IS THE ARGUMENT. Everything about WHY
 * the measure reads what it reads — the digit order, the descent table, the
 * named non-descending sets, the derivation of every weight — lives in that
 * file's module header and is deliberately not copied here. A second copy of
 * an argument is the copy that drifts. What this file adds is the part the
 * model cannot state: how a Quint sum type, set and map are spelled in
 * TypeScript, and which of the model's prose caller-guarantees became runtime
 * assertions.
 *
 * DEFINITION ORDER IS THE MODEL'S, definition for definition, so the two files
 * can be read side by side. The three sections below are its three sections.
 *
 * THE ENCODING, in four decisions:
 *
 *   1. A sum type whose constructors are ALL NULLARY becomes a union of string
 *      literals named exactly for those constructors — `Phase`, `TaskOutcome`,
 *      `Verdict`, `Combinator`, `RetryPricing`, `Resume`, `Reason`,
 *      `WrapUpOutcome`. It switches exhaustively, and it compares with `===`,
 *      which is what the model's `==` on those values means.
 *   2. A sum type with a PAYLOAD becomes a discriminated union tagged `tag`,
 *      whose values are the model's constructor names — `TaskKind`,
 *      `TaskState`, `WrapUpPricing`, `ReworkPolicy`, `WrapUpObs`, `WrapUp`,
 *      `ArtifactMark`. The payload's fields are named; where the model already
 *      named them (`WOAttempt`'s record) the names are its own.
 *   3. `Set[Task]` becomes `TaskSet` — a readonly array in strictly ascending
 *      id order. See that type for the argument; the short form is that task
 *      ids are unique within a ticket, so a canonical order exists, and a
 *      canonical order is what makes structural equality mean set equality.
 *   4. `int -> Ticket` becomes `ReadonlyMap<number, Ticket>`, which compares
 *      structurally and iterates without an order the results depend on.
 *
 * Consts arrive as `Bounds`, explicitly, exactly as the model's `Bounds`
 * record exists so the measure "needs no consts and stays a pure function
 * usable from tests with any bounds". Nothing here reads a global.
 */

import { assertNever, invariant } from "./assert.ts";

/**
 * A count: a non-negative safe integer. Named once because every account,
 * width, id and digit bound in this file is one, and because the model's ints
 * are unbounded while JavaScript's numbers stop being integers at 2^53.
 */
function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

// === Vocabulary ============================================================
// The model's prefixes are kept verbatim (P/TK/T/TS/V/C/RW/R/Rs/W/WO/A) —
// they exist because Quint gives a module one constructor namespace, and
// keeping them is what lets a reviewer match a TypeScript tag to a Quint
// constructor without a lookup table.

/** `model/measure.qnt` Phase — the STORED phases, and why there are so few. */
export type Phase =
  | "PDraft"
  | "PPending"
  | "PWorking"
  | "PEvaluating"
  | "PWrapUp"
  | "PWrapUpHolding"
  | "PDone"
  | "PEscalated"
  | "PRevoked";

/** `model/measure.qnt` TaskKind — what a task is for; `TKEval`'s stage is the mark that makes the current stage derivable. */
export type TaskKind =
  | { readonly tag: "TKWork" }
  | { readonly tag: "TKEval"; readonly stage: number };

/** `model/measure.qnt` TaskOutcome — resolved verdicts only. */
export type TaskOutcome = "TPassed" | "TFailed" | "TCancelled";

/** `model/measure.qnt` TaskState — the explicit lifecycle: running carries no outcome, resolved must. */
export type TaskState =
  | { readonly tag: "TSRunning" }
  | { readonly tag: "TSResolved"; readonly outcome: TaskOutcome };

/** `model/measure.qnt` Task — identity, kind, lifecycle state. */
export type Task = {
  readonly id: number;
  readonly kind: TaskKind;
  readonly state: TaskState;
};

/**
 * The model's `Set[Task]`, as a readonly array in STRICTLY ASCENDING ID ORDER.
 *
 * NOT A TWENTY-FOURTH TYPE. It is one model type's representation, named
 * because the representation carries an obligation that a bare array type
 * cannot state, and `assertTaskSet` below enforces on every read.
 *
 * WHY AN ARRAY AND NOT A `Set`. JavaScript's `Set` holds objects by reference,
 * so two structurally identical task sets are unequal in it and `deepEqual`
 * over one compares insertion orders. Quint's sets are values. What rescues
 * the array is that a task set has a canonical order available: ids are
 * sequential within the ticket and never reused (`model/measure.qnt` Task), so
 * ascending id is a total order on any set the machine can build, and two
 * canonical arrays are structurally equal exactly when the sets they denote
 * are equal. That is the property the golden-trace replay needs — `replay.ts`
 * compares a decided task set against the model's own, step for step — and a
 * `Set` would not have it.
 *
 * The order also removes the one place the model is order-nondeterministic —
 * see `evalStage`, which asserts rather than picking.
 */
export type TaskSet = readonly Task[];

/**
 * The canonical form, checked wherever a task set is read: ascending ids, no
 * duplicates, every id a real one. Cheap by construction — a live set is a
 * single phase's fan-out, so it holds at most `nTasks` entries.
 *
 * "Wherever it is read" is meant literally, and `nextTaskId` is the reason to
 * say so: it reads only `.length`, which looks like it needs no canonical form
 * until a duplicate id makes the length disagree with the count of distinct
 * ids — and `nextTaskId` is precisely where that disagreement would mint a
 * colliding id, breaking the history-uniqueness that lets a stale completion
 * no-op by identity. Every reader calls this, including the ones that only
 * count.
 */
function assertTaskSet(tasks: TaskSet, where: string): void {
  let previous = firstTaskId - 1;
  for (const task of tasks) {
    invariant(
      Number.isSafeInteger(task.id) && task.id > previous,
      `${where}: a task set is ascending by id from ${String(firstTaskId)}, got ${String(task.id)} after ${String(previous)}`,
    );
    previous = task.id;
  }
}

/**
 * A task set in its canonical form, BUILT rather than assumed: sorted by id,
 * then checked to be strictly ascending from `firstTaskId`.
 *
 * It exists for the one caller that receives a task set from outside this tree
 * — the golden-corpus decoder, reading the model's `Set[Task]`, which carries
 * no order at all. That caller has to impose the order this representation
 * means, and imposing it by hand is how a second, subtly different canonical
 * form gets written: a sort with no floor check accepts id 0, and a sort with
 * no strictness check accepts a repeat, which is precisely the value
 * `nextTaskId` would then mis-mint from. The representation's rules belong to
 * the file that states them.
 *
 * `assertTaskSet` is the same check every reader already runs; this adds the
 * sort in front of it, so the two cannot disagree about what canonical means.
 */
export function canonicalTaskSet(
  tasks: readonly Task[],
  where: string,
): TaskSet {
  const sorted = [...tasks].sort((a, b) => a.id - b.id);
  assertTaskSet(sorted, where);
  return sorted;
}

/** `model/measure.qnt` Verdict — the completion EVENT's verdict, as distinct from the stored resolution. */
export type Verdict = "VPass" | "VFail";

/** `model/measure.qnt` Combinator — a stage's verdict rule; eval is data, so this rides the program. */
export type Combinator = "CUnanimousPass" | "CAnyPass";

/** `model/measure.qnt` Stage — one stage of an authored eval program. */
export type Stage = {
  readonly fanout: number;
  readonly combinator: Combinator;
};

/** `model/measure.qnt` WrapUpPricing — a model parameter, not a constant. */
export type WrapUpPricing =
  | { readonly tag: "Budgeted"; readonly budget: number }
  | { readonly tag: "DeadlineOnly" };

/**
 * `model/measure.qnt` ReworkPolicy — deliberately one branch for now. It stays
 * a tagged union rather than collapsing to a bare record so that a second
 * pricing lands as a constructor beside this one, which is what the model says
 * happens if evidence ever argues for one.
 */
export type ReworkPolicy = {
  readonly tag: "RWBudget";
  readonly budget: number;
};

/** `model/measure.qnt` RetryPricing — configurable per deployment; not a measure input. */
export type RetryPricing = "RetryCharged" | "RetryFree";

/** `model/measure.qnt` Resume — where an operator retry resumes a parked ticket. */
export type Resume =
  "RNone" | "RPending" | "RWorking" | "REvaluating" | "RWrapUp";

/** `model/measure.qnt` Reason — why a ticket sits on the human desk. */
export type Reason =
  | "RsNone"
  | "RsWorkFailed"
  | "RsReworkBudgetExhausted"
  | "RsWrapUpBudgetExhausted"
  | "RsGasExhausted"
  | "RsRevalidationFailed"
  | "RsDependencyRevoked";

/** `model/measure.qnt` WrapUpOutcome — how a wrap-up attempt resolves. One success, deliberately. */
export type WrapUpOutcome = "WOk" | "WFailed";

/**
 * `model/measure.qnt` WrapUpObs — the wrap-up attempt observation.
 *
 * The model's `WOAttempt` carries one record; its two fields ride the
 * constructor directly here, under the model's own names, because a nested
 * record would add a level of access that means nothing.
 */
export type WrapUpObs =
  | { readonly tag: "WONone" }
  | {
      readonly tag: "WOAttempt";
      readonly project: number;
      readonly invalidated: boolean;
    };

/** `model/measure.qnt` WrapUp — how a ticket finishes; authored data, NOT a measure input. */
export type WrapUp =
  | { readonly tag: "WNone" }
  | { readonly tag: "WExclusive"; readonly resource: number };

/** `model/measure.qnt` ArtifactMark — an opaque identity whose only modelled property is distinctness. NOT a measure input. */
export type ArtifactMark =
  { readonly tag: "ANone" } | { readonly tag: "ASome"; readonly id: number };

/**
 * THE SUM-TYPE CONSTRUCTOR ROSTERS THIS TREE SHIPS, one per `model/measure.qnt`
 * sum type, each an exhaustive list of its union's constructors.
 *
 * IT IS DERIVED FROM AN EXHAUSTIVE `Record`, `shippedCmdTags`' arrangement one
 * seam over: `unionTags` takes a `Record<Members, true>`, so a constructor the
 * union has and the record omits is a compile error, and a key the union does
 * not have is one too — the roster cannot silently fall behind the union it
 * names. The union is this tree's hand-typed copy of the model's `type X`, and
 * nothing in TypeScript holds either against `model/`: `src/tools/verify.ts`
 * reads the model's own arms and compares these sets in both directions on every
 * run of the conformance gate. Until it did, renaming a model constructor no
 * committed fixture carried passed every gate green — the decode arm-lists in
 * `itf.ts` catch such a rename only when a trace exercises it.
 *
 * A TAGGED UNION IS ROSTERED BY ITS `tag`s AND A BARE STRING UNION BY ITS
 * MEMBERS — the two shapes this tree writes a sum type in, and the constructor
 * name is the `tag` in the first and the member itself in the second.
 */
function unionTags<T extends string>(
  members: Readonly<Record<T, true>>,
): readonly string[] {
  // The generic is on the ARGUMENT, where it does the work: `Record<T, true>`
  // refuses an object that omits a member of the union or adds one it lacks. The
  // names come back as a plain `string[]`, which is all a roster comparison needs
  // and what lets the keys read out without a cast.
  return Object.keys(members);
}

export const shippedSumConstructors = {
  Phase: unionTags<Phase>({
    PDraft: true,
    PPending: true,
    PWorking: true,
    PEvaluating: true,
    PWrapUp: true,
    PWrapUpHolding: true,
    PDone: true,
    PEscalated: true,
    PRevoked: true,
  }),
  TaskKind: unionTags<TaskKind["tag"]>({ TKWork: true, TKEval: true }),
  TaskOutcome: unionTags<TaskOutcome>({
    TPassed: true,
    TFailed: true,
    TCancelled: true,
  }),
  TaskState: unionTags<TaskState["tag"]>({ TSRunning: true, TSResolved: true }),
  Verdict: unionTags<Verdict>({ VPass: true, VFail: true }),
  Combinator: unionTags<Combinator>({ CUnanimousPass: true, CAnyPass: true }),
  WrapUpPricing: unionTags<WrapUpPricing["tag"]>({
    Budgeted: true,
    DeadlineOnly: true,
  }),
  ReworkPolicy: unionTags<ReworkPolicy["tag"]>({ RWBudget: true }),
  RetryPricing: unionTags<RetryPricing>({
    RetryCharged: true,
    RetryFree: true,
  }),
  Resume: unionTags<Resume>({
    RNone: true,
    RPending: true,
    RWorking: true,
    REvaluating: true,
    RWrapUp: true,
  }),
  Reason: unionTags<Reason>({
    RsNone: true,
    RsWorkFailed: true,
    RsReworkBudgetExhausted: true,
    RsWrapUpBudgetExhausted: true,
    RsGasExhausted: true,
    RsRevalidationFailed: true,
    RsDependencyRevoked: true,
  }),
  WrapUpOutcome: unionTags<WrapUpOutcome>({ WOk: true, WFailed: true }),
  WrapUpObs: unionTags<WrapUpObs["tag"]>({ WONone: true, WOAttempt: true }),
  WrapUp: unionTags<WrapUp["tag"]>({ WNone: true, WExclusive: true }),
  ArtifactMark: unionTags<ArtifactMark["tag"]>({ ANone: true, ASome: true }),
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** The `model/measure.qnt` sum types this tree ships a constructor roster for. */
export type ModelSumTypeName = keyof typeof shippedSumConstructors;

/**
 * The same names as a value, so the model-reading side can iterate them. Read
 * off the roster's own keys rather than typed a second time, so the two cannot
 * name different sets.
 */
export const modelSumTypeNames = Object.keys(
  shippedSumConstructors,
) as readonly ModelSumTypeName[];

/**
 * `model/measure.qnt` Ticket — one ticket's record, in the model's field
 * order. The measure is a pure function of this, which is why the record lives
 * in the measure module rather than the machine's.
 *
 * Every field's meaning, and every note about which fields the measure
 * deliberately does NOT read (`project`, `artifact`, `record`, `spawned`,
 * `completions`, `wrapUp`), is on the model's own record. The two ghost fields
 * are accounting the model keeps for its invariants; they are carried here so
 * that a replayed state is comparable field for field.
 */
export type Ticket = {
  readonly phase: Phase;
  readonly deps: ReadonlySet<number>;
  readonly wrapUp: WrapUp;
  readonly artifact: ArtifactMark;
  readonly project: number;
  readonly program: readonly Stage[];
  readonly tasks: TaskSet;
  readonly record: readonly Task[];
  readonly spawned: number;
  readonly reworkLeft: number;
  readonly wrapUpLeft: number;
  readonly gasLeft: number;
  readonly resumeAt: Resume;
  readonly reason: Reason;
  readonly completions: number;
};

/**
 * `model/measure.qnt` hasOpenHumanTask — derive, don't store: the open-desk
 * flag IS a predicate over the phase, and `PRevoked` is deliberately not here.
 */
export function hasOpenHumanTask(ticket: Ticket): boolean {
  return ticket.phase === "PEscalated";
}

/** `model/measure.qnt` Core — the machine's observed state as the pure deciders see it. */
export type Core = { readonly tickets: ReadonlyMap<number, Ticket> };

/** `model/measure.qnt` Transition — one observed ticket-phase transition; `from == to` is a real row. */
export type Transition = {
  readonly ticket: number;
  readonly from: Phase;
  readonly to: Phase;
};

/**
 * `model/measure.qnt` StepRecord — one decision's observable record,
 * golden-trace shaped. `effects` stays `string[]` because the model's effects
 * are strings; the typed effect vocabulary is `src/effects/effect.ts`'s, whose
 * constructors ARE these strings — so it types this field's contents without
 * changing one stored byte of it.
 *
 * `attempt` IS NAMED FOR WHAT IT RANGES OVER, which is the wrap-up attempt and
 * not the completion: most of the labels it carries a `WOAttempt` on are
 * failures. It is not named `wrapUp` either, because `Ticket.wrapUp` is the
 * AUTHORED kind and a reader meeting both in one decision should not have to
 * ask which is which. The model states this at its own `StepRecord`.
 */
export type StepRecord = {
  readonly label: string;
  readonly transitions: readonly Transition[];
  readonly effects: readonly string[];
  readonly attempt: WrapUpObs;
};

/** `model/measure.qnt` Decision — what a pure decider returns: record performed + post-state. */
export type Decision = { readonly rec: StepRecord; readonly post: Core };

/**
 * `model/measure.qnt` Bounds — the bounds the measure is parameterized by.
 *
 * Note what is ABSENT: the gas grant. Gas is the most significant digit, so it
 * needs no radix of its own and the measure never bounds it — which is why
 * `GAS` is a machine const and not a field here. `OP_RETRY_PRICING` is absent
 * for the stronger reason that the measure does not read it at all: retry
 * metering decides whether a step CHARGES, and charging is what makes a step
 * descend, but the measure of a state is the same either way.
 */
export type Bounds = {
  readonly reworkPolicy: ReworkPolicy;
  readonly nTasks: number;
  readonly maxStages: number;
  readonly wrapUpPricing: WrapUpPricing;
};

// === The measure ===========================================================

/** `model/measure.qnt` wrapUpBudget — the gate account's size under a pricing. */
export function wrapUpBudget(gp: WrapUpPricing): number {
  switch (gp.tag) {
    case "Budgeted":
      invariant(
        isCount(gp.budget),
        `a Budgeted grant is a non-negative safe integer, got ${String(gp.budget)}`,
      );
      return gp.budget;
    case "DeadlineOnly":
      return 0;
    default:
      return assertNever(gp, "unhandled WrapUpPricing");
  }
}

/**
 * `model/measure.qnt` reworkBudget — the rework account's size under a policy.
 *
 * NO SWITCH, WHERE `wrapUpBudget` HAS ONE, and the asymmetry is the type's
 * rather than a lapse: `ReworkPolicy` has exactly one constructor today, so a
 * switch over its tag is a comparison the linter can prove always true. The
 * exhaustiveness the bar asks for arrives from the other direction here — the
 * moment a second pricing lands as a constructor, `rw.budget` stops
 * typechecking at this line and at every other reader of the policy, which is
 * a louder failure than a `default` arm that would still compile.
 */
export function reworkBudget(rw: ReworkPolicy): number {
  invariant(
    isCount(rw.budget),
    `an RWBudget grant is a non-negative safe integer, got ${String(rw.budget)}`,
  );
  return rw.budget;
}

// --- Named rank ladder -----------------------------------------------------
// Each rung is the successor of the one it must strictly dominate, exactly as
// the model writes it: the ladder IS the derivation, so no bare rank numeral
// appears twice and a change to the rung set propagates to `microBound`
// through `rankCeiling` instead of drifting from it.

/** The settled tier: Done, Escalated, Revoked. Nothing is below settled. */
export const rankSettled = 0;
/** The held lease, directly above settled. */
export const rankHolding = rankSettled + 1;
/** `PWrapUp` — ENQUEUED for the gate. */
export const rankWrapUp = rankHolding + 1;
export const rankEvaluating = rankWrapUp + 1;
export const rankWorking = rankEvaluating + 1;
/** The released waiting room; Ready and Blocked derive from it. */
export const rankPending = rankWorking + 1;
/** The only authoring phase, the ladder's top. */
export const rankDraft = rankPending + 1;
/** The ladder's ceiling — `microBound`'s multiplier derives from this. */
export const rankCeiling = rankDraft;

/**
 * `model/measure.qnt` phaseRank — how far from settled a ticket's lifecycle
 * position is.
 *
 * The model writes the settled tier as a wildcard arm and names its three
 * members in the comment beside it; they are written out here because an
 * exhaustive switch is what makes a future phase a compile error rather than a
 * silent `rankSettled`. Same function, same three phases.
 */
export function phaseRank(p: Phase): number {
  switch (p) {
    case "PDraft":
      return rankDraft;
    case "PPending":
      return rankPending;
    case "PWorking":
      return rankWorking;
    case "PEvaluating":
      return rankEvaluating;
    case "PWrapUp":
      return rankWrapUp;
    case "PWrapUpHolding":
      return rankHolding;
    case "PDone":
    case "PEscalated":
    case "PRevoked":
      return rankSettled;
    default:
      return assertNever(p, "unhandled Phase");
  }
}

/** `model/measure.qnt` runningCount — the least significant digit. */
export function runningCount(tasks: TaskSet): number {
  assertTaskSet(tasks, "runningCount");
  return tasks.filter((t) => t.state.tag === "TSRunning").length;
}

/**
 * `model/measure.qnt` evalStage — the CURRENT eval stage, derived from the
 * live set's kind marks. 0 on an empty or work set.
 *
 * THE ONE PLACE THIS FILE IS STRICTER THAN THE MODEL, and deliberately. The
 * model folds over a set, so its result depends on the fold's pick order — but
 * only when the set carries two DIFFERENT eval marks, since a `TKWork` arm
 * passes the accumulator through untouched and a uniform eval set answers the
 * same in any order. `tasksWellFormed` (`model/domain.qnt`) forbids the mixed
 * case on every reachable state, which is what the model's comment relies on.
 * A deterministic implementation cannot mirror a nondeterministic answer, so
 * the case the model excludes by invariant is excluded here by assertion — the
 * negative space, checked rather than assumed.
 */
export function evalStage(tasks: TaskSet): number {
  assertTaskSet(tasks, "evalStage");
  let stage = 0;
  let marked = false;
  for (const task of tasks) {
    switch (task.kind.tag) {
      case "TKWork":
        break;
      case "TKEval":
        invariant(
          isCount(task.kind.stage),
          `evalStage: a stage index is a non-negative safe integer, got ${String(task.kind.stage)}`,
        );
        invariant(
          !marked || stage === task.kind.stage,
          `evalStage: a live set carries one stage's fan-out, got marks ${String(stage)} and ${String(task.kind.stage)}`,
        );
        stage = task.kind.stage;
        marked = true;
        break;
      default:
        assertNever(task.kind, "unhandled TaskKind");
    }
  }
  return stage;
}

/**
 * `model/measure.qnt` stagesLeft — the stage digit: how many stages of the
 * authored program have not yet passed, and 0 in every phase but Evaluating.
 */
export function stagesLeft(ticket: Ticket): number {
  if (ticket.phase !== "PEvaluating") {
    return 0;
  }
  // `evalStage` is walked ONCE and the result reused in the message. It used
  // to be called again to build a string that a passing call throws away —
  // about half this function's work, on what becomes the replay hot path, in
  // service of a failure that does not happen. `assert.ts` keeps its messages
  // eager on purpose; that policy is only affordable if the message
  // interpolates what is already in hand.
  const stage = evalStage(ticket.tasks);
  const left = ticket.program.length - stage;
  invariant(
    left >= 0,
    `stagesLeft: the live stage indexes into the program, got stage ${String(stage)} of ${String(ticket.program.length)}`,
  );
  return left;
}

/**
 * `model/measure.qnt` radix — THE radix derivation, named once: a digit
 * bounded by `maxDigit` takes `maxDigit + 1` distinct values. Every weight and
 * every account radix below is built from this, and the `+ 1` of the weight
 * chain appears here and nowhere else.
 */
export function radix(maxDigit: number): number {
  invariant(
    isCount(maxDigit),
    `radix: a digit bound is a non-negative safe integer, got ${String(maxDigit)}`,
  );
  return maxDigit + 1;
}

/** `model/measure.qnt` stageWeight — one stage step strictly dominates any running count. */
export function stageWeight(b: Bounds): number {
  return radix(b.nTasks);
}

/** `model/measure.qnt` rankWeight — one rank step strictly dominates the full stage digit plus any count. */
export function rankWeight(b: Bounds): number {
  return radix(b.maxStages) * stageWeight(b);
}

/** `model/measure.qnt` microBound — strict upper bound on `micro`; the multiplier derives from the ladder's ceiling. */
export function microBound(b: Bounds): number {
  return radix(rankCeiling) * rankWeight(b);
}

/**
 * `model/measure.qnt` micro — within-cycle progress, lexicographic
 * (rank, stagesLeft, runningCount), flattened by the weights above.
 *
 * The two preconditions are the digit bounds the model's digit-order argument
 * rests on — `stagesLeft <= maxStages` because `programsWellFormed` caps an
 * authored program, `runningCount <= nTasks` because `tasksWellFormed` caps a
 * fan-out. The postcondition is the conclusion they buy: `micro` stays
 * strictly below `microBound`, which is what makes one unit of the account
 * above it outweigh any within-cycle climb.
 */
export function micro(b: Bounds, ticket: Ticket): number {
  const stages = stagesLeft(ticket);
  const running = runningCount(ticket.tasks);
  invariant(
    stages <= b.maxStages,
    `micro: the stage digit stays within its radix, got ${String(stages)} of at most ${String(b.maxStages)}`,
  );
  invariant(
    running <= b.nTasks,
    `micro: the running count stays within its radix, got ${String(running)} of at most ${String(b.nTasks)}`,
  );
  const bound = microBound(b);
  const value =
    phaseRank(ticket.phase) * rankWeight(b) + stages * stageWeight(b) + running;
  invariant(
    value >= 0 && value < bound,
    `micro: ${String(value)} escapes its bound ${String(bound)}`,
  );
  return value;
}

/**
 * `model/measure.qnt` ticketMeasure — THE per-ticket termination measure:
 * lexicographic (gasLeft, wrapUpLeft, reworkLeft, micro), radix-flattened.
 *
 * WHAT IS ASSERTED HERE, AND WHAT DELIBERATELY IS NOT. The accounts must be
 * non-negative — the model says the measure is "nonnegative whenever the
 * accounts are" — so that is a precondition. Their UPPER bounds are not,
 * even though the lexicographic claim needs them, because the model itself
 * evaluates this function at bounds a ticket did not come from:
 * `measureProjectBlindTest` and `measureArtifactBlindTest`
 * (`model/tests/chuggy_test.qnt`) both measure a `Budgeted(1)`-born ticket
 * under `DeadlineOnly` bounds, where `wrapUpLeft` is 1 and its radix is 1. The
 * blindness they pin holds regardless, because both sides climb identically;
 * an assertion would refuse the model's own pin. `accountDigitsInRange` below
 * names the condition instead, so it can be checked where it is owed.
 */
export function ticketMeasure(b: Bounds, ticket: Ticket): number {
  invariant(
    isCount(ticket.gasLeft),
    `ticketMeasure: gasLeft is a non-negative safe integer, got ${String(ticket.gasLeft)}`,
  );
  invariant(
    isCount(ticket.wrapUpLeft),
    `ticketMeasure: wrapUpLeft is a non-negative safe integer, got ${String(ticket.wrapUpLeft)}`,
  );
  invariant(
    isCount(ticket.reworkLeft),
    `ticketMeasure: reworkLeft is a non-negative safe integer, got ${String(ticket.reworkLeft)}`,
  );
  const accounts =
    (ticket.gasLeft * radix(wrapUpBudget(b.wrapUpPricing)) +
      ticket.wrapUpLeft) *
      radix(reworkBudget(b.reworkPolicy)) +
    ticket.reworkLeft;
  const value = accounts * microBound(b) + micro(b, ticket);
  invariant(
    isCount(value),
    `ticketMeasure: the flattened measure is a non-negative safe integer, got ${String(value)}`,
  );
  return value;
}

/**
 * The condition under which the flattening above IS the lexicographic order:
 * every account digit strictly below its radix. No model counterpart, because
 * the model states it as an argument in prose and keeps it true on reachable
 * states with `accountsBounded` (`model/domain.qnt`) — this is that argument
 * made checkable, for the callers that owe it.
 *
 * `gasLeft` has only a lower bound to check: it is the most significant digit,
 * so nothing above it needs a radix and `Bounds` carries no gas grant.
 */
export function accountDigitsInRange(b: Bounds, ticket: Ticket): boolean {
  return (
    ticket.gasLeft >= 0 &&
    ticket.wrapUpLeft >= 0 &&
    ticket.wrapUpLeft <= wrapUpBudget(b.wrapUpPricing) &&
    ticket.reworkLeft >= 0 &&
    ticket.reworkLeft <= reworkBudget(b.reworkPolicy)
  );
}

/**
 * `model/measure.qnt` sysMeasure — the sum over the fleet. Steps touch one
 * ticket, so per-step descent of the sum IS per-ticket descent; addition
 * commutes, so the iteration order the map happens to have cannot be read out
 * of the result.
 */
export function sysMeasure(
  b: Bounds,
  tickets: ReadonlyMap<number, Ticket>,
): number {
  let total = 0;
  for (const ticket of tickets.values()) {
    total += ticketMeasure(b, ticket);
  }
  invariant(
    isCount(total),
    `sysMeasure: the fleet measure is a non-negative safe integer, got ${String(total)}`,
  );
  return total;
}

// === Vocabulary helpers (task plumbing shared by machine and tests) ========

/**
 * `model/measure.qnt` firstTaskId — task ids are 1-INDEXED and sequential
 * within the ticket. Named once so the id arithmetic carries the convention
 * rather than a numeral.
 */
export const firstTaskId = 1;

/**
 * `model/measure.qnt` spawnTasks — a fresh parallel task set of kind `k`: `n`
 * tasks, all running, ids `start..start+n-1`.
 *
 * The loop is bounded by `n`, which is checked to be a count before it runs;
 * the machine's own bound on it is narrower still (a fan-out is `1..N_TASKS`
 * by `programsWellFormed`), and that bound belongs to the callers that have
 * the consts.
 */
export function spawnTasks(k: TaskKind, start: number, n: number): TaskSet {
  invariant(
    Number.isSafeInteger(start) && start >= firstTaskId,
    `spawnTasks: ids start at ${String(firstTaskId)}, got ${String(start)}`,
  );
  invariant(
    isCount(n),
    `spawnTasks: a fan-out width is a non-negative safe integer, got ${String(n)}`,
  );
  const running: TaskState = { tag: "TSRunning" };
  const spawned: Task[] = [];
  for (let i = start; i < start + n; i += 1) {
    spawned.push({ id: i, kind: k, state: running });
  }
  return spawned;
}

/**
 * `model/measure.qnt` nextTaskId — every id ever issued is either retired
 * (record) or live (tasks), and ids are dense from `firstTaskId`.
 */
export function nextTaskId(ticket: Ticket): number {
  assertTaskSet(ticket.tasks, "nextTaskId");
  return firstTaskId + ticket.record.length + ticket.tasks.length;
}

/**
 * `model/measure.qnt` spawnOn — THE spawn site: install a fresh fan-out of
 * kind `k`, ids continuing the ticket's sequential history, and bump the ghost
 * `spawned` counter by the same `n` (which is what keeps `idsAccounted`
 * checkable).
 *
 * The model states "callers guarantee the previous set is already retired" and
 * lists the sites that satisfy it. Stated guarantees are asserted here.
 */
export function spawnOn(ticket: Ticket, k: TaskKind, n: number): Ticket {
  invariant(
    ticket.tasks.length === 0,
    `spawnOn: the previous set is retired before a fresh fan-out, found ${String(ticket.tasks.length)} live`,
  );
  return {
    ...ticket,
    tasks: spawnTasks(k, nextTaskId(ticket), n),
    spawned: ticket.spawned + n,
  };
}

/**
 * `model/measure.qnt` retireLive — retire the live task set into the retained
 * record, in id order, force-closing anything still running as
 * `TSResolved(TCancelled)`.
 *
 * The model's fold carries a synthetic `TKWork`/`TCancelled` value as its
 * base, reachable only if no live task holds the id being retired — which
 * `tasksWellFormed` forbids by keeping live ids contiguous above the record.
 * That unreachable arm is an assertion here rather than a fabricated record
 * entry: a machine that dropped a task instead of retiring it would produce a
 * silent, wrong provenance row in the model's shape and a loud failure in
 * this one.
 */
export function retireLive(ticket: Ticket): Ticket {
  assertTaskSet(ticket.tasks, "retireLive");
  const start = firstTaskId + ticket.record.length;
  const retired: Task[] = [];
  for (let offset = 0; offset < ticket.tasks.length; offset += 1) {
    const id = start + offset;
    // INDEXED, not searched. `assertTaskSet` has already established that the
    // set is ascending by id with no repeats, so the entry that must carry
    // `id` — if the contiguity below holds at all — is the one at `offset`.
    // Scanning for it would re-establish by search what the canonical form
    // already bought, and it is the only quadratic shape the file had.
    const live = ticket.tasks[offset];
    invariant(
      live !== undefined && live.id === id,
      `retireLive: live ids are contiguous above the record, found no task ${String(id)}`,
    );
    retired.push(
      live.state.tag === "TSRunning"
        ? { ...live, state: { tag: "TSResolved", outcome: "TCancelled" } }
        : live,
    );
  }
  return { ...ticket, tasks: [], record: [...ticket.record, ...retired] };
}

/**
 * `model/measure.qnt` resolveTask — first write wins: resolve `tid` if it is
 * still running, and change nothing otherwise. That is the idempotence an
 * at-least-once fabric demands, and it covers both shapes of absorbed
 * delivery: a duplicate for an already-resolved task, and a stale one for a
 * task whose id has already been retired out of the live set.
 */
export function resolveTask(
  tasks: TaskSet,
  tid: number,
  out: TaskOutcome,
): TaskSet {
  assertTaskSet(tasks, "resolveTask");
  const resolved: TaskState = { tag: "TSResolved", outcome: out };
  return tasks.map((t) =>
    t.id === tid && t.state.tag === "TSRunning" ? { ...t, state: resolved } : t,
  );
}

/**
 * `model/measure.qnt` taskPassed — what counts as a PASS to the combinator: a
 * verdict earned this incarnation. Named rather than inlined because `combine`
 * reads it twice and the tests pin it directly.
 */
export function taskPassed(t: Task): boolean {
  return t.state.tag === "TSResolved" && t.state.outcome === "TPassed";
}

/**
 * `model/measure.qnt` combine — the verdict combinator, interpreted per stage.
 * `TFailed` and `TCancelled` both fail `CUnanimousPass`, because `taskPassed`
 * admits neither.
 *
 * The model's "callers guarantee every task is resolved" is asserted, not
 * assumed: a running task reaching here would silently read as a failure under
 * both combinators.
 */
export function combine(c: Combinator, tasks: TaskSet): boolean {
  assertTaskSet(tasks, "combine");
  invariant(
    tasks.every((t) => t.state.tag === "TSResolved"),
    "combine: the caller reduces a fully-resolved set",
  );
  switch (c) {
    case "CUnanimousPass":
      return tasks.every((t) => taskPassed(t));
    case "CAnyPass":
      return tasks.some((t) => taskPassed(t));
    default:
      return assertNever(c, "unhandled Combinator");
  }
}
