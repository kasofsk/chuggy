/**
 * The lead's held decisions in the inbox: the read, the pill a row says it
 * with, Approve and Reject, and the line an answer leaves behind once its row
 * has gone.
 *
 * AN ANSWER NEVER REMOVES ITS ROW. It asks for the held decisions again, and
 * the row leaves because that read no longer names it, answering nothing more
 * until then — so a decision someone else answered first, or whose ticket
 * moved, reads as stale here, and its row leaves the same way.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  SelectorProposalResponse,
  SelectorProposalsResponse,
} from "../../../../src/contract/responses.ts";
import type { SelectorReviewOutcome } from "../../../../src/contract/rosters.ts";
import {
  apiReviewSelectorProposal,
  apiSelectorProposals,
} from "../core/apiRoutes.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  inboxProposalAnswered,
  inboxProposalNoteClamped,
  inboxProposalOthers,
  inboxProposalReview,
  inboxProposalsPolledMs,
  inboxProposalStepWord,
} from "../core/inboxProposals.ts";
import type {
  InboxProposalAnswer,
  InboxProposalStep,
} from "../core/inboxProposals.ts";
import { projectAbilityGranted } from "../core/projectAbilities.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import { useApiPorts, usePanelResourceAsked } from "./api.ts";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { Button } from "./ui/Button.tsx";
import { Confirm } from "./ui/Confirm.tsx";
import { Input } from "./ui/Input.tsx";
import { Notice } from "./ui/Notice.tsx";
import type { NoticeTone } from "./ui/Notice.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

/** A resource no frame names, so the poll, a partition's invalidation and an answer from this tab are what reach it. */
export const inboxProposalsResource = "selector-proposals";

/** The held decisions, read only for a reader the abilities read said may
 * dispatch, since any other is refused them on every poll. */
export function useInboxProposals(
  partition: PartitionIdentity,
): PanelState<SelectorProposalsResponse> {
  const abilities = useProjectAbilities(partition);
  return usePanelResourceAsked(
    partition,
    "Project",
    inboxProposalsResource,
    (ports) => apiSelectorProposals(ports, partition),
    inboxProposalsPolledMs,
    projectAbilityGranted(abilities, "dispatch"),
  );
}

export interface InboxProposalAnswers {
  /** The decisions answered since the held decisions were last read, which neither of their rows may send again. */
  readonly sending: ReadonlySet<string>;
  /** The answer settled last, which outlives the row it was given on. */
  readonly last: InboxProposalAnswer | undefined;
  readonly answer: (
    proposal: SelectorProposalResponse,
    outcome: SelectorReviewOutcome,
    note: string,
  ) => void;
}

export function useInboxProposalAnswers(
  partition: PartitionIdentity,
): InboxProposalAnswers {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [last, setLast] = useState<InboxProposalAnswer | undefined>(undefined);
  const answer = (
    proposal: SelectorProposalResponse,
    outcome: SelectorReviewOutcome,
    note: string,
  ) => {
    setSending((was) => new Set(was).add(proposal.decision));
    void (async () => {
      const step = inboxProposalAnswered(
        await apiReviewSelectorProposal(
          ports,
          partition,
          proposal.decision,
          inboxProposalReview(outcome, note),
        ),
      );
      setLast({ proposal, step });
      await client.invalidateQueries({
        queryKey: projectResourceKey(
          partition,
          "Project",
          inboxProposalsResource,
        ),
      });
      setSending((was) => {
        const still = new Set(was);
        still.delete(proposal.decision);
        return still;
      });
    })();
  };
  return { sending, last, answer };
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

/** Approve and Reject for each decision proposing this row's ticket. */
export function InboxProposalActions(props: {
  readonly proposals: readonly SelectorProposalResponse[];
  readonly answers: InboxProposalAnswers;
}): ReactNode {
  const [rejecting, setRejecting] = useState<string | undefined>(undefined);
  return props.proposals.map((proposal) => {
    const sending = props.answers.sending.has(proposal.decision);
    return (
      <div key={proposal.decision} className="grid gap-2">
        <div className="flex gap-2 items-baseline">
          <Button
            variant="quiet"
            size="sm"
            disabled={sending}
            onClick={() => {
              props.answers.answer(proposal, "Approved", "");
            }}
          >
            approve
          </Button>
          <Button
            variant="quiet"
            size="sm"
            disabled={sending}
            expanded={rejecting === proposal.decision}
            onClick={() => {
              setRejecting(
                rejecting === proposal.decision ? undefined : proposal.decision,
              );
            }}
          >
            reject
          </Button>
        </div>
        {rejecting === proposal.decision ? (
          <InboxProposalReject
            sending={sending}
            onReject={(note) => {
              props.answers.answer(proposal, "Rejected", note);
            }}
            onCancel={() => {
              setRejecting(undefined);
            }}
          />
        ) : null}
      </div>
    );
  });
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
  const why = last.step.step === "Failed" ? ` · ${last.step.why}` : "";
  return (
    <Notice
      tone={inboxProposalTone(last.step)}
      inline
      role="status"
      detail={`Proposal ${last.proposal.tickets.join(", ")} · ${inboxProposalStepWord(last.step)}${why}`}
    />
  );
}
