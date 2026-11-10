/**
 * A ticket on an epic's graph, as a card of the size `core/epicGraph.ts` gives
 * it: its state's mark, its number, its place in a landing queue where it has
 * one, its state's word, and two lines of its title. The card is a button
 * that selects the ticket; hovering or focusing it traces its chain. A ticket
 * outside the epic is a smaller, dashed card, so which tickets the epic holds
 * does not rest on hue alone.
 */

import type { KeyboardEvent, ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { EpicGraphTicket } from "../../core/epicGraph.ts";
import type { LandingQueuePlace } from "../../core/landingQueues.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import { LandingQueueChip } from "../ticket/LandingQueueChip.tsx";
import { TicketStateMark } from "../ticket/TicketStateLabel.tsx";

import "./epicGraph.css";

/** Whether a card stands in the chain being traced, or out of it; none while
 * nothing is traced. */
export type EpicGraphTraceMark = "Lit" | "Dim" | undefined;

export function epicGraphTraceAttribute(
  mark: EpicGraphTraceMark,
): "lit" | "dim" | undefined {
  return mark === undefined ? undefined : mark === "Lit" ? "lit" : "dim";
}

export function EpicGraphCard(props: {
  readonly ticket: EpicGraphTicket;
  readonly selected: boolean;
  readonly trace: EpicGraphTraceMark;
  readonly place: LandingQueuePlace | undefined;
  readonly onSelect: (ticket: number) => void;
  readonly onTrace: (ticket: number | undefined) => void;
}): ReactNode {
  const text = useCopyText();
  const { node, standing } = props.ticket;
  const label = ticketStateLabelOf(standing);
  const title = node.title ?? text({ id: "epics-card-untitled" });
  const state = text(label.word);
  const ticket = String(node.ticket);
  const selected = () => {
    props.onSelect(node.ticket);
  };
  return (
    <div
      className="epic-card"
      data-ticket={node.ticket}
      data-member={node.member ? "" : undefined}
      data-outside={node.member ? undefined : ""}
      data-tone={label.tone}
      data-standing={standing}
      data-trace={epicGraphTraceAttribute(props.trace)}
    >
      <button
        type="button"
        className="epic-card-button"
        aria-pressed={props.selected}
        aria-label={text({
          id: node.member ? "epics-card" : "epics-card-outside",
          args: { ticket, title, state },
        })}
        title={title}
        onClick={selected}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          selected();
        }}
        onMouseEnter={() => {
          props.onTrace(node.ticket);
        }}
        onMouseLeave={() => {
          props.onTrace(undefined);
        }}
        onFocus={() => {
          props.onTrace(node.ticket);
        }}
        onBlur={() => {
          props.onTrace(undefined);
        }}
      >
        <span className="epic-card-head">
          <span className="epic-card-mark">
            <TicketStateMark standing={standing} />
          </span>
          <span className="epic-card-number">{`#${ticket}`}</span>
          <LandingQueueChip place={props.place} inLink />
          <span className="epic-card-word">{state}</span>
        </span>
        <span className="epic-card-title">{title}</span>
      </button>
    </div>
  );
}
