/**
 * The site's workspaces as the access plane answers them, and their page
 * drawn against a plane a case scripts: the reader's site abilities and the
 * list at their own paths, and every creation answered by the case.
 */

import { screen, within } from "@testing-library/react";

import type {
  AccessSiteAbilities,
  AccessSiteTenants,
} from "../../../../src/contract/accessPlane.ts";
import { SiteWorkspacesPage } from "../../app/browser/settings/SiteWorkspacesPage.tsx";
import { answer, drawnStrict } from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";
import { siteAbilitiesNone, siteAbilitiesPath } from "./permissionsFixture.tsx";

/** Where the site's workspaces are listed, and where one is made. */
export const siteWorkspacesPath = "/access/v1/site/workspaces";

export const workspacesWithheld = "A site admin creates workspaces";

/** A reader who may make a workspace and hand account creation on with it. */
export const workspacesAbilitiesEvery: AccessSiteAbilities = {
  administer: true,
  createAccount: true,
  createTenant: true,
  manageAuthorities: true,
};

/** A reader who may make a workspace and nothing else. */
export const workspacesAbilitiesCreator: AccessSiteAbilities = {
  ...siteAbilitiesNone,
  createTenant: true,
};

/**
 * Workspaces out of name order, so a page that sorted them would show: one
 * with an account, an identity and a count beyond them, the reader's own
 * beside a subject no directory answered for, one whose admins are only
 * counted, and one with none.
 */
export const workspacesListed: AccessSiteTenants = {
  tenants: [
    {
      tenant: "globex",
      administrators: [
        {
          subject: "s-bob",
          mine: false,
          account: true,
          email: "bob@example.com",
          githubLogin: "bob",
        },
        { subject: "s-robot", mine: false, account: false },
      ],
      unnamed: 2,
      createAccounts: false,
    },
    {
      tenant: "acme",
      administrators: [
        {
          subject: "s-ada",
          mine: true,
          account: true,
          email: "ada@example.com",
          githubLogin: "ada",
        },
        { subject: "s-dan", mine: false },
      ],
      unnamed: 0,
      createAccounts: true,
    },
    {
      tenant: "umbrella",
      administrators: [],
      unnamed: 3,
      createAccounts: true,
    },
    {
      tenant: "initech",
      administrators: [],
      unnamed: 0,
      createAccounts: false,
    },
  ],
  truncated: false,
};

/** What the plane answers a creation with: made, or found already theirs. */
export function workspaceCreated(status = 201): Response {
  return answer(
    { tenant: "northwind", subject: "s-owner", created: status === 201 },
    status,
  );
}

export interface WorkspacesDrawing {
  readonly abilities?: () => Response | Promise<Response>;
  /** What the list answers, read again after a creation. */
  readonly listing?: () => Response | Promise<Response>;
  /** What a creation is answered with. */
  readonly sent?: () => Response | Promise<Response>;
}

export function drawWorkspaces(
  drawing: WorkspacesDrawing = {},
): Promise<DrawnStrict> {
  const abilities =
    drawing.abilities ?? (() => answer(workspacesAbilitiesEvery));
  const listing = drawing.listing ?? (() => answer(workspacesListed));
  const sent = drawing.sent ?? (() => workspaceCreated());
  return drawnStrict(<SiteWorkspacesPage />, (request: SentRequest) => {
    if (request.url === siteAbilitiesPath) return abilities();
    if (request.url !== siteWorkspacesPath) return answer({}, 404);
    return request.method === "GET" ? listing() : sent();
  });
}

export function workspaceListReads(drawn: DrawnStrict): number {
  return drawn.sent.filter(
    (request) => request.url === siteWorkspacesPath && request.method === "GET",
  ).length;
}

/** Every request the page sent but its reads. */
export function creationsSent(drawn: DrawnStrict): readonly SentRequest[] {
  return drawn.sent.filter((request) => request.method !== "GET");
}

/** One admin's line as a case reads it: each part it draws, a space between. */
function adminDrawn(line: HTMLElement): string {
  const who = line.firstElementChild;
  return who === null
    ? line.textContent
    : [...who.children].map((part) => part.textContent).join(" ");
}

/** One workspace's row, found by its name. */
export function workspaceRow(name: string): HTMLElement {
  const row = screen
    .getAllByRole("rowheader")
    .find((header) => header.textContent === name)
    ?.closest("tr");
  if (row === null || row === undefined)
    throw new Error(`no row draws ${name}`);
  return row;
}

/** Each row the table draws, in its order: the name, a line an admin, then
 * whom its admins may invite. */
export function workspacesDrawn(): readonly (readonly string[])[] {
  const table = screen.queryByRole("table", { name: "Workspaces" });
  if (table === null) return [];
  return within(table)
    .getAllByRole("rowheader")
    .map((header) => {
      const row = workspaceRow(header.textContent);
      return [
        header.textContent,
        ...within(row).queryAllByRole("listitem").map(adminDrawn),
        row.lastElementChild?.textContent ?? "",
      ];
    });
}
