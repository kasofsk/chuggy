/**
 * A workspace's people as the access plane answers them, and the page drawn
 * against a plane a case scripts: the list and the reader's abilities at their
 * own paths, and every change and invitation answered by the case.
 */

import { screen, within } from "@testing-library/react";

import {
  accessProjectRoles,
  accessTenantRoles,
  type AccessTenantAbilities,
  type AccessTenantPeople,
} from "../../../../src/contract/accessPlane.ts";
import { TenantPeoplePage } from "../../app/browser/settings/TenantPeoplePage.tsx";
import { answer, drawnStrict } from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";

export const peopleTenant = "acme";

export const peoplePath = `/access/v1/tenants/${peopleTenant}/people`;

export const abilitiesPath = `/access/v1/tenants/${peopleTenant}/abilities`;

export const invitationPath = `/access/v1/tenants/${peopleTenant}/invitations`;

/** The reader, an admin with an account, and two subjects the plane says are
 * no account, the second holding hosted runs as a workspace's selector does. */
export const peopleListed: AccessTenantPeople = {
  tenant: peopleTenant,
  projects: ["atlas", "beacon"],
  people: [
    {
      subject: "s-ada",
      mine: true,
      tenantRoles: ["Admin"],
      hostedRuns: true,
      projects: [{ project: "atlas", roles: ["Admin", "Developer"] }],
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
    {
      subject: "s-selector",
      mine: false,
      tenantRoles: [],
      hostedRuns: true,
      projects: [],
      account: false,
    },
  ],
  otherIssuers: 0,
  truncated: false,
};

/** A reader who may grant every role on every project named, and invite anyone. */
export function peopleAbilitiesAll(
  projects: readonly string[] = peopleListed.projects,
): AccessTenantAbilities {
  return {
    tenant: peopleTenant,
    roles: [...accessTenantRoles],
    grantHostedRuns: true,
    createAccount: true,
    manageAuthorities: true,
    manageSiteHeldAuthorities: false,
    projects: projects.map((project) => ({
      project,
      roles: [...accessProjectRoles],
      manageAuthorities: true,
    })),
    truncated: false,
  };
}

/** A reader who may grant nothing and make no account. */
export const peopleAbilitiesNone: AccessTenantAbilities = {
  ...peopleAbilitiesAll([]),
  roles: [],
  grantHostedRuns: false,
  createAccount: false,
  manageAuthorities: false,
};

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** What the plane answers a refusal with, in the API's envelope. */
export function refused(status: number, code: string): Response {
  return answer({ error: { code, message: "refused" } }, status);
}

export interface PeopleDrawing {
  /** What the list answers, read again after every change. */
  readonly listing?: () => Response;
  /** What the abilities answer, read again with the list. */
  readonly abilities?: () => Response;
  /** What a grant, a removal or an invitation is answered with. */
  readonly changed?: (request: SentRequest) => Response;
}

export function drawPeople(drawing: PeopleDrawing = {}): Promise<DrawnStrict> {
  const listing = drawing.listing ?? (() => answer(peopleListed));
  const abilities = drawing.abilities ?? (() => answer(peopleAbilitiesAll()));
  const changed = drawing.changed ?? noContent;
  return drawnStrict(<TenantPeoplePage />, (request: SentRequest) => {
    if (request.url === peoplePath && request.method === "GET")
      return listing();
    if (request.url === abilitiesPath && request.method === "GET")
      return abilities();
    if (request.url.startsWith("/access/v1/")) return changed(request);
    return answer({}, 404);
  });
}

/** Every request the page sent but the list's and the abilities' reads. */
export function changesSent(drawn: DrawnStrict): readonly SentRequest[] {
  return drawn.sent.filter(
    (request) =>
      request.url.startsWith("/access/v1/") && request.method !== "GET",
  );
}

/** Where one person's hosted runs are given and taken. */
export function hostedRunsPath(subject: string): string {
  return `${peoplePath}/${subject}/hosted-runs`;
}

export function listReads(drawn: DrawnStrict): number {
  return drawn.sent.filter((request) => request.url === peoplePath).length;
}

export function abilitiesReads(drawn: DrawnStrict): number {
  return drawn.sent.filter((request) => request.url === abilitiesPath).length;
}

/** One person's row, found by what it draws them as. */
export function personRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (row === null) throw new Error(`no row draws ${name}`);
  return row;
}

export function pressedIn(scope: HTMLElement): readonly string[] {
  return within(scope)
    .queryAllByRole("button", { pressed: true })
    .map((button) => button.textContent);
}
