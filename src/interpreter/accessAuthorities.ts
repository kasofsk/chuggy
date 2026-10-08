/**
 * Who holds each authority of the site, a tenant or a project, listed to a
 * caller the authority says may manage that level's.
 *
 * EVERY NAME AN ANSWER CARRIES PASSES THROUGH ONE RECORD. An authority is
 * asked as the relation its level's record names, and a subject set is a group
 * only where it is the set `accessGroupSubject` makes of that group where the
 * list is asked, which is also the set a holder would be written as. A set no
 * group is, and a principal derived under another issuer, is counted as
 * unnamed rather than dropped. On the site's list the administrators of a
 * tenant are named by the tenant instead.
 *
 * A GROUP IS NAMED WHETHER OR NOT THE MODEL DECLARES IT THERE. Keto stores any
 * tuple, so a holder written by hand that a roster can name is shown, and one
 * it cannot is counted.
 *
 * EACH AUTHORITY IS READ AS ITS OWN RELATION, under one budget per answer as a
 * people list is, so no other tuple on the object takes a holder's place. A
 * holder stored in several rows is answered once, and who a person is is asked
 * of the directory once per answer.
 */

import {
  accessProjectAuthorities,
  accessProjectGroups,
  accessSiteAuthorities,
  accessSiteGroups,
  accessTenantAuthorities,
  accessTenantGroups,
  type AccessAuthorityPerson,
  type AccessGroup,
  type AccessProjectAuthorities,
  type AccessProjectAuthority,
  type AccessSiteAuthorities,
  type AccessSiteAuthority,
  type AccessTenantAuthorities,
  type AccessTenantAuthority,
} from "../contract/accessPlane.ts";
import type { AccessDirectory } from "./accessDirectory.ts";
import {
  accessAccountsNamed,
  accessBudget,
  accessProjectHeld,
  accessTenantHeld,
  accessTuplesRead,
  type AccessBudget,
  type AccessPlaneBounds,
  type AccessTuple,
  type AccessTupleReader,
  type AccessTupleSubject,
} from "./accessPlane.ts";
import { oidcPrincipalSubject, type Principal } from "./principal.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessObjectTenant,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccess,
} from "./projectAccess.ts";
import type {
  ProjectAuthorityRelation,
  ProjectGrantHolderRelation,
  ProjectGrantSubject,
  SiteAuthorityRelation,
  TenantAuthorityRelation,
} from "./projectGrant.ts";
import type { Partition, TenantId } from "./projectStore.ts";

export interface AccessAuthoritiesPorts {
  readonly access: ProjectAccess;
  readonly tuples: AccessTupleReader;
  readonly directory?: AccessDirectory | undefined;
}

/** The issuer every subject is derived under, and what one answer may read. */
export interface AccessAuthoritiesSettings {
  readonly issuer: string;
  readonly bounds: AccessPlaneBounds;
}

export interface AccessAuthorities {
  siteAuthorities(
    caller: Principal,
  ): Promise<AccessSiteAuthorities | undefined>;
  tenantAuthorities(
    caller: Principal,
    tenant: TenantId,
  ): Promise<AccessTenantAuthorities | undefined>;
  projectAuthorities(
    caller: Principal,
    partition: Partition,
  ): Promise<AccessProjectAuthorities | undefined>;
}

/** The relation each of the site's authorities is. */
export const accessSiteAuthorityRelations: Readonly<
  Record<AccessSiteAuthority, SiteAuthorityRelation>
> = {
  AccountCreators: "account_creators",
  TenantCreators: "tenant_creators",
  AuthorityManagers: "authority_managers",
};

/** The relation each of a tenant's authorities is. */
export const accessTenantAuthorityRelations: Readonly<
  Record<AccessTenantAuthority, TenantAuthorityRelation>
> = {
  AdminGranters: "admin_granters",
  MemberGranters: "member_granters",
  HostedRunsGranters: "hosted_execution_granters",
  AuthorityManagers: "authority_managers",
};

/** The relation each of a project's authorities is. */
export const accessProjectAuthorityRelations: Readonly<
  Record<AccessProjectAuthority, ProjectAuthorityRelation>
