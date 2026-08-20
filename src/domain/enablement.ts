/**
 * What the machine will accept, as pure predicates over an observed `Core`.
 *
 * EVERY GUARD IS STATED ONCE AND REFERENCED. The model hoisted these out of
 * its actions for a reason worth repeating here: a guard copied into a second
 * caller drifts silently, and the copy keeps claiming the machine accepts a
 * step the machine now refuses. So the replay checker, the deciders' callers
 * and the suites all read these, and none restates one.
 *
 * They are parameterised by a `Core` rather than reading ambient state,
 * because the journaled actor must re-check enablement at a REPLAYED prefix
 * state — a value, not a live variable.
 */

import {
  finalizationPricingChoices,
  finalizerChoices,
  isValidProgram,
  resumePricingChoices,
  reworkPolicyChoices,
  ticketIdUniverse,
  workFanoutChoices,
  type Config,
} from "./config.ts";
import { ticketAt, ticketIds } from "./core.ts";
import type {
  ArtifactMark,
  Core,
  FinalizationOutcome,
  FinalizationPricing,
  Finalizer,
  Reason,
  Resume,
  RetryPricing,
  ReworkPolicy,
  Stage,
  Ticket,
} from "./generated/modelTypes.ts";
import type { TicketId } from "./ids.ts";
import { reworkBudget } from "./pricing.ts";
import { outstandingCount } from "./task.ts";

/** Anything not settled and not past the point of no return. */
export function revocableIn(core: Core, id: TicketId): boolean {
  const phase = ticketAt(core, id).phase;
  return phase !== "Done" && phase !== "Revoked" && phase !== "Finalizing";
}

/**
 * What a resume costs. Re-entering Working always meters, because that is the
 * account that makes the graph valid at all; every other resume is priced by
 * the ticket's own authored policy.
 */
export function resumeCharge(ticket: Ticket, at: Resume): number {
  if (at === "ResumeWorking") return 1;
  return ticket.resumePricing === "RetryCharged" ? 1 : 0;
}

/** A parked ticket with a modeled resume, and the gas to pay for it. */
export function retryableIn(core: Core, id: TicketId): boolean {
  const ticket = ticketAt(core, id);
  return (
    ticket.phase === "Escalated" &&
    ticket.resumeAt !== "NoResume" &&
    resumeCharge(ticket, ticket.resumeAt) <= ticket.gasLeft
  );
}

/** What this ticket waits on before it may run — the single definition every reader shares. */
export function waitsOn(core: Core, id: TicketId): ReadonlySet<number> {
  return ticketAt(core, id).deps;
}

/**
 * What this ticket's dependencies produced. Derived, never stored, and stable:
 * every dep is Done before a dependent can dispatch, and Done is absorbing, so
 * nothing here can change under a reader.
 */
export function depArtifacts(
  core: Core,
  id: TicketId,
): readonly ArtifactMark[] {
  return [...waitsOn(core, id)]
    .sort((a, b) => a - b)
    .map((d) => ticketAt(core, d as TicketId).artifact);
}

export function depsDoneIn(core: Core, id: TicketId): boolean {
  return [...waitsOn(core, id)].every(
    (k) => ticketAt(core, k as TicketId).phase === "Done",
  );
}

/**
 * May this id be claimed? The fleet has room, the id is one the universe
 * offers, and nothing holds it — including a ticket long since settled, since
 * an id is never reused.
 */
export function canReleaseIn(
  config: Config,
  core: Core,
  id: TicketId,
): boolean {
  return (
    core.tickets.size < config.nTickets &&
    ticketIdUniverse(config).includes(id) &&
    !core.tickets.has(id)
  );
}

/**
 * What a release may depend on: anything not revoked, and not already parked
 * by a revoked dependency. Both can never reach Done, so depending on one is
 * authoring a ticket that can never run.
 */
export function dependableIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((k) => {
    const ticket = ticketAt(core, k);
    return (
      ticket.phase !== "Revoked" &&
      !(ticket.phase === "Escalated" && ticket.reason === "DependencyRevoked")
    );
  });
}

export function revocablesIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((j) => revocableIn(core, j));
}

export function readiesIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((j) => isReadyIn(core, j));
}

/** The two phases that hold a live task set, and so may take a completion. */
export function taskPhaseIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((j) => {
    const phase = ticketAt(core, j).phase;
    return phase === "Working" || phase === "Evaluating";
  });
}

export function reducibleWorkIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((j) => {
    const ticket = ticketAt(core, j);
    return ticket.phase === "Working" && outstandingCount(ticket.tasks) === 0;
  });
}

export function reducibleEvalIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((j) => {
    const ticket = ticketAt(core, j);
    return (
      ticket.phase === "Evaluating" && outstandingCount(ticket.tasks) === 0
    );
  });
}

