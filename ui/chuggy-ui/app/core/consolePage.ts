/**
 * Which console page a reader is on, read off the route the router matched
 * last: the page the contract names for it, with the ticket, the repository or
 * the settings section its address carries, and the words a message sent from
 * it names it by.
 *
 * A PAGE THE CONTRACT WOULD REFUSE IS NO PAGE. An address naming a ticket that
 * is not a number, or a route this table does not know, answers nothing, so a
 * message sent from it goes without a page rather than being refused for one.
 */

import { consolePageSchema } from "../../../../src/contract/consolePage.ts";
import type {
  ConsolePage,
  ConsolePageSettingsSection,
} from "../../../../src/contract/consolePage.ts";
import { repositoryLabel } from "./projectRepositories.ts";
import {
  ticketDraftQueryOf,
  ticketDuplicateQueryOf,
} from "./ticketDuplicate.ts";

/** The route a router matched, as plain data: its identity, the parameters
 * its address carries, and the query it was given. */
export interface ConsolePageMatch {
  readonly routeId: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly search: Readonly<Record<string, unknown>>;
}

/** The ticket an address segment names, read as the ticket routes read it, so
 * the page names the ticket they draw. */
function consolePageTicketOf(match: ConsolePageMatch): number {
  return Number(match.params["ticket"]);
}

function consolePageSettings(
  section?: ConsolePageSettingsSection,
): () => unknown {
  return () => ({
    page: "Settings",
    ...(section === undefined ? {} : { section }),
  });
}

/** A new ticket, as its route reads the address: the draft it names where it
 * names one, which wins over the ticket it would otherwise duplicate. */
function consolePageTicketNew(match: ConsolePageMatch): unknown {
  const { draft } = ticketDraftQueryOf(match.search);
  return draft === undefined
    ? { page: "TicketNew", ...ticketDuplicateQueryOf(match.search) }
    : { page: "TicketNew", draft };
}

/** Each route under a project, by the identity the router gives it, and the
 * page it is. A settings address that only redirects names no section. */
const consolePageRoutes: ReadonlyMap<
  string,
  (match: ConsolePageMatch) => unknown
> = new Map<string, (match: ConsolePageMatch) => unknown>([
  ["/$tenant/$project/", () => ({ page: "Tickets" })],
  ["/$tenant/$project/inbox", () => ({ page: "Inbox" })],
  ["/$tenant/$project/lead", () => ({ page: "Lead" })],
  ["/$tenant/$project/catalog", () => ({ page: "Catalog" })],
  ["/$tenant/$project/repositories", () => ({ page: "Repositories" })],
  [
    "/$tenant/$project/repositories/$repository",
    (match) => ({ page: "Repository", repository: match.params["repository"] }),
  ],
  ["/$tenant/$project/runners", () => ({ page: "Runners" })],
  ["/$tenant/$project/tickets/new", consolePageTicketNew],
  [
    "/$tenant/$project/tickets/$ticket",
    (match) => ({ page: "Ticket", ticket: consolePageTicketOf(match) }),
  ],
  [
    "/$tenant/$project/tickets/$ticket/edit",
    (match) => ({ page: "TicketEdit", ticket: consolePageTicketOf(match) }),
  ],
  ["/$tenant/$project/settings", consolePageSettings()],
  ["/$tenant/$project/settings/", consolePageSettings()],
  ["/$tenant/$project/settings/lead", consolePageSettings("ProjectLead")],
  [
    "/$tenant/$project/settings/placement",
    consolePageSettings("ProjectPlacement"),
  ],
  [
    "/$tenant/$project/settings/permissions",
    consolePageSettings("ProjectPermissions"),
  ],
  ["/$tenant/$project/settings/workspace", consolePageSettings()],
  ["/$tenant/$project/settings/workspace/", consolePageSettings()],
  [
    "/$tenant/$project/settings/workspace/people",
    consolePageSettings("WorkspacePeople"),
  ],
  [
    "/$tenant/$project/settings/workspace/accounts",
    consolePageSettings("WorkspaceAccounts"),
  ],
  [
    "/$tenant/$project/settings/workspace/permissions",
    consolePageSettings("WorkspacePermissions"),
  ],
  [
    "/$tenant/$project/settings/workspace/runner",
    consolePageSettings("WorkspaceRunners"),
  ],
  [
    "/$tenant/$project/settings/workspace/usage",
    consolePageSettings("WorkspaceUsage"),
  ],
  [
    "/$tenant/$project/settings/site/workspaces",
    consolePageSettings("SiteWorkspaces"),
  ],
  [
    "/$tenant/$project/settings/site/permissions",
    consolePageSettings("SitePermissions"),
  ],
]);

/** The page a matched route is, or nothing where it is none the contract
 * names. */
export function consolePageOf(
  match: ConsolePageMatch | undefined,
): ConsolePage | undefined {
  const page =
    match === undefined
      ? undefined
      : consolePageRoutes.get(match.routeId)?.(match);
  const parsed = consolePageSchema.safeParse(page);
  return parsed.success ? parsed.data : undefined;
}

/** The settings section's words, as the settings' side navigation draws its
 * level and its page. */
const consolePageSectionWords: Readonly<
  Record<ConsolePageSettingsSection, string>
> = {
  ProjectLead: "Project · Lead",
  ProjectPlacement: "Project · Placement",
  ProjectPermissions: "Project · Permissions",
  WorkspacePeople: "Workspace · People",
  WorkspaceAccounts: "Workspace · Accounts",
  WorkspacePermissions: "Workspace · Permissions",
  WorkspaceRunners: "Workspace · My runners",
  WorkspaceUsage: "Workspace · Usage",
  SiteWorkspaces: "Site · Workspaces",
  SitePermissions: "Site · Permissions",
};

/** A ticket number as the console writes it everywhere. */
function consolePageTicketWord(ticket: number): string {
  return `#${String(ticket)}`;
}

/** The words a page is named by where a message says it was sent from it, in
 * the console's own words for each page. */
export function consolePageLabel(page: ConsolePage): string {
  switch (page.page) {
    case "Tickets":
    case "Inbox":
    case "Lead":
    case "Catalog":
    case "Repositories":
    case "Runners":
      return page.page;
    case "Ticket":
      return `Ticket ${consolePageTicketWord(page.ticket)}`;
    case "TicketEdit":
      return `Edit ticket ${consolePageTicketWord(page.ticket)}`;
    case "TicketNew":
      if ("draft" in page)
        return `New ticket · draft ${consolePageTicketWord(page.draft)}`;
      return page.from === undefined
        ? "New ticket"
        : `New ticket from ${consolePageTicketWord(page.from)}`;
    case "Repository":
      return `Repository ${repositoryLabel(page.repository)}`;
    case "Settings":
      return page.section === undefined
        ? "Settings"
        : `Settings · ${consolePageSectionWords[page.section]}`;
  }
}
