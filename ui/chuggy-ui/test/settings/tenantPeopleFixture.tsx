/**
 * A workspace's people as the access plane answers them, and the page drawn
 * against a plane a case scripts: the list and the reader's abilities at their
 * own paths, and every change and invitation answered by the case.
 *
 * The workspace's invite links are read at a path of their own, which answers
 * as a plane that keeps none unless the case says what it lists.
 */

import { fireEvent, screen, within } from "@testing-library/react";

import {
  accessProjectRoles,
  accessTenantRoles,
  type AccessInviteLink,
  type AccessInviteLinks,
  type AccessTenantAbilities,
  type AccessTenantPeople,
} from "../../../../src/contract/accessPlane.ts";
import { TenantPeoplePage } from "../../app/browser/settings/TenantPeoplePage.tsx";
import {
  answer,
  drawnStrict,
  press,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";

export const peopleTenant = "acme";

export const peoplePath = `/access/v1/tenants/${peopleTenant}/people`;

export const abilitiesPath = `/access/v1/tenants/${peopleTenant}/abilities`;

export const invitationPath = `/access/v1/tenants/${peopleTenant}/invitations`;

export const linksPath = `/access/v1/tenants/${peopleTenant}/invite-links`;

/** Where one link is revoked. */
export function linkPath(link: string): string {
  return `${linksPath}/${link}`;
}

/** A link nobody used, which is every state but the one that names who did. */
type LinkUnused = Exclude<AccessInviteLink, { state: "Used" }>;

const linkMade: Omit<LinkUnused, "link" | "state"> = {
  role: "Member",
  projects: [],
  newAccounts: true,
  mintedBy: {
    subject: "s-ada",
    account: true,
    email: "ada@example.com",
    githubLogin: "ada",
  },
  mintedAtMs: Date.UTC(2026, 7, 20, 9, 0),
  expiresAtMs: Date.UTC(2026, 7, 27, 9, 0),
};

/** One link the reader made, open and carrying Member alone unless a case says otherwise. */
export function linkListed(
  link: string,
  over: Partial<Omit<LinkUnused, "link">> = {},
): AccessInviteLink {
  return { ...linkMade, state: "Open", ...over, link };
}

/** A link in each of its four states, newest first: the used one by a subject
 * the directory cannot name, the open one carrying roles on both projects. */
export const linksListed: AccessInviteLinks = {
  links: [
    linkListed("l-open", {
      projects: [
        { project: "beacon", roles: ["Viewer", "Developer"] },
        { project: "atlas", roles: ["Dispatcher"] },
      ],
    }),
    {
      ...linkMade,
      link: "l-used",
      state: "Used",
      usedBy: { subject: "s-grace" },
      usedAtMs: Date.UTC(2026, 7, 21, 9, 0),
    },
    linkListed("l-revoked", { state: "Revoked", role: "Admin" }),
    linkListed("l-expired", { state: "Expired", newAccounts: false }),
  ],
};

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
  readonly listing?: () => Response | Promise<Response>;
  /** What the abilities answer, read again with the list. */
  readonly abilities?: () => Response;
  /** What the workspace's links answer, a plane that keeps none where a case says nothing. */
  readonly links?: () => Response | Promise<Response>;
  /** What a grant, a removal, an invitation, a link made or one revoked is answered with. */
  readonly changed?: (request: SentRequest) => Response | Promise<Response>;
}

export function drawPeople(drawing: PeopleDrawing = {}): Promise<DrawnStrict> {
  const listing = drawing.listing ?? (() => answer(peopleListed));
  const abilities = drawing.abilities ?? (() => answer(peopleAbilitiesAll()));
  const links = drawing.links ?? (() => answer({}, 404));
  const changed = drawing.changed ?? noContent;
  return drawnStrict(<TenantPeoplePage />, (request: SentRequest) => {
    if (request.url === peoplePath && request.method === "GET")
      return listing();
    if (request.url === abilitiesPath && request.method === "GET")
      return abilities();
    if (request.url === linksPath && request.method === "GET") return links();
    if (request.url.startsWith("/access/v1/")) return changed(request);
    return answer({}, 404);
  });
}

/** Every request the page sent but its reads. */
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

export function linksReads(drawn: DrawnStrict): number {
  return drawn.sent.filter(
    (request) => request.url === linksPath && request.method === "GET",
  ).length;
}

/** One person's row, in either table, found by what it draws them as. */
export function personRow(name: string): HTMLElement {
  const row = screen
    .getAllByRole("rowheader")
    .find((header) => within(header).queryByText(name) !== null)
    ?.closest("tr");
  if (row === null || row === undefined)
    throw new Error(`no row draws ${name}`);
  return row;
}

/** What a row is headed by first, which is its person's name. */
function headedBy(header: Element): string {
  let drawn = header;
  while (drawn.firstElementChild !== null) drawn = drawn.firstElementChild;
  return drawn.textContent;
}

/** The names one of the page's two tables draws, a row each, in its order. */
export function namedIn(table: string): readonly string[] {
  const drawn = screen.queryByRole("table", { name: table });
  if (drawn === null) return [];
  return within(drawn).getAllByRole("rowheader").map(headedBy);
}

/** The chips a row draws: what its person holds in the workspace. */
export function heldIn(row: HTMLElement): readonly string[] {
  return within(row)
    .queryAllByRole("listitem")
    .map((chip) => chip.textContent);
}

/** The lines a row draws of its person's projects, each a project and its roles. */
export function projectsIn(row: HTMLElement): readonly string[] {
  return within(row)
    .queryAllByRole("term")
    .map(
      (project) =>
        `${project.textContent}: ${project.nextElementSibling?.textContent ?? ""}`,
    );
}

/** One person's editor, opened from their row. */
export async function editorOf(name: string): Promise<HTMLElement> {
  await press(`Edit ${name}`);
  return screen.getByRole("dialog", { name });
}

/** Whether no press changes a box: one never offered, or one held for a change. */
export function boxStill(box: HTMLElement): boolean {
  return (
    box.hasAttribute("disabled") || box.getAttribute("aria-disabled") === "true"
  );
}

/** One box as a case reads it: its name, `+` where checked, in parentheses
 * where no press changes it. */
function boxDrawn(box: HTMLElement): string {
  const drawn = `${box.getAttribute("aria-label") ?? box.nextElementSibling?.textContent ?? ""}${box.getAttribute("aria-checked") === "true" ? "+" : ""}`;
  return boxStill(box) ? `(${drawn})` : drawn;
}

/** The boxes one group of an editor draws: `Workspace`, or the row of a project. */
export function boxesIn(editor: HTMLElement, group: string): readonly string[] {
  const scope =
    group === "Workspace"
      ? within(editor).getByRole("group", { name: group })
      : within(editor).getByRole("row", { name: new RegExp(`^${group}`, "u") });
  return within(scope).queryAllByRole("checkbox").map(boxDrawn);
}

/** The projects an editor or an invitation draws a row of boxes for. */
export function projectsOffered(dialog: HTMLElement): readonly string[] {
  const grid = within(dialog).queryByRole("table", { name: "Projects" });
  if (grid === null) return [];
  return within(grid)
    .getAllByRole("rowheader")
    .map((header) => header.textContent);
}

/** One box of a dialog pressed, and what the press set off flushed. */
export async function boxPressed(
  dialog: HTMLElement,
  name: string,
): Promise<void> {
  await turned(() => {
    fireEvent.click(within(dialog).getByRole("checkbox", { name }));
  });
  await settled();
}
