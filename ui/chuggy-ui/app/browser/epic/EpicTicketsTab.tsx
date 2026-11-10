/**
 * The epic page's Tickets tab: each member, lowest number first, drawn as the
 * ticket list draws a ticket from the row the layout read under the epic's
 * filter. A member with no row there, a draft, is drawn by its number, its
 * title and the state the graph says.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { EpicGraphResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { epicGraphStandingOf } from "../../core/epics.ts";
import { projectTableRow } from "../../core/projectTableRows.ts";
import { ticketListStandingOf } from "../../core/ticketListView.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { TicketListRow } from "../ProjectTable.tsx";
import { TicketTitleNumber, TicketTitleWords } from "../TicketCells.tsx";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { TicketStateChip } from "../ticket/TicketStateChip.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Pill } from "../ui/Pill.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";

import "../ProjectTable.css";

/** The state of a ticket the ticket list holds no row of, as the graph says
 * it, and a draft's word where it was never released. */
function EpicTicketsNodeState(props: {
  readonly node: EpicGraphResponse["nodes"][number];
  readonly graph: EpicGraphResponse;
}): ReactNode {
  const text = useCopyText();
  const standing = epicGraphStandingOf(props.node, props.graph);
  return standing === undefined ? (
    <Pill tone="neutral">{text({ id: "standing-draft" })}</Pill>
  ) : (
    <TicketStateChip
      ticket={props.node.ticket}
      standing={standing}
      hint={undefined}
    />
  );
}

/** A member the rows do not hold, drawn by its number and title, and by its
 * state where the graph holds it. */
function EpicTicketsUnheld(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly graph: EpicGraphResponse | undefined;
}): ReactNode {
  const { graph } = props;
  const node = graph?.nodes.find((held) => held.ticket === props.ticket);
  return (
    <li className="ticket-list-item" data-ticket={props.ticket}>
      <article className="ticket-list-row">
        <div className="ticket-list-head">
          <h3 className="ticket-list-title">
            <TicketTitleWords
              partition={props.partition}
              ticket={props.ticket}
              title={node?.title}
            />
          </h3>
          <div className="ticket-list-info">
            <span className="ticket-list-number">
              <TicketTitleNumber
                partition={props.partition}
                ticket={props.ticket}
              />
            </span>
          </div>
        </div>
        {graph === undefined || node === undefined ? null : (
          <div className="ticket-list-foot">
            <span className="ticket-list-foot-standing">
              <EpicTicketsNodeState node={node} graph={graph} />
            </span>
          </div>
        )}
      </article>
    </li>
  );
}

export function EpicTicketsTab(): ReactNode {
  const held = useEpicPageHeld();
  const text = useCopyText();
  const view = readValue(held.epicState);
  if (view === undefined) return <PanelUnready state={held.epicState} />;
  if (view.tickets.length === 0)
    return <EmptyState label={text({ id: "epics-tickets-none" })} />;
  const rows = (readValue(held.rowsState)?.tickets ?? []).map(projectTableRow);
  const byTicket = new Map(rows.map((row) => [row.ticket, row]));
  const standings = new Map(
    rows.map((row) => [row.ticket, ticketListStandingOf(row)] as const),
  );
  const graph = readValue(held.graphState);
  return (
    <ul className="ticket-list" aria-label={text({ id: "epics-tab-tickets" })}>
      {[...view.tickets]
        .sort((left, right) => left - right)
        .map((ticket) => {
          const row = byTicket.get(ticket);
          return row === undefined ? (
            <EpicTicketsUnheld
              key={ticket}
              partition={held.partition}
              ticket={ticket}
              graph={graph}
            />
          ) : (
            <TicketListRow
              key={ticket}
              row={row}
              standings={standings}
              partition={held.partition}
              nowMs={held.nowMs}
              creatorEmails={held.creatorEmails}
              queues={held.queues}
            />
          );
        })}
    </ul>
  );
}
