/**
 * The one card under the status bar: the run going now, what the ticket is
 * waiting on a person for, or nothing.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { TicketSlot as Slot } from "../../core/ticketSituation.ts";
import { TicketNow } from "./TicketNow.tsx";

import "./ticket.css";

function NeedsYou(props: {
  readonly detail: string;
  readonly more: string | undefined;
  readonly actions: ReactNode;
}): ReactNode {
  return (
    <section
      className="ticket-card ticket-card-asking"
      aria-label="Needs you"
      role="status"
    >
      <span className="eyebrow text-tone-parked">Needs you</span>
      <p className="text-lg text-ink-1">{props.detail}</p>
      {props.more === undefined ? null : (
        <p className="text-ink-3">{props.more}</p>
      )}
      <div className="ticket-card-actions">{props.actions}</div>
    </section>
  );
}

export function TicketSlot(props: {
  readonly partition: PartitionIdentity;
  readonly slot: Slot;
  readonly actions: ReactNode;
  readonly nowMs: number;
}): ReactNode {
  const slot = props.slot;
  switch (slot.slot) {
    case "NeedsYou":
      return (
        <NeedsYou
          detail={slot.detail}
          more={slot.more}
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
