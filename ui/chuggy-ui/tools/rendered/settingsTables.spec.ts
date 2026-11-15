/**
 * Every settings page that draws a table, at a phone's width: the project's
 * placement and permissions, the workspace's people with its invite links,
 * its accounts and its permissions, and the site's workspaces with their
 * links and the site's permissions, each pressed by a finger. Each table is
 * cards there, so neither the page nor any table scrolls sideways, and every
 * control in the page's column is at least the touch height. The shell around
 * a page is not the page's, so the column is the settings' section.
 *
 * The reader here may do everything each page offers, so every press a row
 * has is drawn: the reads below answer for the stub's member as a workspace
 * and site administrator. A member's own runners page is held to the same in
 * `runners.spec.ts`.
 */

import {
  accessInviteLinksSchema,
  accessProjectAbilitiesSchema,
  accessProjectAuthoritiesSchema,
  accessProjectRoles,
  accessSiteAbilitiesSchema,
  accessSiteAuthoritiesSchema,
  accessSiteTenantsSchema,
  accessTenantAbilitiesSchema,
  accessTenantAuthoritiesSchema,
  accessTenantPeopleSchema,
  accessTenantRoles,
  accessWorkspaceLinksSchema,
} from "../../../../src/contract/accessPlane.ts";
import {
  forgeInstallationPermissionsResponseSchema,
  tenantDeletionResponseSchema,
} from "../../../../src/contract/responses.ts";

