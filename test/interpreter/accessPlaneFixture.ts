/**
 * An authority held in memory for the access plane's suites: its tuples, the
 * permits a case gives, a listing that pages, and a writer.
 *
 * ONLY ADMINISTERING FOLLOWS THE TUPLES, as the model does: a tenant's `admins`
 * administer it, and a project's `admins`, or its tenant's through the `tenant`
 * link, administer the project. Every other kind is answered from a table a
 * case fills, and what the tuples saying who may grant mean is the real
 * server's to show, which `.chug/tasks/check-keto.sh` asks. Every kind asked is
 * recorded beside the object it was asked of, in order, so the same kind on
 * two projects is told from one kind asked twice.
 */

import {
  accessAbilities,
  type AccessAbilities,
} from "../../src/interpreter/accessAbilities.ts";
import type { AccessDirectory } from "../../src/interpreter/accessDirectory.ts";
import {
  accessPlane,
  accessPlaneBoundsDefault,
  type AccessPlane,
  type AccessPlaneBounds,
  type AccessTuple,
  type AccessTupleQuery,
  type AccessTupleReader,
} from "../../src/interpreter/accessPlane.ts";
import {
  memberAuthority,
  ProjectAccessUnavailable,
  projectAccessNamespace,
  projectAccessObject,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccess,
  type ProjectAccessKind,
  type SiteAccessKind,
  type TenantAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectTenantGrant,
  type ProjectGrant,
  type ProjectGrantWriter,
} from "../../src/interpreter/projectGrant.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";

export const accessFixtureIssuer = "https://issuer.invalid";

/** One stored tuple, in the shape a listing answers it. */
interface AccessStored extends AccessTuple {
  readonly namespace: string;
}

/** What the authority holds and how it has been asked, which a case reads and may make unreachable. */
export interface AccessMemoryState {
  readonly tuples: AccessStored[];
  /** Every grant written or removed, in order. */
  readonly changes: (readonly ["write" | "remove", ProjectGrant])[];
  /** Every list written as one request, in order. */
  readonly batches: (readonly ProjectGrant[])[];
  unavailable: boolean;
  /** How many pages the reader has answered. */
  pages: number;
  /** Every kind given a principal on an object, as `accessHeldKey` names it. */
  readonly held: Set<string>;
  /** Every kind asked and the object it was asked of, in order. */
  readonly asked: (readonly [kind: string, object: string])[];
}

/** One kind on the object it is asked of. */
export type AccessMemoryKind =
  | { readonly on: "Site"; readonly kind: SiteAccessKind }
  | {
      readonly on: "Tenant";
      readonly tenant: TenantId;
      readonly kind: TenantAccessKind;
    }
  | {
      readonly on: "Project";
      readonly partition: Partition;
      readonly kind: ProjectAccessKind;
    };

/** The object one kind is asked of, as the authority addresses it. */
function accessKindObject(kind: AccessMemoryKind): string {
  if (kind.on === "Site") return projectAccessSiteObject;
  return kind.on === "Tenant"
    ? projectAccessTenantObject(kind.tenant)
    : projectAccessObject(kind.partition);
}

function accessHeldKey(principal: Principal, kind: AccessMemoryKind): string {
  return JSON.stringify([
    principal,
    kind.on,
    accessKindObject(kind),
    kind.kind,
  ]);
}

export interface AccessMemory extends AccessMemoryState {
  readonly access: ProjectAccess;
  readonly reader: AccessTupleReader;
  readonly grants: ProjectGrantWriter;
}

function accessStored(grant: ProjectGrant): AccessStored {
  return {
    namespace: grant.namespace,
    object: grant.object,
    relation: grant.relation,
    subject:
      grant.holder.subject === "Principal"
        ? { subject: "Id", id: grant.holder.principal }
        : {
            subject: "Set",
            namespace: grant.holder.namespace,
            object: grant.holder.object,
          },
  };
}

