/**
 * The decision events: what the actor is asked to decide, and the two total
 * tables that say what each one means.
 *
 * A DECISION EVENT IS THE DECIDER'S INPUT, NOT THE JOURNAL'S ROW. It names a
 * choice already made at the writer's serialization point — which ticket the
 * selector proposed, what a task came back with — and `decide` turns it into
 * the `TicketEvent` the journal keeps, so replay folds `evolve` over events
 * and never consults a decider or a policy.
 *
 * THE TWO TABLES MOVE TOGETHER. `decide` routes a decision event onto its
 * decider and `decisionEventEnabled` says whether the machine would accept it
 * there; a constructor added to one and not the other is a compile error,
 * which is the only reason they are written as exhaustive switches rather than
 * lookups.
 *
 * The guards are referenced, never restated. Every arm below reads
 * `src/domain/enablement.ts`, which is the same definition the deciders' own
 * callers read, because a copied guard drifts and the copy keeps claiming the
 * machine accepts a step it now refuses.
 */

import type { Config } from "../domain/config.ts";
import { ticketAt } from "../domain/ticketGraph.ts";
import {
  decideDispatch,
  decideFinalizationResult,
  decideReleaseTicket,
  decideResumeTicket,
  decideRevoke,
  decideTaskDone,
  type EvaluationFailurePolicy,
} from "../domain/deciders.ts";
import {
  canReleaseIn,
  completableIn,
  dependableIn,
  doneIn,
  finalizableIn,
  finalizationOutcomeEnabled,
  finalizationOutcomes,
  outstandingTaskIn,
  readiesIn,
  retryablesIn,
  revocablesIn,
} from "../domain/enablement.ts";
import { releasedTicketValid } from "../domain/config.ts";
import type {
  TicketGraph,
  DecisionEvent,
  FinalizationOutcome,
  ReleasedTicket,
  SuccessfulTicketDecision,
  TaskIdentity,
  TaskTerminalReport,
} from "../domain/generated/modelTypes.ts";
import { reportMatchesTask, reportValid } from "../domain/ticket.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";

export { decisionEventTags } from "../domain/generated/modelTypes.ts";
export type { DecisionEvent };

/**
 * A release freezes the whole definition onto the ticket, and the ticket it
 * names is the `id` inside it: the payload and the graph's key cannot
 * disagree, so neither the event nor its readers carry a second ticket field.
 */
export function releaseTicketEvent(definition: ReleasedTicket): DecisionEvent {
  return { type: "CreateTicket", value: definition };
}

/** Extracts the frozen definition from a release. */
export function releasedTicketOf(event: DecisionEvent): ReleasedTicket {
  if (event.type !== "CreateTicket")
    throw new TypeError("decision event is not a ticket release");
  return event.value;
}

export function revokeEvent(ticket: TicketId): DecisionEvent {
  return { type: "Revoke", value: ticket };
}

/**
 * The dispatch carries the source it observed: the one edge that looks at what
 * the ticket's repository is at, so the observation is the actor's pick.
 */
export function dispatchEvent(ticket: TicketId, source: number): DecisionEvent {
  return { type: "Dispatch", value: { ticket, source } };
}

/** The completion carries what the task came back with; the failure policy is the decide step's own argument. */
export function taskDoneEvent(
  ticket: TicketId,
  task: TaskIdentity,
  report: TaskTerminalReport,
): DecisionEvent {
  return { type: "TaskDone", value: { ticket, task, report } };
}

/** The finalizer's report carries its outcome and the evidence it returned. */
export function finalizationResultEvent(
  ticket: TicketId,
  out: FinalizationOutcome,
  evidence: number,
): DecisionEvent {
  return { type: "FinalizationResult", value: { ticket, out, evidence } };
}

export function resumeTicketEvent(ticket: TicketId): DecisionEvent {
  return { type: "ResumeTicket", value: ticket };
}

/**
 * Total dispatch onto the pure deciders — THE actor's decide step. The policy
 * is asked only by a completion that concludes a failing stage, and the event
 * returned names the edge taken, so nothing after this asks it again.
 */
export function decide(
  graph: TicketGraph,
  event: DecisionEvent,
  failurePolicy: EvaluationFailurePolicy,
): SuccessfulTicketDecision {
  switch (event.type) {
    case "CreateTicket":
      return decideReleaseTicket(graph, event.value);
    case "Revoke":
      return decideRevoke(graph, asTicketId(event.value));
    case "Dispatch":
      return decideDispatch(
        graph,
        asTicketId(event.value.ticket),
        event.value.source,
      );
    case "TaskDone":
      return decideTaskDone(
        graph,
        asTicketId(event.value.ticket),
        event.value.task,
        event.value.report,
        failurePolicy,
      );
    case "FinalizationResult":
      return decideFinalizationResult(
        graph,
        asTicketId(event.value.ticket),
        event.value.out,
        event.value.evidence,
      );
    case "ResumeTicket":
      return decideResumeTicket(graph, asTicketId(event.value));
  }
}

/** The same enablement the machine's own actions carry, checked at the state the actor holds. */
export function decisionEventEnabled(
  config: Config,
  graph: TicketGraph,
  event: DecisionEvent,
): boolean {
  switch (event.type) {
    case "CreateTicket": {
      const definition = event.value;
      const dependable = new Set<number>(dependableIn(graph));
      return (
        canReleaseIn(config, graph, asTicketId(definition.id)) &&
        [...definition.dependencies].every((d) => dependable.has(d)) &&
        releasedTicketValid(config, definition)
      );
    }
    case "Revoke":
      return revocablesIn(graph).includes(asTicketId(event.value));
    case "Dispatch":
      /**
       * The model draws a source from a two-element set because that is the
       * universe one instantiation offers; what it claims of the value is
       * `sourcePinned`'s floor, which is what a deployment folding a commit
       * digest can hold to.
       */
      return (
        readiesIn(graph).includes(asTicketId(event.value.ticket)) &&
        event.value.source > 0
      );
    case "TaskDone": {
      const id = asTicketId(event.value.ticket);
      return (
        completableIn(graph).includes(id) &&
        outstandingTaskIn(graph, id, event.value.task) &&
        reportMatchesTask(
          ticketAt(graph, id),
          event.value.task,
          event.value.report,
        ) &&
        reportValid(event.value.report)
      );
    }
    case "FinalizationResult": {
      const id = asTicketId(event.value.ticket);
      /** The evidence is held to the floor every opaque reference is, for the reason a dispatch's source is. */
      return (
        finalizableIn(graph, id) &&
        finalizationOutcomes.includes(event.value.out) &&
        event.value.evidence > 0 &&
        finalizationOutcomeEnabled(graph, id, event.value.out)
      );
    }
    case "ResumeTicket":
      return retryablesIn(graph).includes(asTicketId(event.value));
  }
}

/** The ticket a decision event is about, which every reader needs and no arm hides. */
export function decisionEventSubject(event: DecisionEvent): TicketId {
  switch (event.type) {
    case "CreateTicket":
      return asTicketId(event.value.id);
    case "TaskDone":
    case "FinalizationResult":
    case "Dispatch":
      return asTicketId(event.value.ticket);
    case "Revoke":
    case "ResumeTicket":
      return asTicketId(event.value);
  }
}

/** Tickets already Done, which a reader needs to spot a redelivered completion. */
export { doneIn, ticketAt };
