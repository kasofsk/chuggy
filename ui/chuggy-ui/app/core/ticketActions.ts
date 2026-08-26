/**
 * Which public mutations a ticket's phase enables, as a pure function of the
 * ticket the wire answers with.
 *
 * The two predicates are the model's `revocableIn` and `retryableIn`, restated
 * because a browser reaches only `src/contract/`, and held phase by phase
 * against `src/domain/enablement.ts` by `test/ui/ticketActions.test.ts` — the
 * arrangement `no-console-sees-another` names for a value two trees both need.
 * A phase is less than the model checks: a resume also needs a modeled
 * resumption and the gas to pay for it, and the wire carries neither, so this
 * offers what the phase permits and the server refuses the rest by code.
 */

import type { TicketPhase } from "../../../../src/contract/rosters.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";

/** Settled, or past the point of no return: the complement of `revocableIn`. */
export const ticketUnrevocablePhases: readonly TicketPhase[] = [
  "Done",
  "Abandoned",
  "Revoked",
  "Finalizing",
  "PublishingHandoff",
  "HandoffBlocked",
];

/** The phases a parked ticket waits in, which is `retryableIn`'s first term. */
export const ticketResumablePhases: readonly TicketPhase[] = [
  "Escalated",
  "HandoffBlocked",
];

/**
 * Every word a button in this console carries. `actionsFor` reaches the first
 * two from the phase alone; the rest arrive with an open native action, whose
 * admitted answers `nativeActionAnswers.ts` maps onto this same pair of fields
 * so that one component draws both.
 */
export type TicketActionName =
  "Resume" | "Revoke" | "Retry" | "Abandon" | "Approve" | "Decline";

export interface TicketAction {
  readonly action: TicketActionName;
  readonly mutation: PublicMutation;
}

export function ticketRevocable(phase: TicketPhase): boolean {
  return !ticketUnrevocablePhases.includes(phase);
}

export function ticketResumable(phase: TicketPhase): boolean {
  return ticketResumablePhases.includes(phase);
}

/** Resume before revoke, because the destructive answer is never the first one. */
export function actionsFor(ticket: TicketResponse): readonly TicketAction[] {
  const offered: TicketAction[] = [];
  if (ticketResumable(ticket.phase))
    offered.push({
      action: "Resume",
      mutation: { mutation: "ResumeTicket", ticket: ticket.ticket },
    });
  if (ticketRevocable(ticket.phase))
    offered.push({
      action: "Revoke",
      mutation: { mutation: "RevokeTicket", ticket: ticket.ticket },
    });
  return offered;
}

/** What the button says, and what answering it does to the ticket. */
export function ticketActionSentence(action: TicketActionName): string {
  switch (action) {
    case "Resume":
      return "rejoin the pipeline at the point this ticket was parked at";
    case "Revoke":
      return "revoke this ticket, and park every ticket that depends on it";
    case "Retry":
      return "publish this ticket's handoff again";
    case "Abandon":
      return "abandon this ticket, and every waiting ticket that depends on it";
    case "Approve":
      return "let this ticket's finalization go ahead";
    case "Decline":
      return "hold this ticket's finalization back";
  }
}
