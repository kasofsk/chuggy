/**
 * What the thread pages draw, derived: where a thread stands, which one is the
 * reader's own, what a turn is waiting for, what a wake is about, and what one
 * press of `Send` ended as.
 *
 * `mine` IS THE SERVER'S ANSWER AND NEVER THIS BROWSER'S. Nothing under
 * `ui/chuggy-ui/` names a principal, a subject or a user — the session module
 * holds two opaque tokens and decodes neither — so "my thread" is a question
 * only the API can be asked, and every derivation here reads the field it
 * answered rather than working it out.
 *
 * `Orphaned` IS A WORD THE WIRE CARRIES AND NOT ONE DERIVED HERE. `state` is
 * `threadStandings`, so an open session whose owner's membership is gone —
 * still acting, as a person who is no longer a member — is answered as itself.
 * A console that folded `state` and `owner` again would be a second account of
 * a standing the server already decided, and the two would disagree the first
 * time either moved.
 *
 * A WAKE DOCUMENT IS READ FOR ITS POINTER AND NOTHING ELSE. Its `standing` is
 * an instruction to the agent, not copy for a reader, and its raw JSON is not
 * the turn a member typed; so what is taken from it is the reason and the
 * resource, and a document those cannot be found in draws as a bare `Wake`
 * rather than as its own text. Nothing here checks the reason against a roster:
 * the roster lives in the interpreter, a reason is already a noun, and a
 * console that refused an unfamiliar one would answer a wake it could plainly
 * name with silence.
 *
 * A DOOR THAT WILL TAKE NO MORE MESSAGES ENDS THE COMPOSER WHICHEVER REFUSAL
 * IT IS, and the envelope's code is what says which. `ThreadClosed` and
 * `ThreadOrphaned` are both a thread that takes no more, and a console holding
 * its own roster of the door's refusals would answer the next one the door
 * grows by drawing nothing — so the two the wire has get the standing word they
 * belong to and anything else is drawn as the code the server sent.
 *
 * EVERY CODE THIS CONSOLE NAMES IS THE DOOR'S OWN ROSTER MEMBER.
 * `threadMessageRefusalCodes` is every code the message door emits, and both
 * things this module does with one go through it: the settlement narrows
 * `NotYourThread` rather than comparing a literal, and the words are a switch
 * total over the roster. So a door that renamed a code stops this module
 * compiling instead of leaving a member told their message was refused for a
 * turn the mailbox already holds. A code the roster does not carry is drawn as
 * itself, which is what the fallback is for.
 *
 * A `NotYourThread` IS NOT PROOF THE MESSAGE DID NOT LAND. The door resolves
 * the mailbox from the caller's own principal and compares the URL's session
 * afterwards, so in the close-and-reopen race the refusal can arrive after the
 * turn was enqueued in the mailbox that resolved. It is therefore `Unsettled`
 * rather than `Refused`: the turn identity is kept, the mailbox is asked, and
 * only a mailbox that does not hold the turn is sent to again — under the same
 * identity, which is what makes that second send safe.
 *
 * A WAIT IS NOT A REFUSAL AND A `Retryable` IS NOT ALWAYS A BACKLOG. `classify`
 * answers `Retryable` for 429 AND 503, so an outage would draw as a mailbox
 * that is full; the code is carried and drawn for the same reason it is on a
 * conflict.
 *
 * A TURN IDENTITY BELONGS TO THE TEXT IT WAS MINTED FOR. Enqueuing is
 * idempotent on the turn, so re-pressing after a mailbox said `Backlogged` must
 * reuse the identity or risk a second copy of one message; and posting EDITED
 * text under a retained identity would answer the ordinal the first text
 * already has, so the reader would be told their correction landed when the
 * mailbox still holds what they corrected.
 */

import { z } from "zod";

import { identitySchema } from "../../../../src/contract/http.ts";
import type {
  ThreadEntryResponse,
  ThreadMessageAccepted,
  ThreadResponse,
  ThreadTurnResponse,
} from "../../../../src/contract/responses.ts";
import { threadMessageRefusalCodes } from "../../../../src/contract/rosters.ts";
import type {
  SessionTurnInputKind,
  ThreadMessageRefusalCode,
} from "../../../../src/contract/rosters.ts";
import type { ApiResult } from "./apiRequest.ts";
import { base64urlFromBytes } from "./base64url.ts";
import { panelReason } from "./freshness.ts";

