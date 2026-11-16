/**
 * A ticket's state where the ticket list draws it: the row's state, as the
 * ticket's own label or as a status badge, and a dependency's number in its
 * state's colours. Where a dispatch is offered the
 * row's state is the button that asks for it, which cannot be pressed while
 * one is going or this tab is offline.
 */

import type { ReactNode } from "react";

import { phaseLabel } from "../../core/codeLabels.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";
import type { TicketPhase } from "../../../../../src/contract/rosters.ts";
import type { TicketListStanding } from "../../core/ticketListView.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import { phaseTone } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { TicketStateLabel } from "./TicketStateLabel.tsx";

import "../ProjectTable.css";

/** What a dependency's chip is drawn as. */
function standingTone(standing: TicketListStanding): Tone {
  if (standing === "Ready") return "pass";
  return standing === "Blocked" ? "queued" : phaseTone(standing);
}

function standingWord(standing: TicketListStanding, text: CopyText): string {
  if (standing === "Ready") return text({ id: "ticket-standing-ready" });
  if (standing === "Blocked") return text({ id: "ticket-verdict-blocked" });
  return text(phaseLabel(standing));
}

export interface TicketStateDispatch {
  readonly busy: boolean;
  readonly offline: boolean;
  readonly effect: string;
  readonly press: () => void;
}

/** What a row's state is drawn as: the ticket's own small label, or the
 * status badge every list shares. */
export type TicketStateChipLook = "Label" | "Badge";

function TicketStateChipDrawn(props: {
  readonly standing: TicketListStanding;
  readonly look: TicketStateChipLook;
}): ReactNode {
  const text = useCopyText();
  if (props.look === "Label")
    return <TicketStateLabel standing={props.standing} size="small" />;
  const label = ticketStateLabelOf(props.standing);
  return (
    <StatusBadge tone={label.tone} size="regular">
      {text(label.word)}
    </StatusBadge>
  );
}

export function TicketStateChip(props: {
  readonly ticket: number;
  readonly standing: TicketListStanding;
  /** What holds the ticket in this state, on hover. */
  readonly hint: string | undefined;
  readonly dispatch?: TicketStateDispatch | undefined;
  readonly look?: TicketStateChipLook | undefined;
}): ReactNode {
  const { standing, dispatch } = props;
  const text = useCopyText();
  const label = (
    <TicketStateChipDrawn standing={standing} look={props.look ?? "Label"} />
  );
  if (dispatch !== undefined)
    return (
      <Tooltip trigger="control" text={dispatch.effect}>
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
      </Tooltip>
    );
  return (
    <Tooltip trigger="abbreviation" text={props.hint}>
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
