/**
 * Everything the ticket page derives from the reads it already holds: the
 * ledger and what a resume would do.
 *
 * It is a plain function of the three reads rather than a hook, so the whole of
 * what the page decides is reachable from a suite with no renderer, and a part
 * of the page is handed facts instead of a query. Every field is absent while
 * the read it needs is, so a half-read page draws what it has rather than a
 * guess at the rest.
 *
 * A RESUME IS ANSWERED FROM THE WIRE BEFORE THE DRAFT ARRIVES. `resumeAt` is
 * the machine's own answer and needs no authoring to read, so a ticket read
 * that carries one offers its resume on a cold load. "The machine stamped
 * nothing" is claimed only where this page has read enough to know it, which
 * is why `NotRead` is an arm of its own.
 */

import type {
  DraftResponse,
  ExecutionsResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import type { ResumeOffer } from "../../core/codeLabels.ts";
import { ticketResumePoint } from "../../core/resumePoint.ts";
import type { ResumePoint } from "../../../../../src/contract/rosters.ts";
import { ledgerLastSet, ticketLedger } from "../../core/ticketLedger.ts";
import type {
  Ledger as LedgerFacts,
  TicketAuthoring,
} from "../../core/ticketLedger.ts";

/**
 * How many executions this page holds, and what is true of them that a count
 * alone would not say: how many are still running, and how many carry no
 * figures for the spend to be summed from.
 */
export function runsLabel(page: ExecutionsResponse | undefined): string {
  const held = page?.executions ?? [];
  const running = held.filter(
    (row) => row.status !== "Terminal" && row.status !== "Cancelled",
  ).length;
  const unmeasured = held.filter((row) => row.runTotals === undefined).length;
  return [
    String(held.length),
    ...(running === 0 ? [] : [`${String(running)} running`]),
    ...(unmeasured === 0 ? [] : [`${String(unmeasured)} unmeasured`]),
  ].join(" · ");
}

/**
 * Whether the machine is working on this ticket right now, which is the only
 * state whose span has no end. A parked, pending or settled ticket is not
 * running, so a page holding none of its runs must not draw one still going.
 */
export function phaseIsRunning(phase: TicketResponse["phase"]): boolean {
  switch (phase) {
    case "Work":
    case "Evaluation":
    case "Finalization":
      return true;
    case "Pending":
    case "Done":
    case "Escalated":
    case "Revoked":
      return false;
  }
}

export interface TicketPageFacts {
  readonly authoring: TicketAuthoring | undefined;
  readonly stageCount: number;
  readonly ledger: LedgerFacts | undefined;
  readonly resume: ResumeOffer;
  readonly truncated: boolean;
}

function resumeOfferOf(point: ResumePoint | undefined): ResumeOffer {
  return point === undefined ? { kind: "NoPoint" } : { kind: "Offered", point };
}

/**
 * What a resume would do before the draft and the executions have arrived: a
 * point the wire stamped is answered, and without one this page cannot tell a
 * wall with no exit from a read it has not finished.
 */
function resumeBeforeDraft(ticket: TicketResponse | undefined): ResumeOffer {
  if (ticket === undefined || ticket.resumeAt === undefined)
    return { kind: "NotRead" };
  return resumeOfferOf(ticket.resumeAt);
}

/** The whole resume, from a page that holds the ticket, its draft and its runs. */
function resumePointRead(
  ticket: TicketResponse,
  authoring: TicketAuthoring,
  ledger: LedgerFacts,
): ResumePoint | undefined {
  return ticketResumePoint({
    phase: ticket.phase,
    reason: ticket.reason,
    lastSet: ledgerLastSet(ledger),
    stageCount: authoring.program.length,
    resumeAt: ticket.resumeAt,
  });
}

export function ticketPageFacts(
  ticket: TicketResponse | undefined,
  draft: DraftResponse | undefined,
  page: ExecutionsResponse | undefined,
): TicketPageFacts {
  const authoring = draft?.authoring;
  const stageCount = authoring?.program.length ?? 0;
  const truncated = page?.nextCursor !== undefined;
  if (authoring === undefined || page === undefined || ticket === undefined)
    return {
      authoring,
      stageCount,
      ledger: undefined,
      resume: resumeBeforeDraft(ticket),
      truncated,
    };
  const ledger = ticketLedger(page, authoring);
  return {
    authoring,
    stageCount,
    ledger,
    resume: resumeOfferOf(resumePointRead(ticket, authoring, ledger)),
    truncated,
  };
}
