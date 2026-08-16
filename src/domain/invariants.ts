/**
 * `model/domain.qnt`'s INVARIANT BLOCK in TypeScript: every conjunct of
 * `allInvariants`, the two named halves of `measureDescends`, the set-valued
 * walks the visibility and cascade conjuncts are built from, and the bundle
 * itself.
 *
 * THE MODEL IS THE SPEC AND ITS HEADER IS THE ARGUMENT. Why each invariant is
 * stated the way it is — why `stuckSubsetCovered` is kept although it is a
 * tautology over its own definitions, why `canFinishSet` recurses UPWARD where
 * `stuckSet` grows outward, why `quietProjectLandsCleanly` is a per-attempt
 * claim rather than a per-project one, why no exemption arm may exist without a
 * witness run that fires it — lives in `model/domain.qnt` beside each `val` and
 * is deliberately not restated here. A second copy of an argument is the copy
 * that drifts. What this file adds is what the model cannot state: how its
 * constructs are spelled in TypeScript, and where a TypeScript answer is
 * narrower than the model's because the representation is.
 *
 * DEFINITION ORDER IS THE MODEL'S, definition for definition, so the two files
 * read side by side — which is also why `noStructuralDeadlock` is defined
 * before `cascadeSafety` here and listed after it in the bundle: the model does
 * both.
 *
 * THE INVARIANTS REFERENCE THE SHIPPED PREDICATES, NEVER RESTATE THEM. This is
 * `domain.ts`'s rule ("THE GUARDS ARE REFERENCED, NEVER COPIED") applied to the
 * layer that checks rather than decides: `coveredSet` asks
 * `hasOpenHumanTask`, `leaseExclusive` asks `leaseOf`, `canFinishSet` asks
 * `waitsOn`, `tasksWellFormed` asks `evalStage`, `wrapUpWellFormed` asks
 * `isAuthorableWrapUp`, `accountsBounded` asks `accountDigitsInRange`, and both
 * measure halves ask `sysMeasure`. An invariant that restated a guard would go
 * on accepting states the guard had stopped accepting, which is precisely the
 * drift the checking layer exists to catch.
 *
 * THE ENCODING, beyond the seven decisions `measure.ts` and `domain.ts` argue
 * and this file inherits:
 *
 *   8. `and { a, b }` BECOMES `a && b` AND `or { a, b }` BECOMES `a || b`, in
 *      the model's own conjunct order. Both are short-circuiting on both sides,
 *      so the order is preserved for the same reason the model's is: a later
 *      conjunct may only be evaluated once an earlier one has established what
 *      it reads. `p implies q` becomes `!p || q`, and `p iff q` becomes
 *      `p === q` on two booleans.
 *   9. A `foldl` OVER `lastStep.transitions` BECOMES THE ARRAY METHOD ITS BASE
 *      NAMES: `foldl(false, (b, t) => b or P(t))` is `some(P)`, and
 *      `foldl(true, (b, t) => b and P(t))` is `every(P)`. The empty-list
 *      answers agree — `some` is false and `every` is true on `[]`, exactly the
 *      fold bases the model writes.
 *  10. A BOUNDED-SWEEP FIXPOINT BECOMES A BOUNDED LOOP over the same number of
 *      sweeps: the model's `range(1, liveTickets.size() + 1).foldl(...)` runs
 *      one sweep per live ticket and ignores the range element, so the loop
 *      below is over the fleet's size and each iteration recomputes the whole
 *      set from the previous one. The fleet is bounded by the arrival cap, so
 *      the sweep count is too.
 *  11. `lastStep.transitions[0]` BECOMES A DESTRUCTURED `first` CHECKED AGAINST
 *      `undefined`, because `noUncheckedIndexedAccess` types an index read as
 *      possibly absent. `first !== undefined` IS the model's
 *      `transitions.length() >= 1`; where the model instead writes
 *      `length() == 1` that equality is written too, and the `undefined` check
 *      beside it is narrowing rather than a second claim.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT SHIP. The three step-history values
 * arrive as inputs and are never derived here: `lastStep`, `prevMeasure` and
 * `prevRecords` are the model's step-history VARS, written by `apply` in the
 * model's state-and-actions section, and that section's TypeScript home is the
 * spine. `currentRecords` — the snapshot `apply` carries forward — is the same
 * section's, so the ghost's advance is the spine's to write and this file only
 * reads what it is handed. Nor are the three anti-vacuity witnesses here:
 * `freeClimbNever`, `cascadeParkNever` and `stageAdvanceNever` are
 * expected-violation probes rather than invariants of the machine, and they
 * belong to the randomized layer that can violate them.
 */

