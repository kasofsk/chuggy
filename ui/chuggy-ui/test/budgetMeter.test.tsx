/**
 * The three accounts a ticket is metered by, in every state one can be in.
 *
 * The figure is checked as a string because that is what a reader scans, and
 * the accessible name is checked separately because the cells carry no meaning
 * of their own. A count the page derived says so, which is the difference
 * between the machine's own figure and a floor over a page that may be short.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { Account } from "../app/core/ticketAccounts.ts";
import {
  BudgetMeter,
  meterCellsMax,
  meterFigureText,
  meterStateOf,
  meterStates,
} from "../app/browser/ui/BudgetMeter.tsx";

afterEach(cleanup);

function budgeted(spent: number, max: number, machine = false): Account {
  return {
    policy: "Budgeted",
    max,
    spent,
    left: max - spent,
    provenance: machine ? "Machine" : "Derived",
  };
}

const unbounded: Account = {
  policy: "LimitNotOnWire",
  max: undefined,
  spent: 3,
  left: undefined,
  provenance: "Derived",
};

const notBudgeted: Account = {
  policy: "NotBudgeted",
  max: undefined,
  spent: 0,
  left: undefined,
  provenance: "Derived",
};

const cases: readonly { readonly account: Account; readonly figure: string }[] =
  [
    { account: budgeted(1, 2), figure: "1/2 used · 1 left" },
    { account: budgeted(2, 2), figure: "2/2 used · Exhausted" },
    {
      account: { ...budgeted(3, 2), left: -1 },
      figure: "3/2 used · Count is wrong",
    },
    { account: unbounded, figure: "3+ used · limit unknown" },
    { account: notBudgeted, figure: "Not budgeted" },
  ];

test("the five states the roster names are the five the suite draws", () => {
  expect(cases.map((held) => meterStateOf(held.account)).sort()).toEqual(
    [...meterStates].sort(),
  );
});

test("every state draws its own figure, its own class and no style attribute", () => {
  for (const held of cases) {
    const { container } = render(
      <BudgetMeter name="Rework" account={held.account} />,
    );
    expect(meterFigureText(held.account)).toBe(held.figure);
    expect(screen.getByText(held.figure)).toBeDefined();
    expect(
      container
        .querySelector(".meter")
        ?.classList.contains(`meter-${meterStateOf(held.account)}`),
    ).toBe(true);
    expect(container.querySelector("[style]")).toBeNull();
    cleanup();
  }
});

test("the group's accessible name spells the figure the cells only show", () => {
  render(<BudgetMeter name="Rework" account={budgeted(2, 2)} />);
  expect(
    screen.getByRole("group", { name: "Rework 2/2 used · Exhausted" }),
  ).toBeDefined();
});

test("a budget is a cell per unit, and a large one is a native meter instead", () => {
  const { container } = render(
    <BudgetMeter name="Rework" account={budgeted(1, 2)} />,
  );
  expect(container.querySelectorAll(".meter-cell")).toHaveLength(2);
  expect(container.querySelectorAll(".meter-cell-spent")).toHaveLength(1);
  cleanup();
  const wide = render(
    <BudgetMeter name="Gas" account={budgeted(2, meterCellsMax + 1)} />,
  );
  expect(wide.container.querySelectorAll(".meter-cell")).toHaveLength(0);
  expect(wide.container.querySelector("meter")).not.toBeNull();
});

test("a limit the wire does not carry is a hatched bar and never cells", () => {
  const { container } = render(<BudgetMeter name="Gas" account={unbounded} />);
  expect(container.querySelector(".meter-bar-unbounded")).not.toBeNull();
  expect(container.querySelectorAll(".meter-cell")).toHaveLength(0);
});

test("a derived count says it was counted here and a machine figure does not", () => {
  render(<BudgetMeter name="Rework" account={budgeted(1, 2)} />);
  expect(screen.getByText("Counted on this page")).toBeDefined();
  cleanup();
  render(<BudgetMeter name="Rework" account={budgeted(1, 2, true)} />);
  expect(screen.queryByText("Counted on this page")).toBeNull();
});

test("the unit and the action slot are drawn where they are given", () => {
  render(
    <BudgetMeter
      name="Rework"
      account={budgeted(2, 2)}
      how="1 per failed stage"
      action={<span>Add rework</span>}
    />,
  );
  expect(screen.getByText("1 per failed stage")).toBeDefined();
  expect(screen.getByText("Add rework")).toBeDefined();
});
