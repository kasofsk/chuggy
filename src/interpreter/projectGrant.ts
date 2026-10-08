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
 * WHAT A SUBJECT MAY BE IS THREE THINGS AND THEY ARE SEPARATE ARMS. Every
 * relation a person holds names a principal. A project's `tenant` and a
 * tenant's `site` name an object itself instead, which is what carries the
 * authority of the level above down to the one below. A relation saying who
 * may grant a role or manage who may names a principal or the holders of one
 * role on one object. Optional fields covering all three would be a runtime
 * question at every use.
 *
 * A ROLE AND WHO MAY GRANT IT ARE DIFFERENT THINGS TO BE WRITTEN INTO, so the
 * relations holding an authority are rosters of their own beside the roles,
 * one a level, and the holders a subject set may name are of a role alone.
 */

import {
  checkedProjectAccessTimeoutMs,
  checkedProjectAccessUrl,
  projectAccessNamespace,
  projectAccessObject,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
} from "./projectAccess.ts";
import { oidcPrincipal, type Principal } from "./principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
  type TenantId,
} from "./projectStore.ts";

/** The relations a principal may be written into on a project. */
export const allProjectGrantRelations = [
  "admins",
  "developers",
  "dispatchers",
  "agents",
  "pools",
] as const;

export type ProjectGrantRelation = (typeof allProjectGrantRelations)[number];

/** The relations a principal may be written into on a tenant. */
export const allTenantGrantRelations = [
  "admins",
  "members",
  "hosted_execution",
] as const;

export type TenantGrantRelation = (typeof allTenantGrantRelations)[number];

/** The relations a principal may be written into on the site. */
export const allSiteGrantRelations = ["admins"] as const;

export type SiteGrantRelation = (typeof allSiteGrantRelations)[number];

/** The relations on a project saying who may grant its roles or manage who may. */
export const allProjectAuthorityRelations = [
  "admin_granters",
  "developer_granters",
  "dispatcher_granters",
  "authority_managers",
] as const;

export type ProjectAuthorityRelation =
  (typeof allProjectAuthorityRelations)[number];

/** The relations on a tenant saying who may grant its roles or manage who may. */
export const allTenantAuthorityRelations = [
  "admin_granters",
  "member_granters",
  "hosted_execution_granters",
  "authority_managers",
] as const;

export type TenantAuthorityRelation =
  (typeof allTenantAuthorityRelations)[number];

/** The relations on the site saying who may make an account, who may make a tenant, or who may manage either. */
export const allSiteAuthorityRelations = [
  "account_creators",
  "tenant_creators",
  "authority_managers",
] as const;

export type SiteAuthorityRelation = (typeof allSiteAuthorityRelations)[number];

/** The project relation naming the tenant a project's authority is inherited from. */
export const projectTenantRelation = "tenant";

/** The tenant relation naming the site whose authority reaches the tenant. */
export const tenantSiteRelation = "site";

/** A relation whose holders a subject set may name, which is one a person is written into. */
export type ProjectGrantHolderRelation =
  ProjectGrantRelation | TenantGrantRelation | SiteGrantRelation;

/**
 * Who a tuple names: a person, an object whose own grants reach through it, or
 * the holders of one role on one object.
 */
export type ProjectGrantSubject =
  | { readonly subject: "Principal"; readonly principal: Principal }
  | {
      readonly subject: "Object";
      readonly namespace: string;
      readonly object: string;
    }
  | {
      readonly subject: "Holders";
      readonly namespace: string;
      readonly object: string;
      readonly relation: ProjectGrantHolderRelation;
    };

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

/** Narrows a supplied relation, refusing one the site namespace does not declare. */
export function asSiteGrantRelation(value: string): SiteGrantRelation {
  const relation = allSiteGrantRelations.find((known) => known === value);
  if (relation === undefined)
    throw new RangeError(`project grant: ${value} is not a site relation`);
  return relation;
}

/** One person's relation on the site. */
export function sitePrincipalGrant(
  request: ProjectGrantPrincipalRequest & { readonly relation: string },
): ProjectGrant {
  return {
    namespace: projectAccessSiteNamespace,
    object: projectAccessSiteObject,
    relation: asSiteGrantRelation(request.relation),
    holder: projectGrantHolder(request),
  };
}