import { assertNever } from "./assert.ts";
import {
  boundsOf,
  isAuthorableWrapUp,
  firstTicketId,
  isSubsetOf,
  leaseOf,
  projects,
  ticketAt,
  waitsOn,
  type Config,
} from "./domain.ts";
import {
  accountDigitsInRange,
  evalStage,
  firstTaskId,
  hasOpenHumanTask,
  phaseRank,
  rankSettled,
  sysMeasure,
  type Core,
  type StepRecord,
  type Task,
  type TaskKind,
  type TaskState,
  type Ticket,
} from "./measure.ts";

/**
 * The model's `liveTickets.forall(j => ...)`, which most of the conjuncts below
 * are. Named once so that no invariant spells out the quantifier, and so that
 * "live" has one definition here: the fleet's keys, exactly as `liveTickets` is
 * `tickets.keys()`.
 *
 * EXPORTED FOR THE LAYER ABOVE. `model/refinement.qnt`'s own invariants quantify
 * over the same `liveTickets`, so the refinement layer asks this rather than
 * respelling it — a second spelling of "live" is a second answer waiting to
 * happen, and the one that respells it also pays for a ticket lookup that this
 * one does not need.
 */
export function everyTicket(
  c: Core,
  holds: (jb: Ticket, j: number) => boolean,
): boolean {
  for (const [j, jb] of c.tickets) {
    if (!holds(jb, j)) {
      return false;
    }
  }
  return true;
}

/**
 * ONE STEP OF HISTORY, which is exactly what the step-invariants read and no
 * more: `model/domain.qnt`'s `lastStep` var and its two ghosts, `prevMeasure`
 * (read only by `stepDescends`) and `prevRecords` (read only by
 * `recordMonotone`). The invariants that name any of the three are
 * `wrapUpIsolation`, `quietProjectLandsCleanly`, `terminalsAbsorbing`,
 * `recordMonotone` and `stepDescends`; every other one below takes a Core.
 *
 * It exists for the BUNDLE, which needs all three, and for nothing else: every
 * predicate below takes the pieces it reads and never this record, so a
 * Core-only invariant cannot quietly acquire a dependency on the step that
 * produced the Core. The model draws the same line by making them vars a
 * definition must name to read.
 */
export type StepHistory = {
  readonly lastStep: StepRecord;
  readonly prevMeasure: number;
  readonly prevRecords: ReadonlyMap<number, readonly Task[]>;
};

/** `model/domain.qnt` completionExclusive — THE headline property, effect-only. */
export function completionExclusive(c: Core): boolean {
  return everyTicket(
    c,
    (jb) =>
      jb.completions <= 1 && (jb.completions === 1) === (jb.phase === "PDone"),
  );
}

/** `model/domain.qnt` revokedNeverCompletes — the exclusivity half, stated in its own words. */
export function revokedNeverCompletes(c: Core): boolean {
  return everyTicket(
    c,
    (jb) => jb.phase !== "PRevoked" || jb.completions === 0,
  );
}

// --- Isolation invariants ---------------------------------------------------

/**
 * `model/domain.qnt` wrapUpIsolation — LANDING ISOLATION, the gate's
 * attribution half, over the observed step record.
 *
 * The project universe is what makes the attribution checkable at all, so this
 * takes the config the universe derives from; the Core is read for the two
 * authored fields the attribution is compared against (`project` and `wrapUp`,
 * both immutable, so reading them from the post-state is reading what the
 * arrival authored — the model's own note).
 */
export function wrapUpIsolation(
  cfg: Config,
  c: Core,
  lastStep: StepRecord,
): boolean {
  const [first] = lastStep.transitions;
  switch (lastStep.landing.tag) {
    case "WONone":
      return (
        (lastStep.label !== "ticket-done" ||
          (lastStep.transitions.length === 1 &&
            first !== undefined &&
            ticketAt(c, first.ticket).wrapUp.tag === "WNone")) &&
        lastStep.label !== "rework-started wrapup_failure" &&
        lastStep.label !== "ticket-escalated wrapup_budget_exhausted"
      );
    case "WOAttempt": {
      const attempt = lastStep.landing;
      return (
        projects(cfg).has(attempt.project) &&
        first !== undefined &&
        ticketAt(c, first.ticket).project === attempt.project &&
        (lastStep.label === "ticket-done" ||
          lastStep.label === "rework-started wrapup_failure" ||
          lastStep.label === "ticket-escalated wrapup_budget_exhausted" ||
          lastStep.label === "ticket-escalated gas_exhausted") &&
        (lastStep.label === "ticket-done" || attempt.invalidated) &&
        first.from === (attempt.invalidated ? "PWrapUpHolding" : "PWrapUp") &&
        lastStep.transitions.length === 1
      );
    }
    default:
      return assertNever(lastStep.landing, "unhandled WrapUpObs");
  }
}

