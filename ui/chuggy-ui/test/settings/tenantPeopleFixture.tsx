/**
 * A workspace's people as the access plane answers them, and the page drawn
 * against a plane a case scripts: the list at its own path, every change and
 * invitation answered by the case, and what the bar reads answered empty.
 */

import { screen, within } from "@testing-library/react";

import type { AccessTenantPeople } from "../../../../src/contract/accessPlane.ts";
import { TenantPeoplePage } from "../../app/browser/settings/TenantPeoplePage.tsx";
import { answer, drawnStrict } from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";

export const peopleTenant = "acme";

export const peoplePath = `/access/v1/tenants/${peopleTenant}/people`;

export const invitationPath = `/access/v1/tenants/${peopleTenant}/invitations`;

/** The reader, an admin with an account, and a subject the plane says is no account. */
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
  ],
  otherIssuers: 0,
  truncated: false,
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
  /** What a grant, a removal or an invitation is answered with. */
  readonly changed?: (request: SentRequest) => Response;
}

export function drawPeople(drawing: PeopleDrawing = {}): Promise<DrawnStrict> {
  const listing = drawing.listing ?? (() => answer(peopleListed));
  const changed = drawing.changed ?? noContent;
  return drawnStrict(<TenantPeoplePage />, (request: SentRequest) => {
    if (request.url === peoplePath && request.method === "GET")
      return listing();
    if (request.url.startsWith("/access/v1/")) return changed(request);
    if (request.url.includes("/projects")) return answer({ projects: [] });
    return answer({}, 404);
  });
}

/** Every request the page sent but the list's reads and the bar's own. */
export function changesSent(drawn: DrawnStrict): readonly SentRequest[] {
  return drawn.sent.filter(
    (request) =>
      request.url.startsWith("/access/v1/") && request.method !== "GET",
  );
}

export function listReads(drawn: DrawnStrict): number {
  return drawn.sent.filter((request) => request.url === peoplePath).length;
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
