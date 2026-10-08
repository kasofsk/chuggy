/**
 * Who holds a role in a tenant and its projects, and granting or removing one,
 * for a caller the authority says administers what is being changed.
 *
 * A ROLE REACHES A RELATION THROUGH ONE RECORD PER ROSTER. The builders in
 * `./projectGrant.ts` take any relation the model declares, `hosted_execution`,
 * `agents`, `pools` and the `tenant` link included, so these two records are
 * the whole of what keeps a request from writing one of those: no string a
 * request carries reaches a builder any other way.
 *
 * ANYONE THE AUTHORITY REFUSES IS ANSWERED AS ABSENT, exactly as a tenant or
 * project that does not exist, so nothing here tells the two apart.
 *
 * EVERY LIST IS BOUNDED BY ONE BUDGET PER ANSWER: how many pages it reads, how
 * many tuples, and how many projects. A bound that cut the answer short says
 * so as `truncated`, and what was read before it is still answered.
 */

import {
  accessProjectRoles,
  accessTenantRoles,
  type AccessProjectPeople,
  type AccessProjectRole,
  type AccessTenantPeople,
  type AccessTenantPerson,
  type AccessTenantRole,
} from "../contract/accessPlane.ts";
import { oidcPrincipalSubject, type Principal } from "./principal.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessObjectPartition,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccess,
} from "./projectAccess.ts";
import {
  projectPrincipalGrant,
  projectTenantRelation,
  tenantAdministratorRelation,
  tenantPrincipalGrant,
  type ProjectGrantRelation,
  type ProjectGrantWriter,
  type TenantGrantRelation,
} from "./projectGrant.ts";
import type { Partition, ProjectId, TenantId } from "./projectStore.ts";

/** The relation each tenant role is written as. */
export const accessTenantRoleRelations: Readonly<
  Record<AccessTenantRole, TenantGrantRelation>
> = { Admin: "admins", Member: "members" };

/** The relation each project role is written as. */
export const accessProjectRoleRelations: Readonly<
  Record<AccessProjectRole, ProjectGrantRelation>
> = { Admin: "admins", Developer: "developers", Dispatcher: "dispatchers" };

/** The tenant relation a list reports as hosted runs granted, which no request writes. */
const accessHostedRunsRelation: TenantGrantRelation = "hosted_execution";

/** Who one tuple names: a principal's text, or a subject set, which is no principal. */
export type AccessTupleSubject =
  | { readonly subject: "Id"; readonly id: string }
  | {
      readonly subject: "Set";
      readonly namespace: string;
      readonly object: string;
    };

/** One tuple a listing answered. */
export interface AccessTuple {
  readonly object: string;
  readonly relation: string;
  readonly subject: AccessTupleSubject;
}

/** What one listing asks for: every tuple on one object, or every project whose `tenant` link names one tenant. */
export type AccessTupleQuery =
  | {
      readonly query: "Object";
      readonly namespace: string;
      readonly object: string;
      readonly relation?: string;
    }
  | { readonly query: "TenantProjects"; readonly tenant: TenantId };

/** One page of a listing, and the token the next is asked with where there is one. */
export interface AccessTuplePage {
  readonly tuples: readonly AccessTuple[];
  readonly next?: string | undefined;
}

/** Reads the authority's tuples a page at a time; an outage is thrown as `ProjectAccessUnavailable`. */
export interface AccessTupleReader {
  page(
    query: AccessTupleQuery,
    token: string | undefined,
  ): Promise<AccessTuplePage>;
}

/** The most one answer reads of the authority. */
export interface AccessPlaneBounds {
  readonly pagesMax: number;
  readonly tuplesMax: number;
  readonly projectsMax: number;
}

export const accessPlaneBoundsDefault: AccessPlaneBounds = {
  pagesMax: 64,
  tuplesMax: 512,
  projectsMax: 32,
};

export interface AccessPlanePorts {
  readonly access: ProjectAccess;
  readonly tuples: AccessTupleReader;
  readonly grants: ProjectGrantWriter;
}

/** The issuer every subject is derived under, which is the one the plane verifies tokens of. */
export interface AccessPlaneSettings {
  readonly issuer: string;
  readonly bounds: AccessPlaneBounds;
}

/** What a grant or a removal came to. */
export type AccessChange = "Absent" | "Changed" | "LastTenantAdministrator";

