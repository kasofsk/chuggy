/**
 * Who holds each of a project's, a workspace's and the site's permissions, as rows:
 * one a permission, named, and its holders in the order they are drawn, each
 * saying what kind of holder it is beside the words it is drawn in.
 *
 * Every name is one exhaustive function over the contract's roster, so an
 * authority or a group the plane adds is a compile error here before it is a
 * blank cell. A holder's kind is what its remove button reads, so no caller
 * works out again from its words what it is or whether a route removes it.
 *
 * What a row may be given is what its permission admits less what holds it
 * already: each group the contract's record admits, a workspace's admins where
 * the record admits a workspace, and a person from the level's people.
 */

import {
  accessProjectAuthorityAdmits,
  accessSiteAuthorityAdmits,
  accessTenantAuthorityAdmits,
  type AccessAuthorityPerson,
  type AccessGroup,
  type AccessProjectAuthorities,
  type AccessProjectAuthority,
  type AccessSiteAuthorities,
  type AccessSiteAuthority,
  type AccessTenantAbilities,
  type AccessTenantAuthorities,
  type AccessTenantAuthority,
} from "../../../../src/contract/accessPlane.ts";

import type { Copy } from "./copy.ts";
import { tenantPersonName } from "./tenantPeople.ts";

/** What the page draws for a reader the workspace's list is not answered to. */
export const tenantPermissionsWithheld: Copy = {
  id: "permissions-withheld-workspace",
};

/** What the page draws for a reader the project's list is not answered to. */
export const projectPermissionsWithheld: Copy = {
  id: "permissions-withheld-project",
};

/** What the page draws for a reader the site's list is not answered to. */
export const sitePermissionsWithheld: Copy = {
  id: "permissions-withheld-site",
};

export const permissionsNobody: Copy = { id: "permissions-nobody" };

/** One holder of one permission, `words` what it is drawn as. */
export type PermissionHolder =
  | { readonly kind: "SiteStanding"; readonly words: Copy }
  | {
      readonly kind: "Group";
      readonly group: AccessGroup;
      readonly words: Copy;
    }
  | {
      readonly kind: "TenantAdmins";
      readonly tenant: string;
      readonly words: Copy;
    }
  | {
      readonly kind: "Person";
      readonly person: AccessAuthorityPerson;
      readonly words: Copy;
    }
  | {
      readonly kind: "Unnamed";
      readonly count: number;
      readonly words: Copy;
    };

export type PermissionAuthority =
  AccessTenantAuthority | AccessSiteAuthority | AccessProjectAuthority;

/** One permission, named, and who holds it in the order they are drawn. */
export interface PermissionRow<
  Authority extends PermissionAuthority = PermissionAuthority,
> {
  readonly authority: Authority;
  readonly name: Copy;
  readonly holders: readonly PermissionHolder[];
}

export type PermissionLevel = "Project" | "Tenant" | "Site";

/** Whether the reader may change one permission, given the workspace's abilities where they were read; a project's and the site's lists answer only a reader who may. */
export function permissionChangeable(
  level: PermissionLevel,
  authority: PermissionAuthority,
  abilities: AccessTenantAbilities | undefined,
): boolean {
  switch (level) {
    case "Project":
    case "Site":
      return true;
    case "Tenant":
      if (abilities === undefined) return false;
      return authority === "HostedRunsGranters"
        ? abilities.manageSiteHeldAuthorities
        : abilities.manageAuthorities;
  }
}

/** Whether a route removes this holder from this row's permission. */
export function permissionHolderRemovable(
  row: PermissionRow,
  holder: PermissionHolder,
): boolean {
  switch (holder.kind) {
    case "Group":
    case "Person":
      return true;
    case "TenantAdmins":
      return row.authority === "AccountCreators";
    case "SiteStanding":
    case "Unnamed":
      return false;
  }
}

/** Whether removing one of this row's holders is asked first. */
export function permissionRemovalAsks(row: PermissionRow): boolean {
  return row.authority === "AuthorityManagers";
}

export const permissionRemovalQuestion: {
  readonly question: Copy;
  readonly line: Copy;
} = {
  question: { id: "permissions-removal-question" },
  line: { id: "permissions-removal-line" },
};

export function tenantPermissionName(authority: AccessTenantAuthority): Copy {
  switch (authority) {
    case "AdminGranters":
      return { id: "permissions-grant-admin" };
    case "MemberGranters":
      return { id: "permissions-grant-member" };
    case "HostedRunsGranters":
      return { id: "permissions-grant-hosted-runs" };
    case "PersonalRunnersGranters":
      return { id: "permissions-grant-personal-runners" };
    case "UnscopedChatGranters":
      return { id: "permissions-grant-unscoped-chat" };
    case "AuthorityManagers":
      return { id: "permissions-change" };
  }
}

export function projectPermissionName(authority: AccessProjectAuthority): Copy {
  switch (authority) {
    case "AdminGranters":
      return { id: "permissions-grant-admin" };
    case "DeveloperGranters":
      return { id: "permissions-grant-developer" };
    case "DispatcherGranters":
      return { id: "permissions-grant-dispatcher" };
    case "ViewerGranters":
      return { id: "permissions-grant-viewer" };
    case "AuthorityManagers":
      return { id: "permissions-change" };
  }
}

