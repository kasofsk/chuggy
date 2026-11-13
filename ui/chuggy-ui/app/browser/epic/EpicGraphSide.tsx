/**
 * The panel beside an epic's graph. With a ticket selected: its state, number
 * and title, its layer and its step on the longest chain, what it depends on
 * with how many of those are Done, and what it blocks, each pressed to select
 * that ticket, a link to its page, and, for a Ready ticket and a reader who
 * may dispatch it, the ticket list's own dispatch. With none: the longest
 * chain, what is running, and what is Ready, each pressed the same way.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { EpicGraphResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { epicGraphNeighboursOf } from "../../core/epicGraph.ts";
import type { EpicGraphTicket } from "../../core/epicGraph.ts";
import type { EpicGraphLayered } from "../../core/epicGraphLayers.ts";
import type { ProjectTableRow } from "../../core/projectTableRows.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import type { TicketStateStanding } from "../../core/ticketHeader.ts";
import { TicketRowDispatchScope } from "../TicketActions.tsx";
import { TicketStateMark } from "../ticket/TicketStateLabel.tsx";
import { Button, buttonLookClassName } from "../ui/Button.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

import "./epicGraph.css";

export function EpicGraphSideMark(props: {
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

/** One list of tickets, under its heading and a count where it has one, or
 * the word for none. */
function EpicGraphSideList(props: {
  readonly heading: string;
  readonly count?: string | undefined;
  readonly tickets: readonly number[];
  readonly held: ReadonlyMap<number, EpicGraphTicket>;
  readonly onTicket: (ticket: number) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <section className="epic-graph-side-section">
      <h4 className="epic-graph-side-heading">
        {props.heading}
        {props.count === undefined ? null : (
          <span className="epic-graph-side-count">{props.count}</span>
        )}
      </h4>
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
export function EpicGraphSideDispatch(props: {
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

/** Where the ticket stands in the layers, and on the longest chain where it
 * is on it; nothing for a ticket not placed. */
export function EpicGraphSidePlace(props: {
  readonly ticket: number;
  readonly layered: EpicGraphLayered;
}): ReactNode {
  const text = useCopyText();
  const { layered } = props;
  const layer = layered.layerOf.get(props.ticket);
  if (layer === undefined) return null;
  const step = layered.chain.indexOf(props.ticket);
  const placed = [
    text({
      id: "epics-side-layer",
      args: { layer, layers: layered.layers.length },
    }),
    ...(step < 0
      ? []
      : [
          text({
            id: "epics-side-step",
            args: { step: step + 1, steps: layered.chain.length },
          }),
        ]),
  ];
  return <p className="epic-graph-side-place">{placed.join(" · ")}</p>;
}

export function EpicGraphSide(props: {
  readonly partition: PartitionIdentity;
  readonly graph: EpicGraphResponse;
  readonly ticket: EpicGraphTicket;
  readonly layered: EpicGraphLayered;
  readonly row: ProjectTableRow | undefined;
  readonly onTicket: (ticket: number) => void;
}): ReactNode {
  const text = useCopyText();
  const { node, standing } = props.ticket;
  const held = props.layered.tickets;
  const label = ticketStateLabelOf(standing);
  const { dependsOn, blocks } = epicGraphNeighboursOf(props.graph, node.ticket);
  const met = dependsOn.filter(
    (ticket) => held.get(ticket)?.standing === "Done",
  ).length;
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
      <EpicGraphSidePlace ticket={node.ticket} layered={props.layered} />
      <EpicGraphSideList
        heading={text({ id: "epics-side-depends-on" })}
        count={
          dependsOn.length === 0
            ? undefined
            : text({
                id: "epics-graph-done",
                args: { done: met, count: dependsOn.length },
              })
        }
        tickets={dependsOn}
        held={held}
        onTicket={props.onTicket}
      />
      <EpicGraphSideList
        heading={text({ id: "epics-side-blocks" })}
        tickets={blocks}
        held={held}
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

function epicGraphSideRunning(standing: TicketStateStanding): boolean {
  return (
    standing === "Work" ||
    standing === "Evaluation" ||
    standing === "Finalization"
  );
}

/** With nothing selected: the longest chain in its order, what is running
 * where anything is, and what is Ready, each in the order it is placed. */
export function EpicGraphSideSummary(props: {
  readonly layered: EpicGraphLayered;
  readonly onTicket: (ticket: number) => void;
}): ReactNode {
  const text = useCopyText();
  const { layered } = props;
  const placed = layered.layers.flat();
  const standing = (test: (standing: TicketStateStanding) => boolean) =>
    placed
      .filter((ticket) => test(ticket.standing))
      .map((ticket) => ticket.node.ticket);
  const running = standing(epicGraphSideRunning);
  const ready = standing((each) => each === "Ready");
  return (
    <aside
      className="epic-graph-side"
      aria-label={text({ id: "epics-side-summary" })}
    >
      <EpicGraphSideList
        heading={text({ id: "epics-graph-chain" })}
        count={String(layered.chain.length)}
        tickets={layered.chain}
        held={layered.tickets}
        onTicket={props.onTicket}
      />
      {running.length === 0 ? null : (
        <EpicGraphSideList
          heading={text({ id: "epics-graph-key-running" })}
          count={String(running.length)}
          tickets={running}
          held={layered.tickets}
          onTicket={props.onTicket}
        />
      )}
      <EpicGraphSideList
        heading={text({ id: "epics-graph-key-ready" })}
        count={ready.length === 0 ? undefined : String(ready.length)}
        tickets={ready}
        held={layered.tickets}
        onTicket={props.onTicket}
      />
    </aside>
  );
}
