/**
 * A ticket's state where the ticket list draws it: the row's state as its
 * status badge, a dependency's number on the badge of the state it stands in,
 * and each state's count on its badge. Where a dispatch is offered the row's
 * state is the button that asks for it, which cannot be pressed while one is
 * going or this tab is offline.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { TicketPhase } from "../../../../../src/contract/rosters.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import type { TicketListStanding } from "../../core/ticketListView.ts";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { TicketStateLabel } from "./TicketStateLabel.tsx";

import "../ProjectTable.css";

export interface TicketStateDispatch {
  readonly busy: boolean;
  readonly offline: boolean;
  readonly press: () => void;
}

export function TicketStateChip(props: {
  readonly ticket: number;
  readonly standing: TicketListStanding;
  readonly dispatch?: TicketStateDispatch | undefined;
}): ReactNode {
  const { standing, dispatch } = props;
  const text = useCopyText();
  const label = <TicketStateLabel standing={standing} size="regular" />;
  if (dispatch !== undefined)
    return (
      <button
        type="button"
        className="ticket-list-standing"
        data-standing={standing}
        aria-label={text({
          id: "ticket-dispatch-aria-label",
          args: { number: String(props.ticket) },
        })}
        aria-busy={dispatch.busy || undefined}
        disabled={dispatch.busy || dispatch.offline}
        onClick={dispatch.press}
      >
        {label}
      </button>
    );
  return (
    <span className="ticket-list-standing" data-standing={standing}>
      {label}
    </span>
  );
}

/** Where a dependency stands: its phase, a pending one being ready or blocked
 * by what it waits on, which is read where the reader holds that and otherwise
 * drawn as blocked. */
export function dependencyStandingOf(
  phase: TicketPhase,
  pending?: TicketListStanding,
): TicketListStanding {
  return phase === "Pending" ? (pending ?? "Blocked") : phase;
}

/** A dependency as its number on the badge of the state it stands in, the
 * state's word on hover or press and as the number's description. */
export function TicketDependencyChip(props: {
  readonly ticket: number;
  readonly standing: TicketListStanding;
}): ReactNode {
  const text = useCopyText();
  const label = ticketStateLabelOf(props.standing);
  return (
    <Tooltip trigger="abbreviation" text={text(label.word)}>
      <span className="ticket-dependency" data-standing={props.standing}>
        <StatusBadge tone={label.tone} size="small">
          {`#${String(props.ticket)}`}
        </StatusBadge>
      </span>
    </Tooltip>
  );
}

/** A state's badge holding how many tickets stand in it, as the button that
 * filters the list to it: pressed while it is the filter, dimmed while another
 * filter is, and named for its state and its figure whole, which assistive
 * technology reads instead of the badge. Compact, it draws its mark and
 * figure, and offers its state's word on hover and focus. */
export function TicketStateCount(props: {
  readonly standing: TicketListStanding;
  readonly count: number;
  readonly pressed: boolean;
  readonly dimmed: boolean;
  readonly compact: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const text = useCopyText();
  const label = ticketStateLabelOf(props.standing);
  const word = text(label.word);
  return (
    <Tooltip trigger="control" text={props.compact ? word : undefined}>
      <button
        type="button"
        className="ticket-state-count"
        data-standing={props.standing}
        data-dimmed={props.dimmed || undefined}
        aria-pressed={props.pressed}
        onClick={props.onPress}
      >
        <span className="ticket-state-count-face" aria-hidden="true">
          <StatusBadge
            tone={label.tone}
            size="regular"
            compact={props.compact}
            figure={String(props.count)}
          >
            {word}
          </StatusBadge>
        </span>
        <span className="visually-hidden">
          {text({
            id: "project-table-state-count",
            args: { state: word, count: props.count },
          })}
        </span>
      </button>
    </Tooltip>
  );
}
