/**
 * A ticket's state where the ticket list draws it: the row's state as its
 * status badge, and a dependency's number on the badge of the state it stands
 * in. Where a dispatch is offered the row's state is the button that asks for
 * it, which cannot be pressed while one is going or this tab is offline.
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
