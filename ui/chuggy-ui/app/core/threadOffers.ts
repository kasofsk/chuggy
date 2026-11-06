/**
 * What a member's thread puts in front of them, read off its conversation: an
 * offer of a release or a revocation, drawn as a card the member confirms or
 * declines, and a page the console moves to.
 *
 * AN OFFER IS READ AS THE CONTRACT WRITES IT. A call is an offer only where
 * its arguments are the contract's own and the image did not refuse it, so a
 * card is never drawn of a call nothing could have done.
 *
 * THE REPLY IS THE CARD'S RECORD. A member's answer goes into the mailbox as
 * an `OfferReply` turn naming the call, so a card with one is settled on every
 * page and in every tab that reads that mailbox, and nothing this browser
 * keeps is asked. A read holds only the mailbox's newest turns, and a reply
 * is a later turn than the offer's, so a card whose own turn is not among
 * them cannot be told unanswered and offers nothing.
 *
 * A REPLY IS KEPT UNTIL THE MAILBOX TAKES IT. A confirmation's operation
 * settles before its reply is sent, and once it has the card's subject no
 * longer stands open; so the reply is kept in this browser as soon as there
 * is one, and let go only once the mailbox took it, and a card holding one
 * offers to send it again whatever its subject now says.
 *
 * A PAGE IS FOLLOWED ONCE, AND ONLY FROM WHERE IT WAS ASKED. A `navigate` in
 * the reader's own thread moves the console only while it is in the newest
 * exchange and the console still stands on the page the message it answers
 * was sent from; what this browser remembers is the calls it already followed,
 * so a reload or a second tab does not follow one again.
 */

import { z } from "zod";

import { consolePageSchema } from "../../../../src/contract/consolePage.ts";
import type { ConsolePage } from "../../../../src/contract/consolePage.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import type {
  DraftResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type { SessionTurnInputKind } from "../../../../src/contract/rosters.ts";
import { chuggyToolPrefix } from "../../../../src/contract/sessionTools.ts";
import {
  threadOfferReleaseSchema,
  threadOfferReplyRead,
  threadOfferReplySchema,
  threadOfferRevokeSchema,
} from "../../../../src/contract/threadOffers.ts";
import type { ThreadOfferReply } from "../../../../src/contract/threadOffers.ts";

import type { ConversationExchange, ConversationStep } from "./conversation.ts";
import type { OperationStep } from "./operationFollow.ts";
import type { KeyValuePort } from "./sessionHolder.ts";
import { ticketRevocable } from "./ticketActions.ts";

/** One offer a call made, by the call's identity. */
export type ThreadOfferCall =
  | {
      readonly offer: "Release";
      readonly call: string;
      readonly ticket: number;
      readonly authoringVersion: number;
    }
  | {
      readonly offer: "Revoke";
      readonly call: string;
      readonly ticket: number;
      readonly revision: number;
    };

/** A call the image took, which is one it has not answered or answered without refusing. */
function threadOfferCallTaken(
  step: ConversationStep,
): Extract<ConversationStep, { readonly step: "ToolCall" }> | undefined {
  if (step.step !== "ToolCall") return undefined;
  return step.result?.isError === true ? undefined : step;
}

/** The offer one step made, where it is one. */
export function threadOfferOf(
  step: ConversationStep,
): ThreadOfferCall | undefined {
  const taken = threadOfferCallTaken(step);
  if (taken === undefined) return undefined;
  if (taken.name === `${chuggyToolPrefix}offer_release`) {
    const read = threadOfferReleaseSchema.safeParse(taken.input);
    return read.success
      ? { offer: "Release", call: taken.id, ...read.data }
      : undefined;
  }
  if (taken.name === `${chuggyToolPrefix}offer_revoke`) {
    const read = threadOfferRevokeSchema.safeParse(taken.input);
    return read.success
      ? { offer: "Revoke", call: taken.id, ...read.data }
      : undefined;
  }
  return undefined;
}

