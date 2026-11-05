/**
 * The trail the bar draws for the page a reader is on: the workspace, the
 * project, the screen and, where the screen holds one, the thing on it. Every
 * crumb but the last is how back to a level that has a page of its own; the
 * workspace has none, so it is a name and not a link.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { navRoutes } from "./shellNav.ts";
import type { NavParams, NavRoute } from "./shellNav.ts";

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
  runners: navRoutes.runners,
};

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
): readonly ShellCrumb[] {
  const params: NavParams = {
    tenant: partition.tenant,
    project: partition.project,
  };
  const [screen, first, ...rest] = beneath(partition, pathname);
  const crumbs: ShellCrumb[] = [
    { label: partition.tenant },
    {
      label: partition.project,
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
