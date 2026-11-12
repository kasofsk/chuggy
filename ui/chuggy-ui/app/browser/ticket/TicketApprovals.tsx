/**
 * A ticket's open evaluation approvals where they are answered: each one named
 * by the step it judges, what its workload tells the approver to look at, who
 * may answer it, the work it judges, and — for a reader it asks — Approve and
 * Reject.
 *
 * WHAT IS SENT IS THE ANSWER THE READ OFFERED, with what the reader typed as
 * its feedback. An approve sends at once, with the note where one was typed;
 * a reject asks first and cannot be sent until its feedback says something,
 * since the server refuses a rejection without it. Nothing changes on screen
 * until the follow, or a frame, says the question was answered.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";
import type {
  ApprovalApprovers,
  ApprovalAsked,
} from "../../core/evaluationApprovals.ts";
import { creatorLabel } from "../../core/labels.ts";
import {
  approvalAnswerSendable,
  approvalAnswerWith,
  approvalFeedbackClamped,
  nativeActionAnswerKey,
} from "../../core/nativeActionAnswers.ts";
import { ticketActionLabel } from "../../core/codeLabels.ts";
import { ticketActionSentence } from "../../core/ticketActions.ts";
import type { TicketAction } from "../../core/ticketActions.ts";
import { useCreatorEmails } from "../creatorEmails.ts";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Input } from "../ui/Input.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

/** The name a question's group is read by, which tells it from another open one. */
export function approvalQuestionName(
  asked: ApprovalAsked,
  text: CopyText,
): string {
  return text({
    id: "ticket-approval-question",
    args: { step: asked.step, cycle: String(asked.cycle) },
  });
}

/** Who may answer: the role in words, or each person listed. */
export function ApprovalApproversDrawn(props: {
  readonly partition: PartitionIdentity;
  readonly approvers: ApprovalApprovers;
}): ReactNode {
  const text = useCopyText();
  const emails = useCreatorEmails(props.partition);
  const approvers = props.approvers;
  if (approvers.by === "Role") return text(approvers.role);
  return (
    <span className="flex flex-wrap gap-2">
      {approvers.people.map((person) => (
        <Identity key={person} label={creatorLabel(person, emails)} />
      ))}
    </span>
  );
}

/** Reject, with the feedback the work is sent back with, asked before it is sent. */
function ApprovalReject(props: {
  readonly offer: TicketAction;
  readonly typed: string;
  readonly busy: boolean;
  readonly onReject: (feedback: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const text = useCopyText();
  const [feedback, setFeedback] = useState(props.typed);
  return (
    <Confirm
      question={text({ id: "ticket-approval-reject-question" })}
      confirm={text(ticketActionLabel("Reject"))}
      busy={props.busy}
      ready={approvalAnswerSendable("Reject", feedback)}
      onConfirm={() => {
        props.onReject(feedback);
      }}
      onCancel={props.onCancel}
    >
      <Input
        label={text({ id: "ticket-approval-feedback-label" })}
        placeholder={text({ id: "ticket-approval-feedback-placeholder" })}
        value={feedback}
        autoFocus
        onChange={(typed) => {
          setFeedback(approvalFeedbackClamped(typed));
        }}
      />
    </Confirm>
  );
}

/** The header's Reject: a dialog taking the feedback the work is sent back
 * with, which cannot be sent blank. */
export function ApprovalRejectDialog(props: {
  readonly offer: TicketAction;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onReject: (answer: TicketAction) => void;
}): ReactNode {
  const text = useCopyText();
  const [feedback, setFeedback] = useState("");
  const sendable = approvalAnswerSendable("Reject", feedback);
  return (
    <Dialog
      title={text({ id: "ticket-approval-reject-question" })}
      size="form"
      open={props.open}
      onOpenChange={props.onOpenChange}
      foot={
        <>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              props.onOpenChange(false);
            }}
          >
            {text({ id: "ticket-cancel" })}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!sendable}
            onClick={() => {
              props.onOpenChange(false);
              props.onReject(approvalAnswerWith(props.offer, feedback));
              setFeedback("");
            }}
          >
            {text(ticketActionLabel("Reject"))}
          </Button>
        </>
      }
    >
      <Input
        label={text({ id: "ticket-approval-feedback-label" })}
        placeholder={text({ id: "ticket-approval-feedback-placeholder" })}
        value={feedback}
        autoFocus
        onChange={(typed) => {
          setFeedback(approvalFeedbackClamped(typed));
        }}
      />
    </Dialog>
  );
}

/** One approval's answers: the note an approve may carry, Approve, and Reject,
 * which asks for its feedback before it is sent. */
