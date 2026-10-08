/**
 * A project's permissions, a workspace's and the site's as the access plane
 * answers them, and each level's page drawn against a plane a case scripts:
 * each list and the reader's abilities and people at their own paths, and
 * every removal and every addition answered by the case. What a case does to
 * a section and its `Add` dialog is here too, so every level's suite asks it
 * the same way.
 */

import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { ReactNode } from "react";

import type {
  AccessProjectAuthorities,
  AccessProjectPeople,
  AccessSiteAuthorities,
  AccessTenantAbilities,
  AccessTenantAuthorities,
  AccessTenantPeople,
} from "../../../../src/contract/accessPlane.ts";
import { ProjectPermissionsPage } from "../../app/browser/settings/ProjectPermissionsPage.tsx";
import { SitePermissionsPage } from "../../app/browser/settings/SitePermissionsPage.tsx";
import {
  tenantPeopleAbilitiesResource,
  tenantPeopleResource,
} from "../../app/browser/settings/tenantPeopleResource.ts";
import { TenantPermissionsPage } from "../../app/browser/settings/TenantPermissionsPage.tsx";
import {
  siteAbilitiesResource,
  sitePermissionsResource,
  tenantPermissionsResource,
} from "../../app/browser/settings/tenantPermissionsResource.ts";
import { tenantResourceKey } from "../../app/core/projectQueryKeys.ts";
import {
  answer,
  drawnStrict,
  openedStream,
  ScreenHarness,
  scriptedFetch,
  sectionOf,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";

/** What a drawn page sent, every level's drawing carrying it. */
interface PermissionsSent {
  readonly sent: readonly SentRequest[];
}

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

/** The site's permission changes held by a workspace's admins, a person and
 * two holders the list does not name, beside its standing admins. */
export const siteAuthoritiesHeld: AccessSiteAuthorities = {
  ...siteAuthoritiesStarting,
  authorities: [
    ...siteAuthoritiesStarting.authorities.slice(0, 1),
    {
      authority: "AuthorityManagers",
      people: [
        {
          subject: "s-ada",
          mine: false,
          account: true,
          email: "ada@example.com",
        },
      ],
      groups: [],
      tenants: [permissionsTenant],
      unnamed: 2,
    },
  ],
};

export const permissionsProject = "atlas";

export const projectAuthoritiesPath = `/access/v1/tenants/${permissionsTenant}/projects/${permissionsProject}/authorities`;

export const projectPeoplePath = `/access/v1/tenants/${permissionsTenant}/projects/${permissionsProject}/people`;

/** The holders a project starts with. */
export const projectAuthoritiesStarting: AccessProjectAuthorities = {
  tenant: permissionsTenant,
  project: permissionsProject,
  authorities: (
    [
      "AdminGranters",
      "DeveloperGranters",
      "DispatcherGranters",
      "AuthorityManagers",
    ] as const
  ).map((authority) => ({
    authority,
    people: [],
    groups: ["TenantAdmins", "ProjectAdmins"],
    unnamed: 0,
  })),
  truncated: false,
};

/** The project's people: one person with an account, one without. */
export const projectPeopleListed: AccessProjectPeople = {
  tenant: permissionsTenant,
  project: permissionsProject,
  people: permissionsPeopleListed.people.map((person) => ({
    subject: person.subject,
    mine: person.mine,
    tenantAdmin: false,
    roles: ["Developer"],
    ...(person.account
      ? { account: true, email: person.email, githubLogin: person.githubLogin }
      : { account: false }),
  })),
  otherIssuers: 0,
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

function permissionsPageDrawn(
  page: ReactNode,
  drawing: PermissionsDrawing,
): Promise<DrawnStrict> {
  const tenant = drawing.tenant ?? (() => answer(tenantAuthoritiesStarting));
  const site = drawing.site ?? (() => answer({}, 404));
  const abilities = drawing.abilities ?? (() => answer({}, 404));
  const people = drawing.people ?? (() => answer({}, 404));
  const removed =
    drawing.removed ?? (() => new Response(null, { status: 204 }));
  const added = drawing.added ?? (() => new Response(null, { status: 204 }));
  return drawnStrict(page, (request: SentRequest) => {
    if (request.method === "DELETE") return removed();
    if (request.method === "POST") return added();
    if (request.url === permissionsPeoplePath) return people();
    if (request.url === tenantAuthoritiesPath) return tenant();
    if (request.url === siteAuthoritiesPath) return site();
    if (request.url === permissionsAbilitiesPath) return abilities();
    return answer({}, 404);
  });
}

/** The workspace's page drawn, the site's list, the abilities and the People list absent unless a case answers them. */
export function drawPermissions(
  drawing: PermissionsDrawing = {},
): Promise<DrawnStrict> {
  return permissionsPageDrawn(<TenantPermissionsPage />, drawing);
}

/** The site's page drawn against the same plane, its list answered as it starts unless a case says otherwise. */
export function drawSitePermissions(
  drawing: PermissionsDrawing = {},
): Promise<DrawnStrict> {
  return permissionsPageDrawn(<SitePermissionsPage />, {
    site: () => answer(siteAuthoritiesStarting),
    ...drawing,
  });
}

/** A change on the workspace's page or the site's reads again every resource either page, the People page and the navigation hold of the workspace. */
export function expectPermissionsReread(
  invalidated: MockInstance<QueryClient["invalidateQueries"]>,
): void {
  for (const resource of [
    tenantPermissionsResource,
    sitePermissionsResource,
    siteAbilitiesResource,
    tenantPeopleResource,
    tenantPeopleAbilitiesResource,
  ])
    expect(invalidated).toHaveBeenCalledWith({
      queryKey: tenantResourceKey(permissionsTenant, resource),
    });
}

/** A node's words less those of every button in it. */
function permissionsDrawnWords(node: Node): string {
  if (node instanceof HTMLButtonElement) return "";
  if (!(node instanceof Element)) return node.textContent ?? "";
  return [...node.childNodes].map(permissionsDrawnWords).join("");
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
        .map(permissionsDrawnWords),
    }));
}

