/**
 * Which actions the ticket panel offers, from the reads it holds rather than
 * from the phase where it holds no read.
 *
 * AN OFFER IS A CLAIM ABOUT WHAT THE ACTOR ADMITS. An open native action's
 * `admits` is `retryableIn` in full; `actionsFor` is the phase alone, which is
 * that predicate's first conjunct, so it stands only where the open-actions
 * read came back and said there was nothing open. A read still in flight or
 * failed is drawn as itself (kasofsk/chuggy#453) — the panel that guessed
 * instead offered a Resume the actor refuses, and a refusal arriving after the
 * click is the reader's time spent on the console's own assumption.
 */

import type { TicketNativeActionsResponse } from "../../../../src/contract/responses.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";

import type { PanelState } from "./freshness.ts";
import { nativeActionsAnswers } from "./nativeActionAnswers.ts";
import { actionsFor } from "./ticketActions.ts";
import type { TicketAction } from "./ticketActions.ts";

/** The buttons to draw, or the read whose state is drawn in their place. */
export type TicketOffers =
  | { readonly offers: "Actions"; readonly actions: readonly TicketAction[] }
  | { readonly offers: "Unread" };

export function ticketOffers(
  openState: PanelState<TicketNativeActionsResponse>,
  ticket: TicketResponse,
  dispatch: TicketAction | undefined,
): TicketOffers {
  switch (openState.state) {
    case "Pending":
    case "Absent":
    case "Failed":
      return { offers: "Unread" };
    case "Ready": {
      const open = openState.value.actions;
      if (open.length > 0)
        return { offers: "Actions", actions: nativeActionsAnswers(open) };
      return {
        offers: "Actions",
        actions: [
          ...(dispatch === undefined ? [] : [dispatch]),
          ...actionsFor(ticket),
        ],
      };
    }
  }
}