function accessSame(one: AccessStored, other: AccessStored): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

function accessMatches(stored: AccessStored, query: AccessTupleQuery): boolean {
  if (query.query === "TenantProjects")
    return (
      stored.namespace === projectAccessNamespace &&
      stored.relation === "tenant" &&
      stored.subject.subject === "Set" &&
      stored.subject.object === projectAccessTenantObject(query.tenant)
    );
  if (query.query === "Namespace") return stored.namespace === query.namespace;
  return (
    stored.namespace === query.namespace &&
    stored.object === query.object &&
    (query.relation === undefined || stored.relation === query.relation)
  );
}

function accessReachable(memory: AccessMemoryState): void {
  if (memory.unavailable)
    throw new ProjectAccessUnavailable("the authority is not there");
}

/** Whether `principal` holds `relation` on one object. */
function accessHolds(
  memory: AccessMemoryState,
  namespace: string,
  object: string,
  relation: string,
  principal: Principal,
): boolean {
  return memory.tuples.some(
    (tuple) =>
      tuple.namespace === namespace &&
      tuple.object === object &&
      tuple.relation === relation &&
      tuple.subject.subject === "Id" &&
      tuple.subject.id === principal,
  );
}

function accessTenantAdmin(
  memory: AccessMemoryState,
  principal: Principal,
  tenant: string,
): boolean {
  return accessHolds(
    memory,
    projectAccessTenantNamespace,
    projectAccessTenantObject(tenant),
    "admins",
    principal,
  );
}

function accessProjectAdmin(
  memory: AccessMemoryState,
  principal: Principal,
  partition: Partition,
): boolean {
  const link = accessStored(projectTenantGrant(partition));
  return (
    accessHolds(
      memory,
      projectAccessNamespace,
      projectAccessObject(partition),
      "admins",
      principal,
    ) ||
    (memory.tuples.some((tuple) => accessSame(tuple, link)) &&
      accessTenantAdmin(memory, principal, partition.tenant))
  );
}

/** Records `kind` asked, and answers whether `held` or the table gives it. */
function accessAnswered(
  memory: AccessMemoryState,
  principal: Principal,
  kind: AccessMemoryKind,
  administers: () => boolean,
) {
  accessReachable(memory);
  memory.asked.push([kind.kind, accessKindObject(kind)]);
  const held =
    kind.kind === "Administer" || kind.kind === "AdministerTenant"
      ? administers()
      : memory.held.has(accessHeldKey(principal, kind));
  return Promise.resolve(held ? memberAuthority(principal) : undefined);
}

function accessMemoryAccess(memory: AccessMemoryState): ProjectAccess {
  return {
    authorize: (principal, partition, kind) =>
      accessAnswered(
        memory,
        principal,
        { on: "Project", partition, kind },
        () => accessProjectAdmin(memory, principal, partition),
      ),
    authorizeTenant: (principal, tenant, kind) =>
      accessAnswered(memory, principal, { on: "Tenant", tenant, kind }, () =>
        accessTenantAdmin(memory, principal, tenant),
      ),
    authorizeSite: (principal, kind) =>
      accessAnswered(memory, principal, { on: "Site", kind }, () => false),
  };
}

/** Gives `principal` each kind, on the object each names. */
export function accessGiven(
  memory: AccessMemoryState,
  principal: Principal,
  kinds: readonly AccessMemoryKind[],
): void {
  for (const kind of kinds) memory.held.add(accessHeldKey(principal, kind));
}

const accessProjectAuthorityKinds: readonly ProjectAccessKind[] = [
  "GrantProjectAdmin",
  "GrantDeveloper",
  "GrantDispatcher",
  "ManageProjectAuthorities",
];

/** What the defaults give a project's administrator there. */
export function accessGivenProjectAdministrator(
  memory: AccessMemoryState,
  principal: Principal,
  partition: Partition,
): void {
  accessGiven(
    memory,
    principal,
    accessProjectAuthorityKinds.map((kind) => ({
      on: "Project",
      partition,
      kind,
    })),
  );
}