import {
  expect,
  renderedDist,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import { servedOpen } from "./served.ts";
import type { Served } from "./served.ts";
import { stubApiProject, stubApiRead, stubApiTenant } from "./stubApi.ts";
import type { StubApiRead } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const tenantAccess = `/access/v1/tenants/${stubApiTenant}`;
const projectAccess = `${tenantAccess}/projects/${stubApiProject}`;
const projects = [stubApiProject, "atlas-web-and-its-documentation"];

/** Who made a link, with an address longer than a phone's column. */
const minted = {
  subject: "s-ada",
  account: true,
  email: "ada.lovelace-analytical-engines@example.com",
  githubLogin: "ada-l",
};

const mintedAtMs = Date.parse("2026-11-01T09:00:00Z");
const expiresAtMs = Date.parse("2030-01-01T09:00:00Z");

const people = {
  tenant: stubApiTenant,
  projects,
  people: [
    {
      subject: "member",
      mine: true,
      tenantRoles: ["Admin"],
      hostedRuns: true,
      personalRunners: true,
      unscopedChat: true,
      projects: projects.map((project) => ({
        project,
        roles: ["Admin", "Developer"],
      })),
      account: true,
      email: "member@rendered.example",
      githubLogin: "member-rendered",
    },
    {
      mine: false,
      tenantRoles: ["Member"],
      hostedRuns: false,
      personalRunners: false,
      unscopedChat: true,
      projects: [],
      ...minted,
    },
    {
      subject: "s-robot-with-a-subject-longer-than-any-column",
      mine: false,
      tenantRoles: [],
      hostedRuns: true,
      personalRunners: false,
      unscopedChat: true,
      projects: [],
      account: false,
    },
  ],
  otherIssuers: 0,
  truncated: false,
};

const tenantAbilities = {
  tenant: stubApiTenant,
  roles: [...accessTenantRoles],
  grantHostedRuns: true,
  grantPersonalRunners: true,
  grantUnscopedChat: true,
  administerTenant: true,
  createAccount: true,
  manageAuthorities: true,
  manageSiteHeldAuthorities: true,
  projects: projects.map((project) => ({
    project,
    roles: [...accessProjectRoles],
    manageAuthorities: true,
  })),
  truncated: false,
};

const inviteLinks = {
  links: [
    {
      link: "l-open",
      state: "Open",
      role: "Member",
      projects: [{ project: stubApiProject, roles: ["Viewer", "Developer"] }],
      newAccounts: true,
      mintedBy: minted,
      mintedAtMs,
      expiresAtMs,
    },
    {
      link: "l-used",
      state: "Used",
      role: "Member",
      projects: [],
      newAccounts: true,
      mintedBy: minted,
      mintedAtMs,
      expiresAtMs,
      usedBy: { subject: "s-grace-with-a-subject-longer-than-any-column" },
      usedAtMs: mintedAtMs,
    },
  ],
};

const holderPerson = { mine: false, ...minted };

const tenantAuthorities = {
  tenant: stubApiTenant,
  authorities: [
    "AdminGranters",
    "MemberGranters",
    "HostedRunsGranters",
    "AuthorityManagers",
  ].map((authority) => ({
    authority,
    people: [holderPerson],
    groups: ["TenantAdmins"],
    unnamed: 2,
  })),
  truncated: false,
};

const projectAuthorities = {
  tenant: stubApiTenant,
  project: stubApiProject,
  authorities: [
    "AdminGranters",
    "DeveloperGranters",
    "DispatcherGranters",
    "ViewerGranters",
    "AuthorityManagers",
  ].map((authority) => ({
    authority,
    people: [holderPerson],
    groups: ["TenantAdmins", "ProjectAdmins"],
    unnamed: 0,
  })),
  truncated: false,
};

const siteAuthorities = {
  authorities: ["AccountCreators", "TenantCreators", "AuthorityManagers"].map(
    (authority) => ({
      authority,
      people: [holderPerson],
      groups: ["SiteAdmins"],
      tenants: authority === "AccountCreators" ? [stubApiTenant] : [],
      unnamed: 0,
    }),
  ),
  truncated: false,
};

const siteWorkspaces = {
  tenants: [
    {
      tenant: stubApiTenant,
      displayName: stubApiTenant,
      administrators: [
        {
          subject: "member",
          mine: true,
          account: true,
          email: "member@rendered.example",
        },
        { mine: false, ...minted },
      ],
      unnamed: 2,
      createAccounts: true,
    },
    {
      tenant: "a-workspace-whose-name-is-longer-than-any-column",
      displayName: "A workspace whose display name is longer than any column",
      administrators: [],
      unnamed: 0,
      createAccounts: false,
    },
  ],
  truncated: false,
};

const workspaceLinks = {
  links: [
    {
      link: "w-open",
      state: "Open",
      note: "for-the-analytical-engine-society-of-lisbon",
      createAccounts: true,
      newAccounts: true,
      mintedBy: minted,
      mintedAtMs,
      expiresAtMs,
    },
    {
      link: "w-used",
      state: "Used",
      createAccounts: false,
      newAccounts: true,
      mintedBy: minted,
      mintedAtMs,
      expiresAtMs,
      usedBy: { subject: "s-grace" },
      usedAtMs: mintedAtMs,
      workspace: "northwind-co",
    },
  ],
};

/** Each connected installation's standing with its app, the worker app of
 * the first account behind it, so its row offers its review. */
const installationReads: readonly StubApiRead[] = ["11", "12", "13"].map(
  (installation) =>
    stubApiRead(
      `/api/v1/tenants/${stubApiTenant}/forge-installations/${installation}/permissions`,
      forgeInstallationPermissionsResponseSchema,
      {
        permissions: installation === "12" ? "Behind" : "Current",
        settingsUrl: `https://github.com/settings/installations/${installation}`,
      },
    ),
);

/** The access plane's answers to a reader who administers the workspace and
 * the site, and the forge's to the workspace's accounts. */
const settingsTablesReads: readonly StubApiRead[] = [
  ...installationReads,
  stubApiRead(`${tenantAccess}/people`, accessTenantPeopleSchema, people),
  stubApiRead(
    `${tenantAccess}/abilities`,
    accessTenantAbilitiesSchema,
    tenantAbilities,
  ),
  stubApiRead(
    `${tenantAccess}/invite-links`,
    accessInviteLinksSchema,
    inviteLinks,
  ),
  stubApiRead(
    `${tenantAccess}/authorities`,
    accessTenantAuthoritiesSchema,
    tenantAuthorities,
  ),
  stubApiRead(
    `${projectAccess}/authorities`,
    accessProjectAuthoritiesSchema,
    projectAuthorities,
  ),
  stubApiRead(`${projectAccess}/abilities`, accessProjectAbilitiesSchema, {
    tenant: stubApiTenant,
    project: stubApiProject,
    roles: [...accessProjectRoles],
    manageAuthorities: true,
  }),
  stubApiRead("/access/v1/site/abilities", accessSiteAbilitiesSchema, {
    administer: true,
    createAccount: true,
    createTenant: true,
    manageAuthorities: true,
  }),
  stubApiRead(
    "/access/v1/site/authorities",
    accessSiteAuthoritiesSchema,
    siteAuthorities,
  ),
  stubApiRead(
    "/access/v1/site/workspaces",
    accessSiteTenantsSchema,
    siteWorkspaces,
  ),
  stubApiRead(
    `/api/v1/tenants/${stubApiTenant}/deletion`,
    tenantDeletionResponseSchema,
    { held: [] },
  ),
  stubApiRead(
    "/access/v1/site/workspace-links",
    accessWorkspaceLinksSchema,
    workspaceLinks,
  ),
];

const settingsRoot = `/${stubApiTenant}/${stubApiProject}/settings`;

/** Each page, by where it is and the name of the row it is drawn once it holds. */
const settingsTablePages: readonly {
  readonly route: string;
  readonly row: string;
}[] = [
  { route: "placement", row: "Work" },
  { route: "permissions", row: "Grant Admin" },
  { route: "workspace/people", row: "member@rendered.example" },
  { route: "workspace/accounts", row: "kasofsk" },
  { route: "workspace/permissions", row: "Grant Admin" },
  { route: "site/workspaces", row: stubApiTenant },
  { route: "site/permissions", row: "Create accounts" },
];

async function settingsTablesServed(): Promise<Served> {
  return servedOpen({ root: renderedDist, reads: settingsTablesReads });
}

for (const shown of settingsTablePages)
  test(`on the phone the ${shown.route} settings draw each table as cards, scroll nothing sideways, and give every control the touch height`, async ({
    browser,
  }) => {
    const served = await settingsTablesServed();
    try {
      const rendered = await renderedOpen(browser, served.origin, {
        route: `${settingsRoot}/${shown.route}`,
        viewport: "phone",
        signedIn: true,
        touch: true,
        ready: (page) =>
          page
            .getByRole("rowheader", { name: new RegExp(`^${shown.row}`, "u") })
            .first(),
      });
      const page = rendered.page;
      const column = page.locator(".settings-section");
      const tables = page.getByRole("table");
      expect(await tables.count()).toBeGreaterThan(0);
      for (const table of await tables.all()) {
        await expect(table).toHaveClass(/tabular-stacked/u);
        await expect(table.locator("thead")).toHaveCSS(
          "clip-path",
          "inset(50%)",
        );
      }
      await expect(page.locator("tbody .tabular-label").first()).toBeVisible();
      await expect(
        page.locator(".tabular-scroll:is([data-more-start], [data-more-end])"),
      ).toHaveCount(0);
      await renderedNoOverflow(page);
      await renderedTouchTargets(page, column);
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    } finally {
      await served.close();
    }
  });