export function sitePermissionName(authority: AccessSiteAuthority): Copy {
  switch (authority) {
    case "AccountCreators":
      return { id: "permissions-create-accounts" };
    case "TenantCreators":
      return { id: "permissions-create-workspaces" };
    case "AuthorityManagers":
      return { id: "permissions-change" };
  }
}

export function permissionGroupName(group: AccessGroup): Copy {
  switch (group) {
    case "SiteAdmins":
      return { id: "permissions-group-site-admins" };
    case "TenantAdmins":
      return { id: "permissions-group-workspace-admins" };
    case "TenantMembers":
      return { id: "permissions-group-workspace-members" };
    case "ProjectAdmins":
      return { id: "permissions-group-project-admins" };
    case "ProjectDevelopers":
      return { id: "permissions-group-project-developers" };
  }
}

/** What stands after a person's name on a permission: that they are no
 * account, and that they are the reader. */
export function permissionPersonMarks(
  person: AccessAuthorityPerson,
): readonly Copy[] {
  const unaccounted: Copy = { id: "permissions-person-unaccounted" };
  const mine: Copy = { id: "permissions-person-mine" };
  return [
    ...(person.account ? [] : [unaccounted]),
    ...(person.mine ? [mine] : []),
  ];
}

/** What every level's answer names of one authority's holders. */
interface PermissionHeld {
  readonly groups: readonly AccessGroup[];
  readonly people: readonly AccessAuthorityPerson[];
  readonly unnamed: number;
}

function permissionGroupHolder(group: AccessGroup): PermissionHolder {
  return { kind: "Group", group, words: permissionGroupName(group) };
}

function permissionTenantHolder(tenant: string): PermissionHolder {
  return {
    kind: "TenantAdmins",
    tenant,
    words: { id: "permissions-tenant-admins", args: { tenant } },
  };
}

function permissionPersonHolder(
  person: AccessAuthorityPerson,
): PermissionHolder {
  return {
    kind: "Person",
    person,
    words: {
      id: "permissions-person-named",
      args: { name: tenantPersonName(person).name },
    },
  };
}

/** The unnamed count, where there is one. */
function permissionUnnamedHolders(
  unnamed: number,
): readonly PermissionHolder[] {
  return unnamed === 0
    ? []
    : [
        {
          kind: "Unnamed",
          count: unnamed,
          words: { id: "permissions-unnamed", args: { count: unnamed } },
        },
      ];
}

/** Holders in the order drawn: those `first`, groups, those `between`, people, and the unnamed count. */
function permissionHolders(
  held: PermissionHeld,
  first: readonly PermissionHolder[],
  between: readonly PermissionHolder[],
): readonly PermissionHolder[] {
  return [
    ...first,
    ...held.groups.map(permissionGroupHolder),
    ...between,
    ...held.people.map(permissionPersonHolder),
    ...permissionUnnamedHolders(held.unnamed),
  ];
}

/** A level whose holders are its groups, people and unnamed count alone, each row named. */
function permissionRowsNamed<Authority extends PermissionAuthority>(
  authorities: readonly (PermissionHeld & { readonly authority: Authority })[],
  name: (authority: Authority) => Copy,
): readonly PermissionRow<Authority>[] {
  return authorities.map((held) => ({
    authority: held.authority,
    name: name(held.authority),
    holders: permissionHolders(held, [], []),
  }));
}

export function tenantPermissionRows(
  answer: AccessTenantAuthorities,
): readonly PermissionRow<AccessTenantAuthority>[] {
  return permissionRowsNamed(answer.authorities, tenantPermissionName);
}

export function projectPermissionRows(
  answer: AccessProjectAuthorities,
): readonly PermissionRow<AccessProjectAuthority>[] {
  return permissionRowsNamed(answer.authorities, projectPermissionName);
}

/** The site's admins manage its permissions whoever else does, and its list does not name them. */
function sitePermissionStanding(
  authority: AccessSiteAuthority,
): readonly PermissionHolder[] {
  return authority === "AuthorityManagers"
    ? [{ kind: "SiteStanding", words: permissionGroupName("SiteAdmins") }]
    : [];
}

export function sitePermissionRows(
  answer: AccessSiteAuthorities,
): readonly PermissionRow<AccessSiteAuthority>[] {
  return answer.authorities.map((held) => ({
    authority: held.authority,
    name: sitePermissionName(held.authority),
    holders: permissionHolders(
      held,
      sitePermissionStanding(held.authority),
      held.tenants.map(permissionTenantHolder),
    ),
  }));
}

/** What one permission admits: these groups, and whether a workspace's admins. */
export interface PermissionAdmits {
  readonly groups: readonly AccessGroup[];
  readonly tenants: boolean;
}

export function tenantPermissionAdmits(
  authority: AccessTenantAuthority,
): PermissionAdmits {
  return { groups: accessTenantAuthorityAdmits[authority], tenants: false };
}

