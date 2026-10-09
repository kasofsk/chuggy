/**
 * The site's workspaces, read as a resource of the workspace whose settings
 * draw them and read again after one is made, since nothing else tells this
 * page the list grew.
 */

import type { QueryClient } from "@tanstack/react-query";

import type { AccessSiteTenants } from "../../../../../src/contract/accessPlane.ts";
import { apiSiteTenants } from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import { tenantResourceKey } from "../../core/projectQueryKeys.ts";
import { usePanelTenantResource } from "../api.ts";

/** No frame names this read. */
export const siteWorkspacesResource = "access-site-tenants";

export function useSiteWorkspaces(
  tenant: string,
): PanelState<AccessSiteTenants> {
  return usePanelTenantResource(tenant, siteWorkspacesResource, (ports) =>
    apiSiteTenants(ports),
  );
}

export async function siteWorkspacesReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await client.invalidateQueries({
    queryKey: tenantResourceKey(tenant, siteWorkspacesResource),
  });
}
