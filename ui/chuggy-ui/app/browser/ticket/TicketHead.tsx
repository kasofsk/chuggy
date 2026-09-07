/**
 * The ticket's own line: the top bar's title and standing chip, and — in the
 * body — what the whole of it has cost.
 *
 * The cost and the token count are the ticket read's own roll-up rather than a
 * sum over the executions this screen holds, because a page that is short would
 * understate them. The span begins at the release the journal dates and ends at
 * the last run this page holds, or — where the machine is not working on the
 * ticket now — at the instant the journal last moved it; the run count is this
 * page's, and both say so where the page is short.
 */

import type { ReactNode } from "react";

import type {
  ExecutionsResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { phaseLabel } from "../../core/codeLabels.ts";
import { costFigure, spanFigure, tokensFigure } from "../../core/figures.ts";
import { runSpanOf } from "../../core/runTotals.ts";
import type { RunSpan } from "../../core/runTotals.ts";
import { phaseTone } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { phaseIsRunning, runsLabel } from "./ticketPageFacts.ts";

/** What the page holds is not what the ticket has, where the route said so. */
export const headShortPageNote = "on this page";

/**
 * The ticket's window: the runs this page holds, ended at the instant the
 * journal last moved it where the machine is not working on it now. Only a
 * running ticket has no end, so a settled or parked one whose runs this page
 * has not read is drawn as over rather than as still going.
 */
export function ticketSpanOf(
  ticket: TicketResponse,
  page: ExecutionsResponse | undefined,
): RunSpan {
  const span = runSpanOf(page?.executions ?? []);
  if (phaseIsRunning(ticket.phase)) return span;
  return { from: span.from, to: span.to ?? ticket.changedAt };
}

function TicketFigures(props: {
  readonly ticket: TicketResponse;
  readonly page: ExecutionsResponse | undefined;
  readonly truncated: boolean;
  readonly nowMs: number;
}): ReactNode {
  const totals = props.ticket.runTotals;
  const short = props.truncated;
  return (
    <Fields variant="inline">
      <Field name="Sequence">
        <span className="num">{props.ticket.sequence}</span>
      </Field>
      <Field name="Cost">
        {totals === undefined ? (
          <Figure figure={{ kind: "Absent", why: "No run figures yet" }} />
        ) : (
          <Figure figure={costFigure(totals.costUsdMicros, totals.costBasis)} />
        )}
      </Field>
      <Field name="Tokens">
        {totals === undefined ? (
          <Figure figure={{ kind: "Absent", why: "No run figures yet" }} />
        ) : (
          <Figure figure={tokensFigure(totals)} />
        )}
      </Field>
      <Field name="Runs">
        <span className="num">{runsLabel(props.page)}</span>
        {short ? <span className="fig-dim"> {headShortPageNote}</span> : null}
      </Field>
      <Field name="Span">
        <Figure
          figure={spanFigure(
            ticketSpanOf(props.ticket, props.page),
            props.nowMs,
            props.ticket.releasedAt,
          )}
        />
        {short ? <span className="fig-dim"> {headShortPageNote}</span> : null}
      </Field>
    </Fields>
  );
}

/** The fill a standing dot draws in, total over `Tone` so a hue the wire grows
 * stops compiling rather than drawing nothing. */
function standingDotFill(tone: Tone): string {
  switch (tone) {
    case "pass":
      return "bg-tone-pass";
    case "fail":
      return "bg-tone-fail";
    case "live":
      return "bg-tone-live";
    case "queued":
      return "bg-tone-queued";
    case "parked":
      return "bg-tone-parked";
    case "retired":
      return "bg-tone-retired";
    case "neutral":
      return "bg-ink-3";
  }
}

/** The title and standing chip the top bar draws for a ticket page, the ticket's
 * own title where the read carries one. */
export function TicketTopBar(props: {
  readonly ticket: TicketResponse;
}): ReactNode {
  const ticket = props.ticket;
  return (
    <>
      <h1 className="text-md font-strong text-ink-1 truncate">
        {ticket.title ?? "Ticket"}
      </h1>
      <span className="text-ink-3 text-sm tabular-nums">{ticket.ticket}</span>
      <span className="text-ink-2 flex items-center gap-2 text-sm">
        <i
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-circle block ${standingDotFill(phaseTone(ticket.phase))}`}
        />
        {phaseLabel(ticket.phase)}
      </span>
    </>
  );
}

export function TicketHead(props: {
  readonly ticket: TicketResponse;
  readonly intent: string | undefined;
  readonly page: ExecutionsResponse | undefined;
  readonly truncated: boolean;
  readonly nowMs: number;
}): ReactNode {
  return (
    <div className="grid gap-2">
      {props.intent === undefined ? null : (
        <p className="text-ink-2 truncate">{props.intent}</p>
      )}
      <TicketFigures
        ticket={props.ticket}
        page={props.page}
        truncated={props.truncated}
        nowMs={props.nowMs}
      />
    </div>
  );
}
