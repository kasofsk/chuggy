/**
 * The bar's entries, derived: the project's primary places, each with the
 * route the router registered for it, and the gear's places, each the
 * address of the settings section it names.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { settingsSection } from "../app/core/settingsNav.ts";
import {
  navEntryCurrent,
  navRoutes,
  shellNav,
  shellSetupNav,
} from "../app/core/shellNav.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

test("the primary places are Tickets, Epics and the Inbox, in that order, each a route of the partition", () => {
  const places = shellNav(atlas);
  expect(places.map((entry) => entry.id)).toStrictEqual([
    "overview",
    "epics",
    "inbox",
  ]);
  expect(places.map((entry) => entry.to)).toStrictEqual([
    navRoutes.overview,
    navRoutes.epics,
    navRoutes.inbox,
  ]);
  expect(places.map((entry) => copyTextEn(entry.label))).toStrictEqual([
    "Tickets",
    "Epics",
    "Inbox",
  ]);
  for (const entry of places) expect(entry.params).toStrictEqual(atlas);
});

test("each of the gear's places but the settings themselves is its settings section, by its address and its word", () => {
  const entries = shellSetupNav(atlas);
  expect(entries.map((entry) => entry.id)).toStrictEqual([
    "settings",
    "repositories",
    "runners",
  ]);
  const sections = [
    settingsSection("repositories"),
    settingsSection("runners"),
  ];
  expect(entries.map((entry) => [entry.to, entry.label])).toStrictEqual([
    [navRoutes.settings, { id: "shell-nav-settings" }],
    ...sections.map((section) => [section.project, section.label]),
  ]);
  expect(entries.map((entry) => copyTextEn(entry.label))).toStrictEqual([
    "Project settings",
    "Repositories",
    "Runners",
  ]);
  for (const entry of entries) expect(entry.params).toStrictEqual(atlas);
});

function currentAt(pathname: string): readonly string[] {
  return [...shellNav(atlas), ...shellSetupNav(atlas)]
    .filter((entry) => navEntryCurrent(entry, pathname))
    .map((entry) => entry.id);
}

test("each place is current on its own address and what lies beneath it", () => {
  expect(currentAt("/acme/atlas")).toStrictEqual(["overview"]);
  expect(currentAt("/acme/atlas/inbox")).toStrictEqual(["inbox"]);
  expect(currentAt("/acme/atlas/epics")).toStrictEqual(["epics"]);
  expect(currentAt("/acme/atlas/epics/7")).toStrictEqual(["epics"]);
  expect(currentAt("/acme/atlas/settings")).toStrictEqual(["settings"]);
  expect(currentAt("/acme/atlas/settings/runners")).toStrictEqual([
    "settings",
    "runners",
  ]);
  expect(currentAt("/acme/atlas/settings/repositories/a%2Fb")).toStrictEqual([
    "settings",
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
