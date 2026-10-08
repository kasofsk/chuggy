/**
 * Giving the site, and the tenants and projects that existed before a creation
 * wrote their defaults, the holders of each authority a creation now writes.
 *
 * AN OBJECT HOLDING ANY AUTHORITY TUPLE IS LEFT EXACTLY AS IT IS. That is what
 * makes a second run write nothing, and what keeps a run from restoring a
 * holder a person removed. A project, or the site, that every holder of every
 * authority was removed from reads as one that never had any, and is given its
 * defaults again; a tenant keeps its `site` link, so it is left.
 *
 * WHETHER AN OBJECT HOLDS A RELATION IS ASKED OF THAT RELATION ALONE, so no
 * bound over the object's other tuples can make a holder read as absent.
 *
 * A TENANT NOBODY ADMINISTERS IS WRITTEN NOTHING, because a tuple there would
 * hold the tenant against every creator while nobody administers it, and a
 * project with no link to its own tenant is written nothing because its
 * tenant's administrators do not reach it.
 *
 * EVERY LISTING IS READ WHOLE BEFORE ANYTHING IS WRITTEN, under a bound in
 * pages, so a listing the bound cuts fails before any object is given its
 * defaults; one object's defaults are then written as one request, so no object
 * is left with some of them and read as done by the next run.
 */

import { assertNever } from "../domain/assertNever.ts";
import {
  accessProjectLinked,
  type AccessTuple,
  type AccessTupleQuery,
  type AccessTupleReader,
} from "./accessPlane.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessObjectPartition,
  projectAccessObjectTenant,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
} from "./projectAccess.ts";
import {
  allProjectAuthorityRelations,
  allSiteAuthorityRelations,
  allTenantAuthorityRelations,
  projectAuthorityDefaults,
  projectTenantRelation,
  siteAuthorityDefaults,
  tenantAdministratorRelation,
  tenantAuthorityDefaults,
  tenantSiteRelation,
  type ProjectGrant,
  type ProjectGrantWriter,
} from "./projectGrant.ts";
import type { Partition, TenantId } from "./projectStore.ts";

/** One object a run considers, or one whose name decodes as neither a tenant's nor a project's. */
export type AccessDefaultsObject =
  | { readonly level: "Site" }
  | { readonly level: "Tenant"; readonly tenant: TenantId }
  | { readonly level: "Project"; readonly partition: Partition }
  | {
      readonly level: "Undecoded";
      readonly namespace: string;
      readonly object: string;
    };

/** What the authority answered of one object: the asked relations it holds a tuple of, and for a project whether its link names its own tenant. */
export interface AccessDefaultsHeld {
  readonly relations: ReadonlySet<string>;
  readonly linked: boolean;
}

/** Why an object is written nothing although it holds no authority tuple. */
export type AccessDefaultsSkip = "NoAdministrator" | "Unlinked" | "Undecoded";

export type AccessDefaultsDecision =
  | { readonly decision: "Given"; readonly grants: readonly ProjectGrant[] }
  | { readonly decision: "Left" }
  | { readonly decision: "Skipped"; readonly skip: AccessDefaultsSkip };

/** The most pages a run reads of one listing when nothing raises it. */
export const accessDefaultsListingPagesMaxDefault = 1024;

export interface AccessDefaultsSettings {
  readonly tenant?: TenantId | undefined;
  readonly apply: boolean;
  readonly listingPagesMax: number;
}

export interface AccessDefaultsPorts {
  readonly tuples: AccessTupleReader;
  readonly grants: ProjectGrantWriter;
}

/** A listing longer than its bound, which a run fails on rather than reading as complete. */
export class AccessDefaultsListingCut extends Error {
  constructor(what: string, pagesMax: number) {
    super(`the listing of ${what} is longer than ${String(pagesMax)} pages`);
    this.name = "AccessDefaultsListingCut";
  }
}

/** The namespace and object one considered object is addressed by. */
export function accessDefaultsAddress(object: AccessDefaultsObject): {
  readonly namespace: string;
  readonly object: string;
} {
  switch (object.level) {
    case "Site":
      return {
        namespace: projectAccessSiteNamespace,
        object: projectAccessSiteObject,
      };
    case "Tenant":
      return {
        namespace: projectAccessTenantNamespace,
        object: projectAccessTenantObject(object.tenant),
      };
    case "Project":
      return {
        namespace: projectAccessNamespace,
        object: projectAccessObject(object.partition),
      };
    case "Undecoded":
      return { namespace: object.namespace, object: object.object };
    default:
      return assertNever(object);
  }
}

