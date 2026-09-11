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
import { navRoutes, shellNav } from "../app/core/shellNav.ts";

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
    "selector",
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
