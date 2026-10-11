/**
 * The site's tenants, each with the people administering it and whether they
 * may make accounts, listed to a caller the site permits `CreateTenant`.
 *
 * A TENANT IS LISTED WHERE ITS OWN OBJECT CARRIES AN `admins` TUPLE OR ITS
 * `site` LINK. One held only by a member, only by a project inheriting from it,
 * or only by a row in a database is not listed, because the plane's database
 * keeps invite links alone and it reads no relation but those two of a tenant.
 *
 * EACH RELATION IS READ ACROSS THE TENANT NAMESPACE AS ITSELF, so a site's
 * members fill no bound its administrators are read under. Who holds the
 * site's `AccountCreators` is read first, so a cut never answers that a
 * tenant's administrators may not make accounts where they may.
 *
 * AN ADMINISTRATOR NO PERSON NAMES IS COUNTED for its tenant as `unnamed`, as
 * an authority list counts one, and a person in several rows is named once. An
 * object no tenant's name decodes from is left out and not counted.
 */

import type {
  AccessSiteTenant,
  AccessSiteTenants,
} from "../contract/accessPlane.ts";
import {
  accessAuthorityHolders,
  accessAuthorityPeopleAccounts,
  accessAuthorityPerson,
  accessSiteAuthorityRelations,
  accessSiteHeldTenant,
} from "./accessAuthorities.ts";
import type { AccessDirectory } from "./accessDirectory.ts";
import {
  accessBudget,
  accessTupleLinkRelation,
  accessTuplesRead,
  type AccessPlaneBounds,
  type AccessTuple,
  type AccessTupleReader,
} from "./accessPlane.ts";
import type { Principal } from "./principal.ts";
import {
  projectAccessObjectTenant,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  type ProjectAccess,
} from "./projectAccess.ts";
import {
  tenantAdministratorRelation,
  tenantSiteRelation,
} from "./projectGrant.ts";
import type { TenantId } from "./projectStore.ts";

export interface AccessSiteTenantsPorts {
  readonly access: ProjectAccess;
  readonly tuples: AccessTupleReader;
  readonly directory?: AccessDirectory | undefined;
}

/** The issuer every subject is derived under, and what one answer may read. */
export interface AccessSiteTenantsSettings {
  readonly issuer: string;
  readonly bounds: AccessPlaneBounds;
}

export interface AccessSiteTenantsList {
  siteTenants(caller: Principal): Promise<AccessSiteTenants | undefined>;
}

/** Whether `tuple` is a tenant's `site` link, naming the site's object and no other. */
function accessSiteTenantsLinked(tuple: AccessTuple): boolean {
  return (
    tuple.relation === tenantSiteRelation &&
    tuple.subject.subject === "Set" &&
    tuple.subject.namespace === projectAccessSiteNamespace &&
    tuple.subject.object === projectAccessSiteObject &&
    tuple.subject.relation === accessTupleLinkRelation
  );
}

/** Each tenant the listings name, by tenant, with the `admins` tuples on its object. */
function accessSiteTenantsHeld(
  administrators: readonly AccessTuple[],
  links: readonly AccessTuple[],
): ReadonlyMap<TenantId, AccessTuple[]> {
  const held = new Map<TenantId, AccessTuple[]>();
  const heldBy = (tuple: AccessTuple) => {
    const tenant = projectAccessObjectTenant(tuple.object);
    if (tenant === undefined) return undefined;
    const tuples = held.get(tenant) ?? [];
    held.set(tenant, tuples);
    return tuples;
  };
  for (const tuple of administrators)
    if (tuple.relation === tenantAdministratorRelation)
      heldBy(tuple)?.push(tuple);
  for (const tuple of links) if (accessSiteTenantsLinked(tuple)) heldBy(tuple);
  return held;
}

async function accessSiteTenantsRead(
  ports: AccessSiteTenantsPorts,
  settings: AccessSiteTenantsSettings,
  caller: Principal,
): Promise<AccessSiteTenants> {
  const budget = accessBudget(settings.bounds);
  const creators = new Set(
    (
      await accessTuplesRead(ports.tuples, budget, {
        query: "Object",
        namespace: projectAccessSiteNamespace,
        object: projectAccessSiteObject,
        relation: accessSiteAuthorityRelations.AccountCreators,
      })
    ).flatMap(({ subject }) =>
      subject.subject === "Set" ? (accessSiteHeldTenant(subject) ?? []) : [],
    ),
  );
  const across = (relation: string) =>
    accessTuplesRead(ports.tuples, budget, {
      query: "NamespaceRelation",
      namespace: projectAccessTenantNamespace,
      relation,
    });
  const held = accessSiteTenantsHeld(
    await across(tenantAdministratorRelation),
    await across(tenantSiteRelation),
  );
  const tenants: AccessSiteTenant[] = [...held.keys()].sort().map((tenant) => {
    const { principals, sets } = accessAuthorityHolders(held.get(tenant) ?? []);
    const administrators = principals.flatMap(
      (principal) =>
        accessAuthorityPerson(settings.issuer, caller, principal) ?? [],
    );
    return {
      tenant,
      administrators,
      unnamed: sets.size + principals.length - administrators.length,
      createAccounts: creators.has(tenant),
    };
  });
  const accounted = await accessAuthorityPeopleAccounts(
    ports.directory,
    tenants.map((one) => one.administrators),
  );
  return {
    tenants: tenants.map((one, index) => ({
      ...one,
      administrators: accounted[index] ?? one.administrators,
    })),
    truncated: budget.truncated,
  };
}

export function accessSiteTenants(
  ports: AccessSiteTenantsPorts,
  settings: AccessSiteTenantsSettings,
): AccessSiteTenantsList {
  if (settings.issuer.length === 0)
    throw new RangeError("access site tenants: the issuer is empty");
  return {
    siteTenants: async (caller) =>
      (await ports.access.authorizeSite(caller, "CreateTenant")) === undefined
        ? undefined
        : accessSiteTenantsRead(ports, settings, caller),
  };
}
