/**
 * Everything the ticket page derives from the reads it already holds: the
 * ledger, the accounts and what a resume would do.
 *
 * It is a plain function of the three reads rather than a hook, so the whole of
 * what the page decides is reachable from a suite with no renderer, and a part
 * of the page is handed facts instead of a query. Every field is absent while
 * the read it needs is, so a half-read page draws what it has rather than a
 * guess at the rest.
 *
 * A RESUME IS ANSWERED FROM THE WIRE BEFORE THE DRAFT ARRIVES. `resumeAt` is
 * the machine's own answer and needs no authoring to read, so a ticket read
 * that carries one offers its resume on a cold load; what the draft adds is the
 * size of what it re-runs, which degrades to no figure rather than to no
 * button. "The machine stamped nothing" is claimed only where this page has
 * read enough to know it, which is why `NotRead` is an arm of its own.
 *
 * AFFORDABILITY IS CHECKED ONLY WHERE BOTH HALVES ARE KNOWN. `retryableIn`
 * wants the point's charge against `gasLeft`; the charge is one gas at either
 * work resume under both pricings and is the ticket's own pricing otherwise, so
 * a page without the draft can still price a work resume and declines to price
 * the rest. Where the wire carries no accounts the offer stands — that is the
 * honest absence, and the server refuses by code — because hiding a control
 * over a figure this page does not have would be a stronger claim than the
 * machine makes.
 */

import type {
  DraftResponse,
  ExecutionsResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import type { ResumeOffer } from "../../core/codeLabels.ts";
import {
  resumeGasCharge,
  resumeRerun,
  ticketResume,
} from "../../core/resumePoint.ts";
import type { ResumeConsequence } from "../../core/resumePoint.ts";
import type { ResumePoint } from "../../../../../src/contract/rosters.ts";
import { ticketAccounts } from "../../core/ticketAccounts.ts";
import type {
  MachineAccounts,
  TicketAccounts,
} from "../../core/ticketAccounts.ts";
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

export interface TicketPageFacts {
  readonly authoring: TicketAuthoring | undefined;
  readonly stageCount: number;
  readonly ledger: LedgerFacts | undefined;
  readonly accounts: TicketAccounts | undefined;
  readonly resume: ResumeOffer;
  readonly truncated: boolean;
}

/**
 * The wire's accounts as the derivation's own shape. A field the wire omits is
 * omitted here rather than named as undefined, which is the difference the
 * console's exact optionality makes.
 */
function machineAccountsOf(
  accounts: NonNullable<TicketResponse["accounts"]> | undefined,
): MachineAccounts | undefined {
  if (accounts === undefined) return undefined;
  return {
    ...(accounts.gasLeft === undefined ? {} : { gasLeft: accounts.gasLeft }),
    ...(accounts.gasMax === undefined ? {} : { gasMax: accounts.gasMax }),
    ...(accounts.reworkLeft === undefined
      ? {}
      : { reworkLeft: accounts.reworkLeft }),
    ...(accounts.finalizationLeft === undefined
      ? {}
      : { finalizationLeft: accounts.finalizationLeft }),
  };
}

/**
 * What the wire alone says a resume would do. The size of what it re-runs is
 * the authoring's and is absent here, so nothing downstream draws a figure this
 * page has not read.
 */
function resumeFromWire(point: ResumePoint): ResumeConsequence {
  return {
    point,
    reruns: resumeRerun(point),
    fromStage: point === "ResumeEvaluating" ? 0 : undefined,
    ofStages: undefined,
    refillsReworkTo: undefined,
    cost: resumeGasCharge(point, "RetryCharged"),
  };
}

/**
 * The gas the point is certainly charged. Both work resumes meter under either
 * pricing, so their charge is known without the draft; the rest are the
 * ticket's own pricing and are not priced until it arrives.
 */
function resumeChargeKnown(
  point: ResumePoint,
  pricing: TicketAuthoring["resumePricing"] | undefined,
): number | undefined {
  if (point === "ResumeWorking" || point === "ResumeReworking") return 1;
  return pricing === undefined ? undefined : resumeGasCharge(point, pricing);
}

/** `retryableIn`'s third term, asked only where this page holds both halves. */
function resumeAfforded(
  consequence: ResumeConsequence,
  ticket: TicketResponse,
  pricing: TicketAuthoring["resumePricing"] | undefined,
): boolean {
  const gasLeft = ticket.accounts?.gasLeft;
  const charge = resumeChargeKnown(consequence.point, pricing);
  if (gasLeft === undefined || charge === undefined) return true;
  return charge <= gasLeft;
}

function resumeOfferOf(
  consequence: ResumeConsequence | undefined,
  ticket: TicketResponse,
  pricing: TicketAuthoring["resumePricing"] | undefined,
): ResumeOffer {
  if (consequence === undefined) return { kind: "NoPoint" };
  return resumeAfforded(consequence, ticket, pricing)
    ? { kind: "Offered", consequence }
    : { kind: "NoGas" };
}

/**
 * What a resume would do before the draft and the executions have arrived. A
 * point the wire stamped is answered; without one this page cannot tell a wall
 * with no exit from a read it has not finished.
 */
function resumeBeforeDraft(ticket: TicketResponse | undefined): ResumeOffer {
  if (ticket?.resumeAt === undefined) return { kind: "NotRead" };
  return resumeOfferOf(resumeFromWire(ticket.resumeAt), ticket, undefined);
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
      accounts: undefined,
      resume: resumeBeforeDraft(ticket),
      truncated,
    };
  const ledger = ticketLedger(page, authoring);
  return {
    authoring,
    stageCount,
    ledger,
    accounts: ticketAccounts(
      ledger,
      authoring,
      machineAccountsOf(ticket.accounts),
    ),
    resume: resumeOfferOf(
      ticketResume({
        phase: ticket.phase,
        reason: ticket.reason,
        lastSet: ledgerLastSet(ledger),
        stageCount,
        resumePricing: authoring.resumePricing,
        resumeAt: ticket.resumeAt,
        reworkBudget: authoring.reworkPolicy.value,
      }),
      ticket,
      authoring.resumePricing,
    ),
    truncated,
  };
}
