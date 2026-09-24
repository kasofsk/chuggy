/**
 * The safety invariants, one predicate per name `model/domain.qnt` declares.
 *
 * EVERY ONE IS A PURE FUNCTION OF A STEP VIEW — the states and ledgers either
 * side of a decision and the decision itself. That is what lets the same
 * predicates judge a replayed golden, a randomized walk and a unit fixture
 * without any of them knowing which is which.
 *
 * What the ticket's own state carries is the package's to hold
 * (`graphWellFormed`, its `graphInvariant`); what follows it is chuggy's —
 * the ledger, the history between two states, and this deployment's bounds.
 *
 * THE ROSTER AT THE BOTTOM IS THE POINT. The model bundles these under
 * `allInvariants`, and `test/domain/bundle.test.ts` holds the roster here
 * against the model's own text: an invariant added there and not here is a
 * failure rather than a silent gap. It is not a list a reader is asked to
 * trust.
 */

import { type Config } from "./config.ts";
import { releasedTicketBounded } from "./config.ts";
import { liveTickets, ticketAt } from "./ticketGraph.ts";
import { coveredSet, stuckSet, subsetOf } from "./derived.ts";
import type {
  LastDecision,
  Ticket,
  TicketGraph,
  TicketLedger,
} from "./generated/modelTypes.ts";
import { type TicketId } from "./ids.ts";
import { taskIdentityValid } from "./task.ts";
import { instanceEquals, instanceValid, stagesEqual } from "./evaluation.ts";
import { waitsOn } from "./enablement.ts";
import {
  artifactOf,
  evaluationSpawnTotal,
  ledgerInstances,
  liveTasks,
} from "./ticket.ts";
import {
  decisionValid,
  dependencyGraphAcyclic,
  graphInvariant,
} from "./decisionValid.ts";
import { evolve } from "./evolve.ts";
import {
  dependenciesEqual,
  graphEquals,
  releasedTicketEquals,
} from "./equality.ts";
import { isPending, isTerminal } from "./phase.ts";
import { ledgerAt, type Ledgers } from "./ledger.ts";

/**
 * What one invariant is evaluated against: the state and ledgers the last
 * decision found, that decision, and the state and ledgers now. A step that
 * decides nothing carries the first three unchanged.
 */
export interface StepView {
  readonly pre: TicketGraph;
  readonly preLedgers: Ledgers;
  readonly last: LastDecision;
  readonly post: TicketGraph;
  readonly postLedgers: Ledgers;
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

/** Every live ticket and its ledger satisfy this; a ticket without one fails. */
function everyLiveLedger(
  view: StepView,
  holds: (ticket: Ticket, ledger: TicketLedger, id: TicketId) => boolean,
): boolean {
  return liveTickets(view.post).every((id) => {
    const ledger = view.postLedgers.get(id);
    return ledger !== undefined && holds(ticketAt(view.post, id), ledger, id);
  });
}

/** The package's own invariant over the whole graph (`graphInvariant`). */
export const graphWellFormed: Invariant = (_config, view) =>
  graphInvariant(view.post);

/**
 * A ticket completes at most once, and holds a completion exactly while it is
 * Done. The count is the ledger's ghost, which is what makes a double-spend
 * visible rather than merely absent.
 */
export const completionExclusive: Invariant = (_config, view) =>
  everyLiveLedger(
    view,
    (t, l) =>
      l.completions <= 1 && (l.completions === 1) === (t.state === "Done"),
  );

/** A revoked ticket never completed on the way out. */
export const revokedNeverCompletes: Invariant = (_config, view) =>
  everyLiveLedger(view, (t, l) => t.state !== "Revoked" || l.completions === 0);

/** Nothing is Done without having produced the artifact its dependents read. */
export const artifactWellFormed: Invariant = (_config, view) =>
  everyLiveLedger(
    view,
    (t, l) => t.state !== "Done" || artifactOf(t, l) !== "NoArtifact",
  );

/** Terminal outcomes absorb: a ticket the last decision found Done or Revoked is still there. */
export const terminalsAbsorbing: Invariant = (_config, view) =>
  liveTickets(view.pre).every((id) => {
    const before = ticketAt(view.pre, id).state;
    if (!isTerminal(before)) return true;
    const after = view.post.tickets.get(id);
    return after !== undefined && after.state === before;
  });

/**
 * Every instance is well-formed by the protocol's own invariant, and agrees
 * with the ticket carrying it — this ticket, this plan, a cycle it has
 * started — and the instances, closed then open, stand in the order those
 * cycles ran. The open one's agreement with the state holding it is the
 * package's (`ticketInvariant`).
 */
export const evaluationsWellFormed: Invariant = (_config, view) =>
  everyLiveLedger(view, (t, l, id) => {
    const instances = ledgerInstances(t, l);
    return instances.every((instance, index) => {
      const previous = instances[index - 1];
      return (
        instanceValid(instance) &&
        instance.input.ticket === id &&
        stagesEqual(instance.plan.stages, t.definition.evaluationPlan.stages) &&
        instance.workCycle <= t.workCyclesStarted &&
        (previous === undefined || previous.workCycle < instance.workCycle)
      );
    });
  });

/**
 * History is append-only: against the ledgers the last decision found, every
 * instance a ticket had closed is still closed and still says what it said,
 * at the same place. So a rewritten judgement, a dropped instance and a
 * reordered history are each caught in the step that did it.
 */
export const evaluationsMonotone: Invariant = (_config, view) =>
  [...view.preLedgers.keys()].every((id) => {
    const after = view.postLedgers.get(id);
    if (after === undefined) return false;
    const before = ledgerAt(view.preLedgers, id).closedEvaluations;
    return (
      after.closedEvaluations.length >= before.length &&
      before.every((instance, index) => {
        const kept = after.closedEvaluations[index];
        return kept !== undefined && instanceEquals(instance, kept);
      })
    );
  });

/**
 * Identity accounting: the mint counter is one slot per work cycle started,
 * plus, for every run of every instance, its roster once per generation it
 * reached — the fold claiming from the RELEASED plan while this sum reads the
 * INSTANCES, so the two sides come from different places.
 */
export const idsAccounted: Invariant = (_config, view) =>
  everyLiveLedger(
    view,
    (t, l) =>
      l.spawned ===
      t.workCyclesStarted + evaluationSpawnTotal(ledgerInstances(t, l)),
  );

/** The contract's own predicate over every task the machine is waiting on. */
export const taskIdentitiesValid: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) => liveTasks(t).every(taskIdentityValid));

