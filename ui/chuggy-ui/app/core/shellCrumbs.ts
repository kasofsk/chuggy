/**
 * The trail the bar draws for the page a reader is on: the workspace, the
 * project, the screen and, where the screen holds one, the thing on it. Every
 * crumb but the last is how back to a level that has a page of its own; the
 * workspace has none, so it is a name and not a link.
 *
 * THE WORKSPACE AND THE PROJECT ARE CRUMBS BY THEIR NAMES, and every other
 * crumb is its address segment, never copy. A workspace's segment is an id
 * that may be generated and a project's is made from its name, so neither is
 * what its reader calls it; the names are the display names the reader's own
 * lists give, and the segment wherever they give none. Below the project the
 * trail spells the address the reader is at, so no vernacular renames it.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { memberChatRoutes } from "./memberChat.ts";
import { navRoutes } from "./shellNav.ts";
import type { NavParams, NavRoute } from "./shellNav.ts";
import type { WorkspaceNamed } from "./workspaceNames.ts";

export interface ShellCrumb {
  readonly label: string;
  /** Where the crumb goes; absent for a level with no page, and for the last. */
  readonly link?: { readonly to: NavRoute; readonly params: NavParams };
}

/** The screens that sit directly under a project, by their address segment. */
const screenRoutes: Readonly<Record<string, NavRoute>> = {
  inbox: navRoutes.inbox,
  lead: navRoutes.lead,
  catalog: navRoutes.catalog,
  settings: navRoutes.settings,
  repositories: navRoutes.repositories,
};

/** What the workspace's and the project's crumbs are called, each its id or address where its reader's list gives no name. */
export interface ShellCrumbNames {
  readonly workspace: WorkspaceNamed;
  readonly project: (partition: PartitionIdentity) => string;
}

/** The overview's segment, which the overview's own address leaves out. */
const overviewLabel = "tickets";

/** The segments of a pathname beneath the project, decoded. */
function beneath(partition: PartitionIdentity, pathname: string): string[] {
  const base = `/${encodeURIComponent(partition.tenant)}/${encodeURIComponent(partition.project)}`;
  if (!pathname.startsWith(base)) return [];
  return pathname
    .slice(base.length)
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => decodeURIComponent(segment));
}

export function shellCrumbs(
  partition: PartitionIdentity,
  pathname: string,
  names: ShellCrumbNames,
): readonly ShellCrumb[] {
  const params: NavParams = {
    tenant: partition.tenant,
    project: partition.project,
  };
  const [screen, first, ...rest] = beneath(partition, pathname);
  const crumbs: ShellCrumb[] = [
    { label: names.workspace(partition.tenant) },
    {
      label: names.project(partition),
      link: { to: navRoutes.overview, params },
    },
  ];
  if (screen === undefined) return [...crumbs, { label: overviewLabel }];
  const route = screenRoutes[screen];
  const link =
    route === undefined
      ? screen === "tickets"
        ? { to: navRoutes.overview, params }
        : undefined
      : { to: route, params };
  const page: ShellCrumb = {
    label: screen === "tickets" ? overviewLabel : screen,
    ...(link === undefined ? {} : { link }),
  };
  if (first === undefined) return [...crumbs, page];
  return [
    ...crumbs,
    page,
    { label: first },
    ...rest.map((label) => ({ label })),
  ];
}

/** The trail of a workspace's own chat: the workspace by its name, then the chat. */
export function memberChatCrumbs(
  tenant: string,
  named: WorkspaceNamed,
): readonly ShellCrumb[] {
  return [
    { label: named(tenant) },
    { label: memberChatRoutes.chat.split("/").at(-1) ?? "" },
  ];
}
