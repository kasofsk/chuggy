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
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  projectTicketPagesMax,
  projectTicketRowsAfterPage,
  projectTicketRowsAppend,
  projectTicketRowsEmpty,
  projectTicketRowsFold,
  projectTicketRowsHaveMore,
  projectTicketRowsMax,
  projectTicketRowsRead,
} from "../app/core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../app/core/projectTicketPages.ts";
import { ticketSectionOf } from "../app/core/ticketSections.ts";
import { ticketInstants } from "./ticketInstants.ts";

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
      ...ticketInstants,
    })),
    nextCursor,
  );
}

const firstPage = page(
  [
    { ticket: 1, phase: "Working", sequence: 4, ...ticketInstants },
    { ticket: 2, phase: "Pending", sequence: 3, ...ticketInstants },
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
      { ticket: 2, phase: "Pending", sequence: 3, ...ticketInstants },
      { ticket: 3, phase: "Done", sequence: 2, ...ticketInstants },
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

test("the row cap stops a walk the page budget has not stopped", () => {
  let rows: ProjectTicketRows = projectTicketRowsEmpty;
  while (projectTicketRowsHaveMore(rows) || rows.pagesRead === 0)
    rows = projectTicketRowsAppend(
      rows,
      pendingPage(rows.pagesRead * nativeHttpPageItemsMax + 1, "again"),
    );
  expect(rows.pagesRead).toBeLessThan(projectTicketPagesMax);
  expect(rows.tickets.length).toBe(projectTicketRowsMax);
});

test("a page carrying more than the cap has room for is cut at the cap", () => {
  const oversized = page(
    Array.from({ length: projectTicketRowsMax + 20 }, (_unused, at) => ({
      ticket: at + 1,
      phase: "Pending" as const,
      sequence: 1,
      ...ticketInstants,
    })),
    "again",
  );
  const rows = projectTicketRowsAppend(projectTicketRowsEmpty, oversized);
  expect(rows.tickets.length).toBe(projectTicketRowsMax);
});

test("a page walk stops at the page budget even while a cursor is offered", () => {
  let rows: ProjectTicketRows = projectTicketRowsEmpty;
  for (let read = 0; read < projectTicketPagesMax; read += 1)
    rows = projectTicketRowsAppend(
      rows,
      page(
        [
          {
            ticket: read + 1,
            phase: "Pending",
            sequence: 1,
            ...ticketInstants,
          },
        ],
        "again",
      ),
    );
  expect(rows.nextCursor).toBe("again");
  expect(projectTicketRowsHaveMore(rows)).toBe(false);
});

test("a ticket frame moves a row into another section without disturbing the rest", () => {
  const rows = projectTicketRowsAppend(projectTicketRowsEmpty, firstPage);
  const folded = projectTicketRowsFold(
    rows,
    "1",
    {
      ticket: 1,
      phase: "Escalated",
      sequence: 7,
      reason: "WorkFailed",
      ...ticketInstants,
    },
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
    { ticket: 9, phase: "Working", sequence: 8, ...ticketInstants },
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
    { ticket: 2, phase: "Done", sequence: 8, ...ticketInstants },
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
      { ticket: 1, phase: "Working", sequence: 1, ...ticketInstants },
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
    value: page([{ ticket: 3, phase: "Done", sequence: 1, ...ticketInstants }]),
  });
  expect(after.failure).toBeUndefined();
  expect(after.tickets.map((ticket) => ticket.ticket)).toStrictEqual([1, 2, 3]);
});

const unreachable: ApiResult<ProjectResponse> = {
  outcome: "Unreachable",
  reason: "the network went away",
};

function reading(answers: readonly ApiResult<ProjectResponse>[]): {
  readonly readPage: (
    cursor: string | undefined,
  ) => Promise<ApiResult<ProjectResponse>>;
  readonly cursors: (string | undefined)[];
} {
  const cursors: (string | undefined)[] = [];
  return {
    cursors,
    readPage: (cursor) => {
      cursors.push(cursor);
      const answer = answers[cursors.length - 1];
      if (answer === undefined) throw new Error("a page nobody offered");
      return Promise.resolve(answer);
    },
  };
}

function ticketsOf(answered: ApiResult<ProjectTicketRows>): readonly number[] {
  return answered.outcome === "Ok"
    ? answered.value.tickets.map((ticket) => ticket.ticket)
    : [];
}

test("a first read asks for one page", async () => {
  const held = reading([{ outcome: "Ok", value: firstPage }]);
  const answered = await projectTicketRowsRead(undefined, held.readPage);
  expect(held.cursors).toStrictEqual([undefined]);
  expect(answered.outcome === "Ok" && answered.value.pagesRead).toBe(1);
});

test("a refetch re-reads the pages the reader had asked for", async () => {
  const held = reading([
    { outcome: "Ok", value: firstPage },
    {
      outcome: "Ok",
      value: page([
        { ticket: 3, phase: "Done", sequence: 2, ...ticketInstants },
      ]),
    },
  ]);
  const answered = await projectTicketRowsRead(
    { ...projectTicketRowsEmpty, pagesRead: 2 },
    held.readPage,
  );
  expect(held.cursors).toStrictEqual([undefined, "after-one"]);
  expect(ticketsOf(answered)).toStrictEqual([1, 2, 3]);
});

test("a refetch that will not read keeps the rows it was replacing", async () => {
  const previous = projectTicketRowsAppend(projectTicketRowsEmpty, firstPage);
  const held = reading([unreachable]);
  const answered = await projectTicketRowsRead(previous, held.readPage);
  expect(ticketsOf(answered)).toStrictEqual([1, 2]);
  expect(answered.outcome === "Ok" && answered.value.failure).toContain(
    "the network went away",
  );
});

test("a refetch that fails partway keeps the pages it did read", async () => {
  const held = reading([{ outcome: "Ok", value: firstPage }, unreachable]);
  const answered = await projectTicketRowsRead(
    { ...projectTicketRowsEmpty, pagesRead: 3 },
    held.readPage,
  );
  expect(ticketsOf(answered)).toStrictEqual([1, 2]);
  expect(answered.outcome === "Ok" && answered.value.failure).toBeDefined();
});

test("a read with no rows behind it answers with the refusal itself", async () => {
  const held = reading([unreachable]);
  const answered = await projectTicketRowsRead(undefined, held.readPage);
  expect(answered.outcome).toBe("Unreachable");
});

test("a refetch reads the pages the reader had and no more, however many the wire offers", async () => {
  const held = reading(
    Array.from({ length: projectTicketPagesMax }, (_unused, at) => ({
      outcome: "Ok" as const,
      value: page(
        [
          {
            ticket: at + 1,
            phase: "Pending" as const,
            sequence: 1,
            ...ticketInstants,
          },
        ],
        "again",
      ),
    })),
  );
  await projectTicketRowsRead(
    { ...projectTicketRowsEmpty, pagesRead: 2 },
    held.readPage,
  );
  expect(held.cursors.length).toBe(2);
});

test("a read stops at the page budget however many the reader asked for", async () => {
  const held = reading(
    Array.from({ length: projectTicketPagesMax }, (_unused, at) => ({
      outcome: "Ok" as const,
      value: page(
        [
          {
            ticket: at + 1,
            phase: "Pending" as const,
            sequence: 1,
            ...ticketInstants,
          },
        ],
        "again",
      ),
    })),
  );
  const answered = await projectTicketRowsRead(
    { ...projectTicketRowsEmpty, pagesRead: projectTicketPagesMax + 5 },
    held.readPage,
  );
  expect(held.cursors.length).toBe(projectTicketPagesMax);
  expect(answered.outcome === "Ok" && answered.value.pagesRead).toBe(
    projectTicketPagesMax,
  );
});

test("a read stops early when the wire says there is no next page", async () => {
  const held = reading([
    {
      outcome: "Ok",
      value: page([
        { ticket: 1, phase: "Done", sequence: 1, ...ticketInstants },
      ]),
    },
  ]);
  await projectTicketRowsRead(
    { ...projectTicketRowsEmpty, pagesRead: 4 },
    held.readPage,
  );
  expect(held.cursors.length).toBe(1);
});