export interface AccessPlane {
  tenantPeople(
    caller: Principal,
    tenant: TenantId,
  ): Promise<AccessTenantPeople | undefined>;
  projectPeople(
    caller: Principal,
    partition: Partition,
  ): Promise<AccessProjectPeople | undefined>;
  tenantRoleGranted(
    caller: Principal,
    tenant: TenantId,
    subject: string,
    role: AccessTenantRole,
  ): Promise<AccessChange>;
  tenantRoleRemoved(
    caller: Principal,
    tenant: TenantId,
    subject: string,
    role: AccessTenantRole,
  ): Promise<AccessChange>;
  projectRoleGranted(
    caller: Principal,
    partition: Partition,
    subject: string,
    role: AccessProjectRole,
  ): Promise<AccessChange>;
  projectRoleRemoved(
    caller: Principal,
    partition: Partition,
    subject: string,
    role: AccessProjectRole,
  ): Promise<AccessChange>;
}

/** What one answer has spent of its bounds, and whether a bound cut it. */
interface AccessBudget {
  readonly bounds: AccessPlaneBounds;
  pages: number;
  tuples: number;
  truncated: boolean;
}

function accessBudget(bounds: AccessPlaneBounds): AccessBudget {
  return { bounds, pages: 0, tuples: 0, truncated: false };
}

/** Every tuple one listing holds, or as many as the budget left room for. */
async function accessTuplesRead(
  reader: AccessTupleReader,
  budget: AccessBudget,
  query: AccessTupleQuery,
): Promise<readonly AccessTuple[]> {
  const read: AccessTuple[] = [];
  let token: string | undefined;
  do {
    if (budget.pages >= budget.bounds.pagesMax) {
      budget.truncated = true;
      return read;
    }
    budget.pages += 1;
    const page = await reader.page(query, token);
    const room = budget.bounds.tuplesMax - budget.tuples;
    read.push(...page.tuples.slice(0, room));
    budget.tuples += Math.min(room, page.tuples.length);
    if (page.tuples.length > room) {
      budget.truncated = true;
      return read;
    }
    token = page.next === "" ? undefined : page.next;
  } while (token !== undefined);
  return read;
}

/** The roles of `roster` whose relations `relations` holds, in the roster's order. */
function accessRolesHeld<Role extends string>(
  roster: readonly Role[],
  record: Readonly<Record<Role, string>>,
  relations: ReadonlySet<string>,
): Role[] {
  return roster.filter((role) => relations.has(record[role]));
}

/** What one principal holds across a tenant, before it is named. */
interface AccessHolding {
  readonly tenant: Set<string>;
  readonly projects: Map<ProjectId, Set<string>>;
}

/** Every principal a listing names under a relation `kept` admits, by principal. */
function accessHoldings(
  holdings: Map<string, AccessHolding>,
  tuples: readonly AccessTuple[],
  kept: ReadonlySet<string>,
  project: ProjectId | undefined,
): void {
  for (const tuple of tuples) {
    if (tuple.subject.subject !== "Id" || !kept.has(tuple.relation)) continue;
    const holding = holdings.get(tuple.subject.id) ?? {
      tenant: new Set<string>(),
      projects: new Map<ProjectId, Set<string>>(),
    };
    holdings.set(tuple.subject.id, holding);
    if (project === undefined) holding.tenant.add(tuple.relation);
    else
      holding.projects.set(
        project,
        (holding.projects.get(project) ?? new Set<string>()).add(
          tuple.relation,
        ),
      );
  }
}

const accessTenantRelationsListed: ReadonlySet<string> = new Set([
  ...Object.values(accessTenantRoleRelations),
  accessHostedRunsRelation,
]);

const accessProjectRelationsListed: ReadonlySet<string> = new Set(
  Object.values(accessProjectRoleRelations),
);

/** Each holding named by subject under `issuer`, and how many were derived under another. */
function accessNamed<Person>(
  holdings: ReadonlyMap<string, AccessHolding>,
  issuer: string,
  person: (
    subject: string,
    principal: string,
    holding: AccessHolding,
  ) => Person,
): { readonly people: Person[]; readonly otherIssuers: number } {
  const people: Person[] = [];
  let otherIssuers = 0;
  for (const principal of [...holdings.keys()].sort()) {
    const subject = oidcPrincipalSubject(issuer, principal);
    const holding = holdings.get(principal);
    if (holding === undefined) continue;
    if (subject === undefined) otherIssuers += 1;
    else people.push(person(subject, principal, holding));
  }
  return { people, otherIssuers };
}

