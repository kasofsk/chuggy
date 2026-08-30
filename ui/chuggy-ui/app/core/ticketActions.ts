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

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";
import type { DispatchViewResponse } from "../../../../src/contract/responses.ts";

import { projectListReread } from "./projectQueryKeys.ts";
import type { ProjectList } from "./projectQueryKeys.ts";

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
  | "Dispatch"
  | "Resume"
  | "Revoke"
  | "Retry"
  | "Abandon"
  | "Approve"
  | "Decline";

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

/**
 * Where one ticket's dispatch availability is held, and what makes it stale:
 * every `Ticket` frame, because candidacy is `isReadyIn` — this ticket's phase
 * AND every dependency being Done — so the frame that makes a ticket
 * dispatchable is its last dependency's, and a decision that leaves this
 * ticket's own row alone never names it.
 */
export function ticketDispatchList(
  partition: PartitionIdentity,
  ticket: number,
): ProjectList<DispatchViewResponse> {
  return projectListReread<DispatchViewResponse>(
    partition,
    "Ticket",
    `dispatch:${String(ticket)}`,
    () => true,
  );
}

export function manualDispatchAction(
  ticket: number,
  view: DispatchViewResponse,
): TicketAction | undefined {
  if (view.result === "Reset") return undefined;
  const candidate = view.candidates.find((entry) => entry.ticket === ticket);
  return candidate === undefined
    ? undefined
    : {
        action: "Dispatch",
        mutation: {
          mutation: "ManualDispatch",
          ticket,
          expectedTicketVersion: candidate.ticketVersion,
        },
      };
}

/** What the button says, and what answering it does to the ticket. */
export function ticketActionSentence(action: TicketActionName): string {
  switch (action) {
    case "Dispatch":
      return "dispatch this ticket from the version the console observed";
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