/** The page one step asked the console to move to, where it is a `navigate` the image answered without refusing. */
export function threadNavigateOf(
  step: ConversationStep,
): { readonly call: string; readonly page: ConsolePage } | undefined {
  const taken = threadOfferCallTaken(step);
  if (
    taken === undefined ||
    taken.result === undefined ||
    taken.name !== `${chuggyToolPrefix}navigate`
  )
    return undefined;
  const read = consolePageSchema.safeParse(taken.input);
  return read.success ? { call: taken.id, page: read.data } : undefined;
}

/** The replies a mailbox page holds, by the call each answers; the first a
 * call was given stands. */
export function threadOfferReplies(
  turns: readonly {
    readonly inputKind: SessionTurnInputKind;
    readonly input?: string | undefined;
  }[],
): ReadonlyMap<string, ThreadOfferReply> {
  const replies = new Map<string, ThreadOfferReply>();
  for (const turn of turns) {
    if (turn.inputKind !== "OfferReply" || turn.input === undefined) continue;
    const reply = threadOfferReplyRead(turn.input);
    if (reply !== undefined && !replies.has(reply.call))
      replies.set(reply.call, reply);
  }
  return replies;
}

/** What a mailbox page says of one offer's reply: the reply it holds, none
 * where every turn after the offer's is on the page, and `Unread` where the
 * reply could be in an older page this one does not hold. */
export type ThreadOfferAnswer =
  | { readonly answer: "Replied"; readonly reply: ThreadOfferReply }
  | { readonly answer: "Unreplied" }
  | { readonly answer: "Unread" };

/** The answer a mailbox page gives one offer, made in the turn `turn` where
 * the page names the exchange's turn. */
export function threadOfferAnswerOf(
  page: {
    readonly turns: readonly { readonly turn: string }[];
    readonly nextBefore?: number | undefined;
  },
  replies: ReadonlyMap<string, ThreadOfferReply>,
  offered: { readonly call: string; readonly turn?: string | undefined },
): ThreadOfferAnswer {
  const reply = replies.get(offered.call);
  if (reply !== undefined) return { answer: "Replied", reply };
  if (page.nextBefore === undefined) return { answer: "Unreplied" };
  return page.turns.some((turn) => turn.turn === offered.turn)
    ? { answer: "Unreplied" }
    : { answer: "Unread" };
}

/**
 * Where one unanswered card stands against its subject: moved past the
 * version it was offered at, no longer one the action applies to, or open to
 * a confirmation.
 */
export type ThreadOfferStanding =
  | { readonly standing: "Superseded" }
  | { readonly standing: "Closed"; readonly why: string }
  | { readonly standing: "Open" };

/** A release offer against the draft as the project's cache holds it. */
export function threadOfferReleaseStanding(
  offer: Extract<ThreadOfferCall, { readonly offer: "Release" }>,
  draft: DraftResponse,
): ThreadOfferStanding {
  if (draft.state !== "Draft")
    return {
      standing: "Closed",
      why: `Draft ${String(draft.ticket)} is ${draft.state === "Released" ? "released" : "deleted"}`,
    };
  return draft.authoringVersion === offer.authoringVersion
    ? { standing: "Open" }
    : { standing: "Superseded" };
}

/** A revoke offer against the ticket as the project's cache holds it. */
export function threadOfferRevokeStanding(
  offer: Extract<ThreadOfferCall, { readonly offer: "Revoke" }>,
  ticket: TicketResponse,
): ThreadOfferStanding {
  if (!ticketRevocable(ticket.phase))
    return {
      standing: "Closed",
      why: `#${String(ticket.ticket)} is ${ticket.phase}`,
    };
  return ticket.revision === offer.revision
    ? { standing: "Open" }
    : { standing: "Superseded" };
}

/** The member's own operation a confirmation runs: the release of exactly the
 * authoring version offered, under the configuration the draft names. */
export function threadOfferReleaseMutation(
  offer: Extract<ThreadOfferCall, { readonly offer: "Release" }>,
  draft: DraftResponse,
): PublicMutation {
  if (draft.ticket !== offer.ticket)
    throw new RangeError("an offer is released from its own draft");
  return {
    mutation: "ReleaseDraft",
    ticket: offer.ticket,
    authoringVersion: offer.authoringVersion,
    configurationRevision: draft.configurationRevision,
  };
}

