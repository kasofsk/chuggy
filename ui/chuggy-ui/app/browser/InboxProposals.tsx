/**
 * The lead's held decisions in the inbox: the read, the line an item says it
 * with, Approve and Reject, and the line an answer leaves behind once its item
 * has gone.
 *
 * AN ANSWER NEVER REMOVES ITS ITEM. It asks for the inbox again, and the item
 * leaves because that read no longer names it, answering nothing more until
 * then — so a decision someone else answered first, or whose ticket moved,
 * reads as stale here, and its item leaves the same way.
 */

import {
  hashKey,
  useIsMutating,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import type { MutationKey, QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  SelectorProposalResponse,
  SelectorProposalReviewResponse,
} from "../../../../src/contract/responses.ts";
import type { SelectorReviewOutcome } from "../../../../src/contract/rosters.ts";
import { apiReviewSelectorProposal } from "../core/apiRoutes.ts";
import { consoleWriteKey, consoleWriteWatchOf } from "../core/consoleWrite.ts";
import type {
  ConsoleWrite,
  ConsoleWriteRefused,
} from "../core/consoleWrite.ts";
import type { CopyText } from "../core/copy.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { inboxQuery } from "../core/ticketQueries.ts";
import {
  inboxProposalAnswered,
  inboxProposalNoteClamped,
  inboxProposalOthers,
  inboxProposalReview,
  inboxProposalSentence,
} from "../core/inboxProposals.ts";
import type {
  InboxProposalAnswer,
  InboxProposalStep,
} from "../core/inboxProposals.ts";
import { useConsoleWrite } from "./consoleWrite.tsx";
import {
  inboxProposalDrawnAt,
  inboxProposalHeardAt,
  inboxProposalLastAt,
  inboxProposalLeftAt,
} from "./inboxProposalHeard.ts";
import { useConsoleDispatch, useConsoleSelector } from "./store.ts";
import type { ConsoleDispatch } from "./store.ts";
import { Button } from "./ui/Button.tsx";
import { Confirm } from "./ui/Confirm.tsx";
import { Input } from "./ui/Input.tsx";
import { Notice } from "./ui/Notice.tsx";
import type { NoticeTone } from "./ui/Notice.tsx";

/** One press of Approve or Reject. */
interface InboxProposalPressed {
  readonly proposal: SelectorProposalResponse;
  readonly outcome: SelectorReviewOutcome;
  readonly note: string;
}

/** The reviews of a project's decisions, or of one decision. */
function inboxProposalReviewKey(
  partition: PartitionIdentity,
  decision?: string,
): MutationKey {
  return consoleWriteKey(
    "proposal-review",
    partition.tenant,
    partition.project,
    ...(decision === undefined ? [] : [decision]),
  );
}

function inboxProposalReviewReread(
  client: QueryClient,
  partition: PartitionIdentity,
): Promise<void> {
  return client.invalidateQueries({ queryKey: inboxQuery(partition).queryKey });
}

/**
 * One decision answered whole, its answer reported to the store as soon as the
 * server gives it. A refusal reads the inbox again before it is told too, since
 * a decision no longer held is an item that has to leave.
 */
function inboxProposalReviewWrite(
  partition: PartitionIdentity,
  proposal: SelectorProposalResponse,
  dispatch: ConsoleDispatch,
  text: CopyText,
): ConsoleWrite<InboxProposalPressed, SelectorProposalReviewResponse> {
  return {
    mutationKey: inboxProposalReviewKey(partition, proposal.decision),
    write: async (ports, pressed, client) => {
      const result = await apiReviewSelectorProposal(
        ports,
        partition,
        pressed.proposal.decision,
        inboxProposalReview(pressed.outcome, pressed.note),
      );
      dispatch(
        inboxProposalHeardAt({
          partition,
          answer: {
            proposal: pressed.proposal,
            step: inboxProposalAnswered(result),
          },
        }),
      );
      if (result.outcome !== "Ok")
        await inboxProposalReviewReread(client, partition);
      return result;
    },
    refusal: (failure) =>
      inboxProposalSentence(
        { proposal, step: inboxProposalAnswered(failure) },
        text,
      ),
    landed: (client) => inboxProposalReviewReread(client, partition),
  };
}

export interface InboxProposalAnswers {
  readonly partition: PartitionIdentity;
  /** The answer given last, which outlives the item it was given on. */
  readonly last: InboxProposalAnswer | undefined;
}

/** Whether the notice says `refused`, which it does only while the answer
 * it holds is that refusal: one the server never answered is reported to no
 * notice, and a later answer takes its place. */
function inboxProposalNoticeDraws(
  last: InboxProposalAnswer | undefined,
  refused: ConsoleWriteRefused,
  text: CopyText,
): boolean {
  return (
    last !== undefined && inboxProposalSentence(last, text) === refused.message
  );
}

/** Every review of the project's decisions the cache holds, watched for as
 * long as the inbox is drawn so the notice is what says a refusal it holds,
 * asked of the answer it last drew. */
function useInboxProposalReviewsWatched(
  partition: PartitionIdentity,
  last: InboxProposalAnswer | undefined,
  text: CopyText,
): void {
  const client = useQueryClient();
  const drawn = useRef(last);
  useEffect(() => {
    drawn.current = last;
  });
  const keys = useMutationState({
    filters: { mutationKey: inboxProposalReviewKey(partition) },
    select: (mutation) => mutation.options.mutationKey ?? [],
  });
  const keyed = keys.map((key) => hashKey(key)).join(" ");
  useEffect(
    () => {
      const watch = consoleWriteWatchOf(client);
      const released = keys.map((key) =>
        watch.watched(key, (refused) =>
          inboxProposalNoticeDraws(drawn.current, refused, text),
        ),
      );
      return () => {
        for (const release of released) release();
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys are watched by their hashes, which fresh arrays of the same parts keep
    [client, keyed, text],
  );
}

/** The inbox's reviews, and the last one the server answered while it was
 * drawn, held for as long as the inbox is. */
export function useInboxProposalAnswers(
  partition: PartitionIdentity,
): InboxProposalAnswers {
  const dispatch = useConsoleDispatch();
  const text = useCopyText();
  const last = useConsoleSelector((state) =>
    inboxProposalLastAt(state, partition),
  );
  useInboxProposalReviewsWatched(partition, last, text);
  const { tenant, project } = partition;
  useEffect(() => {
    const drawn = { tenant, project };
    dispatch(inboxProposalDrawnAt(drawn));
    return () => {
      dispatch(inboxProposalLeftAt(drawn));
    };
  }, [dispatch, tenant, project]);
  return { partition, last };
}

/** Why a proposed ticket is here, and what else its decision would dispatch. */
export function InboxProposalWhy(props: {
  readonly ticket: number;
  readonly proposals: readonly SelectorProposalResponse[];
}): ReactNode {
  const text = useCopyText();
  return props.proposals.map((proposal) => {
    const others = inboxProposalOthers(proposal, props.ticket);
    return (
      <p className="inbox-item-said" key={proposal.decision}>
        {others.length === 0
          ? text({ id: "inbox-proposal-why" })
          : text({
              id: "inbox-proposal-why-others",
              args: { others: others.join(", ") },
            })}
      </p>
    );
  });
}

/** Reject, with the note the lead reads beside it, asked before it is sent. */
function InboxProposalReject(props: {
  readonly sending: boolean;
  readonly onReject: (note: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const text = useCopyText();
  const [note, setNote] = useState("");
  return (
    <Confirm
      question={text({ id: "inbox-proposal-reject-question" })}
      confirm={text({ id: "inbox-proposal-reject-confirm" })}
      busy={props.sending}
      onConfirm={() => {
        props.onReject(note);
      }}
      onCancel={props.onCancel}
    >
      <Input
        label={text({ id: "inbox-proposal-note-label" })}
        placeholder={text({ id: "inbox-proposal-note-placeholder" })}
        value={note}
        onChange={(typed) => {
          setNote(inboxProposalNoteClamped(typed));
        }}
      />
    </Confirm>
  );
}

/** Approve and Reject for one decision, each press its own review of it, and
 * neither pressable while any item's review of the decision is out; a refusal
 * is the inbox's notice. Approve is the item's primary answer where `primary`
 * says this decision's answers are. */
function InboxProposalAction(props: {
  readonly answers: InboxProposalAnswers;
  readonly proposal: SelectorProposalResponse;
  readonly primary: boolean;
  readonly rejecting: boolean;
  readonly onRejecting: (rejecting: boolean) => void;
}): ReactNode {
  const proposal = props.proposal;
  const dispatch = useConsoleDispatch();
  const text = useCopyText();
  const write = inboxProposalReviewWrite(
    props.answers.partition,
    proposal,
    dispatch,
    text,
  );
  const reviewing = useConsoleWrite(write, {
    drawn: (refused) =>
      inboxProposalNoticeDraws(props.answers.last, refused, text),
  });
  const sending =
    useIsMutating({ mutationKey: write.mutationKey, exact: true }) > 0;
  const answer = (outcome: SelectorReviewOutcome, note: string): void => {
    reviewing.mutate({
      proposal,
      outcome,
      note,
    });
  };
  return (
    <>
      <div className="inbox-item-answers">
        <Button
          variant={props.primary ? "primary" : "quiet"}
          size="sm"
          disabled={sending}
          onClick={() => {
            answer("Approved", "");
          }}
        >
          {text({ id: "inbox-proposal-approve" })}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          disabled={sending}
          expanded={props.rejecting}
          onClick={() => {
            props.onRejecting(!props.rejecting);
          }}
        >
          {text({ id: "inbox-proposal-reject" })}
        </Button>
      </div>
      {props.rejecting ? (
        <InboxProposalReject
          sending={sending}
          onReject={(note) => {
            answer("Rejected", note);
          }}
          onCancel={() => {
            props.onRejecting(false);
          }}
        />
      ) : null}
    </>
  );
}

/** Approve and Reject for each decision proposing this item's ticket, the
 * first decision's Approve the item's primary answer where `primary` says. */
export function InboxProposalActions(props: {
  readonly proposals: readonly SelectorProposalResponse[];
  readonly answers: InboxProposalAnswers;
  readonly primary: boolean;
}): ReactNode {
  const [rejecting, setRejecting] = useState<string | undefined>(undefined);
  return props.proposals.map((proposal, at) => (
    <InboxProposalAction
      key={proposal.decision}
      answers={props.answers}
      proposal={proposal}
      primary={props.primary && at === 0}
      rejecting={rejecting === proposal.decision}
      onRejecting={(opened) => {
        setRejecting(opened ? proposal.decision : undefined);
      }}
    />
  ));
}

function inboxProposalTone(step: InboxProposalStep): NoticeTone {
  switch (step.step) {
    case "Answered":
      return "info";
    case "Stale":
      return "parked";
    case "Failed":
      return "danger";
  }
}

/** The answer given last, said once its item may have left: tickets, then the word. */
export function InboxProposalNotice(props: {
  readonly answers: InboxProposalAnswers;
}): ReactNode {
  const text = useCopyText();
  const last = props.answers.last;
  if (last === undefined) return null;
  return (
    <Notice
      tone={inboxProposalTone(last.step)}
      inline
      role="status"
      detail={inboxProposalSentence(last, text)}
    />
  );
}
