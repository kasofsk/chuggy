/**
 * Who holds each of a workspace's permissions and each of the site's, as rows:
 * one a permission, named, and its holders in the order they are drawn, each
 * saying what kind of holder it is beside the words it is drawn in.
 *
 * Every name is one exhaustive function over the contract's roster, so an
 * authority or a group the plane adds is a compile error here before it is a
 * blank cell. A holder's kind is what a control hung on it later reads, so no
 * caller works out again from its words what it is.
 */

import type {
  AccessAuthorityPerson,
  AccessGroup,
  AccessSiteAuthorities,
  AccessSiteAuthority,
  AccessTenantAuthorities,
  AccessTenantAuthority,
} from "../../../../src/contract/accessPlane.ts";

import { tenantPersonName } from "./tenantPeople.ts";

/** What the page draws for a reader the workspace's list is not answered to. */
export const tenantPermissionsWithheld =
  "A workspace admin manages permissions";

export const permissionsNobody = "Nobody";

/** One holder of one permission, `words` what it is drawn as. */
export type PermissionHolder =
  | { readonly kind: "SiteStanding"; readonly words: string }
  | {
      readonly kind: "Group";
      readonly group: AccessGroup;
      readonly words: string;
    }
  | {
      readonly kind: "TenantAdmins";
      readonly tenant: string;
      readonly words: string;
    }
  | {
      readonly kind: "Person";
      readonly person: AccessAuthorityPerson;
      readonly words: string;
    }
  | {
      readonly kind: "Unnamed";
      readonly count: number;
      readonly words: string;
    };

/** One permission, named, and who holds it in the order they are drawn. */
export interface PermissionRow {
  readonly authority: AccessTenantAuthority | AccessSiteAuthority;
  readonly name: string;
  readonly holders: readonly PermissionHolder[];
}

export function tenantPermissionName(authority: AccessTenantAuthority): string {
  switch (authority) {
    case "AdminGranters":
      return "Admin grants";
    case "MemberGranters":
      return "Member grants";
    case "HostedRunsGranters":
      return "Hosted run grants";
    case "AuthorityManagers":
      return "Permission changes";
  }
}

export function sitePermissionName(authority: AccessSiteAuthority): string {
  switch (authority) {
    case "AccountCreators":
      return "Account creation";
    case "AuthorityManagers":
      return "Permission changes";
  }
}

export function permissionGroupName(group: AccessGroup): string {
  switch (group) {
    case "SiteAdmins":
      return "Site admins";
    case "TenantAdmins":
      return "Workspace admins";
    case "TenantMembers":
      return "Workspace members";
    case "ProjectAdmins":
      return "Project admins";
    case "ProjectDevelopers":
      return "Project developers";
  }
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
  return { kind: "TenantAdmins", tenant, words: `${tenant} admins` };
}

function permissionPersonHolder(
  person: AccessAuthorityPerson,
): PermissionHolder {
  return { kind: "Person", person, words: tenantPersonName(person).name };
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
          words: `${String(unnamed)} unnamed`,
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

export function tenantPermissionRows(
  answer: AccessTenantAuthorities,
): readonly PermissionRow[] {
  return answer.authorities.map((held) => ({
    authority: held.authority,
    name: tenantPermissionName(held.authority),
    holders: permissionHolders(held, [], []),
  }));
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
): readonly PermissionRow[] {
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
