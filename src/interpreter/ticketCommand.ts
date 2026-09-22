/**
 * The command envelopes a project operation carries, and the one of them no
 * principal may offer.
 *
 * `FinalizationResult` IS NOT A PUBLIC DECISION COMMAND. Only the finalizer
 * service may conclude a finalizing ticket, so the event is excluded from
 * `OperationDecisionEvent` and the finalizer's own envelope is excluded from
 * `TicketCommand` — a `Decide` carrying one and a submission offering one are
 * both unspellable rather than merely refused. `CreateTicket` has been kept
 * out this way since I3, and this is the same device at a second seam.
 *
 * `TaskDone` IS THE THIRD SEAM. Only the execution scheduler settles a logical
 * task, and settling one is not a decision a principal holding `Mutate` may
 * offer: a forged completion would conclude work that never ran, or mark an
 * evaluator stopped that no infrastructure refused. So it leaves
 * `OperationDecisionEvent` for the same reason the finalizer's event did, and
 * `SchedulerCompletion` below is the envelope the scheduler's own boundary
 * writes. It arrives at a writer through `parseStoredTicketCommand` and never
 * through the ingress parser, which is what makes the exclusion a shape rather
 * than a check that could be skipped.
 */

import type { DecisionEvent } from "../actor/decisionEvent.ts";
import type { FinalizationUnavailableKind } from "../contract/rosters.ts";
import type { FinalizationOutcome } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import type { DispatchViewToken } from "./dispatchView.ts";

export type OperationDecisionEvent = Exclude<
  DecisionEvent,
  {
    readonly type:
      "WorkReduce" | "CreateTicket" | "FinalizationResult" | "TaskDone";
  }
>;

/** The one event only the execution scheduler's own boundary submits. */
export type CompletionDecisionEvent = Extract<
  DecisionEvent,
  { readonly type: "TaskDone" }
>;

/** Every event kind a `Decide` envelope may carry that no principal may offer. */
export const completionEventTypes = [
  "TaskDone",
] as const satisfies readonly CompletionDecisionEvent["type"][];

/** Whether one decision event is a completion the scheduler alone may submit. */
export function isCompletionDecisionEvent(
  event: DecisionEvent,
): event is CompletionDecisionEvent {
  return completionEventTypes.some((type) => type === event.type);
}

/**
 * What each kind of native action asks a person for, and the answers it admits.
 * The pairing is the roster this layer, the command grammar and the database
 * constraint all read, so none of them can offer an answer another would refuse.
 */
export const nativeActionResolutions = {
  TicketEscalation: ["Resume", "Revoke"],
  FinalizationApproval: ["Approve", "Decline"],
} as const;

/** The kinds of question a native action puts to a person. */
export type NativeActionKind = keyof typeof nativeActionResolutions;

/** Every action kind, so a suite and a database CHECK iterate rather than restate. */
export const allNativeActionKinds = Object.keys(
  nativeActionResolutions,
) as readonly NativeActionKind[];

/** The two answers an escalation admits, each of which names a domain command. */
export type EscalationResolution =
  (typeof nativeActionResolutions)["TicketEscalation"][number];

/**
 * The two answers a finalization approval admits, and the only resolutions that
 * name no domain command at all. Answering one settles its operation and
 * journals nothing, because approval is operational protocol and not `TicketGraph` state.
 */
export type ApprovalResolution =
  (typeof nativeActionResolutions)["FinalizationApproval"][number];

export type NativeActionResolution = EscalationResolution | ApprovalResolution;

/** Every resolution, so a suite and a database CHECK iterate rather than restate. */
export const allNativeActionResolutions: readonly NativeActionResolution[] =
  allNativeActionKinds.flatMap((kind) => [...nativeActionResolutions[kind]]);

/**
 * The one answer that reduces outstanding correctness risk rather than adding
 * any, which is why acceptance admits it into a project no other answer may
 * enter and takes it ahead of everything else.
 */
export const safetyResolution: NativeActionResolution = "Revoke";

