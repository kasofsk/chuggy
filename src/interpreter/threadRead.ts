/**
 * What a project's members may read of each other's threads, what one member
 * may put in their own, and what any of them may end: the listing, one
 * thread's standing with a page of its mailbox, the transcript behind it, the
 * door a message goes through and the door that closes a thread.
 *
 * A THREAD IS READABLE BY EVERY MEMBER, WRITABLE BY ITS OWNER ALONE, AND
 * CLOSABLE BY ANY MEMBER WHO MAY MUTATE. The reads are `Read` and answer every
 * thread the project holds, because members cooperating is the reason the
 * three thread tools exist; the message door is `Mutate` and reaches the
 * caller's own mailbox and no other; the close door is `Mutate` and reaches
 * any thread, because a thread files drafts and does nothing else, so ending
 * one takes nothing its owner cannot file again from a new one. What enforces
 * the owner-alone half is `enqueue_thread_message` holding the session the URL
 * names against the authenticated principal, in the transaction that enqueues,
 * so a refusal is decided on the row the turn would land in rather than on one
 * read a round trip earlier. The standing read before it is a fast refusal and
 * the seeding decision, not the control — between the two, a thread can be
 * closed.
 *
 * A MEMBER HOLDS SEVERAL OPEN THREADS, up to their limit in the project. An
 * open is idempotent on the key its client minted, so a retried open answers
 * the thread the first one opened, and an open past the limit is refused
 * rather than closing one to make room.
 *
 * THE MAILBOX IS PAGED AND THE LISTING IS NOT. One thread turn carries what the
 * member typed and what came back, and either alone may weigh most of a wire
 * body; a listing entry carries three identities, a bounded title and a
 * count. So a thread read takes a page of its own mailbox, newest last and
 * older pages walked backwards the way a conversation is scrolled, and a
 * listing answers whole.
 *
 * THE TRANSCRIPT IS THE LEAD'S WALK OVER ANOTHER SESSION, and literally so:
 * nothing here declares a page, a query or a read of its own. The boundary
 * draws a thread's transcript with `leadRead.ts`'s walk over `leadRead.ts`'s
 * row source and answers it through the lead's own wire body, so one transcript
 * has one page type and one representation — and a reader of a thread's and a
 * reader of the lead's cannot be shown two readings of one store.
 *
 * THE SEEDING BLOCK IS COMPOSED HERE AND BOUNDED IN `thread.ts`. The first turn
 * of a thread with no agent reference carries the project's North Star and
 * standing rules, the member's own open drafts and what stands against them;
 * every later turn is the message alone, unless it names an image. What sheds
 * and what never sheds is `threadTurnInput`'s rule, and an input that will not
 * fit without shedding one of the project's two texts, or the images section,
 * is refused rather than quietly shortened.
 *
 * AN IMAGE IS CHECKED AGAINST THIS PROJECT'S OWN ARTIFACTS BEFORE THE TURN IS
 * COMPOSED, by `threadMessageImages`: an identity this project never wrote and
 * one another project's upload minted both refuse the whole message, because
 * which of the two it was is not this door's to say.
 */

import {
  agenticRefusalsAnsweredMax,
  nativeHttpPageItemsMax,
  textCodePointsCount,
  threadMessageCharsMax,
  threadMessageImagesMax,
  threadOpenKeyCharsMax,
  threadOpenKeyPattern,
  threadTitleCharsMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
} from "../contract/http.ts";
import type { PlacementRoute } from "../contract/rosters.ts";
import { resolvedThreadStandingRules } from "../contract/threadSeeding.ts";
import type {
  SessionId,
  SessionScope,
  SessionState,
  SessionTurnFailure,
  SessionTurnId,
  SessionTurnInputKind,
  SessionTurnMeasured,
  SessionTurnState,
} from "./agentSession.ts";
import {
  asProjectArtifactId,
  type ProjectArtifactPort,
} from "./finalizerPreparation.ts";
import type { Authority } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import type { Partition, ProjectId, TenantId } from "./projectStore.ts";
import { projectArtifactFetched } from "./projectArtifact.ts";
import type { PublicInstant } from "./publicResource.ts";
import type { SessionStoreStreamRow } from "./sessionPlane.ts";
import {
  threadStanding,
  type ThreadProjectTexts,
  type ThreadSeededDraft,
  type ThreadSeededImage,
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
  readonly state: SessionState;
  readonly turns: number;
  readonly agentReference?: string;
  /**
   * The head of the earliest message a member put in this thread, as the
   * durable read bounds it, and absent until one has. It is what `threadTitle`
   * names the thread from and the only reason either read carries it.
   */
  readonly firstMessage?: string;
  /** What its member called it, which overrides the derived title. */
  readonly memberTitle?: string;
  readonly openedAt: PublicInstant;
  /** The latest of its opening, its turns' instants and its close. */
  readonly lastActivityAt: PublicInstant;
  /** Off its owner's rail. Nothing is deleted, so it is still listed and still readable. */
  readonly hidden: boolean;
}

