/**
 * A workspace's permissions and the site's, decided with no renderer: every
 * authority and group the contract rosters has its own name, and each answer
 * comes to rows whose holders are in the order drawn and say what they are.
 */

import { expect, test } from "vitest";

import {
  accessProjectGroups,
  accessSiteAuthorities,
  accessTenantAuthorities,
  type AccessSiteAuthorities,
  type AccessTenantAuthorities,
} from "../../../src/contract/accessPlane.ts";
import {
  permissionGroupName,
  sitePermissionName,
  sitePermissionRows,
  tenantPermissionName,
  tenantPermissionRows,
} from "../app/core/permissions.ts";

test("every authority each level rosters has its own name", () => {
  expect(accessTenantAuthorities.map(tenantPermissionName)).toStrictEqual([
    "Admin grants",
    "Member grants",
    "Hosted run grants",
    "Permission changes",
  ]);
  expect(accessSiteAuthorities.map(sitePermissionName)).toStrictEqual([
    "Account creation",
    "Permission changes",
  ]);
});

test("every group the contract rosters has its own name", () => {
  expect(accessProjectGroups.map(permissionGroupName)).toStrictEqual([
    "Site admins",
    "Workspace admins",
    "Workspace members",
    "Project admins",
    "Project developers",
  ]);
});

const ada = {
  subject: "s-ada",
  mine: false,
  account: true,
  email: "ada@example.com",
};

test("a workspace's holders are its groups, then its people, then the unnamed count, each saying what it is", () => {
  const answer: AccessTenantAuthorities = {
    tenant: "acme",
    authorities: accessTenantAuthorities.map((authority) => ({
      authority,
      people: authority === "AdminGranters" ? [ada] : [],
      groups:
        authority === "AdminGranters" ? ["SiteAdmins", "TenantAdmins"] : [],
      unnamed: authority === "AdminGranters" ? 2 : 0,
    })),
    truncated: false,
  };
  const rows = tenantPermissionRows(answer);
  expect(rows.map((row) => row.authority)).toStrictEqual([
    ...accessTenantAuthorities,
  ]);
  expect(rows[0]?.holders).toStrictEqual([
    { kind: "Group", group: "SiteAdmins", words: "Site admins" },
    { kind: "Group", group: "TenantAdmins", words: "Workspace admins" },
    { kind: "Person", person: ada, words: "ada@example.com" },
    { kind: "Unnamed", count: 2, words: "2 unnamed" },
  ]);
  expect(rows[1]?.holders).toStrictEqual([]);
});

test("the site's permission changes lead with its standing admins, and a workspace's admins follow the groups", () => {
  const answer: AccessSiteAuthorities = {
    authorities: accessSiteAuthorities.map((authority) => ({
      authority,
      people: [ada],
      groups: ["SiteAdmins"],
      tenants: ["acme"],
      unnamed: 0,
    })),
    truncated: false,
  };
  const [creators, managers] = sitePermissionRows(answer);
  const held = [
    { kind: "Group", group: "SiteAdmins", words: "Site admins" },
    { kind: "TenantAdmins", tenant: "acme", words: "acme admins" },
    { kind: "Person", person: ada, words: "ada@example.com" },
  ];
  expect(creators?.holders).toStrictEqual(held);
  expect(managers?.holders).toStrictEqual([
    { kind: "SiteStanding", words: "Site admins" },
    ...held,
  ]);
});

test("the site's permission changes name its standing admins where the answer names no holder", () => {
  const rows = sitePermissionRows({
    authorities: [
      {
        authority: "AuthorityManagers",
        people: [],
        groups: [],
        tenants: [],
        unnamed: 0,
      },
    ],
    truncated: false,
  });
  expect(rows[0]?.holders).toStrictEqual([
    { kind: "SiteStanding", words: "Site admins" },
  ]);
});
