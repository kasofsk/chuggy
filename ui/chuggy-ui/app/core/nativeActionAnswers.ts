/**
 * What one open native action offers a person, and the command each offer
 * sends.
 *
 * The wire says which resolutions an action admits, and the contract pairs each
 * kind with the ones it may ask for, so the offers are that pairing narrowed to
 * what this action admits — which is also what puts them in the kind's own
 * order rather than the page's, so the destructive answer is never the first
 * button. `ResolveNativeAction` carries the action's identity and the fence it
 * was raised at, which is how the API refuses an answer to an action that has
 * moved on.
 *
 * AN EVALUATION APPROVAL IS OFFERED ONLY TO WHOM IT ASKS. Its read says
 * whether the caller may answer it, and that flag alone decides; the project's
 * `mutate` ability, which gates every other kind's answers, does not. What the
 * person says of the work is added to the answer as it is sent, and a `Reject`
 * is not sendable without it.
 */

import {
  approvalFeedbackCharsMax,
  isApprovalFeedback,
} from "../../../../src/contract/http.ts";
import { nativeActionKindResolutions } from "../../../../src/contract/rosters.ts";
import type {
  NativeActionKind,
  NativeActionResolution,
} from "../../../../src/contract/rosters.ts";
import type { NativeActionResponse } from "../../../../src/contract/responses.ts";

import type { TicketAction, TicketActionName } from "./ticketActions.ts";

/** What the button says, which is the resolution without the noun the
 * mutation beside it already names, and an approval's by what it passes. */
export function nativeActionAnswerName(
  kind: NativeActionKind,
  resolution: NativeActionResolution,
): TicketActionName {
  switch (resolution) {
    case "Resume":
      return "Resume";
    case "Revoke":
      return "Revoke";
    case "Approve":
      return kind === "EvaluationApproval" ? "ApproveEvaluation" : "Approve";
    case "Decline":
      return "Decline";
    case "Reject":
      return "Reject";
  }
}

/** Whether the read offers this action's answers to its caller: an evaluation
 * approval's by its own flag, and every other kind's by the abilities the
 * page applies after. */
export function nativeActionOffered(action: NativeActionResponse): boolean {
  switch (action.kind) {
    case "EvaluationApproval":
      return action.answerable;
    case "TicketEscalation":
    case "FinalizationApproval":
      return true;
  }
}

/** Whether an offered answer is an evaluation approval's, which the caller's
 * flag gated rather than the project's abilities. */
export function nativeActionAnswerApproval(action: TicketActionName): boolean {
  switch (action) {
    case "ApproveEvaluation":
    case "Reject":
      return true;
    case "Dispatch":
    case "Resume":
    case "Revoke":
    case "Approve":
    case "Decline":
    case "Release":
      return false;
  }
}

/** One action's admitted answers, in its kind's order. */
export function nativeActionAnswers(
  action: NativeActionResponse,
): readonly TicketAction[] {
  if (!nativeActionOffered(action)) return [];
  const kind = action.kind;
  const resolutions: readonly NativeActionResolution[] =
    nativeActionKindResolutions[kind];
  return resolutions
    .filter((resolution) => action.admits.includes(resolution))
    .map((resolution) => ({
      action: nativeActionAnswerName(kind, resolution),
      mutation: {
        mutation: "ResolveNativeAction",
        action: action.action,
        authorizingSequence: action.authorizingSequence,
        resolution,
      },
    }));
}

/** Every open action's answers, in the order the read listed the actions. */
export function nativeActionsAnswers(
  actions: readonly NativeActionResponse[],
): readonly TicketAction[] {
  return actions.flatMap((action) => nativeActionAnswers(action));
}

/** What tells two offers apart where one page draws several: the action an
 * answer resolves beside the word it says, and the word alone otherwise. */
export function nativeActionAnswerKey(offer: TicketAction): string {
  return offer.mutation.mutation === "ResolveNativeAction"
    ? `${offer.mutation.action}/${offer.action}`
    : offer.action;
}

/** What a reader typed as feedback, cut to what the wire carries. */
export function approvalFeedbackClamped(typed: string): string {
  return typed.slice(0, approvalFeedbackCharsMax);
}

/**
 * Whether an approval's answer may be sent with what was typed beside it: a
 * `Reject` only with feedback the wire admits, and an approve with none or
 * with such feedback.
 */
export function approvalAnswerSendable(
  action: TicketActionName,
  typed: string,
): boolean {
  const feedback = typed.trim();
  if (feedback === "") return action !== "Reject";
  return isApprovalFeedback(feedback);
}

/** The answer with what was typed beside it as its feedback, a note of
 * nothing but space sent as no feedback at all. */
export function approvalAnswerWith(
  offer: TicketAction,
  typed: string,
): TicketAction {
  const feedback = typed.trim();
  if (offer.mutation.mutation !== "ResolveNativeAction" || feedback === "")
    return offer;
  return { ...offer, mutation: { ...offer.mutation, feedback } };
}
