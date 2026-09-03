/**
 * What a project's members may read of each other's threads, and what one
 * member may put in their own: the listing, one thread's standing with a page
 * of its mailbox, the transcript behind it, and the door a message goes
 * through.
 *
 * A THREAD IS READABLE BY EVERY MEMBER AND WRITABLE BY ITS OWNER ALONE. The
 * reads are `Read` and answer every thread the project holds, because members
 * cooperating is the reason the three thread tools exist; the door is `Mutate`
 * and reaches the caller's own mailbox and no other. What enforces that second
 * half is `enqueue_thread_message` taking no session at all and resolving one
 * from the authenticated principal: the URL's session is compared with the one
 * that resolved, AFTER the enqueue, so a mismatch is refused on what the
 * durable side actually did rather than on a row read a round trip earlier. The
 * standing read before it is a fast refusal and the seeding decision, not the
 * control — between the two, a thread can be closed and reopened.
 *
 * THE MAILBOX IS PAGED AND THE LISTING IS NOT. One thread turn carries what the
 * member typed and what came back, and either alone may weigh most of a wire
 * body; a listing entry carries three identities and a count. So a thread read
 * takes a page of its own mailbox, newest last and older pages walked backwards
 * the way a conversation is scrolled, and a listing answers whole.
 *
 * THE TRANSCRIPT IS THE LEAD'S WALK OVER ANOTHER SESSION, and literally so:
 * nothing here declares a page, a query or a read of its own. The boundary
 * draws a thread's transcript with `leadRead.ts`'s walk over `leadRead.ts`'s
 * row source and answers it through the lead's own wire body, so one transcript
 * has one page type and one representation — and a reader of a thread's and a
 * reader of the lead's cannot be shown two readings of one store.
 *
 * THE SEEDING BLOCK IS COMPOSED HERE AND BOUNDED IN `thread.ts`. The first turn
 * of a thread with no agent reference carries the project's North Star, the
 * member's own open drafts and what stands against them; every later turn is
 * the message alone. What sheds and what never sheds is `threadTurnInput`'s
 * rule, and an input that will not fit without shedding the North Star is
 * refused rather than quietly shortened.
 */

import {
  agenticRefusalsAnsweredMax,
  nativeHttpPageItemsMax,
  threadMessageCharsMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
} from "../contract/http.ts";
import type {
  SessionId,
  SessionState,
  SessionTurnFailure,
  SessionTurnId,
  SessionTurnInputKind,
  SessionTurnMeasured,
  SessionTurnState,
} from "./agentSession.ts";
import type { Authority } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import type { Partition } from "./projectStore.ts";
import type { SessionStoreStreamRow } from "./sessionPlane.ts";
import {
  threadStanding,
  type ThreadSeededDraft,
  type ThreadSeededRefusal,
  type ThreadSeeding,
  type ThreadStanding,
} from "./thread.ts";

/**
 * One member thread as the durable listing names it. `principal` is whose it
 * is and never crosses the wire: it is what `mine` is computed against, and a
 * listing that shipped it would hand every member every other member's token
 * subject for nothing.
 */
export interface ThreadRecord {
  readonly session: SessionId;
  readonly principal: Principal;
  /** The membership's own authority subject, absent where that membership is gone. */
  readonly owner?: string;
  readonly state: SessionState;
  readonly turns: number;
  readonly agentReference?: string;
}

/**
 * One turn of a thread's mailbox as a reader sees it, carrying its input and
 * its result where the lead's carries neither: a member's input is what they
 * typed and their result is the answer they are waiting for.
 */
export interface ThreadTurnRecord {
  readonly turn: SessionTurnId;
  readonly ordinal: number;
  readonly inputKind: SessionTurnInputKind;
  readonly state: SessionTurnState;
  readonly input: string;
  readonly result?: string;
  readonly failure?: SessionTurnFailure;
  readonly measured?: SessionTurnMeasured;
  readonly batchFirst?: number;
  readonly batchLast?: number;
}

/**
 * Which page of a mailbox a read asks for. It walks BACKWARDS, because the turn
 * a member came for is the last one and a forward cursor would make them page
 * the whole conversation to reach it.
 */
export interface ThreadMailboxQuery {
  /** The ordinal to answer from, exclusive and walking down; absent asks for the newest page. */
  readonly before?: number;
  readonly limit: number;
}

/** One thread, one page of its mailbox, and the streams its store holds. */
export interface ThreadStandingRecord {
  readonly thread: ThreadRecord;
  /** The page, in ordinal order, newest last. */
  readonly turns: readonly ThreadTurnRecord[];
  /** The cursor an older page is asked for with, absent where this page reaches the first turn. */
  readonly nextBefore?: number;
  readonly streams: readonly SessionStoreStreamRow[];
}