/** The tenant's projects as its `tenant` links name them, at most the bound. */
function accessTenantProjects(
  tenant: TenantId,
  links: readonly AccessTuple[],
  budget: AccessBudget,
): readonly Partition[] {
  const found = new Map<string, Partition>();
  for (const link of links) {
    const partition = projectAccessObjectPartition(link.object);
    if (partition?.tenant === tenant) found.set(partition.project, partition);
  }
  const projects = [...found.values()].sort((one, other) =>
    one.project < other.project ? -1 : 1,
  );
  if (projects.length > budget.bounds.projectsMax) budget.truncated = true;
  return projects.slice(0, budget.bounds.projectsMax);
}

function accessTenantPerson(
  caller: Principal,
  subject: string,
  principal: string,
  holding: AccessHolding,
): AccessTenantPerson {
  return {
    subject,
    mine: principal === caller,
    tenantRoles: accessRolesHeld(
      accessTenantRoles,
      accessTenantRoleRelations,
      holding.tenant,
    ),
    hostedRuns: holding.tenant.has(accessHostedRunsRelation),
    projects: [...holding.projects.entries()]
      .map(([project, relations]) => ({
        project,
        roles: accessRolesHeld(
          accessProjectRoles,
          accessProjectRoleRelations,
          relations,
        ),
      }))
      .sort((one, other) => (one.project < other.project ? -1 : 1)),
  };
}

async function accessTenantPeopleRead(
  ports: AccessPlanePorts,
  settings: AccessPlaneSettings,
  caller: Principal,
  tenant: TenantId,
): Promise<AccessTenantPeople> {
  const budget = accessBudget(settings.bounds);
  const holdings = new Map<string, AccessHolding>();
  accessHoldings(
    holdings,
    await accessTuplesRead(ports.tuples, budget, {
      query: "Object",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(tenant),
    }),
    accessTenantRelationsListed,
    undefined,
  );
  const projects = accessTenantProjects(
    tenant,
    await accessTuplesRead(ports.tuples, budget, {
      query: "TenantProjects",
      tenant,
    }),
    budget,
  );
  for (const partition of projects)
    accessHoldings(
      holdings,
      await accessTuplesRead(ports.tuples, budget, {
        query: "Object",
        namespace: projectAccessNamespace,
        object: projectAccessObject(partition),
      }),
      accessProjectRelationsListed,
      partition.project,
    );
  return {
    tenant,
    projects: projects.map((partition) => partition.project),
    ...accessNamed(holdings, settings.issuer, (subject, principal, holding) =>
      accessTenantPerson(caller, subject, principal, holding),
    ),
    truncated: budget.truncated,
  };
}

/** Whether a project's tuples carry the `tenant` link naming its own tenant, which is what a tenant's administrators reach it through. */
function accessProjectLinked(
  partition: Partition,
  tuples: readonly AccessTuple[],
): boolean {
  const tenantObject = projectAccessTenantObject(partition.tenant);
  return tuples.some(
    (tuple) =>
      tuple.relation === projectTenantRelation &&
      tuple.subject.subject === "Set" &&
      tuple.subject.namespace === projectAccessTenantNamespace &&
      tuple.subject.object === tenantObject,
  );
}

async function accessProjectPeopleRead(
  ports: AccessPlanePorts,
  settings: AccessPlaneSettings,
  caller: Principal,
  partition: Partition,
): Promise<AccessProjectPeople> {
  const budget = accessBudget(settings.bounds);
  const projectTuples = await accessTuplesRead(ports.tuples, budget, {
    query: "Object",
    namespace: projectAccessNamespace,
    object: projectAccessObject(partition),
  });
  const holdings = new Map<string, AccessHolding>();
  if (accessProjectLinked(partition, projectTuples))
    accessHoldings(
      holdings,
      await accessTuplesRead(ports.tuples, budget, {
        query: "Object",
        namespace: projectAccessTenantNamespace,
        object: projectAccessTenantObject(partition.tenant),
        relation: tenantAdministratorRelation,
      }),
      new Set([tenantAdministratorRelation]),
      undefined,
    );
  accessHoldings(
    holdings,
    projectTuples,
    accessProjectRelationsListed,
    partition.project,
  );
  return {
    tenant: partition.tenant,
    project: partition.project,
    ...accessNamed(
      holdings,
      settings.issuer,
      (subject, principal, holding) => ({
        subject,
        mine: principal === caller,
        tenantAdmin: holding.tenant.has(tenantAdministratorRelation),
        roles: accessRolesHeld(
          accessProjectRoles,
          accessProjectRoleRelations,
          holding.projects.get(partition.project) ?? new Set(),
        ),
      }),
    ),
    truncated: budget.truncated,
  };
}