export function doneIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((j) => ticketAt(core, j).phase === "Done");
}

export function retryablesIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter((j) => retryableIn(core, j));
}

/** The derived waiting room: released, with every dependency Done. */
export function isReadyIn(core: Core, id: TicketId): boolean {
  return ticketAt(core, id).phase === "Pending" && depsDoneIn(core, id);
}

export function isBlockedIn(core: Core, id: TicketId): boolean {
  return ticketAt(core, id).phase === "Pending" && !depsDoneIn(core, id);
}

/**
 * May the ticket writer dispatch this ticket? Ready, with gas to charge, since entry
 * to Working always meters — a Pending ticket has never spent gas, so the
 * second conjunct is implied and is stated so the enablement is one predicate.
 */
export function dispatchableIn(core: Core, id: TicketId): boolean {
  return isReadyIn(core, id) && ticketAt(core, id).gasLeft > 0;
}

/** The phase that holds the finalizer obligation, and so may take its result. */
export function finalizableIn(core: Core, id: TicketId): boolean {
  return core.tickets.has(id) && ticketAt(core, id).phase === "Finalizing";
}

/** Both results the finalizer service may report. */
export const finalizationOutcomes: readonly FinalizationOutcome[] = [
  "FinalizationSucceeded",
  "FinalizationFailed",
];

/**
 * The reasons infrastructure may refuse to run an intact contract. They are a
 * closed set because a blocked execution is not failed work: it consumes no
 * evaluation or rework budget, so anything that could arrive here has to be
 * something the desk can act on.
 */
export const executionBlockedReasons: readonly Reason[] = [
  "ExecutionPolicyDenied",
  "TicketConfigIncompatible",
  "ExecutionProfileUnavailable",
  "RuntimeVersionUnsupported",
  "RequiredCapabilityUnavailable",
];

/** Whether a live task of this ticket is still outstanding under the named id. */
export function outstandingTaskIn(
  core: Core,
  id: TicketId,
  taskId: number,
): boolean {
  return [...ticketAt(core, id).tasks].some(
    (t) => t.id === taskId && t.state === "Outstanding",
  );
}

/** Every value a release must draw from a universe, checked together. */
export function releasableAuthoring(
  config: Config,
  authoring: {
    readonly prog: readonly Stage[];
    readonly workFanout: number;
    readonly reworkPolicy: ReworkPolicy;
    readonly finalizationPricing: FinalizationPricing;
    readonly resumePricing: RetryPricing;
    readonly finalizer: Finalizer;
  },
): boolean {
  return (
    isValidProgram(config, authoring.prog) &&
    workFanoutChoices(config).includes(authoring.workFanout) &&
    reworkPolicyChoices(config).some(
      (p) => reworkBudget(p) === reworkBudget(authoring.reworkPolicy),
    ) &&
    finalizationPricingChoices(config).some((p) =>
      pricingEquals(p, authoring.finalizationPricing),
    ) &&
    resumePricingChoices.includes(authoring.resumePricing) &&
    finalizerChoices.includes(authoring.finalizer)
  );
}

/** Structural equality on a pricing, since one branch carries a budget and the other does not. */
function pricingEquals(
  left: FinalizationPricing,
  right: FinalizationPricing,
): boolean {
  if (left === "DeadlineOnly") return right === "DeadlineOnly";
  return right !== "DeadlineOnly" && right.value === left.value;
}

/** The ids a release may still claim, which is what makes a fleet quiet or not. */
export function releasableIdsIn(
  config: Config,
  core: Core,
): readonly TicketId[] {
  if (core.tickets.size >= config.nTickets) return [];
  return ticketIdUniverse(config).filter((j) => !core.tickets.has(j));
}

/** Tickets running their finalizer, which is the phase a result may be reported for. */
export function finalizingIn(core: Core): readonly TicketId[] {
  return ticketIds(core).filter(
    (j) => ticketAt(core, j).phase === "Finalizing",
  );
}

/**
 * A fleet nothing can move: no id left to release, and every ticket settled at
 * a terminal. It is the stutter's guard, so a run that reaches it records that
 * it did rather than deadlocking.
 */
export function quietIn(config: Config, core: Core): boolean {
  return (
    releasableIdsIn(config, core).length === 0 &&
    ticketIds(core).every((j) => {
      const phase = ticketAt(core, j).phase;
      return phase === "Done" || phase === "Revoked";
    })
  );
}

/** The task ids of this ticket the fabric could still report on. */
export function outstandingTaskIdsIn(
  core: Core,
  id: TicketId,
): readonly number[] {
  return [...ticketAt(core, id).tasks]
    .filter((t) => t.state === "Outstanding")
    .map((t) => t.id)
    .sort((a, b) => a - b);
}
