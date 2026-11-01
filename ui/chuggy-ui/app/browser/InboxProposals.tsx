/**
 * The lead's held decisions in the inbox: the read, the pill a row says it
 * with, Approve and Reject, and the line an answer leaves behind once its row
 * has gone.
 *
 * AN ANSWER NEVER REMOVES ITS ROW. It asks for the inbox again, and the row
 * leaves because that read no longer names it, answering nothing more until
 * then — so a decision someone else answered first, or whose ticket moved,
 * reads as stale here, and its row leaves the same way.
 */

import {
  hashKey,
  useIsMutating,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import type { MutationKey, QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  SelectorProposalResponse,
  SelectorProposalReviewResponse,
} from "../../../../src/contract/responses.ts";
import type { SelectorReviewOutcome } from "../../../../src/contract/rosters.ts";
import { apiReviewSelectorProposal } from "../core/apiRoutes.ts";
import {
  ConsoleWriteProgress,
  consoleWriteKey,
  consoleWriteWatchOf,
} from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
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
import { Button } from "./ui/Button.tsx";
import { Confirm } from "./ui/Confirm.tsx";
import { Input } from "./ui/Input.tsx";
import { Notice } from "./ui/Notice.tsx";
import type { NoticeTone } from "./ui/Notice.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

/** One press of Approve or Reject. */
interface InboxProposalPressed {
  readonly proposal: SelectorProposalResponse;
  readonly outcome: SelectorReviewOutcome;
  readonly note: string;
}

/** An answer to a review, and the project whose inbox it was given in. */
interface InboxProposalHeard {
  readonly partition: PartitionIdentity;
  readonly answer: InboxProposalAnswer;
}

const inboxProposalHeards = new WeakMap<
  QueryClient,
  ConsoleWriteProgress<InboxProposalHeard>
>();

/** Where a client's reviews report each answer as soon as the server gives
 * it, before the inbox has been read again, so an inbox drawn after the press
 * hears it too. */
function inboxProposalHeardOf(
  client: QueryClient,
): ConsoleWriteProgress<InboxProposalHeard> {
  const standing = inboxProposalHeards.get(client);
  if (standing !== undefined) return standing;
  const heard = new ConsoleWriteProgress<InboxProposalHeard>();
  inboxProposalHeards.set(client, heard);
  return heard;
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
 * One decision answered whole. A refusal reads the inbox again before it is
 * told too, since a decision no longer held is a row that has to leave.
 */
function inboxProposalReviewWrite(
  partition: PartitionIdentity,
  proposal: SelectorProposalResponse,
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
      inboxProposalHeardOf(client).report({
        partition,
        answer: {
          proposal: pressed.proposal,
          step: inboxProposalAnswered(result),
        },
      });
      if (result.outcome !== "Ok")
        await inboxProposalReviewReread(client, partition);
      return result;
    },
    refusal: (failure) =>
      inboxProposalSentence({ proposal, step: inboxProposalAnswered(failure) }),
    landed: (client) => inboxProposalReviewReread(client, partition),
  };
}

export interface InboxProposalAnswers {
  readonly partition: PartitionIdentity;
  /** The answer given last, which outlives the row it was given on. */
  readonly last: InboxProposalAnswer | undefined;
}

/** Every review of the project's decisions the cache holds, watched for as
 * long as the inbox is drawn so the notice is what says a refusal the server
 * answered; one it never answered is reported to no notice. */
