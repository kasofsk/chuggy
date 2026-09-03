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
 * A GATHERED SET MEANS NOTHING WITHOUT THE SEAM IT SITS BEHIND. Everything a
 * walk gathers is strictly below one boundary — the newest read's own cursor at
 * the moment the walk began — so a newest read whose cursor has moved is a read
 * that set no longer abuts, and `ThreadOlder.seam` is that boundary carried.
 * The field is absent exactly while nothing has been gathered, which is why "is
 * this walk started" is one field being present rather than a flag beside it
 * that can disagree with the turns.
 *
 * ORDER IS THE CONSTRUCTION'S AND NOT A SORT. Each older page is prepended
 * whole and the newest read appended, so what `threadTurnsDrawn` returns is
 * already the mailbox's sequence and a sort over it would be a control that has
 * never had anything to correct. A turn in both is the later read's: the newest
 * page is re-read on a `Session` frame while a gathered page is not, so the copy
 * that moved from `Queued` to `Answered` is the one worth drawing, and it keeps
 * the place its first copy had.
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
import type {
  SessionTurnFailure,
  SessionTurnInputKind,
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

/** The reader's own thread, where the listing carried one. */
export function threadMine(
  threads: readonly ThreadEntryResponse[],
): ThreadEntryResponse | undefined {
  return threads.find((thread) => thread.mine);
}

/**
 * What a turn is waiting for, or what it ended with. Total over the turn states
 * the wire has: A TURN THAT HAS NOT BEEN ANSWERED DRAWS NO ANSWER BLOCK, because
 * an empty answer block reads as an answer of nothing, which is a claim the page
 * has no grounds to make about a turn still in the mailbox.
 */
export type ThreadAnswer =
  | { readonly answer: "Awaiting" }
  | { readonly answer: "Result"; readonly text: string }
  | { readonly answer: "Failure"; readonly failure: SessionTurnFailure }
  | { readonly answer: "None" };

export function threadTurnAnswer(turn: ThreadTurnResponse): ThreadAnswer {
  switch (turn.state) {
    case "Queued":
    case "Claimed":
      return { answer: "Awaiting" };
    case "Answered":
    case "Failed":
    case "Abandoned":
      if (turn.result !== undefined)
        return { answer: "Result", text: turn.result };
      return turn.failure === undefined
        ? { answer: "None" }
        : { answer: "Failure", failure: turn.failure };
  }
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

/**
 * The most turns one page holds while a reader walks backwards, past which it
 * stops offering older ones. Dropping what it holds instead would be a page
 * that loses the top of the conversation as the reader reaches for it.
 */
export const threadTurnsHeldMax = 400;

/** One walk backwards through a mailbox: what it has gathered, the cursor the
 * next page is asked for, the seam it was all gathered behind, and what the
 * last read failed with. */
export interface ThreadOlder {
  readonly turns: readonly ThreadTurnResponse[];
  readonly before: number | undefined;
  readonly seam: number | undefined;
  readonly failure: string | undefined;
}

export const threadOlderEmpty: ThreadOlder = {
  turns: [],
  before: undefined,
  seam: undefined,
  failure: undefined,
};

/**
 * One older page gathered, behind the boundary the walk began at. The page's
 * own `nextBefore` becomes the cursor and its absence is the mailbox's first
 * turn, which is why the cursor and the turns are one value and not two pieces
 * of state that can disagree about whether there is more.
 */
export function threadOlderGathered(
  older: ThreadOlder,
  page: Pick<ThreadResponse, "turns" | "nextBefore">,
  newest: Pick<ThreadResponse, "nextBefore">,
): ThreadOlder {
  return {
    turns: [...page.turns, ...older.turns],
    before: page.nextBefore,
    seam: older.seam ?? newest.nextBefore,
    failure: undefined,
  };
}

/**
 * The gathered set a reader may still be shown, and nothing where the newest
 * read has slid past the seam it was gathered behind. Dropping it is the
 * discipline `leadTranscriptStep` takes on a compaction that moved: a set
 * gathered against a boundary that no longer exists cannot be drawn beside the
 * read that replaced it, and the union of two ranges that do not meet is a
 * conversation with a turn missing from the middle of it.
 */
export function threadOlderHeld(
  older: ThreadOlder,
  newest: Pick<ThreadResponse, "nextBefore">,
): ThreadOlder {
  if (older.seam === undefined) return older;
  return newest.nextBefore === older.seam ? older : threadOlderEmpty;
}

/**
 * The cursor an older page is asked for with, and nothing where there is none
 * to ask for or the page already holds what it will hold. A walk that has
 * gathered nothing asks from the newest read's own cursor, and one that has
 * follows its own — the seam says which, because a page answered with a cursor
 * and no turns has still moved the walk.
 */
export function threadOlderAsked(
  older: ThreadOlder,
  newest: Pick<ThreadResponse, "turns" | "nextBefore">,
): number | undefined {
  if (threadTurnsDrawn(older, newest).length >= threadTurnsHeldMax)
    return undefined;
  return older.seam === undefined ? newest.nextBefore : older.before;
}

/** Every turn the page holds, each once, oldest first, and a turn in both
 * pages as the later read has it. */
export function threadTurnsDrawn(
  older: ThreadOlder,
  newest: Pick<ThreadResponse, "turns">,
): readonly ThreadTurnResponse[] {
  const held = new Map<string, ThreadTurnResponse>();
  for (const turn of [...older.turns, ...newest.turns])
    held.set(turn.turn, turn);
  return [...held.values()];
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

/**
 * The word one of the door's refusals is drawn as, the codes it states mapped
 * to the noun a reader already knows and anything else drawn as the code the
 * server sent — which is a fallback rather than a roster, so a refusal the door
 * grows says its own name instead of nothing.
 */
/**
 * The code the door raises where the session in the URL is not the mailbox the
 * caller's own principal resolves to. It is named because the console acts on
 * it rather than only reporting it.
 */
export const threadNotYourThreadCode = "NotYourThread";

/** Whether the mailbox tail a read answered already holds this turn, which is
 * the only thing that settles a refusal the door may have raised after
 * enqueuing. */
export function threadHeldTurn(
  thread: Pick<ThreadResponse, "turns">,
  turn: string,
): ThreadTurnResponse | undefined {
  return thread.turns.find((held) => held.turn === turn);
}

export function threadRefusalWord(code: string): string {
  const said: Readonly<Record<string, string>> = {
    ThreadBacklogged: "Backlogged",
    ThreadClosed: "Closed",
    ThreadOrphaned: "Orphaned",
  };
  return said[code] ?? code;
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
      return result.code === threadNotYourThreadCode
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