/** Whether a thread still takes messages, which is the one standing that does. */
export function threadTakesMessages(
  thread: Pick<ThreadEntryResponse, "state">,
): boolean {
  return thread.state === "Open";
}

/** Whether a thread can still be closed, which every standing but `Closed` can:
 * an orphaned thread still acts, and is the one most worth ending. */
export function threadClosable(
  thread: Pick<ThreadEntryResponse, "state">,
): boolean {
  return thread.state !== "Closed";
}

/** A thread's own label, wherever one is drawn: its title, or `New thread`
 * before it has one. */
export function threadLabel(
  thread: Pick<ThreadEntryResponse, "title">,
): string {
  return thread.title ?? "New thread";
}

/**
 * The word one turn's kind is drawn as, total over the wire's roster so a kind
 * it grows stops compiling here. `UserMessage` is what the mailbox calls a
 * member's own turn and `Message` is what a member calls it; the two the thread
 * door cannot produce are named rather than defaulted, because a default is how
 * a kind nobody drew reaches a reader as the wrong noun.
 */
export function threadTurnKindWord(kind: SessionTurnInputKind): string {
  switch (kind) {
    case "UserMessage":
      return "Message";
    case "Wake":
      return "Wake";
    case "Observation":
      return "Observation";
    case "Inquiry":
      return "Inquiry";
  }
}

/** The reader's own thread first and the rest in the order the listing gave
 * them, which is a stable partition rather than a re-ordering of the page. */
export function threadsMineFirst(
  threads: readonly ThreadEntryResponse[],
): readonly ThreadEntryResponse[] {
  return [
    ...threads.filter((thread) => thread.mine),
    ...threads.filter((thread) => !thread.mine),
  ];
}

/** The reader's own thread that still stands, where the listing carried one:
 * a closed thread of theirs is one they open another beside, so it is not the
 * one an `Open` is withheld for or a message is settled against. */
export function threadMine(
  threads: readonly ThreadEntryResponse[],
): ThreadEntryResponse | undefined {
  return threads.find((thread) => thread.mine && thread.state !== "Closed");
}

/** Whether a thread has a turn the mailbox has not settled, which is what
 * makes closing it a real abandonment rather than a formality. */
export function threadAnswering(
  thread: Pick<ThreadResponse, "turns">,
): boolean {
  return thread.turns.some(
    (turn) => turn.state === "Queued" || turn.state === "Claimed",
  );
}

export const threadOwnerFilters = ["Mine", "Everyone"] as const;
export type ThreadOwnerFilter = (typeof threadOwnerFilters)[number];

export const threadStandingFilters = ["Open", "Closed", "Hidden"] as const;
export type ThreadStandingFilter = (typeof threadStandingFilters)[number];

/** Whether a row belongs in one of the Threads page's standing filters.
 * `Hidden` is a bucket of its own rather than a flag over the other two, so a
 * thread its owner hid stops appearing under `Open` or `Closed` the moment it
 * is. */
function threadMatchesStanding(
  thread: ThreadEntryResponse,
  standing: ThreadStandingFilter,
): boolean {
  switch (standing) {
    case "Open":
      return !thread.hidden && thread.state !== "Closed";
    case "Closed":
      return !thread.hidden && thread.state === "Closed";
    case "Hidden":
      return thread.hidden;
  }
}

/**
 * The Threads page's own rows: a thread its owner hid is only ever offered
 * back to its owner, so the `Hidden` standing forces `Mine` whatever the
 * owner chip reads — a stranger's archived thread is not this reader's to
 * restore.
 */
export function threadPageRows(
  threads: readonly ThreadEntryResponse[],
  owner: ThreadOwnerFilter,
  standing: ThreadStandingFilter,
): readonly ThreadEntryResponse[] {
  const owned =
    owner === "Everyone" && standing !== "Hidden"
      ? threads
      : threads.filter((thread) => thread.mine);
  return threadsMineFirst(
    owned.filter((thread) => threadMatchesStanding(thread, standing)),
  );
}

