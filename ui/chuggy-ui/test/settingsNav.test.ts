/**
 * The settings' navigation, derived from the roster of sections: a group a
 * level in the order the levels nest and the reader's own last, each entry the
 * address its page has in the frame it is drawn in, and of the sections only
 * the ones the ability that shows each gives the reader.
 */

import { expect, test } from "vitest";

import type { AccessSiteAbilities } from "../../../src/contract/accessPlane.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import {
  settingsNav,
  settingsNavSiteDrawn,
  settingsRoutes,
  settingsSectionShown,
  settingsSections,
} from "../app/core/settingsNav.ts";
import type {
  SettingsNavGroup,
  SettingsNavSite,
} from "../app/core/settingsNav.ts";

const siteNone: SettingsNavSite = { workspaces: false, permissions: false };

const siteEvery: SettingsNavSite = { workspaces: true, permissions: true };

function drawn(
  groups: readonly SettingsNavGroup[],
): readonly (readonly [string, string | undefined, readonly string[]])[] {
  return groups.map((group) => [
    copyTextEn(group.label),
    group.name,
    group.entries.map((entry) => copyTextEn(entry.label)),
  ]);
}

test("in a project the project's pages lead, then the workspace's, then the reader's own, each group under its level and its name", () => {
  const groups = settingsNav({
    tenant: "acme",
    project: "atlas",
    site: siteNone,
  });
  expect(drawn(groups)).toStrictEqual([
    [
      "Project",
      "atlas",
      [
        "Lead",
        "Lead session",
        "Placement",
        "Permissions",
        "Repositories",
        "Runners",
        "Catalog",
      ],
    ],
    [
      "Workspace",
      "acme",
      ["People", "GitHub accounts", "Permissions", "Usage"],
    ],
    ["You", undefined, ["Personal runners"]],
  ]);
});

test("outside a project the workspace's pages are the whole navigation", () => {
  const groups = settingsNav({
    tenant: "acme",
    project: undefined,
    site: siteNone,
  });
  expect(drawn(groups)).toStrictEqual([
    [
      "Workspace",
      "acme",
      ["People", "GitHub accounts", "Permissions", "Usage"],
    ],
    ["You", undefined, ["Personal runners"]],
  ]);
});

test.each([
  { site: siteEvery, pages: ["Workspaces", "Permissions"] },
  { site: { ...siteNone, workspaces: true }, pages: ["Workspaces"] },
  { site: { ...siteNone, permissions: true }, pages: ["Permissions"] },
])(
  "the site's group comes before the reader's own, is named by nothing, and holds $pages alone",
  ({ site, pages }) => {
    for (const project of ["atlas", undefined])
      expect(
        drawn(settingsNav({ tenant: "acme", project, site })).slice(-2),
      ).toStrictEqual([
        ["Site", undefined, pages],
        ["You", undefined, ["Personal runners"]],
      ]);
  },
);

test("a reader drawn none of the site's pages is drawn no group for it", () => {
  for (const project of ["atlas", undefined])
    expect(
      settingsNav({ tenant: "acme", project, site: siteNone }).map(
        (group) => group.id,
      ),
    ).not.toContain("site");
});

test("every entry is its page's address in the frame it is drawn in, with that frame's params", () => {
  const inProject = settingsNav({
    tenant: "acme",
    project: "atlas",
    site: siteEvery,
  }).flatMap((group) => group.entries);
  expect(inProject.map((entry) => entry.to)).toStrictEqual(
    Object.values(settingsRoutes.project),
  );
  for (const entry of inProject)
    expect(entry.params).toStrictEqual({ tenant: "acme", project: "atlas" });
  const outside = settingsNav({
    tenant: "acme",
    project: undefined,
    site: siteEvery,
  }).flatMap((group) => group.entries);
  expect(outside.map((entry) => entry.to)).toStrictEqual(
    Object.values(settingsRoutes.workspace),
  );
  for (const entry of outside)
    expect(entry.params).toStrictEqual({ tenant: "acme" });
});

test.each([
  { site: siteNone, shownBy: ["Member"] },
  {
    site: { ...siteNone, workspaces: true },
    shownBy: ["Member", "SiteWorkspaces"],
  },
  {
    site: { ...siteNone, permissions: true },
    shownBy: ["Member", "SitePermissions"],
  },
  { site: siteEvery, shownBy: ["Member", "SiteWorkspaces", "SitePermissions"] },
])(
  "a section is drawn exactly where its ability is held: $shownBy",
  ({ site, shownBy }) => {
    for (const project of ["atlas", undefined]) {
      const ids = settingsNav({ tenant: "acme", project, site })
        .flatMap((group) => group.entries)
        .map((entry) => entry.id);
      expect(ids).toStrictEqual(
        settingsSections
          .filter((section) => shownBy.includes(section.shownBy))
          .filter((section) =>
            project === undefined ? section.workspace !== undefined : true,
          )
          .map((section) => section.id),
      );
    }
  },
);

test("the site's sections alone are shown by an ability other than membership", () => {
  expect(
    settingsSections.map((section) => [section.id, section.shownBy]),
  ).toStrictEqual([
    ["lead", "Member"],
    ["lead-session", "Member"],
    ["placement", "Member"],
    ["permissions", "Member"],
    ["repositories", "Member"],
    ["runners", "Member"],
    ["catalog", "Member"],
    ["people", "Member"],
    ["accounts", "Member"],
    ["workspace-permissions", "Member"],
    ["usage", "Member"],
    ["site-workspaces", "SiteWorkspaces"],
    ["site-permissions", "SitePermissions"],
    ["my-runner", "Member"],
  ]);
  for (const shownBy of [
    "Member",
    "SiteWorkspaces",
    "SitePermissions",
  ] as const)
    expect(settingsSectionShown(shownBy, siteEvery)).toBe(true);
  expect(settingsSectionShown("Member", siteNone)).toBe(true);
  expect(settingsSectionShown("SiteWorkspaces", siteNone)).toBe(false);
  expect(settingsSectionShown("SitePermissions", siteNone)).toBe(false);
});

test("entries are told apart by id though two pages share a label", () => {
  const ids = settingsNav({ tenant: "acme", project: "atlas", site: siteEvery })
    .flatMap((group) => group.entries)
    .map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("Workspaces is drawn to a reader who may make one, Permissions to one who administers the site or manages its permissions, and neither to any other", () => {
  const none: AccessSiteAbilities = {
    administer: false,
    createAccount: false,
    createTenant: false,
    manageAuthorities: false,
  };
  const permissions = { ...siteNone, permissions: true };
  expect(settingsNavSiteDrawn({ ...none, administer: true })).toStrictEqual(
    permissions,
  );
  expect(
    settingsNavSiteDrawn({ ...none, manageAuthorities: true }),
  ).toStrictEqual(permissions);
  expect(settingsNavSiteDrawn({ ...none, createTenant: true })).toStrictEqual({
    ...siteNone,
    workspaces: true,
  });
  expect(
    settingsNavSiteDrawn({ ...none, createTenant: true, administer: true }),
  ).toStrictEqual(siteEvery);
  expect(settingsNavSiteDrawn({ ...none, createAccount: true })).toStrictEqual(
    siteNone,
  );
  expect(settingsNavSiteDrawn(none)).toStrictEqual(siteNone);
  expect(settingsNavSiteDrawn(undefined)).toStrictEqual(siteNone);
});