> = {
  AdminGranters: "admin_granters",
  DeveloperGranters: "developer_granters",
  DispatcherGranters: "dispatcher_granters",
  AuthorityManagers: "authority_managers",
};

/** The role each group holds, and the namespace of the object it holds it on. */
export const accessGroupHolders: Readonly<
  Record<
    AccessGroup,
    {
      readonly namespace: string;
      readonly relation: ProjectGrantHolderRelation;
    }
  >
> = {
  SiteAdmins: { namespace: projectAccessSiteNamespace, relation: "admins" },
  TenantAdmins: { namespace: projectAccessTenantNamespace, relation: "admins" },
  TenantMembers: {
    namespace: projectAccessTenantNamespace,
    relation: "members",
  },
  ProjectAdmins: { namespace: projectAccessNamespace, relation: "admins" },
  ProjectDevelopers: {
    namespace: projectAccessNamespace,
    relation: "developers",
  },
};

/** Where a list is asked: the object of each namespace its groups are named on. */
export type AccessAuthorityPlace = Readonly<Record<string, string>>;

type AccessSetSubject = Extract<
  AccessTupleSubject,
  { readonly subject: "Set" }
>;

/** The holder `group` is written as where `place` names its namespace's object. */
export function accessGroupHolder(
  place: AccessAuthorityPlace,
  group: AccessGroup,
): Extract<ProjectGrantSubject, { readonly subject: "Holders" }> {
  const { namespace, relation } = accessGroupHolders[group];
  const object = place[namespace];
  if (object === undefined)
    throw new RangeError(`access authorities: ${group} is not named here`);
  return { subject: "Holders", namespace, object, relation };
}

/** The subject set `group` is where `place` names its namespace's object. */
export function accessGroupSubject(
  place: AccessAuthorityPlace,
  group: AccessGroup,
): AccessSetSubject {
  return { ...accessGroupHolder(place, group), subject: "Set" };
}

/** One list's level: the object its authorities are relations of, its rosters and where its groups are named. */
interface AccessAuthorityLevel<
  Authority extends string,
  Group extends AccessGroup,
> {
  readonly namespace: string;
  readonly object: string;
  readonly authorities: readonly Authority[];
  readonly relations: Readonly<Record<Authority, string>>;
  readonly groups: readonly Group[];
  readonly place: AccessAuthorityPlace;
}

/** Who holds one authority, each person named and each set no group is left to its level. */
interface AccessAuthorityRead<
  Authority extends string,
  Group extends AccessGroup,
> {
  readonly authority: Authority;
  readonly people: AccessAuthorityPerson[];
  readonly groups: Group[];
  readonly others: readonly AccessSetSubject[];
  readonly otherIssuers: number;
}

function accessSetKey(set: AccessSetSubject): string {
  return JSON.stringify([set.namespace, set.object, set.relation]);
}

/** Each distinct principal and each distinct subject set the tuples name. */
export function accessAuthorityHolders(tuples: readonly AccessTuple[]): {
  readonly principals: readonly string[];
  readonly sets: ReadonlyMap<string, AccessSetSubject>;
} {
  const principals = new Set<string>();
  const sets = new Map<string, AccessSetSubject>();
  for (const { subject } of tuples)
    if (subject.subject === "Id") principals.add(subject.id);
    else sets.set(accessSetKey(subject), subject);
  return { principals: [...principals].sort(), sets };
}

/** The holders of one authority, named against `level`, before the directory is asked. */
function accessAuthorityNamed<
  Authority extends string,
  Group extends AccessGroup,
>(
  level: AccessAuthorityLevel<Authority, Group>,
  authority: Authority,
  tuples: readonly AccessTuple[],
  named: (principal: string) => AccessAuthorityPerson | undefined,
): AccessAuthorityRead<Authority, Group> {
  const { principals, sets } = accessAuthorityHolders(tuples);
  const groupKeys = new Map(
    level.groups.map(
      (group) =>
        [accessSetKey(accessGroupSubject(level.place, group)), group] as const,
    ),
  );
  const people = principals.flatMap((principal) => named(principal) ?? []);
  return {
    authority,
    people,
    groups: level.groups.filter((group) =>
      sets.has(accessSetKey(accessGroupSubject(level.place, group))),
    ),
    others: [...sets.entries()].flatMap(([key, set]) =>
      groupKeys.has(key) ? [] : [set],
    ),
    otherIssuers: principals.length - people.length,
  };
}

