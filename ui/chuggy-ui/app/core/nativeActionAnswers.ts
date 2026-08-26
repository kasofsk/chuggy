/**
 * What one open native action offers a person, and the command each offer
 * sends.
 *
 * The wire says which resolutions an action admits, and the contract pairs each
 * kind with the ones it may ask for, so the offers are that pairing narrowed to
 * what this action admits — which is also what puts them in the kind's own
 * order rather than the page's, so the destructive answer is never the first
 * button. `ResolveNativeAction` carries the action's identity and the fence it
 * was raised at, which is how the API refuses an answer to a question that has
 * moved on.
 */

import { nativeActionKindResolutions } from "../../../../src/contract/rosters.ts";
import type { NativeActionResolution } from "../../../../src/contract/rosters.ts";
import type { NativeActionResponse } from "../../../../src/contract/responses.ts";

import type { TicketAction, TicketActionName } from "./ticketActions.ts";

/** What the button says, which is the resolution without the noun the mutation
 * beside it already names. */
export function nativeActionAnswerName(
  resolution: NativeActionResolution,
): TicketActionName {
  switch (resolution) {
    case "Resume":
      return "Resume";
    case "Revoke":
      return "Revoke";
    case "RetryHandoff":
      return "Retry";
    case "AbandonHandoff":
      return "Abandon";
    case "Approve":
      return "Approve";
    case "Decline":
      return "Decline";
  }
}

/** One action's admitted answers, in its kind's order. */
export function nativeActionAnswers(
  action: NativeActionResponse,
): readonly TicketAction[] {
  return nativeActionKindResolutions[action.kind]
    .filter((resolution) => action.admits.includes(resolution))
    .map((resolution) => ({
      action: nativeActionAnswerName(resolution),
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
