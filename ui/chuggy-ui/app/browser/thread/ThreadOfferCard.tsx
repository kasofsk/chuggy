/**
 * An offer the reader's own project thread made them, drawn as a card under
 * the call that made it: what it offers, the draft or the ticket it offers it
 * of wherever the card read that, and Confirm and Decline while it is open.
 *
 * WHAT IS CONFIRMED IS THE READER'S OWN OPERATION. Confirm submits the release
 * or the revocation as the reader, at the version offered, and follows it to
 * settlement; Decline submits nothing. Either way the reply goes into the
 * thread's mailbox as an `OfferReply` turn naming the call, and that turn is
 * what draws the card settled from then on, on this page and every other. A
 * card whose reply could be older than the mailbox page the read holds is
 * drawn with neither.
 *
 * A CARD WHOSE SUBJECT MOVED IS NOT CONFIRMED. The draft or the ticket is read
 * as the project's stream keeps it, and one past the version offered, or no
 * longer one the action applies to, is drawn without Confirm. A revocation is
 * also fenced to the revision offered, so a ticket that moves after the card
 * was drawn is refused rather than revoked.
 *
 * A REPLY THE MAILBOX REFUSED IS SENT AGAIN, NOT LOST. The reply is kept in
 * this browser until the mailbox takes it, and a card holding one draws it
 * with Send reply whatever its subject now says.
 *
 * The press is a console write under the call's own key, so it outlives the
 * card and a card drawn again while it runs draws it running. The reply's
 * turn is derived from the call, so a reply sent again, from this tab or
 * another, is the one already in the mailbox.
 */

import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { PublicMutation } from "../../../../../src/contract/requests.ts";
import type { ThreadResponse } from "../../../../../src/contract/responses.ts";
import type { ThreadOfferReply } from "../../../../../src/contract/threadOffers.ts";
import { apiReplyThreadOffer } from "../../core/apiRoutes.ts";
import { base64urlFromBytes } from "../../core/base64url.ts";
import { operationFailureSentence } from "../../core/codeSentences.ts";
import type { ApiPorts } from "../../core/apiRequest.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type {
  ConversationExchange,
  ConversationWorkStep,
} from "../../core/conversation.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import {
  followOperation,
  operationIdBytesCount,
} from "../../core/operationFollow.ts";
import { draftQuery, ticketQuery } from "../../core/ticketQueries.ts";
import {
  threadOfferAnswerOf,
  threadOfferConfirmed,
  threadOfferOf,
  threadOfferReplies,
  threadOfferReleaseMutation,
  threadOfferReleaseStanding,
  threadOfferRevokeMutation,
  threadOfferRevokeStanding,
  threadOfferSentence,
  threadOfferSettledSentence,
  threadOfferSupersededSentence,
  threadOfferUnreadSentence,
  threadOfferUnsentKept,
  threadOfferUnsentLetGo,
  threadOfferUnsentOf,
} from "../../core/threadOffers.ts";
import type {
  ThreadOfferAnswer,
  ThreadOfferCall,
  ThreadOfferStanding,
} from "../../core/threadOffers.ts";
import { usePanelState } from "../api.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { drawBytes, persistentStore } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import {
  ThreadOfferDraftSubject,
  ThreadOfferTicketSubject,
} from "./ThreadOfferSubject.tsx";

/** One press of a card: a decline, a confirmation and what it submits, or a
 * reply the mailbox did not take, sent again. */
type ThreadOfferPressed =
  | { readonly decision: "Declined" }
  | {
      readonly decision: "Confirmed";
      readonly mutation: PublicMutation;
      readonly operation: string;
    }
  | { readonly decision: "Resent"; readonly reply: ThreadOfferReply };

type ThreadOfferWriting = ConsoleWriting<ThreadOfferPressed, ThreadOfferReply>;

/** The turn a call's reply goes into the mailbox as. */
export function threadOfferReplyTurn(call: string): string {
  return `offer-reply-${call}`;
}

/** The reply one press makes. A confirmation is kept as unsettled before its
 * operation is submitted, so a tab closed while following it leaves a reply
 * behind to send. */
