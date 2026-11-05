/**
 * The section titles the inbox draws its list under, and what a parked row's
 * badge says.
 */

import type {
  EscalationKind,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";
import type { TicketEscalation } from "../../../../src/contract/responses.ts";
import { runStepLabel } from "./codeLabels.ts";

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
 * task, so the phase is what its badge says; one whose job was lost on its
 * runner says that rather than what failed, and one whose run stopped at a
 * failed step names the step. */
export function ticketBadgeLabel(
  phase: TicketPhase,
  escalation: TicketEscalation | undefined,
): string | undefined {
  if (escalation?.lost !== undefined) return "lost on runner";
  if (escalation?.failed !== undefined)
    return runStepLabel(escalation.failed.evidence).toLowerCase();
  if (escalation !== undefined) return escalationBadgeLabel(escalation.kind);
  return phase === "Escalated" ? "escalated" : undefined;
}
