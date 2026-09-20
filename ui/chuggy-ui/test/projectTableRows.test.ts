import { describe, expect, test } from "vitest";

import type { AdoptedTicket } from "../../../src/contract/adoptedTickets.ts";
import {
  projectTableRows,
  projectTableRowsIn,
} from "../app/core/projectTableRows.ts";

function ticketOf(
  ticket: number,
  state: AdoptedTicket["state"],
  dependencies: readonly number[] = [],
): AdoptedTicket {
  return {
    ticket,
    revision: 1,
    workCyclesStarted: 0,
    state,
    dependencies: [...dependencies],
  };
}

function waitingOf(
  tickets: readonly AdoptedTicket[],
  ticket: number,
): readonly number[] {
  const row = projectTableRows(tickets).find((held) => held.ticket === ticket);
  if (row === undefined) throw new Error(`no row for ${String(ticket)}`);
  return row.waitingOn;
}

describe("what a row is waiting on", () => {
  test("a dependency that has finished is not holding the ticket up", () => {
    const tickets = [ticketOf(1, "Done"), ticketOf(2, "Pending", [1])];

    expect(waitingOf(tickets, 2)).toEqual([]);
  });

  test("a dependency that has not finished is named, in the stated order", () => {
    const tickets = [
      ticketOf(1, "Done"),
      ticketOf(2, "Work"),
      ticketOf(3, "Revoked"),
      ticketOf(4, "Pending", [1, 2, 3]),
    ];

    expect(waitingOf(tickets, 4)).toEqual([2, 3]);
  });

  test("a dependency the answer does not hold is waited on, not assumed done", () => {
    const tickets = [ticketOf(4, "Pending", [9])];

    expect(waitingOf(tickets, 4)).toEqual([9]);
  });
});

describe("the rows of a section", () => {
  test("up next draws the tickets that could start now first", () => {
    const tickets = [
      ticketOf(1, "Work"),
      ticketOf(2, "Pending", [1]),
      ticketOf(3, "Pending"),
      ticketOf(4, "Pending", [1]),
      ticketOf(5, "Pending"),
    ];

    const drawn = projectTableRowsIn(projectTableRows(tickets), "UpNext");

    expect(drawn.map((row) => row.ticket)).toEqual([3, 5, 2, 4]);
  });

  test("every other section keeps the order the read gave", () => {
    const tickets = [
      ticketOf(7, "Evaluation", [9]),
      ticketOf(8, "Work"),
      ticketOf(9, "Finalization"),
    ];

    const drawn = projectTableRowsIn(projectTableRows(tickets), "InProgress");

    expect(drawn.map((row) => row.ticket)).toEqual([7, 8, 9]);
  });

  test("a row carries the counts the read states for it", () => {
    const tickets = [
      { ...ticketOf(6, "Work"), revision: 3, workCyclesStarted: 2 },
    ];

    expect(projectTableRows(tickets)[0]).toMatchObject({
      ticket: 6,
      section: "InProgress",
      revision: 3,
      workCyclesStarted: 2,
    });
  });
});
