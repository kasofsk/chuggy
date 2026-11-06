/**
 * Everything the ticket page derives from the reads it already holds: the
 * ledger, the plan it runs and what a resume would do.
 *
 * It is a plain function of the reads rather than a hook, so the whole of
 * what the page decides is reachable from a suite with no renderer, and a part
 * of the page is handed facts instead of a query. Every field is absent while
 * the read it needs is, so a half-read page draws what it has rather than a
 * guess at the rest.
 *
 * A RESUME IS ANSWERED FROM THE WIRE ALONE. `resumeAt` is
 * the machine's own answer, read straight off the ticket's `escalation` and
 * needing no program or ledger to read, so a ticket read that carries one
 * offers its resume on a cold load.
 *
 * THE LEDGER GROUPS BY WHAT WAS RELEASED. The program is the ticket's own, the
 * one its last release or update ran from, and never the draft's: a Pending
 * ticket's draft may be revised without an update, and a ledger grouped by it
 * would draw stages that will never run.
 *
 * A DRAFT NEVER RELEASED IS DRAWN IN THE TICKET'S PLACE. There is no ticket to
 * read, so its plan is the draft's own and nothing has run.
 */

import { briefTitleCharsMax } from "../../../../src/contract/brief.ts";
import type {
  DraftResponse,
  ExecutionsResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type { ResumeOffer } from "./codeLabels.ts";
import type { ResumePoint } from "../../../../src/contract/rosters.ts";
import { executionStarting, ticketLedger } from "./ticketLedger.ts";
import type { Ledger as LedgerFacts, TicketProgram } from "./ticketLedger.ts";
import { ticketPlanOf } from "./ticketPlan.ts";
import type { TicketPlan } from "./ticketPlan.ts";

/**
 * How many executions this page holds, and what is true of them that a count
 * alone would not say: how many still wait for their worker, how many are
 * running, and how many carry no figures for the spend to be summed from.
 */
export function runsLabel(page: ExecutionsResponse | undefined): string {
  const held = page?.executions ?? [];
  const live = held.filter(
    (row) => row.status !== "Terminal" && row.status !== "Cancelled",
  );
  const starting = live.filter(executionStarting).length;
  const running = live.length - starting;
  const unmeasured = held.filter((row) => row.runTotals === undefined).length;
  return [
    String(held.length),
    ...(starting === 0 ? [] : [`${String(starting)} starting`]),
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
  readonly program: TicketProgram | undefined;
  readonly plan: TicketPlan;
  readonly ledger: LedgerFacts | undefined;
  readonly resume: ResumeOffer;
  readonly truncated: boolean;
}

function resumeOfferOf(point: ResumePoint | undefined): ResumeOffer {
  return point === undefined ? { kind: "NoPoint" } : { kind: "Offered", point };
}

/** The page's facts from its reads; `canonical` is the configuration the
 * ticket runs under, absent while it is read. */
export function ticketPageFacts(
  ticket: TicketResponse | undefined,
  page: ExecutionsResponse | undefined,
  canonical: string | undefined,
): TicketPageFacts {
  const program = ticket?.program;
  const plan = ticketPlanOf(canonical, ticket);
  const truncated = page?.nextCursor !== undefined;
  const resume = resumeOfferOf(ticket?.escalation?.resumeAt);
  if (program === undefined || page === undefined)
    return { program, plan, ledger: undefined, resume, truncated };
  const ledger = ticketLedger(page, program);
  return { program, plan, ledger, resume, truncated };
}

/** The draft the page draws in the ticket's place: one never released, while
 * no ticket has been read. */
export function ticketPageUnreleased(
  ticket: TicketResponse | undefined,
  draft: DraftResponse | undefined,
): DraftResponse | undefined {
  if (ticket !== undefined || draft === undefined) return undefined;
  return draft.state === "Draft" && draft.releasedAuthoringVersion === undefined
    ? draft
    : undefined;
}

/** The facts of a draft drawn in the ticket's place: its plan, and no runs. */
export function ticketDraftPageFacts(
  draft: DraftResponse,
  canonical: string | undefined,
): TicketPageFacts {
  return {
    program: undefined,
    plan: ticketPlanOf(canonical, {
      selection: draft.selection,
      brief: draft.brief,
      program: draft.authoring.program,
    }),
    ledger: undefined,
    resume: resumeOfferOf(undefined),
    truncated: false,
  };
}

/** What a draft is called, as a ticket's read names one: its brief's title,
 * or the first line of its intent that says anything, cut to the title's
 * bound; none where neither says anything. */
export function ticketDraftTitleOf(draft: DraftResponse): string | undefined {
  const brief = draft.brief;
  if (brief?.title !== undefined) return brief.title;
  const line = brief?.intent.split("\n").find((said) => said.trim() !== "");
  return line?.slice(0, briefTitleCharsMax);
}
