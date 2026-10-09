/**
 * A workspace's permissions and the site's, decided with no renderer: every
 * authority and group the contract rosters has its own name, and each answer
 * comes to rows whose holders are in the order drawn and say what they are,
 * and which of them a reader may remove, and what each row may be given.
 */

import { expect, test } from "vitest";

import {
  accessProjectAuthorities,
  accessProjectGroups,
  accessSiteAuthorities,
  accessTenantAuthorities,
  type AccessProjectPeople,
  type AccessSiteAuthorities,
  type AccessTenantAbilities,
  type AccessTenantAuthorities,
  type AccessTenantPeople,
} from "../../../src/contract/accessPlane.ts";
import {
  permissionAdditionChoices,
  permissionAdditionPeople,
  permissionChangeable,
  permissionChoiceHolder,
  permissionChoiceValue,
  permissionGroupName,
  permissionHolderRemovable,
  permissionPersonMarks,
  permissionRemovalAsks,
  projectPermissionAdmits,
  projectPermissionName,
  projectPermissionRows,
  sitePermissionAdmits,
  sitePermissionName,
  sitePermissionRows,
  tenantPermissionAdmits,
  tenantPermissionName,
  tenantPermissionRows,
} from "../app/core/permissions.ts";

test("every authority each level rosters has its own name", () => {
  expect(accessTenantAuthorities.map(tenantPermissionName)).toStrictEqual([
    "Grant Admin",
    "Grant Member",
    "Grant hosted runs",
    "Change permissions",
  ]);
  expect(accessSiteAuthorities.map(sitePermissionName)).toStrictEqual([
    "Create accounts",
    "Create workspaces",
    "Change permissions",
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
  const [creators, tenantCreators, managers] = sitePermissionRows(answer);
  const held = [
    { kind: "Group", group: "SiteAdmins", words: "Site admins" },
    { kind: "TenantAdmins", tenant: "acme", words: "acme admins" },
    { kind: "Person", person: ada, words: "ada@example.com" },
  ];
  expect(creators?.holders).toStrictEqual(held);
  expect(tenantCreators?.holders).toStrictEqual(held);
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

const abilities: AccessTenantAbilities = {
  tenant: "acme",
  roles: [],
  grantHostedRuns: false,
  createAccount: false,
  manageAuthorities: true,
  manageSiteHeldAuthorities: false,
  projects: [],
  truncated: false,
};

test("a workspace's permissions are changed where the reader manages them, and Grant hosted runs where they manage what the site holds", () => {
  const changeable = (held: AccessTenantAbilities | undefined) =>
    accessTenantAuthorities.map((authority) =>
      permissionChangeable("Tenant", authority, held),
    );
  expect(changeable(abilities)).toStrictEqual([true, true, false, true]);
  expect(
    changeable({
      ...abilities,
      manageAuthorities: false,
      manageSiteHeldAuthorities: true,
    }),
  ).toStrictEqual([false, false, true, false]);
  expect(changeable(undefined)).toStrictEqual([false, false, false, false]);
});

test("the site's permissions are always changed by a reader shown them", () => {
  expect(
    accessSiteAuthorities.map((authority) =>
      permissionChangeable("Site", authority, undefined),
    ),
  ).toStrictEqual([true, true, true]);
});

test("a route removes a group, a person and a workspace's account creation, and no standing admin, unnamed count or workspace's permission changes", () => {
  const [creators, tenantCreators, managers] = sitePermissionRows({
    authorities: accessSiteAuthorities.map((authority) => ({
      authority,
      people: [ada],
      groups: ["SiteAdmins"],
      tenants: ["acme"],
      unnamed: 1,
    })),
    truncated: false,
  });
  const removable = (row: typeof creators) =>
    row?.holders.map((holder) => permissionHolderRemovable(row, holder));
  expect(removable(creators)).toStrictEqual([true, true, true, false]);
  expect(removable(tenantCreators)).toStrictEqual([true, false, true, false]);
  expect(removable(managers)).toStrictEqual([false, true, false, true, false]);
});

test("a person is marked where they are no account and where they are the reader, in that order", () => {
  const marks = (account: boolean, mine: boolean): readonly string[] =>
    permissionPersonMarks(
      account
        ? { subject: "s-ada", mine, account, email: "ada@example.com" }
        : { subject: "s-ada", mine, account },
    );
  expect(marks(true, false)).toStrictEqual([]);
  expect(marks(true, true)).toStrictEqual(["You"]);
  expect(marks(false, false)).toStrictEqual(["No account"]);
  expect(marks(false, true)).toStrictEqual(["No account", "You"]);
});

test("only removing a holder of permission changes is asked first", () => {
  const rows = tenantPermissionRows({
    tenant: "acme",
    authorities: accessTenantAuthorities.map((authority) => ({
      authority,
      people: [],
      groups: [],
      unnamed: 0,
    })),
    truncated: false,
  });
  expect(rows.map(permissionRemovalAsks)).toStrictEqual([
    false,
    false,
    false,
    true,
  ]);
});

/** Each workspace permission held by its admins alone. */
const tenantRowsAdminsOnly = tenantPermissionRows({
  tenant: "acme",
  authorities: accessTenantAuthorities.map((authority) => ({
    authority,
    people: authority === "AdminGranters" ? [ada] : [],
    groups: ["TenantAdmins"],
    unnamed: 0,
  })),
  truncated: false,
});

function tenantChoicesWords(
  people: readonly (typeof ada)[] | undefined,
): readonly (readonly string[])[] {
  return tenantRowsAdminsOnly.map((row) =>
    permissionAdditionChoices(
      "Tenant",
      row,
      tenantPermissionAdmits(row.authority),
      "acme",
      people,
    ).map((choice) => choice.words),
  );
}

test("a workspace permission offers each group its record admits and it does not hold, then a person where the People list leaves one", () => {
  expect(tenantChoicesWords([ada])).toStrictEqual([
    ["Site admins", "Person"],
    ["Site admins", "Workspace members", "Person"],
    ["Site admins", "Person"],
    ["Person"],
  ]);
  expect(tenantChoicesWords(undefined)).toStrictEqual([
    ["Site admins"],
    ["Site admins", "Workspace members"],
    ["Site admins"],
    [],
  ]);
  expect(tenantChoicesWords([])).toStrictEqual(tenantChoicesWords(undefined));
});

test("only Workspace members on Grant Member, and Person, carry a line", () => {
  const lines = tenantRowsAdminsOnly.flatMap((row) =>
    permissionAdditionChoices(
      "Tenant",
      row,
      tenantPermissionAdmits(row.authority),
      "acme",
      [ada],
    )
      .filter((choice) => choice.line !== undefined)
      .map((choice) => `${row.name}: ${choice.words}: ${choice.line ?? ""}`),
  );
  expect(lines).toStrictEqual([
    "Grant Admin: Person: From the People list",
    "Grant Member: Workspace members: Members will see people and can remove other members.",
    "Grant Member: Person: From the People list",
    "Grant hosted runs: Person: From the People list",
    "Change permissions: Person: From the People list",
  ]);
});

test("the site's account creation offers this workspace's admins only where they do not hold it, and its permission changes no group", () => {
  const rows = (tenants: readonly string[]) =>
    sitePermissionRows({
      authorities: accessSiteAuthorities.map((authority) => ({
        authority,
        people: [],
        groups: [],
        tenants: [...tenants],
        unnamed: 0,
      })),
      truncated: false,
    }).map((row) =>
      permissionAdditionChoices(
        "Site",
        row,
        sitePermissionAdmits(row.authority),
        "acme",
        undefined,
      ),
    );
  expect(rows(["globex"])).toStrictEqual([
    [
      {
        kind: "Group",
        group: "SiteAdmins",
        words: "Site admins",
        line: undefined,
      },
      {
        kind: "TenantAdmins",
        tenant: "acme",
        words: "This workspace's admins",
        line: undefined,
      },
    ],
    [
      {
        kind: "Group",
        group: "SiteAdmins",
        words: "Site admins",
        line: undefined,
      },
    ],
    [],
  ]);
  expect(rows(["acme"])[0]?.map((choice) => choice.kind)).toStrictEqual([
    "Group",
  ]);
});

const bob = { ...ada, subject: "s-bob", email: "bob@example.com" };

const peopleListed: AccessTenantPeople = {
  tenant: "acme",
  projects: [],
  people: [ada, bob].map((person) => ({
    ...person,
    tenantRoles: [],
    hostedRuns: false,
    projects: [],
  })),
  otherIssuers: 0,
  truncated: false,
};

test("the people offered are the People list's less those holding the permission, and none where it was not read", () => {
  const [admin, member] = tenantRowsAdminsOnly;
  if (admin === undefined || member === undefined) throw new Error("no rows");
  const subjects = (row: typeof admin) =>
    permissionAdditionPeople(peopleListed, row)?.map(
      (person) => person.subject,
    );
  expect(subjects(admin)).toStrictEqual(["s-bob"]);
  expect(subjects(member)).toStrictEqual(["s-ada", "s-bob"]);
  expect(permissionAdditionPeople(undefined, admin)).toBeUndefined();
});

test("a choice is sent as its holder, a person only once one is chosen, and each value is its own", () => {
  const [creators] = sitePermissionRows({
    authorities: [
      {
        authority: "AccountCreators",
        people: [],
        groups: [],
        tenants: [],
        unnamed: 0,
      },
    ],
    truncated: false,
  });
  if (creators === undefined) throw new Error("no row");
  const choices = permissionAdditionChoices(
    "Site",
    creators,
    sitePermissionAdmits("AccountCreators"),
    "acme",
    [ada],
  );
  expect(choices.map(permissionChoiceValue)).toStrictEqual([
    "Group:SiteAdmins",
    "TenantAdmins:acme",
    "Person",
  ]);
  const [group, admins, person] = choices;
  expect(permissionChoiceHolder(group, undefined)).toStrictEqual({
    kind: "Group",
    group: "SiteAdmins",
    words: "Site admins",
  });
  expect(permissionChoiceHolder(admins, undefined)).toStrictEqual({
    kind: "TenantAdmins",
    tenant: "acme",
    words: "acme admins",
  });
  expect(permissionChoiceHolder(person, undefined)).toBeUndefined();
  expect(permissionChoiceHolder(person, ada)).toStrictEqual({
    kind: "Person",
    person: ada,
    words: "ada@example.com",
  });
  expect(permissionChoiceHolder(undefined, ada)).toBeUndefined();
});

/** Each project permission held by its starting holders, and a person on Grant Admin. */
const projectRowsStarting = projectPermissionRows({
  tenant: "acme",
  project: "atlas",
  authorities: accessProjectAuthorities.map((authority) => ({
    authority,
    people: authority === "AdminGranters" ? [ada] : [],
    groups: ["TenantAdmins", "ProjectAdmins"],
    unnamed: 0,
  })),
  truncated: false,
});

test("every authority a project rosters has its own name, its rows in roster order", () => {
  expect(accessProjectAuthorities.map(projectPermissionName)).toStrictEqual([
    "Grant Admin",
    "Grant Developer",
    "Grant Dispatcher",
    "Grant Viewer",
    "Change permissions",
  ]);
  expect(
    projectRowsStarting.map((row) => [
      row.name,
      row.holders.map((holder) => holder.words),
    ]),
  ).toStrictEqual([
    ["Grant Admin", ["Workspace admins", "Project admins", "ada@example.com"]],
    ["Grant Developer", ["Workspace admins", "Project admins"]],
    ["Grant Dispatcher", ["Workspace admins", "Project admins"]],
    ["Grant Viewer", ["Workspace admins", "Project admins"]],
    ["Change permissions", ["Workspace admins", "Project admins"]],
  ]);
});

test("a project's permissions are all changed by a reader shown them, and only permission changes asks first", () => {
  expect(
    accessProjectAuthorities.map((authority) =>
      permissionChangeable("Project", authority, undefined),
    ),
  ).toStrictEqual([true, true, true, true, true]);
  expect(projectRowsStarting.map(permissionRemovalAsks)).toStrictEqual([
    false,
    false,
    false,
    false,
    true,
  ]);
});

test("a project permission offers its record's groups less those held, Project developers on Grant Developer and Grant Viewer each with its own line, and a person from the project's people", () => {
  const lines = projectRowsStarting.map((row) =>
    permissionAdditionChoices(
      "Project",
      row,
      projectPermissionAdmits(row.authority),
      "acme",
      [ada],
    ).map((choice) => `${choice.words}: ${choice.line ?? ""}`),
  );
  const person = "Person: From this project's people";
  expect(lines).toStrictEqual([
    ["Site admins: ", person],
    [
      "Site admins: ",
      "Project developers: Developers will see people and can remove other developers.",
      person,
    ],
    ["Site admins: ", person],
    [
      "Site admins: ",
      "Project developers: Developers will see people and can remove viewers.",
      person,
    ],
    [person],
  ]);
});

test("the people offered are the project's less those holding the permission", () => {
  const people: AccessProjectPeople = {
    tenant: "acme",
    project: "atlas",
    people: [ada, { ...ada, subject: "s-bob" }].map((person) => ({
      ...person,
      tenantAdmin: false,
      roles: [],
    })),
    otherIssuers: 0,
    truncated: false,
  };
  const [admin, developer] = projectRowsStarting;
  if (admin === undefined || developer === undefined)
    throw new Error("no rows");
  const subjects = (row: typeof admin) =>
    permissionAdditionPeople(people, row)?.map((person) => person.subject);
  expect(subjects(admin)).toStrictEqual(["s-bob"]);
  expect(subjects(developer)).toStrictEqual(["s-ada", "s-bob"]);
});
