/**
 * An offer the reader's own project thread made them, drawn as a card under
 * the call that made it: what it offers, and Confirm and Decline while it is
 * open.
 *
 * WHAT IS CONFIRMED IS THE READER'S OWN OPERATION. Confirm submits the release
 * or the revocation as the reader, at the version offered, and follows it to
 * settlement; Decline submits nothing. Either way the reply goes into the
 * thread's mailbox as an `OfferReply` turn naming the call, and that turn is
 * what draws the card settled from then on, on this page and every other.
 *
 * A CARD WHOSE SUBJECT MOVED IS NOT CONFIRMED. The draft or the ticket is read
 * as the project's stream keeps it, and one past the version offered, or no
 * longer one the action applies to, is drawn without Confirm.
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
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConversationWorkStep } from "../../core/conversation.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import {
  followOperation,
  operationIdBytesCount,
} from "../../core/operationFollow.ts";
import { draftQuery, ticketQuery } from "../../core/ticketQueries.ts";
import {
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
} from "../../core/threadOffers.ts";
import type {
  ThreadOfferCall,
  ThreadOfferStanding,
} from "../../core/threadOffers.ts";
import { usePanelState } from "../api.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { drawBytes } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";

/** One press of a card: a decline, or a confirmation and what it submits. */
type ThreadOfferPressed =
  | { readonly decision: "Declined" }
  | {
      readonly decision: "Confirmed";
      readonly mutation: PublicMutation;
      readonly operation: string;
    };

/** The turn a call's reply goes into the mailbox as. */
export function threadOfferReplyTurn(call: string): string {
  return `offer-reply-${call}`;
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
      const reply: ThreadOfferReply =
        pressed.decision === "Declined"
          ? { call: offer.call, decision: "Declined" }
          : threadOfferConfirmed(
              offer.call,
              (
                await followOperation(
                  ports,
                  partition,
                  {
                    operation: pressed.operation,
                    mutation: pressed.mutation,
                  },
                  offer.ticket,
                  () => undefined,
                )
              ).step,
            );
      const sent = await apiReplyThreadOffer(ports, partition, session, {
        turn: threadOfferReplyTurn(offer.call),
        reply,
      });
      return sent.outcome === "Ok" ? { outcome: "Ok", value: reply } : sent;
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

/** What a card offers once its subject is read: the presses where it is
 * open, and why there are none where it is not. */
function ThreadOfferOpen(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly offer: ThreadOfferCall;
  readonly standing: ThreadOfferStanding;
  readonly mutation: PublicMutation | undefined;
}): ReactNode {
  const { offer, standing } = props;
  const writing = useConsoleWrite(
    threadOfferWrite(props.partition, props.session, offer),
    { drawn: true },
  );
  const reply = writing.isSuccess ? writing.data : undefined;
  if (reply !== undefined)
    return (
      <p className="text-ink-3 text-sm" role="status">
        {threadOfferSettledSentence(offer, reply)}
      </p>
    );
  if (standing.standing === "Superseded")
    return (
      <p className="text-ink-3 text-sm">{threadOfferSupersededSentence}</p>
    );
  if (standing.standing === "Closed")
    return <p className="text-ink-3 text-sm">{standing.why}</p>;
  const { mutation } = props;
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
      {writing.error === null ? null : (
        <Notice tone="danger" inline detail={writing.error.message} />
      )}
    </>
  );
}

function ThreadOfferRelease(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly offer: Extract<ThreadOfferCall, { readonly offer: "Release" }>;
}): ReactNode {
  const { partition, offer } = props;
  const state = usePanelState(draftQuery(partition, offer.ticket, "Streamed"));
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  return (
    <ThreadOfferOpen
      {...props}
      standing={threadOfferReleaseStanding(offer, state.value)}
      mutation={threadOfferReleaseMutation(offer, state.value)}
    />
  );
}

function ThreadOfferRevoke(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly offer: Extract<ThreadOfferCall, { readonly offer: "Revoke" }>;
}): ReactNode {
  const { partition, offer } = props;
  const state = usePanelState(ticketQuery(partition, offer.ticket, "Streamed"));
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  return (
    <ThreadOfferOpen
      {...props}
      standing={threadOfferRevokeStanding(offer, state.value)}
      mutation={threadOfferRevokeMutation(offer)}
    />
  );
}

/** One offer's card: settled by the reply the mailbox holds for it, and
 * otherwise drawn against its subject as the project keeps it. */
export function ThreadOfferCard(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly offer: ThreadOfferCall;
  readonly reply: ThreadOfferReply | undefined;
}): ReactNode {
  const { offer, reply } = props;
  return (
    <ThreadOfferShell offer={offer}>
      {reply !== undefined ? (
        <p className="text-ink-3 text-sm">
          {threadOfferSettledSentence(offer, reply)}
        </p>
      ) : offer.offer === "Release" ? (
        <ThreadOfferRelease {...props} offer={offer} />
      ) : (
        <ThreadOfferRevoke {...props} offer={offer} />
      )}
    </ThreadOfferShell>
  );
}

/** How the reader's own project thread draws what its steps offer: a card for
 * each offer, settled by the reply its mailbox page holds. Another member's
 * thread draws none, the offer being theirs to answer. */
export function useThreadOfferDrawn(
  partition: PartitionIdentity,
  thread: ThreadResponse,
): ((step: ConversationWorkStep) => ReactNode) | undefined {
  const { mine, session, turns } = thread;
  const replies = useMemo(() => threadOfferReplies(turns), [turns]);
  const drawn = useCallback(
    (step: ConversationWorkStep): ReactNode => {
      const offer = threadOfferOf(step);
      return offer === undefined ? null : (
        <ThreadOfferCard
          partition={partition}
          session={session}
          offer={offer}
          reply={replies.get(offer.call)}
        />
      );
    },
    [partition, session, replies],
  );
  return mine ? drawn : undefined;
}
