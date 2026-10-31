/**
 * What a filter, an order and a search ask the wire for, and what they read and
 * write under.
 */

import { expect, test } from "vitest";

import { nativeHttpPageItemsMax } from "../../../src/contract/http.ts";
import {
  ticketFilterAll,
  ticketFilterList,
  ticketFilterPage,
  ticketFilterPhases,
  ticketFilterProjectEmpty,
  ticketFilterReadsCount,
  ticketListAskDefault,
} from "../app/core/projectTableFilters.ts";
import type {
  TicketFilter,
  TicketListAsk,
} from "../app/core/projectTableFilters.ts";
import { projectTicketRowsEmpty } from "../app/core/projectTicketPages.ts";
import { phaseRoster } from "../../../src/contract/rosters.ts";
import { ticketInstants } from "./ticketInstants.ts";

const partition = { tenant: "acme", project: "atlas" };

const filters: readonly TicketFilter[] = [ticketFilterAll, ...phaseRoster];

function filtered(filter: TicketFilter): TicketListAsk {
  return { ...ticketListAskDefault, filter };
}

const first = { read: 0, cursor: undefined };

/** Rows holding nothing, with nothing left to read. */
const ended = { ...projectTicketRowsEmpty, pagesRead: 1 };

test("every filter, order and search reads and writes under a key of its own", () => {
  const asks: TicketListAsk[] = filters.flatMap((filter) =>
    (["RecentActivity", "Newest", "Oldest"] as const).flatMap((order) => [
      { filter, order, search: undefined },
      { filter, order, search: "gate" },
    ]),
  );
  const keys = asks.map((ask) =>
    JSON.stringify(ticketFilterList(partition, ask).key),
  );
  expect(new Set(keys).size).toBe(keys.length);
});

test("a filter's key stays under its partition, so a reset still reaches it", () => {
  const key = ticketFilterList(partition, filtered("Escalated")).key;
  expect(key.slice(0, 3)).toStrictEqual(["project", "acme", "atlas"]);
});

test("the active list folds a frame in, and a searched or numbered one reads again", () => {
  expect(
    ticketFilterList(partition, ticketListAskDefault).refresh.refresh,
  ).toBe("FoldElseReread");
  expect(
    ticketFilterList(partition, { ...ticketListAskDefault, search: "gate" })
      .refresh.refresh,
  ).toBe("Reread");
  for (const order of ["Newest", "Oldest"] as const)
    expect(
      ticketFilterList(partition, { ...ticketListAskDefault, order }).refresh
        .refresh,
    ).toBe("Reread");
});

test("a phase filter asks the wire for that phase and no other", () => {
  for (const phase of phaseRoster) {
    expect(ticketFilterPhases(phase)).toStrictEqual([phase]);
    expect(ticketFilterPage(filtered(phase), first).phase).toStrictEqual([
      phase,
    ]);
  }
});

test("the active list asks for what is active by recent activity, at the size it wants", () => {
  expect(ticketFilterPage(ticketListAskDefault, first)).toStrictEqual({
    order: "RecentActivity",
    limit: nativeHttpPageItemsMax,
    active: true,
  });
});

test("the active list goes on to what finished before the window, in the phases its filter admits", () => {
  expect(ticketFilterReadsCount(ticketListAskDefault)).toBe(2);
  expect(
    ticketFilterPage(ticketListAskDefault, { read: 1, cursor: undefined }),
  ).toStrictEqual({
    order: "RecentActivity",
    limit: nativeHttpPageItemsMax,
    phase: ["Done", "Revoked"],
  });
  expect(
    ticketFilterPage(filtered("Done"), { read: 1, cursor: undefined }).phase,
  ).toStrictEqual(["Done"]);
  expect(ticketFilterReadsCount(filtered("Work"))).toBe(1);
});

test("a search and an order by number are one read of the whole project", () => {
  const searched = { ...ticketListAskDefault, search: "#121" };
  expect(ticketFilterReadsCount(searched)).toBe(1);
  expect(ticketFilterPage(searched, first)).toStrictEqual({
    order: "RecentActivity",
    limit: nativeHttpPageItemsMax,
    q: "#121",
  });
  const oldest = { ...ticketListAskDefault, order: "Oldest" as const };
  expect(ticketFilterReadsCount(oldest)).toBe(1);
  expect(ticketFilterPage(oldest, first)).toStrictEqual({
    order: "Oldest",
    limit: nativeHttpPageItemsMax,
  });
});

test("a page after the first carries the cursor it was given", () => {
  expect(
    ticketFilterPage(filtered("Pending"), { read: 0, cursor: "opaque" }).cursor,
  ).toBe("opaque");
});

test("only the unfiltered, unsearched list, holding nothing and with nothing left to read, says the project is empty", () => {
  expect(ticketFilterProjectEmpty(ticketListAskDefault, ended)).toBe(true);
  for (const phase of phaseRoster)
    expect(ticketFilterProjectEmpty(filtered(phase), ended), phase).toBe(false);
  expect(
    ticketFilterProjectEmpty({ ...ticketListAskDefault, search: "x" }, ended),
  ).toBe(false);
  expect(
    ticketFilterProjectEmpty(ticketListAskDefault, {
      ...ended,
      next: { read: 1, cursor: undefined },
    }),
  ).toBe(false);
  expect(
    ticketFilterProjectEmpty(ticketListAskDefault, {
      ...ended,
      failure: "Unreachable",
    }),
  ).toBe(false);
  expect(
    ticketFilterProjectEmpty(ticketListAskDefault, {
      ...ended,
      tickets: [
        { ticket: 1, phase: "Pending", sequence: 1, ...ticketInstants },
      ],
    }),
  ).toBe(false);
});