export function ApprovalAnswers(props: {
  readonly answers: readonly TicketAction[];
  readonly busy: boolean;
  readonly onAnswer: (answer: TicketAction) => void;
}): ReactNode {
  const text = useCopyText();
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const reject = props.answers.find((offer) => offer.action === "Reject");
  return (
    <div className="grid gap-2">
      <Input
        label={text({ id: "ticket-approval-note-label" })}
        placeholder={text({ id: "ticket-approval-note-placeholder" })}
        value={note}
        disabled={props.busy}
        onChange={(typed) => {
          setNote(approvalFeedbackClamped(typed));
        }}
      />
      <div className="flex gap-2 items-baseline">
        {props.answers.map((offer) => (
          <Tooltip
            key={nativeActionAnswerKey(offer)}
            text={ticketActionSentence(offer.action)}
          >
            <span>
              <Button
                variant={offer === reject ? "quiet" : "primary"}
                size="sm"
                disabled={
                  props.busy ||
                  (offer !== reject &&
                    !approvalAnswerSendable(offer.action, note))
                }
                {...(offer === reject ? { expanded: rejecting } : {})}
                onClick={() => {
                  if (offer === reject) setRejecting(!rejecting);
                  else props.onAnswer(approvalAnswerWith(offer, note));
                }}
              >
                {text(ticketActionLabel(offer.action))}
              </Button>
            </span>
          </Tooltip>
        ))}
      </div>
      {reject === undefined || !rejecting ? null : (
        <ApprovalReject
          offer={reject}
          typed={note}
          busy={props.busy}
          onReject={(feedback) => {
            setRejecting(false);
            props.onAnswer(approvalAnswerWith(reject, feedback));
          }}
          onCancel={() => {
            setRejecting(false);
          }}
        />
      )}
    </div>
  );
}

/** The work the approval judges, by the views its run's page already has, or
 * the ticket's Runs tab where the page holds none of its runs. */
function ApprovalWork(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly cycle: number;
  readonly work: number | undefined;
}): ReactNode {
  const text = useCopyText();
  if (props.work === undefined)
    return (
      <Link
        to="/$tenant/$project/tickets/$ticket/runs"
        params={{ ...props.partition, ticket: String(props.ticket) }}
      >
        {text({
          id: "ticket-approval-work-runs",
          args: { cycle: String(props.cycle) },
        })}
      </Link>
    );
  const params = {
    ...props.partition,
    ticket: String(props.ticket),
    task: String(props.work),
  };
  return (
    <span className="flex flex-wrap gap-3">
      <Link
        to="/$tenant/$project/tickets/$ticket/runs/$task"
        params={params}
        search={{ view: "Summary" }}
      >
        {text({ id: "ticket-approval-work-result" })}
      </Link>
      <Link
        to="/$tenant/$project/tickets/$ticket/runs/$task"
        params={params}
        search={{ view: "Details" }}
      >
        {text({ id: "ticket-approval-work-artifacts" })}
      </Link>
    </span>
  );
}

/** One open approval as its own group, named by the step it judges. */
export function TicketApprovalQuestion(props: {
  readonly partition: PartitionIdentity;
  /** The ticket whose work the links reach. */
  readonly ticket: number;
  readonly asked: ApprovalAsked;
  readonly busy: boolean;
  readonly onAnswer: (answer: TicketAction) => void;
}): ReactNode {
  const { asked } = props;
  const text = useCopyText();
  const name = approvalQuestionName(asked, text);
  return (
    <div role="group" aria-label={name} className="grid gap-2">
      <strong>{name}</strong>
      <Fields>
        <Field name={text({ id: "ticket-approval-who" })}>
          <ApprovalApproversDrawn
            partition={props.partition}
            approvers={asked.approvers}
          />
        </Field>
        <Field
          name={text({ id: "ticket-approval-instructions" })}
          absent={asked.instructions === undefined}
        >
          <span className="whitespace-pre-wrap">
            {asked.instructions ??
              text({ id: "ticket-approval-no-instructions" })}
          </span>
        </Field>
        <Field name={text({ id: "ticket-steps-phase-work" })}>
          <ApprovalWork
            partition={props.partition}
            ticket={props.ticket}
            cycle={asked.cycle}
            work={asked.work}
          />
        </Field>
      </Fields>
      {asked.answers.length === 0 ? null : (
        <ApprovalAnswers
          answers={asked.answers}
          busy={props.busy}
          onAnswer={props.onAnswer}
        />
      )}
    </div>
  );
}

/** Every open approval the card holds, each its own question. */
export function TicketApprovals(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly approvals: readonly ApprovalAsked[];
  readonly busy: boolean;
  readonly onAnswer: (answer: TicketAction) => void;
}): ReactNode {
  return props.approvals.map((asked) => (
    <TicketApprovalQuestion
      key={asked.action}
      partition={props.partition}
      ticket={props.ticket}
      asked={asked}
      busy={props.busy}
      onAnswer={props.onAnswer}
    />
  ));
}
