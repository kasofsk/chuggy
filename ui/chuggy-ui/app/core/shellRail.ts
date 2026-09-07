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
  readonly session?: string | undefined;
}

/** One entry's standing, in the word the wire says it in and the hue it takes,
 * so the dot a rail draws is not the only thing carrying it. */
export interface RailStanding {
  readonly word: string;
  readonly tone: Tone;
}

export type RailActionKind = "OpenThread";

interface RailEntryCommon {
  readonly id: string;
  readonly label: string;
  /** Whether the label is an identifier rather than words, which is what the
   * renderer draws as one. */
  readonly identity?: boolean | undefined;
  readonly standing?: RailStanding | undefined;
  readonly count?: string | undefined;
  /** The reader's own thread whose label stopped saying so, which is what the
   * renderer marks: a thread named by its title lost the only words naming its
   * owner, and one still labelled `Your thread` says it already. */
  readonly yours?: boolean | undefined;
}

/** One line of the rail: a route to follow, or an action to take — never
 * both. */
export type RailEntry =
  | (RailEntryCommon & {
      readonly to: RailRoute;
      readonly params: RailParams;
      readonly action?: undefined;
    })
  | (RailEntryCommon & {
      readonly to?: undefined;
      readonly params?: undefined;
      readonly action: RailActionKind;
    });

/** A group of entries under a heading, which links to the full listing where
 * the rail holds only part of one. */
export interface RailSection {
  readonly id: string;
  readonly heading: string;
  readonly to?: RailRoute | undefined;
  readonly params?: RailParams | undefined;
  readonly entries: readonly RailEntry[];
}

export interface ShellRailInput {
  readonly partition: PartitionIdentity;
  readonly threads: readonly ThreadEntryResponse[] | undefined;
  readonly leadStanding?: RailStanding | undefined;
  readonly inboxCount?: string | undefined;
}

/** How much of a session's tail tells one of the reader's threads from
 * another: every session shares the fixed `thread-` head a mint gives it, so
 * the distinguishing hex lives in the UUID's own tail. */
const sessionCharsShort = 8;

/** A thread is its title where the server derived one. Until a member has said
 * anything there is nothing to derive it from, so the fallback is an identity:
 * the owner's, or the session's where the membership is gone — and the
 * reader's own is `Your thread`, a second of theirs disambiguated by its
 * session's tail, which draws from the random half of the id rather than the
 * prefix every session shares. */
function shellRailThreadLabel(
  thread: ThreadEntryResponse,
  mostRecentMine: boolean,
): string {
  if (thread.title !== undefined) return thread.title;
  if (!thread.mine) return thread.owner ?? thread.session;
  if (mostRecentMine) return "Your thread";
  return `Your thread · ${thread.session.slice(-sessionCharsShort)}`;
}

function shellRailThreadEntry(
  params: RailParams,
  thread: ThreadEntryResponse,
  mostRecentMine: boolean,
): RailEntry {
  return {
    id: thread.session,
    label: shellRailThreadLabel(thread, mostRecentMine),
    identity: thread.title === undefined && !thread.mine,
    to: railRoutes.thread,
    params: { ...params, session: thread.session },
    standing: { word: thread.state, tone: threadStandingTone(thread.state) },
    yours: thread.mine && thread.title !== undefined,
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
      ? [{ id: "thread-new", label: "New thread", action: "OpenThread" }]
      : [];
  const ordered = threadsMineFirst(threads).slice(0, threadsAnsweredMax);
  /** `read_project_threads` (migration 075, replacing 062's ascending order)
   * lists an open thread ahead of a closed one and then newest-opened first,
   * so the reader's most recent thread is the first mine entry, not the last. */
  const mostRecentMine = ordered.findIndex((thread) => thread.mine);
  return [
    lead,
    ...ordered.map((thread, at) =>
      shellRailThreadEntry(params, thread, at === mostRecentMine),
    ),
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
