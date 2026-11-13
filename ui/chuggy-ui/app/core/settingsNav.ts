/**
 * The settings' sections, as one roster: each with the group it sits in — the
 * project's, the workspace's, the site's, or the reader's own — its address
 * under a project and, where it is not the project's, under the workspace
 * alone, and the ability that shows it. The settings' side navigation is this
 * roster drawn in the frame it is in, a group a level; the bar's gear names its
 * pages by section from it, and the project's own places are `shellNav.ts`'s.
 *
 * A workspace's page, the site's and the reader's own each have two
 * addresses: one under a project, so a reader in one keeps its shell, and one
 * naming the workspace alone. An entry is the address in the frame the
 * navigation is drawn in, so no link it draws leaves that frame.
 */

import type { AccessSiteAbilities } from "../../../../src/contract/accessPlane.ts";

import type { Copy } from "./copy.ts";
import { siteWorkspaceOffered } from "./siteWorkspaces.ts";

/** The settings' own address in each frame: the index of its sections where
 * the frame is narrow, and its first section where it is wide. */
export const settingsRootRoutes = {
  project: "/$tenant/$project/settings",
  workspace: "/tenants/$tenant/settings",
} as const;

export type SettingsRootRoute =
  (typeof settingsRootRoutes)[keyof typeof settingsRootRoutes];

/** Every settings page's address, in a project and under the workspace alone. */
export const settingsRoutes = {
  project: {
    lead: "/$tenant/$project/settings/lead",
    leadSession: "/$tenant/$project/settings/lead-session",
    placement: "/$tenant/$project/settings/placement",
    permissions: "/$tenant/$project/settings/permissions",
    repositories: "/$tenant/$project/settings/repositories",
    runners: "/$tenant/$project/settings/runners",
    catalog: "/$tenant/$project/settings/catalog",
    people: "/$tenant/$project/settings/workspace/people",
    accounts: "/$tenant/$project/settings/workspace/accounts",
    workspacePermissions: "/$tenant/$project/settings/workspace/permissions",
    usage: "/$tenant/$project/settings/workspace/usage",
    siteWorkspaces: "/$tenant/$project/settings/site/workspaces",
    sitePermissions: "/$tenant/$project/settings/site/permissions",
    myRunner: "/$tenant/$project/settings/workspace/runner",
  },
  workspace: {
    people: "/tenants/$tenant/settings/people",
    accounts: "/tenants/$tenant/settings/accounts",
    workspacePermissions: "/tenants/$tenant/settings/permissions",
    usage: "/tenants/$tenant/settings/usage",
    siteWorkspaces: "/tenants/$tenant/settings/site/workspaces",
    sitePermissions: "/tenants/$tenant/settings/site/permissions",
    myRunner: "/tenants/$tenant/settings/runner",
  },
} as const;

type SettingsProjectRoutes = typeof settingsRoutes.project;
type SettingsWorkspaceRoutes = typeof settingsRoutes.workspace;

export type SettingsRoute =
  | SettingsProjectRoutes[keyof SettingsProjectRoutes]
  | SettingsWorkspaceRoutes[keyof SettingsWorkspaceRoutes];

export type SettingsGroupId = "project" | "workspace" | "site" | "person";

/** What shows a section: being a member of where it is drawn, or one of the
 * site's abilities. */
export type SettingsSectionShownBy =
  "Member" | "SiteWorkspaces" | "SitePermissions";

export type SettingsSectionId =
  | "lead"
  | "lead-session"
  | "placement"
  | "permissions"
  | "repositories"
  | "runners"
  | "catalog"
  | "people"
  | "accounts"
  | "workspace-permissions"
  | "usage"
  | "site-workspaces"
  | "site-permissions"
  | "my-runner";

export interface SettingsSection {
  readonly id: SettingsSectionId;
  readonly group: SettingsGroupId;
  readonly label: Copy;
  /** One line saying what the section holds. */
  readonly summary: Copy;
  readonly shownBy: SettingsSectionShownBy;
  readonly project: SettingsProjectRoutes[keyof SettingsProjectRoutes];
  /** Absent for a section of the project's, which has no page outside one. */
  readonly workspace:
    SettingsWorkspaceRoutes[keyof SettingsWorkspaceRoutes] | undefined;
}

/** Each section's word, by its id. */
const settingsSectionLabels = {
  lead: { id: "settings-nav-lead" },
  "lead-session": { id: "settings-nav-lead-session" },
  placement: { id: "settings-nav-placement" },
  permissions: { id: "settings-nav-permissions" },
  repositories: { id: "settings-nav-repositories" },
  runners: { id: "settings-nav-runners" },
  catalog: { id: "settings-nav-catalog" },
  people: { id: "settings-nav-people" },
  accounts: { id: "settings-nav-accounts" },
  "workspace-permissions": { id: "settings-nav-permissions" },
  usage: { id: "settings-nav-usage" },
  "site-workspaces": { id: "settings-nav-workspaces" },
  "site-permissions": { id: "settings-nav-permissions" },
  "my-runner": { id: "settings-nav-personal-runners" },
} as const satisfies Readonly<Record<SettingsSectionId, Copy>>;

/** Each section's line, by its id. */
const settingsSectionSummaries = {
  lead: { id: "settings-nav-lead-summary" },
  "lead-session": { id: "settings-nav-lead-session-summary" },
  placement: { id: "settings-nav-placement-summary" },
  permissions: { id: "settings-nav-permissions-summary" },
  repositories: { id: "settings-nav-repositories-summary" },
  runners: { id: "settings-nav-runners-summary" },
  catalog: { id: "settings-nav-catalog-summary" },
  people: { id: "settings-nav-people-summary" },
  accounts: { id: "settings-nav-accounts-summary" },
  "workspace-permissions": {
    id: "settings-nav-workspace-permissions-summary",
  },
  usage: { id: "settings-nav-usage-summary" },
  "site-workspaces": { id: "settings-nav-site-workspaces-summary" },
  "site-permissions": { id: "settings-nav-site-permissions-summary" },
  "my-runner": { id: "settings-nav-personal-runners-summary" },
} as const satisfies Readonly<Record<SettingsSectionId, Copy>>;