/**
 * Whether removing `principal`'s `admins` leaves the tenant an administrator:
 * it does where the principal holds none, or where another principal holds it.
 * The read and the removal are two calls on an authority with no conditional
 * write, so two administrators removing each other at once can leave none.
 */
async function accessTenantAdministratorKept(
  ports: AccessPlanePorts,
  settings: AccessPlaneSettings,
  tenant: TenantId,
  principal: Principal,
): Promise<boolean> {
  const holders = (
    await accessTuplesRead(ports.tuples, accessBudget(settings.bounds), {
      query: "Object",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(tenant),
      relation: tenantAdministratorRelation,
    })
  ).flatMap((tuple) =>
    tuple.subject.subject === "Id" ? [tuple.subject.id] : [],
  );
  return (
    !holders.includes(principal) ||
    holders.some((holder) => holder !== principal)
  );
}

/** Whether `caller` administers `tenant`, which is what every tenant route asks first. */
async function accessTenantAdministered(
  ports: AccessPlanePorts,
  caller: Principal,
  tenant: TenantId,
): Promise<boolean> {
  return (
    (await ports.access.authorizeTenant(caller, tenant, "AdministerTenant")) !==
    undefined
  );
}

/** Whether `caller` administers the project, directly or through its tenant. */
async function accessProjectAdministered(
  ports: AccessPlanePorts,
  caller: Principal,
  partition: Partition,
): Promise<boolean> {
  return (
    (await ports.access.authorize(caller, partition, "Administer")) !==
    undefined
  );
}

function accessTenantChanges(
  ports: AccessPlanePorts,
  settings: AccessPlaneSettings,
): Pick<AccessPlane, "tenantRoleGranted" | "tenantRoleRemoved"> {
  const grantOf = (tenant: TenantId, subject: string, role: AccessTenantRole) =>
    tenantPrincipalGrant({
      issuer: settings.issuer,
      subject,
      tenant,
      relation: accessTenantRoleRelations[role],
    });
  return {
    tenantRoleGranted: async (caller, tenant, subject, role) => {
      if (!(await accessTenantAdministered(ports, caller, tenant)))
        return "Absent";
      await ports.grants.write(grantOf(tenant, subject, role));
      return "Changed";
    },
    tenantRoleRemoved: async (caller, tenant, subject, role) => {
      if (!(await accessTenantAdministered(ports, caller, tenant)))
        return "Absent";
      const grant = grantOf(tenant, subject, role);
      if (
        grant.holder.subject === "Principal" &&
        grant.relation === tenantAdministratorRelation &&
        !(await accessTenantAdministratorKept(
          ports,
          settings,
          tenant,
          grant.holder.principal,
        ))
      )
        return "LastTenantAdministrator";
      await ports.grants.remove(grant);
      return "Changed";
    },
  };
}

function accessProjectChanges(
  ports: AccessPlanePorts,
  settings: AccessPlaneSettings,
): Pick<AccessPlane, "projectRoleGranted" | "projectRoleRemoved"> {
  const changed =
    (verb: "write" | "remove") =>
    async (
      caller: Principal,
      partition: Partition,
      subject: string,
      role: AccessProjectRole,
    ): Promise<AccessChange> => {
      if (!(await accessProjectAdministered(ports, caller, partition)))
        return "Absent";
      await ports.grants[verb](
        projectPrincipalGrant({
          issuer: settings.issuer,
          subject,
          tenant: partition.tenant,
          project: partition.project,
          relation: accessProjectRoleRelations[role],
        }),
      );
      return "Changed";
    };
  return {
    projectRoleGranted: changed("write"),
    projectRoleRemoved: changed("remove"),
  };
}

export function accessPlane(
  ports: AccessPlanePorts,
  settings: AccessPlaneSettings,
): AccessPlane {
  if (settings.issuer.length === 0)
    throw new RangeError("access plane: the issuer is empty");
  return {
    tenantPeople: async (caller, tenant) =>
      (await accessTenantAdministered(ports, caller, tenant))
        ? accessTenantPeopleRead(ports, settings, caller, tenant)
        : undefined,
    projectPeople: async (caller, partition) =>
      (await accessProjectAdministered(ports, caller, partition))
        ? accessProjectPeopleRead(ports, settings, caller, partition)
        : undefined,
    ...accessTenantChanges(ports, settings),
    ...accessProjectChanges(ports, settings),
  };
}
