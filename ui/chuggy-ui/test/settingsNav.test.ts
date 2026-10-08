/**
 * The settings' navigation, derived: a group a level in the order the levels
 * nest, each entry the address its page has in the frame it is drawn in.
 */

import { expect, test } from "vitest";

import {
  settingsNav,
  settingsNavSiteDrawn,
  settingsRoutes,
} from "../app/core/settingsNav.ts";
import type { SettingsNavGroup } from "../app/core/settingsNav.ts";

function drawn(
  groups: readonly SettingsNavGroup[],
): readonly (readonly [string, string | undefined, readonly string[]])[] {
  return groups.map((group) => [
    group.label,
    group.name,
    group.entries.map((entry) => entry.label),
  ]);
}

test("in a project the project's pages lead, then the workspace's, each group under its level and its name", () => {
  const groups = settingsNav({ tenant: "acme", project: "atlas", site: false });
  expect(drawn(groups)).toStrictEqual([
    ["Project", "atlas", ["Lead", "Placement", "Permissions"]],
    ["Workspace", "acme", ["People", "Accounts", "Permissions"]],
  ]);
});

test("outside a project the workspace's pages are the whole navigation", () => {
  const groups = settingsNav({
    tenant: "acme",
    project: undefined,
    site: false,
  });
  expect(drawn(groups)).toStrictEqual([
    ["Workspace", "acme", ["People", "Accounts", "Permissions"]],
  ]);
});

test("the site's group is last, named by nothing, and only where the reader is drawn it", () => {
  for (const project of ["atlas", undefined])
    expect(
      drawn(settingsNav({ tenant: "acme", project, site: true })).at(-1),
    ).toStrictEqual(["Site", undefined, ["Permissions"]]);
});

test("every entry is its page's address in the frame it is drawn in, with that frame's params", () => {
  const inProject = settingsNav({
    tenant: "acme",
    project: "atlas",
    site: true,
  }).flatMap((group) => group.entries);
  expect(inProject.map((entry) => entry.to)).toStrictEqual(
    Object.values(settingsRoutes.project),
  );
  for (const entry of inProject)
    expect(entry.params).toStrictEqual({ tenant: "acme", project: "atlas" });
  const outside = settingsNav({
    tenant: "acme",
    project: undefined,
    site: true,
  }).flatMap((group) => group.entries);
  expect(outside.map((entry) => entry.to)).toStrictEqual(
    Object.values(settingsRoutes.workspace),
  );
  for (const entry of outside)
    expect(entry.params).toStrictEqual({ tenant: "acme" });
});

test("entries are told apart by id though two pages share a label", () => {
  const ids = settingsNav({ tenant: "acme", project: "atlas", site: true })
    .flatMap((group) => group.entries)
    .map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the site's group is drawn to a reader who administers the site or manages its permissions, and to no other", () => {
  const none = {
    administer: false,
    createAccount: false,
    manageAuthorities: false,
  };
  expect(settingsNavSiteDrawn({ ...none, administer: true })).toBe(true);
  expect(settingsNavSiteDrawn({ ...none, manageAuthorities: true })).toBe(true);
  expect(settingsNavSiteDrawn({ ...none, createAccount: true })).toBe(false);
  expect(settingsNavSiteDrawn(none)).toBe(false);
  expect(settingsNavSiteDrawn(undefined)).toBe(false);
});