/**
 * `model/domain.qnt` quietProjectLandsCleanly — the gate's other half, in its
 * strongest checkable form. It reads the step record and nothing else, which is
 * the whole of what "a PER-ATTEMPT environment choice, not stored project
 * state" means: there is no Core to consult.
 */
export function quietProjectLandsCleanly(lastStep: StepRecord): boolean {
  switch (lastStep.landing.tag) {
    case "WONone":
      return true;
    case "WOAttempt":
      return lastStep.landing.invalidated || lastStep.label === "ticket-done";
    default:
      return assertNever(lastStep.landing, "unhandled WrapUpObs");
  }
}

/** `model/domain.qnt` leaseExclusive — no resource is ever held by two tickets. */
export function leaseExclusive(cfg: Config, c: Core): boolean {
  for (const r of projects(cfg)) {
    let holders = 0;
    for (const jb of c.tickets.values()) {
      if (jb.phase === "PWrapUpHolding" && leaseOf(jb) === r) {
        holders += 1;
      }
    }
    if (holders > 1) {
      return false;
    }
  }
  return true;
}

/** `model/domain.qnt` noLeaseWithoutAKind — a WNone ticket never takes a lease. */
export function noLeaseWithoutAKind(c: Core): boolean {
  return everyTicket(
    c,
    (jb) =>
      jb.wrapUp.tag !== "WNone" ||
      (jb.phase !== "PWrapUp" && jb.phase !== "PWrapUpHolding"),
  );
}

/** `model/domain.qnt` artifactWellFormed — a completed ticket produced something. */
export function artifactWellFormed(c: Core): boolean {
  return everyTicket(
    c,
    (jb) => jb.phase !== "PDone" || jb.artifact.tag !== "ANone",
  );
}

/** `model/domain.qnt` projectsWellFormed — every live ticket targets a project inside the bounded universe. */
export function projectsWellFormed(cfg: Config, c: Core): boolean {
  return everyTicket(c, (jb) => projects(cfg).has(jb.project));
}

/**
 * `model/domain.qnt` wrapUpWellFormed — every live ticket's authored wrap-up
 * choice is inside the bounded universe.
 *
 * Membership in a set of records is `domain.ts`'s encoding decision 6, and the
 * question is asked through the definition that already answers it for the
 * arrival — `isAuthorableWrapUp` — rather than by testing the resource against
 * the project universe here. The two are the same question only while
 * `wrapUpChoices` is built from `projects`; a restatement would keep answering
 * the old way if it stopped being.
 */
export function wrapUpWellFormed(cfg: Config, c: Core): boolean {
  return everyTicket(c, (jb) => isAuthorableWrapUp(cfg, jb.wrapUp));
}

/** `model/domain.qnt` terminalsAbsorbing — no observed transition ever leaves a terminal. */
export function terminalsAbsorbing(lastStep: StepRecord): boolean {
  return lastStep.transitions.every(
    (t) => t.from !== "PDone" && t.from !== "PRevoked",
  );
}

/** `model/domain.qnt` deskConsistent — a named wall iff parked, a resume point iff a modeled resume exists. */
export function deskConsistent(c: Core): boolean {
  return everyTicket(
    c,
    (jb) =>
      (jb.phase === "PEscalated") === (jb.reason !== "RsNone") &&
      (jb.resumeAt !== "RNone") ===
        (jb.phase === "PEscalated" && jb.reason !== "RsDependencyRevoked"),
  );
}

/** `model/domain.qnt` wrapUpWallNamed — the gate-budget wall exists only under Budgeted pricing. */
export function wrapUpWallNamed(cfg: Config, c: Core): boolean {
  switch (cfg.wrapUpPricing.tag) {
    case "Budgeted":
      return true;
    case "DeadlineOnly":
      return everyTicket(c, (jb) => jb.reason !== "RsWrapUpBudgetExhausted");
    default:
      return assertNever(cfg.wrapUpPricing, "unhandled WrapUpPricing");
  }
}

