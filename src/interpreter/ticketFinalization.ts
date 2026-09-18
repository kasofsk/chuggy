/**
 * What a finalization came to, and the command that reports it back to the
 * ticket.
 *
 * The three answers are the same whichever operation reached them — the work
 * landed, the work needs more work, or the remote never answered — so the
 * command is written once here. An operation that reported them itself would be
 * free to disagree with another about which answer a ticket was told.
 */
import {
  FinalizationNeedsWork,
  FinalizationResultReport,
  FinalizationResultUnavailable,
  FinalizationSucceeded,
  ReportFinalizationResult,
  type FinalizeTicket,
} from "../domain/chuggernaut/ticket.js";
import type { ContentRef } from "../domain/chuggernaut/task.js";

export type TicketFinalizationOutcome =
  "Succeeded" | "NeedsWork" | "Unavailable";

export function ticketFinalizationReport(
  obligation: FinalizeTicket,
  outcome: TicketFinalizationOutcome,
  evidence: ContentRef,
): ReportFinalizationResult {
  const result =
    outcome === "Succeeded"
      ? new FinalizationSucceeded(evidence)
      : outcome === "NeedsWork"
        ? new FinalizationNeedsWork(evidence)
        : new FinalizationResultUnavailable(evidence);
  return new ReportFinalizationResult(
    new FinalizationResultReport(
      obligation.ticket,
      obligation.finalization.work_cycle,
      obligation.finalization.generation,
      result,
    ),
  );
}