/** What opening a member's thread answered: it is open now, or it already was. */
export interface ThreadOpened {
  readonly opened: "Opened" | "AlreadyOpen";
  readonly thread: ThreadRecord;
}

/**
 * What the message door's durable half answered. `NoThread`, `Closed` and
 * `Orphaned` are each a mailbox that takes no message, and they are three arms
 * rather than one because a member whose thread is closed reopens it and a
 * member whose membership is gone cannot.
 */
export type ThreadMessageEnqueued =
  | {
      readonly enqueued: "Enqueued" | "AlreadyEnqueued";
      readonly session: SessionId;
      readonly ordinal: number;
    }
  | {
      readonly enqueued:
        "NoThread" | "NotYourThread" | "Closed" | "Orphaned" | "Backlogged";
    };

/**
 * The durable thread authority migration 062 answers: the listing, the door
 * that opens one, the standing read and the door a message goes through.
 * `open` TAKES NO ROSTER AND `enqueueMessage` TAKES NO SESSION, and both
 * omissions are the control — the definer writes `threadCapabilitiesDefault`
 * itself so an API talked into opening a thread cannot widen one, and it
 * resolves the mailbox from the principal so an API talked into enqueuing
 * cannot reach another member's.
 */
export interface ThreadStore {
  threads(
    partition: Partition,
    limit: number,
  ): Promise<readonly ThreadRecord[]>;
  open(input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly session: SessionId;
    readonly systemPrompt: string;
    readonly credentialSlot: string;
  }): Promise<ThreadOpened>;
  /** One thread's standing, or nothing where the session is not this project's own thread. */
  standing(input: {
    readonly partition: Partition;
    readonly session: SessionId;
    readonly query: ThreadMailboxQuery;
  }): Promise<ThreadStandingRecord | undefined>;
  /**
   * `session` is the one the caller NAMED, never the one the mailbox is found
   * by: the durable side resolves the mailbox from the principal and refuses a
   * session that is not the one it resolved, so a stale listing cannot put a
   * message in a conversation the member is not reading.
   */
  enqueueMessage(input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly session: SessionId;
    readonly turn: SessionTurnId;
    readonly input: string;
  }): Promise<ThreadMessageEnqueued>;
}

/**
 * The identity a thread is opened under, minted where a deployment can choose
 * how — `SessionAttemptMint` is the same arrangement for an attempt's. It is a
 * port rather than an adapter's own `randomUUID` because a name is a decision
 * and an adapter holds no rules: the definer takes the identity as an argument,
 * and a run whose enqueue crashed can be given the same one again.
 */
export interface ThreadSessionMint {
  session(): SessionId;
}

/**
 * What a thread's first turn is seeded from, the North Star asked for as itself
 * rather than as the whole resolved record so the composition answering it
 * cannot hand a thread the lead's prompt or its limits by accident. The drafts
 * and the refusals — migration 061's read and 059's — are filtered to the
 * member the block is for, which is why an authority rather than a principal is
 * what they take.
 */
export interface ThreadSeedingRead {
  northStar(partition: Partition): Promise<string | undefined>;
  drafts(
    partition: Partition,
    author: Authority,
    limit: number,
  ): Promise<readonly ThreadSeededDraft[]>;
  refusals(
    partition: Partition,
    tickets: readonly number[],
    limit: number,
  ): Promise<readonly ThreadSeededRefusal[]>;
}

/** One thread as the wire names it, with `mine` decided against the reader's own principal. */
export interface ThreadEntry {
  readonly session: SessionId;
  readonly owner?: string;
  readonly state: ThreadStanding;
  readonly mine: boolean;
  readonly turns: number;
  readonly agentReference?: string;
}

export type ThreadsRead =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly threads: readonly ThreadEntry[] };

export type ThreadRead =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly thread: ThreadEntry;
      readonly turns: readonly ThreadTurnRecord[];
      readonly nextBefore?: number;
      readonly streams: readonly SessionStoreStreamRow[];
    };

/** What opening my thread answered, and which of the two the wire reports as created. */
export type ThreadOpening =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Opened" | "AlreadyOpen";
      readonly thread: ThreadEntry;
    };

/**
 * What the message door answered. `NotYourThread` is the URL and the resolved
 * mailbox disagreeing, and it is deliberately not `NotFound`: a member may read
 * every thread this project holds, so hiding one they may already list would
 * tell them nothing they cannot see and would hide which refusal they met.
 */
