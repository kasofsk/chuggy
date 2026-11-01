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
import type { PanelState } from "../../core/freshness.ts";
import {
  siteAbilitiesQuery,
  sitePermissionsQuery,
  tenantPermissionsQuery,
} from "../../core/tenantQueries.ts";
import { usePanelState } from "../api.ts";
import { tenantPeopleReread } from "./tenantPeopleResource.ts";

export function useTenantAuthorities(
  tenant: string,
): PanelState<AccessTenantAuthorities> {
  return usePanelState(tenantPermissionsQuery(tenant));
}

/** The site's list, held under the workspace whose page reads it. */
export function useSiteAuthorities(
  tenant: string,
): PanelState<AccessSiteAuthorities> {
  return usePanelState(sitePermissionsQuery(tenant));
}

/** What the reader may do on the site, held under the workspace whose settings read it. */
export function useSiteAbilities(
  tenant: string,
): PanelState<AccessSiteAbilities> {
  return usePanelState(siteAbilitiesQuery(tenant));
}

export async function tenantPermissionsReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await Promise.all([
    tenantPeopleReread(client, tenant),
    ...[
      tenantPermissionsQuery(tenant),
      sitePermissionsQuery(tenant),
      siteAbilitiesQuery(tenant),
    ].map((query) => client.invalidateQueries({ queryKey: query.queryKey })),
  ]);
}
