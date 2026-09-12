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
    { id: "ticket-new", label: "New ticket", to: navRoutes.ticketNew, params },
  ];
}