async function threadOfferWriteReply(
  ports: ApiPorts,
  partition: PartitionIdentity,
  session: string,
  offer: ThreadOfferCall,
  pressed: ThreadOfferPressed,
): Promise<ThreadOfferReply> {
  if (pressed.decision === "Resent") return pressed.reply;
  if (pressed.decision === "Declined")
    return { call: offer.call, decision: "Declined" };
  threadOfferUnsentKept(persistentStore, session, {
    call: offer.call,
    decision: "Confirmed",
    outcome: "Unsettled",
  });
  const followed = await followOperation(
    ports,
    partition,
    { operation: pressed.operation, mutation: pressed.mutation },
    offer.ticket,
    () => undefined,
  );
  return threadOfferConfirmed(offer.call, followed.step);
}

function threadOfferWrite(
  partition: PartitionIdentity,
  session: string,
  offer: ThreadOfferCall,
): ConsoleWrite<ThreadOfferPressed, ThreadOfferReply> {
  return {
    mutationKey: consoleWriteKey(
      "thread-offer",
      partition.tenant,
      partition.project,
      session,
      offer.call,
    ),
    write: async (ports, pressed) => {
      const reply = await threadOfferWriteReply(
        ports,
        partition,
        session,
        offer,
        pressed,
      );
      threadOfferUnsentKept(persistentStore, session, reply);
      const sent = await apiReplyThreadOffer(ports, partition, session, {
        turn: threadOfferReplyTurn(offer.call),
        reply,
      });
      if (sent.outcome !== "Ok") return sent;
      threadOfferUnsentLetGo(persistentStore, session, offer.call);
      return { outcome: "Ok", value: reply };
    },
    refusal: operationFailureSentence,
  };
}

/** A card as it is drawn: what it offers, and what stands under that. */
function ThreadOfferShell(props: {
  readonly offer: ThreadOfferCall;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      aria-label="Offer"
      className="bg-surface-1 border-edge rounded-3 flex flex-col gap-2 border p-3"
    >
      <p className="text-sm font-medium">{threadOfferSentence(props.offer)}</p>
      {props.children}
    </section>
  );
}

function ThreadOfferRefused(props: {
  readonly writing: ThreadOfferWriting;
}): ReactNode {
  const { error } = props.writing;
  return error === null ? null : (
    <Notice tone="danger" inline detail={error.message} />
  );
}

/** A reply the mailbox did not take, and the press that sends it again. */
function ThreadOfferResend(props: {
  readonly offer: ThreadOfferCall;
  readonly reply: ThreadOfferReply;
  readonly writing: ThreadOfferWriting;
}): ReactNode {
  const { offer, reply, writing } = props;
  return (
    <>
      <p className="text-ink-3 text-sm">
        {threadOfferSettledSentence(offer, reply)} · Reply not sent
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          busy={writing.isPending}
          disabled={writing.isPending}
          onClick={() => {
            writing.mutate({ decision: "Resent", reply });
          }}
        >
          Send reply
        </Button>
      </div>
      <ThreadOfferRefused writing={writing} />
    </>
  );
}

/** What a card offers once its subject is read: the presses where it is
 * open, and why there are none where it is not. */
function ThreadOfferOpen(props: {
  readonly writing: ThreadOfferWriting;
  readonly standing: ThreadOfferStanding;
  readonly mutation: PublicMutation | undefined;
}): ReactNode {
  const { writing, standing, mutation } = props;
  if (standing.standing === "Superseded")
    return (
      <p className="text-ink-3 text-sm">{threadOfferSupersededSentence}</p>
    );
  if (standing.standing === "Closed")
    return <p className="text-ink-3 text-sm">{standing.why}</p>;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          busy={writing.isPending}
          disabled={writing.isPending || mutation === undefined}
          onClick={() => {
            if (mutation === undefined) return;
            writing.mutate({
              decision: "Confirmed",
              mutation,
              operation: base64urlFromBytes(drawBytes(operationIdBytesCount)),
            });
          }}
        >
          Confirm
        </Button>
        <Button
          size="sm"
          disabled={writing.isPending}
          onClick={() => {
            writing.mutate({ decision: "Declined" });
          }}
        >
          Decline
        </Button>
      </div>
      <ThreadOfferRefused writing={writing} />
    </>
  );
}

/** A release card against its draft: the draft once read, and under it the
 * reply this tab settled it with or else what the card offers. */
function ThreadOfferRelease(props: {
  readonly partition: PartitionIdentity;
  readonly offer: Extract<ThreadOfferCall, { readonly offer: "Release" }>;
  readonly writing: ThreadOfferWriting;
  readonly settled: ReactNode;
}): ReactNode {
  const { partition, offer } = props;
  const state = usePanelState(draftQuery(partition, offer.ticket, "Streamed"));
  if (state.state !== "Ready")
    return props.settled ?? <PanelUnready state={state} />;
  return (
    <>
      <ThreadOfferDraftSubject partition={partition} draft={state.value} />
      {props.settled ?? (
        <ThreadOfferOpen
          writing={props.writing}
          standing={threadOfferReleaseStanding(offer, state.value)}
          mutation={threadOfferReleaseMutation(offer, state.value)}
        />
      )}
    </>
  );
}

