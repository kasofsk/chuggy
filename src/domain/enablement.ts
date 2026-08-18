/**
 * When each action is allowed, as pure predicates over an explicit `Core`.
 *
 * THEY ARE HOISTED OUT OF THE ACTIONS FOR ONE REASON, and it is the reason
 * `model/domain.qnt` gives: the journaled actor's replay checker must re-check
 * a journaled decision's enablement at the *replayed prefix state*, which is a
 * `Core` and not whatever the live machine holds. A guard copied into a second
 * place drifts from the first, and then a driver's claim to have taken a
 * machine step outlives the machine's willingness to take it. So there is
 * exactly one definition of each, and the actor, the replayer and the
 * randomized layer all reference it.
 *
 * A DECIDER IS PARTIAL AND ITS GUARD IS OUT HERE. The deciders assume these
 * hold; running one on a state that refuses it is a lookup error rather than a
 * boolean. A decider that re-derived its own enablement would be exactly the
 * copied guard this arrangement exists to prevent.
 */

import type { Config } from "./config.ts";
import { ticketAt, ticketIds, type Core } from "./core.ts";
import type { Resume } from "./desk.ts";
import { firstTaskId, asTaskId, type TaskId, type TicketId } from "./ids.ts";
import { assertNever } from "./assertNever.ts";
import { nextTaskId, outstandingCount } from "./task.ts";
import type { ArtifactMark } from "./wrapUp.ts";
import type { Ticket } from "./ticket.ts";

/** Every phase but the two absorbing terminals may be revoked. */
export function revocableIn(core: Core, id: TicketId): boolean {
  const phase = ticketAt(core, id).phase;
  return phase !== "PDone" && phase !== "PRevoked";
}

/**
 * What one resume costs, by flavor. The pre-work resume is free under both
 * meterings because nothing was ever spent; entry to Working always meters.
 */
export function resumeCharge(config: Config, at: Resume): number {
  switch (at) {
    case "RPending":
      return 0;
    case "RWorking":
      return 1;
    case "RNone":
    case "REvaluating":
    case "RWrapUp":
      return config.opRetryPricing === "RetryCharged" ? 1 : 0;
    default:
      return assertNever(at);
  }
}

/**
 * May the operator retry this parked ticket? A resume must exist and be
 * affordable, which the cascade wall's has not — its only modeled exit is a
 * revoke.
 */
export function retryableIn(config: Config, core: Core, id: TicketId): boolean {
  const ticket = ticketAt(core, id);
  return (
    ticket.phase === "PEscalated" &&
    ticket.resumeAt !== "RNone" &&
    resumeCharge(config, ticket.resumeAt) <= ticket.gasLeft
  );
}

/**
 * What a ticket waits on before it may run. One definition, read by the
 * readiness check, the deadlock check and the cross-ticket artifact read
 * alike, because a derived waiting relation diverging from the stored field is
 * the defect that made it one definition.
 */
export function waitsOn(core: Core, id: TicketId): readonly TicketId[] {
  return ticketAt(core, id).deps;
}

/** What this ticket's dependencies produced. Stable: every dep is Done, and Done is absorbing. */
export function depArtifacts(
  core: Core,
  id: TicketId,
): readonly ArtifactMark[] {
  return waitsOn(core, id).map((d) => ticketAt(core, d).artifact);
}

/** Every dependency Done. Location-blind: Done-ness, never project. */
export function depsDoneIn(core: Core, id: TicketId): boolean {
  return waitsOn(core, id).every((d) => ticketAt(core, d).phase === "PDone");
}

/** Room for one more arrival. */
export function canArriveIn(config: Config, core: Core): boolean {
  return core.tickets.size < config.nTickets;
}

/** Tickets a new arrival may depend on: no tombstones, and nothing already doomed behind one. */
export function dependableIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((id) => {
    const ticket = ticketAt(core, id);
    return (
      ticket.phase !== "PRevoked" &&
      !(
        ticket.phase === "PEscalated" && ticket.reason === "RsDependencyRevoked"
      )
    );
  });
}

/**
 * An arrival's dependencies name distinct tickets. The model draws them from a
 * powerset and the decision-event payload carries that set, so this is what refuses a
 * repeat where an array still carries the draw — off the wire, and in a drawn
 * trace.
 */
export function depsDistinct(deps: readonly TicketId[]): boolean {
  return new Set(deps).size === deps.length;
}

/** The only authoring phase, hence the only releasable set. */
export function draftsIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((id) => ticketAt(core, id).phase === "PDraft");
}

