/**
 * What a filter asks the wire for, what it reads and writes under, and when it
 * offers a next page.
 */

import { expect, test } from "vitest";

import { nativeHttpPageItemsMax } from "../../../src/contract/http.ts";
import {
  ticketFilterAll,
  ticketFilterList,
  ticketFilterMoreCursor,
  ticketFilterPage,
  ticketFilterPhases,
} from "../app/core/projectTableFilters.ts";
import type { TicketFilter } from "../app/core/projectTableFilters.ts";
import {
  projectTicketPagesMax,
  projectTicketRowsEmpty,
  projectTicketRowsMax,
} from "../app/core/projectTicketPages.ts";
import { ticketSectionRoster } from "../app/core/ticketSections.ts";

const partition = { tenant: "acme", project: "atlas" };

const filters: readonly TicketFilter[] = [
  ticketFilterAll,
  ...ticketSectionRoster,
];

test("every filter reads and writes under a key of its own", () => {
  const keys = filters.map((filter) =>
    JSON.stringify(ticketFilterList(partition, filter).key),
  );
  expect(new Set(keys).size).toBe(keys.length);
});

test("a filter's key stays under its partition, so a reset still reaches it", () => {
  const key = ticketFilterList(partition, "NeedsYou").key;
  expect(key.slice(0, 3)).toStrictEqual(["project", "acme", "atlas"]);
});

test("a section filter asks the wire for that section's phases and no others", () => {
  expect(ticketFilterPhases("NeedsYou")).toStrictEqual([
    "HandoffBlocked",
    "Escalated",
  ]);
  expect(ticketFilterPage("NeedsYou", undefined).phase).toStrictEqual([
    "HandoffBlocked",
    "Escalated",
  ]);
});

test("no section filter asks for an empty phase list", () => {
  for (const section of ticketSectionRoster)
    expect(ticketFilterPhases(section)?.length).toBeGreaterThan(0);
});

test("the unfiltered read names no phase at all", () => {
  expect(ticketFilterPhases(ticketFilterAll)).toBeUndefined();
  expect(ticketFilterPage(ticketFilterAll, undefined).phase).toBeUndefined();
});

test("every page asks for recent activity and states the size it wants", () => {
  const page = ticketFilterPage(ticketFilterAll, undefined);
  expect(page.order).toBe("RecentActivity");
  expect(page.limit).toBe(nativeHttpPageItemsMax);
  expect(page.cursor).toBeUndefined();
});

test("a page after the first carries the cursor it was given", () => {
  expect(ticketFilterPage("UpNext", "opaque").cursor).toBe("opaque");
});

test("more is offered with the cursor the last page answered with", () => {
  expect(
    ticketFilterMoreCursor({
      ...projectTicketRowsEmpty,
      pagesRead: 1,
      nextCursor: "after-one",
    }),
  ).toBe("after-one");
});

test("more is not offered past a bound or without a cursor", () => {
  expect(
    ticketFilterMoreCursor({ ...projectTicketRowsEmpty, pagesRead: 1 }),
  ).toBeUndefined();
  expect(
    ticketFilterMoreCursor({
      ...projectTicketRowsEmpty,
      pagesRead: projectTicketPagesMax,
      nextCursor: "again",
    }),
  ).toBeUndefined();
  expect(
    ticketFilterMoreCursor({
      ...projectTicketRowsEmpty,
      pagesRead: 1,
      nextCursor: "again",
      tickets: Array.from({ length: projectTicketRowsMax }, (_unused, at) => ({
        ticket: at + 1,
        phase: "Pending" as const,
        sequence: 1,
      })),
    }),
  ).toBeUndefined();
});