/**
 * One of a member's own threads wherever it is kept: a project's, named by its
 * project, or their own, named by their reserved partition.
 */
export interface MemberThreadRecord extends ThreadRecord {
  readonly project: ProjectId;
  readonly scope: SessionScope;
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

declare const threadOpenKeyBrand: unique symbol;

/** The key a client opens a thread under, which opening is idempotent on. */
export type ThreadOpenKey = string & { readonly [threadOpenKeyBrand]: true };

/** Brands an open key, refusing one the wire would refuse. */
export function asThreadOpenKey(value: string): ThreadOpenKey {
  if (
    value.length === 0 ||
    textCodePointsCount(value) > threadOpenKeyCharsMax ||
    !threadOpenKeyPattern.test(value)
  )
    throw new RangeError(
      `a thread open key is between 1 and ${String(threadOpenKeyCharsMax)} letters, digits, hyphens and underscores`,
    );
  return value as ThreadOpenKey;
}

/**
 * What opening a member's thread answered: the key's thread is open now, the
 * key already opened one, or the member holds as many open as their limit. The
 * last carries the limit, so the member is told what they ran into.
 */
export type ThreadOpened =
  | {
      readonly opened: "Opened" | "AlreadyOpen";
      readonly thread: ThreadRecord;
    }
  | { readonly opened: "ThreadLimitReached"; readonly threadsMax: number };

/**
 * What closing a thread answered: it is closed now, it already was, or the
 * session named is not this project's thread at all. The two closed arms carry
 * the record as it stands after the door, so a caller is answered the thread
 * it closed rather than sent to read it again.
 */
export type ThreadClosed =
  | {
      readonly closed: "Closed" | "AlreadyClosed";
      readonly thread: ThreadRecord;
    }
  | { readonly closed: "NoThread" };

/**
 * What renaming answered, with the record as it stands after the door for the
 * reason the close arms carry one. A rename is idempotent: a title already held
 * is `Renamed` and writes nothing.
 */
export type ThreadRenamed =
  | { readonly renamed: "Renamed"; readonly thread: ThreadRecord }
  | { readonly renamed: "NoThread" };

/**
 * What hiding answered, naming the side the thread is now on rather than
 * whether this call moved it: a rail pressing Hide twice asked for a hidden
 * thread both times.
 */
export type ThreadHidden =
  | { readonly hidden: "Hidden" | "Shown"; readonly thread: ThreadRecord }
  | { readonly hidden: "NoThread" };

/**
 * What the stop door's durable half answered: `Stopped` is a turn that was
 * waiting or being answered and is ended by this call, and `AlreadyEnded` one
 * that had ended, however it ended. `NoThread`, `NotYourThread` and `Closed`
 * are the message door's own, answered before the turn is looked at, and
 * `NoTurn` is a thread that holds no such turn.
 */
export type ThreadTurnStopped =
  | "Stopped"
  | "AlreadyEnded"
  | "NoThread"
  | "NotYourThread"
  | "Closed"
  | "NoTurn";

/**
 * What the message door's durable half answered. `NoThread`, `Closed` and
 * `Backlogged` are each a mailbox that takes no message, and they are separate
 * arms because a member whose thread is closed reopens it, a member whose
 * mailbox is full waits, and a session that is not a thread is neither.
 */
export type ThreadMessageEnqueued =
  | {
      readonly enqueued: "Enqueued" | "AlreadyEnqueued";
      readonly ordinal: number;
    }
  | {
      readonly enqueued: "NoThread" | "NotYourThread" | "Closed" | "Backlogged";
    };

/**
 * The durable thread authority: the listing, the door that opens one, the
 * standing read, the door a message goes through and the door that closes one.
 * `open` TAKES NO ROSTER AND NO LIMIT and `close` TAKES NO PRINCIPAL, and each
 * omission is the control — the definer writes the roster and reads the
 * member's limit itself so an API talked into opening a thread can neither
 * widen one nor exceed the other, and any member who may mutate the project
 * may close any of its threads, so the close door refuses only a session that
 * is not a thread.
 */
export interface ThreadStore {
  /** One page of the project's threads, the reader's own open ones first so
   * none they hold falls off it. */
  threads(
    partition: Partition,
    reader: Principal,
    limit: number,
  ): Promise<readonly ThreadRecord[]>;
  open(input: {
    readonly partition: Partition;
    readonly principal: Principal;
    /** The identity the thread is opened under where the key has opened none. */
    readonly session: SessionId;
    readonly key: ThreadOpenKey;
    readonly systemPrompt: string;
    readonly credentialSlot: string;
  }): Promise<ThreadOpened>;
  /**
   * Opens one of the principal's own threads in their reserved partition,
   * which draws no capacity and holds `MemberRead` alone; `partition` is that
   * partition, the opened thread being read back there.
   */
  openUnscoped(input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly session: SessionId;
    readonly key: ThreadOpenKey;
    readonly systemPrompt: string;
    readonly credentialSlot: string;
  }): Promise<ThreadOpened>;
  /** One page of the principal's own threads across the tenant, open ones and the latest first. */
  memberThreads(input: {
    readonly tenant: TenantId;
    readonly principal: Principal;
    readonly limit: number;
  }): Promise<readonly MemberThreadRecord[]>;
  /** One thread's standing, or nothing where the session is not this project's own thread. */
  standing(input: {
    readonly partition: Partition;
    readonly session: SessionId;
    readonly query: ThreadMailboxQuery;
  }): Promise<ThreadStandingRecord | undefined>;
  /** Refuses a session that is not one of the principal's own threads, in the transaction that would enqueue. */
  enqueueMessage(input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly session: SessionId;
    readonly turn: SessionTurnId;
    readonly input: string;
    /** The route the turn was admitted on, which it keeps whatever the thread's route becomes. */
    readonly route: PlacementRoute;
  }): Promise<ThreadMessageEnqueued>;
  /**
   * Ends one waiting or claimed turn of an open thread of the principal's, and
   * tells the thread's readers its stream ended. It takes the principal
   * because the definer is what holds a stop to the caller's own thread, in
   * the transaction that ends the turn.
   */
  stopTurn(input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly session: SessionId;
    readonly turn: SessionTurnId;
  }): Promise<ThreadTurnStopped>;
  /** Closes the thread named, abandoning the turns it still held; a closed thread stays readable. */
  close(input: {
    readonly partition: Partition;
    readonly session: SessionId;
  }): Promise<ThreadClosed>;
  /** Names the thread; an empty title clears the member's name and leaves the derived one. */
  rename(input: {
    readonly partition: Partition;
    readonly session: SessionId;
    readonly title: string;
  }): Promise<ThreadRenamed>;
  /** Takes the thread off its owner's rail, or puts it back; nothing is deleted. */
  hide(input: {
    readonly partition: Partition;
    readonly session: SessionId;
    readonly hidden: boolean;
  }): Promise<ThreadHidden>;
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
 * What a thread's first turn is seeded from, the project's two texts asked for
 * as themselves rather than as the whole resolved record so the composition
 * answering it cannot hand a thread the lead's prompt or its limits by
 * accident. The drafts and the refusals — migration 061's read and 059's — are
 * filtered to the member the block is for, which is why an authority rather
 * than a principal is what they take.
 */
