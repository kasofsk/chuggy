/**
 * A workspace's people list and what the reader may do there, read as two
 * resources of the workspace and read again together: a change to who holds a
 * role may change what the reader may do, their own role among them.
 */

import type { QueryClient } from "@tanstack/react-query";

import type {
  AccessTenantAbilities,
  AccessTenantPeople,
} from "../../../../../src/contract/accessPlane.ts";
import {
  apiTenantAbilities,
  apiTenantPeople,
} from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import { tenantResourceKey } from "../../core/projectQueryKeys.ts";
import { usePanelTenantResource } from "../api.ts";

/** No frame names this read, so a change's own invalidation is what reaches it. */
export const tenantPeopleResource = "access-people";

export const tenantPeopleAbilitiesResource = "access-abilities";

export function useTenantPeople(
  tenant: string,
): PanelState<AccessTenantPeople> {
  return usePanelTenantResource(tenant, tenantPeopleResource, (ports) =>
    apiTenantPeople(ports, tenant),
  );
}

export function useTenantAbilities(
  tenant: string,
): PanelState<AccessTenantAbilities> {
  return usePanelTenantResource(
    tenant,
    tenantPeopleAbilitiesResource,
    (ports) => apiTenantAbilities(ports, tenant),
  );
}

export async function tenantPeopleReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({
      queryKey: tenantResourceKey(tenant, tenantPeopleResource),
    }),
    client.invalidateQueries({
      queryKey: tenantResourceKey(tenant, tenantPeopleAbilitiesResource),
    }),
  ]);
}