function settingsSectionOf(
  id: SettingsSectionId,
  group: SettingsGroupId,
  key: keyof SettingsProjectRoutes,
  shownBy: SettingsSectionShownBy = "Member",
): SettingsSection {
  const workspace: Readonly<Record<string, SettingsSection["workspace"]>> =
    settingsRoutes.workspace;
  const outside = workspace[key];
  if (group !== "project" && outside === undefined)
    throw new Error(`settings section ${id} has no address outside a project`);
  return {
    id,
    group,
    label: settingsSectionLabels[id],
    summary: settingsSectionSummaries[id],
    shownBy,
    project: settingsRoutes.project[key],
    workspace: group === "project" ? undefined : outside,
  };
}

/** Every section, a group at a time in the order the groups are drawn, and in
 * each group in the order its pages are listed. */
export const settingsSections: readonly SettingsSection[] = [
  settingsSectionOf("lead", "project", "lead"),
  settingsSectionOf("lead-session", "project", "leadSession"),
  settingsSectionOf("placement", "project", "placement"),
  settingsSectionOf("permissions", "project", "permissions"),
  settingsSectionOf("repositories", "project", "repositories"),
  settingsSectionOf("runners", "project", "runners"),
  settingsSectionOf("catalog", "project", "catalog"),
  settingsSectionOf("people", "workspace", "people"),
  settingsSectionOf("accounts", "workspace", "accounts"),
  settingsSectionOf(
    "workspace-permissions",
    "workspace",
    "workspacePermissions",
  ),
  settingsSectionOf("usage", "workspace", "usage"),
  settingsSectionOf(
    "site-workspaces",
    "site",
    "siteWorkspaces",
    "SiteWorkspaces",
  ),
  settingsSectionOf(
    "site-permissions",
    "site",
    "sitePermissions",
    "SitePermissions",
  ),
  settingsSectionOf("my-runner", "person", "myRunner"),
];

/** One section by its id. */
export function settingsSection(id: SettingsSectionId): SettingsSection {
  const section = settingsSections.find((candidate) => candidate.id === id);
  if (section === undefined) throw new Error(`no settings section ${id}`);
  return section;
}

/** The project is named only by an entry drawn in one. */
export interface SettingsNavParams {
  readonly tenant: string;
  readonly project?: string | undefined;
}

export interface SettingsNavEntry {
  readonly id: SettingsSectionId;
  readonly label: Copy;
  readonly summary: Copy;
  readonly to: SettingsRoute;
  readonly params: SettingsNavParams;
}

/** One level's pages under the level's word and, where it has one, its name. */
export interface SettingsNavGroup {
  readonly id: SettingsGroupId;
  readonly label: Copy;
  readonly name: string | undefined;
  readonly entries: readonly SettingsNavEntry[];
}

/** Which of the site's pages the reader is drawn. */
export interface SettingsNavSite {
  readonly workspaces: boolean;
  readonly permissions: boolean;
}

export interface SettingsNavInput {
  readonly tenant: string;
  readonly project: string | undefined;
  readonly site: SettingsNavSite;
}

/** Workspaces for a reader offered its list, and Permissions for one who administers the site or manages its permissions. */
export function settingsNavSiteDrawn(
  abilities: AccessSiteAbilities | undefined,
): SettingsNavSite {
  return {
    workspaces: siteWorkspaceOffered(abilities),
    permissions:
      abilities !== undefined &&
      (abilities.administer || abilities.manageAuthorities),
  };
}

/** Whether the reader's abilities show a section. */
export function settingsSectionShown(
  shownBy: SettingsSectionShownBy,
  site: SettingsNavSite,
): boolean {
  switch (shownBy) {
    case "Member":
      return true;
    case "SiteWorkspaces":
      return site.workspaces;
    case "SitePermissions":
      return site.permissions;
  }
}

const settingsGroupOrder: readonly SettingsGroupId[] = [
  "project",
  "workspace",
  "site",
  "person",
];

/** Each group's word, the level the side navigation and a page's name draw. */
export const settingsGroupLabels: Readonly<Record<SettingsGroupId, Copy>> = {
  project: { id: "settings-nav-project" },
  workspace: { id: "settings-nav-workspace" },
  site: { id: "settings-nav-site" },
  person: { id: "settings-nav-person" },
};

/** The roster drawn in one frame: the sections the frame has a page for and
 * the reader's abilities show, a group a level, and no group left empty. */
export function settingsNav(
  input: SettingsNavInput,
): readonly SettingsNavGroup[] {
  const { tenant, project } = input;
  const params: SettingsNavParams =
    project === undefined ? { tenant } : { tenant, project };
  const names: Readonly<Record<SettingsGroupId, string | undefined>> = {
    project,
    workspace: tenant,
    site: undefined,
    person: undefined,
  };
  return settingsGroupOrder
    .map((group) => ({
      id: group,
      label: settingsGroupLabels[group],
      name: names[group],
      entries: settingsSections.flatMap((section) => {
        const to = project === undefined ? section.workspace : section.project;
        if (section.group !== group || to === undefined) return [];
        if (!settingsSectionShown(section.shownBy, input.site)) return [];
        return [
          {
            id: section.id,
            label: section.label,
            summary: section.summary,
            to,
            params,
          },
        ];
      }),
    }))
    .filter((group) => group.entries.length > 0);
}
