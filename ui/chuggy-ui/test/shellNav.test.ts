/**
 * The bar's entries, derived: the project's primary places, each with the
 * route the router registered for it, and the account menu's places, the
 * settings and the preferences, each at its address in the frame the menu is
 * drawn in.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import {
  settingsRootRoutes,
  settingsSection,
} from "../app/core/settingsNav.ts";
import {
  navEntryCurrent,
  navRoutes,
  shellAccountNav,
  shellNav,
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

test("the account menu's places are the settings and then the preferences, each under the project where the menu is in one", () => {
  const entries = shellAccountNav(atlas);
  expect(entries.map((entry) => entry.id)).toStrictEqual([
    "settings",
    "preferences",
  ]);
  expect(entries.map((entry) => entry.to)).toStrictEqual([
    settingsRootRoutes.project,
    settingsSection("preferences").project,
  ]);
  expect(entries.map((entry) => copyTextEn(entry.label))).toStrictEqual([
    "Settings",
    "Preferences",
  ]);
  for (const entry of entries) expect(entry.params).toStrictEqual(atlas);
});

test("outside every project the account menu's places are the workspace's settings and its preferences", () => {
  const entries = shellAccountNav({ tenant: "acme" });
  expect(entries.map((entry) => entry.to)).toStrictEqual([
    settingsRootRoutes.workspace,
    settingsSection("preferences").workspace,
  ]);
  for (const entry of entries)
    expect(entry.params).toStrictEqual({ tenant: "acme" });
});

function currentAt(pathname: string): readonly string[] {
  return shellNav(atlas)
    .filter((entry) => navEntryCurrent(entry, pathname))
    .map((entry) => entry.id);
}

test("each place is current on its own address and what lies beneath it", () => {
  expect(currentAt("/acme/atlas")).toStrictEqual(["overview"]);
  expect(currentAt("/acme/atlas/inbox")).toStrictEqual(["inbox"]);
  expect(currentAt("/acme/atlas/epics")).toStrictEqual(["epics"]);
  expect(currentAt("/acme/atlas/epics/7")).toStrictEqual(["epics"]);
  expect(currentAt("/acme/atlas/settings")).toStrictEqual([]);
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
