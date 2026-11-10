/**
 * The selected ticket beside an epic's graph: its state, number and title,
 * what it depends on and what it blocks, each pressed to select that ticket,
 * a link to its page, and, for a Ready ticket and a reader who may dispatch
 * it, the ticket list's own dispatch.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { EpicGraphResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { epicGraphNeighboursOf } from "../../core/epicGraph.ts";
import type { EpicGraphTicket } from "../../core/epicGraph.ts";
import type { ProjectTableRow } from "../../core/projectTableRows.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import type { TicketStateStanding } from "../../core/ticketHeader.ts";
import { TicketRowDispatchScope } from "../TicketActions.tsx";
import { TicketStateMark } from "../ticket/TicketStateLabel.tsx";
import { Button, buttonLookClassName } from "../ui/Button.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

import "./epicGraph.css";

function EpicGraphSideMark(props: {
  readonly standing: TicketStateStanding;
}): ReactNode {
  return (
    <span
      className="epic-graph-mark"
      data-tone={ticketStateLabelOf(props.standing).tone}
    >
      <TicketStateMark standing={props.standing} />
    </span>
  );
}

/** One list of the tickets beside the selected one, or the word for none. */
function EpicGraphSideList(props: {
  readonly heading: string;
  readonly tickets: readonly number[];
  readonly held: ReadonlyMap<number, EpicGraphTicket>;
  readonly onTicket: (ticket: number) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <section className="epic-graph-side-section">
      <h4 className="epic-graph-side-heading">{props.heading}</h4>
      {props.tickets.length === 0 ? (
        <p className="epic-graph-side-none">
          {text({ id: "epics-side-none" })}
        </p>
      ) : (
        <ul className="epic-graph-side-list" aria-label={props.heading}>
          {props.tickets.map((ticket) => {
            const other = props.held.get(ticket);
            return (
              <li key={ticket}>
                <button
                  type="button"
                  className="epic-graph-side-ticket"
                  onClick={() => {
                    props.onTicket(ticket);
                  }}
                >
                  {other === undefined ? null : (
                    <EpicGraphSideMark standing={other.standing} />
                  )}
                  <span>
                    <span className="epic-graph-side-number">{`#${String(ticket)}`}</span>{" "}
                    {other?.node.title ?? text({ id: "epics-card-untitled" })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Dispatch, offered as the ticket list offers it on a Ready row. */
function EpicGraphSideDispatch(props: {
  readonly partition: PartitionIdentity;
  readonly row: ProjectTableRow;
}): ReactNode {
  const text = useCopyText();
  return (
    <TicketRowDispatchScope
      partition={props.partition}
      ticket={props.row.ticket}
      sequence={props.row.sequence}
    >
      {(dispatch, notes) =>
        dispatch === undefined ? null : (
          <>
            <Tooltip text={dispatch.effect}>
              <Button
                variant="primary"
                size="sm"
                busy={dispatch.busy}
                disabled={dispatch.busy || dispatch.offline}
                onClick={dispatch.press}
              >
                {text({ id: "epics-side-dispatch" })}
              </Button>
            </Tooltip>
            <span className="epic-graph-side-notes">{notes}</span>
          </>
        )
      }
    </TicketRowDispatchScope>
  );
}

export function EpicGraphSide(props: {
  readonly partition: PartitionIdentity;
  readonly graph: EpicGraphResponse;
  readonly ticket: EpicGraphTicket;
  readonly held: ReadonlyMap<number, EpicGraphTicket>;
  readonly row: ProjectTableRow | undefined;
  readonly onTicket: (ticket: number) => void;
}): ReactNode {
  const text = useCopyText();
  const { node, standing } = props.ticket;
  const label = ticketStateLabelOf(standing);
  const { dependsOn, blocks } = epicGraphNeighboursOf(props.graph, node.ticket);
  return (
    <aside
      className="epic-graph-side"
      aria-label={text({ id: "epics-side-label" })}
      data-ticket={node.ticket}
    >
      <p className="epic-graph-side-head" data-tone={label.tone}>
        <EpicGraphSideMark standing={standing} />
        <span className="epic-graph-side-number">{`#${String(node.ticket)}`}</span>
        <span className="epic-graph-side-word">{text(label.word)}</span>
      </p>
      <h3 className="epic-graph-side-title">
        {node.title ?? text({ id: "epics-card-untitled" })}
      </h3>
      <EpicGraphSideList
        heading={text({ id: "epics-side-depends-on" })}
        tickets={dependsOn}
        held={props.held}
        onTicket={props.onTicket}
      />
      <EpicGraphSideList
        heading={text({ id: "epics-side-blocks" })}
        tickets={blocks}
        held={props.held}
        onTicket={props.onTicket}
      />
      <div className="epic-graph-side-actions">
        <Link
          to="/$tenant/$project/tickets/$ticket"
          params={{ ...props.partition, ticket: String(node.ticket) }}
          className={buttonLookClassName({ size: "sm" })}
        >
          {text({ id: "epics-side-open" })}
        </Link>
        {standing === "Ready" && props.row !== undefined ? (
          <EpicGraphSideDispatch partition={props.partition} row={props.row} />
        ) : null}
      </div>
    </aside>
  );
}