/** A revoke card against its ticket, drawn as a release card is. */
function ThreadOfferRevoke(props: {
  readonly partition: PartitionIdentity;
  readonly offer: Extract<ThreadOfferCall, { readonly offer: "Revoke" }>;
  readonly writing: ThreadOfferWriting;
  readonly settled: ReactNode;
}): ReactNode {
  const { partition, offer } = props;
  const state = usePanelState(ticketQuery(partition, offer.ticket, "Streamed"));
  if (state.state !== "Ready")
    return props.settled ?? <PanelUnready state={state} />;
  return (
    <>
      <ThreadOfferTicketSubject ticket={state.value} />
      {props.settled ?? (
        <ThreadOfferOpen
          writing={props.writing}
          standing={threadOfferRevokeStanding(offer, state.value)}
          mutation={threadOfferRevokeMutation(offer)}
        />
      )}
    </>
  );
}

/**
 * A card the mailbox holds no reply for: offering to send again a reply this
 * browser holds unsent, and otherwise drawn against its subject as the
 * project keeps it, settled by the reply this tab just sent where it sent one.
 */
function ThreadOfferUnanswered(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly offer: ThreadOfferCall;
}): ReactNode {
  const { partition, session, offer } = props;
  const writing = useConsoleWrite(threadOfferWrite(partition, session, offer), {
    drawn: true,
  });
  const settled =
    writing.isSuccess && writing.data !== undefined ? (
      <p className="text-ink-3 text-sm" role="status">
        {threadOfferSettledSentence(offer, writing.data)}
      </p>
    ) : undefined;
  const unsent =
    writing.isPending || settled !== undefined
      ? undefined
      : threadOfferUnsentOf(persistentStore, session, offer.call);
  if (unsent !== undefined)
    return <ThreadOfferResend offer={offer} reply={unsent} writing={writing} />;
  return offer.offer === "Release" ? (
    <ThreadOfferRelease
      partition={partition}
      offer={offer}
      writing={writing}
      settled={settled}
    />
  ) : (
    <ThreadOfferRevoke
      partition={partition}
      offer={offer}
      writing={writing}
      settled={settled}
    />
  );
}

/** One offer's card: settled by the reply the mailbox holds for it, open to
 * nothing where its reply could be in a page the read does not hold, and
 * otherwise drawn against its subject as the project keeps it. */
export function ThreadOfferCard(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly offer: ThreadOfferCall;
  readonly answer: ThreadOfferAnswer;
}): ReactNode {
  const { offer, answer } = props;
  return (
    <ThreadOfferShell offer={offer}>
      {answer.answer === "Replied" ? (
        <p className="text-ink-3 text-sm">
          {threadOfferSettledSentence(offer, answer.reply)}
        </p>
      ) : answer.answer === "Unread" ? (
        <p className="text-ink-3 text-sm">{threadOfferUnreadSentence}</p>
      ) : (
        <ThreadOfferUnanswered
          partition={props.partition}
          session={props.session}
          offer={offer}
        />
      )}
    </ThreadOfferShell>
  );
}

/** How the reader's own project thread draws what its steps offer: a card for
 * each offer, answered as its mailbox page answers it. Another member's
 * thread draws none, the offer being theirs to answer. */
export function useThreadOfferDrawn(
  partition: PartitionIdentity,
  thread: ThreadResponse,
):
  | ((step: ConversationWorkStep, exchange: ConversationExchange) => ReactNode)
  | undefined {
  const { mine, session, turns, nextBefore } = thread;
  const replies = useMemo(() => threadOfferReplies(turns), [turns]);
  const drawn = useCallback(
    (step: ConversationWorkStep, exchange: ConversationExchange): ReactNode => {
      const offer = threadOfferOf(step);
      return offer === undefined ? null : (
        <ThreadOfferCard
          partition={partition}
          session={session}
          offer={offer}
          answer={threadOfferAnswerOf({ turns, nextBefore }, replies, {
            call: offer.call,
            turn: exchange.turn,
          })}
        />
      );
    },
    [partition, session, turns, nextBefore, replies],
  );
  return mine ? drawn : undefined;
}
