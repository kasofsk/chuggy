/**
 * Who holds a workspace's permissions and the site's, and what the reader may
 * do on the site, read as three resources of the workspace. A holder added or
 * removed on either level's page may change all three, the reader's abilities
 * in the workspace and its people, so all of them are read again together.
 */

import type { QueryClient } from "@tanstack/react-query";

import type {
  AccessSiteAbilities,
  AccessSiteAuthorities,
  AccessTenantAuthorities,
} from "../../../../../src/contract/accessPlane.ts";
import {
  apiSiteAbilities,
  apiSiteAuthorities,
  apiTenantAuthorities,
} from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import { tenantResourceKey } from "../../core/projectQueryKeys.ts";
import { usePanelTenantResource } from "../api.ts";
import { tenantPeopleReread } from "./tenantPeopleResource.ts";

/** No frame names these reads. */
export const tenantPermissionsResource = "access-authorities";

export const sitePermissionsResource = "access-site-authorities";

export const siteAbilitiesResource = "access-site-abilities";

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

/** What the reader may do on the site, held under the workspace whose settings read it. */
export function useSiteAbilities(
  tenant: string,
): PanelState<AccessSiteAbilities> {
  return usePanelTenantResource(tenant, siteAbilitiesResource, (ports) =>
    apiSiteAbilities(ports),
  );
}

export async function tenantPermissionsReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await Promise.all([
    tenantPeopleReread(client, tenant),
    ...[
      tenantPermissionsResource,
      sitePermissionsResource,
      siteAbilitiesResource,
    ].map((resource) =>
      client.invalidateQueries({
        queryKey: tenantResourceKey(tenant, resource),
      }),
    ),
  ]);
}