/** The relations whose holding a decision reads, each asked of the authority alone. */
export function accessDefaultsAsked(
  object: AccessDefaultsObject,
): readonly string[] {
  switch (object.level) {
    case "Site":
      return allSiteAuthorityRelations;
    case "Tenant":
      return [
        tenantAdministratorRelation,
        tenantSiteRelation,
        ...allTenantAuthorityRelations,
      ];
    case "Project":
      return allProjectAuthorityRelations;
    case "Undecoded":
      return [];
    default:
      return assertNever(object);
  }
}

/** Whether `held` names a tuple of any of `relations`. */
function accessDefaultsHoldsAny(
  held: AccessDefaultsHeld,
  relations: readonly string[],
): boolean {
  return relations.some((relation) => held.relations.has(relation));
}

/** What one object is given, or why it is left or skipped, from what it holds. */
export function accessDefaultsDecided(
  object: AccessDefaultsObject,
  held: AccessDefaultsHeld,
): AccessDefaultsDecision {
  switch (object.level) {
    case "Site":
      return accessDefaultsHoldsAny(held, allSiteAuthorityRelations)
        ? { decision: "Left" }
        : { decision: "Given", grants: siteAuthorityDefaults() };
    case "Tenant":
      if (
        accessDefaultsHoldsAny(held, [
          tenantSiteRelation,
          ...allTenantAuthorityRelations,
        ])
      )
        return { decision: "Left" };
      if (!held.relations.has(tenantAdministratorRelation))
        return { decision: "Skipped", skip: "NoAdministrator" };
      return {
        decision: "Given",
        grants: tenantAuthorityDefaults(object.tenant),
      };
    case "Project":
      if (accessDefaultsHoldsAny(held, allProjectAuthorityRelations))
        return { decision: "Left" };
      if (!held.linked) return { decision: "Skipped", skip: "Unlinked" };
      return {
        decision: "Given",
        grants: projectAuthorityDefaults(object.partition),
      };
    case "Undecoded":
      return { decision: "Skipped", skip: "Undecoded" };
    default:
      return assertNever(object);
  }
}

/** What each skip is reported as, which says what the operator does about it. */
const accessDefaultsSkipText: Readonly<Record<AccessDefaultsSkip, string>> = {
  NoAdministrator: "no administrator holds it; grant one its admins first",
  Unlinked:
    "no tenant link names its own tenant; link it with provision:project-access first",
  Undecoded: "its name is no tenant's or project's this tree writes",
};

/** The line one object is reported with, naming the object and no person. */
export function accessDefaultsLine(
  object: AccessDefaultsObject,
  decision: AccessDefaultsDecision,
): string {
  const address = accessDefaultsAddress(object);
  const named = `${address.namespace}:${address.object}`;
  switch (decision.decision) {
    case "Given":
      return `defaults ${named}`;
    case "Left":
      return `left ${named}: it holds an authority tuple`;
    case "Skipped":
      return `skipped ${named}: ${accessDefaultsSkipText[decision.skip]}`;
    default:
      return assertNever(decision);
  }
}

/**
 * Reads one listing a page at a time until `visit` says it has seen enough or
 * the listing ends. A listing longer than the bound throws rather than reading
 * as shorter than it is.
 */
async function accessDefaultsPaged(
  reader: AccessTupleReader,
  query: AccessTupleQuery,
  pagesMax: number,
  visit: (tuples: readonly AccessTuple[]) => boolean,
): Promise<void> {
  let token: string | undefined;
  for (let pages = 0; pages < pagesMax; pages += 1) {
    const page = await reader.page(query, token);
    if (visit(page.tuples)) return;
    token = page.next === "" ? undefined : page.next;
    if (token === undefined) return;
  }
  throw new AccessDefaultsListingCut(
    query.query === "Object"
      ? `${query.namespace}:${query.object}#${query.relation ?? ""}`
      : query.query === "Namespace"
        ? query.namespace
        : query.query === "NamespaceRelation"
          ? `${query.namespace}#${query.relation}`
          : `the projects of tenant ${query.tenant}`,
    pagesMax,
  );
}

