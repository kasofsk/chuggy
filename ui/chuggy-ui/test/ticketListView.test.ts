/**
 * What the ticket list draws of the rows it read: each row's standing and the
 * order a sort puts them in; and what a sort and a search are asked of the read
 * as, and of the page's address.
 */

import { expect, test } from "vitest";

import type { ProjectTableRow } from "../app/core/projectTableRows.ts";
import { ticketSearchCharsMax } from "../../../src/contract/http.ts";
import {
  ticketListQueryOf,
  ticketListQueryWith,
  ticketListSearchOf,
  ticketListShown,
  ticketListSortOf,
  ticketListSortOrder,
  ticketListStandingOf,
} from "../app/core/ticketListView.ts";

function row(
  ticket: number,
  phase: ProjectTableRow["phase"],
  over: Partial<ProjectTableRow> = {},
): ProjectTableRow {
  return {
    ticket,
    title: `Ticket ${String(ticket)}`,
    repository: undefined,
    creator: undefined,
    phase,
    sequence: 1,
    badge: undefined,
    executionVerdict: undefined,
    runsOn: undefined,
    activityAt: "2026-08-27T11:00:00Z",
    openDependencies: [],
    revokedDependencies: [],
    ...over,
  };
}

test("a pending row is ready with nothing open or revoked, and blocked otherwise", () => {
  expect(ticketListStandingOf(row(1, "Pending"))).toBe("Ready");
  expect(
    ticketListStandingOf(
      row(1, "Pending", {
        openDependencies: [{ ticket: 2, phase: "Work" }],
      }),
    ),
  ).toBe("Blocked");
  expect(
    ticketListStandingOf(row(1, "Pending", { revokedDependencies: [2] })),
  ).toBe("Blocked");
  expect(ticketListStandingOf(row(1, "Work"))).toBe("Work");
});

test("a stored word that names no sort is the state sort", () => {
  expect(ticketListSortOf("Oldest")).toBe("Oldest");
  expect(ticketListSortOf("newest")).toBe("State");
  expect(ticketListSortOf(null)).toBe("State");
});

test("the orders by number draw the rows as read, and the activity sort by the latest move", () => {
  const rows = [
    row(2, "Work", { activityAt: "2026-08-27T09:00:00Z" }),
    row(3, "Work", { activityAt: "2026-08-27T08:00:00Z" }),
    row(1, "Work", { activityAt: "2026-08-27T10:00:00Z" }),
  ];
  const tickets = (sort: "Newest" | "Oldest" | "Activity") =>
    ticketListShown(rows, sort).map((one) => one.ticket);
  expect(tickets("Newest")).toEqual([2, 3, 1]);
  expect(tickets("Oldest")).toEqual([2, 3, 1]);
  expect(tickets("Activity")).toEqual([1, 2, 3]);
});

test("the orders by number are the read's, and State and Activity read by recent activity", () => {
  expect(ticketListSortOrder("Newest")).toBe("Newest");
  expect(ticketListSortOrder("Oldest")).toBe("Oldest");
  expect(ticketListSortOrder("State")).toBe("RecentActivity");
  expect(ticketListSortOrder("Activity")).toBe("RecentActivity");
});

test("a search is asked trimmed and within the server's bound, and nothing typed asks none", () => {
  expect(ticketListSearchOf("  #121 ")).toBe("#121");
  expect(ticketListSearchOf("   ")).toBeUndefined();
  expect(
    [...(ticketListSearchOf("é".repeat(ticketSearchCharsMax + 5)) ?? "")]
      .length,
  ).toBe(ticketSearchCharsMax);
});

test("the address holds a search and a sort, and drops what names neither", () => {
  expect(ticketListQueryOf({ q: " gate ", sort: "Oldest" })).toStrictEqual({
    q: "gate",
    sort: "Oldest",
  });
  expect(ticketListQueryOf({ q: "  ", sort: "Sideways" })).toStrictEqual({});
  expect(ticketListQueryOf({ q: 121 })).toStrictEqual({});
});

test("a search or a sort written to the address keeps the other, and State is written as no sort", () => {
  expect(ticketListQueryWith({ sort: "Oldest" }, { q: "gate" })).toStrictEqual({
    q: "gate",
    sort: "Oldest",
  });
  expect(ticketListQueryWith({ q: "gate" }, { sort: "State" })).toStrictEqual({
    q: "gate",
  });
  expect(
    ticketListQueryWith({ q: "gate", sort: "Newest" }, { q: undefined }),
  ).toStrictEqual({ sort: "Newest" });
});