/**
 * `model/domain.qnt` accountsBounded — every account stays a resource: bounded
 * below by 0 and above by its grant.
 *
 * Every comparison but one is `measure.ts`'s `accountDigitsInRange`, whose own
 * header names this invariant as the reachable-state form of the argument it
 * makes checkable — so they are asked there rather than spelled again here.
 * What that definition does not carry is the GAS CEILING, and for a stated
 * reason: gas is the measure's most significant digit, so it needs no radix and
 * `Bounds` holds no grant for it. The grant lives on the machine's config, and
 * so does the conjunct that reads it.
 *
 * THE DELEGATION REORDERS THE MODEL'S CONJUNCTS, and that is the one place this
 * file departs from definition-for-definition order on purpose. The model asks
 * each account's floor and ceiling as a pair, gas first; `accountDigitsInRange`
 * asks them in its own order and the gas ceiling arrives last. Nothing observes
 * the difference ON A CONFIG `configAdmitsInit` ACCEPTS: there the six are total
 * comparisons on a record, none of them errors and none narrows what a later one
 * reads, so the conjunction has the same value under any permutation.
 *
 * THE SCOPE IS NOT A FORMALITY. `accountDigitsInRange` reads its two grants
 * through `reworkBudget` and `wrapUpBudget`, and both ASSERT on a negative grant
 * rather than answering — so under a configuration with no initial state the
 * order would decide which failure a caller sees. That configuration has no
 * tickets for this invariant to quantify over, because `freshTicket` refuses it
 * at the ticket-source seam; the permutation argument is therefore sound exactly
 * where it is used, and it is stated no wider than that. Where reordering WOULD
 * be observable on an admissible config, the order is kept and pinned: see the
 * bundle's own note on `measureNonNegative`. Referencing the shipped derivation
 * is the stronger rule of the two, and it wins here.
 */
export function accountsBounded(cfg: Config, c: Core): boolean {
  const b = boundsOf(cfg);
  return everyTicket(
    c,
    (jb) => accountDigitsInRange(b, jb) && jb.gasLeft <= cfg.gas,
  );
}

/**
 * `model/domain.qnt` tasksWellFormed — the live task set is exactly the current
 * phase's anatomy, and the stage index is sane.
 *
 * TWO PLACES THIS ANSWERS ON A NARROWER DOMAIN THAN THE MODEL, both because
 * `TaskSet` is `measure.ts`'s canonical ascending array where the model has a
 * `Set[Task]`:
 *
 *   - The model's `tasks.map(t => t.id) == start.to(start + n - 1)` is a set
 *     equality; here it is the indexed run `tasks[i].id === start + i` under the
 *     width the same conjunct pins. Over a canonical set the two are the same
 *     claim, and the indexed form is what `retireLive` already argues for. Over
 *     a NON-canonical array — one the representation forbids and `assertTaskSet`
 *     refuses at every reader — the indexed form can answer false where a set
 *     equality would answer true. That is stricter on a value that does not
 *     exist, not a different invariant.
 *   - A live eval set carrying two DIFFERENT stage marks makes `evalStage`
 *     throw rather than making this return false. That is `measure.ts`'s
 *     documented choice at the one place the model is order-nondeterministic:
 *     the model excludes the mixed case by THIS invariant, and a deterministic
 *     implementation cannot mirror a fold whose answer depends on its pick
 *     order. The exclusion is checked either way; it is checked one level
 *     louder here.
 *
 * TWO CONJUNCTS OF THE EVAL ARM ARE THEREFORE UNFALSIFIABLE BY RETURN, and both
 * are kept anyway. `t.kind.stage === s` cannot fail on any set that got past
 * `evalStage`, since uniformity is exactly what that function asserts; `s >= 0`
 * cannot fail either, because the same function asserts that every mark it reads
 * is a count and answers 0 for a set carrying no marks at all. The model's arm
 * has both, so this arm has both — and the day `measure.ts` answers a mixed set
 * instead of refusing it, they are the conjuncts that would have to be here
 * already. The suite names them in its redundancy roster, beside the third of
 * their kind on `recordMonotone`.
 *
 * Its neighbour `t.kind.tag === "TKEval"` is pinned by something stronger than
 * either: deleting it stops the file compiling, because `t.kind.stage` does not
 * exist on the work constructor. A conjunct the type system enforces needs no
 * test, and gets one anyway through the phase sweep — a work set in the
 * Evaluating phase is refused there.
 */
