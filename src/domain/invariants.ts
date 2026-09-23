/**
 * The safety invariants, one predicate per name `model/domain.qnt` declares.
 *
 * EVERY ONE IS A PURE FUNCTION OF A STEP VIEW — the states either side of a
 * decision and the decision itself. That is what lets the same predicates
 * judge a replayed golden, a randomized walk and a unit fixture without any of
 * them knowing which is which.
 *
 * THE ROSTER AT THE BOTTOM IS THE POINT. The model bundles these under
 * `allInvariants`, and `test/domain/bundle.test.ts` holds the roster here
 * against the model's own text: an invariant added there and not here is a
 * failure rather than a silent gap. It is not a list a reader is asked to
 * trust.
 */

import { releasedTicketValid, type Config } from "./config.ts";
import { liveTickets, ticketAt } from "./ticketGraph.ts";
import { coveredSet, stuckSet, subsetOf } from "./derived.ts";
import type {
  LastDecision,
  TicketGraph,
  Ticket,
} from "./generated/modelTypes.ts";
import { type TicketId } from "./ids.ts";
import { taskIdentityValid } from "./task.ts";
import { instanceEquals, instanceValid, stagesEqual } from "./evaluation.ts";
import { waitsOn } from "./enablement.ts";
import {
  artifactOf,
  currentInstance,
  evaluationSpawnTotal,
  instanceBlocked,
  liveTasks,
  runningStageIndex,
} from "./ticket.ts";
import { decisionValid } from "./decisionValid.ts";
import { evolve } from "./evolve.ts";
import { graphEquals } from "./equality.ts";
import { isTerminalPhase } from "./phase.ts";

/**
 * What one invariant is evaluated against: the state the last decision found,
 * that decision, and the state now. A step that decides nothing carries the
 * first two unchanged.
 */
export interface StepView {
  readonly pre: TicketGraph;
  readonly last: LastDecision;
  readonly post: TicketGraph;
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
  graph: TicketGraph,
  holds: (ticket: Ticket, id: TicketId) => boolean,
): boolean {
  return liveTickets(graph).every((id) => holds(ticketAt(graph, id), id));
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

/** Nothing is Done without having produced the artifact its dependents read. */
export const artifactWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.phase !== "Done" || artifactOf(t) !== "NoArtifact",
  );

/** Terminal outcomes absorb: a ticket the last decision found Done or Revoked is still in that phase. */
export const terminalsAbsorbing: Invariant = (_config, view) =>
  liveTickets(view.pre).every((id) => {
    const before = ticketAt(view.pre, id).phase;
    if (!isTerminalPhase(before)) return true;
    const after = view.post.tickets.get(id);
    return after !== undefined && after.phase === before;
  });

/**
 * The desk's one equivalence. A ticket names a wall exactly while it is
 * parked; where that wall resumes is derived from it and total, so a desk task
 * cannot offer a way on the deciders would refuse.
 */
export const deskConsistent: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => (t.phase === "Escalated") === (t.escalation !== "NoEscalation"),
  );

/**
 * Every instance is well-formed by the protocol's own invariant, which chuggy
 * re-states none of; what chuggy adds is the AGREEMENT between an instance and
 * the ticket carrying it — this ticket, this plan, a cycle it has started,
 * and the instances in the order those cycles ran.
 *
 * THE PHASE SAYS WHICH INSTANCE IS OPEN: a ticket in Evaluation is running the
 * last one at the cycle it is on, and a ticket parked at the blocked wall has
 * the last one blocked — which is what makes the desk's wall and the
 * instance's state one fact instead of two that can disagree.
 */
export const evaluationsWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t, id) => {
    const wellFormed = t.evaluations.every((instance, index) => {
      const previous = t.evaluations[index - 1];
      return (
        instanceValid(instance) &&
        instance.input.ticket === id &&
        stagesEqual(instance.plan.stages, t.definition.evaluationPlan.stages) &&
        instance.workCycle <= t.workCyclesStarted &&
        (previous === undefined || previous.workCycle < instance.workCycle)
      );
    });
    if (!wellFormed) return false;
    if (t.phase === "Evaluation") {
      if (t.evaluations.length === 0) return false;
      const open = currentInstance(t);
      if (runningStageIndex(open) < 0) return false;
      if (open.workCycle !== t.workCyclesStarted) return false;
      if (open.input.acceptedSourceRef !== t.source) return false;
    }
    if (t.escalation === "EvaluationBlockedEscalated") {
      if (t.evaluations.length === 0) return false;
      if (!instanceBlocked(currentInstance(t))) return false;
    }
    return true;
  });

/**
 * History is append-only: every instance a ticket held is still there and
 * still says what it said, with exactly one exception — the LAST instance,
 * while it is still the last, is the open one and advances, and is frozen once
 * a newer one sits behind it. So a rewritten judgement, a dropped instance and
 * a reordered history are each caught in the step that did it.
 */
export const evaluationsMonotone: Invariant = (_config, view) =>
  liveTickets(view.pre).every((id) => {
    if (!view.post.tickets.has(id)) return false;
    const before = ticketAt(view.pre, id).evaluations;
    const after = ticketAt(view.post, id).evaluations;
    return before.every((instance, index) => {
      const kept = after[index];
      if (kept === undefined) return false;
      if (instanceEquals(instance, kept)) return true;
      return index + 1 === before.length && after.length === before.length;
    });
  });

