/**
 * The shell's rail, derived: the project's fixed entries, the reader's own
 * conversations grouped by activity, and the link to the rest.
 *
 * A LISTING THAT HAS NOT ANSWERED OFFERS NO NEW THREAD. `threads` is absent
 * until the read is ready, because an offer to open one before the listing
 * says whether the reader already has one would race the door that answers
 * idempotently on it.
 *
 * ONLY THE READER'S OWN THREADS APPEAR HERE. A project's other members' work
 * belongs to the Threads page; the rail is one member's own view of their own
 * conversations; and a thread its owner hid is off this list until they show
 * it again, which is what `hidden` is for.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../src/contract/responses.ts";
import { threadGroups } from "./threadGroups.ts";
import type { ThreadGroupHeading } from "./threadGroups.ts";
import { threadLabel, threadMine } from "./threads.ts";
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

export type RailActionKind = "NewThread";

interface RailEntryCommon {
  readonly id: string;
  readonly label: string;
  readonly standing?: RailStanding | undefined;
  readonly count?: string | undefined;
  /** Drawn in the quiet ink: a thread that no longer takes turns. */
  readonly closed?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** For a `NewThread` action only: the reader's open thread it closes before
   * opening another, where one stands. */
  readonly closes?: string | undefined;
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

export interface RailThreadGroup {
  readonly heading: ThreadGroupHeading;
  readonly entries: readonly RailEntry[];
}

export interface RailConversations {
  readonly lead: RailEntry;
  /** Absent while the listing has not answered. */
  readonly newThread: RailEntry | undefined;
  readonly groups: readonly RailThreadGroup[];
}

export interface ShellRail {
  /** Overview, Inbox, Selector, New ticket: entries that never scroll away. */
  readonly fixed: readonly RailEntry[];
  readonly conversations: RailConversations;
  readonly allThreads: RailEntry;
}

export interface ShellRailInput {
  readonly partition: PartitionIdentity;
  readonly threads: readonly ThreadEntryResponse[] | undefined;
  readonly leadStanding?: RailStanding | undefined;
  readonly inboxCount?: string | undefined;
  /** Whether the reader's own open thread has a turn the mailbox has not
   * settled, which is what `New thread` is withheld for. */
  readonly answering?: boolean | undefined;
  readonly nowMs: number;
}

/** How many of the reader's own threads the rail draws before handing off to
 * the Threads page, which holds the rest. */
export const railThreadsShown = 20;

function shellRailNewThread(
  mine: ThreadEntryResponse | undefined,
  answering: boolean,
): RailEntry {
  if (mine === undefined)
    return { id: "thread-new", label: "New thread", action: "NewThread" };
  if (answering)
    return {
      id: "thread-new",
      label: "Answering",
      action: "NewThread",
      disabled: true,
    };
  return {
    id: "thread-new",
    label: "New thread",
    action: "NewThread",
    closes: mine.session,
  };
}

function shellRailThreadEntry(
  params: RailParams,
  thread: ThreadEntryResponse,
): RailEntry {
  return {
    id: thread.session,
    label: threadLabel(thread),
    to: railRoutes.thread,
    params: { ...params, session: thread.session },
    closed: thread.state === "Closed",
  };
}

function shellRailConversations(
  input: ShellRailInput,
  params: RailParams,
): RailConversations {
  const lead: RailEntry = {
    id: "lead",
    label: "Lead",
    to: railRoutes.lead,
    params,
    standing: input.leadStanding,
  };
  const threads = input.threads;
  if (threads === undefined) return { lead, newThread: undefined, groups: [] };
  const newThread = shellRailNewThread(
    threadMine(threads),
    input.answering === true,
  );
  const own = threads
    .filter((thread) => thread.mine && !thread.hidden)
    .toSorted(
      (left, right) =>
        Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt),
    )
    .slice(0, railThreadsShown);
  const groups = threadGroups(
    own,
    (thread) => Date.parse(thread.lastActivityAt),
    input.nowMs,
  ).map((group) => ({
    heading: group.heading,
    entries: group.entries.map((thread) =>
      shellRailThreadEntry(params, thread),
    ),
  }));
  return { lead, newThread, groups };
}

function shellRailFixed(
  params: RailParams,
  inboxCount: string | undefined,
): readonly RailEntry[] {
  return [
    { id: "overview", label: "Overview", to: railRoutes.overview, params },
    {
      id: "inbox",
      label: "Inbox",
      to: railRoutes.inbox,
      params,
      count: inboxCount,
    },
    { id: "selector", label: "Selector", to: railRoutes.selector, params },
    { id: "ticket-new", label: "New ticket", to: railRoutes.ticketNew, params },
  ];
}

export function shellRail(input: ShellRailInput): ShellRail {
  const params: RailParams = {
    tenant: input.partition.tenant,
    project: input.partition.project,
  };
  return {
    fixed: shellRailFixed(params, input.inboxCount),
    conversations: shellRailConversations(input, params),
    allThreads: {
      id: "all-threads",
      label: "All threads",
      to: railRoutes.threads,
      params,
    },
  };
}