export function tasksWellFormed(cfg: Config, c: Core): boolean {
  return everyTicket(c, (jb) => {
    const start = jb.record.length + firstTaskId;
    if (jb.phase === "PWorking") {
      return (
        jb.tasks.length === cfg.nTasks &&
        jb.tasks.every((t, i) => t.id === start + i) &&
        jb.tasks.every((t) => t.kind.tag === "TKWork" && !isCancelled(t.state))
      );
    }
    if (jb.phase === "PEvaluating") {
      const s = evalStage(jb.tasks);
      const stage = jb.program[s];
      return (
        s >= 0 &&
        stage !== undefined &&
        jb.tasks.every(
          (t) =>
            t.kind.tag === "TKEval" &&
            t.kind.stage === s &&
            !isCancelled(t.state),
        ) &&
        jb.tasks.length === stage.fanout &&
        jb.tasks.every((t, i) => t.id === start + i)
      );
    }
    return jb.tasks.length === 0;
  });
}

/**
 * The model's `t.state != TSResolved(TCancelled)`, negated once. `TCancelled`
 * is a retirement mark rather than an outcome events can deliver, so a live
 * task carrying it is the specific defect both task-phase arms forbid.
 */
function isCancelled(state: TaskState): boolean {
  return state.tag === "TSResolved" && state.outcome === "TCancelled";
}

/** `model/domain.qnt` recordWellFormed — the retained record is the resolved log, 1-indexed, with no dangling stage. */
export function recordWellFormed(c: Core): boolean {
  return everyTicket(c, (jb) =>
    jb.record.every((entry, i) => {
      if (entry.id !== i + firstTaskId || entry.state.tag === "TSRunning") {
        return false;
      }
      switch (entry.kind.tag) {
        case "TKWork":
          return true;
        case "TKEval":
          return entry.kind.stage >= 0 && entry.kind.stage < jb.program.length;
        default:
          return assertNever(entry.kind, "unhandled TaskKind");
      }
    }),
  );
}

/**
 * `model/domain.qnt` recordMonotone — the task record is append-only history,
 * against the previous state's snapshot.
 *
 * The model compares two `Task` records with `==`, which is value equality on a
 * record of sum types. TypeScript's `===` on the same values is reference
 * equality, so the comparison is spelled out below — the only place this file
 * needs an equality the encoding decisions did not already buy.
 *
 * THE LENGTH CONJUNCT IS THE MODEL'S GUARD AND NOT THIS ONE'S, which is worth
 * saying because no state can make it answer alone. Quint indexes a list out of
 * range by erroring, so the model must establish the length before walking the
 * previous indices; here `sameTask` is total on an absent entry, so a shrunk
 * record is already refused by the walk. It is mirrored because the model states
 * it, and the suite names it in its redundancy roster.
 */
export function recordMonotone(
  c: Core,
  prevRecords: ReadonlyMap<number, readonly Task[]>,
): boolean {
  for (const [j, previous] of prevRecords) {
    const jb = c.tickets.get(j);
    if (jb === undefined || jb.record.length < previous.length) {
      return false;
    }
    if (!previous.every((entry, i) => sameTask(entry, jb.record[i]))) {
      return false;
    }
  }
  return true;
}

/** The model's `==` on a `Task`: identity, kind and lifecycle state, each compared by value. */
function sameTask(a: Task, b: Task | undefined): boolean {
  return (
    b !== undefined &&
    a.id === b.id &&
    sameKind(a.kind, b.kind) &&
    sameState(a.state, b.state)
  );
}

function sameKind(a: TaskKind, b: TaskKind): boolean {
  switch (a.tag) {
    case "TKWork":
      return b.tag === "TKWork";
    case "TKEval":
      return b.tag === "TKEval" && a.stage === b.stage;
    default:
      return assertNever(a, "unhandled TaskKind");
  }
}

function sameState(a: TaskState, b: TaskState): boolean {
  switch (a.tag) {
    case "TSRunning":
      return b.tag === "TSRunning";
    case "TSResolved":
      return b.tag === "TSResolved" && a.outcome === b.outcome;
    default:
      return assertNever(a, "unhandled TaskState");
  }
}

