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
import type { PanelState } from "../../core/freshness.ts";
import {
  tenantAbilitiesQuery,
  tenantInviteLinksQuery,
  tenantPeopleQuery,
} from "../../core/tenantQueries.ts";
import { usePanelState } from "../api.ts";

export function useTenantPeople(
  tenant: string,
): PanelState<AccessTenantPeople> {
  return usePanelState(tenantPeopleQuery(tenant));
}

export function useTenantAbilities(
  tenant: string,
): PanelState<AccessTenantAbilities> {
  return usePanelState(tenantAbilitiesQuery(tenant));
}

/** Absent on a plane that keeps no links, and to a reader the people list is not answered to. */
export function useTenantInviteLinks(
  tenant: string,
): PanelState<AccessInviteLinks> {
  return usePanelState(tenantInviteLinksQuery(tenant));
}

export async function tenantInviteLinksReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await client.invalidateQueries({
    queryKey: tenantInviteLinksQuery(tenant).queryKey,
  });
}

export async function tenantPeopleReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({
      queryKey: tenantPeopleQuery(tenant).queryKey,
    }),
    client.invalidateQueries({
      queryKey: tenantAbilitiesQuery(tenant).queryKey,
    }),
  ]);
}
