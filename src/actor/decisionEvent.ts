/**
 * The decision events: what a journal entry records having decided, and the
 * two total tables that say what each one means.
 *
 * A DECISION EVENT IS A FACT, NOT AN INSTRUCTION. It names a choice already
 * made at the writer's serialization point — which ticket the dispatcher
 * picked, which verdict a task reported — so replaying one re-decides nothing
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
import { ticketAt, type Decision } from "../domain/core.ts";
import {
  decideDispatch,
  decideEvalStageReduce,
  decideExecutionBlocked,
  decideFinalizationResult,
  decideReleaseTicket,
  decideResumeTicket,
  decideRevoke,
  decideTaskDone,
  decideWorkReduce,
} from "../domain/deciders.ts";
import {
  canReleaseIn,
  dependableIn,
  doneIn,
  executionBlockedReasons,
  finalizableIn,
  finalizationOutcomes,
  outstandingTaskIn,
  readiesIn,
  reducibleEvalIn,
  reducibleWorkIn,
  releasableAuthoring,
  retryablesIn,
  revocablesIn,
  taskPhaseIn,
  dispatchableIn,
} from "../domain/enablement.ts";
import type {
  Core,
  DecisionEvent,
  FinalizationOutcome,
  Finalizer,
  FinalizationPricing,
  Reason,
  RetryPricing,
  ReworkPolicy,
  Stage,
  TaskResultRef,
  Verdict,
} from "../domain/generated/modelTypes.ts";
import { asTicketId, type TaskId, type TicketId } from "../domain/ids.ts";

export { decisionEventTags } from "../domain/generated/modelTypes.ts";
export type { DecisionEvent };

/** What a release freezes onto the ticket, every value of it behaviour-affecting. */
export interface ReleaseAuthoring {
  readonly deps: ReadonlySet<number>;
  readonly prog: readonly Stage[];
  readonly workFanout: number;
  readonly reworkPolicy: ReworkPolicy;
  readonly finalizationPricing: FinalizationPricing;
  readonly resumePricing: RetryPricing;
  readonly finalizer: Finalizer;
}

export function releaseTicketEvent(
  ticket: TicketId,
  authoring: ReleaseAuthoring,
): DecisionEvent {
  return { type: "ReleaseTicket", value: { ticket, ...authoring } };
}

export function revokeEvent(ticket: TicketId): DecisionEvent {
  return { type: "Revoke", value: ticket };
}

export function dispatchEvent(ticket: TicketId): DecisionEvent {
  return { type: "Dispatch", value: ticket };
}

export function taskDoneEvent(
  ticket: TicketId,
  tid: TaskId,
  verdict: Verdict,
  result: TaskResultRef,
): DecisionEvent {
  return { type: "TaskDone", value: { ticket, tid, verdict, result } };
}

export function workReduceEvent(ticket: TicketId): DecisionEvent {
  return { type: "WorkReduce", value: ticket };
}

export function evalReduceEvent(ticket: TicketId): DecisionEvent {
  return { type: "EvalReduce", value: ticket };
}

export function finalizationResultEvent(
  ticket: TicketId,
  out: FinalizationOutcome,
): DecisionEvent {
  return { type: "FinalizationResult", value: { ticket, out } };
}

export function executionBlockedEvent(
  ticket: TicketId,
  reason: Reason,
): DecisionEvent {
  return { type: "ExecutionBlocked", value: { ticket, reason } };
}

export function resumeTicketEvent(ticket: TicketId): DecisionEvent {
  return { type: "ResumeTicket", value: ticket };
}

/** Total dispatch onto the pure deciders — THE actor's decide step, and nothing else's. */
export function execDecisionEvent(
  config: Config,
  core: Core,
  event: DecisionEvent,
): Decision {
  switch (event.type) {
    case "ReleaseTicket": {
      const { ticket, ...authoring } = event.value;
      return decideReleaseTicket(config, core, asTicketId(ticket), {
        deps: authoring.deps,
        program: authoring.prog,
        workFanout: authoring.workFanout,
        reworkPolicy: authoring.reworkPolicy,
        finalizationPricing: authoring.finalizationPricing,
        resumePricing: authoring.resumePricing,
        finalizer: authoring.finalizer,
      });
    }
    case "Revoke":
      return decideRevoke(config, core, asTicketId(event.value));
    case "Dispatch":
      return decideDispatch(core, asTicketId(event.value));
    case "TaskDone":
      return decideTaskDone(
        core,
        asTicketId(event.value.ticket),
        event.value.tid as TaskId,
        event.value.verdict,
      );
    case "WorkReduce":
      return decideWorkReduce(core, asTicketId(event.value));
    case "EvalReduce":
      return decideEvalStageReduce(core, asTicketId(event.value));
    case "FinalizationResult":
      return decideFinalizationResult(
        core,
        asTicketId(event.value.ticket),
        event.value.out,
      );
    case "ExecutionBlocked":
      return decideExecutionBlocked(
        core,
        asTicketId(event.value.ticket),
        event.value.reason,
      );
    case "ResumeTicket":
      return decideResumeTicket(core, asTicketId(event.value));
  }
}

/** The same enablement the machine's own actions carry, re-checked at a replayed state. */
export function decisionEventEnabled(
  config: Config,
  core: Core,
  event: DecisionEvent,
): boolean {
  switch (event.type) {
    case "ReleaseTicket": {
      const value = event.value;
      const id = asTicketId(value.ticket);
      const dependable = new Set<number>(dependableIn(core));
      return (
        canReleaseIn(config, core, id) &&
        [...value.deps].every((d) => dependable.has(d)) &&
        releasableAuthoring(config, value)
      );
    }
    case "Revoke":
      return revocablesIn(core).includes(asTicketId(event.value));
    case "Dispatch": {
      const id = asTicketId(event.value);
      return readiesIn(core).includes(id) && dispatchableIn(core, id);
    }
    case "TaskDone": {
      const id = asTicketId(event.value.ticket);
      return (
        taskPhaseIn(core).includes(id) &&
        event.value.result.manifest >= 1 &&
        event.value.result.digest >= 1 &&
        event.value.result.schema >= 1 &&
        outstandingTaskIn(core, id, event.value.tid)
      );
    }
    case "WorkReduce":
      return reducibleWorkIn(core).includes(asTicketId(event.value));
    case "EvalReduce":
      return reducibleEvalIn(core).includes(asTicketId(event.value));
    case "FinalizationResult": {
      const id = asTicketId(event.value.ticket);
      return (
        finalizableIn(core, id) &&
        finalizationOutcomes.includes(event.value.out)
      );
    }
    case "ExecutionBlocked": {
      const id = asTicketId(event.value.ticket);
      return (
        taskPhaseIn(core).includes(id) &&
        executionBlockedReasons.includes(event.value.reason)
      );
    }
    case "ResumeTicket":
      return retryablesIn(core).includes(asTicketId(event.value));
  }
}

/** The ticket a decision event is about, which every journal reader needs and no arm hides. */
export function decisionEventSubject(event: DecisionEvent): TicketId {
  switch (event.type) {
    case "ReleaseTicket":
    case "TaskDone":
    case "FinalizationResult":
    case "ExecutionBlocked":
      return asTicketId(event.value.ticket);
    case "Revoke":
    case "Dispatch":
    case "WorkReduce":
    case "EvalReduce":
    case "ResumeTicket":
      return asTicketId(event.value);
  }
}

/** Tickets already Done, which a reader needs to spot a redelivered completion. */
export { doneIn, ticketAt };