/** The member's own operation a confirmation runs: the revocation of the
 * ticket offered, refused by the writer once it moved past the revision
 * offered. */
export function threadOfferRevokeMutation(
  offer: Extract<ThreadOfferCall, { readonly offer: "Revoke" }>,
): PublicMutation {
  return {
    mutation: "RevokeTicket",
    ticket: offer.ticket,
    expectedRevision: offer.revision,
  };
}

/** What a reply carries of a code: one in the contract's spelling, or none. */
function threadOfferRefusalCode(code: string | undefined): string | undefined {
  return code !== undefined && /^[A-Za-z]{1,64}$/u.test(code)
    ? code
    : undefined;
}

/**
 * The confirmation's reply, from where following its operation ended: settled
 * as done, settled or declined by the API as refused, with the code it was
 * refused under, and any other ending as given up on.
 */
export function threadOfferConfirmed(
  call: string,
  step: OperationStep,
): ThreadOfferReply {
  if (step.step === "Settled") {
    if (step.state === "Succeeded")
      return { call, decision: "Confirmed", outcome: "Succeeded" };
    const refusal = threadOfferRefusalCode(step.refusal?.type);
    return {
      call,
      decision: "Confirmed",
      outcome: "Refused",
      ...(refusal === undefined ? {} : { refusal }),
    };
  }
  if (step.step === "Abandoned" && step.refused) {
    const failure =
      step.cause.type === "Failed" ? step.cause.failure : undefined;
    const refusal = threadOfferRefusalCode(
      failure !== undefined && "code" in failure ? failure.code : undefined,
    );
    return {
      call,
      decision: "Confirmed",
      outcome: "Refused",
      ...(refusal === undefined ? {} : { refusal }),
    };
  }
  return { call, decision: "Confirmed", outcome: "Unsettled" };
}

/** What a card says it offers. */
export function threadOfferSentence(offer: ThreadOfferCall): string {
  const ticket = `#${String(offer.ticket)}`;
  return offer.offer === "Release"
    ? `Release draft ${ticket} at version ${String(offer.authoringVersion)}`
    : `Revoke ${ticket} at revision ${String(offer.revision)}`;
}

/** What a settled card says became of it. */
export function threadOfferSettledSentence(
  offer: ThreadOfferCall,
  reply: ThreadOfferReply,
): string {
  if (reply.decision === "Declined") return "Declined";
  const done = offer.offer === "Release" ? "Released" : "Revoked";
  switch (reply.outcome) {
    case "Succeeded":
      return done;
    case "Refused":
      return reply.refusal === undefined
        ? `Not ${done.toLowerCase()} · Refused`
        : `Not ${done.toLowerCase()} · ${reply.refusal}`;
    case "Unsettled":
      return `Confirmed · ${done} or not, unseen`;
  }
}

export const threadOfferSupersededSentence =
  "Superseded · It changed since this was offered";

export const threadOfferUnreadSentence =
  "Not open here · Its reply would be older than the turns this page reads";

/** Whether two pages are the same page. */
function threadNavigatePagesAgree(a: ConsolePage, b: ConsolePage): boolean {
  return (
    JSON.stringify(a, Object.keys(a).sort()) ===
    JSON.stringify(b, Object.keys(b).sort())
  );
}

/** How many followed calls this browser remembers, the oldest let go first. */
export const threadNavigateAppliedMax = 64;

/**
 * The page the console moves to now, where one is due: the last `navigate`
 * of the newest exchange of the reader's own thread, not followed before,
 * while the console stands on the page the message that exchange answers was
 * sent from.
 */