export type ThreadMessageSent =
  | { readonly result: "NotFound" }
  | { readonly result: "NotYourThread" }
  | { readonly result: "Closed" | "Orphaned" }
  /** The first turn's seeding block and the message will not fit one turn together. */
  | { readonly result: "TooLarge"; readonly charsMax: number }
  | { readonly result: "Backlogged"; readonly retryAfterSeconds: number }
  | {
      readonly result: "Sent" | "AlreadySent";
      readonly turn: SessionTurnId;
      readonly ordinal: number;
    };

/**
 * What the durable enqueue answered, as the door answers it, and where the URL
 * is held against the mailbox that resolved: an ordinal in a session the caller
 * did not name is a `202` about a conversation they are not reading, so the two
 * success arms are refused where the sessions differ.
 */
export function threadMessageSent(
  enqueued: ThreadMessageEnqueued,
  named: SessionId,
  turn: SessionTurnId,
): ThreadMessageSent {
  switch (enqueued.enqueued) {
    case "NoThread":
      return { result: "NotFound" };
    case "NotYourThread":
      return { result: "NotYourThread" };
    case "Closed":
    case "Orphaned":
      return { result: enqueued.enqueued };
    case "Backlogged":
      return {
        result: "Backlogged",
        retryAfterSeconds: threadBacklogRetrySeconds,
      };
    case "Enqueued":
    case "AlreadyEnqueued":
      return enqueued.session !== named
        ? { result: "NotYourThread" }
        : {
            result: enqueued.enqueued === "Enqueued" ? "Sent" : "AlreadySent",
            turn,
            ordinal: enqueued.ordinal,
          };
  }
}

/**
 * How long a member is told to wait when their thread already holds
 * `threadBacklogMax` turns. A queued turn clears when a pod answers one, which
 * is minutes rather than seconds, so this is a hint to come back rather than a
 * claim the queue has drained.
 */
export const threadBacklogRetrySeconds = 60;

/**
 * How many of the member's drafts and refusals a first turn is seeded from,
 * which are the page bounds the routes behind them already answer at. Neither
 * decides how much the block weighs — `threadTurnInput` sheds these two, in
 * this order, until the turn fits.
 */
export const threadSeededDraftsMax = nativeHttpPageItemsMax;
export const threadSeededRefusalsMax = agenticRefusalsAnsweredMax;

/** One record as the wire names it, with the reader's own principal deciding `mine`. */
export function threadEntry(
  record: ThreadRecord,
  principal: Principal,
): ThreadEntry {
  return {
    session: record.session,
    ...(record.owner === undefined ? {} : { owner: record.owner }),
    state: threadStanding(record),
    mine: record.principal === principal,
    turns: record.turns,
    ...(record.agentReference === undefined
      ? {}
      : { agentReference: record.agentReference }),
  };
}

export function checkedThreadsLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > threadsAnsweredMax)
    throw new RangeError(
      `a thread listing answers between 1 and ${String(threadsAnsweredMax)} threads`,
    );
  return limit;
}

export function checkedThreadMailboxQuery(
  query: ThreadMailboxQuery,
): ThreadMailboxQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > threadTurnsAnsweredMax
  )
    throw new RangeError(
      `a mailbox page holds between 1 and ${String(threadTurnsAnsweredMax)} turns`,
    );
  if (
    query.before !== undefined &&
    (!Number.isSafeInteger(query.before) || query.before < 1)
  )
    throw new RangeError("a mailbox cursor must be a turn ordinal");
  return query;
}

/**
 * The message as the door accepts it. The schema at the boundary bounds it too;
 * this is the bound for every other caller of the door, and an empty message is
 * refused rather than enqueued because a turn nobody asked a question in still
 * costs an attempt.
 */
export function checkedThreadMessage(message: string): string {
  if (message.length === 0)
    throw new RangeError("a thread message must not be empty");
  if (message.length > threadMessageCharsMax)
    throw new RangeError(
      `a thread message must be at most ${String(threadMessageCharsMax)} characters`,
    );
  return message;
}

/**
 * What a thread's first turn is seeded with: the project's North Star, the
 * member's own open drafts, and the standing refusals against exactly those
 * drafts. The refusals are asked for by ticket rather than read whole, because
 * a refusal against work this member never authored is not their business on
 * their first turn.
 */
export async function threadSeeding(
  seeding: ThreadSeedingRead,
  partition: Partition,
  author: Authority,
): Promise<ThreadSeeding> {
  const northStar = await seeding.northStar(partition);
  const drafts = await seeding.drafts(partition, author, threadSeededDraftsMax);
  const refusals =
    drafts.length === 0
      ? []
      : await seeding.refusals(
          partition,
          drafts.map((draft) => draft.ticket),
          threadSeededRefusalsMax,
        );
  return {
    ...(northStar === undefined ? {} : { northStar }),
    drafts,
    refusals,
  };
}
