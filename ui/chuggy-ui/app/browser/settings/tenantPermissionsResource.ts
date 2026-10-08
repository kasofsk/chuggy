/**
 * Who holds a workspace's permissions and the site's, read as two resources of
 * the workspace and read again together after a holder is removed.
 */

import type { QueryClient } from "@tanstack/react-query";

import type {
  AccessSiteAuthorities,
  AccessTenantAuthorities,
} from "../../../../../src/contract/accessPlane.ts";
import {
  apiSiteAuthorities,
  apiTenantAuthorities,
} from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import { tenantResourceKey } from "../../core/projectQueryKeys.ts";
import { usePanelTenantResource } from "../api.ts";

/** No frame names these reads. */
export const tenantPermissionsResource = "access-authorities";

export const sitePermissionsResource = "access-site-authorities";

export function useTenantAuthorities(
  tenant: string,
): PanelState<AccessTenantAuthorities> {
  return usePanelTenantResource(tenant, tenantPermissionsResource, (ports) =>
    apiTenantAuthorities(ports, tenant),
  );
}

/** The site's list, held under the workspace whose page reads it. */
export function useSiteAuthorities(
  tenant: string,
): PanelState<AccessSiteAuthorities> {
  return usePanelTenantResource(tenant, sitePermissionsResource, (ports) =>
    apiSiteAuthorities(ports),
  );
}

export async function tenantPermissionsReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await Promise.all(
    [tenantPermissionsResource, sitePermissionsResource].map((resource) =>
      client.invalidateQueries({
        queryKey: tenantResourceKey(tenant, resource),
      }),
    ),
  );
}
