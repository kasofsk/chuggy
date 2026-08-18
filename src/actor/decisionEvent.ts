/**
 * The decision event: which decider, at which named picks — the vocabulary
 * `model/refinement.qnt` declares as `DecisionEvent`, with its total dispatch onto the
 * domain's pure deciders (`execDecisionEvent`) and its enablement over an explicit
 * `Core` (`decisionEventEnabled`).
 *
 * `execDecisionEvent` IS BOTH THE ACTOR'S DECIDE STEP AND THE REPLAY STEP, which is what
 * keeps the two from drifting: the deciders are pure, so `(Core, picks)`
 * determines everything, and the picks are the only information a crash could
 * lose. `decisionEventEnabled` re-states each domain action's guard as a conjunction of
 * references — the enablement predicates in `src/domain/enablement.ts`, never
 * a copied expression — and its set-membership conjuncts come first so a
 * event naming a ticket the state does not hold is refused cleanly rather
 * than crashed on. The deciders assume their guards; only `decisionEventEnabled` is
 * total.
 *
 * `Arrive` CARRIES ITS DEPS AS THE MODEL'S OWN SET, so the arrival that names
 * a ticket twice — a value the model's powerset draw has no counterpart for —
 * cannot be constructed at this boundary at all, and the enablement is the
 * model's `subseteq` and nothing beside it. The distinctness rule stays where an
 * array still arrives: `src/interpreter/wire.ts` reads it off a journal on disk,
 * which did not have to come from this path.
 */

import { assertNever } from "../domain/assertNever.ts";
import {
  isValidProgram,
  projects,
  wrapUpChoices,
  type Config,
} from "../domain/config.ts";
import type { Core, Decision } from "../domain/core.ts";
import {
  decideArrive,
  decideCompleteDuplicate,
  decideDequeue,
  decideDispatch,
  decideEvalStageReduce,
  decideOpRetry,
  decideRelease,
  decideRevalFail,
  decideRevoke,
  decideTaskDone,
  decideWorkReduce,
  decideWrapUpResolve,
} from "../domain/deciders.ts";
import {
  canArriveIn,
  deliverableTaskIds,
  dependableIn,
  dispatchableIn,
  doneIn,
  draftsIn,
  holdingIn,
  readiesIn,
  reducibleEvalIn,
  reducibleWorkIn,
  retryablesIn,
  revocablesIn,
  taskPhaseIn,
  wrapUpOutcomes,
  wrapUpStartablesIn,
} from "../domain/enablement.ts";
import type { ProjectId, TaskId, TicketId } from "../domain/ids.ts";
import type { Stage } from "../domain/program.ts";
import type { Verdict } from "../domain/task.ts";
import {
  wrapUpEquals,
  type WrapUp,
  type WrapUpOutcome,
} from "../domain/wrapUp.ts";

/** One decision event per domain action, payload exactly the action's draws. */
export type DecisionEvent =
  | {
      readonly event: "Arrive";
      readonly deps: ReadonlySet<TicketId>;
      readonly program: readonly Stage[];
      readonly project: ProjectId;
      readonly wrapUp: WrapUp;
    }
  | { readonly event: "Release"; readonly ticket: TicketId }
  | { readonly event: "Revoke"; readonly ticket: TicketId }
  | { readonly event: "Dispatch"; readonly ticket: TicketId }
  | {
      readonly event: "TaskDone";
      readonly ticket: TicketId;
      readonly taskId: TaskId;
      readonly verdict: Verdict;
    }
  | { readonly event: "WorkReduce"; readonly ticket: TicketId }
  | { readonly event: "EvalReduce"; readonly ticket: TicketId }
  | {
      readonly event: "Dequeue";
      readonly ticket: TicketId;
      readonly moved: boolean;
    }
  | {
      readonly event: "GateResolve";
      readonly ticket: TicketId;
      readonly outcome: WrapUpOutcome;
    }
  | { readonly event: "CompleteDuplicate"; readonly ticket: TicketId }
  | { readonly event: "RevalFail"; readonly ticket: TicketId }
  | { readonly event: "OpRetry"; readonly ticket: TicketId };

/**
 * Every constructor tag, in the order the model's `DecisionEvent` declares them. It
 * exists so a suite can hold this vocabulary against the model's rather than
 * restate it.
 */
export const decisionEventTags: readonly DecisionEvent["event"][] = [
  "Arrive",
  "Release",
  "Revoke",
  "Dispatch",
  "TaskDone",
  "WorkReduce",
  "EvalReduce",
  "Dequeue",
  "GateResolve",
  "CompleteDuplicate",
  "RevalFail",
  "OpRetry",
];

/** An arrival at the given draws. */
export function arriveEvent(
  deps: ReadonlySet<TicketId>,
  program: readonly Stage[],
  project: ProjectId,
  wrapUp: WrapUp,
): DecisionEvent {
  return { event: "Arrive", deps, program, project, wrapUp };
}