/** `model/domain.qnt` idsAccounted — every task a ticket ever spawned is still somewhere. */
export function idsAccounted(c: Core): boolean {
  return everyTicket(
    c,
    (jb) => jb.spawned === jb.record.length + jb.tasks.length,
  );
}

/** `model/domain.qnt` programsWellFormed — every live ticket carries a well-formed eval program. */
export function programsWellFormed(cfg: Config, c: Core): boolean {
  return everyTicket(
    c,
    (jb) =>
      jb.program.length >= 1 &&
      jb.program.length <= cfg.maxStages &&
      jb.program.every((s) => s.fanout >= 1 && s.fanout <= cfg.nTasks),
  );
}

/** `model/domain.qnt` depsAcyclic — arrival's DAG-by-construction survives every step. */
export function depsAcyclic(c: Core): boolean {
  return everyTicket(c, (jb, j) => {
    for (const d of jb.deps) {
      if (!c.tickets.has(d) || d >= j) {
        return false;
      }
    }
    return true;
  });
}

/**
 * `model/domain.qnt` idsDense — ids are dense from `firstTicketId` and never
 * reused, and the fleet stays inside the arrival bound.
 *
 * The model's `liveTickets == 1.to(size)` is a set equality; the loop below
 * establishes it from one side, which is enough because the other side is the
 * map's own count: a fleet of `size` keys that CONTAINS every id in a range of
 * `size` ids contains nothing else.
 */
export function idsDense(cfg: Config, c: Core): boolean {
  const size = c.tickets.size;
  for (let j = firstTicketId; j < firstTicketId + size; j += 1) {
    if (!c.tickets.has(j)) {
      return false;
    }
  }
  return size <= cfg.nTickets;
}

// --- Visibility -------------------------------------------------------------

/** `model/domain.qnt` visEdges — the walk's edge relation is the dependency edges, and only those. */
export function visEdges(c: Core, j: number): ReadonlySet<number> {
  return ticketAt(c, j).deps;
}

/** The model's `visEdges(j).exists(d => set.contains(d))`, over two primitive sets. */
function anyEdgeIn(
  edges: ReadonlySet<number>,
  set: ReadonlySet<number>,
): boolean {
  for (const d of edges) {
    if (set.has(d)) {
      return true;
    }
  }
  return false;
}

/**
 * `model/domain.qnt` stuckSet — tickets whose own measure cannot descend
 * without a human.
 *
 * The base case is written as the phase comparison the model writes, not as
 * `hasOpenHumanTask`, although they are the same predicate: `stuckSubsetCovered`
 * is a claim about the two walks agreeing, and it is only a claim while each
 * walk keeps its own spelling of its base case. Collapsing them here would make
 * the containment true by construction in a second, undocumented way.
 */
export function stuckSet(c: Core): ReadonlySet<number> {
  let stuck: ReadonlySet<number> = new Set();
  for (let sweep = 0; sweep < c.tickets.size; sweep += 1) {
    const next = new Set<number>();
    for (const [j, jb] of c.tickets) {
      if (
        jb.phase === "PEscalated" ||
        (jb.phase === "PPending" && anyEdgeIn(visEdges(c, j), stuck))
      ) {
        next.add(j);
      }
    }
    stuck = next;
  }
  return stuck;
}

/** `model/domain.qnt` coveredSet — tickets reachable from an open human task along the visibility edges. */
export function coveredSet(c: Core): ReadonlySet<number> {
  let covered: ReadonlySet<number> = new Set();
  for (let sweep = 0; sweep < c.tickets.size; sweep += 1) {
    const next = new Set<number>();
    for (const [j, jb] of c.tickets) {
      if (hasOpenHumanTask(jb) || anyEdgeIn(visEdges(c, j), covered)) {
        next.add(j);
      }
    }
    covered = next;
  }
  return covered;
}

/** `model/domain.qnt` stuckSubsetCovered — the two walks agree, and that is all it says. */
export function stuckSubsetCovered(c: Core): boolean {
  return isSubsetOf(stuckSet(c), coveredSet(c));
}

// --- Cascade safety ---------------------------------------------------------

/**
 * `model/domain.qnt` revokeDoomed — tickets transitively doomed by a
 * revocation.
 *
 * ONE ASCENDING PASS, not a sweep: deps point strictly downward (`depsAcyclic`),
 * so a ticket's doom is decided after every id it can name has been. The pass
 * reads every id in `firstTicketId..size`, which is sound only while ids are
 * dense — the same reliance `decideRevoke` has, and `ticketAt` asserts it here
 * for the same reason.
 */