/**
 * The released definition is inside this deployment's bounds in every
 * reachable state; the package's `graphInvariant` holds the rest of it.
 * Holding everywhere is what makes the bound a refusal.
 */
export const definitionsWellFormed: Invariant = (config, view) =>
  everyLiveTicket(view.post, (t) =>
    releasedTicketBounded(config, t.definition),
  );

/**
 * A definition moves only with its revision: against the state the last
 * decision found, a ticket holds the definition and the revision it held, or
 * it was Pending, still is, and holds the next revision under the same
 * dependencies; a ticket the decision released is at the first.
 */
export const revisionsAccounted: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t, id) => {
    const before = view.pre.tickets.get(id);
    if (before === undefined) return t.revision === 1;
    const kept =
      releasedTicketEquals(t.definition, before.definition) &&
      t.revision === before.revision;
    const updated =
      isPending(before.state) &&
      isPending(t.state) &&
      t.revision === before.revision + 1 &&
      dependenciesEqual(
        t.definition.dependencies,
        before.definition.dependencies,
      );
    return kept || updated;
  });

/** The last decision is valid where it was taken (the package's `decisionValid`), and a refusal moved nothing. */
export const decisionsValid: Invariant = (_config, view) => {
  if (view.last === "NoDecision") return true;
  if (view.last.type === "Refused") {
    return (
      decisionValid(view.pre, {
        type: "TicketRefused",
        value: view.last.value,
      }) && graphEquals(view.post, view.pre)
    );
  }
  return decisionValid(view.pre, {
    type: "TicketDecided",
    value: view.last.value,
  });
};

/**
 * A decided event is never the identity: the event the machine decides at a
 * state moves that state. It is what lets a journal's legality check refuse
 * an inert row without refusing one the machine decided.
 */
export const eventsNeverIdentity: Invariant = (_config, view) =>
  view.last === "NoDecision" ||
  view.last.type !== "Decided" ||
  !graphEquals(evolve(view.pre, view.last.value.event), view.pre);

/** Dependencies name live tickets, and no ticket waits on itself through any chain. */
export const depsAcyclic: Invariant = (_config, view) => {
  const live = new Set<number>(liveTickets(view.post));
  return (
    liveTickets(view.post).every((id) =>
      [...waitsOn(view.post, id)].every((d) => live.has(d)),
    ) && dependencyGraphAcyclic(view.post)
  );
};

/**
 * Ids come from the universe a release draws from, the fleet stays within its
 * bound, and every released ticket has exactly one ledger.
 */
export const ticketIdsWellFormed: Invariant = (config, view) => {
  const universeCeiling = config.nTickets * 2;
  const live = liveTickets(view.post);
  return (
    live.every((id) => id >= 1 && id <= universeCeiling) &&
    live.length <= config.nTickets &&
    view.postLedgers.size === live.length &&
    live.every((id) => view.postLedgers.has(id))
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
  { invariant: "graphWellFormed", holds: graphWellFormed },
  { invariant: "completionExclusive", holds: completionExclusive },
  { invariant: "revokedNeverCompletes", holds: revokedNeverCompletes },
  { invariant: "artifactWellFormed", holds: artifactWellFormed },
  { invariant: "terminalsAbsorbing", holds: terminalsAbsorbing },
  { invariant: "evaluationsWellFormed", holds: evaluationsWellFormed },
  { invariant: "evaluationsMonotone", holds: evaluationsMonotone },
  { invariant: "idsAccounted", holds: idsAccounted },
  { invariant: "taskIdentitiesValid", holds: taskIdentitiesValid },
  { invariant: "definitionsWellFormed", holds: definitionsWellFormed },
  { invariant: "revisionsAccounted", holds: revisionsAccounted },
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
