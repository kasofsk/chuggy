/**
 * What an execution column draws: the joined execution's chip, or, with nothing
 * joined, the dash and no chip.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import {
  cellAbsent,
  TicketRowExecutionCell,
} from "../app/browser/TicketCells.tsx";
import type { ProjectTableRow } from "../app/core/projectTableRows.ts";

afterEach(cleanup);

function row(
  executionVerdict: ProjectTableRow["executionVerdict"],
): ProjectTableRow {
  return {
    ticket: 4,
    title: undefined,
    repository: undefined,
    creator: undefined,
    phase: "Escalated",
    sequence: 1,
    badge: "work failed",
    executionVerdict,
    runsOn: undefined,
    activityAt: "2026-08-26T00:00:00Z",
    openDependencies: [],
    revokedDependencies: [],
  };
}

test("a joined row draws its execution as a chip", () => {
  const { container } = render(<TicketRowExecutionCell row={row("Failed")} />);
  expect(container.querySelector(".pill")?.textContent).toBe("Failed");
});

test("a row with nothing joined draws the dash and no chip", () => {
  const { container } = render(<TicketRowExecutionCell row={row(undefined)} />);
  expect(container.textContent).toBe(cellAbsent);
  expect(container.querySelector(".pill")).toBeNull();
  expect(container.textContent).not.toContain("not read");
});
