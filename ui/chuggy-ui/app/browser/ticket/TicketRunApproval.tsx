/**
 * An approval's run as the Runs tab and its own page draw it: waiting on a
 * person, answered — approved or rejected, by whom and when, with what they
 * said as its result — or withdrawn unanswered. Nothing here is a runner's: no wait for a slot, no
 * transcript, no spend.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  ExecutionSummary,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy } from "../../core/copy.ts";
import {
  approvalAnsweredLine,
  approvalHappened,
  approvalStandingOf,
} from "../../core/evaluationApprovals.ts";
import { sinceFigure } from "../../core/figures.ts";
import { creatorLabel } from "../../core/labels.ts";
import { runReasonOf } from "../../core/runReason.ts";
import { useCreatorEmails } from "../creatorEmails.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";

type ApprovalAnswered = NonNullable<
  NonNullable<ExecutionResponse["result"]>["approval"]
>;

/** Who answered, in the words their answer was. */
function ApprovalAnsweredBy(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
  readonly answered: ApprovalAnswered;
}): ReactNode {
  const text = useCopyText();
  const emails = useCreatorEmails(props.partition);
  const line = approvalAnsweredLine(props.read);
  if (line === undefined) return null;
  return (
    <>
      {text(line)}{" "}
      <Identity label={creatorLabel(props.answered.principal, emails)} />
    </>
  );
}

/** What an approval that holds no answer says in its answer's place: that it
 * waits on a person, or that it was withdrawn without one. */
function ticketRunApprovalUnanswered(read: ExecutionResponse): Copy {
  return approvalStandingOf(read) === "Withdrawn"
    ? { id: "ticket-approval-withdrawn" }
    : { id: "ticket-approval-waiting" };
}

/** An approval's row line: who answered and the opening of what they said,
 * that it waits on a person, or that it was withdrawn. */
export function TicketRunApprovalLine(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
}): ReactNode {
  const text = useCopyText();
  const answered = props.read.result?.approval;
  if (answered === undefined)
    return text(ticketRunApprovalUnanswered(props.read));
  const said =
    answered.feedback === undefined
      ? undefined
      : runReasonOf(answered.feedback)?.line;
  return (
    <>
      <ApprovalAnsweredBy
        partition={props.partition}
        read={props.read}
        answered={answered}
      />
      {said === undefined ? null : ` · ${said}`}
    </>
  );
}

/** When an approval was asked, while it waits, and when it was answered or
 * withdrawn after. */
export function TicketRunApprovalTime(props: {
  readonly execution: ExecutionSummary;
  readonly nowMs: number;
}): ReactNode {
  const { at, happened } = approvalHappened(props.execution);
  return (
    <span className="ticket-run-time">
      <span className="ticket-run-time-main">
        <Figure figure={sinceFigure(at, props.nowMs, happened)} />
      </span>
    </span>
  );
}

/** An approval's Summary: who answered, when, and their feedback whole. */
export function TicketRunApprovalSummary(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const answered = props.read.result?.approval;
  if (answered === undefined)
    return <EmptyState label={text(ticketRunApprovalUnanswered(props.read))} />;
  return (
    <div className="grid gap-2">
      <p className="ticket-run-meta">
        <span>
          <ApprovalAnsweredBy
            partition={props.partition}
            read={props.read}
            answered={answered}
          />
        </span>
        <Figure
          figure={sinceFigure(answered.answeredAt, props.nowMs, {
            id: "figures-happened-answered",
          })}
        />
      </p>
      {answered.feedback === undefined ? null : (
        <p className="whitespace-pre-wrap">{answered.feedback}</p>
      )}
    </div>
  );
}