export function threadNavigateDue(input: {
  readonly mine: boolean;
  readonly exchanges: readonly ConversationExchange[];
  readonly page: ConsolePage | undefined;
  readonly applied: readonly string[];
}): { readonly call: string; readonly page: ConsolePage } | undefined {
  const { page } = input;
  if (!input.mine || page === undefined) return undefined;
  const newest = input.exchanges.at(-1);
  const ask = newest?.ask;
  if (newest === undefined || ask?.ask !== "Message" || ask.page === undefined)
    return undefined;
  if (!threadNavigatePagesAgree(ask.page, page)) return undefined;
  const asked = newest.work.flatMap((step) => {
    const navigate = threadNavigateOf(step);
    return navigate === undefined ? [] : [navigate];
  });
  const last = asked.at(-1);
  if (last === undefined || input.applied.includes(last.call)) return undefined;
  return threadNavigatePagesAgree(last.page, page) ? undefined : last;
}

/** The calls followed, this one among them, the oldest let go past the bound. */
export function threadNavigateAppliedWith(
  applied: readonly string[],
  call: string,
): readonly string[] {
  const kept = [...applied.filter((held) => held !== call), call];
  return kept.slice(-threadNavigateAppliedMax);
}

/** Where this browser keeps the calls it followed, shared by its tabs. */
export const threadNavigateAppliedKey = "chuggy.threadNavigateApplied";

/** The calls this browser followed, none where what is kept is not a list
 * of them. */
export function threadNavigateAppliedRead(
  store: KeyValuePort,
): readonly string[] {
  const kept = store.read(threadNavigateAppliedKey);
  if (kept === null) return [];
  try {
    const parsed: unknown = JSON.parse(kept);
    return Array.isArray(parsed)
      ? parsed
          .filter((call): call is string => typeof call === "string")
          .slice(-threadNavigateAppliedMax)
      : [];
  } catch {
    return [];
  }
}

export function threadNavigateAppliedWrite(
  store: KeyValuePort,
  applied: readonly string[],
): void {
  store.write(threadNavigateAppliedKey, JSON.stringify(applied));
}

/** A reply this browser has and the mailbox has not yet taken, by the thread
 * it answers in. */
export interface ThreadOfferUnsent {
  readonly session: string;
  readonly reply: ThreadOfferReply;
}

/** How many unsent replies this browser keeps, the oldest let go first. */
export const threadOfferUnsentMax = 32;

/** Where this browser keeps the replies the mailbox has not taken, shared by
 * its tabs. */
export const threadOfferUnsentKey = "chuggy.threadOfferUnsent";

const threadOfferUnsentSchema = z.array(
  z.strictObject({ session: z.string().min(1), reply: threadOfferReplySchema }),
);

/** The unsent replies this browser keeps, none where what is kept is not a
 * list of them. */
export function threadOfferUnsentRead(
  store: KeyValuePort,
): readonly ThreadOfferUnsent[] {
  const kept = store.read(threadOfferUnsentKey);
  if (kept === null) return [];
  try {
    const read = threadOfferUnsentSchema.safeParse(JSON.parse(kept));
    return read.success ? read.data.slice(-threadOfferUnsentMax) : [];
  } catch {
    return [];
  }
}

/** The unsent reply this browser keeps for one call of one thread. */
export function threadOfferUnsentOf(
  store: KeyValuePort,
  session: string,
  call: string,
): ThreadOfferReply | undefined {
  return threadOfferUnsentRead(store).find(
    (held) => held.session === session && held.reply.call === call,
  )?.reply;
}

/** Keeps one reply as unsent, in place of any its call had. */
export function threadOfferUnsentKept(
  store: KeyValuePort,
  session: string,
  reply: ThreadOfferReply,
): void {
  const kept = [
    ...threadOfferUnsentRead(store).filter(
      (held) => held.session !== session || held.reply.call !== reply.call,
    ),
    { session, reply },
  ];
  store.write(
    threadOfferUnsentKey,
    JSON.stringify(kept.slice(-threadOfferUnsentMax)),
  );
}

/** Lets go of one call's unsent reply, which the mailbox took. */
export function threadOfferUnsentLetGo(
  store: KeyValuePort,
  session: string,
  call: string,
): void {
  store.write(
    threadOfferUnsentKey,
    JSON.stringify(
      threadOfferUnsentRead(store).filter(
        (held) => held.session !== session || held.reply.call !== call,
      ),
    ),
  );
}