export interface ThreadSeedingRead {
  /** The overrides as the project holds them; the precedence is the interpreter's. */
  projectTexts(partition: Partition): Promise<ThreadProjectTexts>;
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
  /** What the thread is about, absent until a member has named it or said something in it. */
  readonly title?: string;
  readonly openedAt: PublicInstant;
  readonly lastActivityAt: PublicInstant;
  readonly hidden: boolean;
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

/** What opening a thread of mine answered, and which of the two the wire reports as created. */
export type ThreadOpening =
  | { readonly result: "NotFound" }
  | { readonly result: "HostedRunsNotGranted" }
  | { readonly result: "NoRunner" }
  | { readonly result: "ThreadLimitReached"; readonly threadsMax: number }
  | {
      readonly result: "Opened" | "AlreadyOpen";
      readonly thread: ThreadEntry;
    };

/**
 * What closing a thread answered, and which of the two the wire reports as
 * done now. A session that is no thread of this project's is `NotFound`, as
 * every thread read answers it.
 */
export type ThreadClosing =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Closed" | "AlreadyClosed";
      readonly thread: ThreadEntry;
    };

/**
 * What naming a thread answered, and the entry as it now reads.
 * `NotYourThread` is a thread of another member's, as the message door's is.
 */
export type ThreadRenaming =
  | { readonly result: "NotFound" }
  | { readonly result: "NotYourThread" }
  | { readonly result: "Renamed"; readonly thread: ThreadEntry };

