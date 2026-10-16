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
 * `UpNext` IS EVERY PENDING TICKET, NEAREST TO DISPATCHABLE FIRST, AND NOT THE
 * UNBLOCKED FRONTIER. Each Pending ticket's open dependencies order the
 * section (`upNextOrder.ts`), so the frontier rises to its top, but they do not
 * decide membership: a blocked ticket is still what follows the work it waits
 * on, and the rows are a window that cannot say what is unblocked outside it.
 */

import { phaseRoster } from "../../../../src/contract/rosters.ts";
import type {
  EscalationKind,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";
import type { TicketEscalation } from "../../../../src/contract/responses.ts";

export const ticketSectionRoster = [
  "NeedsYou",
  "InProgress",
  "UpNext",
  "Done",
  "Stopped",
] as const;
export type TicketSection = (typeof ticketSectionRoster)[number];

export const ticketSectionTitles: Readonly<Record<TicketSection, string>> = {
  NeedsYou: "Needs you",
  InProgress: "In progress",
  UpNext: "Up next",
  Done: "Done",
  Stopped: "Failed or revoked",
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

export function escalationBadgeLabel(kind: EscalationKind): string {
  switch (kind) {
    case "WorkFailureEscalated":
      return "work failed";
    case "EvaluationFailureEscalated":
      return "rework budget spent";
    case "WorkExecutionUnavailableEscalated":
      return "execution unavailable";
    case "EvaluationBlockedEscalated":
      return "evaluation blocked";
    case "FinalizationUnavailableEscalated":
      return "finalization unavailable";
  }
}

/** An escalated ticket with no read of its escalation is still an open human
 * task, so the phase is what its badge says, and one whose job was lost on its
 * runner says that rather than what failed. */
export function ticketBadgeLabel(
  phase: TicketPhase,
  escalation: TicketEscalation | undefined,
): string | undefined {
  if (escalation?.lost !== undefined) return "lost on runner";
  if (escalation !== undefined) return escalationBadgeLabel(escalation.kind);
  return phase === "Escalated" ? "escalated" : undefined;
}
