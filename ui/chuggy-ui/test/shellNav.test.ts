/**
 * The bar's entries, derived: every screen the project holds, each with the
 * route the router registered for it.
 *
 * The counts and the standing are what the reads supply, and an entry answers
 * for neither when they have not: a bar that drew a zero would be saying
 * something the console has not been told.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { navEntryCurrent, navRoutes, shellNav } from "../app/core/shellNav.ts";
import { abilitiesEvery, abilitiesNone } from "./projectAbilitiesFixture.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

test("every entry names a route of the partition and carries its params", () => {
  const entries = shellNav({ partition: atlas });
  const routes = Object.values(navRoutes);
  for (const entry of entries) {
    expect(routes).toContain(entry.to);
    expect(entry.params).toStrictEqual(atlas);
  }
  expect(entries.map((entry) => entry.id)).toStrictEqual([
    "overview",
    "inbox",
    "lead",
    "settings",
    "repositories",
    "runners",
    "ticket-new",
  ]);
});

test("the inbox count and the lead's standing are drawn only where a read supplied them", () => {
  const silent = shellNav({ partition: atlas });
  expect(silent.find((entry) => entry.id === "inbox")?.count).toBeUndefined();
  expect(silent.find((entry) => entry.id === "lead")?.standing).toBeUndefined();
  const told = shellNav({
    partition: atlas,
    inboxCount: "3",
    leadStanding: { word: "Working", tone: "live" },
  });
  expect(told.find((entry) => entry.id === "inbox")?.count).toBe("3");
  expect(told.find((entry) => entry.id === "lead")?.standing).toStrictEqual({
    word: "Working",
    tone: "live",
  });
});

function entryIds(abilities: Parameters<typeof shellNav>[0]["abilities"]) {
  return shellNav({ partition: atlas, abilities }).map((entry) => entry.id);
}

test("New ticket is left out only for a reader the abilities read said may not mutate", () => {
  expect(entryIds({ ...abilitiesEvery, mutate: false })).toStrictEqual([
    "overview",
    "inbox",
    "lead",
    "settings",
    "repositories",
    "runners",
  ]);
  expect(entryIds(abilitiesEvery).at(-1)).toBe("ticket-new");
  expect(entryIds({ ...abilitiesNone, mutate: true }).at(-1)).toBe(
    "ticket-new",
  );
  expect(entryIds(undefined).at(-1)).toBe("ticket-new");
});

function currentAt(pathname: string): readonly string[] {
  return shellNav({ partition: atlas })
    .filter((entry) => navEntryCurrent(entry, pathname))
    .map((entry) => entry.id);
}

test("each screen is current on its own address alone", () => {
  expect(currentAt("/acme/atlas")).toStrictEqual(["overview"]);
  expect(currentAt("/acme/atlas/inbox")).toStrictEqual(["inbox"]);
  expect(currentAt("/acme/atlas/lead")).toStrictEqual(["lead"]);
  expect(currentAt("/acme/atlas/settings")).toStrictEqual(["settings"]);
  expect(currentAt("/acme/atlas/runners")).toStrictEqual(["runners"]);
  expect(currentAt("/acme/atlas/repositories")).toStrictEqual(["repositories"]);
  expect(currentAt("/acme/atlas/repositories/a%2Fb")).toStrictEqual([
    "repositories",
  ]);
});

test("a ticket's page and its edit belong to Tickets, and a new one to New ticket", () => {
  expect(currentAt("/acme/atlas/tickets/7")).toStrictEqual(["overview"]);
  expect(currentAt("/acme/atlas/tickets/7/edit")).toStrictEqual(["overview"]);
  expect(currentAt("/acme/atlas/tickets/new")).toStrictEqual(["ticket-new"]);
  expect(currentAt("/acme/atlas/tickets/")).toStrictEqual([]);
});

test("another project's addresses are current for none of this one's entries", () => {
  expect(currentAt("/acme/atlas2")).toStrictEqual([]);
  expect(currentAt("/acme/atlas2/tickets/7")).toStrictEqual([]);
});
