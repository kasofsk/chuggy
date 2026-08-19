/**
 * The safety invariants, one predicate per name `model/domain.qnt` declares.
 *
 * EVERY ONE IS A PURE FUNCTION OF A STEP VIEW — the states either side of a
 * decision and the record it wrote. That is what lets the same predicates
 * judge a replayed golden, a randomized walk and a unit fixture without any of
 * them knowing which is which.
 *
 * THE ROSTERS AT THE BOTTOM ARE THE POINT. The model bundles these under
 * `allInvariants`, and `test/domain/bundle.test.ts` holds both rosters here
 * against the model's own text: an invariant added there and not here is a
 * failure rather than a silent gap. Neither roster is a list a reader is asked
 * to trust.
 */

import { boundsOf, finalizerChoices, type Config } from "./config.ts";
import { liveTickets, ticketAt } from "./core.ts";
import {
  canFinishSet,
  coveredSet,
  revokeDoomed,
  stuckSet,
  subsetOf,
} from "./derived.ts";
import type { Core, StepRecord, Task, Ticket } from "./generated/modelTypes.ts";
import { firstTaskId, type TicketId } from "./ids.ts";
import { sysMeasure } from "./measure.ts";
import { phaseRank, rankSettled } from "./phase.ts";
import { finalizationBudget, reworkBudget } from "./pricing.ts";
import { evalStage, tasksInIdOrder, taskEquals } from "./task.ts";
import { hasOpenHumanTask } from "./ticket.ts";

/** What one invariant is evaluated against: the last decision, and the states either side of it. */
export interface StepView {
  readonly pre: Core;
  readonly rec: StepRecord;
  readonly post: Core;
}

/** The one signature all of them have, whatever each of them reads. */
export type Invariant = (config: Config, view: StepView) => boolean;

/** One invariant under the name `model/domain.qnt` declares it by. */
export interface NamedInvariant {
  readonly invariant: string;
  readonly holds: Invariant;
}

/** Every live ticket satisfies this, read in ascending id order. */
function everyLiveTicket(
  core: Core,
  holds: (ticket: Ticket, id: TicketId) => boolean,
): boolean {
  return liveTickets(core).every((id) => holds(ticketAt(core, id), id));
}

/**
 * A ticket completes at most once, and holds a completion exactly while it is
 * Done. The count is the model's stored ledger, which is what makes a
 * double-spend visible rather than merely absent.
 */
export const completionExclusive: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.completions <= 1 && (t.completions === 1) === (t.phase === "Done"),
  );

/** A revoked ticket never completed on the way out. */
export const revokedNeverCompletes: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.phase !== "Revoked" || t.completions === 0,
  );

/** A ticket authored without a finalizer never reaches the phase that runs one. */
export const noFinalizationWithoutAKind: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.finalizer !== "NoFinalizer" || t.phase !== "Finalizing",
  );

/** Nothing is Done without having produced the artifact its dependents read. */
export const artifactWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.phase !== "Done" || t.artifact !== "NoArtifact",
  );

/** Every ticket's finish kind is one a release could have drawn. */
export const finalizerWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) => finalizerChoices.includes(t.finalizer));

/** The two terminals absorb: no transition ever leaves one. */
export const terminalsAbsorbing: Invariant = (_config, view) =>
  view.rec.transitions.every((t) => t.from !== "Done" && t.from !== "Revoked");

/**
 * The desk's two equivalences. A ticket carries a reason exactly while it is
 * parked, and carries a resume point exactly while it is parked for something
 * other than a revoked dependency — that wall has no modeled resume, and
 * saying so structurally is what stops a desk task promising one.
 */
export const deskConsistent: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) => {
    const parked = t.phase === "Escalated";
    const named = t.reason !== "NoReason";
    const resumable = parked && t.reason !== "DependencyRevoked";
    return parked === named && (t.resumeAt !== "NoResume") === resumable;
  });

/** No ticket is walled on an account its pricing never granted. */
export const finalizerWallNamed: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) =>
      t.finalizationPricing !== "DeadlineOnly" ||
      t.reason !== "FinalizationBudgetExhausted",
  );

/** Every account stays a resource: bounded below by zero, above by its grant. */
export const accountsBounded: Invariant = (config, view) =>
  everyLiveTicket(
    view.post,
    (t) =>
      t.gasLeft >= 0 &&
      t.gasLeft <= config.gas &&
      t.reworkLeft >= 0 &&
      t.reworkLeft <= reworkBudget(t.reworkPolicy) &&
      t.finalizationLeft >= 0 &&
      t.finalizationLeft <= finalizationBudget(t.finalizationPricing),
  );

/** Whether these ids are exactly the contiguous run of `count` starting at `start`. */
function idsAreTheRunFrom(
  tasks: ReadonlySet<Task>,
  start: number,
  count: number,
): boolean {
  const ids = tasksInIdOrder(tasks).map((t) => t.id);
  return ids.length === count && ids.every((id, index) => id === start + index);
}