export function projectPermissionAdmits(
  authority: AccessProjectAuthority,
): PermissionAdmits {
  return { groups: accessProjectAuthorityAdmits[authority], tenants: false };
}

export function sitePermissionAdmits(
  authority: AccessSiteAuthority,
): PermissionAdmits {
  return accessSiteAuthorityAdmits[authority];
}

/** One holder a row may be given, `line` what choosing it says beside it. */
export type PermissionChoice =
  | {
      readonly kind: "Group";
      readonly group: AccessGroup;
      readonly words: Copy;
      readonly line: Copy | undefined;
    }
  | {
      readonly kind: "TenantAdmins";
      readonly tenant: string;
      readonly words: Copy;
      readonly line: undefined;
    }
  | { readonly kind: "Person"; readonly words: Copy; readonly line: Copy };

export const permissionMembersGrantLine: Copy = {
  id: "permissions-members-grant",
};

export const permissionDevelopersGrantLine: Copy = {
  id: "permissions-developers-grant",
};

export const permissionDevelopersViewerGrantLine: Copy = {
  id: "permissions-developers-viewer-grant",
};

/** The line `ProjectDevelopers` carries on each project authority whose grant opens the people list to it. */
const permissionProjectDevelopersLines: Partial<
  Record<PermissionAuthority, Copy>
> = {
  DeveloperGranters: permissionDevelopersGrantLine,
  ViewerGranters: permissionDevelopersViewerGrantLine,
};

/** The group whose grant opens the level's people list to it, and the line it carries. */
function permissionChoiceGroupLine(
  level: PermissionLevel,
  row: PermissionRow,
  group: AccessGroup,
): Copy | undefined {
  switch (level) {
    case "Project":
      return group === "ProjectDevelopers"
        ? permissionProjectDevelopersLines[row.authority]
        : undefined;
    case "Tenant":
      return row.authority === "MemberGranters" && group === "TenantMembers"
        ? permissionMembersGrantLine
        : undefined;
    case "Site":
      return undefined;
  }
}

/** Where a level's people are chosen from, said beside `Person`. */
function permissionPersonLine(level: PermissionLevel): Copy {
  switch (level) {
    case "Project":
      return { id: "permissions-from-project" };
    case "Tenant":
    case "Site":
      return { id: "permissions-from-people" };
  }
}

/**
 * What a row may be given, in the order offered: each group admitted and not
 * held, this workspace's admins where admitted and not holding, and a person
 * where the level's people were read and leave someone to offer.
 */
export function permissionAdditionChoices(
  level: PermissionLevel,
  row: PermissionRow,
  admits: PermissionAdmits,
  tenant: string,
  people: readonly AccessAuthorityPerson[] | undefined,
): readonly PermissionChoice[] {
  const held = row.holders;
  const groups = admits.groups.filter(
    (group) =>
      !held.some((holder) => holder.kind === "Group" && holder.group === group),
  );
  const tenantHeld = held.some(
    (holder) => holder.kind === "TenantAdmins" && holder.tenant === tenant,
  );
  return [
    ...groups.map((group) => ({
      kind: "Group" as const,
      group,
      words: permissionGroupName(group),
      line: permissionChoiceGroupLine(level, row, group),
    })),
    ...(admits.tenants && !tenantHeld
      ? [
          {
            kind: "TenantAdmins" as const,
            tenant,
            words: { id: "permissions-this-workspace-admins" } as const,
            line: undefined,
          },
        ]
      : []),
    ...(people === undefined || people.length === 0
      ? []
      : [
          {
            kind: "Person" as const,
            words: { id: "permissions-person" } as const,
            line: permissionPersonLine(level),
          },
        ]),
  ];
}

/** The level's people who do not hold the row's permission, absent where they were not read. */
export function permissionAdditionPeople<Person extends AccessAuthorityPerson>(
  people: { readonly people: readonly Person[] } | undefined,
  row: PermissionRow,
): readonly Person[] | undefined {
  return people?.people.filter(
    (person) =>
      !row.holders.some(
        (holder) =>
          holder.kind === "Person" && holder.person.subject === person.subject,
      ),
  );
}

/** A choice as a radio's value, one apart from every other a row offers. */
export function permissionChoiceValue(choice: PermissionChoice): string {
  switch (choice.kind) {
    case "Group":
      return `Group:${choice.group}`;
    case "TenantAdmins":
      return `TenantAdmins:${choice.tenant}`;
    case "Person":
      return "Person";
  }
}

/** The holder a choice sends, absent for a person until one is chosen. */
export function permissionChoiceHolder(
  choice: PermissionChoice | undefined,
  person: AccessAuthorityPerson | undefined,
): PermissionHolder | undefined {
  switch (choice?.kind) {
    case undefined:
      return undefined;
    case "Group":
      return permissionGroupHolder(choice.group);
    case "TenantAdmins":
      return permissionTenantHolder(choice.tenant);
    case "Person":
      return person === undefined ? undefined : permissionPersonHolder(person);
  }
}