/**
 * The two fields a wake document is drawn from. Unknown keys are dropped rather
 * than refused, so a document carrying more than this reads as the notice it is.
 */
const threadWakeDrawnSchema = z.object({
  wake: identitySchema,
  resource: identitySchema,
});

/** What one wake is about, and nothing where the input is not one. */
export interface ThreadWakeDrawn {
  readonly wake: string;
  readonly resource: string;
}

export function threadWakeDrawn(input: string): ThreadWakeDrawn | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return undefined;
  }
  const read = threadWakeDrawnSchema.safeParse(parsed);
  return read.success ? read.data : undefined;
}

/** How much entropy a thread turn identity is drawn with, which is what the
 * mailbox dedupes on and so what a retried post is safe by. */
export const threadTurnIdBytesCount = 16;

/** One minted turn identity, prefixed so a mailbox row says what door it came
 * through without anything having to join to find out. */
export function threadTurnMinted(bytes: Uint8Array): string {
  return `thread-turn-${base64urlFromBytes(bytes)}`;
}

/** The turn a press posts under: the one the last press minted where the text
 * is unchanged, and nothing — so the caller mints — where it is not. */
export function threadTurnRetained(
  held: { readonly text: string; readonly turn: string } | undefined,
  text: string,
): string | undefined {
  return held !== undefined && held.text === text ? held.turn : undefined;
}

/** Where one press of `Send` got to. */
export type ThreadSend =
  | { readonly send: "Idle" }
  | { readonly send: "Sending" }
  | { readonly send: "Sent"; readonly ordinal: number }
  | { readonly send: "Waiting"; readonly why: string }
  | { readonly send: "Ended"; readonly why: string }
  | { readonly send: "Unsettled"; readonly why: string }
  | { readonly send: "Refused"; readonly reason: string };

/** Whether the mailbox tail a read answered already holds this turn, which is
 * the only thing that settles a refusal the door may have raised after
 * enqueuing. */
export function threadHeldTurn(
  thread: Pick<ThreadResponse, "turns">,
  turn: string,
): ThreadTurnResponse | undefined {
  return thread.turns.find((held) => held.turn === turn);
}

/**
 * The refusal the door's own roster carries, and nothing where a code came back
 * that it does not — a code this console reports rather than acts on or names.
 */
export function threadRefusalCode(
  code: string,
): ThreadMessageRefusalCode | undefined {
  return threadMessageRefusalCodes.find((known) => known === code);
}

/** The word one code the roster carries is drawn as, total over it so a code
 * the roster renames or grows stops compiling here. */
function threadRosterWord(code: ThreadMessageRefusalCode): string {
  switch (code) {
    case "NotYourThread":
      return "Elsewhere";
    case "ThreadClosed":
      return "Closed";
    case "ThreadOrphaned":
      return "Orphaned";
    case "ThreadBacklogged":
      return "Backlogged";
    case "ThreadTurnTooLarge":
      return "Oversize";
  }
}

/** The word a refusal is drawn as: the roster's own, or the code the server sent
 * where the roster does not carry it. */
export function threadRefusalWord(code: string): string {
  const known = threadRefusalCode(code);
  return known === undefined ? code : threadRosterWord(known);
}

/**
 * One post, classified. A wait and an ended thread are each drawn as the word
 * the door's own code names, and neither is a fault the reader can press
 * through; everything else is one refusal carrying its reason.
 */
export function threadSendFrom(
  result: ApiResult<ThreadMessageAccepted>,
): ThreadSend {
  switch (result.outcome) {
    case "Ok":
      return { send: "Sent", ordinal: result.value.ordinal };
    case "Retryable":
      return { send: "Waiting", why: threadRefusalWord(result.code) };
    case "Conflict":
      return { send: "Ended", why: threadRefusalWord(result.code) };
    case "Rejected":
      return threadRefusalCode(result.code) === "NotYourThread"
        ? { send: "Unsettled", why: threadRefusalWord(result.code) }
        : { send: "Refused", reason: panelReason(result) };
    case "Absent":
    case "Unauthenticated":
    case "Fault":
    case "Unreachable":
    case "Unreadable":
      return { send: "Refused", reason: panelReason(result) };
  }
}