/**
 * The live task set is exactly the current phase's anatomy: the work set while
 * Working, one stage's fan-out while Evaluating, and empty everywhere else.
 * Dead live-task state is never carried, and the live ids are the contiguous
 * run directly above the retired record — which is what the
 * at-least-once-by-identity argument needs.
 */
export const tasksWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) => {
    const start = t.record.length + firstTaskId;
    const live = tasksInIdOrder(t.tasks);
    if (t.phase === "Working") {
      return (
        t.tasks.size === t.workFanout &&
        idsAreTheRunFrom(t.tasks, start, t.workFanout) &&
        live.every(
          (task) =>
            task.kind === "Work" &&
            !(task.state !== "Outstanding" && task.state.value === "Cancelled"),
        )
      );
    }
    if (t.phase === "Evaluating") {
      const stage = evalStage(t.tasks);
      const declared = t.program[stage];
      return (
        stage >= 0 &&
        declared !== undefined &&
        live.every(
          (task) =>
            task.kind !== "Work" &&
            task.kind.value === stage &&
            !(task.state !== "Outstanding" && task.state.value === "Cancelled"),
        ) &&
        t.tasks.size === declared.fanout &&
        idsAreTheRunFrom(t.tasks, start, t.tasks.size)
      );
    }
    return t.tasks.size === 0;
  });

/** The retained record is dense from the first id, fully settled, and indexes into the program. */
export const recordWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) =>
    t.record.every((task, index) => {
      if (task.id !== index + firstTaskId) return false;
      if (task.state === "Outstanding") return false;
      if (task.kind === "Work") return true;
      return task.kind.value >= 0 && task.kind.value < t.program.length;
    }),
  );

/** History is append-only: no decision rewrites or shortens a retained record. */
export const recordMonotone: Invariant = (_config, view) =>
  liveTickets(view.pre).every((id) => {
    if (!view.post.tickets.has(id)) return false;
    const before = ticketAt(view.pre, id).record;
    const after = ticketAt(view.post, id).record;
    return (
      after.length >= before.length &&
      before.every((task, index) => {
        const kept = after[index];
        return kept !== undefined && taskEquals(task, kept);
      })
    );
  });

/** Every id ever issued is either retired into the record or live in the set. */
export const idsAccounted: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.spawned === t.record.length + t.tasks.size,
  );

/** Every authored program is one a release could have drawn. */
export const programsWellFormed: Invariant = (config, view) =>
  everyLiveTicket(
    view.post,
    (t) =>
      t.program.length >= 1 &&
      t.program.length <= config.maxStages &&
      t.program.every((s) => s.fanout >= 1 && s.fanout <= config.nTasks),
  );

/**
 * Everything this ticket transitively waits on, as a bounded fixpoint over
 * actual keys. A pass that changes anything adds at least one id, so the
 * fleet's own size is house rule 9's explicit bound.
 */
function dependencyClosure(core: Core, id: TicketId): ReadonlySet<number> {
  const seen = new Set<number>(ticketAt(core, id).deps);
  for (let pass = 0; pass < liveTickets(core).length; pass++) {
    for (const d of [...seen]) {
      if (!core.tickets.has(d)) continue;
      for (const further of ticketAt(core, d as TicketId).deps)
        seen.add(further);
    }
  }
  return seen;
}

/** Dependencies name live tickets, and no ticket waits on itself through any chain. */
export const depsAcyclic: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t, id) => {
    const live = new Set<number>(liveTickets(view.post));
    return (
      [...t.deps].every((d) => live.has(d)) &&
      !dependencyClosure(view.post, id).has(id)
    );
  });

/**
 * Ids come from the universe a release draws from, and the fleet stays within
 * its bound. They are sparse by construction, so this is a membership claim
 * rather than a density one.
 */
export const ticketIdsWellFormed: Invariant = (config, view) => {
  const universeCeiling = config.nTickets * 2;
  const live = liveTickets(view.post);
  return (
    live.every((id) => id >= 1 && id <= universeCeiling) &&
    live.length <= config.nTickets
  );
};

/** Nothing is stuck without a desk task reachable from it: the visibility guarantee. */
export const stuckSubsetCovered: Invariant = (_config, view) =>
  subsetOf(stuckSet(view.post), coveredSet(view.post));

/** Every ticket doomed by a revocation is itself revoked, or parked naming that revocation. */
export const cascadeSafety: Invariant = (_config, view) =>
  [...revokeDoomed(view.post)].every((id) => {
    const t = ticketAt(view.post, id);
    return (
      t.phase === "Revoked" ||
      (t.phase === "Escalated" && t.reason === "DependencyRevoked")
    );
  });

