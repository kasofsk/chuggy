/**
 * The bar's entries, derived: every screen the project holds, each with the
 * route the router registered for it.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import {
  navEntryCurrent,
  navRoutes,
  shellNav,
  shellSetupNav,
} from "../app/core/shellNav.ts";
import { settingsRoutes } from "../app/core/settingsNav.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

test("every entry names a route of the partition and carries its params", () => {
  const entries = [...shellNav({ partition: atlas }), ...shellSetupNav(atlas)];
  const routes = [...Object.values(navRoutes), settingsRoutes.project.myRunner];
  for (const entry of entries) {
    expect(routes).toContain(entry.to);
    expect(entry.params).toStrictEqual(atlas);
  }
  expect(entries.map((entry) => entry.id)).toStrictEqual([
    "overview",
    "epics",
    "catalog",
    "settings",
    "repositories",
    "runners",
  ]);
});

test("every entry is labelled by a catalog id, which reads as the screen's name", () => {
  const entries = [...shellNav({ partition: atlas }), ...shellSetupNav(atlas)];
  expect(entries.map((entry) => entry.label)).toStrictEqual([
    { id: "shell-nav-tickets" },
    { id: "shell-nav-epics" },
    { id: "shell-nav-catalog" },
    { id: "shell-nav-settings" },
    { id: "shell-nav-repositories" },
    { id: "shell-nav-runners" },
  ]);
  expect(entries.map((entry) => copyTextEn(entry.label))).toStrictEqual([
    "Tickets",
    "Epics",
    "Catalog",
    "Project settings",
    "Repositories",
    "Runners",
  ]);
});

function currentAt(pathname: string): readonly string[] {
  return [...shellNav({ partition: atlas }), ...shellSetupNav(atlas)]
    .filter((entry) => navEntryCurrent(entry, pathname))
    .map((entry) => entry.id);
}

test("each screen is current on its own address alone", () => {
  expect(currentAt("/acme/atlas")).toStrictEqual(["overview"]);
  expect(currentAt("/acme/atlas/inbox")).toStrictEqual([]);
  expect(currentAt("/acme/atlas/epics")).toStrictEqual(["epics"]);
  expect(currentAt("/acme/atlas/epics/7")).toStrictEqual(["epics"]);
  expect(currentAt("/acme/atlas/catalog")).toStrictEqual(["catalog"]);
  expect(currentAt("/acme/atlas/settings")).toStrictEqual(["settings"]);
  expect(currentAt("/acme/atlas/repositories")).toStrictEqual(["repositories"]);
  expect(currentAt("/acme/atlas/repositories/a%2Fb")).toStrictEqual([
    "repositories",
  ]);
});

test("the gear's Runners opens the reader's own runners, and is current there beside Settings and not at the address that redirects there", () => {
  expect(shellSetupNav(atlas).find((entry) => entry.id === "runners")?.to).toBe(
    settingsRoutes.project.myRunner,
  );
  expect(currentAt("/acme/atlas/settings/workspace/runner")).toStrictEqual([
    "settings",
    "runners",
  ]);
  expect(currentAt("/acme/atlas/settings/pools")).toStrictEqual(["settings"]);
  expect(currentAt("/acme/atlas/runners")).toStrictEqual([]);
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
