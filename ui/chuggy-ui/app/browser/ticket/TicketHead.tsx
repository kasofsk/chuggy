/**
 * The ticket's own line: what it is, where it is, and what the whole of it has
 * cost.
 *
 * The cost and the token count are the ticket read's own roll-up rather than a
 * sum over the executions this screen holds, because a page that is short would
 * understate them. The run count and the span are this page's, and say so where
 * the page is short. The wall is a pill beside the phase rather than a sentence
 * under it, so where the ticket is and why are read in one glance.
 */

import type { ReactNode } from "react";

import type {
  ExecutionsResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { escalationReasonLabel, phaseLabel } from "../../core/codeLabels.ts";
import { costFigure, spanFigure, tokensFigure } from "../../core/figures.ts";
import { runSpanOf } from "../../core/runTotals.ts";
import type { Ledger } from "../../core/ticketLedger.ts";
import { phaseTone } from "../../core/tones.ts";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Pill } from "../ui/Pill.tsx";
import { runsLabel } from "./ticketPageFacts.ts";

/** What the page holds is not what the ticket has, where the route said so. */
export const headShortPageNote = "on this page";

function TicketFigures(props: {
  readonly ticket: TicketResponse;
  readonly page: ExecutionsResponse | undefined;
  readonly ledger: Ledger | undefined;
  readonly nowMs: number;
}): ReactNode {
  const totals = props.ticket.runTotals;
  const short = props.ledger?.truncated === true;
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
            runSpanOf(props.page?.executions ?? []),
            props.nowMs,
          )}
        />
        {short ? <span className="fig-dim"> {headShortPageNote}</span> : null}
      </Field>
    </Fields>
  );
}

export function TicketHead(props: {
  readonly ticket: TicketResponse;
  readonly intent: string | undefined;
  readonly page: ExecutionsResponse | undefined;
  readonly ledger: Ledger | undefined;
  readonly nowMs: number;
}): ReactNode {
  const reason = props.ticket.reason;
  return (
    <div className="ticket-head">
      <div className="ticket-title">
        <h1>Ticket {props.ticket.ticket}</h1>
        {props.intent === undefined ? null : (
          <p className="ticket-intent">{props.intent}</p>
        )}
      </div>
      <div className="ticket-state">
        <Pill tone={phaseTone(props.ticket.phase)} emphasis>
          {phaseLabel(props.ticket.phase)}
        </Pill>
        {reason === undefined ? null : (
          <Pill tone="parked">{escalationReasonLabel(reason)}</Pill>
        )}
      </div>
      <div className="ticket-figures">
        <TicketFigures
          ticket={props.ticket}
          page={props.page}
          ledger={props.ledger}
          nowMs={props.nowMs}
        />
      </div>
    </div>
  );
}