/** The person `principal` is under `issuer`, the caller's marked, or nothing where it is derived under another issuer. */
export function accessAuthorityPerson(
  issuer: string,
  caller: Principal,
  principal: string,
): AccessAuthorityPerson | undefined {
  const subject = oidcPrincipalSubject(issuer, principal);
  return subject === undefined
    ? undefined
    : { subject, mine: principal === caller };
}

/** Each list's people marked with who the directory says they are, asked once for every list. */
export async function accessAuthorityPeopleAccounts(
  directory: AccessDirectory | undefined,
  lists: readonly (readonly AccessAuthorityPerson[])[],
): Promise<AccessAuthorityPerson[][]> {
  const unique = new Map(
    lists.flatMap((people) => people.map((person) => [person.subject, person])),
  );
  const accounted = new Map(
    (await accessAccountsNamed(directory, [...unique.values()])).map(
      (person) => [person.subject, person] as const,
    ),
  );
  return lists.map((people) =>
    people.map((person) => accounted.get(person.subject) ?? person),
  );
}

/** Who holds each of `level`'s authorities, in roster order, and whether a bound cut the answer. */
async function accessAuthoritiesRead<
  Authority extends string,
  Group extends AccessGroup,
>(
  ports: AccessAuthoritiesPorts,
  settings: AccessAuthoritiesSettings,
  caller: Principal,
  level: AccessAuthorityLevel<Authority, Group>,
): Promise<{
  readonly read: AccessAuthorityRead<Authority, Group>[];
  readonly truncated: boolean;
}> {
  const budget: AccessBudget = accessBudget(settings.bounds);
  const named = (principal: string) =>
    accessAuthorityPerson(settings.issuer, caller, principal);
  const read: AccessAuthorityRead<Authority, Group>[] = [];
  for (const authority of level.authorities)
    read.push(
      accessAuthorityNamed(
        level,
        authority,
        await accessTuplesRead(ports.tuples, budget, {
          query: "Object",
          namespace: level.namespace,
          object: level.object,
          relation: level.relations[authority],
        }),
        named,
      ),
    );
  const accounted = await accessAuthorityPeopleAccounts(
    ports.directory,
    read.map((held) => held.people),
  );
  return {
    read: read.map((held, index) => ({
      ...held,
      people: accounted[index] ?? held.people,
    })),
    truncated: budget.truncated,
  };
}

/** One authority's holders as a tenant's or a project's list answers them, every set no group is counted. */
function accessAuthorityAnswered<
  Authority extends string,
  Group extends AccessGroup,
>(held: AccessAuthorityRead<Authority, Group>) {
  return {
    authority: held.authority,
    people: held.people,
    groups: held.groups,
    unnamed: held.others.length + held.otherIssuers,
  };
}

/** The tenant whose administrators `set` is, or nothing where it is no tenant's administrators. */
export function accessSiteHeldTenant(
  set: AccessSetSubject,
): TenantId | undefined {
  const administrators = accessGroupHolders.TenantAdmins;
  return set.namespace === administrators.namespace &&
    set.relation === administrators.relation
    ? projectAccessObjectTenant(set.object)
    : undefined;
}

export const accessSitePlace: AccessAuthorityPlace = {
  [projectAccessSiteNamespace]: projectAccessSiteObject,
};

async function accessSiteAuthoritiesRead(
  ports: AccessAuthoritiesPorts,
  settings: AccessAuthoritiesSettings,
  caller: Principal,
): Promise<AccessSiteAuthorities> {
  const { read, truncated } = await accessAuthoritiesRead(
    ports,
    settings,
    caller,
    {
      namespace: projectAccessSiteNamespace,
      object: projectAccessSiteObject,
      authorities: accessSiteAuthorities,
      relations: accessSiteAuthorityRelations,
      groups: accessSiteGroups,
      place: accessSitePlace,
    },
  );
  return {
    authorities: read.map((held) => {
      const tenants = held.others.flatMap(
        (set) => accessSiteHeldTenant(set) ?? [],
      );
      return {
        ...accessAuthorityAnswered(held),
        tenants: [...tenants].sort(),
        unnamed: held.others.length - tenants.length + held.otherIssuers,
      };
    }),
    truncated,
  };
}

