/**
 * What a filter, an order and a search ask the wire for, and what they read and
 * write under.
 */

import { expect, test } from "vitest";

import { nativeHttpPageItemsMax } from "../../../src/contract/http.ts";
import {
  ticketFilterAll,
  ticketFilterList,
  ticketFilterOf,
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

/** A filter for each read the wire is asked: every ticket, or one phase. */
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

test("a word names All, a phase or a pending standing, and nothing else", () => {
  for (const filter of [...filters, "Ready", "Blocked"])
    expect(ticketFilterOf(filter)).toBe(filter);
  for (const word of ["ready", "NeedsYou", undefined, 3])
    expect(ticketFilterOf(word)).toBeUndefined();
});

/** Ready and Blocked are standings of Pending, which is all the wire can
 * name, so either reads what Pending reads, under Pending's entry. */
test("a pending standing's filter asks the wire for Pending, under Pending's entry", () => {
  for (const standing of ["Ready", "Blocked"] as const) {
    expect(ticketFilterPhases(standing)).toStrictEqual(["Pending"]);
    for (const order of ["RecentActivity", "Oldest"] as const) {
      const ask = { filter: standing, order, search: undefined };
      const pending = { ...ask, filter: "Pending" as const };
      expect(ticketFilterList(partition, ask).key).toStrictEqual(
        ticketFilterList(partition, pending).key,
      );
      expect(ticketFilterReadsCount(ask)).toBe(ticketFilterReadsCount(pending));
      expect(ticketFilterPage(ask, first)).toStrictEqual(
        ticketFilterPage(pending, first),
      );
    }
    expect(ticketFilterProjectEmpty(filtered(standing), ended)).toBe(false);
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
      failure: { outcome: "Unreachable", reason: "offline" },
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

test("a creator's list is its own entry, read again on a frame, and asked of every read", () => {
  const asks: TicketListAsk[] = [
    undefined,
    "8:https://idp/alice",
    "bob",
  ].flatMap((creator) =>
    [undefined, "gate", "gate:bob"].map((search) => ({
      ...ticketListAskDefault,
      search,
      creator,
    })),
  );
  const keys = asks.map((ask) =>
    JSON.stringify(ticketFilterList(partition, ask).key),
  );
  expect(new Set(keys).size).toBe(keys.length);
  for (const filter of filters) {
    const ask = { ...filtered(filter), creator: "bob" };
    expect(ticketFilterList(partition, ask).refresh.refresh).toBe("Reread");
    expect(ticketFilterReadsCount(ask)).toBe(1);
    expect(ticketFilterPage(ask, first).creator).toBe("bob");
    expect(
      ticketFilterPage({ ...ask, search: "gate", order: "Oldest" }, first),
    ).toMatchObject({ creator: "bob", q: "gate", order: "Oldest" });
    expect(ticketFilterProjectEmpty(ask, ended)).toBe(false);
  }
});
