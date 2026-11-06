/**
 * A ticket's state as one label: its word, its tone and its mark, never a
 * button. The page's size heads the ticket; the small one sits in a bar.
 */

import type { ReactNode } from "react";

import type { TicketStateLabelMark } from "../../core/ticketHeader.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import type { TicketListStanding } from "../../core/ticketListView.ts";

import "./ticket.css";

export type TicketStateLabelSize = "page" | "small";

function TicketStateMarkPaths(props: {
  readonly mark: TicketStateLabelMark;
}): ReactNode {
  switch (props.mark) {
    case "Dot":
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="2" className="ticket-state-filled-path" />
        </>
      );
    case "Slash":
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M3.8 12.2 L12.2 3.8" />
        </>
      );
    case "Spin":
      return (
        <>
          <circle cx="8" cy="8" r="6" className="ticket-state-track" />
          <path d="M8 2 A6 6 0 0 1 14 8" />
        </>
      );
    case "Alert":
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.8 V8.6 M8 11 V11.2" />
        </>
      );
    case "Check":
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M5.3 8.2 L7.2 10 L10.8 6.2" />
        </>
      );
    case "Cross":
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M5.9 5.9 L10.1 10.1 M10.1 5.9 L5.9 10.1" />
        </>
      );
  }
}

export function TicketStateLabel(props: {
  readonly standing: TicketListStanding;
  readonly size: TicketStateLabelSize;
}): ReactNode {
  const label = ticketStateLabelOf(props.standing);
  return (
    <span
      className="ticket-state"
      data-size={props.size}
      data-form={label.form === "Filled" ? "filled" : "tinted"}
      data-tone={label.tone}
      data-standing={label.standing}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="ticket-state-mark"
        data-spins={label.mark === "Spin" || undefined}
      >
        <TicketStateMarkPaths mark={label.mark} />
      </svg>
      {label.word}
    </span>
  );
}