/** Every distinct object one listing names, in order. */
async function accessDefaultsObjectsListed(
  reader: AccessTupleReader,
  query: AccessTupleQuery,
  pagesMax: number,
): Promise<readonly string[]> {
  const objects = new Set<string>();
  await accessDefaultsPaged(reader, query, pagesMax, (tuples) => {
    for (const tuple of tuples) objects.add(tuple.object);
    return false;
  });
  return [...objects].sort();
}

function accessDefaultsTenantObject(object: string): AccessDefaultsObject {
  const tenant = projectAccessObjectTenant(object);
  return tenant === undefined
    ? { level: "Undecoded", namespace: projectAccessTenantNamespace, object }
    : { level: "Tenant", tenant };
}

function accessDefaultsProjectObject(object: string): AccessDefaultsObject {
  const partition = projectAccessObjectPartition(object);
  return partition === undefined
    ? { level: "Undecoded", namespace: projectAccessNamespace, object }
    : { level: "Project", partition };
}

/**
 * The objects a run considers: the site, then the named tenant and the projects
 * linked to it, or with none named every tenant and project holding a tuple.
 */
export async function accessDefaultsConsidered(
  reader: AccessTupleReader,
  settings: AccessDefaultsSettings,
): Promise<readonly AccessDefaultsObject[]> {
  const site: AccessDefaultsObject = { level: "Site" };
  if (settings.tenant !== undefined)
    return [
      site,
      { level: "Tenant", tenant: settings.tenant },
      ...(
        await accessDefaultsObjectsListed(
          reader,
          { query: "TenantProjects", tenant: settings.tenant },
          settings.listingPagesMax,
        )
      ).map(accessDefaultsProjectObject),
    ];
  const tenants = await accessDefaultsObjectsListed(
    reader,
    { query: "Namespace", namespace: projectAccessTenantNamespace },
    settings.listingPagesMax,
  );
  const projects = await accessDefaultsObjectsListed(
    reader,
    { query: "Namespace", namespace: projectAccessNamespace },
    settings.listingPagesMax,
  );
  return [
    site,
    ...tenants.map(accessDefaultsTenantObject),
    ...projects.map(accessDefaultsProjectObject),
  ];
}

/** What the authority holds of one object, each relation asked alone and the link read only of a project. */
export async function accessDefaultsHeldRead(
  reader: AccessTupleReader,
  object: AccessDefaultsObject,
  pagesMax: number,
): Promise<AccessDefaultsHeld> {
  const address = accessDefaultsAddress(object);
  const relations = new Set<string>();
  for (const relation of accessDefaultsAsked(object))
    await accessDefaultsPaged(
      reader,
      { query: "Object", ...address, relation },
      pagesMax,
      (tuples) => {
        if (tuples.length > 0) relations.add(relation);
        return tuples.length > 0;
      },
    );
  let linked = false;
  if (object.level === "Project")
    await accessDefaultsPaged(
      reader,
      { query: "Object", ...address, relation: projectTenantRelation },
      pagesMax,
      (tuples) => {
        linked = accessProjectLinked(object.partition, tuples);
        return linked;
      },
    );
  return { relations, linked };
}

/**
 * Considers every object, writes each one's defaults where `apply` says to,
 * and reports one line an object as it goes.
 */
export async function accessDefaultsProvisioned(
  ports: AccessDefaultsPorts,
  settings: AccessDefaultsSettings,
  reported: (line: string) => void,
): Promise<void> {
  if (!Number.isSafeInteger(settings.listingPagesMax))
    throw new RangeError("access defaults: the listing bound is no integer");
  if (settings.listingPagesMax < 1)
    throw new RangeError("access defaults: the listing bound is below one");
  const considered = await accessDefaultsConsidered(ports.tuples, settings);
  for (const object of considered) {
    const decision = accessDefaultsDecided(
      object,
      await accessDefaultsHeldRead(
        ports.tuples,
        object,
        settings.listingPagesMax,
      ),
    );
    if (decision.decision === "Given" && settings.apply)
      await ports.grants.writeAll(decision.grants);
    reported(accessDefaultsLine(object, decision));
  }
}
