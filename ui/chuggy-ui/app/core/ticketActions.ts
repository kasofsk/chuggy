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
import type {
  EscalationReason,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";
import type { DispatchViewResponse } from "../../../../src/contract/responses.ts";

import { projectListReread, projectResourceKey } from "./projectQueryKeys.ts";
import type { ProjectList, ProjectQueryKey } from "./projectQueryKeys.ts";

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
  );
}

/** A submission the console accepted and is still following. */
export interface TicketAttempt {
  readonly action: TicketAction;
  readonly operation: string;
}

/**
 * Where an attempt in flight is held, so that the panel unmounting does not
 * take the record of it with it. It is the cache and not component state
 * because the cache outlives the panel; `attempt:` is a resource no frame
 * carries, so the stream — which writes `Ticket` resources by ticket number
 * alone — never writes over it.
 */
export function ticketAttemptKey(
  partition: PartitionIdentity,
  ticket: number,
): ProjectQueryKey {
  return projectResourceKey(partition, "Ticket", `attempt:${String(ticket)}`);
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

/**
 * What a page knows about the ticket beyond its phase, where a sentence needs
 * it. Each field is absent on a page that does not read it.
 */
export interface TicketActionContext {
  readonly reason?: EscalationReason | undefined;
  readonly reworkBudget?: number | undefined;
}

/** What the rework wall's Resume does, naming the refill where the page reads it. */
function resumeSentence(context: TicketActionContext): string {
  if (context.reason !== "ReworkBudgetExhausted")
    return "rejoin the pipeline at the point this ticket was parked at";
  const budget =
    context.reworkBudget === undefined
      ? "a fresh rework budget"
      : `a fresh rework budget of ${String(context.reworkBudget)}`;
  return `rework this ticket with ${budget}, which costs one gas`;
}

/**
 * What the button says, and what answering it does to the ticket. Resume is
 * the one answer whose effect the wall decides, so it reads the context.
 */
export function ticketActionSentence(
  action: TicketActionName,
  context: TicketActionContext = {},
): string {
  switch (action) {
    case "Dispatch":
      return "dispatch this ticket from the version the console observed";
    case "Resume":
      return resumeSentence(context);
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
