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
 */

import type { DecisionEvent } from "../actor/decisionEvent.ts";
import type { FinalizationOutcome } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import type { DispatchViewToken } from "./dispatchView.ts";

export type OperationDecisionEvent = Exclude<
  DecisionEvent,
  {
    readonly type:
      "WorkReduce" | "EvalReduce" | "ReleaseTicket" | "FinalizationResult";
  }
>;

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
    event.type === "FinalizationResult"
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

/** What a stored operation may carry: a public command, or the one envelope only a boundary writes. */
export type StoredTicketCommand = TicketCommand | FinalizationSubmission;