/**
 * What hiding a thread answered: which side of the rail it is now on.
 * `NotYourThread` is a thread of another member's, as the message door's is.
 */
export type ThreadHiding =
  | { readonly result: "NotFound" }
  | { readonly result: "NotYourThread" }
  | { readonly result: "Hidden" | "Shown"; readonly thread: ThreadEntry };

/**
 * What the message door answered. `NotYourThread` is a thread of another
 * member's, and it is deliberately not `NotFound`: a member may read
 * every thread this project holds, so hiding one they may already list would
 * tell them nothing they cannot see and would hide which refusal they met.
 */
export type ThreadMessageSent =
  | { readonly result: "NotFound" }
  | { readonly result: "NotYourThread" }
  | { readonly result: "Closed" }
  /** The tenant does not grant the caller hosted runs, which the turn would spend. */
  | { readonly result: "HostedRunsNotGranted" }
  /** The turn would be offered to the caller's personal runner, and they have none serving the project. */
  | { readonly result: "NoRunner" }
  /** The first turn's seeding block and the message will not fit one turn together. */
  | { readonly result: "TooLarge"; readonly charsMax: number }
  | { readonly result: "Backlogged"; readonly retryAfterSeconds: number }
  /** An image the message named is not an artifact this project holds. */
  | { readonly result: "ImageUnknown" }
  /** The project's own artifact store could not answer whether an image named is one of this project's. */
  | { readonly result: "ImagesUnavailable"; readonly retryAfterSeconds: number }
  | {
      readonly result: "Sent" | "AlreadySent";
      readonly turn: SessionTurnId;
      readonly ordinal: number;
    };

/**
 * What the stop door answered. A thread or a turn the project does not hold is
 * `NotFound`, and `NotYourThread` and `Closed` are the message door's own
 * refusals, read before the turn is looked at.
 */
export type ThreadTurnStopping =
  | { readonly result: "NotFound" }
  | { readonly result: "NotYourThread" }
  | { readonly result: "Closed" }
  | { readonly result: "Stopped" | "AlreadyEnded" };

/** What the durable stop answered, as the door answers it. */
export function threadTurnStopping(
  stopped: ThreadTurnStopped,
): ThreadTurnStopping {
  return stopped === "NoThread" || stopped === "NoTurn"
    ? { result: "NotFound" }
    : { result: stopped };
}