/** Every removal the page sent. */
export function removalsSent(drawn: PermissionsSent): readonly SentRequest[] {
  return drawn.sent.filter((request) => request.method === "DELETE");
}

/** Every addition the page sent. */
export function additionsSent(drawn: PermissionsSent): readonly SentRequest[] {
  return drawn.sent.filter((request) => request.method === "POST");
}

export function readsOf(drawn: PermissionsSent, path: string): number {
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

export interface ProjectPermissionsDrawing {
  readonly authorities?: () => Response | Promise<Response>;
  readonly people?: () => Response;
  /** What a removal is answered with. */
  readonly removed?: () => Response;
  /** What an addition is answered with. */
  readonly added?: () => Response;
}

/** The project's page drawn in the project's frame, its list and its people answered unless a case says otherwise. */
export async function drawProjectPermissions(
  drawing: ProjectPermissionsDrawing = {},
): Promise<PermissionsSent> {
  const authorities =
    drawing.authorities ?? (() => answer(projectAuthoritiesStarting));
  const people = drawing.people ?? (() => answer(projectPeopleListed));
  const scripted = scriptedFetch((request) => {
    if (request.method === "DELETE")
      return drawing.removed?.() ?? new Response(null, { status: 204 });
    if (request.method === "POST")
      return drawing.added?.() ?? new Response(null, { status: 204 });
    if (request.url === projectAuthoritiesPath) return authorities();
    if (request.url === projectPeoplePath) return people();
    return answer({}, 404);
  });
  vi.stubGlobal("fetch", scripted.fetch);
  render(
    <ScreenHarness
      partition={{ tenant: permissionsTenant, project: permissionsProject }}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <ProjectPermissionsPage />
    </ScreenHarness>,
  );
  await settled();
  return { sent: scripted.sent };
}

/** The accessible name of every add button a section draws. */
export function addButtons(title: string): readonly string[] {
  return within(sectionOf(title))
    .queryAllByRole("button", { name: /^Add to / })
    .map((button) => button.textContent);
}

/** One section's add button pressed, its dialog opened. */
export async function opened(title: string, permission: string): Promise<void> {
  await turned(() => {
    fireEvent.click(
      within(sectionOf(title)).getByRole("button", {
        name: `Add to ${permission}`,
      }),
    );
  });
  await settled();
}

export function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Add holder" });
}

export function choicesOffered(): readonly string[] {
  return within(dialog())
    .queryAllByRole("radio")
    .map((radio) => {
      const label = document.querySelector(`label[for="${radio.id}"]`);
      return label?.textContent ?? "";
    });
}

export async function chosen(name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(within(dialog()).getByRole("radio", { name }));
  });
}

export async function added(): Promise<void> {
  await turned(() => {
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add" }));
  });
  await settled();
}
