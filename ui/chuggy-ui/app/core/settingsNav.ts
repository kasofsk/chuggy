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
    siteWorkspaces: "/$tenant/$project/settings/site/workspaces",
    sitePermissions: "/$tenant/$project/settings/site/permissions",
  },
  workspace: {
    people: "/tenants/$tenant/settings/people",
    accounts: "/tenants/$tenant/settings/accounts",
    workspacePermissions: "/tenants/$tenant/settings/permissions",
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
  readonly label: string;
  readonly to: SettingsRoute;
  readonly params: SettingsNavParams;
}

/** One level's pages under the level's word and, where it has one, its name. */
export interface SettingsNavGroup {
  readonly id: "project" | "workspace" | "site";
  readonly label: string;
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

export function settingsNav(
  input: SettingsNavInput,
): readonly SettingsNavGroup[] {
  const { tenant, project } = input;
  const frame =
    project === undefined ? settingsRoutes.workspace : settingsRoutes.project;
  const params: SettingsNavParams =
    project === undefined ? { tenant } : { tenant, project };
  const entry = (
    id: string,
    label: string,
    to: SettingsRoute,
  ): SettingsNavEntry => ({ id, label, to, params });
  const projectGroup: SettingsNavGroup = {
    id: "project",
    label: "Project",
    name: project,
    entries: [
      entry("lead", "Lead", settingsRoutes.project.lead),
      entry("placement", "Placement", settingsRoutes.project.placement),
      entry("permissions", "Permissions", settingsRoutes.project.permissions),
    ],
  };
  const workspaceGroup: SettingsNavGroup = {
    id: "workspace",
    label: "Workspace",
    name: tenant,
    entries: [
      entry("people", "People", frame.people),
      entry("accounts", "Accounts", frame.accounts),
      entry("workspace-permissions", "Permissions", frame.workspacePermissions),
    ],
  };
  const siteGroup: SettingsNavGroup = {
    id: "site",
    label: "Site",
    name: undefined,
    entries: [
      ...(input.site.workspaces
        ? [entry("site-workspaces", "Workspaces", frame.siteWorkspaces)]
        : []),
      ...(input.site.permissions
        ? [entry("site-permissions", "Permissions", frame.sitePermissions)]
        : []),
    ],
  };
  return [
    ...(project === undefined ? [] : [projectGroup]),
    workspaceGroup,
    ...(siteGroup.entries.length === 0 ? [] : [siteGroup]),
  ];
}
