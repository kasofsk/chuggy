/**
 * The section titles the inbox draws its list under, and what a parked row's
 * badge says.
 */

import type { TicketPhase } from "../../../../src/contract/rosters.ts";
import type { TicketEscalation } from "../../../../src/contract/responses.ts";
import { escalationKindLabel, phaseLabel, runStepLabel } from "./codeLabels.ts";
import type { Copy } from "./copy.ts";

export const ticketSectionRoster = [
  "NeedsYou",
  "InProgress",
  "UpNext",
  "Done",
  "Stopped",
] as const;
export type TicketSection = (typeof ticketSectionRoster)[number];

export const ticketSectionTitles: Readonly<Record<TicketSection, Copy>> = {
  NeedsYou: { id: "ticket-sections-needs-you" },
  InProgress: { id: "ticket-sections-in-progress" },
  UpNext: { id: "ticket-sections-up-next" },
  Done: { id: "ticket-sections-done" },
  Stopped: { id: "ticket-sections-stopped" },
};

/** An escalated ticket with no read of its escalation is still an open human
 * task, so the phase is what its badge says; one whose job was lost on its
 * runner says that rather than what failed, one whose run stopped at a failed
 * step names the step, and any other names its escalation's kind. */
export function ticketBadgeLabel(
  phase: TicketPhase,
  escalation: TicketEscalation | undefined,
): Copy | undefined {
  if (escalation?.lost !== undefined) return { id: "codes-escalation-lost" };
  if (escalation?.failed !== undefined)
    return runStepLabel(escalation.failed.evidence);
  if (escalation !== undefined) return escalationKindLabel(escalation.kind);
  return phase === "Escalated" ? phaseLabel(phase) : undefined;
}
