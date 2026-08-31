/**
 * That what a ticket has spent is counted at the edges the model charges at.
 *
 * The failures this catches are the two that would make a meter lie: counting
 * the fabric's container relaunches as rework, and counting a resume's entry to
 * work or a finalizer's as one. Each is a work set with a different set before
 * it, so every case below differs only in what that set was.
 */

import { expect, test } from "vitest";

import type { Account } from "../app/core/ticketAccounts.ts";
import { ticketAccounts } from "../app/core/ticketAccounts.ts";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import type { TicketAuthoring } from "../app/core/ticketLedger.ts";
import {
  ledgerPage,
  ticket21Authoring,
  ticket21Parked,
  ticket21Resumed,
  type ExecutionShape,
} from "./ticketLedgerFixture.ts";

function accountsOf(
  shapes: readonly ExecutionShape[],
  authoring: TicketAuthoring = ticket21Authoring,
  nextAfter?: string,
) {
  return ticketAccounts(
    ticketLedger(ledgerPage(shapes, nextAfter), authoring),
    authoring,
  );
}

/** A meter as it is drawn: what it is worth, what it has, and where that came from. */
function meter(account: Account): readonly unknown[] {
  return [
    account.policy,
    account.max,
    account.spent,
    account.left,
    account.provenance,
  ];
}

const budgetedFinalization: TicketAuthoring = {
  ...ticket21Authoring,
  finalizationPricing: { type: "Budgeted", value: 2 },
};

/** A work set that passed and an evaluation of it, at the stages a case names. */
function cycle(work: number, stages: readonly number[]): ExecutionShape[] {
  return [
    {
      execution: `execution-w${String(work)}-${String(work)}`,
      task: work,
      taskKind: "Work",
      outcome: "Passed",
    },
    ...stages.map((stage, index) => ({
      execution: `execution-e${String(work + index + 1)}-${String(work + index + 1)}`,
      task: work + index + 1,
      taskKind: "Evaluation" as const,
      stage,
      outcome: "Passed" as const,
    })),
  ];
}

test("both reworks of a ticket that spent them are counted, and none is left", () => {
  expect(meter(accountsOf(ticket21Parked).rework)).toEqual([
    "Budgeted",
    2,
    2,
    0,
    "Derived",
  ]);
});

test("every entry to work and every charged resume is a gas charge", () => {
  expect(meter(accountsOf(ticket21Resumed).gas)).toEqual([
    "LimitNotOnWire",
    undefined,
    4,
    undefined,
    "Derived",
  ]);
});

test("a free retry charges nothing for the resume that started a second run", () => {
  const free: TicketAuthoring = {
    ...ticket21Authoring,
    resumePricing: "RetryFree",
  };
  expect(accountsOf(ticket21Resumed, free).gas.spent).toBe(3);
});

test("a ticket priced by its deadline has no finalization account", () => {
  expect(meter(accountsOf(ticket21Parked).finalization)).toEqual([
    "NotBudgeted",
    undefined,
    0,
    undefined,
    "Derived",
  ]);
});

test("a work run after the program passed spends the finalization account, not rework", () => {
  const shapes = [...cycle(1, [0, 1]), ...cycle(4, [])];
  const accounts = accountsOf(shapes, budgetedFinalization);
  expect(accounts.finalization.spent).toBe(1);
  expect(accounts.rework.spent).toBe(0);
});

test("a work run after a failed work run is a resume and spends neither account", () => {
  const accounts = accountsOf(
    [
      {
        execution: "execution-a-1",
        task: 1,
        taskKind: "Work",
        outcome: "Failed",
      },
      {
        execution: "execution-b-2",
        task: 2,
        taskKind: "Work",
        outcome: "Passed",
      },
    ],
    budgetedFinalization,
  );
  expect(accounts.rework.spent).toBe(0);
  expect(accounts.finalization.spent).toBe(0);
  expect(accounts.gas.spent).toBe(2);
});

test("a container the fabric relaunched is not a rework", () => {
  const accounts = accountsOf([
    {
      execution: "execution-a-1",
      task: 1,
      taskKind: "Work",
      outcome: "Passed",
      retriesSpent: 3,
    },
    {
      execution: "execution-b-2",
      task: 2,
      taskKind: "Evaluation",
      stage: 0,
      outcome: "Passed",
      retriesSpent: 3,
    },
  ]);
  expect(accounts.rework.spent).toBe(0);
});

test("a count over a page the route has more of says the page was short", () => {
  expect(
    accountsOf(ticket21Parked, ticket21Authoring, "execution-zz-9")
      .overShortPage,
  ).toBe(true);
  expect(accountsOf(ticket21Parked).overShortPage).toBe(false);
});

test("the machine's own accounts win over the count, and say so", () => {
  const ledger = ticketLedger(ledgerPage(ticket21Parked), ticket21Authoring);
  const accounts = ticketAccounts(ledger, ticket21Authoring, {
    reworkLeft: 1,
    gasMax: 9,
    gasLeft: 5,
  });
  expect(meter(accounts.rework)).toEqual(["Budgeted", 2, 1, 1, "Machine"]);
  expect(meter(accounts.gas)).toEqual(["Budgeted", 9, 4, 5, "Machine"]);
});

test("a page holding more reworks than the ticket was authored with is clamped", () => {
  const shapes = [
    ...cycle(1, []),
    {
      execution: "execution-x-2",
      task: 2,
      taskKind: "Evaluation" as const,
      stage: 0,
      outcome: "Failed" as const,
    },
    ...cycle(3, []),
    {
      execution: "execution-x-4",
      task: 4,
      taskKind: "Evaluation" as const,
      stage: 0,
      outcome: "Failed" as const,
    },
    ...cycle(5, []),
    {
      execution: "execution-x-6",
      task: 6,
      taskKind: "Evaluation" as const,
      stage: 0,
      outcome: "Failed" as const,
    },
    ...cycle(7, []),
  ];
  const rework = accountsOf(shapes).rework;
  expect(rework.spent).toBe(2);
  expect(rework.left).toBe(0);
});
