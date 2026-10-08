/**
 * Who holds a role in a tenant and its projects, granting or removing one, and
 * giving or taking a tenant's hosted runs, each asked of the authority as the
 * kind it needs.
 *
 * A REQUEST REACHES A RELATION THROUGH ONE RECORD PER ROSTER, OR AS HOSTED
 * RUNS. The builders in `./projectGrant.ts` take any relation the model
 * declares, `agents`, `pools` and the `tenant` link included, so these two
 * records and `accessHostedRunsRelation` are the whole of what a role change
 * can write, and `./accessAuthorityHolders.ts` holds the records an
 * authority's holders are written through: no string a request carries
 * reaches a builder any other way.
 *
 * A LIST IS ANSWERED TO WHOEVER HOLDS ONE OF ITS OWN KINDS, and a change asks
 * the kind granting its role, each in one record beside the role's relation,
 * or `GrantHostedExecution` for hosted runs. A caller holding none of a list's
 * kinds is answered as absent, exactly as a tenant or project that does not
 * exist, so nothing here tells the two apart; one answered the list who lacks
 * a change's kind is refused it.
 *
 * WHO A SUBJECT IS IS THE DIRECTORY'S, asked once per list about at most
 * `accessDirectorySubjectsMax` subjects. A plane with no directory lists
 * subjects alone, and one past the bound is listed as though it had none.
 *
 * A LISTING IS ASKED OF ONE OBJECT, ONE TENANT'S PROJECTS, A NAMESPACE, OR ONE
 * RELATION ACROSS A NAMESPACE, which is how the site's tenants are read.
 *
 * EVERY LIST IS BOUNDED BY ONE BUDGET PER ANSWER: how many pages it reads, how
 * many tuples, and how many projects. A bound that cut the answer short says
 * so as `truncated`, and what was read before it is still answered.
 */

import {
  accessProjectRoles,
  accessTenantRoles,
  type AccessProjectPeople,
  type AccessProjectPerson,
  type AccessProjectRole,
  type AccessTenantPeople,
  type AccessTenantPerson,
  type AccessTenantRole,
} from "../contract/accessPlane.ts";
import {
  accessDirectorySubject,
  accessDirectorySubjectsMax,
  type AccessDirectory,
} from "./accessDirectory.ts";
import { oidcPrincipalSubject, type Principal } from "./principal.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessObjectPartition,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccess,
  type ProjectAccessKind,
  type TenantAccessKind,
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

/** The kind granting or removing each tenant role asks. */
export const accessTenantRoleGrantKinds: Readonly<
  Record<AccessTenantRole, TenantAccessKind>
> = { Admin: "GrantTenantAdmin", Member: "GrantMember" };

/** The kind granting or removing each project role asks. */
export const accessProjectRoleGrantKinds: Readonly<
  Record<AccessProjectRole, ProjectAccessKind>
> = {
  Admin: "GrantProjectAdmin",
  Developer: "GrantDeveloper",
  Dispatcher: "GrantDispatcher",
};

/**
 * The kinds any one of which answers a tenant's list, the one most holders
 * hold first. It is not the roster less a kind, so a kind the roster gains
 * opens nothing here.
 */
export const accessTenantListKinds: readonly TenantAccessKind[] = [
  "AdministerTenant",
  "GrantTenantAdmin",
  "GrantMember",
  "GrantHostedExecution",
  "ManageTenantAuthorities",
  "ManageSiteHeldAuthorities",
];

/** The kinds any one of which answers a project's list, for `accessTenantListKinds`' reason. */
export const accessProjectListKinds: readonly ProjectAccessKind[] = [
  "Administer",
  "GrantProjectAdmin",
  "GrantDeveloper",
  "GrantDispatcher",
  "ManageProjectAuthorities",
];

/** The tenant relation a list reports as hosted runs granted, and the one giving or taking them writes under `GrantHostedExecution`. */
const accessHostedRunsRelation: TenantGrantRelation = "hosted_execution";

/**
 * Who one tuple names: a principal's text, or a subject set, which is no
 * principal. A set's relation is the role whose holders it names, or
 * `accessTupleLinkRelation` where it names an object itself.
 */
export type AccessTupleSubject =
  | { readonly subject: "Id"; readonly id: string }
  | {
      readonly subject: "Set";
      readonly namespace: string;
      readonly object: string;
      readonly relation: string;
    };

/** The relation a subject set is listed with where it is a link, naming an object rather than the holders of a role. */
export const accessTupleLinkRelation = "";