function useInboxProposalReviewsWatched(partition: PartitionIdentity): void {
  const client = useQueryClient();
  const keys = useMutationState({
    filters: { mutationKey: inboxProposalReviewKey(partition) },
    select: (mutation) => mutation.options.mutationKey ?? [],
  });
  const keyed = keys.map((key) => hashKey(key)).join(" ");
  useEffect(
    () => {
      const watch = consoleWriteWatchOf(client);
      const released = keys.map((key) =>
        watch.watched(key, (refused) => refused.failure !== undefined),
      );
      return () => {
        for (const release of released) release();
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys are watched by their hashes, which fresh arrays of the same parts keep
    [client, keyed],
  );
}

/** The inbox's reviews, and the last one the server answered while it was
 * drawn, held for as long as the inbox is. */
export function useInboxProposalAnswers(
  partition: PartitionIdentity,
): InboxProposalAnswers {
  const client = useQueryClient();
  useInboxProposalReviewsWatched(partition);
  const [last, setLast] = useState<InboxProposalAnswer | undefined>(undefined);
  const { tenant, project } = partition;
  useEffect(() => {
    const heard = inboxProposalHeardOf(client);
    return heard.subscribe(() => {
      const told = heard.step;
      if (
        told !== undefined &&
        told.partition.tenant === tenant &&
        told.partition.project === project
      )
        setLast(told.answer);
    });
  }, [client, tenant, project]);
  return { partition, last };
}

/** Why a proposed ticket is here, and what else its decision would dispatch. */
export function InboxProposalWhy(props: {
  readonly ticket: number;
  readonly proposals: readonly SelectorProposalResponse[];
}): ReactNode {
  return props.proposals.map((proposal) => {
    const others = inboxProposalOthers(proposal, props.ticket);
    return (
      <Tooltip
        key={proposal.decision}
        text={
          others.length === 0
            ? "Lead proposal"
            : `Lead proposal · also ${others.join(", ")}`
        }
      >
        <span>
          <Pill tone="parked">Proposal</Pill>
        </span>
      </Tooltip>
    );
  });
}

/** Reject, with the note the lead reads beside it, asked before it is sent. */
function InboxProposalReject(props: {
  readonly sending: boolean;
  readonly onReject: (note: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [note, setNote] = useState("");
  return (
    <Confirm
      question="Reject this proposal?"
      confirm="Reject"
      busy={props.sending}
      onConfirm={() => {
        props.onReject(note);
      }}
      onCancel={props.onCancel}
    >
      <Input
        label="Note"
        placeholder="Note"
        value={note}
        onChange={(typed) => {
          setNote(inboxProposalNoteClamped(typed));
        }}
      />
    </Confirm>
  );
}

/** Approve and Reject for one decision, each press its own review of it, and
 * neither pressable while any row's review of the decision is out. */
function InboxProposalAction(props: {
  readonly partition: PartitionIdentity;
  readonly proposal: SelectorProposalResponse;
  readonly rejecting: boolean;
  readonly onRejecting: (rejecting: boolean) => void;
}): ReactNode {
  const proposal = props.proposal;
  const write = inboxProposalReviewWrite(props.partition, proposal);
  const reviewing = useConsoleWrite(write, { drawn: true });
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
    <div className="grid gap-2">
      <div className="flex gap-2 items-baseline">
        <Button
          variant="quiet"
          size="sm"
          disabled={sending}
          onClick={() => {
            answer("Approved", "");
          }}
        >
          approve
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
          reject
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
    </div>
  );
}

/** Approve and Reject for each decision proposing this row's ticket. */
export function InboxProposalActions(props: {
  readonly proposals: readonly SelectorProposalResponse[];
  readonly answers: InboxProposalAnswers;
}): ReactNode {
  const [rejecting, setRejecting] = useState<string | undefined>(undefined);
  return props.proposals.map((proposal) => (
    <InboxProposalAction
      key={proposal.decision}
      partition={props.answers.partition}
      proposal={proposal}
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

/** The answer given last, said once its row may have left: tickets, then the word. */
export function InboxProposalNotice(props: {
  readonly answers: InboxProposalAnswers;
}): ReactNode {
  const last = props.answers.last;
  if (last === undefined) return null;
  return (
    <Notice
      tone={inboxProposalTone(last.step)}
      inline
      role="status"
      detail={inboxProposalSentence(last)}
    />
  );
}
