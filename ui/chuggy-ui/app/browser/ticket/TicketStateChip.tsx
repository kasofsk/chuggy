/* eslint-disable copy/no-literal-text */
/**
 * A ticket's state where the ticket list draws it: the row's state label, a
 * dependency's number in its state's colours, and each state's count. Where a
 * dispatch is offered the row's label is the button that asks for it.
 */

import type { ReactNode } from "react";

import { phaseLabel } from "../../core/codeLabels.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";
import type { TicketPhase } from "../../../../../src/contract/rosters.ts";
import type { TicketListStanding } from "../../core/ticketListView.ts";
import { phaseTone } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import { Tooltip } from "../ui/Tooltip.tsx";
import { TicketStateLabel } from "./TicketStateLabel.tsx";

import "../ProjectTable.css";

/** What a dependency's chip is drawn as. */
function standingTone(standing: TicketListStanding): Tone {
  if (standing === "Ready") return "pass";
  return standing === "Blocked" ? "queued" : phaseTone(standing);
}

function standingWord(standing: TicketListStanding, text: CopyText): string {
  return standing === "Ready" || standing === "Blocked"
    ? standing
    : text(phaseLabel(standing));
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
  const label = <TicketStateLabel standing={standing} size="small" />;
  if (dispatch !== undefined)
    return (
      <Tooltip text={dispatch.effect}>
        <button
          type="button"
          className="ticket-list-standing"
          data-standing={standing}
          aria-label={`Dispatch ticket #${String(props.ticket)}`}
          aria-busy={dispatch.busy || undefined}
          disabled={dispatch.busy}
          onClick={dispatch.press}
        >
          {label}
        </button>
      </Tooltip>
    );
  return (
    <Tooltip text={props.hint}>
      <span className="ticket-list-standing" data-standing={standing}>
        {label}
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
  const text = useCopyText();
  return (
    <span
      className="ticket-list-state ticket-dependency"
      data-tone={standingTone(props.standing)}
      data-standing={props.standing}
      title={standingWord(props.standing, text)}
    >
      {`#${String(props.ticket)}`}
    </span>
  );
}

/** A state's label holding how many tickets stand in it, as the button that
 * filters the list to it; pressed while it is the filter, dimmed while another
 * filter is, and its number as wide as the widest count beside it. */
export function TicketStateCount(props: {
  readonly standing: TicketListStanding;
  readonly count: number;
  readonly pressed: boolean;
  readonly dimmed?: boolean | undefined;
  /** The widest count drawn beside this one. */
  readonly countWidest?: number | undefined;
  readonly onPress: () => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <button
      type="button"
      className="ticket-state-count"
      data-standing={props.standing}
      data-dimmed={props.dimmed === true || undefined}
      title={standingWord(props.standing, text)}
      aria-pressed={props.pressed}
      onClick={props.onPress}
    >
      <TicketStateLabel standing={props.standing} size="small">
        <b
          className="num"
          data-widest={
            props.countWidest === undefined
              ? undefined
              : String(props.countWidest)
          }
        >
          {props.count}
        </b>
      </TicketStateLabel>
    </button>
  );
}
