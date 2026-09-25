/**
 * The ticket's status bar: where it stands and since when, what it has run and
 * cost, and what may be done to it, tinted by the tone of where it stands.
 *
 * The cost and the token count are the ticket read's own roll-up rather than a
 * sum over the executions this page holds, because a page that is short would
 * understate them; the run count is this page's, and says so where it is short.
 */

import type { ReactNode } from "react";

import type {
  ExecutionsResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { phaseLabel } from "../../core/codeLabels.ts";
import { costFigure, tokensFigure } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import { runsLabel } from "../../core/ticketPageFacts.ts";
import {
  ticketStatusFigure,
  ticketStatusTone,
} from "../../core/ticketSituation.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { standingDotFill } from "./TicketHead.tsx";

import "./ticket.css";

/** What the page holds is not what the ticket has, where the route said so. */
export const shortPageNote = "on this page";

function StatusStanding(props: {
  readonly ticket: TicketResponse;
  readonly page: ExecutionsResponse | undefined;
  readonly resumed: string | undefined;
  readonly nowMs: number;
}): ReactNode {
  const ticket = props.ticket;
  return (
    <div className="ticket-status-standing">
      <i
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-circle block ${standingDotFill(ticketStatusTone(ticket))}`}
      />
      <strong className="text-lg font-strong text-ink-1">
        {phaseLabel(ticket.phase)}
      </strong>
      <span className="ticket-status-line">
        <Figure
          figure={ticketStatusFigure(
            ticket,
            props.page?.executions ?? [],
            props.nowMs,
          )}
        />
        {props.resumed === undefined ? null : (
          <>
            <i className="fig-sep" aria-hidden="true">
              ·
            </i>
            {props.resumed}
          </>
        )}
      </span>
    </div>
  );
}

function StatusFigures(props: {
  readonly ticket: TicketResponse;
  readonly page: ExecutionsResponse | undefined;
  readonly truncated: boolean;
}): ReactNode {
  const totals = props.ticket.runTotals;
  const absent = { kind: "Absent", why: "No run figures yet" } as const;
  return (
    <div className="ticket-status-figures">
      <Fields>
        <Field name="Runs">
          <span className="num">{runsLabel(props.page)}</span>
          {props.truncated ? (
            <span className="fig-dim"> {shortPageNote}</span>
          ) : null}
        </Field>
        <Field name="Cost">
          <Figure
            figure={
              totals === undefined
                ? absent
                : costFigure(totals.costUsdMicros, totals.costBasis)
            }
          />
        </Field>
        <Field name="Tokens">
          <Figure
            figure={totals === undefined ? absent : tokensFigure(totals)}
          />
        </Field>
      </Fields>
    </div>
  );
}

export function TicketStatus(props: {
  readonly state: PanelState<TicketResponse>;
  readonly page: ExecutionsResponse | undefined;
  readonly resumed: string | undefined;
  readonly truncated: boolean;
  readonly nowMs: number;
  readonly actions: ReactNode;
}): ReactNode {
  const state = props.state;
  if (state.state !== "Ready")
    return (
      <section className="ticket-status" aria-label="Status">
        <PanelUnready state={state} />
      </section>
    );
  return (
    <section
      className="ticket-status"
      data-tone={ticketStatusTone(state.value)}
      aria-label="Status"
    >
      <StatusStanding
        ticket={state.value}
        page={props.page}
        resumed={props.resumed}
        nowMs={props.nowMs}
      />
      <StatusFigures
        ticket={state.value}
        page={props.page}
        truncated={props.truncated}
      />
      <div className="ticket-status-actions">{props.actions}</div>
    </section>
  );
}
