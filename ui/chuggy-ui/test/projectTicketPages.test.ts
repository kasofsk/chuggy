/**
 * What a page, a live `Ticket` frame and a refused read each do to the rows the
 * table holds.
 *
 * Every case is the pages and the rows they draw on their own, with no cache
 * and no renderer, because that is where a row moving between sections is
 * decided. What the cache does with a page is `projectTableRead.test.ts`'s.
 */

import { expect, test } from "vitest";

import { nativeHttpPageItemsMax } from "../../../src/contract/http.ts";
import type {
  ProjectResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  projectTicketPageOf,
  projectTicketPageRead,
  projectTicketPagesMax,
  projectTicketPagesNext,
  projectTicketPagesReadPast,
  projectTicketRowsFirst,
  projectTicketRowsFold,
  projectTicketRowsHaveMore,
  projectTicketRowsMax,
  projectTicketRowsOf,
  projectTicketRowsRereads,
} from "../app/core/projectTicketPages.ts";
import type {
  ProjectTicketPage,
  ProjectTicketPages,
  ProjectTicketRows,
} from "../app/core/projectTicketPages.ts";
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

/** The pages read one after another, each from where the one before it said
 * the next begins, as the cache holds them. */
function pagesOf(
  responses: readonly ProjectResponse[],
  reads = 1,
): ProjectTicketPages {
  const pages: ProjectTicketPage[] = [];
  const pageParams = [];
  let at = projectTicketRowsFirst;
  for (const response of responses) {
    const read = projectTicketPageOf(at, response, reads);
    pages.push(read);
    pageParams.push(at);
    at = read.next ?? at;
  }
  return { pages, pageParams };
}

function rowsOf(
  responses: readonly ProjectResponse[],
  reads = 1,
): ProjectTicketRows {
  return projectTicketRowsOf(pagesOf(responses, reads));
}

const firstPage = page(
  [
    { ticket: 1, phase: "Work", sequence: 4, ...ticketInstants },
    { ticket: 2, phase: "Pending", sequence: 3, ...ticketInstants },
  ],
  "after-one",
);

test("a page appends its tickets and carries the cursor it answered with", () => {
  const rows = rowsOf([firstPage]);
  expect(rows.tickets.map((ticket) => ticket.ticket)).toStrictEqual([1, 2]);
  expect(rows.next?.cursor).toBe("after-one");
  expect(rows.pagesRead).toBe(1);
  expect(projectTicketRowsHaveMore(rows)).toBe(true);
});

test("a second page appends after the first and repeats no ticket", () => {
  const second = rowsOf([
    firstPage,
    page([
      { ticket: 2, phase: "Pending", sequence: 3, ...ticketInstants },
      { ticket: 3, phase: "Done", sequence: 2, ...ticketInstants },
    ]),
  ]);
  expect(second.tickets.map((ticket) => ticket.ticket)).toStrictEqual([
    1, 2, 3,
  ]);
  expect(second.next).toBeUndefined();
  expect(projectTicketRowsHaveMore(second)).toBe(false);
});

test("the rows are bounded however many a page walk keeps handing over", () => {
  const rows = rowsOf(
    Array.from({ length: projectTicketPagesMax + 4 }, (_unused, read) =>
      pendingPage(read * nativeHttpPageItemsMax + 1, "again"),
    ),
  );
  expect(rows.tickets.length).toBe(projectTicketRowsMax);
});

test("the row cap stops a walk the page budget has not stopped", () => {
  const responses: ProjectResponse[] = [];
  do
    responses.push(
      pendingPage(responses.length * nativeHttpPageItemsMax + 1, "again"),
    );
  while (projectTicketPagesNext(pagesOf(responses)) !== undefined);
  const rows = rowsOf(responses);
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
  expect(rowsOf([oversized]).tickets.length).toBe(projectTicketRowsMax);
});

test("a page walk stops at the page budget even while a cursor is offered", () => {
  const pages = pagesOf(
    Array.from({ length: projectTicketPagesMax }, (_unused, read) =>
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
    ),
  );
  expect(projectTicketRowsOf(pages).next?.cursor).toBe("again");
  expect(projectTicketRowsHaveMore(projectTicketRowsOf(pages))).toBe(false);
  expect(projectTicketPagesNext(pages)).toBeUndefined();
});