/** One tuple a listing answered. */
export interface AccessTuple {
  readonly object: string;
  readonly relation: string;
  readonly subject: AccessTupleSubject;
}

/** What one listing asks for: every tuple on one object, every project whose `tenant` link names one tenant, every tuple in one namespace, or every tuple of one relation in one namespace. */
export type AccessTupleQuery =
  | {
      readonly query: "Object";
      readonly namespace: string;
      readonly object: string;
      readonly relation?: string;
    }
  | { readonly query: "TenantProjects"; readonly tenant: TenantId }
  | { readonly query: "Namespace"; readonly namespace: string }
  | {
      readonly query: "NamespaceRelation";
      readonly namespace: string;
      readonly relation: string;
    };

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
  readonly directory?: AccessDirectory | undefined;
}

/** The issuer every subject is derived under, which is the one the plane verifies tokens of. */
export interface AccessPlaneSettings {
  readonly issuer: string;
  readonly bounds: AccessPlaneBounds;
}

/** What a grant or a removal came to. */
export type AccessChange =
  "Absent" | "Changed" | "Refused" | "LastTenantAdministrator";

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
  tenantHostedRunsGiven(
    caller: Principal,
    tenant: TenantId,
    subject: string,
  ): Promise<AccessChange>;
  tenantHostedRunsTaken(
    caller: Principal,
    tenant: TenantId,
    subject: string,
  ): Promise<AccessChange>;
}

/** What one answer has spent of its bounds, and whether a bound cut it. */
export interface AccessBudget {
  readonly bounds: AccessPlaneBounds;
  pages: number;
  tuples: number;
  truncated: boolean;
}

export function accessBudget(bounds: AccessPlaneBounds): AccessBudget {
  return { bounds, pages: 0, tuples: 0, truncated: false };
}

