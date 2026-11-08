/**
 * The settings' side navigation, derived: a group a level — the project's
 * where one is open, the workspace's, and the site's where the reader is drawn
 * a page of it — each the pages of that level in the order they are listed.
 *
 * A workspace's page and the site's each have two addresses: one under a
 * project, so a reader in one keeps its shell, and one naming the workspace
 * alone. An entry is the address in the frame the navigation is drawn in, so
 * no link it draws leaves that frame.
 */

import type { AccessSiteAbilities } from "../../../../src/contract/accessPlane.ts";

import type { Copy } from "./copy.ts";
import { siteWorkspaceOffered } from "./siteWorkspaces.ts";

/** Every settings page's address, in a project and under the workspace alone. */
export const settingsRoutes = {
  project: {
    lead: "/$tenant/$project/settings/lead",
    placement: "/$tenant/$project/settings/placement",
    permissions: "/$tenant/$project/settings/permissions",
    people: "/$tenant/$project/settings/workspace/people",
    accounts: "/$tenant/$project/settings/workspace/accounts",
    workspacePermissions: "/$tenant/$project/settings/workspace/permissions",
    myRunner: "/$tenant/$project/settings/workspace/runner",
    usage: "/$tenant/$project/settings/workspace/usage",
    siteWorkspaces: "/$tenant/$project/settings/site/workspaces",
    sitePermissions: "/$tenant/$project/settings/site/permissions",
  },
  workspace: {
    people: "/tenants/$tenant/settings/people",
    accounts: "/tenants/$tenant/settings/accounts",
    workspacePermissions: "/tenants/$tenant/settings/permissions",
    myRunner: "/tenants/$tenant/settings/runner",
    usage: "/tenants/$tenant/settings/usage",
    siteWorkspaces: "/tenants/$tenant/settings/site/workspaces",
    sitePermissions: "/tenants/$tenant/settings/site/permissions",
  },
} as const;

type SettingsProjectRoutes = typeof settingsRoutes.project;
type SettingsWorkspaceRoutes = typeof settingsRoutes.workspace;

export type SettingsRoute =
  | SettingsProjectRoutes[keyof SettingsProjectRoutes]
  | SettingsWorkspaceRoutes[keyof SettingsWorkspaceRoutes];

/** The project is named only by an entry drawn in one. */
export interface SettingsNavParams {
  readonly tenant: string;
  readonly project?: string | undefined;
}

export interface SettingsNavEntry {
  readonly id: string;
  readonly label: Copy;
  readonly to: SettingsRoute;
  readonly params: SettingsNavParams;
}

/** One level's pages under the level's word and, where it has one, its name. */
export interface SettingsNavGroup {
  readonly id: "project" | "workspace" | "site";
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

/** Each entry's word, by its id. */
const settingsNavLabels = {
  lead: { id: "settings-nav-lead" },
  placement: { id: "settings-nav-placement" },
  permissions: { id: "settings-nav-permissions" },
  people: { id: "settings-nav-people" },
  accounts: { id: "settings-nav-accounts" },
  "workspace-permissions": { id: "settings-nav-permissions" },
  "my-runner": { id: "settings-nav-personal-runners" },
  usage: { id: "settings-nav-usage" },
  "site-workspaces": { id: "settings-nav-workspaces" },
  "site-permissions": { id: "settings-nav-permissions" },
} as const satisfies Readonly<Record<string, Copy>>;

export function settingsNav(
  input: SettingsNavInput,
): readonly SettingsNavGroup[] {
  const { tenant, project } = input;
  const frame =
    project === undefined ? settingsRoutes.workspace : settingsRoutes.project;
  const params: SettingsNavParams =
    project === undefined ? { tenant } : { tenant, project };
  const entry = (
    id: keyof typeof settingsNavLabels,
    to: SettingsRoute,
  ): SettingsNavEntry => ({ id, label: settingsNavLabels[id], to, params });
  const projectGroup: SettingsNavGroup = {
    id: "project",
    label: { id: "settings-nav-project" },
    name: project,
    entries: [
      entry("lead", settingsRoutes.project.lead),
      entry("placement", settingsRoutes.project.placement),
      entry("permissions", settingsRoutes.project.permissions),
    ],
  };
  const workspaceGroup: SettingsNavGroup = {
    id: "workspace",
    label: { id: "settings-nav-workspace" },
    name: tenant,
    entries: [
      entry("people", frame.people),
      entry("accounts", frame.accounts),
      entry("workspace-permissions", frame.workspacePermissions),
      entry("my-runner", frame.myRunner),
      entry("usage", frame.usage),
    ],
  };
  const siteGroup: SettingsNavGroup = {
    id: "site",
    label: { id: "settings-nav-site" },
    name: undefined,
    entries: [
      ...(input.site.workspaces
        ? [entry("site-workspaces", frame.siteWorkspaces)]
        : []),
      ...(input.site.permissions
        ? [entry("site-permissions", frame.sitePermissions)]
        : []),
    ],
  };
  return [
    ...(project === undefined ? [] : [projectGroup]),
    workspaceGroup,
    ...(siteGroup.entries.length === 0 ? [] : [siteGroup]),
  ];
}
