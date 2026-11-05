/**
 * The bar's entries, derived: every screen the project holds, each with the
 * route the router registered for it.
 *
 * The standing is what a read supplies, and an entry answers for none when it
 * has not: a bar that drew one would be saying something the console has not
 * been told.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  navEntryCurrent,
  navRoutes,
  shellNav,
  shellSetupNav,
} from "../app/core/shellNav.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

test("every entry names a route of the partition and carries its params", () => {
  const entries = [...shellNav({ partition: atlas }), ...shellSetupNav(atlas)];
  const routes = Object.values(navRoutes);
  for (const entry of entries) {
    expect(routes).toContain(entry.to);
    expect(entry.params).toStrictEqual(atlas);
  }
  expect(entries.map((entry) => entry.id)).toStrictEqual([
    "overview",
    "lead",
    "catalog",
    "settings",
    "repositories",
    "runners",
  ]);
});

test("the lead's standing is drawn only where a read supplied it", () => {
  const silent = shellNav({ partition: atlas });
  expect(silent.find((entry) => entry.id === "lead")?.standing).toBeUndefined();
  const told = shellNav({
    partition: atlas,
    leadStanding: { word: "Working", tone: "live" },
  });
  expect(told.find((entry) => entry.id === "lead")?.standing).toStrictEqual({
    word: "Working",
    tone: "live",
  });
});

function currentAt(pathname: string): readonly string[] {
  return [...shellNav({ partition: atlas }), ...shellSetupNav(atlas)]
    .filter((entry) => navEntryCurrent(entry, pathname))
    .map((entry) => entry.id);
}

test("each screen is current on its own address alone", () => {
  expect(currentAt("/acme/atlas")).toStrictEqual(["overview"]);
  expect(currentAt("/acme/atlas/inbox")).toStrictEqual([]);
  expect(currentAt("/acme/atlas/lead")).toStrictEqual(["lead"]);
  expect(currentAt("/acme/atlas/catalog")).toStrictEqual(["catalog"]);
  expect(currentAt("/acme/atlas/settings")).toStrictEqual(["settings"]);
  expect(currentAt("/acme/atlas/runners")).toStrictEqual(["runners"]);
  expect(currentAt("/acme/atlas/repositories")).toStrictEqual(["repositories"]);
  expect(currentAt("/acme/atlas/repositories/a%2Fb")).toStrictEqual([
    "repositories",
  ]);
});

test("a ticket's page and its edit belong to Tickets, and a new one to none", () => {
  expect(currentAt("/acme/atlas/tickets/7")).toStrictEqual(["overview"]);
  expect(currentAt("/acme/atlas/tickets/7/edit")).toStrictEqual(["overview"]);
  expect(currentAt("/acme/atlas/tickets/new")).toStrictEqual([]);
  expect(currentAt("/acme/atlas/tickets/")).toStrictEqual([]);
});

test("another project's addresses are current for none of this one's entries", () => {
  expect(currentAt("/acme/atlas2")).toStrictEqual([]);
  expect(currentAt("/acme/atlas2/tickets/7")).toStrictEqual([]);
});
