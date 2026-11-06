/**
 * The mark a run, a landing or a step not reached is drawn with: a ring
 * holding a check, a cross, an alert or a slash, a spinning arc, a dashed ring
 * for one that has not run, and the merge mark for a landing.
 */

import type { ReactNode } from "react";

import type { TicketRunMark } from "../../core/ticketRuns.ts";
import type { Tone } from "../../core/tones.ts";

import "./ticket.css";

function TicketRunMarkPaths(props: {
  readonly mark: TicketRunMark;
}): ReactNode {
  switch (props.mark) {
    case "Check":
      return <path d="M5.3 8.2 L7.2 10 L10.8 6.2" />;
    case "Cross":
      return <path d="M5.9 5.9 L10.1 10.1 M10.1 5.9 L5.9 10.1" />;
    case "Spin":
      return <path d="M8 2 A6 6 0 0 1 14 8" />;
    case "Alert":
      return <path d="M8 4.8 V8.6 M8 11 V11.2" />;
    case "Slash":
      return <path d="M3.8 12.2 L12.2 3.8" />;
    case "Open":
    case "Merge":
      return null;
  }
}

/** A run's status as a mark, its word left to the row or the pill beside it;
 * a step with no state to mark draws none. */
export function TicketRunMarkDrawn(props: {
  readonly mark: TicketRunMark | undefined;
  readonly tone: Tone;
}): ReactNode {
  if (props.mark === undefined)
    return <span className="ticket-run-mark" aria-hidden="true" />;
  const ring = props.mark !== "Merge";
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="ticket-run-mark"
      data-tone={props.tone}
      data-mark={props.mark}
    >
      {props.mark === "Merge" ? (
        <>
          <circle cx="5" cy="3.5" r="1.6" />
          <circle cx="5" cy="12.5" r="1.6" />
          <circle cx="11.5" cy="8" r="1.6" />
          <path d="M5 5.1 V10.9 M5 5.1 C5 7.5 7.5 8 9.9 8" />
        </>
      ) : null}
      {ring ? (
        <circle
          cx="8"
          cy="8"
          r="6"
          className={props.mark === "Spin" ? "ticket-run-track" : undefined}
        />
      ) : null}
      <TicketRunMarkPaths mark={props.mark} />
    </svg>
  );
}
