/**
 * The shell's navigation, derived: the project's primary places, in the order
 * the bar above every page draws them, and the account menu's two places, the
 * settings and the reader's preferences among them, which `settingsNav.ts`'s
 * roster holds with every other page a reader visits rarely. A place is
 * primary only where a reader goes in the ordinary course of work.
 *
 * Every entry is a route and none is an action, so the renderer is a loop
 * rather than a switch over what each entry means. What a reader has said and
 * been told is not an entry — a thread is reached from the chat pane, whose
 * history lists them and which links to each one's own page.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { Copy } from "./copy.ts";
import {
  settingsRootRoutes,
  settingsRoutes,
  settingsSection,
} from "./settingsNav.ts";
import type {
  SettingsNavParams,
  SettingsRootRoute,
  SettingsRoute,
} from "./settingsNav.ts";

export const navRoutes = {
  overview: "/$tenant/$project",
  inbox: "/$tenant/$project/inbox",
  epics: "/$tenant/$project/epics",
  settings: settingsRootRoutes.project,
  ticketNew: "/$tenant/$project/tickets/new",
  thread: "/$tenant/$project/threads/$session",
} as const;

export type NavRoute = (typeof navRoutes)[keyof typeof navRoutes];

/** Each address a page left for a settings section, and the section's: the
 * old address redirects to the new, with whatever it carried. */
export const navMoved = {
  "/$tenant/$project/lead": settingsRoutes.project.leadSession,
  "/$tenant/$project/catalog": settingsRoutes.project.catalog,
  "/$tenant/$project/repositories": settingsRoutes.project.repositories,
  "/$tenant/$project/repositories/$repository":
    "/$tenant/$project/settings/repositories/$repository",
  "/$tenant/$project/runners": settingsRoutes.project.runners,
} as const;

export interface NavParams {
  readonly tenant: string;
  readonly project: string;
  readonly session?: string | undefined;
}

/** Every entry the bar draws, so each is drawn with its own glyph. */
export type NavEntryId = "overview" | "epics" | "inbox";

export interface NavEntry {
  readonly id: NavEntryId;
  readonly label: Copy;
  readonly to: NavRoute;
  readonly params: NavParams;
}

function navParamsOf(partition: PartitionIdentity): NavParams {
  return { tenant: partition.tenant, project: partition.project };
}

/** The project's primary places, in order. */
export function shellNav(partition: PartitionIdentity): readonly NavEntry[] {
  const params = navParamsOf(partition);
  return [
    {
      id: "overview",
      label: { id: "shell-nav-tickets" },
      to: navRoutes.overview,
      params,
    },
    {
      id: "epics",
      label: { id: "shell-nav-epics" },
      to: navRoutes.epics,
      params,
    },
    { id: "inbox", label: { id: "shell-inbox" }, to: navRoutes.inbox, params },
  ];
}

export interface AccountNavEntry {
  readonly id: "settings" | "preferences";
  readonly label: Copy;
  readonly to: SettingsRootRoute | SettingsRoute;
  readonly params: SettingsNavParams;
}

/** The account menu's places, in the order it lists them, each at its address
 * in the frame the menu is drawn in: under the project where `params` names
 * one, and under the workspace alone where it does not. */
export function shellAccountNav(
  params: SettingsNavParams,
): readonly AccountNavEntry[] {
  const inProject = params.project !== undefined;
  return [
    {
      id: "settings",
      label: { id: "shell-account-settings" },
      to: inProject ? settingsRootRoutes.project : settingsRootRoutes.workspace,
      params,
    },
    {
      id: "preferences",
      label: settingsSection("preferences").label,
      to: inProject
        ? settingsRoutes.project.preferences
        : settingsRoutes.workspace.preferences,
      params,
    },
  ];
}

/** The address an entry's route has under its parameters. */
function navEntryPath(entry: NavEntry): string {
  return entry.to
    .replace("$tenant", encodeURIComponent(entry.params.tenant))
    .replace("$project", encodeURIComponent(entry.params.project));
}

const ticketNewSegment = "new";

/**
 * Whether a page is the one an entry stands for: its own address and whatever
 * lies beneath it. Tickets is the exception, because the overview is the
 * parent of every other address and would read as selected on all of them; it
 * is current on the overview and on a ticket's page and edit, and not on
 * `tickets/new`.
 */
export function navEntryCurrent(entry: NavEntry, pathname: string): boolean {
  const path = navEntryPath(entry);
  const at = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (entry.to !== navRoutes.overview)
    return at === path || at.startsWith(`${path}/`);
  if (at === path) return true;
  const ticketPrefix = `${path}/tickets/`;
  if (!at.startsWith(ticketPrefix)) return false;
  const [ticket, ...rest] = at.slice(ticketPrefix.length).split("/");
  if (ticket === "" || ticket === undefined) return false;
  if (ticket === ticketNewSegment) return false;
  return rest.length === 0 || (rest.length === 1 && rest[0] === "edit");
}
