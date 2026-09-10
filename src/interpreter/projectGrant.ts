/**
 * The write side of project access: the relation tuples `ProjectAccess` reads,
 * and the contract an administrator reaches them through.
 *
 * THE PRINCIPAL IS DERIVED, NEVER TYPED. An administrator supplies the issuer
 * and subject a token carries and nothing else, so the encoding an
 * authenticated request arrives with and the encoding a grant is written under
 * are the same call. A second encoder is the failure this contract exists to
 * make impossible, and `oidcPrincipal` is the one it calls.
 *
 * A GRANT IS NOT JOURNALLED STATE. It records who may address a project rather
 * than anything the project decided, so writing one takes no lease and produces
 * no entry; the single-writer commitment is about the journal, which no grant
 * is part of.
 *
 * WHAT A SUBJECT MAY BE IS TWO THINGS AND THEY ARE SEPARATE ARMS. Every
 * relation a person holds names a principal; a project's `tenant` relation
 * names the tenant's own object instead, which is what carries a tenant
 * administrator's authority down to the projects under it. One optional field
 * covering both would be a runtime question at every use.
 */

import {
  checkedProjectAccessTimeoutMs,
  checkedProjectAccessUrl,
  projectAccessNamespace,
  projectAccessObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
} from "./projectAccess.ts";
import { oidcPrincipal, type Principal } from "./principal.ts";
import { asProjectId, asTenantId } from "./projectStore.ts";

/** The relations a principal may be written into on a project. */
export const allProjectGrantRelations = [
  "admins",
  "developers",
  "dispatchers",
  "agents",
] as const;

export type ProjectGrantRelation = (typeof allProjectGrantRelations)[number];

/** The relations a principal may be written into on a tenant. */
export const allTenantGrantRelations = [
  "admins",
  "members",
  "hosted_execution",
] as const;

export type TenantGrantRelation = (typeof allTenantGrantRelations)[number];

/** The project relation naming the tenant a project's authority is inherited from. */
export const projectTenantRelation = "tenant";

/** Who a tuple names: a person, or the tenant whose own grants reach through it. */
export type ProjectGrantSubject =
  | { readonly subject: "Principal"; readonly principal: Principal }
  | { readonly subject: "Tenant"; readonly tenantObject: string };

/** One relation tuple, in the vocabulary the authority itself uses. */
export interface ProjectGrant {
  readonly namespace: string;
  readonly object: string;
  readonly relation: string;
  readonly holder: ProjectGrantSubject;
}

/** The identity an administrator names for a person, before any of it is narrowed. */
export interface ProjectGrantPrincipalRequest {
  readonly issuer: string;
  readonly subject: string;
}

/** Narrows a supplied relation, refusing one the project namespace does not declare. */
export function asProjectGrantRelation(value: string): ProjectGrantRelation {
  const relation = allProjectGrantRelations.find((known) => known === value);
  if (relation === undefined)
    throw new RangeError(`project grant: ${value} is not a project relation`);
  return relation;
}

/** Narrows a supplied relation, refusing one the tenant namespace does not declare. */
export function asTenantGrantRelation(value: string): TenantGrantRelation {
  const relation = allTenantGrantRelations.find((known) => known === value);
  if (relation === undefined)
    throw new RangeError(`project grant: ${value} is not a tenant relation`);
  return relation;
}

/** The subject a person is written as, derived rather than accepted. */
function projectGrantHolder(
  request: ProjectGrantPrincipalRequest,
): ProjectGrantSubject {
  return {
    subject: "Principal",
    principal: oidcPrincipal(request.issuer, request.subject),
  };
}

/** One person's relation on one project. */
export function projectPrincipalGrant(
  request: ProjectGrantPrincipalRequest & {
    readonly tenant: string;
    readonly project: string;
    readonly relation: string;
  },
): ProjectGrant {
  return {
    namespace: projectAccessNamespace,
    object: projectAccessObject({
      tenant: asTenantId(request.tenant),
      project: asProjectId(request.project),
    }),
    relation: asProjectGrantRelation(request.relation),
    holder: projectGrantHolder(request),
  };
}

/** One person's relation on one tenant, which every project under it inherits. */
export function tenantPrincipalGrant(
  request: ProjectGrantPrincipalRequest & {
    readonly tenant: string;
    readonly relation: string;
  },
): ProjectGrant {
  return {
    namespace: projectAccessTenantNamespace,
    object: projectAccessTenantObject(asTenantId(request.tenant)),
    relation: asTenantGrantRelation(request.relation),
    holder: projectGrantHolder(request),
  };
}

/** The tuple that puts one project under one tenant's authority. */
export function projectTenantGrant(request: {
  readonly tenant: string;
  readonly project: string;
}): ProjectGrant {
  const tenant = asTenantId(request.tenant);
  return {
    namespace: projectAccessNamespace,
    object: projectAccessObject({
      tenant,
      project: asProjectId(request.project),
    }),
    relation: projectTenantRelation,
    holder: {
      subject: "Tenant",
      tenantObject: projectAccessTenantObject(tenant),
    },
  };
}

/** Where the tuples are written and how long one write may take, all of it plain data. */
export interface ProjectGrantSettings {
  readonly writeUrl: string;
  readonly requestTimeoutMs: number;
}

/** What one administrative command writes the authority with. */
export function checkedProjectGrantSettings(input: {
  readonly writeUrl: string;
  readonly requestTimeoutMs?: number | undefined;
}): ProjectGrantSettings {
  return {
    writeUrl: checkedProjectAccessUrl(
      input.writeUrl,
      "project grant write URL",
    ),
    requestTimeoutMs: checkedProjectAccessTimeoutMs(
      input.requestTimeoutMs,
      "project grant timeout",
    ),
  };
}

/**
 * Writes what `ProjectAccess` reads. Both verbs are idempotent, so re-running
 * either is the same as running it once.
 */
export interface ProjectGrantWriter {
  /** Adds the tuple, or leaves the one already there. */
  write(grant: ProjectGrant): Promise<void>;

  /** Removes the tuple, whether or not there was one to remove. */
  remove(grant: ProjectGrant): Promise<void>;
}
