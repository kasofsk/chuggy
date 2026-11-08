/**
 * Which console page a reader is on, read off the route the router matched
 * last: the page the contract names for it, with the ticket, the repository,
 * the epic or the settings section its address carries, the words a message sent from
 * it names it by, and the address it is at, which the console moves to where
 * the reader's thread names a page.
 *
 * A PAGE THE CONTRACT WOULD REFUSE IS NO PAGE. An address naming a ticket that
 * is not a number, or a route this table does not know, answers nothing, so a
 * message sent from it goes without a page rather than being refused for one.
 */

import { consolePageSchema } from "../../../../src/contract/consolePage.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ConsolePage,
  ConsolePageSettingsSection,
} from "../../../../src/contract/consolePage.ts";
import type { Copy } from "./copy.ts";
import { repositoryLabel } from "./projectRepositories.ts";
import { ticketCreationQueryOf } from "./ticketCreationQuery.ts";

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
  return { page: "TicketNew", ...ticketCreationQueryOf(match.search) };
}

/** The pages that name nothing on them, by where under the project each is. */
const consolePagePlainPaths = {
  Tickets: "",
  Inbox: "inbox",
  Lead: "lead",
  Catalog: "catalog",
  Repositories: "repositories",
  Runners: "runners",
  Epics: "epics",
} as const satisfies Readonly<Record<string, string>>;

type ConsolePagePlain = keyof typeof consolePagePlainPaths;

/** Each settings section, by where under the project its page is. */
const consolePageSettingsPaths: Readonly<
  Record<ConsolePageSettingsSection, string>
> = {
  ProjectLead: "settings/lead",
  ProjectPlacement: "settings/placement",
  ProjectPermissions: "settings/permissions",
  WorkspacePeople: "settings/workspace/people",
  WorkspaceAccounts: "settings/workspace/accounts",
  WorkspacePermissions: "settings/workspace/permissions",
  WorkspaceRunners: "settings/workspace/runner",
  WorkspaceUsage: "settings/workspace/usage",
  SiteWorkspaces: "settings/site/workspaces",
  SitePermissions: "settings/site/permissions",
};

/** The ticket page and each of its tabs, by where under the ticket each is:
 * every one is the ticket's page. */
const consolePageTicketTabs = [
  "",
  "/",
  "/runs",
  "/runs/$task",
  "/landing",
  "/configuration",
  "/usage",
] as const;

/** The router's identity of a route under a project, by where it is. */
function consolePageRouteId(path: string): string {
  return `/$tenant/$project/${path}`;
}

/** Each route under a project, by the identity the router gives it, and the
 * page it is. A settings address that only redirects names no section. */
const consolePageRoutes: ReadonlyMap<
  string,
  (match: ConsolePageMatch) => unknown
> = new Map<string, (match: ConsolePageMatch) => unknown>([
  ...Object.entries(consolePagePlainPaths).map(
    ([page, path]) => [consolePageRouteId(path), () => ({ page })] as const,
  ),
  [
    "/$tenant/$project/repositories/$repository",
    (match) => ({ page: "Repository", repository: match.params["repository"] }),
  ],
  ["/$tenant/$project/tickets/new", consolePageTicketNew],
  ...consolePageTicketTabs.map(
    (tab) =>
      [
        `/$tenant/$project/tickets/$ticket${tab}`,
        (match: ConsolePageMatch) => ({
          page: "Ticket",
          ticket: consolePageTicketOf(match),
        }),
      ] as const,
  ),
  [
    "/$tenant/$project/tickets/$ticket/edit",
    (match) => ({ page: "TicketEdit", ticket: consolePageTicketOf(match) }),
  ],
  [
    "/$tenant/$project/epics/$epic",
    (match) => ({ page: "Epic", epic: Number(match.params["epic"]) }),
  ],
  ["/$tenant/$project/settings", consolePageSettings()],
  ["/$tenant/$project/settings/", consolePageSettings()],
  ["/$tenant/$project/settings/workspace", consolePageSettings()],
  ["/$tenant/$project/settings/workspace/", consolePageSettings()],
  ...Object.entries(consolePageSettingsPaths).map(
    ([section, path]) =>
      [
        consolePageRouteId(path),
        consolePageSettings(section as ConsolePageSettingsSection),
      ] as const,
  ),
]);

