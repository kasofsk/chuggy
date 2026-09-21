/**
 * Which section of the project table a phase puts a ticket in, and what a
 * parked row's badge says.
 *
 * The sections are the reader's questions in order: what needs a human, what is
 * moving, what is next, what finished, what stopped. `NeedsYou` is the model's
 * own `hasOpenHumanTask`, which is Escalated alone (`model/ticket.qnt`), and
 * `Revoked` sits in `Stopped` rather than beside Done because a reader
 * scanning for what went wrong is looking for it there.
 *
 * `UpNext` IS EVERY PENDING TICKET AND NOT THE UNBLOCKED FRONTIER. Unblocked
 * would need each ticket to name what it waits on and the phase of those
 * tickets; the project read carries neither, and the one representation that
 * does carry dependencies is the selector's dispatch view, which is an agent's
 * resource. Until a ticket states its dependencies, Pending is the honest
 * heading.
 */

import { phaseRoster } from "../../../../src/contract/rosters.ts";
import type {
  EscalationReason,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";

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

export function ticketSectionOf(phase: TicketPhase): TicketSection {
  switch (phase) {
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

/** Derived from the roster rather than listed, so a phase the wire gains is a
 * compile error in the mapping above and not a phase no section holds. */
export function ticketSectionPhases(
  section: TicketSection,
): readonly TicketPhase[] {
  return phaseRoster.filter((phase) => ticketSectionOf(phase) === section);
}

export function escalationBadgeLabel(reason: EscalationReason): string {
  switch (reason) {
    case "WorkFailureEscalated":
      return "work failed";
    case "EvaluationFailureEscalated":
      return "rework budget spent";
    case "WorkExecutionUnavailableEscalated":
      return "execution unavailable";
    case "FinalizationUnavailableEscalated":
      return "finalization unavailable";
  }
}

/** An open human task with no reason field to say why is still an open human
 * task, so the phase is what its badge says. */
export function ticketBadgeLabel(
  phase: TicketPhase,
  reason: EscalationReason | undefined,
): string | undefined {
  if (reason !== undefined) return escalationBadgeLabel(reason);
  return phase === "Escalated" ? "escalated" : undefined;
}
