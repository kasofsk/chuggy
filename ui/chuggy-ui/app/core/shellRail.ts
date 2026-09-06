/**
 * The shell's rail, derived: the conversations the project holds and its other
 * faces under them, as sections of entries a renderer can draw without knowing
 * what any of them is.
 *
 * A LISTING THAT HAS NOT ANSWERED IS NOT AN EMPTY ONE. `threads` is absent
 * until the read is ready, because an empty array would put `New thread` in the
 * rail while the listing that decides whether to offer it is still in flight.
 * `threadMine` is that decision, and it is the threads page's own.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { threadsAnsweredMax } from "../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../src/contract/responses.ts";
import { threadMine, threadsMineFirst } from "./threads.ts";
import { threadStandingTone } from "./tones.ts";
import type { Tone } from "./tones.ts";

/** The router's own paths, named here so an entry is data and the renderer is
 * a loop rather than a switch over what each entry means. */
export const railRoutes = {
  overview: "/$tenant/$project",
  inbox: "/$tenant/$project/inbox",
  lead: "/$tenant/$project/lead",
  threads: "/$tenant/$project/threads",
  thread: "/$tenant/$project/threads/$session",
  selector: "/$tenant/$project/selector",
  ticketNew: "/$tenant/$project/tickets/new",
} as const;

export type RailRoute = (typeof railRoutes)[keyof typeof railRoutes];

export interface RailParams {
  readonly tenant: string;
  readonly project: string;
  readonly session?: string;
}

/** One entry's standing, in the word the wire says it in and the hue it takes,
 * so the dot a rail draws is not the only thing carrying it. */
export interface RailStanding {
  readonly word: string;
  readonly tone: Tone;
}

/** One line of the rail. `mine` is the reader's own thread, which is labelled
 * rather than identified; every other label is an identity. */
export interface RailEntry {
  readonly id: string;
  readonly label: string;
  readonly to: RailRoute;
  readonly params: RailParams;
  readonly standing?: RailStanding;
  readonly count?: string;
  readonly mine?: boolean;
}

/** A group of entries under a heading, which links to the full listing where
 * the rail holds only part of one. */
export interface RailSection {
  readonly id: string;
  readonly heading: string;
  readonly to?: RailRoute;
  readonly params?: RailParams;
  readonly entries: readonly RailEntry[];
}

export interface ShellRailInput {
  readonly partition: PartitionIdentity;
  readonly threads: readonly ThreadEntryResponse[] | undefined;
  readonly leadStanding?: RailStanding;
  readonly inboxCount?: string;
}

function shellRailThreadEntry(
  params: RailParams,
  thread: ThreadEntryResponse,
): RailEntry {
  return {
    id: thread.session,
    label: thread.mine ? "Your thread" : (thread.owner ?? thread.session),
    to: railRoutes.thread,
    params: { ...params, session: thread.session },
    standing: { word: thread.state, tone: threadStandingTone(thread.state) },
    mine: thread.mine,
  };
}

function shellRailConversations(
  input: ShellRailInput,
  params: RailParams,
): readonly RailEntry[] {
  const threads = input.threads;
  const lead: RailEntry = {
    id: "lead",
    label: "Lead",
    to: railRoutes.lead,
    params,
    standing: input.leadStanding,
  };
  if (threads === undefined) return [lead];
  const offer: readonly RailEntry[] =
    threadMine(threads) === undefined
      ? [
          {
            id: "thread-new",
            label: "New thread",
            to: railRoutes.threads,
            params,
          },
        ]
      : [];
  return [
    lead,
    ...threadsMineFirst(threads)
      .slice(0, threadsAnsweredMax)
      .map((thread) => shellRailThreadEntry(params, thread)),
    ...offer,
  ];
}

export function shellRailSections(
  input: ShellRailInput,
): readonly RailSection[] {
  const params: RailParams = {
    tenant: input.partition.tenant,
    project: input.partition.project,
  };
  return [
    {
      id: "conversations",
      heading: "Conversations",
      to: railRoutes.threads,
      params,
      entries: shellRailConversations(input, params),
    },
    {
      id: "project",
      heading: "Project",
      entries: [
        { id: "overview", label: "Overview", to: railRoutes.overview, params },
        {
          id: "inbox",
          label: "Inbox",
          to: railRoutes.inbox,
          params,
          count: input.inboxCount,
        },
        { id: "selector", label: "Selector", to: railRoutes.selector, params },
        {
          id: "ticket-new",
          label: "New ticket",
          to: railRoutes.ticketNew,
          params,
        },
      ],
    },
  ];
}
