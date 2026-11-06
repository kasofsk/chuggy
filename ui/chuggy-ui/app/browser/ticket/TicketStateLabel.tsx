/**
 * A ticket's state as one label: its word, its tone and its mark, never a
 * button. The page's size heads the ticket; the small one sits in a bar or a
 * row, and what the label is given follows its word.
 */

import type { ReactNode } from "react";

import type {
  TicketStateLabelForm,
  TicketStateLabelMark,
  TicketStateStanding,
} from "../../core/ticketHeader.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";

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
    case "Pencil":
      return (
        <path d="M10.6 2.6 L13.4 5.4 L5.6 13.2 L2.6 13.4 L2.8 10.4 Z M9.2 4 L12 6.8" />
      );
  }
}

const ticketStateFormAttributes = {
  Filled: "filled",
  Tinted: "tinted",
  Outlined: "outlined",
} as const satisfies Record<TicketStateLabelForm, string>;

export function TicketStateLabel(props: {
  readonly standing: TicketStateStanding;
  readonly size: TicketStateLabelSize;
  readonly children?: ReactNode;
}): ReactNode {
  const label = ticketStateLabelOf(props.standing);
  return (
    <span
      className="ticket-state"
      data-size={props.size}
      data-form={ticketStateFormAttributes[label.form]}
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
      <span className="ticket-state-word">{label.word}</span>
      {props.children}
    </span>
  );
}