export function revokeDoomed(c: Core): ReadonlySet<number> {
  const doomed = new Set<number>();
  for (let j = firstTicketId; j < firstTicketId + c.tickets.size; j += 1) {
    const deps = ticketAt(c, j).deps;
    for (const d of deps) {
      if (ticketAt(c, d).phase === "PRevoked" || doomed.has(d)) {
        doomed.add(j);
        break;
      }
    }
  }
  return doomed;
}

/** `model/domain.qnt` canFinishSet — tickets with a reachable route to Done, a least fixpoint upward from the terminal. */
export function canFinishSet(c: Core): ReadonlySet<number> {
  let canFinish: ReadonlySet<number> = new Set();
  for (let sweep = 0; sweep < c.tickets.size; sweep += 1) {
    const next = new Set<number>();
    for (const [j, jb] of c.tickets) {
      if (
        jb.phase === "PDone" ||
        (jb.phase !== "PRevoked" && isSubsetOf(waitsOn(c, j), canFinish))
      ) {
        next.add(j);
      }
    }
    canFinish = next;
  }
  return canFinish;
}

/** `model/domain.qnt` noStructuralDeadlock — every live ticket can still reach Done, was settled by its author, or holds an open desk task. */
export function noStructuralDeadlock(c: Core): boolean {
  const canFinish = canFinishSet(c);
  return everyTicket(
    c,
    (jb, j) =>
      canFinish.has(j) || jb.phase === "PRevoked" || hasOpenHumanTask(jb),
  );
}

/** `model/domain.qnt` cascadeSafety — every ticket transitively stuck behind a Revoked dep is parked with its own open human task, or is itself revoked. */
export function cascadeSafety(c: Core): boolean {
  for (const j of revokeDoomed(c)) {
    const jb = ticketAt(c, j);
    if (
      jb.phase !== "PRevoked" &&
      !(jb.phase === "PEscalated" && jb.reason === "RsDependencyRevoked")
    ) {
      return false;
    }
  }
  return true;
}

// --- Measure descent --------------------------------------------------------

/**
 * `model/domain.qnt` measureNonNegative — the well-foundedness half.
 *
 * IT CANNOT RETURN FALSE ON THIS TREE, AND SAYING SO IS THE POINT.
 * `ticketMeasure` refuses a negative account by throwing (`measure.ts` asserts
 * each of the three is a count), and every other digit it sums is a rank, a
 * bounded stage index or a running count — so every state whose measure the
 * model would call negative makes `sysMeasure` fail one level LOUDER here
 * instead, exactly as `configAdmitsInit` refuses a negative grant more loudly
 * than the model's `false`. It is kept, named and bundled anyway: it is the
 * half the model names, the bundle mirrors the model's conjunction, and a
 * future `measure.ts` that relaxed an assertion would need this conjunct to
 * still be here.
 *
 * THE BUNDLE NEVER REACHES THAT THROW, and the model's conjunct ORDER is what
 * stops it: `accountsBounded` states exactly the floor `ticketMeasure` asserts
 * and is conjoined ahead of `measureDescends`, and `&&` short-circuits. So a
 * negative account is reported by
 * name through `allInvariants` and refused by assertion only when this half is
 * asked on its own. Both halves are pinned in the suite; the order is not an
 * accident to be tidied.
 */
export function measureNonNegative(cfg: Config, c: Core): boolean {
  return sysMeasure(boundsOf(cfg), c.tickets) >= 0;
}

/**
 * `model/domain.qnt` stepDescends — the descent half: every step strictly
 * decreases `sysMeasure` except the named STUTTER, CHURN and AUTHORING sets.
 *
 * ARM FOR ARM, and the roster is the model's. Its comment lists one entry per
 * FLAVOR while the disjunction has one arm per LABEL, because `operator-retry`
 * contributes two flavors under a single label test and the model writes them as
 * an inner disjunction; that nesting is kept here so the two texts line up entry
 * for entry. The suite walks the roster row by row.
 * The normative convention that governs this disjunction — no arm without a
 * deterministic witness run that fires it — is the model's, and adding an arm
 * here without adding it there would be inventing an exemption the machine
 * never proved.
 */
