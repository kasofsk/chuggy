/**
 * Which section of the project table a ticket's state puts it in.
 *
 * The sections are the reader's questions in order: what needs a human, what
 * is moving, what is next, what finished, what stopped. `Revoked` sits under
 * "failed or revoked" rather than beside `Done` because a reader scanning for
 * what went wrong is looking for both.
 *
 * TWO SECTIONS HOLD ONE STATE EACH, AND THAT IS THE ROSTER AND NOT A GAP. The
 * adopted read states seven ticket states. "Needs you" is `Escalated` alone,
 * and "failed or revoked" is `Revoked` alone: there is no blocked handoff and
 * no abandonment on this wire to keep either of them company. Each heading
 * still asks its own question, so the arrangement is the same one a wire with
 * more states would fill out.
 */

import { adoptedTicketStateSchema } from "../../../../src/contract/adoptedTickets.ts";
import type { AdoptedTicket } from "../../../../src/contract/adoptedTickets.ts";

export const ticketSectionRoster = [
  "NeedsYou",
  "InProgress",
  "UpNext",
  "Done",
  "Stopped",
] as const;

export type TicketSection = (typeof ticketSectionRoster)[number];

export const ticketSectionTitles: Readonly<Record<TicketSection, string>> = {
  NeedsYou: "needs you",
  InProgress: "in progress",
  UpNext: "up next",
  Done: "done",
  Stopped: "failed or revoked",
};

export function ticketSectionOf(state: AdoptedTicket["state"]): TicketSection {
  switch (state) {
    case "Escalated":
      return "NeedsYou";
    case "Work":
    case "Evaluation":
    case "Finalization":
      return "InProgress";
    case "Pending":
      return "UpNext";
    case "Done":
      return "Done";
    case "Revoked":
      return "Stopped";
  }
}

/** Derived from the roster rather than listed, so a state the wire gains is a
 * compile error in the mapping above and not a state no section holds. */
export function ticketSectionStates(
  section: TicketSection,
): readonly AdoptedTicket["state"][] {
  return adoptedTicketStateSchema.options.filter(
    (state) => ticketSectionOf(state) === section,
  );
}