/** What the durable enqueue answered, as the door answers it. */
export function threadMessageSent(
  enqueued: ThreadMessageEnqueued,
  turn: SessionTurnId,
): ThreadMessageSent {
  switch (enqueued.enqueued) {
    case "NoThread":
      return { result: "NotFound" };
    case "NotYourThread":
      return { result: "NotYourThread" };
    case "Closed":
      return { result: enqueued.enqueued };
    case "Backlogged":
      return {
        result: "Backlogged",
        retryAfterSeconds: threadBacklogRetrySeconds,
      };
    case "Enqueued":
    case "AlreadyEnqueued":
      return {
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

/**
 * The title cut from what a member said: the first non-empty line, run onto one
 * line and bounded to `threadTitleCharsMax` code points.
 */
function threadTitleDerived(firstMessage: string): string | undefined {
  const line = firstMessage
    .split("\n")
    .map((each) => each.trim())
    .find((each) => each.length > 0);
  if (line === undefined) return undefined;
  const collapsed = line.replace(/\s+/gu, " ");
  const title = [...collapsed].slice(0, threadTitleCharsMax).join("").trimEnd();
  if (textCodePointsCount(title) > threadTitleCharsMax)
    throw new RangeError("a thread title is cut to its bound");
  return title;
}

/**
 * What a thread is called: the name its member gave it where they gave one,
 * else the title derived from the first message they put in it. A thread nobody
 * has named or written in has none, and a caller names it as it was named
 * before.
 */
export function threadTitle(named: {
  readonly memberTitle?: string;
  readonly firstMessage?: string;
}): string | undefined {
  if (named.memberTitle !== undefined) return named.memberTitle;
  return named.firstMessage === undefined
    ? undefined
    : threadTitleDerived(named.firstMessage);
}

/**
 * One record as the wire names it, with the reader's own principal deciding
 * `mine`. `owner` is the authority its principal acts under and is passed in
 * because it is the project authority's answer rather than the store's.
 */
export function threadEntry(
  record: ThreadRecord,
  principal: Principal,
  owner: string | undefined,
): ThreadEntry {
  const title = threadTitle(record);
  return {
    session: record.session,
    ...(owner === undefined ? {} : { owner }),
    state: threadStanding({ state: record.state, owner }),
    mine: record.principal === principal,
    turns: record.turns,
    ...(record.agentReference === undefined
      ? {}
      : { agentReference: record.agentReference }),
    ...(title === undefined ? {} : { title }),
    openedAt: record.openedAt,
    lastActivityAt: record.lastActivityAt,
    hidden: record.hidden,
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
  if (textCodePointsCount(message) > threadMessageCharsMax)
    throw new RangeError(
      `a thread message must be at most ${String(threadMessageCharsMax)} characters`,
    );
  return message;
}

/**
 * The images a message names, as the door accepts them. The schema at the
 * boundary bounds the count too; this is the bound for every other caller of
 * the door, for `checkedThreadMessage`'s own reason.
 */
export function checkedThreadMessageImages(
  images: readonly string[],
): readonly string[] {
  if (images.length > threadMessageImagesMax)
    throw new RangeError(
      `a thread message names at most ${String(threadMessageImagesMax)} images`,
    );
  return images;
}

/** What checking a message's named images against this project's own artifacts came to. */
export type ThreadMessageImagesChecked =
  | {
      readonly checked: "Images";
      readonly images: readonly ThreadSeededImage[];
    }
  | { readonly checked: "Unknown" }
  | { readonly checked: "Unavailable"; readonly retryAfterSeconds: number };

/**
 * Each image a message named, checked against this project's own artifacts and
 * turned into what the turn names: its identity and media type. `NotFound`
 * folds an artifact never written and one another project's upload minted, for
 * `projectArtifactFetched`'s own reason — a member naming either is refused the
 * same way, without being told which.
 */
export async function threadMessageImages(
  store: ProjectArtifactPort,
  partition: Partition,
  images: readonly string[],
): Promise<ThreadMessageImagesChecked> {
  const named: ThreadSeededImage[] = [];
  for (const raw of images) {
    const artifact = asProjectArtifactId(raw);
    const fetched = await projectArtifactFetched(store, partition, artifact);
    if (fetched.fetched === "NotFound") return { checked: "Unknown" };
    if (fetched.fetched === "Unavailable")
      return {
        checked: "Unavailable",
        retryAfterSeconds: fetched.retryAfterSeconds,
      };
    named.push({ artifact, mediaType: fetched.mediaType });
  }
  return { checked: "Images", images: named };
}

/**
 * What a thread's first turn is seeded with: the project's North Star, its
 * standing rules, the member's own open drafts, and the standing refusals
 * against exactly those drafts. The refusals are asked for by ticket rather
 * than read whole, because a refusal against work this member never authored is
 * not their business on their first turn.
 */
export async function threadSeeding(
  seeding: ThreadSeedingRead,
  partition: Partition,
  author: Authority,
): Promise<ThreadSeeding> {
  const texts = await seeding.projectTexts(partition);
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
    ...(texts.northStar === undefined ? {} : { northStar: texts.northStar }),
    standingRules: resolvedThreadStandingRules(texts.standingRules),
    drafts,
    refusals,
  };
}
