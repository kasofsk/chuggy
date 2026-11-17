/**
 * What a tenant is named to a reader, and its administrators changing it.
 *
 * A TENANT NO ROW NAMES IS NAMED BY ITS ID. The store keeps a display name for
 * each tenant it holds a row of, and a tenant the plane made before its first
 * project holds none until it is renamed, as one on a plane composed with no
 * store never does.
 *
 * A RENAME ASKS `AdministerTenant`, and a caller answered none of the tenant's
 * list is told it is absent rather than refused, as every other change of a
 * tenant tells them. The id and every tuple naming it stay as they are.
 */

import type { ProjectAccess } from "./projectAccess.ts";
import { accessTenantHeld, accessTenantListed } from "./accessPlane.ts";
import type { Principal } from "./principal.ts";
import type { TenantId } from "./projectStore.ts";

export interface AccessTenantNameStore {
  /** The display name of each of `tenants` a row names, the rest left out. */
  named(tenants: readonly TenantId[]): Promise<ReadonlyMap<TenantId, string>>;
  /** `tenant` named `displayName`, its row written where it had none. */
  renamed(tenant: TenantId, displayName: string): Promise<void>;
}

/** What each of `tenants` is named to a reader. */
export async function accessTenantDisplayNames(
  store: AccessTenantNameStore | undefined,
  tenants: readonly TenantId[],
): Promise<(tenant: TenantId) => string> {
  const named =
    store === undefined || tenants.length === 0
      ? new Map<TenantId, string>()
      : await store.named(tenants);
  return (tenant) => named.get(tenant) ?? tenant;
}

export type AccessTenantRename =
  "Changed" | "Absent" | "Refused" | "NotConfigured";

export interface AccessTenantNamesPorts {
  readonly access: ProjectAccess;
  readonly names?: AccessTenantNameStore | undefined;
}

export interface AccessTenantNames {
  renamed(
    caller: Principal,
    tenant: TenantId,
    displayName: string,
  ): Promise<AccessTenantRename>;
}

async function accessTenantNamesRenamed(
  ports: AccessTenantNamesPorts,
  store: AccessTenantNameStore,
  request: {
    readonly caller: Principal;
    readonly tenant: TenantId;
    readonly displayName: string;
  },
): Promise<AccessTenantRename> {
  const { caller, tenant, displayName } = request;
  if (!(await accessTenantListed(ports.access, caller, tenant)))
    return "Absent";
  if (
    !(await accessTenantHeld(ports.access, caller, tenant, "AdministerTenant"))
  )
    return "Refused";
  await store.renamed(tenant, displayName);
  return "Changed";
}

export function accessTenantNames(
  ports: AccessTenantNamesPorts,
): AccessTenantNames {
  const store = ports.names;
  return {
    renamed: (caller, tenant, displayName) =>
      store === undefined
        ? Promise.resolve("NotConfigured")
        : accessTenantNamesRenamed(ports, store, {
            caller,
            tenant,
            displayName,
          }),
  };
}
