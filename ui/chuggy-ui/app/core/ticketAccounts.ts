/**
 * The three accounts a ticket is metered by — rework, gas, finalization — as
 * figures rather than as prose.
 *
 * EVERY ACCOUNT SAYS WHERE ITS FIGURE CAME FROM. A ticket read carrying the
 * machine's own accounts is answered with those; otherwise the counts are
 * derived from the ledger and marked as derived, because a count over a page
 * that may be short is a floor and a reader has to be told which they are
 * looking at.
 *
 * WHAT EACH ONE COUNTS. Rework and finalization are both charged at an entry to
 * work, which the ledger holds as a cycle boundary, and the set settled before
 * that boundary is what tells the two apart. Gas is charged there too, and
 * again at every charged resume, which is a program run after the first inside
 * one cycle rather than a boundary between two.
 *
 * Gas has no limit on the wire, so its derived arm carries a spend with no
 * maximum and no remainder rather than a maximum nothing supplied. That spend
 * is a floor twice over: a short page hides charges, and a charged resume into
 * finalizing spends gas without creating an execution for any page to hold.
 */

import type { ClosedSet, Ledger, TicketAuthoring } from "./ticketLedger.ts";
import { cycleLastSet } from "./ticketLedger.ts";

/** Whether a figure is the machine's own or this console's count of what it holds. */
export type AccountProvenance = "Machine" | "Derived";

/**
 * How the ticket was authored to pay: against a budget, against gas alone, or
 * against a budget the wire does not publish.
 */
export type AccountPolicy = "Budgeted" | "NotBudgeted" | "LimitNotOnWire";

export interface Account {
  readonly policy: AccountPolicy;
  readonly max: number | undefined;
  readonly spent: number;
  readonly left: number | undefined;
  readonly provenance: AccountProvenance;
}

export interface TicketAccounts {
  readonly rework: Account;
  readonly gas: Account;
  readonly finalization: Account;
  readonly overShortPage: boolean;
}

/** The machine's own accounts, as a ticket read carries them where it does. */
export interface MachineAccounts {
  readonly gasLeft?: number;
  readonly gasMax?: number;
  readonly reworkLeft?: number;
  readonly finalizationLeft?: number;
}

/** The set the machine settled before each entry to work this page holds. */
function workEntryPredecessors(ledger: Ledger): readonly ClosedSet[] {
  const predecessors: ClosedSet[] = [];
  for (const [index, cycle] of ledger.cycles.entries()) {
    if (cycle.work === undefined) continue;
    const previous = ledger.cycles[index - 1];
    if (previous === undefined) continue;
    const last = cycleLastSet(previous);
    if (last !== undefined) predecessors.push(last);
  }
  return predecessors;
}

/** An evaluation that failed is what the rework account pays to re-enter work from. */
function reworkEntries(ledger: Ledger): number {
  return workEntryPredecessors(ledger).filter(
    (set) => set.taskKind === "Evaluation" && set.verdict === "Failed",
  ).length;
}

/** A finalizer failure is the only edge that reworks from a program that passed. */
function finalizationEntries(
  ledger: Ledger,
  authoring: TicketAuthoring,
): number {
  const finalStage = authoring.program.length - 1;
  return workEntryPredecessors(ledger).filter(
    (set) =>
      set.taskKind === "Evaluation" &&
      set.verdict === "Passed" &&
      set.stage === finalStage,
  ).length;
}

/** Every entry to work meters, and so does every program run a charged resume started. */
function gasCharges(ledger: Ledger, authoring: TicketAuthoring): number {
  const entries = ledger.cycles.filter(
    (cycle) => cycle.work !== undefined,
  ).length;
  if (authoring.resumePricing === "RetryFree") return entries;
  return ledger.cycles.reduce(
    (charged, cycle) => charged + Math.max(cycle.programRuns.length - 1, 0),
    entries,
  );
}

/** A spend against a limit, never reporting more spent than the limit admits. */
function budgeted(
  max: number,
  spent: number,
  provenance: AccountProvenance,
): Account {
  const held = Math.min(Math.max(spent, 0), max);
  return {
    policy: "Budgeted",
    max,
    spent: held,
    left: max - held,
    provenance,
  };
}

function reworkAccount(
  ledger: Ledger,
  authoring: TicketAuthoring,
  machine: MachineAccounts | undefined,
): Account {
  const max = authoring.reworkPolicy.value;
  const left = machine?.reworkLeft;
  if (left !== undefined) return budgeted(max, max - left, "Machine");
  return budgeted(max, reworkEntries(ledger), "Derived");
}

function gasAccount(
  ledger: Ledger,
  authoring: TicketAuthoring,
  machine: MachineAccounts | undefined,
): Account {
  const max = machine?.gasMax;
  const left = machine?.gasLeft;
  if (max !== undefined && left !== undefined)
    return budgeted(max, max - left, "Machine");
  return {
    policy: "LimitNotOnWire",
    max: undefined,
    spent: gasCharges(ledger, authoring),
    left: undefined,
    provenance: "Derived",
  };
}

function finalizationAccount(
  ledger: Ledger,
  authoring: TicketAuthoring,
  machine: MachineAccounts | undefined,
): Account {
  const pricing = authoring.finalizationPricing;
  if (pricing === "DeadlineOnly")
    return {
      policy: "NotBudgeted",
      max: undefined,
      spent: 0,
      left: undefined,
      provenance: "Derived",
    };
  const left = machine?.finalizationLeft;
  if (left !== undefined)
    return budgeted(pricing.value, pricing.value - left, "Machine");
  return budgeted(
    pricing.value,
    finalizationEntries(ledger, authoring),
    "Derived",
  );
}

/**
 * What this ticket has spent and has left. A truncated page is reported
 * alongside, because a derived count over one is low rather than wrong.
 */
export function ticketAccounts(
  ledger: Ledger,
  authoring: TicketAuthoring,
  machine?: MachineAccounts,
): TicketAccounts {
  return {
    rework: reworkAccount(ledger, authoring, machine),
    gas: gasAccount(ledger, authoring, machine),
    finalization: finalizationAccount(ledger, authoring, machine),
    overShortPage: ledger.truncated,
  };
}
