/**
 * What the ticket list draws of a filter's rows: each row's standing, the
 * order a sort puts them in, what a search keeps and what is held back.
 */

import { expect, test } from "vitest";

import type { ProjectTableRow } from "../app/core/projectTableRows.ts";
import {
  ticketListRecentMs,
  ticketListShown,
  ticketListSortOf,
  ticketListStandingOf,
} from "../app/core/ticketListView.ts";

const nowMs = Date.parse("2026-08-27T12:00:00Z");

function row(
  ticket: number,
  phase: ProjectTableRow["phase"],
  over: Partial<ProjectTableRow> = {},
): ProjectTableRow {
  return {
    ticket,
    title: `Ticket ${String(ticket)}`,
    creator: undefined,
    phase,
    badge: undefined,
    executionRead: "NoneRegistered",
    executionVerdict: undefined,
    runsOn: undefined,
    activityAt: "2026-08-27T11:00:00Z",
    openDependencies: [],
    revokedDependencies: [],
    ...over,
  };
}

function view(over: Partial<Parameters<typeof ticketListShown>[1]> = {}) {
  return { sort: "State" as const, search: "", older: 0, nowMs, ...over };
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

test("the number sorts order by ticket and the activity sort by the latest move", () => {
  const rows = [
    row(2, "Work", { activityAt: "2026-08-27T09:00:00Z" }),
    row(3, "Work", { activityAt: "2026-08-27T08:00:00Z" }),
    row(1, "Work", { activityAt: "2026-08-27T10:00:00Z" }),
  ];
  const tickets = (sort: "Newest" | "Oldest" | "Activity") =>
    ticketListShown(rows, view({ sort })).shown.map((one) => one.ticket);
  expect(tickets("Newest")).toEqual([3, 2, 1]);
  expect(tickets("Oldest")).toEqual([1, 2, 3]);
  expect(tickets("Activity")).toEqual([1, 2, 3]);
});

test("a finished row older than a day is held back and revealed newest first", () => {
  const old = (ticket: number, hours: number) =>
    row(ticket, "Done", {
      activityAt: new Date(
        nowMs - ticketListRecentMs - hours * 3_600_000,
      ).toISOString(),
    });
  const rows = [row(1, "Work"), old(2, 5), old(3, 1), row(4, "Done")];
  const held = ticketListShown(rows, view());
  expect(held.shown.map((one) => one.ticket)).toEqual([1, 4]);
  expect(held.active).toBe(2);
  expect(held.remaining).toBe(2);
  const one = ticketListShown(rows, view({ older: 1 }));
  expect(one.shown.map((shown) => shown.ticket)).toEqual([1, 4, 3]);
  expect(one.remaining).toBe(1);
});

test("a row finished after the list's own clock read is the most recent there is, not held back", () => {
  const ahead = row(1, "Done", {
    activityAt: new Date(nowMs + 60_000).toISOString(),
  });
  expect(ticketListShown([ahead], view()).shown).toHaveLength(1);
});

test("an unfinished row is never held back, however old its activity", () => {
  const rows = [row(1, "Escalated", { activityAt: "2020-01-01T00:00:00Z" })];
  expect(ticketListShown(rows, view()).shown).toHaveLength(1);
});

test("a search keeps a title holding it or the number it names", () => {
  const rows = [row(1, "Work", { title: "Fix the gate" }), row(12, "Work")];
  const kept = (search: string) =>
    ticketListShown(rows, view({ search })).shown.map((one) => one.ticket);
  expect(kept("GATE")).toEqual([1]);
  expect(kept("#12")).toEqual([12]);
  expect(kept("12")).toEqual([12]);
  expect(kept("  ")).toEqual([12, 1]);
});