test("a ticket frame moves a row into another section without disturbing the rest", () => {
  const rows = rowsOf([firstPage]);
  const folded = projectTicketRowsFold(
    rows,
    "1",
    {
      ticket: 1,
      phase: "Escalated",
      sequence: 7,
      escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
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

/** The frame carries no latest execution, so the row is the read's to answer. */
test("a ticket the list has not got is read again for rather than folded in", () => {
  const rows = rowsOf([firstPage]);
  const arriving = { ticket: 9, phase: "Work", sequence: 8, ...ticketInstants };
  expect(projectTicketRowsFold(rows, "9", arriving, undefined)).toStrictEqual(
    rows,
  );
  expect(projectTicketRowsRereads(rows, arriving, undefined)).toBe(true);
  expect(projectTicketRowsRereads(rows, arriving, ["Pending"])).toBe(false);
  expect(
    projectTicketRowsRereads(rows, { ...arriving, ticket: 1 }, undefined),
  ).toBe(false);
  expect(projectTicketRowsRereads(rows, null, undefined)).toBe(false);
  expect(projectTicketRowsRereads(rows, { ticket: "x" }, undefined)).toBe(
    false,
  );
  expect(projectTicketRowsRereads(undefined, arriving, undefined)).toBe(false);
});

test("a filtered list drops the ticket that left the filter", () => {
  const folded = projectTicketRowsFold(
    rowsOf([firstPage]),
    "2",
    { ticket: 2, phase: "Done", sequence: 8, ...ticketInstants },
    ["Pending"],
  );
  expect(folded?.tickets.map((ticket) => ticket.ticket)).toStrictEqual([1]);
});

test("a tombstone removes the row it names and a frame that will not read removes none", () => {
  const rows = rowsOf([firstPage]);
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
      { ticket: 1, phase: "Work", sequence: 1, ...ticketInstants },
      undefined,
    ),
  ).toBeUndefined();
});

test("a list of two reads goes on to the second as the first ends, and draws a row both hold once", () => {
  const first = rowsOf(
    [page([{ ticket: 2, phase: "Done", sequence: 3, ...ticketInstants }])],
    2,
  );
  expect(first.next).toStrictEqual({ read: 1, cursor: undefined });
  const second = rowsOf(
    [
      page([{ ticket: 2, phase: "Done", sequence: 3, ...ticketInstants }]),
      page([
        { ticket: 2, phase: "Done", sequence: 3, ...ticketInstants },
        { ticket: 1, phase: "Done", sequence: 1, ...ticketInstants },
      ]),
    ],
    2,
  );
  expect(second.tickets.map((ticket) => ticket.ticket)).toStrictEqual([2, 1]);
  expect(second.next).toBeUndefined();
});

test("the count a search matched is the last page's", () => {
  const matched = { ...firstPage, matched: 7 };
  expect(rowsOf([matched]).matched).toBe(7);
  expect(rowsOf([matched, page([])]).matched).toBeUndefined();
});

test("a press reads past a page holding only rows already drawn, and not past one that adds a row", () => {
  const held = page([
    { ticket: 2, phase: "Done", sequence: 3, ...ticketInstants },
  ]);
  expect(projectTicketPagesReadPast(pagesOf([held, held], 2))).toBe(true);
  expect(
    projectTicketPagesReadPast(
      pagesOf(
        [
          held,
          page([
            { ticket: 2, phase: "Done", sequence: 3, ...ticketInstants },
            { ticket: 1, phase: "Done", sequence: 1, ...ticketInstants },
          ]),
        ],
        2,
      ),
    ),
  ).toBe(false);
});

const unreachable: ApiResult<ProjectResponse> = {
  outcome: "Unreachable",
  reason: "the network went away",
};

/** Reads the same answers on every pass, recording what each pass asked for. */
function readingTwoReads(answers: readonly (readonly ProjectResponse[])[]): {
  readonly readPage: (
    cursor: string | undefined,
    read: number,
  ) => Promise<ApiResult<ProjectResponse>>;
  readonly asked: [string | undefined, number][];
} {
  const asked: [string | undefined, number][] = [];
  return {
    asked,
    readPage: (cursor, read) => {
      asked.push([cursor, read]);
      const pages = answers[read] ?? [];
      const answer =
        cursor === undefined ? pages[0] : pages[Number(cursor.slice(-1))];
      if (answer === undefined) throw new Error("a page nobody offered");
      return Promise.resolve({ outcome: "Ok", value: answer });
    },
  };
}

test("a page is read where it is asked for, and its refusal is the read's answer", async () => {
  const held = readingTwoReads([[firstPage, page([])]]);
  const read = await projectTicketPageRead(held.readPage, {
    read: 0,
    cursor: "after-1",
  });
  expect(held.asked).toStrictEqual([["after-1", 0]]);
  expect(read.outcome === "Ok" && read.value.next).toBeUndefined();
  expect(
    await projectTicketPageRead(
      () => Promise.resolve(unreachable),
      projectTicketRowsFirst,
    ),
  ).toStrictEqual(unreachable);
});

test("a first read draws only its first page even where that page is empty", async () => {
  const held = readingTwoReads([
    [page([])],
    [page([{ ticket: 1, phase: "Done", sequence: 1, ...ticketInstants }])],
  ]);
  const answered = await projectTicketPageRead(
    held.readPage,
    projectTicketRowsFirst,
    2,
  );
  expect(held.asked).toStrictEqual([
    [undefined, 0],
    [undefined, 1],
  ]);
  expect(answered.outcome === "Ok" && answered.value.tickets).toStrictEqual([]);
  expect(answered.outcome === "Ok" && answered.value.next).toStrictEqual({
    read: 1,
    cursor: undefined,
  });
});

test("a first read whose every read is empty has nothing left to offer", async () => {
  const held = readingTwoReads([[page([])], [page([])]]);
  const answered = await projectTicketPageRead(
    held.readPage,
    projectTicketRowsFirst,
    2,
  );
  expect(answered.outcome === "Ok" && answered.value.next).toBeUndefined();
});

test("a page after the first that is empty asks no read after it", async () => {
  const held = readingTwoReads([[page([])], [page([])]]);
  const answered = await projectTicketPageRead(
    held.readPage,
    { read: 1, cursor: undefined },
    2,
  );
  expect(held.asked).toStrictEqual([[undefined, 1]]);
  expect(answered.outcome === "Ok" && answered.value.next).toBeUndefined();
});
