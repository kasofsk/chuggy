/**
 * What a page, a live `Ticket` frame and a refused read each do to the rows the
 * table holds.
 *
 * Every case is the accumulation on its own, with no cache and no renderer,
 * because the accumulation is where a row moving between sections is decided.
 */

import { expect, test } from "vitest";

import { nativeHttpPageItemsMax } from "../../../src/contract/http.ts";
import type {
  ProjectResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import {
  projectTicketPagesMax,
  projectTicketRowsAfterPage,
  projectTicketRowsAppend,
  projectTicketRowsEmpty,
  projectTicketRowsFold,
  projectTicketRowsHaveMore,
  projectTicketRowsMax,
} from "../app/core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../app/core/projectTicketPages.ts";
import { ticketSectionOf } from "../app/core/ticketSections.ts";

const partition = { tenant: "acme", project: "atlas" };

function page(
  tickets: readonly TicketResponse[],
  nextCursor?: string,
): ProjectResponse {
  return {
    partition,
    sequence: 9,
    tickets: [...tickets],
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

function pendingPage(from: number, nextCursor: string): ProjectResponse {
  return page(
    Array.from({ length: nativeHttpPageItemsMax }, (_unused, at) => ({
      ticket: from + at,
      phase: "Pending" as const,
      sequence: 1,
    })),
    nextCursor,
  );
}

const firstPage = page(
  [
    { ticket: 1, phase: "Working", sequence: 4 },
    { ticket: 2, phase: "Pending", sequence: 3 },
  ],
  "after-one",
);

test("a page appends its tickets and carries the cursor it answered with", () => {
  const rows = projectTicketRowsAppend(projectTicketRowsEmpty, firstPage);
  expect(rows.tickets.map((ticket) => ticket.ticket)).toStrictEqual([1, 2]);
  expect(rows.nextCursor).toBe("after-one");
  expect(rows.pagesRead).toBe(1);
  expect(projectTicketRowsHaveMore(rows)).toBe(true);
});

test("a second page appends after the first and repeats no ticket", () => {
  const first = projectTicketRowsAppend(projectTicketRowsEmpty, firstPage);
  const second = projectTicketRowsAppend(
    first,
    page([
      { ticket: 2, phase: "Pending", sequence: 3 },
      { ticket: 3, phase: "Done", sequence: 2 },
    ]),
  );
  expect(second.tickets.map((ticket) => ticket.ticket)).toStrictEqual([
    1, 2, 3,
  ]);
  expect(second.nextCursor).toBeUndefined();
  expect(projectTicketRowsHaveMore(second)).toBe(false);
});

test("the rows are bounded however many a page walk keeps handing over", () => {
  let rows: ProjectTicketRows = projectTicketRowsEmpty;
  for (let read = 0; read < projectTicketPagesMax + 4; read += 1)
    rows = projectTicketRowsAppend(
      rows,
      pendingPage(read * nativeHttpPageItemsMax + 1, "again"),
    );
  expect(rows.tickets.length).toBe(projectTicketRowsMax);
});

test("a page walk stops at the page budget even while a cursor is offered", () => {
  let rows: ProjectTicketRows = projectTicketRowsEmpty;
  for (let read = 0; read < projectTicketPagesMax; read += 1)
    rows = projectTicketRowsAppend(
      rows,
      page([{ ticket: read + 1, phase: "Pending", sequence: 1 }], "again"),
    );
  expect(rows.nextCursor).toBe("again");
  expect(projectTicketRowsHaveMore(rows)).toBe(false);
});

test("a ticket frame moves a row into another section without disturbing the rest", () => {
  const rows = projectTicketRowsAppend(projectTicketRowsEmpty, firstPage);
  const folded = projectTicketRowsFold(
    rows,
    "1",
    { ticket: 1, phase: "Escalated", sequence: 7, reason: "WorkFailed" },
    undefined,
  );
  expect(folded?.tickets.map((ticket) => ticket.ticket)).toStrictEqual([1, 2]);
  const moved = folded?.tickets[0];
  expect(moved?.phase).toBe("Escalated");
  expect(moved !== undefined && ticketSectionOf(moved.phase)).toBe("NeedsYou");
  expect(folded?.tickets[1]?.phase).toBe("Pending");
});

test("a ticket the list has not got arrives at the top", () => {
  const rows = projectTicketRowsAppend(projectTicketRowsEmpty, firstPage);
  const folded = projectTicketRowsFold(
    rows,
    "9",
    { ticket: 9, phase: "Working", sequence: 8 },
    undefined,
  );
  expect(folded?.tickets.map((ticket) => ticket.ticket)).toStrictEqual([
    9, 1, 2,
  ]);
});

test("a filtered list drops the ticket that left the filter", () => {
  const rows = projectTicketRowsAppend(projectTicketRowsEmpty, firstPage);
  const folded = projectTicketRowsFold(
    rows,
    "2",
    { ticket: 2, phase: "Done", sequence: 8 },
    ["Pending"],
  );
  expect(folded?.tickets.map((ticket) => ticket.ticket)).toStrictEqual([1]);
});

test("a tombstone removes the row it names and a frame that will not read removes none", () => {
  const rows = projectTicketRowsAppend(projectTicketRowsEmpty, firstPage);
  expect(
    projectTicketRowsFold(rows, "1", null, undefined)?.tickets.map(
      (ticket) => ticket.ticket,
    ),
  ).toStrictEqual([2]);
  expect(
    projectTicketRowsFold(rows, "1", { ticket: "one" }, undefined)?.tickets
      .length,
  ).toBe(2);
});

test("a list with no page read yet is not invented by a frame", () => {
  expect(
    projectTicketRowsFold(
      undefined,
      "1",
      { ticket: 1, phase: "Working", sequence: 1 },
      undefined,
    ),
  ).toBeUndefined();
});

test("a page that could not be read keeps the rows and says why", () => {
  const rows = projectTicketRowsAppend(projectTicketRowsEmpty, firstPage);
  const after = projectTicketRowsAfterPage(rows, {
    outcome: "Unreachable",
    reason: "the network went away",
  });
  expect(after.tickets.map((ticket) => ticket.ticket)).toStrictEqual([1, 2]);
  expect(after.failure).toContain("the network went away");
  expect(after.nextCursor).toBe("after-one");
});

test("a page that reads clears the failure the last one recorded", () => {
  const failed = projectTicketRowsAfterPage(
    projectTicketRowsAppend(projectTicketRowsEmpty, firstPage),
    { outcome: "Unreachable", reason: "the network went away" },
  );
  const after = projectTicketRowsAfterPage(failed, {
    outcome: "Ok",
    value: page([{ ticket: 3, phase: "Done", sequence: 1 }]),
  });
  expect(after.failure).toBeUndefined();
  expect(after.tickets.map((ticket) => ticket.ticket)).toStrictEqual([1, 2, 3]);
});
