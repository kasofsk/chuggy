/**
 * Deleting a project that never ran work, by an administrator of its tenant,
 * and then a tenant that holds no project, by an administrator of the site.
 *
 * THE STORE DECIDES WHETHER IT EVER RAN, in the transaction that deletes it, and
 * answers what holds it where it did. Only after the store has deleted it are
 * its tuples erased, so a refusal leaves every grant standing, and an erasure
 * the authority lost is finished by the next request: a project already gone
 * is erased again and answered absent, and a tenant already gone is deleted
 * again, which deletes nothing, and erased again.
 *
 * A READER WHO MAY NOT DELETE IS ANSWERED ABSENT, as every route answers one
 * who may not reach what it names.
 */

import type {
  projectDeletionHoldings,
  tenantDeletionHoldings,
} from "../contract/responses.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition, TenantId } from "./projectStore.ts";

export type ProjectDeletionHolding = (typeof projectDeletionHoldings)[number];
export type TenantDeletionHolding = (typeof tenantDeletionHoldings)[number];

/** Narrows the store's holdings to those `known` names, refusing any other. */
export function unrunDeletionHoldings<Holding extends string>(
  known: readonly Holding[],
  held: readonly string[],
): readonly Holding[] {
  return held.map((named) => {
    const holding = known.find((candidate) => candidate === named);
    if (holding === undefined)
      throw new RangeError(`deletion: ${named} is not a known holding`);
    return holding;
  });
}

/** What a door came to: deleted, held by what it names, or, of a project, absent. */
export type UnrunDeletionStored<Holding, Absent extends string = never> =
  | { readonly outcome: "Deleted" | Absent }
  | { readonly outcome: "Held"; readonly held: readonly Holding[] };

/** The project's door: what holds it, undefined where there is no project, and its deletion. */
export interface ProjectDeletionStore {
  holds(
    partition: Partition,
  ): Promise<readonly ProjectDeletionHolding[] | undefined>;
  delete(
    partition: Partition,
  ): Promise<UnrunDeletionStored<ProjectDeletionHolding, "NotFound">>;
}

/** The tenant's door: what holds it, and its deletion, which a tenant with no row answers deleted. */
export interface TenantDeletionStore {
  holds(tenant: TenantId): Promise<readonly TenantDeletionHolding[]>;
  delete(tenant: TenantId): Promise<UnrunDeletionStored<TenantDeletionHolding>>;
}

/**
 * The authority's side: every tuple on a project's object, and every tuple on a
 * tenant's object, on any project still naming it as its tenant, and held on
 * the site by its administrators.
 */
export interface AccessErasure {
  projectErased(partition: Partition): Promise<void>;
  tenantErased(tenant: TenantId): Promise<void>;
}

/** What holds a thing a reader may delete, which is nothing where it may be deleted now. */
export type UnrunDeletionStanding<Holding> =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly held: readonly Holding[] };

export type UnrunDeleted<Holding> =
  | { readonly result: "Deleted" | "NotFound" }
  | { readonly result: "Held"; readonly held: readonly Holding[] };

export interface ProjectDeletion {
  standing(
    principal: Principal,
    partition: Partition,
  ): Promise<UnrunDeletionStanding<ProjectDeletionHolding>>;
  delete(
    principal: Principal,
    partition: Partition,
  ): Promise<UnrunDeleted<ProjectDeletionHolding>>;
}

export interface TenantDeletion {
  standing(
    principal: Principal,
    tenant: TenantId,
  ): Promise<UnrunDeletionStanding<TenantDeletionHolding>>;
  delete(
    principal: Principal,
    tenant: TenantId,
  ): Promise<UnrunDeleted<TenantDeletionHolding>>;
}

export interface UnrunDeletionPorts {
  readonly access: ProjectAccess;
  readonly erasure: AccessErasure;
}

async function projectDeletionAdministers(
  access: ProjectAccess,
  principal: Principal,
  partition: Partition,
): Promise<boolean> {
  return (
    (await access.authorizeTenant(
      principal,
      partition.tenant,
      "AdministerTenant",
    )) !== undefined
  );
}

async function projectDeletionStanding(
  ports: UnrunDeletionPorts,
  store: ProjectDeletionStore,
  principal: Principal,
  partition: Partition,
): Promise<UnrunDeletionStanding<ProjectDeletionHolding>> {
  if (!(await projectDeletionAdministers(ports.access, principal, partition)))
    return { result: "NotFound" };
  const held = await store.holds(partition);
  return held === undefined
    ? { result: "NotFound" }
    : { result: "Found", held };
}

async function projectDeletionDeleted(
  ports: UnrunDeletionPorts,
  store: ProjectDeletionStore,
  principal: Principal,
  partition: Partition,
): Promise<UnrunDeleted<ProjectDeletionHolding>> {
  if (!(await projectDeletionAdministers(ports.access, principal, partition)))
    return { result: "NotFound" };
  const stored = await store.delete(partition);
  if (stored.outcome === "Held") {
    if (stored.held.length === 0)
      throw new Error("project deletion: a held project names no holding");
    return { result: "Held", held: stored.held };
  }
  await ports.erasure.projectErased(partition);
  return { result: stored.outcome };
}

export function projectDeletion(
  ports: UnrunDeletionPorts,
  store: ProjectDeletionStore,
): ProjectDeletion {
  return {
    standing: (principal, partition) =>
      projectDeletionStanding(ports, store, principal, partition),
    delete: (principal, partition) =>
      projectDeletionDeleted(ports, store, principal, partition),
  };
}

async function tenantDeletionAdministers(
  access: ProjectAccess,
  principal: Principal,
): Promise<boolean> {
  return (
    (await access.authorizeSite(principal, "AdministerSite")) !== undefined
  );
}

async function tenantDeletionStanding(
  ports: UnrunDeletionPorts,
  store: TenantDeletionStore,
  principal: Principal,
  tenant: TenantId,
): Promise<UnrunDeletionStanding<TenantDeletionHolding>> {
  if (!(await tenantDeletionAdministers(ports.access, principal)))
    return { result: "NotFound" };
  return { result: "Found", held: await store.holds(tenant) };
}

async function tenantDeletionDeleted(
  ports: UnrunDeletionPorts,
  store: TenantDeletionStore,
  principal: Principal,
  tenant: TenantId,
): Promise<UnrunDeleted<TenantDeletionHolding>> {
  if (!(await tenantDeletionAdministers(ports.access, principal)))
    return { result: "NotFound" };
  const stored = await store.delete(tenant);
  if (stored.outcome === "Held") {
    if (stored.held.length === 0)
      throw new Error("tenant deletion: a held tenant names no holding");
    return { result: "Held", held: stored.held };
  }
  await ports.erasure.tenantErased(tenant);
  return { result: "Deleted" };
}

export function tenantDeletion(
  ports: UnrunDeletionPorts,
  store: TenantDeletionStore,
): TenantDeletion {
  return {
    standing: (principal, tenant) =>
      tenantDeletionStanding(ports, store, principal, tenant),
    delete: (principal, tenant) =>
      tenantDeletionDeleted(ports, store, principal, tenant),
  };
}
