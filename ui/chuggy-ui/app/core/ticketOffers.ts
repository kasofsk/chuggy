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
import { actionsFor, ticketRevisable } from "./ticketActions.ts";
import type { TicketAction, TicketActionName } from "./ticketActions.ts";

/** The buttons to draw and whether the edit screen is offered beside them, or
 * the read whose state is drawn in their place. */
export type TicketOffers =
  | {
      readonly offers: "Actions";
      readonly actions: readonly TicketAction[];
      readonly editable: boolean;
    }
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
      const editable = ticketRevisable(ticket.phase);
      if (open.length > 0)
        return {
          offers: "Actions",
          actions: nativeActionsAnswers(open),
          editable,
        };
      return {
        offers: "Actions",
        editable,
        actions: [
          ...(dispatch === undefined ? [] : [dispatch]),
          ...actionsFor(ticket),
        ],
      };
    }
  }
}

/** Whether the action answers what the ticket is waiting on a person for, which
 * is where the page draws it: beside the question rather than with the rest. */
export function ticketActionResolves(action: TicketActionName): boolean {
  switch (action) {
    case "Resume":
    case "Approve":
    case "Decline":
      return true;
    case "Dispatch":
    case "Revoke":
      return false;
  }
}

/** The offered actions a card beside the bar draws: none where no card asks
 * anything, and otherwise the ones that answer what it asks. */
export function offersAnswered(
  offers: TicketOffers,
  asking: boolean,
): readonly TicketAction[] {
  if (!asking || offers.offers === "Unread") return [];
  return offers.actions.filter((action) => ticketActionResolves(action.action));
}
