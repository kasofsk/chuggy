/**
 * Everything the ticket page derives from the reads it already holds: the
 * ledger, the accounts and what a resume would do.
 *
 * It is a plain function of the four values rather than a hook, so the whole of
 * what the page decides is reachable from a suite with no renderer, and a part
 * of the page is handed facts instead of a query. Every field is absent while
 * the read it needs is, so a half-read page draws what it has rather than a
 * guess at the rest.
 */

import type {
  DraftResponse,
  ExecutionsResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { ticketResume } from "../../core/resumePoint.ts";
import type { ResumeConsequence } from "../../core/resumePoint.ts";
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
  readonly resume: ResumeConsequence | undefined;
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

export function ticketPageFacts(
  ticket: TicketResponse | undefined,
  draft: DraftResponse | undefined,
  page: ExecutionsResponse | undefined,
): TicketPageFacts {
  const authoring = draft?.authoring;
  const stageCount = authoring?.program.length ?? 0;
  if (authoring === undefined || page === undefined)
    return {
      authoring,
      stageCount,
      ledger: undefined,
      accounts: undefined,
      resume: undefined,
    };
  const ledger = ticketLedger(page, authoring);
  return {
    authoring,
    stageCount,
    ledger,
    accounts: ticketAccounts(
      ledger,
      authoring,
      machineAccountsOf(ticket?.accounts),
    ),
    resume:
      ticket === undefined
        ? undefined
        : ticketResume({
            phase: ticket.phase,
            reason: ticket.reason,
            lastSet: ledgerLastSet(ledger),
            stageCount,
            resumePricing: authoring.resumePricing,
            resumeAt: ticket.resumeAt,
          }),
  };
}