export function stepDescends(
  cfg: Config,
  c: Core,
  lastStep: StepRecord,
  prevMeasure: number,
): boolean {
  const exempt =
    lastStep.label === "init" ||
    // STUTTER: state-identical delivery noise + the dead-end self-loop.
    lastStep.label === "task-done-duplicate" ||
    lastStep.label === "complete-duplicate" ||
    lastStep.label === "settled" ||
    // CHURN: the uncharged operator-resume flavors — the PRE-WORK resume, and
    // under RetryFree only, the Evaluating/Landing resumes.
    (lastStep.label === "operator-retry" &&
      (lastStep.transitions.some((t) => t.to === "PPending") ||
        (cfg.opRetryPricing === "RetryFree" &&
          lastStep.transitions.some((t) => t.to !== "PWorking")))) ||
    // AUTHORING: a ticket entering the fleet climbs by its whole fresh measure
    lastStep.label === "ticket-arrived" ||
    // ...and a desk-only revoke is flat.
    (lastStep.label === "ticket-revoked" &&
      lastStep.transitions.every((t) => phaseRank(t.from) === rankSettled));
  return exempt || sysMeasure(boundsOf(cfg), c.tickets) < prevMeasure;
}

/** `model/domain.qnt` measureDescends — both halves, the per-ticket termination sketch. */
export function measureDescends(
  cfg: Config,
  c: Core,
  lastStep: StepRecord,
  prevMeasure: number,
): boolean {
  return (
    measureNonNegative(cfg, c) && stepDescends(cfg, c, lastStep, prevMeasure)
  );
}

/**
 * `model/domain.qnt` allInvariants — all safety invariants, in the model's own
 * conjunct order.
 *
 * A PLAIN CONJUNCTION AND NOT A ROSTER OF NAMED VERDICTS, deliberately. `&&`
 * short-circuits exactly as the model's `and { ... }` does, so the first false
 * conjunct is the last one evaluated on both sides — and a verdict list would
 * evaluate every conjunct, turning a state the model reports as a plain
 * violation into whatever the conjuncts AFTER the violation do with it. Which
 * conjunct failed is answered by asking the exported predicates, which is what
 * this file's own suite does.
 */
export function allInvariants(
  cfg: Config,
  c: Core,
  history: StepHistory,
): boolean {
  return (
    completionExclusive(c) &&
    revokedNeverCompletes(c) &&
    wrapUpIsolation(cfg, c, history.lastStep) &&
    quietProjectLandsCleanly(history.lastStep) &&
    leaseExclusive(cfg, c) &&
    noLeaseWithoutAKind(c) &&
    artifactWellFormed(c) &&
    projectsWellFormed(cfg, c) &&
    wrapUpWellFormed(cfg, c) &&
    terminalsAbsorbing(history.lastStep) &&
    deskConsistent(c) &&
    wrapUpWallNamed(cfg, c) &&
    accountsBounded(cfg, c) &&
    tasksWellFormed(cfg, c) &&
    recordWellFormed(c) &&
    recordMonotone(c, history.prevRecords) &&
    idsAccounted(c) &&
    programsWellFormed(cfg, c) &&
    depsAcyclic(c) &&
    idsDense(cfg, c) &&
    stuckSubsetCovered(c) &&
    cascadeSafety(c) &&
    noStructuralDeadlock(c) &&
    measureDescends(cfg, c, history.lastStep, history.prevMeasure)
  );
}

/**
 * The bundle above as NAMES, in the model's own conjunct order — the roster
 * `src/tools/verify.ts` holds against `model/domain.qnt`'s own `and { … }` as
 * an exact set in both directions.
 *
 * WHY THE NAMES ARE HERE AND THE VERDICTS ARE NOT. `bundle.test.ts` pairs each
 * name with the call the bundle makes, and its header says why that pairing
 * belongs to the suites rather than to this file. The conformance gate cannot
 * read it: a `.test.ts` module is this tree's file class for "exists only for
 * the suite", and `.dependency-cruiser.mjs`'s `no-shipped-test-fixtures`
 * forbids any shipped module from importing one. So the comparable half — the
 * roster with no verdicts attached — ships here, and `invariants.test.ts` holds
 * the two to each other.
 *
 * IT IS THE ONE THING ABOUT THE BUNDLE A COMPILER CANNOT KEEP. The conjunction
 * above is a chain of calls, so a conjunct dropped from it is invisible to every
 * type in this file; the model comparison is what notices, and it can only
 * notice against a list.
 */
export const bundleConjunctNames: readonly string[] = [
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
];