export function accessTenantPlace(tenant: TenantId): AccessAuthorityPlace {
  return {
    ...accessSitePlace,
    [projectAccessTenantNamespace]: projectAccessTenantObject(tenant),
  };
}

export function accessProjectPlace(partition: Partition): AccessAuthorityPlace {
  return {
    ...accessTenantPlace(partition.tenant),
    [projectAccessNamespace]: projectAccessObject(partition),
  };
}

async function accessTenantAuthoritiesRead(
  ports: AccessAuthoritiesPorts,
  settings: AccessAuthoritiesSettings,
  caller: Principal,
  tenant: TenantId,
): Promise<AccessTenantAuthorities> {
  const { read, truncated } = await accessAuthoritiesRead(
    ports,
    settings,
    caller,
    {
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(tenant),
      authorities: accessTenantAuthorities,
      relations: accessTenantAuthorityRelations,
      groups: accessTenantGroups,
      place: accessTenantPlace(tenant),
    },
  );
  return {
    tenant,
    authorities: read.map(accessAuthorityAnswered),
    truncated,
  };
}

async function accessProjectAuthoritiesRead(
  ports: AccessAuthoritiesPorts,
  settings: AccessAuthoritiesSettings,
  caller: Principal,
  partition: Partition,
): Promise<AccessProjectAuthorities> {
  const object = projectAccessObject(partition);
  const { read, truncated } = await accessAuthoritiesRead(
    ports,
    settings,
    caller,
    {
      namespace: projectAccessNamespace,
      object,
      authorities: accessProjectAuthorities,
      relations: accessProjectAuthorityRelations,
      groups: accessProjectGroups,
      place: accessProjectPlace(partition),
    },
  );
  return {
    tenant: partition.tenant,
    project: partition.project,
    authorities: read.map(accessAuthorityAnswered),
    truncated,
  };
}

/** Whether `caller` is answered the site's list. */
export async function accessSiteAuthoritiesListed(
  access: ProjectAccess,
  caller: Principal,
): Promise<boolean> {
  return (
    (await access.authorizeSite(caller, "ManageSiteAuthorities")) !== undefined
  );
}

/** Whether `caller` is answered the tenant's list. */
export async function accessTenantAuthoritiesListed(
  access: ProjectAccess,
  caller: Principal,
  tenant: TenantId,
): Promise<boolean> {
  return (
    (await accessTenantHeld(
      access,
      caller,
      tenant,
      "ManageTenantAuthorities",
    )) ||
    (await accessTenantHeld(
      access,
      caller,
      tenant,
      "ManageSiteHeldAuthorities",
    ))
  );
}

/** Whether `caller` is answered the project's list. */
export function accessProjectAuthoritiesListed(
  access: ProjectAccess,
  caller: Principal,
  partition: Partition,
): Promise<boolean> {
  return accessProjectHeld(
    access,
    caller,
    partition,
    "ManageProjectAuthorities",
  );
}

export function accessAuthorities(
  ports: AccessAuthoritiesPorts,
  settings: AccessAuthoritiesSettings,
): AccessAuthorities {
  if (settings.issuer.length === 0)
    throw new RangeError("access authorities: the issuer is empty");
  return {
    siteAuthorities: async (caller) =>
      (await accessSiteAuthoritiesListed(ports.access, caller))
        ? accessSiteAuthoritiesRead(ports, settings, caller)
        : undefined,
    tenantAuthorities: async (caller, tenant) =>
      (await accessTenantAuthoritiesListed(ports.access, caller, tenant))
        ? accessTenantAuthoritiesRead(ports, settings, caller, tenant)
        : undefined,
    projectAuthorities: async (caller, partition) =>
      (await accessProjectAuthoritiesListed(ports.access, caller, partition))
        ? accessProjectAuthoritiesRead(ports, settings, caller, partition)
        : undefined,
  };
}
