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
 * `Orphaned` IS A DERIVATION AND THE WIRE HAS NO WORD FOR IT. The listing
 * answers `state` from the session row and `owner` from the membership joined
 * to it, and the pair an administrator has to see is an open session whose
 * owner's membership is gone: it still acts, and the person it acts as is no
 * longer a member. `src/interpreter/thread.ts` derives the same standing for
 * the routes; the console cannot reach that module — a browser is served
 * nothing outside `ui/` but the contract — so the rule is written twice and
 * `test/ui/threadStanding.test.ts` holds the two total and equal.
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
  ThreadTurnResponse,
} from "../../../../src/contract/responses.ts";
import type { SessionTurnFailure } from "../../../../src/contract/rosters.ts";
import type { ApiResult } from "./apiRequest.ts";
import { base64urlFromBytes } from "./base64url.ts";
import { panelReason } from "./freshness.ts";

/** Where one thread stands, which is its session's state unless its owner is gone. */
export const threadStandings = ["Open", "Closed", "Orphaned"] as const;

export type ThreadStanding = (typeof threadStandings)[number];

/**
 * An open thread whose owner has no membership left stands `Orphaned`, and
 * every other thread stands where its session does. A closed one is `Closed`
 * whatever became of its owner, because a session that takes no more turns
 * needs no owner and hiding that it is closed would be the wrong warning.
 */
export function threadStanding(
  thread: Pick<ThreadEntryResponse, "state" | "owner">,
): ThreadStanding {
  return thread.state === "Open" && thread.owner === undefined
    ? "Orphaned"
    : thread.state;
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

/** Where one press of `Send` got to. */
export type ThreadSend =
  | { readonly send: "Idle" }
  | { readonly send: "Sending" }
  | { readonly send: "Sent"; readonly ordinal: number }
  | { readonly send: "Backlogged"; readonly retryAfterSeconds: number }
  | { readonly send: "Closed" }
  | { readonly send: "Refused"; readonly reason: string };

/**
 * One post, classified. The three the message door states are drawn as
 * themselves and everything else is one refusal carrying its reason: a
 * backlogged mailbox is a wait, a closed thread is the end of the composer, and
 * neither is a fault the reader can do anything about by pressing again.
 */
export function threadSendFrom(
  result: ApiResult<ThreadMessageAccepted>,
): ThreadSend {
  switch (result.outcome) {
    case "Ok":
      return { send: "Sent", ordinal: result.value.ordinal };
    case "Retryable":
      return {
        send: "Backlogged",
        retryAfterSeconds: result.retryAfterSeconds,
      };
    case "Conflict":
      return { send: "Closed" };
    case "Absent":
    case "Unauthenticated":
    case "Rejected":
    case "Fault":
    case "Unreachable":
    case "Unreadable":
      return { send: "Refused", reason: panelReason(result) };
  }
}