/** Every live ticket has a route to Done, is revoked, or is on the desk where a human can act. */
export const noStructuralDeadlock: Invariant = (_config, view) => {
  const finishable = canFinishSet(view.post);
  return everyLiveTicket(
    view.post,
    (t, id) =>
      finishable.has(id) || t.phase === "Revoked" || hasOpenHumanTask(t),
  );
};

/** The measure is a natural number, which is half of what makes it a measure. */
export const measureNonNegative: Invariant = (config, view) =>
  sysMeasure(boundsOf(config), view.post) >= 0;

/**
 * Whether this step is one of the declared climbs. Current roster:
 *   init                  — every run's first step;
 *   settled               — the quiet fleet's stutter;
 *   ticket-resumed, RetryFree pipeline flavor
 *                         — the uncharged resume;
 *   ticket-released       — every run's releases;
 *   ticket-revoked, desk-only flat
 *                         — a revoke whose every transition leaves a settled rank.
 */
function stepDescendsExempt(view: StepView): boolean {
  const label = view.rec.label;
  if (label === "init" || label === "settled") return true;
  if (label === "ticket-released") return true;
  if (label === "ticket-resumed") {
    return view.rec.transitions.some(
      (t) =>
        (t.to === "Evaluating" || t.to === "Finalizing") &&
        ticketAt(view.post, t.ticket as TicketId).resumePricing === "RetryFree",
    );
  }
  if (label === "ticket-revoked") {
    return view.rec.transitions.every((t) => phaseRank(t.from) === rankSettled);
  }
  return false;
}

/** Every step either descends the measure or is one of the declared climbs. */
export const stepDescends: Invariant = (config, view) => {
  if (stepDescendsExempt(view)) return true;
  const bounds = boundsOf(config);
  return sysMeasure(bounds, view.post) < sysMeasure(bounds, view.pre);
};

/** The two halves the model bundles under one name. */
export const measureDescends: Invariant = (config, view) =>
  measureNonNegative(config, view) && stepDescends(config, view);

/**
 * Every leaf predicate, in the order the model's bundle reaches them. This is
 * what a reviewer counts; `invariantBundle` is what a run checks, and
 * `test/domain/bundle.test.ts` holds both against `model/domain.qnt` itself.
 */
export const invariantLeaves: readonly NamedInvariant[] = [
  { invariant: "completionExclusive", holds: completionExclusive },
  { invariant: "revokedNeverCompletes", holds: revokedNeverCompletes },
  {
    invariant: "noFinalizationWithoutAKind",
    holds: noFinalizationWithoutAKind,
  },
  { invariant: "artifactWellFormed", holds: artifactWellFormed },
  { invariant: "finalizerWellFormed", holds: finalizerWellFormed },
  { invariant: "terminalsAbsorbing", holds: terminalsAbsorbing },
  { invariant: "deskConsistent", holds: deskConsistent },
  { invariant: "finalizerWallNamed", holds: finalizerWallNamed },
  { invariant: "accountsBounded", holds: accountsBounded },
  { invariant: "tasksWellFormed", holds: tasksWellFormed },
  { invariant: "recordWellFormed", holds: recordWellFormed },
  { invariant: "recordMonotone", holds: recordMonotone },
  { invariant: "idsAccounted", holds: idsAccounted },
  { invariant: "programsWellFormed", holds: programsWellFormed },
  { invariant: "depsAcyclic", holds: depsAcyclic },
  { invariant: "ticketIdsWellFormed", holds: ticketIdsWellFormed },
  { invariant: "stuckSubsetCovered", holds: stuckSubsetCovered },
  { invariant: "cascadeSafety", holds: cascadeSafety },
  { invariant: "noStructuralDeadlock", holds: noStructuralDeadlock },
  { invariant: "measureNonNegative", holds: measureNonNegative },
  { invariant: "stepDescends", holds: stepDescends },
];

/** The halves the model bundles under one name, which is the only place the two rosters differ. */
const measureHalves = ["measureNonNegative", "stepDescends"];

/**
 * The bundle a run checks, derived from the leaves rather than listed beside
 * them — a second list would be a second thing to keep current, and the model's
 * own relationship between the two is exactly this substitution.
 */
export const invariantBundle: readonly NamedInvariant[] = [
  ...invariantLeaves.filter((m) => !measureHalves.includes(m.invariant)),
  { invariant: "measureDescends", holds: measureDescends },
];

/** The leaves that came back false, named. An empty list is the green answer. */
export function failedInvariants(
  config: Config,
  view: StepView,
): readonly string[] {
  return invariantLeaves
    .filter((member) => !member.holds(config, view))
    .map((member) => member.invariant);
}

/** The bundle's own verdict, as the model's `allInvariants` asks for it. */
export function allInvariants(config: Config, view: StepView): boolean {
  return invariantBundle.every((member) => member.holds(config, view));
}