/** Every non-terminal may be revoked. */
export function revocablesIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((id) => revocableIn(core, id));
}

/** Released and unblocked. */
export function isReadyIn(core: Core, id: TicketId): boolean {
  return ticketAt(core, id).phase === "PPending" && depsDoneIn(core, id);
}

/** Released and waiting on something. */
export function isBlockedIn(core: Core, id: TicketId): boolean {
  return ticketAt(core, id).phase === "PPending" && !depsDoneIn(core, id);
}

/** The derived Ready room. */
export function readiesIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((id) => isReadyIn(core, id));
}

/** Tickets whose task set can receive completion events. */
export function taskPhaseIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((id) => {
    const phase = ticketAt(core, id).phase;
    return phase === "PWorking" || phase === "PEvaluating";
  });
}

/** Working tickets whose set is fully resolved. */
export function reducibleWorkIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((id) => {
    const ticket = ticketAt(core, id);
    return ticket.phase === "PWorking" && outstandingCount(ticket.tasks) === 0;
  });
}

/** Evaluating tickets whose stage is fully resolved. */
export function reducibleEvalIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((id) => {
    const ticket = ticketAt(core, id);
    return (
      ticket.phase === "PEvaluating" && outstandingCount(ticket.tasks) === 0
    );
  });
}

/** The occupied gate slots. */
export function holdingIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter(
    (id) => ticketAt(core, id).phase === "PWrapUpHolding",
  );
}

/** The completed tickets. */
export function doneIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((id) => ticketAt(core, id).phase === "PDone");
}

/** Parked tickets the operator may retry. */
export function retryablesIn(config: Config, core: Core): readonly TicketId[] {
  return ticketIds(core).filter((id) => retryableIn(config, core, id));
}

/**
 * May the dispatcher launch this ticket? Ready, with gas to charge — a
 * conjunct structurally implied for a Pending ticket and stated anyway, so the
 * enablement is one predicate rather than one predicate and a fact.
 */
export function dispatchableIn(core: Core, id: TicketId): boolean {
  return isReadyIn(core, id) && ticketAt(core, id).gasLeft > 0;
}

/** The delivery range an at-least-once fabric may name: every id this ticket ever issued. */
export function deliverableTaskIds(
  core: Core,
  id: TicketId,
): readonly TaskId[] {
  const ticket = ticketAt(core, id);
  const last = nextTaskId(ticket.record.length, ticket.tasks.length) - 1;
  const ids: TaskId[] = [];
  for (let t = firstTaskId; t <= last; t++) ids.push(asTaskId(t));
  return ids;
}

/**
 * The resource this ticket's wrap-up needs, where a kind that needs none
 * answers a value no resource universe contains — so it can never collide with
 * a real holder.
 */
export function leaseOf(ticket: Ticket): number {
  return ticket.wrapUp.wrapUp === "WNone" ? 0 : ticket.wrapUp.resource;
}

/**
 * Is this resource unheld? Occupancy is derived from phase, which is the whole
 * point of the holding phase: every exit releases the lease, so nothing cleans
 * up.
 */
export function leaseFreeIn(core: Core, resource: number): boolean {
  return ticketIds(core).every((id) => {
    const ticket = ticketAt(core, id);
    return !(ticket.phase === "PWrapUpHolding" && leaseOf(ticket) === resource);
  });
}

/** May this ticket be dequeued? Enqueued, and its project's gate free — the depth-one refusal. */
export function wrapUpStartableIn(core: Core, id: TicketId): boolean {
  const ticket = ticketAt(core, id);
  return ticket.phase === "PWrapUp" && leaseFreeIn(core, leaseOf(ticket));
}

/** Enqueued tickets whose gate is free. */
export function wrapUpStartablesIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((id) => wrapUpStartableIn(core, id));
}

/** The outcomes the environment may draw, given its invalidation choice for this attempt. */
export function wrapUpOutcomes(
  invalidated: boolean,
): readonly ("WOk" | "WFailed")[] {
  return invalidated ? ["WOk", "WFailed"] : ["WOk"];
}

/**
 * When the stutter is all that is left: the fleet is fully arrived and every
 * ticket is settled in a terminal. The model's `settle` action is guarded by
 * exactly this, so a run over a quiesced fleet stutters instead of deadlocking.
 */
export function quietIn(config: Config, core: Core): boolean {
  return (
    !canArriveIn(config, core) &&
    ticketIds(core).every((id) => {
      const phase = ticketAt(core, id).phase;
      return phase === "PDone" || phase === "PRevoked";
    })
  );
}
