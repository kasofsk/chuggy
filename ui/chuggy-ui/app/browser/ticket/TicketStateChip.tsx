/**
 * A ticket's state as one chip, as wide wherever it is drawn: the ticket list's
 * row and the ticket page's action bar. Where a dispatch is offered the chip is
 * the button that asks for it.
 */

import type { ReactNode } from "react";

import { phaseLabel } from "../../core/codeLabels.ts";
import type { TicketPhase } from "../../../../../src/contract/rosters.ts";
import type { TicketListStanding } from "../../core/ticketListView.ts";
import { phaseTone } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import { Tooltip } from "../ui/Tooltip.tsx";

import "../ProjectTable.css";

/** What the chip is drawn as. */
function standingTone(standing: TicketListStanding): Tone {
  if (standing === "Ready") return "pass";
  return standing === "Blocked" ? "queued" : phaseTone(standing);
}

function standingWord(standing: TicketListStanding): string {
  return standing === "Ready" || standing === "Blocked"
    ? standing
    : phaseLabel(standing);
}

export interface TicketStateDispatch {
  readonly busy: boolean;
  readonly effect: string;
  readonly press: () => void;
}

export function TicketStateChip(props: {
  readonly ticket: number;
  readonly standing: TicketListStanding;
  /** What holds the ticket in this state, on hover. */
  readonly hint: string | undefined;
  readonly dispatch?: TicketStateDispatch | undefined;
}): ReactNode {
  const { standing, dispatch } = props;
  if (dispatch !== undefined)
    return (
      <Tooltip text={dispatch.effect}>
        <button
          type="button"
          className="ticket-list-state"
          data-tone={standingTone(standing)}
          data-standing={standing}
          aria-label={`Dispatch ticket #${String(props.ticket)}`}
          aria-busy={dispatch.busy || undefined}
          disabled={dispatch.busy}
          onClick={dispatch.press}
        >
          {standingWord(standing)}
        </button>
      </Tooltip>
    );
  return (
    <Tooltip text={props.hint}>
      <span
        className="ticket-list-state"
        data-tone={standingTone(standing)}
        data-standing={standing}
      >
        {standingWord(standing)}
      </span>
    </Tooltip>
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

/** A dependency as its number in the colours of the state it stands in. */
export function TicketDependencyChip(props: {
  readonly ticket: number;
  readonly standing: TicketListStanding;
}): ReactNode {
  return (
    <span
      className="ticket-list-state ticket-dependency"
      data-tone={standingTone(props.standing)}
      data-standing={props.standing}
      title={standingWord(props.standing)}
    >
      {`#${String(props.ticket)}`}
    </span>
  );
}

/** A state and how many tickets stand in it, in that state's colours. */
export function TicketStateCount(props: {
  readonly standing: TicketListStanding;
  readonly count: number;
}): ReactNode {
  return (
    <span
      className="ticket-list-state ticket-state-count"
      data-tone={standingTone(props.standing)}
      data-standing={props.standing}
      title={standingWord(props.standing)}
    >
      <span className="ticket-state-count-label">
        {standingWord(props.standing)}
      </span>
      <b className="num">{props.count}</b>
    </span>
  );
}