/** Every tuple one listing holds, or as many as the budget left room for. */
export async function accessTuplesRead(
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

/** Each person marked with who the directory says they are, or as listed where there is no directory. */
export async function accessAccountsNamed<
  Person extends { readonly subject: string },
>(
  directory: AccessDirectory | undefined,
  people: readonly Person[],
): Promise<Person[]> {
  if (directory === undefined) return [...people];
  const asked = [
    ...new Set(
      people
        .map((person) => person.subject)
        .filter((subject) => accessDirectorySubject(subject)),
    ),
  ].slice(0, accessDirectorySubjectsMax);
  const known = new Map(
    (asked.length === 0 ? [] : await directory.accounts(asked)).map(
      (account) => [account.subject.toLowerCase(), account] as const,
    ),
  );
  const askedSet = new Set(asked);
  return people.map((person) => {
    if (accessDirectorySubject(person.subject) && !askedSet.has(person.subject))
      return person;
    const account = known.get(person.subject.toLowerCase());
    if (account === undefined) return { ...person, account: false };
    return {
      ...person,
      account: true,
      ...(account.email === undefined ? {} : { email: account.email }),
      ...(account.githubLogin === undefined
        ? {}
        : { githubLogin: account.githubLogin }),
    };
  });
}

/** The tenant's projects as its `tenant` links name them, at most the bound. */
export function accessTenantProjects(
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
  const named = accessNamed(
    holdings,
    settings.issuer,
    (subject, principal, holding) =>
      accessTenantPerson(caller, subject, principal, holding),
  );
  return {
    tenant,
    projects: projects.map((partition) => partition.project),
    people: await accessAccountsNamed(ports.directory, named.people),
    otherIssuers: named.otherIssuers,
    truncated: budget.truncated,
  };
}

/** Whether a project's tuples carry the `tenant` link naming its own tenant, which is what a tenant's administrators reach it through. */
export function accessProjectLinked(
  partition: Partition,
  tuples: readonly AccessTuple[],
): boolean {
  const tenantObject = projectAccessTenantObject(partition.tenant);
  return tuples.some(
    (tuple) =>
      tuple.relation === projectTenantRelation &&
      tuple.subject.subject === "Set" &&
      tuple.subject.namespace === projectAccessTenantNamespace &&
      tuple.subject.object === tenantObject &&
      tuple.subject.relation === accessTupleLinkRelation,
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
  const named = accessNamed(
    holdings,
    settings.issuer,
    (subject, principal, holding): AccessProjectPerson => ({
      subject,
      mine: principal === caller,
      tenantAdmin: holding.tenant.has(tenantAdministratorRelation),
      roles: accessRolesHeld(
        accessProjectRoles,
        accessProjectRoleRelations,
        holding.projects.get(partition.project) ?? new Set(),
      ),
    }),
  );
  return {
    tenant: partition.tenant,
    project: partition.project,
    people: await accessAccountsNamed(ports.directory, named.people),
    otherIssuers: named.otherIssuers,
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

/** Whether `caller` holds `kind` on `tenant`. */
export async function accessTenantHeld(
  access: ProjectAccess,
  caller: Principal,
  tenant: TenantId,
  kind: TenantAccessKind,
): Promise<boolean> {
  return (await access.authorizeTenant(caller, tenant, kind)) !== undefined;
}

/** Whether `caller` holds `kind` on the project. */
export async function accessProjectHeld(
  access: ProjectAccess,
  caller: Principal,
  partition: Partition,
  kind: ProjectAccessKind,
): Promise<boolean> {
  return (await access.authorize(caller, partition, kind)) !== undefined;
}

/** Whether `caller` holds a kind answering the tenant's list, asked in order until one is held. */
export async function accessTenantListed(
  access: ProjectAccess,
  caller: Principal,
  tenant: TenantId,
): Promise<boolean> {
  for (const kind of accessTenantListKinds)
    if (await accessTenantHeld(access, caller, tenant, kind)) return true;
  return false;
}

/** Whether `caller` holds a kind answering the project's list, asked in order until one is held. */
async function accessProjectListed(
  access: ProjectAccess,
  caller: Principal,
  partition: Partition,
): Promise<boolean> {
  for (const kind of accessProjectListKinds)
    if (await accessProjectHeld(access, caller, partition, kind)) return true;
  return false;
}

/** Why `caller` may not make a change on `tenant` that asks `kind`, or nothing where it may. */
async function accessTenantChangeRefused(
  access: ProjectAccess,
  caller: Principal,
  tenant: TenantId,
  kind: TenantAccessKind,
): Promise<AccessChange | undefined> {
  if (!(await accessTenantListed(access, caller, tenant))) return "Absent";
  return (await accessTenantHeld(access, caller, tenant, kind))
    ? undefined
    : "Refused";
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
      const refused = await accessTenantChangeRefused(
        ports.access,
        caller,
        tenant,
        accessTenantRoleGrantKinds[role],
      );
      if (refused !== undefined) return refused;
      await ports.grants.write(grantOf(tenant, subject, role));
      return "Changed";
    },
    tenantRoleRemoved: async (caller, tenant, subject, role) => {
      const refused = await accessTenantChangeRefused(
        ports.access,
        caller,
        tenant,
        accessTenantRoleGrantKinds[role],
      );
      if (refused !== undefined) return refused;
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

/**
 * Giving and taking a person's hosted runs. The selector's principal is a
 * person here like any other: taking its hosted runs stops hosted dispatch in
 * the tenant, and holding `GrantHostedExecution` is what decides that.
 */
function accessHostedRunsChanges(
  ports: AccessPlanePorts,
  settings: AccessPlaneSettings,
): Pick<AccessPlane, "tenantHostedRunsGiven" | "tenantHostedRunsTaken"> {
  const changed =
    (verb: "write" | "remove") =>
    async (
      caller: Principal,
      tenant: TenantId,
      subject: string,
    ): Promise<AccessChange> => {
      const refused = await accessTenantChangeRefused(
        ports.access,
        caller,
        tenant,
        "GrantHostedExecution",
      );
      if (refused !== undefined) return refused;
      await ports.grants[verb](
        tenantPrincipalGrant({
          issuer: settings.issuer,
          subject,
          tenant,
          relation: accessHostedRunsRelation,
        }),
      );
      return "Changed";
    };
  return {
    tenantHostedRunsGiven: changed("write"),
    tenantHostedRunsTaken: changed("remove"),
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
      if (!(await accessProjectListed(ports.access, caller, partition)))
        return "Absent";
      if (
        !(await accessProjectHeld(
          ports.access,
          caller,
          partition,
          accessProjectRoleGrantKinds[role],
        ))
      )
        return "Refused";
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
      (await accessTenantListed(ports.access, caller, tenant))
        ? accessTenantPeopleRead(ports, settings, caller, tenant)
        : undefined,
    projectPeople: async (caller, partition) =>
      (await accessProjectListed(ports.access, caller, partition))
        ? accessProjectPeopleRead(ports, settings, caller, partition)
        : undefined,
    ...accessTenantChanges(ports, settings),
    ...accessProjectChanges(ports, settings),
    ...accessHostedRunsChanges(ports, settings),
  };
}
