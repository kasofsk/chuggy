/**
 * A workspace's permissions and the site's as the access plane answers them,
 * and the page drawn against a plane a case scripts: each list and the reader's
 * abilities and the People list at their own paths, every removal and every
 * addition answered by the case, and what the bar reads answered empty.
 */

import { screen, within } from "@testing-library/react";

import type {
  AccessSiteAuthorities,
  AccessTenantAbilities,
  AccessTenantAuthorities,
  AccessTenantPeople,
} from "../../../../src/contract/accessPlane.ts";
import { TenantPermissionsPage } from "../../app/browser/settings/TenantPermissionsPage.tsx";
import { answer, drawnStrict, sectionOf } from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";

export const permissionsTenant = "acme";

export const tenantAuthoritiesPath = `/access/v1/tenants/${permissionsTenant}/authorities`;

export const siteAuthoritiesPath = "/access/v1/site/authorities";

export const permissionsAbilitiesPath = `/access/v1/tenants/${permissionsTenant}/abilities`;

export const permissionsPeoplePath = `/access/v1/tenants/${permissionsTenant}/people`;

/** The People list: one person with an account, one without. */
export const permissionsPeopleListed: AccessTenantPeople = {
  tenant: permissionsTenant,
  projects: [],
  people: [
    {
      subject: "s-ada",
      mine: false,
      tenantRoles: ["Admin"],
      hostedRuns: false,
      projects: [],
      account: true,
      email: "ada@example.com",
      githubLogin: "ada",
    },
    {
      subject: "s-bob",
      mine: false,
      tenantRoles: ["Member"],
      hostedRuns: false,
      projects: [],
      account: false,
    },
  ],
  otherIssuers: 0,
  truncated: false,
};

/** A reader who may change the workspace's own permissions, and not the one the site holds over it. */
export const permissionsAbilitiesTenant: AccessTenantAbilities = {
  tenant: permissionsTenant,
  roles: [],
  grantHostedRuns: false,
  createAccount: false,
  manageAuthorities: true,
  manageSiteHeldAuthorities: false,
  projects: [],
  truncated: false,
};

/** A reader who may change only the permission the site holds over the workspace. */
export const permissionsAbilitiesSite: AccessTenantAbilities = {
  ...permissionsAbilitiesTenant,
  manageAuthorities: false,
  manageSiteHeldAuthorities: true,
};

export const permissionsAbilitiesNone: AccessTenantAbilities = {
  ...permissionsAbilitiesTenant,
  manageAuthorities: false,
};

/** The holders a workspace starts with. */
export const tenantAuthoritiesStarting: AccessTenantAuthorities = {
  tenant: permissionsTenant,
  authorities: [
    {
      authority: "AdminGranters",
      people: [],
      groups: ["TenantAdmins"],
      unnamed: 0,
    },
    {
      authority: "MemberGranters",
      people: [],
      groups: ["TenantAdmins"],
      unnamed: 0,
    },
    {
      authority: "HostedRunsGranters",
      people: [],
      groups: ["SiteAdmins"],
      unnamed: 0,
    },
    {
      authority: "AuthorityManagers",
      people: [],
      groups: ["TenantAdmins"],
      unnamed: 0,
    },
  ],
  truncated: false,
};

/** Account creation held by the site's admins and two workspaces' admins, and
 * permission changes by nobody the list names. */
export const siteAuthoritiesStarting: AccessSiteAuthorities = {
  authorities: [
    {
      authority: "AccountCreators",
      people: [],
      groups: ["SiteAdmins"],
      tenants: [permissionsTenant, "globex"],
      unnamed: 0,
    },
    {
      authority: "AuthorityManagers",
      people: [],
      groups: [],
      tenants: [],
      unnamed: 0,
    },
  ],
  truncated: false,
};

/** A read that never answers. */
export function unanswered(): Promise<Response> {
  return new Promise<Response>(() => undefined);
}

export interface PermissionsDrawing {
  readonly tenant?: () => Response | Promise<Response>;
  readonly site?: () => Response | Promise<Response>;
  readonly abilities?: () => Response;
  readonly people?: () => Response;
  /** What a removal is answered with. */
  readonly removed?: () => Response;
  /** What an addition is answered with. */
  readonly added?: () => Response;
}

/** The page drawn, the site's list, the abilities and the People list absent unless a case answers them. */
export function drawPermissions(
  drawing: PermissionsDrawing = {},
): Promise<DrawnStrict> {
  const tenant = drawing.tenant ?? (() => answer(tenantAuthoritiesStarting));
  const site = drawing.site ?? (() => answer({}, 404));
  const abilities = drawing.abilities ?? (() => answer({}, 404));
  const people = drawing.people ?? (() => answer({}, 404));
  const removed =
    drawing.removed ?? (() => new Response(null, { status: 204 }));
  const added = drawing.added ?? (() => new Response(null, { status: 204 }));
  return drawnStrict(<TenantPermissionsPage />, (request: SentRequest) => {
    if (request.method === "DELETE") return removed();
    if (request.method === "POST") return added();
    if (request.url === permissionsPeoplePath) return people();
    if (request.url === tenantAuthoritiesPath) return tenant();
    if (request.url === siteAuthoritiesPath) return site();
    if (request.url === permissionsAbilitiesPath) return abilities();
    if (request.url.includes("/projects")) return answer({ projects: [] });
    return answer({}, 404);
  });
}

/** Each permission a section draws, by name, and the words of every holder in it, less its remove button. */
export function permissionsDrawn(
  title: string,
): readonly { readonly name: string; readonly holders: readonly string[] }[] {
  return within(sectionOf(title))
    .getAllByRole("row")
    .slice(1)
    .map((row) => ({
      name: within(row).getByRole("rowheader").textContent,
      holders: within(row)
        .queryAllByRole("listitem")
        .map((item) =>
          [...item.childNodes]
            .filter((node) => !(node instanceof HTMLButtonElement))
            .map((node) => node.textContent)
            .join(""),
        ),
    }));
}

/** Every removal the page sent. */
export function removalsSent(drawn: DrawnStrict): readonly SentRequest[] {
  return drawn.sent.filter((request) => request.method === "DELETE");
}

/** Every addition the page sent. */
export function additionsSent(drawn: DrawnStrict): readonly SentRequest[] {
  return drawn.sent.filter((request) => request.method === "POST");
}

export function readsOf(drawn: DrawnStrict, path: string): number {
  return drawn.sent.filter((request) => request.url === path).length;
}

/** The accessible name of every remove button a section draws. */
export function removeButtons(title: string): readonly string[] {
  return within(sectionOf(title))
    .queryAllByRole("button", { name: /^Remove / })
    .map((button) => button.textContent);
}

/** The words a permission's cell draws when it holds no list. */
export function permissionCell(title: string, name: string): string {
  const row = within(sectionOf(title))
    .getByRole("rowheader", { name })
    .closest("tr");
  if (row === null) throw new Error(`no row draws ${name}`);
  return within(row).getAllByRole("cell")[0]?.textContent ?? "";
}

export function sectionDrawn(title: string): boolean {
  return (
    screen.queryByRole("region", { name: new RegExp(`^${title}`) }) !== null
  );
}
