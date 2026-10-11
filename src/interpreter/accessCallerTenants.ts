/**
 * The tenants a caller is written into, answered to any caller signed in about
 * them alone: each tenant's roles, and whether they administer it.
 *
 * A TENANT IS LISTED WHERE A TUPLE ON ITS OWN OBJECT NAMES THE CALLER AS
 * THEMSELF in a role's relation. The listing is asked by the caller's
 * principal, so the authority answers no other subject's tuple and no set; a
 * tenant reached only through a set, or held only through a project, is not
 * listed. A tuple in no role's relation lists nothing, a copy lists nothing
 * again, and an object no tenant's name decodes from is left out.
 *
 * `administer` IS THE KIND'S OWN ANSWER, asked of the authority for each
 * tenant listed and never inferred from a role, for the reason
 * `./accessAbilities.ts` gives.
 *
 * TWO BOUNDS HOLD. The listing spends the budget every read spends, and
 * `tenantsMax` bounds the tenants listed, the first in name order, which are
 * all `AdministerTenant` is asked of. Either cutting the answer says so as
 * `truncated`.
 */

import {
  accessTenantRoles,
  type AccessCallerTenant,
  type AccessCallerTenants,
  type AccessTenantRole,
} from "../contract/accessPlane.ts";
import {
  accessBudget,
  accessTenantHeld,
  accessTenantRoleRelations,
  accessTuplesRead,
  type AccessPlaneBounds,
  type AccessTupleReader,
} from "./accessPlane.ts";
import type { Principal } from "./principal.ts";
import {
  projectAccessObjectTenant,
  projectAccessTenantNamespace,
  type ProjectAccess,
} from "./projectAccess.ts";
import type { TenantId } from "./projectStore.ts";

export interface AccessCallerTenantsPorts {
  readonly access: ProjectAccess;
  readonly tuples: AccessTupleReader;
}

export interface AccessCallerTenantsSettings {
  readonly bounds: AccessPlaneBounds;
}

export interface AccessCallerTenantsList {
  callerTenants(caller: Principal): Promise<AccessCallerTenants>;
}

/** The tenant role each role's relation is written for. */
const accessCallerTenantsRoleOf: ReadonlyMap<string, AccessTenantRole> =
  new Map(
    accessTenantRoles.map((role) => [accessTenantRoleRelations[role], role]),
  );

async function accessCallerTenantsRead(
  ports: AccessCallerTenantsPorts,
  settings: AccessCallerTenantsSettings,
  caller: Principal,
): Promise<AccessCallerTenants> {
  const budget = accessBudget(settings.bounds);
  const held = new Map<TenantId, Set<AccessTenantRole>>();
  for (const tuple of await accessTuplesRead(ports.tuples, budget, {
    query: "NamespaceSubject",
    namespace: projectAccessTenantNamespace,
    principal: caller,
  })) {
    const role = accessCallerTenantsRoleOf.get(tuple.relation);
    const tenant = projectAccessObjectTenant(tuple.object);
    if (role === undefined || tenant === undefined) continue;
    held.set(tenant, (held.get(tenant) ?? new Set()).add(role));
  }
  const listed = [...held.keys()].sort();
  if (listed.length > settings.bounds.tenantsMax) budget.truncated = true;
  const tenants: AccessCallerTenant[] = [];
  for (const tenant of listed.slice(0, settings.bounds.tenantsMax)) {
    const roles = held.get(tenant) ?? new Set();
    tenants.push({
      tenant,
      roles: accessTenantRoles.filter((role) => roles.has(role)),
      administer: await accessTenantHeld(
        ports.access,
        caller,
        tenant,
        "AdministerTenant",
      ),
    });
  }
  return { tenants, truncated: budget.truncated };
}

export function accessCallerTenants(
  ports: AccessCallerTenantsPorts,
  settings: AccessCallerTenantsSettings,
): AccessCallerTenantsList {
  return {
    callerTenants: (caller) => accessCallerTenantsRead(ports, settings, caller),
  };
}
