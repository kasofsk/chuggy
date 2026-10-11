/**
 * A workspace's people list and what the reader may do there, read as two
 * resources of the workspace and read again together: a change to who holds a
 * role may change what the reader may do, their own role among them.
 *
 * The workspace's invite links are a third, read again on their own: a link
 * made or revoked changes that list and nobody's roles.
 */

import type { QueryClient } from "@tanstack/react-query";

import type {
  AccessInviteLinks,
  AccessTenantAbilities,
  AccessTenantPeople,
} from "../../../../../src/contract/accessPlane.ts";
import {
  apiTenantAbilities,
  apiTenantInviteLinks,
  apiTenantPeople,
} from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import { tenantResourceKey } from "../../core/projectQueryKeys.ts";
import { usePanelTenantResource } from "../api.ts";

/** No frame names this read, so a change's own invalidation is what reaches it. */
export const tenantPeopleResource = "access-people";

export const tenantPeopleAbilitiesResource = "access-abilities";

export const tenantInviteLinksResource = "access-invite-links";

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

/** Absent on a plane that keeps no links, and to a reader the people list is not answered to. */
export function useTenantInviteLinks(
  tenant: string,
): PanelState<AccessInviteLinks> {
  return usePanelTenantResource(tenant, tenantInviteLinksResource, (ports) =>
    apiTenantInviteLinks(ports, tenant),
  );
}

export async function tenantInviteLinksReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await client.invalidateQueries({
    queryKey: tenantResourceKey(tenant, tenantInviteLinksResource),
  });
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
