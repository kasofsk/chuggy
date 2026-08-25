/**
 * The command envelopes a project operation carries, and the one of them no
 * principal may offer.
 *
 * `FinalizationResult` IS NOT A PUBLIC DECISION COMMAND. Only the finalizer
 * service may conclude a finalizing ticket, so the event is excluded from
 * `OperationDecisionEvent` and the finalizer's own envelope is excluded from
 * `TicketCommand` — a `Decide` carrying one and a submission offering one are
 * both unspellable rather than merely refused. `ReleaseTicket` has been kept
 * out this way since I3, and this is the same device at a second seam.
 *
 * `TaskDone` AND `ExecutionBlocked` ARE THE THIRD SEAM. Only the execution
 * scheduler settles a logical task, and settling one is not a decision a
 * principal holding `Mutate` may offer: a forged pass would conclude work that
 * never ran, and a forged block would park a ticket no infrastructure refused.
 * So both leave `OperationDecisionEvent` for the same reason the finalizer's
 * event did, and `SchedulerCompletion` below is the envelope the scheduler's
 * own boundary writes. The two arrive at a writer through
 * `parseStoredTicketCommand` and never through the ingress parser, which is
 * what makes the exclusion a shape rather than a check that could be skipped.
 */

import type { DecisionEvent } from "../actor/decisionEvent.ts";
import type { FinalizationOutcome } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import type { DispatchViewToken } from "./dispatchView.ts";

export type OperationDecisionEvent = Exclude<
  DecisionEvent,
  {
    readonly type:
      | "WorkReduce"
      | "EvalReduce"
      | "ReleaseTicket"
      | "FinalizationResult"
      | "TaskDone"
      | "ExecutionBlocked";
  }
>;

/** The two events only the execution scheduler's own boundary submits. */
export type CompletionDecisionEvent = Extract<
  DecisionEvent,
  { readonly type: "TaskDone" | "ExecutionBlocked" }
>;

/** Every event kind a `Decide` envelope may carry that no principal may offer. */
export const completionEventTypes = [
  "TaskDone",
  "ExecutionBlocked",
] as const satisfies readonly CompletionDecisionEvent["type"][];

/** Whether one decision event is a completion the scheduler alone may submit. */
export function isCompletionDecisionEvent(
  event: DecisionEvent,
): event is CompletionDecisionEvent {
  return completionEventTypes.some((type) => type === event.type);
}

/** Narrows to the completion an event is, refusing every event that is not one. */
export function asCompletionDecisionEvent(
  event: DecisionEvent,
): CompletionDecisionEvent {
  if (!isCompletionDecisionEvent(event))
    throw new RangeError("event is not a completion");
  return event;
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
 * The two answers a finalization approval admits, and the first resolutions that
 * name no domain command at all. Answering one settles its operation and
 * journals nothing, because approval is operational protocol and not `Core` state.
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
    event.type === "EvalReduce" ||
    event.type === "ReleaseTicket" ||
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
 * durable rows. It names the request it answers, the attempt it concluded on,
 * the request generation and the epoch it was made under, so a writer can fence
 * it and find its evidence before constructing an event.
 */
export interface FinalizationSubmission {
  readonly version: 1;
  readonly command: "SubmitFinalizationResult";
  readonly request: string;
  readonly attempt: string;
  readonly requestGeneration: number;
  readonly recoveryEpoch: string;
  readonly outcome: FinalizationOutcome;
}

/**
 * The execution scheduler's own submission. `submit_task_completion` builds the
 * event from the durable execution, attempt and result rows it has already
 * locked and validated, so what is stored is the settled event itself rather
 * than a binding a writer would resolve a second time — which is the one way
 * this envelope differs from the finalizer's above.
 */
export interface SchedulerCompletion {
  readonly version: 1;
  readonly command: "Decide";
  readonly event: CompletionDecisionEvent;
}

/** What a stored operation may carry: a public command, or one of the two envelopes only a boundary writes. */
export type StoredTicketCommand =
  TicketCommand | FinalizationSubmission | SchedulerCompletion;
