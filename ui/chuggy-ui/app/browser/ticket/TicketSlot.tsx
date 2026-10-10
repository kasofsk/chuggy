/**
 * The one card under the status bar: the run going now, what the ticket is
 * waiting on a person for, or nothing.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { EscalationStep } from "../../core/codeLabels.ts";
import { navRoutes } from "../../core/shellNav.ts";
import type { TicketSlot as Slot } from "../../core/ticketSituation.ts";
import { TicketNow } from "./TicketNow.tsx";

import "./ticket.css";

/** The page the way past the wait is on, after the line that names the wait. */
function NeedsYouStep(props: {
  readonly partition: PartitionIdentity;
  readonly step: EscalationStep | undefined;
}): ReactNode {
  if (props.step === undefined) return null;
  return (
    <span className="text-md text-ink-3">
      {" · "}
      <Link to={navRoutes.runners} params={props.partition}>
        Runners
      </Link>
    </span>
  );
}

function NeedsYou(props: {
  readonly partition: PartitionIdentity;
  readonly detail: string;
  readonly step: EscalationStep | undefined;
  readonly more: string | undefined;
  readonly overrides: ReactNode;
  readonly actions: ReactNode;
}): ReactNode {
  return (
    <section
      className="ticket-card ticket-card-asking"
      aria-label="Needs you"
      role="status"
    >
      <span className="eyebrow text-tone-parked">Needs you</span>
      <p className="text-lg text-ink-1">
        {props.detail}
        <NeedsYouStep partition={props.partition} step={props.step} />
      </p>
      {props.more === undefined ? null : (
        <p className="text-ink-3">{props.more}</p>
      )}
      {props.overrides}
      <div className="ticket-card-actions">{props.actions}</div>
    </section>
  );
}

export function TicketSlot(props: {
  readonly partition: PartitionIdentity;
  readonly slot: Slot;
  /** What the card offers of the ticket's overrides, where it offers any. */
  readonly overrides?: ReactNode;
  readonly actions: ReactNode;
  readonly nowMs: number;
}): ReactNode {
  const slot = props.slot;
  switch (slot.slot) {
    case "NeedsYou":
      return (
        <NeedsYou
          partition={props.partition}
          detail={slot.detail}
          step={slot.step}
          more={slot.more}
          overrides={props.overrides}
          actions={props.actions}
        />
      );
    case "Now":
      return (
        <TicketNow
          partition={props.partition}
          running={slot.running}
          nowMs={props.nowMs}
        />
      );
    case "Nothing":
      return null;
  }
}
