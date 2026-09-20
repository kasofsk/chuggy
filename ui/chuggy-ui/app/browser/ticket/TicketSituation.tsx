/**
 * What this ticket is and what it is doing now: the state in the reader's own
 * tense, the facts the release fixed, and the cycles it is metered by.
 *
 * THE MACHINE'S WORDS ARE NOT THE READER'S. `Work` and `Evaluation` name what
 * the machine is holding; a reader is asking what the ticket is doing, so the
 * heading and the line under it come from `codeLabels.ts` and
 * `codeSentences.ts` — the one place either roster is spoken for.
 *
 * THE SPAN IS OVER THE RUNS THIS PAGE READ, and says so where the read may
 * have been cut short. The ticket read carries no instant of its own, so there
 * is no release date to open the span at and none is invented.
 */

import type { ReactNode } from "react";

import type { AdoptedTicket } from "../../../../../src/contract/adoptedTickets.ts";
import type { AdoptedExecution } from "../../core/adoptedExecutions.ts";
import {
  adoptedExecutionRunsLabel,
  adoptedTicketStateLabel,
  adoptedTicketWord,
} from "../../core/codeLabels.ts";
import { adoptedTicketStateSentence } from "../../core/codeSentences.ts";
import { countFigure, spanFigure } from "../../core/figures.ts";
import { runSpanOf } from "../../core/runTotals.ts";
import { reworkMeterHow, reworkMeterOf } from "../../core/ticketMeter.ts";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { ReworkMeter } from "./ReworkMeter.tsx";

/** What the page counted rather than what the machine holds, said wherever a
 * figure here is a floor over a page that came back full. */
export const situationShortPageNote = "on this page";

const reworkMeterName = "Work cycles";

/** A notice a reader is meant to stop on is one whose state stopped the machine. */
function situationTone(
  state: AdoptedTicket["state"],
): "info" | "live" | "parked" {
  switch (state) {
    case "Work":
    case "Evaluation":
    case "Finalization":
      return "live";
    case "Escalated":
      return "parked";
    case "Pending":
    case "Done":
    case "Revoked":
      return "info";
  }
}

/**
 * The one extra line under the sentence: that the release has no cycle left to
 * spend. It is absent for every other state rather than filled with something
 * the read cannot support.
 */
function situationMore(ticket: AdoptedTicket): string | undefined {
  const meter = reworkMeterOf(ticket, reworkMeterName);
  if (meter.state === "AtLimit")
    return "This is the last work cycle the release allows.";
  if (meter.state === "Over")
    return "More cycles have started than the release allows.";
  return undefined;
}

export function TicketSituation(props: {
  readonly ticket: AdoptedTicket;
  readonly executions: readonly AdoptedExecution[] | undefined;
  readonly short: boolean;
  readonly nowMs: number;
}): ReactNode {
  const ticket = props.ticket;
  const more = situationMore(ticket);
  return (
    <Notice
      tone={situationTone(ticket.state)}
      role="status"
      heading={adoptedTicketStateLabel(ticket.state)}
      detail={adoptedTicketStateSentence(ticket.state)}
      {...(more === undefined ? {} : { more })}
    >
      {props.executions === undefined ? null : (
        <p className="pt-1">
          <Figure
            figure={spanFigure(runSpanOf(props.executions), props.nowMs)}
          />
          {props.short ? (
            <span className="fig-dim"> {situationShortPageNote}</span>
          ) : null}
        </p>
      )}
    </Notice>
  );
}

function SituationRuns(props: {
  readonly executions: readonly AdoptedExecution[] | undefined;
  readonly short: boolean;
}): ReactNode {
  if (props.executions === undefined)
    return (
      <Field name="Runs" absent>
        Not read
      </Field>
    );
  return (
    <Field name="Runs">
      <span className="num">{adoptedExecutionRunsLabel(props.executions)}</span>
      {props.short ? (
        <span className="fig-dim"> {situationShortPageNote}</span>
      ) : null}
    </Field>
  );
}

/** The facts the release fixed, and the meter the machine holds the ticket to. */
export function TicketFacts(props: {
  readonly ticket: AdoptedTicket;
  readonly executions: readonly AdoptedExecution[] | undefined;
  readonly short: boolean;
}): ReactNode {
  const ticket = props.ticket;
  return (
    <Panel title="Facts" level={2}>
      <div className="grid gap-4">
        <Fields variant="inline">
          <Field name="Ticket">
            <span className="num">{adoptedTicketWord(ticket.ticket)}</span>
          </Field>
          <Field name="Revision">
            <Figure figure={countFigure(ticket.revision, "rev")} />
          </Field>
          <Field
            name="Dependencies"
            {...(ticket.dependencies.length === 0 ? { absent: true } : {})}
          >
            {ticket.dependencies.length === 0
              ? "none"
              : ticket.dependencies.map(adoptedTicketWord).join(", ")}
          </Field>
          <SituationRuns executions={props.executions} short={props.short} />
        </Fields>
        <ReworkMeter
          name={reworkMeterName}
          meter={reworkMeterOf(ticket, reworkMeterName)}
          how={reworkMeterHow}
        />
      </div>
    </Panel>
  );
}
