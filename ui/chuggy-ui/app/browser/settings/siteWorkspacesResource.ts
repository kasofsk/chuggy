/**
 * The site's workspaces, read as a resource of the workspace whose settings
 * draw them and read again after one is made, since nothing else tells this
 * page the list grew.
 *
 * The site's workspace links are a second, read again on their own: a link
 * made or revoked changes that list and no workspace.
 */

import type { QueryClient } from "@tanstack/react-query";

import type {
  AccessSiteTenants,
  AccessWorkspaceLinks,
} from "../../../../../src/contract/accessPlane.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  siteWorkspaceLinksQuery,
  siteWorkspacesQuery,
} from "../../core/tenantQueries.ts";
import { usePanelState } from "../api.ts";

export function useSiteWorkspaces(
  tenant: string,
): PanelState<AccessSiteTenants> {
  return usePanelState(siteWorkspacesQuery(tenant));
}

export async function siteWorkspacesReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await client.invalidateQueries({
    queryKey: siteWorkspacesQuery(tenant).queryKey,
  });
}

/** Absent on a plane that keeps no links, and to a reader who may make no workspace. */
export function useSiteWorkspaceLinks(
  tenant: string,
): PanelState<AccessWorkspaceLinks> {
  return usePanelState(siteWorkspaceLinksQuery(tenant));
}

export async function siteWorkspaceLinksReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await client.invalidateQueries({
    queryKey: siteWorkspaceLinksQuery(tenant).queryKey,
  });
}
