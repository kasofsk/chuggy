/**
 * The bar's entries, derived: the project's primary places, each with the
 * route the router registered for it, and the account menu's places, the
 * settings and the reader's preferences, each at its address in the frame the
 * menu is drawn in.
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

test("in a project the account menu names the project's settings, then the reader's preferences section there", () => {
  const entries = shellAccountNav(atlas);
  expect(entries.map((entry) => [entry.id, entry.to])).toStrictEqual([
    ["settings", settingsRootRoutes.project],
    ["preferences", settingsSection("preferences").project],
  ]);
  expect(entries.map((entry) => copyTextEn(entry.label))).toStrictEqual([
    "Settings",
    "Preferences",
  ]);
  expect(entries[1]?.label).toStrictEqual(settingsSection("preferences").label);
  for (const entry of entries) expect(entry.params).toStrictEqual(atlas);
});

test("in a workspace outside every project the account menu names the workspace's settings and the preferences there", () => {
  const entries = shellAccountNav({ tenant: "acme", project: undefined });
  expect(entries.map((entry) => [entry.id, entry.to])).toStrictEqual([
    ["settings", settingsRootRoutes.workspace],
    ["preferences", settingsSection("preferences").workspace],
  ]);
  for (const entry of entries)
    expect(entry.params).toStrictEqual({ tenant: "acme" });
});

test("where no workspace is named the account menu names no place", () => {
  expect(
    shellAccountNav({ tenant: undefined, project: undefined }),
  ).toStrictEqual([]);
});

test("the preferences are a section of the reader's own group, at an address under each frame's settings", () => {
  const preferences = settingsSection("preferences");
  expect(preferences.group).toBe("person");
  expect(preferences.shownBy).toBe("Member");
  expect(preferences.project).toBe("/$tenant/$project/settings/preferences");
  expect(preferences.workspace).toBe("/tenants/$tenant/settings/preferences");
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