/** Whether an answer is one of the two that name no domain command. */
export function isApprovalResolution(
  resolution: NativeActionResolution,
): resolution is ApprovalResolution {
  return nativeActionResolutions.FinalizationApproval.some(
    (each) => each === resolution,
  );
}

export function asOperationDecisionEvent(
  event: DecisionEvent,
): OperationDecisionEvent {
  if (
    event.type === "WorkReduce" ||
    event.type === "CreateTicket" ||
    event.type === "FinalizationResult" ||
    isCompletionDecisionEvent(event)
  ) {
    throw new RangeError("event is not a public decision command");
  }
  return event;
}

export type TicketCommand =
  | {
      readonly version: 1;
      readonly command: "Decide";
      readonly event: OperationDecisionEvent;
    }
  | {
      readonly version: 1;
      readonly command: "ResolveNativeAction";
      readonly action: string;
      readonly authorizingSeq: number;
      readonly resolution: NativeActionResolution;
    }
  | {
      readonly version: 1;
      readonly command: "ReleaseDraft";
      readonly ticket: TicketId;
      readonly authoringVersion: number;
      readonly configurationRevision: string;
    }
  | {
      readonly version: 1;
      readonly command: "ManualDispatch";
      readonly ticket: TicketId;
      readonly expectedTicketVersion: number;
    }
  | {
      readonly version: 1;
      readonly command: "ProposeDispatch";
      readonly ticket: TicketId;
      readonly expectedTicketVersion: number;
      readonly observedViewToken: DispatchViewToken;
      readonly selectorDecisionReference: string;
    };

/**
 * The finalizer's own submission, which its authenticated boundary builds from
 * durable rows. It names the request it answers, the request generation and the
 * epoch it was made under, and the attempt it concluded on except where none
 * was prepared — a brief that lands nothing, or a finalization that reached no
 * result at all — so a writer can fence it and find its evidence before
 * constructing an event.
 */
export interface FinalizationSubmission {
  readonly version: 1;
  readonly command: "SubmitFinalizationResult";
  readonly request: string;
  readonly attempt?: string;
  readonly requestGeneration: number;
  readonly recoveryEpoch: string;
  readonly outcome: FinalizationOutcome;
  /**
   * Which hold the pass could not get past, carried exactly when the outcome is
   * the one it explains. The event the writer journals names the outcome alone,
   * so this is the evidence the escalation records and the only account of it
   * that leaves the boundary.
   */
  readonly kind?: FinalizationUnavailableKind;
}

/**
 * What one settled logical task came back with, as `submit_task_completion`
 * built it from the durable execution, attempt and result rows it had already
 * locked — the settled fact itself rather than a binding a writer would
 * resolve a second time, which is the one way this envelope differs from the
 * finalizer's above. THE DISPOSITION IS NOT HERE, because which edge a failed
 * stage is taken on is this deployment's rework cap over the replayed ticket
 * and the boundary holds neither of those, so it says what the task did and
 * leaves the pick to the actor that makes it.
 */
export type SchedulerCompletionEvent = {
  readonly type: "TaskDone";
  readonly value: Omit<CompletionDecisionEvent["value"], "onFailure">;
};

/** The execution scheduler's own submission, which only a writer reading its inbox reads. */
export interface SchedulerCompletion {
  readonly version: 1;
  readonly command: "Decide";
  readonly event: SchedulerCompletionEvent;
}

/** What a stored operation may carry: a public command, or one of the two envelopes only a boundary writes. */
export type StoredTicketCommand =
  TicketCommand | FinalizationSubmission | SchedulerCompletion;

/**
 * Whether a stored envelope is the scheduler's completion, which its event's
 * tag decides on its own: no public `Decide` may carry one, so a `Decide` that
 * does was written by the boundary.
 */
export function isSchedulerCompletion(
  command: StoredTicketCommand,
): command is SchedulerCompletion {
  return command.command === "Decide" && command.event.type === "TaskDone";
}