/**
 * Identity accounting: the mint counter is one slot per work cycle started,
 * plus, for every run of every instance, its roster once per generation it
 * reached — every spawn site bumping the counter from the RELEASED plan
 * while this sum reads the INSTANCES, so the two sides come from different
 * places.
 *
 * It is a SLOT count and not a task count: a resume re-asks only what it
 * reopened and still claims the roster, which is what keeps the counter
 * derivable — the subset a resume asked is unrecoverable once those
 * evaluators have answered, and an unused slot costs a monotone mint
 * nothing.
 */
export const idsAccounted: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.spawned === t.workCyclesStarted + evaluationSpawnTotal(t),
  );

/** The contract's own predicate over every task the machine is waiting on. */
export const taskIdentitiesValid: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) => liveTasks(t).every(taskIdentityValid));

/**
 * The released definition is well-formed, in every reachable state: the ticket
 * is the one its definition names, and the definition satisfies the release's
 * own rule. Holding everywhere is what makes that rule a refusal.
 */
export const definitionsWellFormed: Invariant = (config, view) =>
  everyLiveTicket(
    view.post,
    (t, id) =>
      t.definition.id === id && releasedTicketValid(config, t.definition),
  );

/**
 * The source is pinned by the dispatch and by nothing else: a ticket carries
 * one exactly once it has started a work cycle, which is exactly what a
 * dispatch does. It goes red on a dispatch that filled no source, on a rework
 * or resume that cleared one, and on a release that invented one.
 */
export const sourcePinned: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) => t.source > 0 === t.workCyclesStarted > 0);

/**
 * The finalization generation is held where an attempt is: positive while the
 * ticket finalizes or is parked at the finalization wall, and zero while it
 * has not reached one this cycle.
 */
export const finalizationGenerationHeld: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) => {
    const attempting =
      t.phase === "Finalization" ||
      t.escalation === "FinalizationUnavailableEscalated";
    const before =
      t.phase === "Pending" || t.phase === "Work" || t.phase === "Evaluation";
    return (
      (!attempting || t.finalizationGeneration > 0) &&
      (!before || t.finalizationGeneration === 0)
    );
  });

/** The last decision is valid where it was taken (`decisionValid`). */
export const decisionsValid: Invariant = (_config, view) =>
  view.last === "NoDecision" || decisionValid(view.pre, view.last.value);

/**
 * A decided event is never the identity: the event the machine decides at a
 * state moves that state. It is what lets a journal's legality check refuse
 * an inert row without refusing one the machine decided.
 */
export const eventsNeverIdentity: Invariant = (_config, view) =>
  view.last === "NoDecision" ||
  !graphEquals(evolve(view.pre, view.last.value.event), view.pre);

/**
 * Everything this ticket transitively waits on, as a bounded fixpoint over
 * actual keys. A pass that changes anything adds at least one id, so the
 * fleet's own size is house rule 9's explicit bound.
 */
function dependencyClosure(
  graph: TicketGraph,
  id: TicketId,
): ReadonlySet<number> {
  const seen = new Set<number>(waitsOn(graph, id));
  for (let pass = 0; pass < liveTickets(graph).length; pass++) {
    for (const d of [...seen]) {
      if (!graph.tickets.has(d)) continue;
      for (const further of waitsOn(graph, d as TicketId)) seen.add(further);
    }
  }
  return seen;
}

/** Dependencies name live tickets, and no ticket waits on itself through any chain. */
export const depsAcyclic: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (_t, id) => {
    const live = new Set<number>(liveTickets(view.post));
    return (
      [...waitsOn(view.post, id)].every((d) => live.has(d)) &&
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

/**
 * Every predicate the model's bundle names, in the order it names them.
 * `test/domain/bundle.test.ts` holds this roster against `model/domain.qnt`
 * itself rather than against a copy of it.
 */
export const invariantBundle: readonly NamedInvariant[] = [
  { invariant: "completionExclusive", holds: completionExclusive },
  { invariant: "revokedNeverCompletes", holds: revokedNeverCompletes },
  { invariant: "artifactWellFormed", holds: artifactWellFormed },
  { invariant: "terminalsAbsorbing", holds: terminalsAbsorbing },
  { invariant: "deskConsistent", holds: deskConsistent },
  { invariant: "evaluationsWellFormed", holds: evaluationsWellFormed },
  { invariant: "evaluationsMonotone", holds: evaluationsMonotone },
  { invariant: "idsAccounted", holds: idsAccounted },
  { invariant: "taskIdentitiesValid", holds: taskIdentitiesValid },
  { invariant: "definitionsWellFormed", holds: definitionsWellFormed },
  { invariant: "sourcePinned", holds: sourcePinned },
  {
    invariant: "finalizationGenerationHeld",
    holds: finalizationGenerationHeld,
  },
  { invariant: "decisionsValid", holds: decisionsValid },
  { invariant: "eventsNeverIdentity", holds: eventsNeverIdentity },
  { invariant: "depsAcyclic", holds: depsAcyclic },
  { invariant: "ticketIdsWellFormed", holds: ticketIdsWellFormed },
  { invariant: "stuckSubsetCovered", holds: stuckSubsetCovered },
];

/** The members that came back false, named. An empty list is the green answer. */
export function failedInvariants(
  config: Config,
  view: StepView,
): readonly string[] {
  return invariantBundle
    .filter((member) => !member.holds(config, view))
    .map((member) => member.invariant);
}

/** The bundle's own verdict, as the model's `allInvariants` asks for it. */
export function allInvariants(config: Config, view: StepView): boolean {
  return invariantBundle.every((member) => member.holds(config, view));
}