/** What the defaults give a tenant's administrator, on the tenant and on each of `projects`. */
export function accessGivenTenantAdministrator(
  memory: AccessMemoryState,
  principal: Principal,
  tenant: TenantId,
  projects: readonly Partition[],
): void {
  accessGiven(
    memory,
    principal,
    (
      ["GrantTenantAdmin", "GrantMember", "ManageTenantAuthorities"] as const
    ).map((kind) => ({ on: "Tenant", tenant, kind })),
  );
  for (const partition of projects)
    accessGivenProjectAdministrator(memory, principal, partition);
}

function accessMemoryReader(
  memory: AccessMemoryState,
  pageTuples: number,
): AccessTupleReader {
  return {
    page: (query, token) => {
      accessReachable(memory);
      memory.pages += 1;
      const matched = memory.tuples.filter((tuple) =>
        accessMatches(tuple, query),
      );
      const offset = Number(token ?? "0");
      const end = offset + pageTuples;
      return Promise.resolve({
        tuples: matched.slice(offset, end),
        next: end < matched.length ? String(end) : "",
      });
    },
  };
}

function accessMemoryStore(
  memory: AccessMemoryState,
  grant: ProjectGrant,
): void {
  const stored = accessStored(grant);
  if (!memory.tuples.some((tuple) => accessSame(tuple, stored)))
    memory.tuples.push(stored);
}

function accessMemoryGrants(memory: AccessMemoryState): ProjectGrantWriter {
  return {
    write: (grant) => {
      accessReachable(memory);
      memory.changes.push(["write", grant]);
      accessMemoryStore(memory, grant);
      return Promise.resolve();
    },
    writeAll: (grants) => {
      accessReachable(memory);
      memory.batches.push(grants);
      for (const grant of grants) accessMemoryStore(memory, grant);
      return Promise.resolve();
    },
    remove: (grant) => {
      accessReachable(memory);
      memory.changes.push(["remove", grant]);
      const stored = accessStored(grant);
      const at = memory.tuples.findIndex((tuple) => accessSame(tuple, stored));
      if (at !== -1) memory.tuples.splice(at, 1);
      return Promise.resolve();
    },
  };
}

/** An authority holding nothing, whose listing answers `pageTuples` a page. */
export function accessMemory(pageTuples = 2): AccessMemory {
  const state: AccessMemoryState = {
    tuples: [],
    changes: [],
    batches: [],
    unavailable: false,
    pages: 0,
    held: new Set(),
    asked: [],
  };
  return Object.assign(state, {
    access: accessMemoryAccess(state),
    reader: accessMemoryReader(state, pageTuples),
    grants: accessMemoryGrants(state),
  });
}

/** The plane over `memory`, deriving subjects under the fixture's issuer. */
export function accessMemoryPlane(
  memory: AccessMemory,
  bounds: AccessPlaneBounds = accessPlaneBoundsDefault,
  directory?: AccessDirectory,
): AccessPlane {
  return accessPlane(
    {
      access: memory.access,
      tuples: memory.reader,
      grants: memory.grants,
      directory,
    },
    { issuer: accessFixtureIssuer, bounds },
  );
}

/** What a caller may do, answered over `memory`. */
export function accessMemoryAbilities(
  memory: AccessMemory,
  bounds: AccessPlaneBounds = accessPlaneBoundsDefault,
): AccessAbilities {
  return accessAbilities(
    { access: memory.access, tuples: memory.reader },
    { bounds },
  );
}

/** The principal a subject is under the fixture's issuer. */
export function accessFixturePrincipal(subject: string): Principal {
  return oidcPrincipal(accessFixtureIssuer, subject);
}

export function accessFixturePartition(
  tenant: string,
  project: string,
): Partition {
  return { tenant: asTenantId(tenant), project: asProjectId(project) };
}
