/**
 * Who holds a workspace's permissions and the site's, read as two resources of
 * the workspace. Nothing on the page changes a holder, so nothing reads them
 * again.
 */

import type {
  AccessSiteAuthorities,
  AccessTenantAuthorities,
} from "../../../../../src/contract/accessPlane.ts";
import {
  apiSiteAuthorities,
  apiTenantAuthorities,
} from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
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
