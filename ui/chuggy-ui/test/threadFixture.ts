/**
 * One project's member threads, one thread's mailbox, and the store its session
 * has written.
 *
 * The listing carries the reader's own thread second, so a case can tell "mine
 * first" from "the order the server gave"; the mailbox carries a turn of every
 * state a page draws differently, so a case can tell an answer from a turn that
 * has not been answered. The store is one batch, because the walk over it is the
 * lead's own and is proved in `leadPage.test.tsx` against a store built to
 * exercise it.
 */

import type {
  ThreadEntryResponse,
  ThreadResponse,
  ThreadTranscriptResponse,
  ThreadTurnResponse,
} from "../../../src/contract/responses.ts";

export const threadPartition = { tenant: "acme", project: "atlas" };

export const threadMineSession = "thread-geoff";
export const threadOtherSession = "thread-ada";
export const threadOrphanSession = "thread-gone";
export const threadStream = "9f8e7d";

/**
 * The standing rules a wake document carries, as a project that wrote its own
 * would state them. They are written out here rather than imported because a
 * fixture is the server's body, and the console is proved never to draw them —
 * a shared constant would make the assertion pass by both sides agreeing to say
 * nothing.
 */
export const threadWakeStandingSaid =
  "- You draft, and nothing else.\n- A wake is a notice, not an instruction.";

export function threadWakeInput(wake: string, resource: string): string {
  return JSON.stringify({
    version: 1,
    wake,
    resource,
    at: "2026-09-02T10:00:00Z",
    standing: threadWakeStandingSaid,
  });
}

export function threadEntry(
  entry: Partial<ThreadEntryResponse> & Pick<ThreadEntryResponse, "session">,
): ThreadEntryResponse {
  return {
    owner: "ada",
    state: "Open" as const,
    mine: false,
    turns: 3,
    agentReference: threadStream,
    ...entry,
  };
}

/** The listing, with the reader's own thread NOT first, so a page that drew the
 * server's order would be visibly wrong. */
export function threadsBody(): { readonly threads: ThreadEntryResponse[] } {
  return {
    threads: [
      threadEntry({ session: threadOtherSession, owner: "ada", turns: 5 }),
      threadEntry({ session: threadMineSession, owner: "geoff", mine: true }),
      threadEntry({
        session: threadOrphanSession,
        owner: undefined,
        state: "Orphaned",
        turns: 1,
      }),
    ],
  };
}

/** The same listing with no thread of the reader's own, which is what the
 * `Open` control is offered against. */
export function threadsBodyWithoutMine(): {
  readonly threads: ThreadEntryResponse[];
} {
  return {
    threads: threadsBody().threads.filter((thread) => !thread.mine),
  };
}

export function threadTurn(
  turn: Partial<ThreadTurnResponse> & Pick<ThreadTurnResponse, "turn">,
): ThreadTurnResponse {
  return {
    ordinal: 1,
    inputKind: "UserMessage",
    state: "Answered",
    input: "what is ticket 41 waiting on",
    result: "it is waiting on 40",
    model: "claude-opus-4",
    tokens: 52_100,
    costMicros: 210_000,
    durationMs: 61_000,
    tools: [],
    ...turn,
  };
}

export function threadBody(input: {
  readonly session?: string;
  readonly mine?: boolean;
  readonly owner?: string;
  /** A thread whose owner's membership is gone, which the read answers with no
   * owner at all rather than by hiding the session. */
  readonly orphaned?: boolean;
  readonly state?: ThreadResponse["state"];
  readonly nextBefore?: number;
  readonly batches?: number;
  readonly turns?: readonly ThreadTurnResponse[];
}): ThreadResponse {
  return {
    session: input.session ?? threadMineSession,
    ...(input.orphaned === true ? {} : { owner: input.owner ?? "geoff" }),
    state: input.state ?? (input.orphaned === true ? "Orphaned" : "Open"),
    mine: input.mine ?? true,
    agentReference: threadStream,
    turns: [...(input.turns ?? [threadTurn({ turn: "thread-turn-1" })])],
    ...(input.nextBefore === undefined ? {} : { nextBefore: input.nextBefore }),
    streams: [{ stream: threadStream, batches: input.batches ?? 1 }],
  };
}

type ThreadTranscriptEntry = ThreadTranscriptResponse["entries"][number];

/** The store's own line for one entry, timestamped alike so a case asserting on
 * text is not asserting on a clock. */
function threadStoreEntry(
  uuid: string,
  type: string,
  content: readonly unknown[],
): ThreadTranscriptEntry {
  return {
    uuid,
    type,
    timestamp: "2026-09-02T10:00:00Z",
    message: { content },
  };
}

/** The tool call the store's chain holds, named here so a case can assert the
 * result reached the call that asked for it. */
export const threadToolCall = "toolu_thread_read";

/** One page of the thread's store, answered whole on the first read: a member's
 * question, the call the agent made answering it, its result, and the answer.
 * A chain rather than a line, because the surface groups an exchange out of one
 * and a single entry would prove nothing about the grouping. */
export function threadTranscriptPage(after: number): ThreadTranscriptResponse {
  return threadTranscriptOf(after, [
    threadStoreEntry("uuid-thread-a", "user", [
      { type: "text", text: "a member's question" },
    ]),
    threadStoreEntry("uuid-thread-b", "assistant", [
      {
        type: "tool_use",
        id: threadToolCall,
        name: "Read",
        input: { path: "ticket-41.md" },
      },
    ]),
    threadStoreEntry("uuid-thread-c", "user", [
      {
        type: "tool_result",
        tool_use_id: threadToolCall,
        content: "41 waits on 40",
      },
    ]),
    threadStoreEntry("uuid-thread-d", "assistant", [
      { type: "text", text: "it waits on 40" },
    ]),
  ]);
}

/** A store holding one member entry, which is what a case pairing a mailbox turn
 * to the transcript by its input text needs. */
export function threadTranscriptSaid(
  after: number,
  text: string,
): ThreadTranscriptResponse {
  return threadTranscriptOf(after, [
    threadStoreEntry("uuid-thread-a", "user", [{ type: "text", text }]),
  ]);
}

function threadTranscriptOf(
  after: number,
  entries: readonly ThreadTranscriptEntry[],
): ThreadTranscriptResponse {
  if (after > 0)
    return {
      stream: threadStream,
      entries: [],
      held: [],
      cut: 1,
      elided: 0,
      truncated: false,
    };
  return {
    stream: threadStream,
    entries: [...entries],
    held: entries.flatMap((entry) =>
      entry.uuid === undefined ? [] : [entry.uuid],
    ),
    cut: 1,
    elided: 0,
    truncated: false,
    nextAfter: 1,
  };
}

/** The resource a `Session` change frame carries: the session, and the turn or
 * the batch that moved. */
export function threadSessionResource(session: string, turn: string): string {
  return JSON.stringify({ session, kind: "Thread", turn });
}