/** The tenant relation that holds the permit to administer it. */
export const tenantAdministratorRelation: TenantGrantRelation = "admins";

/** The tuple making an authenticated principal one tenant's administrator. */
export function tenantAdministratorGrant(
  principal: Principal,
  tenant: TenantId,
): ProjectGrant {
  return {
    namespace: projectAccessTenantNamespace,
    object: projectAccessTenantObject(tenant),
    relation: tenantAdministratorRelation,
    holder: { subject: "Principal", principal },
  };
}

/** One derived principal's relation on one project. */
export function projectRelationGrant(
  principal: Principal,
  partition: Partition,
  relation: ProjectGrantRelation,
): ProjectGrant {
  return {
    namespace: projectAccessNamespace,
    object: projectAccessObject(partition),
    relation,
    holder: { subject: "Principal", principal },
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
      subject: "Object",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(tenant),
    },
  };
}

/** The holders of the site's `admins`, which every level's defaults may name. */
const siteAdministrators: ProjectGrantSubject = {
  subject: "Holders",
  namespace: projectAccessSiteNamespace,
  object: projectAccessSiteObject,
  relation: "admins",
};

/**
 * The tuples the site starts with. Its `authority_managers` holds nobody: its
 * `manage_authorities` permit already admits its administrators, and every
 * tenant's `site` link carries that permit down, so no default names them as
 * managers anywhere.
 */
export function siteAuthorityDefaults(): readonly ProjectGrant[] {
  return [
    {
      namespace: projectAccessSiteNamespace,
      object: projectAccessSiteObject,
      relation: "account_creators" satisfies SiteAuthorityRelation,
      holder: siteAdministrators,
    },
    {
      namespace: projectAccessSiteNamespace,
      object: projectAccessSiteObject,
      relation: "tenant_creators" satisfies SiteAuthorityRelation,
      holder: siteAdministrators,
    },
  ];
}

/**
 * The tuples one tenant starts with: its link to the site, its own
 * administrators granting its roles and managing who may, and the site's
 * granting hosted runs.
 */
export function tenantAuthorityDefaults(
  tenant: TenantId,
): readonly ProjectGrant[] {
  const object = projectAccessTenantObject(tenant);
  const held = (
    relation: TenantAuthorityRelation,
    holder: ProjectGrantSubject,
  ): ProjectGrant => ({
    namespace: projectAccessTenantNamespace,
    object,
    relation,
    holder,
  });
  const administrators: ProjectGrantSubject = {
    subject: "Holders",
    namespace: projectAccessTenantNamespace,
    object,
    relation: "admins",
  };
  return [
    {
      namespace: projectAccessTenantNamespace,
      object,
      relation: tenantSiteRelation,
      holder: {
        subject: "Object",
        namespace: projectAccessSiteNamespace,
        object: projectAccessSiteObject,
      },
    },
    held("admin_granters", administrators),
    held("member_granters", administrators),
    held("authority_managers", administrators),
    held("hosted_execution_granters", siteAdministrators),
  ];
}

/**
 * The tuples one project starts with: each of its authority relations held by
 * its own administrators and by its tenant's.
 */
export function projectAuthorityDefaults(
  partition: Partition,
): readonly ProjectGrant[] {
  const object = projectAccessObject(partition);
  const holders: readonly ProjectGrantSubject[] = [
    {
      subject: "Holders",
      namespace: projectAccessNamespace,
      object,
      relation: "admins",
    },
    {
      subject: "Holders",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(partition.tenant),
      relation: "admins",
    },
  ];
  return allProjectAuthorityRelations.flatMap((relation) =>
    holders.map((holder) => ({
      namespace: projectAccessNamespace,
      object,
      relation,
      holder,
    })),
  );
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
 * Writes what `ProjectAccess` reads. A tuple written again may be stored again,
 * so re-running a verb changes what the authority answers no more than running
 * it once, and one removal takes every copy.
 */
export interface ProjectGrantWriter {
  /** Adds the tuple, where the authority may keep a copy beside one already there. */
  write(grant: ProjectGrant): Promise<void>;

  /** Adds every tuple as one request, so the authority takes all of them or none. */
  writeAll(grants: readonly ProjectGrant[]): Promise<void>;

  /** Removes the tuple, whether or not there was one to remove. */
  remove(grant: ProjectGrant): Promise<void>;
}
