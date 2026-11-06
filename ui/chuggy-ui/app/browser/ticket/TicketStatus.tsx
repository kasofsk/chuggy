/**
 * The ticket's status bar: where it stands and since when, what it has cost,
 * what may be done to it, and under that what the ticket is.
 *
 * The cost and the token count are the ticket read's own roll-up rather than a
 * sum over the executions this page holds, because a page that is short would
 * understate them.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ExecutionsResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { costFigure, tokensFigure } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import { ticketStatusFigure } from "../../core/ticketSituation.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { TicketMeta } from "./TicketMeta.tsx";

import "./ticket.css";

/** What follows the figure: a fragment of its own, after a separator. */
function StatusFollowing(props: { readonly children: ReactNode }): ReactNode {
  return (
    <>
      <i className="fig-sep" aria-hidden="true">
        ·
      </i>
      {props.children}
    </>
  );
}

function StatusFigures(props: {
  readonly ticket: TicketResponse;
  readonly page: ExecutionsResponse | undefined;
  readonly resumed: string | undefined;
  readonly landing: ReactNode;
  readonly nowMs: number;
}): ReactNode {
  const totals = props.ticket.runTotals;
  const absent = { kind: "Absent", why: "No run figures yet" } as const;
  return (
    <div className="ticket-status-figures">
      <Fields>
        <Field name="Last activity">
          <span className="ticket-status-line">
            <Figure
              figure={ticketStatusFigure(
                props.ticket,
                props.page?.executions ?? [],
                props.nowMs,
              )}
            />
            {props.resumed === undefined ? null : (
              <StatusFollowing>{props.resumed}</StatusFollowing>
            )}
            {props.landing === null ? null : (
              <StatusFollowing>{props.landing}</StatusFollowing>
            )}
          </span>
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
  readonly partition: PartitionIdentity;
  readonly state: PanelState<TicketResponse>;
  readonly page: ExecutionsResponse | undefined;
  readonly resumed: string | undefined;
  /** The current landing's fragment while the ticket is finalizing, or null. */
  readonly landing: ReactNode;
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
    <section className="ticket-status" aria-label="Status">
      <div className="ticket-status-actions">{props.actions}</div>
      <StatusFigures
        ticket={state.value}
        page={props.page}
        resumed={props.resumed}
        landing={props.landing}
        nowMs={props.nowMs}
      />
      <TicketMeta
        partition={props.partition}
        ticket={state.value}
        nowMs={props.nowMs}
      />
    </section>
  );
}
