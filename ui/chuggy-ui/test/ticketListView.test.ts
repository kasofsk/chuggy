/**
 * What the ticket list draws of the rows it read: each row's standing and the
 * order a sort puts them in; and what a sort and a search are asked of the read
 * as, and of the page's address.
 */

import { defaultParseSearch } from "@tanstack/react-router";
import { expect, test } from "vitest";

import type { ProjectTableRow } from "../app/core/projectTableRows.ts";
import {
  nativeHttpPathSegmentCharsMax,
  ticketSearchCharsMax,
} from "../../../src/contract/http.ts";
import {
  ticketListCountTapped,
  ticketListCreatorsOffered,
  ticketListFiltered,
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
  expect(ticketListQueryOf({ q: ["gate"] })).toStrictEqual({});
});

test("the address holds a filter naming All, a phase or a pending standing, and drops one naming none", () => {
  expect(ticketListQueryOf({ filter: "Escalated" })).toStrictEqual({
    filter: "Escalated",
  });
  expect(ticketListQueryOf({ filter: "All" })).toStrictEqual({ filter: "All" });
  for (const filter of ["Ready", "Blocked"] as const)
    expect(ticketListQueryOf({ filter })).toStrictEqual({ filter });
  for (const filter of ["NeedsYou", "escalated", "ready", ["Done"], 3, null])
    expect(ticketListQueryOf({ filter })).toStrictEqual({});
});

test("a search written by hand in the address is read as the text it was", () => {
  for (const [address, q] of [
    ["?q=121", "121"],
    ["?q=%23121", "#121"],
    ["?q=true", "true"],
    ["?q=null", "null"],
    ["?q=%20", undefined],
    ["?q=%22121%22", "121"],
  ] as const) {
    expect(ticketListQueryOf(defaultParseSearch(address))).toStrictEqual(
      q === undefined ? {} : { q },
    );
  }
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

test("a filter written to the address keeps the search and the sort, and All is written as itself", () => {
  expect(
    ticketListQueryWith({ q: "gate", sort: "Oldest" }, { filter: "Done" }),
  ).toStrictEqual({ q: "gate", sort: "Oldest", filter: "Done" });
  expect(
    ticketListQueryWith({ filter: "Done" }, { filter: "All" }),
  ).toStrictEqual({ filter: "All" });
  expect(
    ticketListQueryWith({ filter: "Done" }, { sort: "Newest" }),
  ).toStrictEqual({ sort: "Newest", filter: "Done" });
  expect(ticketListQueryWith({ filter: "Done" }, { q: "gate" })).toStrictEqual({
    q: "gate",
    filter: "Done",
  });
});

test("a standing's filter draws the pending rows that stand in it, and any other filter every row read", () => {
  const rows = [
    row(1, "Pending"),
    row(2, "Pending", { revokedDependencies: [9] }),
    row(3, "Pending", { openDependencies: [{ ticket: 8, phase: "Work" }] }),
    row(4, "Work"),
  ];
  const drawn = (filter: Parameters<typeof ticketListFiltered>[1]) =>
    ticketListFiltered(rows, filter).map((each) => each.ticket);
  expect(drawn("Ready")).toStrictEqual([1]);
  expect(drawn("Blocked")).toStrictEqual([2, 3]);
  for (const filter of ["All", "Pending", "Work"] as const)
    expect(drawn(filter), filter).toStrictEqual([1, 2, 3, 4]);
});

test("a state's count tapped filters to that state, and tapped as the filter goes back to every ticket", () => {
  for (const standing of ["Ready", "Blocked", "Work", "Escalated"] as const) {
    expect(ticketListCountTapped("All", standing)).toBe(standing);
    expect(ticketListCountTapped("Pending", standing)).toBe(standing);
    expect(ticketListCountTapped(standing, standing)).toBe("All");
  }
  expect(ticketListCountTapped("Ready", "Blocked")).toBe("Blocked");
});

test("the address holds a creator as the text it was written as, and drops one the server would refuse", () => {
  const issued = "17:https://idp.test/s-ada";
  expect(
    ticketListQueryOf(
      defaultParseSearch(`?creator=${encodeURIComponent(issued)}`),
    ),
  ).toStrictEqual({ creator: issued });
  expect(ticketListQueryOf(defaultParseSearch("?creator=121"))).toStrictEqual({
    creator: "121",
  });
  for (const creator of [
    "",
    "\u0000",
    "p".repeat(nativeHttpPathSegmentCharsMax + 1),
    ["s-ada"],
  ])
    expect(ticketListQueryOf({ creator })).toStrictEqual({});
  expect(
    ticketListQueryWith(
      { filter: "Done", q: "gate", creator: issued },
      { creator: undefined },
    ),
  ).toStrictEqual({ filter: "Done", q: "gate" });
  expect(
    ticketListQueryWith({ filter: "Done" }, { creator: issued }),
  ).toStrictEqual({ filter: "Done", creator: issued });
});

test("the creators offered are the project's people under the reader's issuer, the reader apart, and the creator the address names", () => {
  const reader = "17:https://idp.test/s-ada";
  expect(
    ticketListCreatorsOffered(reader, ["s-ada", "s-bob"], undefined),
  ).toStrictEqual(["17:https://idp.test/s-bob"]);
  expect(
    ticketListCreatorsOffered(reader, ["s-bob"], "9:elsewheres-cy"),
  ).toStrictEqual(["17:https://idp.test/s-bob", "9:elsewheres-cy"]);
  expect(
    ticketListCreatorsOffered(reader, ["s-bob"], "17:https://idp.test/s-bob"),
  ).toStrictEqual(["17:https://idp.test/s-bob"]);
  expect(
    ticketListCreatorsOffered(undefined, ["s-bob"], undefined),
  ).toStrictEqual([]);
});
