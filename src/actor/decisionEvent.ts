/**
 * The decision events: what a journal entry records having decided, and the
 * two total tables that say what each one means.
 *
 * A DECISION EVENT IS A FACT, NOT AN INSTRUCTION. It names a choice already
 * made at the writer's serialization point — which ticket the selector
 * proposed, what a task came back with — so replaying one re-decides nothing
 * and consults nobody. That is what makes the journal a sufficient basis for
 * recovery.
 *
 * THE TWO TABLES MOVE TOGETHER. `execDecisionEvent` routes an event onto its
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
import { ticketAt, type Decision } from "../domain/ticketGraph.ts";
import {
  decideDispatch,
  decideFinalizationResult,
  decideReleaseTicket,
  decideResumeTicket,
  decideRevoke,
  decideTaskDone,
  decideWorkReduce,
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
  reducibleWorkIn,
  releasableAuthoring,
  retryablesIn,
  revocablesIn,
} from "../domain/enablement.ts";
import { dispositionChoices } from "../domain/deciders.ts";
import type {
  TicketGraph,
  DecisionEvent,
  EvaluationFailureDisposition,
  FinalizationOutcome,
  StageDefinition,
  TaskIdentity,
  TaskTerminalReport,
} from "../domain/generated/modelTypes.ts";
import { reportMatchesTask, reportValid } from "../domain/ticket.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";

export { decisionEventTags } from "../domain/generated/modelTypes.ts";
export type { DecisionEvent };

/** What a release freezes onto the ticket, every value of it behaviour-affecting. */
export interface ReleaseAuthoring {
  readonly deps: ReadonlySet<number>;
  readonly prog: readonly StageDefinition[];
}

export function releaseTicketEvent(
  ticket: TicketId,
  authoring: ReleaseAuthoring,
): DecisionEvent {
  return { type: "CreateTicket", value: { ticket, ...authoring } };
}

/** Extracts the frozen authoring contract from a release fact. */
export function releaseAuthoringOf(event: DecisionEvent): ReleaseAuthoring {
  if (event.type !== "CreateTicket")
    throw new TypeError("decision event is not a ticket release");
  return { deps: event.value.deps, prog: event.value.prog };
}

export function revokeEvent(ticket: TicketId): DecisionEvent {
  return { type: "Revoke", value: ticket };
}

export function dispatchEvent(ticket: TicketId): DecisionEvent {
  return { type: "Dispatch", value: ticket };
}

/**
 * The completion carries WHAT THE TASK CAME BACK WITH, and the disposition a
 * failing stage would be taken on. The disposition rides here because a
 * completion can be the step that concludes a failed stage, and the journal
 * records the picks the actor made: a replay that re-drew it would re-decide
 * the step rather than re-perform it.
 */
export function taskDoneEvent(
  ticket: TicketId,
  task: TaskIdentity,
  report: TaskTerminalReport,
  onFailure: EvaluationFailureDisposition,
): DecisionEvent {
  return { type: "TaskDone", value: { ticket, task, report, onFailure } };
}

export function workReduceEvent(ticket: TicketId): DecisionEvent {
  return { type: "WorkReduce", value: ticket };
}

export function finalizationResultEvent(
  ticket: TicketId,
  out: FinalizationOutcome,
): DecisionEvent {
  return { type: "FinalizationResult", value: { ticket, out } };
}

export function resumeTicketEvent(ticket: TicketId): DecisionEvent {
  return { type: "ResumeTicket", value: ticket };
}

/** Total dispatch onto the pure deciders — THE actor's decide step, and nothing else's. */
export function execDecisionEvent(
  graph: TicketGraph,
  event: DecisionEvent,
): Decision {
  switch (event.type) {
    case "CreateTicket": {
      const { ticket, ...authoring } = event.value;
      return decideReleaseTicket(graph, asTicketId(ticket), {
        deps: authoring.deps,
        program: authoring.prog,
      });
    }
    case "Revoke":
      return decideRevoke(graph, asTicketId(event.value));
    case "Dispatch":
      return decideDispatch(graph, asTicketId(event.value));
    case "TaskDone":
      return decideTaskDone(
        graph,
        asTicketId(event.value.ticket),
        event.value.task,
        event.value.report,
        event.value.onFailure,
      );
    case "WorkReduce":
      return decideWorkReduce(graph, asTicketId(event.value));
    case "FinalizationResult":
      return decideFinalizationResult(
        graph,
        asTicketId(event.value.ticket),
        event.value.out,
      );
    case "ResumeTicket":
      return decideResumeTicket(graph, asTicketId(event.value));
  }
}

/** The same enablement the machine's own actions carry, re-checked at a replayed state. */
export function decisionEventEnabled(
  config: Config,
  graph: TicketGraph,
  event: DecisionEvent,
): boolean {
  switch (event.type) {
    case "CreateTicket": {
      const value = event.value;
      const id = asTicketId(value.ticket);
      const dependable = new Set<number>(dependableIn(graph));
      return (
        canReleaseIn(config, graph, id) &&
        [...value.deps].every((d) => dependable.has(d)) &&
        releasableAuthoring(config, value)
      );
    }
    case "Revoke":
      return revocablesIn(graph).includes(asTicketId(event.value));
    case "Dispatch":
      return readiesIn(graph).includes(asTicketId(event.value));
    case "TaskDone": {
      const id = asTicketId(event.value.ticket);
      return (
        completableIn(graph).includes(id) &&
        outstandingTaskIn(graph, id, event.value.task) &&
        reportMatchesTask(event.value.task, event.value.report) &&
        reportValid(event.value.report) &&
        dispositionChoices.includes(event.value.onFailure)
      );
    }
    case "WorkReduce":
      return reducibleWorkIn(graph).includes(asTicketId(event.value));
    case "FinalizationResult": {
      const id = asTicketId(event.value.ticket);
      return (
        finalizableIn(graph, id) &&
        finalizationOutcomes.includes(event.value.out) &&
        finalizationOutcomeEnabled(graph, id, event.value.out)
      );
    }
    case "ResumeTicket":
      return retryablesIn(graph).includes(asTicketId(event.value));
  }
}

/** The ticket a decision event is about, which every journal reader needs and no arm hides. */
export function decisionEventSubject(event: DecisionEvent): TicketId {
  switch (event.type) {
    case "CreateTicket":
    case "TaskDone":
    case "FinalizationResult":
      return asTicketId(event.value.ticket);
    case "Revoke":
    case "Dispatch":
    case "WorkReduce":
    case "ResumeTicket":
      return asTicketId(event.value);
  }
}

/** Tickets already Done, which a reader needs to spot a redelivered completion. */
export { doneIn, ticketAt };
