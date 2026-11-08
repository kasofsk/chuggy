/**
 * The one card the Overview leads with: the run going now, what the ticket is
 * waiting on a person for, or nothing. What answers it is the header's.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { EscalationStep } from "../../core/codeLabels.ts";
import { navRoutes } from "../../core/shellNav.ts";
import type {
  NeedsYouRun,
  ReasonAttempt,
  TicketSlot as Slot,
} from "../../core/ticketSituation.ts";
import { RunReasonText, useRunReason } from "../RunEvidence.tsx";
import { Chevron } from "../ui/Chevron.tsx";
import { TicketNow } from "./TicketNow.tsx";
import { TicketRunMarkDrawn } from "./TicketRunMark.tsx";
import { TicketRunLine } from "./TicketRuns.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

import "./ticket.css";

/** The page the way past the wait is on, after the line that names the wait. */
function NeedsYouStep(props: {
  readonly partition: PartitionIdentity;
  readonly step: EscalationStep | undefined;
}): ReactNode {
  if (props.step === undefined) return null;
  return (
    <span className="ticket-card-where">
      <Link
        to={
          props.step === "Runners" ? navRoutes.runners : navRoutes.repositories
        }
        params={props.partition}
      >
        {props.step}
      </Link>
    </span>
  );
}

/** The first line of what the worker of a lost or stopped job kept, its whole below it. */
function NeedsYouReason(props: {
  readonly partition: PartitionIdentity;
  readonly reason: ReasonAttempt;
}): ReactNode {
  const reason = useRunReason(
    props.partition,
    props.reason.execution,
    props.reason.attempt,
  );
  return reason === undefined ? null : (
    <>
      <p className="ticket-card-reason">{reason.line}</p>
      <RunReasonText
        partition={props.partition}
        execution={props.reason.execution}
        attempt={props.reason.attempt}
      />
    </>
  );
}

/** The run the ticket stopped at: its one line, where the worker's own
 * reason does not stand in for it, and the link to its page. */
function NeedsYouRunLine(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly run: NeedsYouRun;
  readonly reasoned: boolean;
}): ReactNode {
  const text = useCopyText();
  const step = props.run.step ?? text({ id: "ticket-term-run" });
  return (
    <p className="ticket-card-line">
      {props.reasoned ? null : (
        <TicketRunLine
          partition={props.partition}
          execution={props.run.execution}
        />
      )}{" "}
      <Link
        to="/$tenant/$project/tickets/$ticket/runs/$task"
        params={{
          ...props.partition,
          ticket: String(props.ticket),
          task: String(props.run.task),
        }}
        className="ticket-card-link"
      >
        {text({ id: "ticket-situation-read-the", args: { step } })}
        <Chevron className="ticket-card-chevron" />
      </Link>
    </p>
  );
}

function NeedsYou(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly slot: Extract<Slot, { slot: "NeedsYou" }>;
  readonly overrides: ReactNode;
}): ReactNode {
  const { slot } = props;
  const text = useCopyText();
  return (
    <section
      className="ticket-card"
      data-tone="parked"
      aria-label={text({ id: "ticket-needs-you-aria-label" })}
      role="status"
    >
      <div className="ticket-card-head">
        <TicketRunMarkDrawn mark="Alert" tone="parked" />
        <strong className="ticket-card-title">{slot.detail}</strong>
        {slot.where === undefined ? null : (
          <span className="ticket-card-where">{slot.where}</span>
        )}
        <NeedsYouStep partition={props.partition} step={slot.step} />
      </div>
      {slot.reason === undefined ? null : (
        <NeedsYouReason partition={props.partition} reason={slot.reason} />
      )}
      {slot.run === undefined ? null : (
        <NeedsYouRunLine
          partition={props.partition}
          ticket={props.ticket}
          run={slot.run}
          reasoned={slot.reason !== undefined}
        />
      )}
      {slot.more === undefined ? null : (
        <p className="ticket-card-more">{slot.more}</p>
      )}
      {props.overrides}
    </section>
  );
}

export function TicketSlot(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly slot: Slot;
  /** What the card offers of the ticket's overrides, where it offers any. */
  readonly overrides?: ReactNode;
  readonly nowMs: number;
}): ReactNode {
  const slot = props.slot;
  switch (slot.slot) {
    case "NeedsYou":
      return (
        <NeedsYou
          partition={props.partition}
          ticket={props.ticket}
          slot={slot}
          overrides={props.overrides}
        />
      );
    case "Now":
      return (
        <TicketNow
          partition={props.partition}
          ticket={props.ticket}
          running={slot.running}
          nowMs={props.nowMs}
        />
      );
    case "Nothing":
      return null;
  }
}