/** Where under the project one page is, with the query it is opened with. */
function consolePagePathOf(page: ConsolePage): string {
  switch (page.page) {
    case "Tickets":
    case "Inbox":
    case "Lead":
    case "Catalog":
    case "Repositories":
    case "Runners":
    case "Epics":
      return consolePagePlainPaths[page.page satisfies ConsolePagePlain];
    case "Epic":
      return `epics/${String(page.epic)}`;
    case "Repository":
      return `repositories/${encodeURIComponent(page.repository)}`;
    case "Ticket":
      return `tickets/${String(page.ticket)}`;
    case "TicketEdit":
      return `tickets/${String(page.ticket)}/edit`;
    case "TicketNew":
      if ("draft" in page) return `tickets/new?draft=${String(page.draft)}`;
      return page.from === undefined
        ? "tickets/new"
        : `tickets/new?from=${String(page.from)}`;
    case "Settings":
      return page.section === undefined
        ? "settings"
        : consolePageSettingsPaths[page.section];
  }
}

/** The address one page of a project is at, which a match of it reads back
 * as the same page. */
export function consolePageHref(
  partition: PartitionIdentity,
  page: ConsolePage,
): string {
  const path = consolePagePathOf(page);
  const project = `/${encodeURIComponent(partition.tenant)}/${encodeURIComponent(partition.project)}`;
  return path === "" ? project : `${project}/${path}`;
}

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
  Record<ConsolePageSettingsSection, readonly [Copy, Copy]>
> = {
  ProjectLead: [{ id: "settings-nav-project" }, { id: "settings-nav-lead" }],
  ProjectPlacement: [
    { id: "settings-nav-project" },
    { id: "settings-nav-placement" },
  ],
  ProjectPermissions: [
    { id: "settings-nav-project" },
    { id: "settings-nav-permissions" },
  ],
  WorkspacePeople: [
    { id: "settings-nav-workspace" },
    { id: "settings-nav-people" },
  ],
  WorkspaceAccounts: [
    { id: "settings-nav-workspace" },
    { id: "settings-nav-accounts" },
  ],
  WorkspacePermissions: [
    { id: "settings-nav-workspace" },
    { id: "settings-nav-permissions" },
  ],
  WorkspaceRunners: [
    { id: "settings-nav-workspace" },
    { id: "settings-nav-personal-runners" },
  ],
  WorkspaceUsage: [
    { id: "settings-nav-workspace" },
    { id: "settings-nav-usage" },
  ],
  SiteWorkspaces: [
    { id: "settings-nav-site" },
    { id: "settings-nav-workspaces" },
  ],
  SitePermissions: [
    { id: "settings-nav-site" },
    { id: "settings-nav-permissions" },
  ],
};

const consolePageListWords: Readonly<
  Record<
    | "Tickets"
    | "Inbox"
    | "Lead"
    | "Catalog"
    | "Repositories"
    | "Runners"
    | "Epics",
    Copy
  >
> = {
  Tickets: { id: "pages-tickets" },
  Inbox: { id: "pages-inbox" },
  Lead: { id: "pages-lead" },
  Catalog: { id: "pages-catalog" },
  Repositories: { id: "pages-repositories" },
  Runners: { id: "pages-runners" },
  Epics: { id: "pages-epics" },
};

/** A ticket number as the console writes it everywhere. */
function consolePageTicketWord(ticket: number): string {
  return `#${String(ticket)}`;
}

/** The words a page is named by where a message says it was sent from it, in
 * the console's own words for each page. */
export function consolePageLabel(page: ConsolePage): Copy {
  switch (page.page) {
    case "Tickets":
    case "Inbox":
    case "Lead":
    case "Catalog":
    case "Repositories":
    case "Runners":
    case "Epics":
      return consolePageListWords[page.page];
    case "Epic":
      return {
        id: "pages-epic",
        args: { number: consolePageTicketWord(page.epic) },
      };
    case "Ticket":
      return {
        id: "pages-ticket",
        args: { number: consolePageTicketWord(page.ticket) },
      };
    case "TicketEdit":
      return {
        id: "pages-ticket-edit",
        args: { number: consolePageTicketWord(page.ticket) },
      };
    case "TicketNew":
      if ("draft" in page)
        return {
          id: "pages-ticket-new-draft",
          args: { number: consolePageTicketWord(page.draft) },
        };
      return page.from === undefined
        ? { id: "pages-ticket-new" }
        : {
            id: "pages-ticket-new-from",
            args: { number: consolePageTicketWord(page.from) },
          };
    case "Repository":
      return {
        id: "pages-repository",
        args: { repository: repositoryLabel(page.repository) },
      };
    case "Settings": {
      if (page.section === undefined) return { id: "pages-settings" };
      const [level, section] = consolePageSectionWords[page.section];
      return { id: "pages-settings-section", args: { level, section } };
    }
  }
}
