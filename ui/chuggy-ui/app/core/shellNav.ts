/**
 * The shell's navigation, derived: the project's screens, in the order the bar
 * above every page draws them.
 *
 * Every entry is a route and none is an action, so the renderer is a loop
 * rather than a switch over what each entry means. What a reader has said and
 * been told is not here and is not a screen at all — a thread is read in the
 * chat pane, and the pane's own history is how one is reached.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { Tone } from "./tones.ts";

export const navRoutes = {
  overview: "/$tenant/$project",
  inbox: "/$tenant/$project/inbox",
  lead: "/$tenant/$project/lead",
  selector: "/$tenant/$project/selector",
  repositories: "/$tenant/$project/repositories",
  runners: "/$tenant/$project/runners",
  ticketNew: "/$tenant/$project/tickets/new",
} as const;

export type NavRoute = (typeof navRoutes)[keyof typeof navRoutes];

export interface NavParams {
  readonly tenant: string;
  readonly project: string;
  readonly session?: string | undefined;
}

/** One entry's standing, in the word the wire says it in and the hue it takes,
 * so a dot is not the only thing carrying it. */
export interface NavStanding {
  readonly word: string;
  readonly tone: Tone;
}

export interface NavEntry {
  readonly id: string;
  readonly label: string;
  readonly to: NavRoute;
  readonly params: NavParams;
  readonly standing?: NavStanding | undefined;
  readonly count?: string | undefined;
}

export interface ShellNavInput {
  readonly partition: PartitionIdentity;
  readonly leadStanding?: NavStanding | undefined;
  readonly inboxCount?: string | undefined;
}

export function shellNav(input: ShellNavInput): readonly NavEntry[] {
  const params: NavParams = {
    tenant: input.partition.tenant,
    project: input.partition.project,
  };
  return [
    { id: "overview", label: "Tickets", to: navRoutes.overview, params },
    {
      id: "inbox",
      label: "Inbox",
      to: navRoutes.inbox,
      params,
      count: input.inboxCount,
    },
    {
      id: "lead",
      label: "Lead",
      to: navRoutes.lead,
      params,
      standing: input.leadStanding,
    },
    { id: "selector", label: "Selector", to: navRoutes.selector, params },
    {
      id: "repositories",
      label: "Repositories",
      to: navRoutes.repositories,
      params,
    },
    { id: "runners", label: "Runners", to: navRoutes.runners, params },
    { id: "ticket-new", label: "New ticket", to: navRoutes.ticketNew, params },
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
 * is current on the overview and on a ticket's page and edit, and `tickets/new`
 * is New ticket's.
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