export function releaseEvent(ticket: TicketId): DecisionEvent {
  return { event: "Release", ticket };
}

export function revokeEvent(ticket: TicketId): DecisionEvent {
  return { event: "Revoke", ticket };
}

export function dispatchEvent(ticket: TicketId): DecisionEvent {
  return { event: "Dispatch", ticket };
}

/** A task-completion delivery, duplicate or not: the domain absorbs, the journal records. */
export function taskDoneEvent(
  ticket: TicketId,
  taskId: TaskId,
  verdict: Verdict,
): DecisionEvent {
  return { event: "TaskDone", ticket, taskId, verdict };
}

export function workReduceEvent(ticket: TicketId): DecisionEvent {
  return { event: "WorkReduce", ticket };
}

export function evalReduceEvent(ticket: TicketId): DecisionEvent {
  return { event: "EvalReduce", ticket };
}

/** The wrap-up dequeue at the environment's invalidation choice. */
export function dequeueEvent(ticket: TicketId, moved: boolean): DecisionEvent {
  return { event: "Dequeue", ticket, moved };
}

/** The gated resolution at the environment's drawn outcome. */
export function gateResolveEvent(
  ticket: TicketId,
  outcome: WrapUpOutcome,
): DecisionEvent {
  return { event: "GateResolve", ticket, outcome };
}

export function completeDuplicateEvent(ticket: TicketId): DecisionEvent {
  return { event: "CompleteDuplicate", ticket };
}

export function revalFailEvent(ticket: TicketId): DecisionEvent {
  return { event: "RevalFail", ticket };
}

export function opRetryEvent(ticket: TicketId): DecisionEvent {
  return { event: "OpRetry", ticket };
}

/** Total dispatch onto the domain's pure deciders: the decide step and the replay step, one function. */
export function execDecisionEvent(
  config: Config,
  core: Core,
  event: DecisionEvent,
): Decision {
  switch (event.event) {
    case "Arrive":
      return decideArrive(
        config,
        core,
        event.deps,
        event.program,
        event.project,
        event.wrapUp,
      );
    case "Release":
      return decideRelease(core, event.ticket);
    case "Revoke":
      return decideRevoke(core, event.ticket);
    case "Dispatch":
      return decideDispatch(config, core, event.ticket);
    case "TaskDone":
      return decideTaskDone(core, event.ticket, event.taskId, event.verdict);
    case "WorkReduce":
      return decideWorkReduce(core, event.ticket);
    case "EvalReduce":
      return decideEvalStageReduce(config, core, event.ticket);
    case "Dequeue":
      return decideDequeue(config, core, event.ticket, event.moved);
    case "GateResolve":
      return decideWrapUpResolve(
        config,
        core,
        event.ticket,
        event.outcome,
        true,
      );
    case "CompleteDuplicate":
      return decideCompleteDuplicate(core, event.ticket);
    case "RevalFail":
      return decideRevalFail(core, event.ticket);
    case "OpRetry":
      return decideOpRetry(config, core, event.ticket);
    default:
      return assertNever(event);
  }
}

/**
 * The decision's enablement at an explicit `Core`: per constructor, the domain
 * action's guard plus draw-set membership, each conjunct a reference to the
 * predicate the domain action reads.
 */
export function decisionEventEnabled(
  config: Config,
  core: Core,
  event: DecisionEvent,
): boolean {
  switch (event.event) {
    case "Arrive":
      return (
        canArriveIn(config, core) &&
        [...event.deps].every((dep) => dependableIn(core).includes(dep)) &&
        isValidProgram(config, event.program) &&
        projects(config).includes(event.project) &&
        wrapUpChoices(config).some((choice) =>
          wrapUpEquals(choice, event.wrapUp),
        )
      );
    case "Release":
      return draftsIn(core).includes(event.ticket);
    case "Revoke":
      return revocablesIn(core).includes(event.ticket);
    case "Dispatch":
      return (
        readiesIn(core).includes(event.ticket) &&
        dispatchableIn(core, event.ticket)
      );
    case "TaskDone":
      return (
        taskPhaseIn(core).includes(event.ticket) &&
        deliverableTaskIds(core, event.ticket).includes(event.taskId)
      );
    case "WorkReduce":
      return reducibleWorkIn(core).includes(event.ticket);
    case "EvalReduce":
      return reducibleEvalIn(core).includes(event.ticket);
    case "Dequeue":
      return wrapUpStartablesIn(core).includes(event.ticket);
    case "GateResolve":
      return (
        holdingIn(core).includes(event.ticket) &&
        wrapUpOutcomes(true).includes(event.outcome)
      );
    case "CompleteDuplicate":
      return doneIn(core).includes(event.ticket);
    case "RevalFail":
      return readiesIn(core).includes(event.ticket);
    case "OpRetry":
      return retryablesIn(config, core).includes(event.ticket);
    default:
      return assertNever(event);
  }
}
