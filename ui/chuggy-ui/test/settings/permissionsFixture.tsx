/**
 * A workspace's permissions and the site's as the access plane answers them,
 * and the page drawn against a plane a case scripts: each list at its own path,
 * and what the bar reads answered empty.
 */

import { screen, within } from "@testing-library/react";

import type {
  AccessSiteAuthorities,
  AccessTenantAuthorities,
} from "../../../../src/contract/accessPlane.ts";
import { TenantPermissionsPage } from "../../app/browser/settings/TenantPermissionsPage.tsx";
import { answer, drawnStrict, sectionOf } from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";

export const permissionsTenant = "acme";

export const tenantAuthoritiesPath = `/access/v1/tenants/${permissionsTenant}/authorities`;

export const siteAuthoritiesPath = "/access/v1/site/authorities";

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
}

/** The page drawn, the site's list absent unless a case answers it. */
export function drawPermissions(
  drawing: PermissionsDrawing = {},
): Promise<DrawnStrict> {
  const tenant = drawing.tenant ?? (() => answer(tenantAuthoritiesStarting));
  const site = drawing.site ?? (() => answer({}, 404));
  return drawnStrict(<TenantPermissionsPage />, (request: SentRequest) => {
    if (request.url === tenantAuthoritiesPath) return tenant();
    if (request.url === siteAuthoritiesPath) return site();
    if (request.url.includes("/projects")) return answer({ projects: [] });
    return answer({}, 404);
  });
}

/** Each permission a section draws, by name, and the words of every holder in it. */
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
        .map((item) => item.textContent),
    }));
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
