/**
 * A ticket on an epic's graph, as a card of a fixed size placed by
 * `core/epicGraph.ts`. The card is a link to the ticket's page; its state
 * stands over the link's corner rather than inside it, drawn as the ticket
 * list draws a row's, so a ready member's dispatch is pressed without leaving
 * the page, with its follow drawn on the card, and what a blocked one waits on
 * is named. A ticket outside the epic is a smaller, dashed card, so which
 * tickets the epic holds does not rest on hue alone.
 *
 * The page hands these to the canvas, with the rows they are drawn against,
 * so the canvas's own chunk carries none of the ticket list's modules.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  EpicGraphResponse,
  LandingQueuesResponse,
  ProjectTicket,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy } from "../../core/copy.ts";
import { epicGraphStandingOf } from "../../core/epicGraph.ts";
import { landingQueuePlaceOf } from "../../core/landingQueues.ts";
import type { EpicGraphCard, EpicGraphRun } from "../../core/epicGraph.ts";
import { projectTableRow } from "../../core/projectTableRows.ts";
import type { ProjectTableRow } from "../../core/projectTableRows.ts";
import {
  ticketListStandingOf,
  type TicketListStanding,
} from "../../core/ticketListView.ts";
import { TicketListDependencies, TicketListState } from "../ProjectTable.tsx";
import { TicketRowDispatchScope } from "../TicketActions.tsx";
import { LandingQueueChip } from "../ticket/LandingQueueChip.tsx";
import {
  dependencyStandingOf,
  TicketStateChip,
} from "../ticket/TicketStateChip.tsx";
import { TicketStateLabel } from "../ticket/TicketStateLabel.tsx";
import { Pill } from "../ui/Pill.tsx";

import "../ProjectTable.css";
import "./epicGraph.css";

/** What every card on one graph is drawn against. */
export interface EpicGraphCardsHeld {
  readonly partition: PartitionIdentity;
  readonly graph: EpicGraphResponse;
  readonly rows: ReadonlyMap<number, ProjectTableRow>;
  readonly standings: ReadonlyMap<number, TicketListStanding>;
  readonly queues: LandingQueuesResponse | undefined;
}

/** What the cards are drawn against: each ticket's row of the list, and the
 * project's landing queues. */
export function epicGraphCardsHeldOf(
  partition: PartitionIdentity,
  graph: EpicGraphResponse,
  tickets: readonly ProjectTicket[] | undefined,
  queues: LandingQueuesResponse | undefined,
): EpicGraphCardsHeld {
  const rows = new Map(
    (tickets ?? []).map((ticket) => [ticket.ticket, projectTableRow(ticket)]),
  );
  return {
    partition,
    graph,
    rows,
    standings: new Map(
      [...rows.values()].map((row) => [row.ticket, ticketListStandingOf(row)]),
    ),
    queues,
  };
}

function epicGraphRunWords(run: EpicGraphRun): {
  readonly label: Copy;
  readonly detail: Copy;
} {
  const cycle = String(run.cycle);
  switch (run.run) {
    case "Work":
      return {
        label: { id: "epics-card-run-work" },
        detail: { id: "epics-card-run-work-detail", args: { cycle } },
      };
    case "Evaluation": {
      const stage = String(run.stage);
      return {
        label: { id: "epics-card-run-evaluation", args: { stage } },
        detail: {
          id: "epics-card-run-evaluation-detail",
          args: { cycle, stage },
        },
      };
    }
  }
}

/** The state of a ticket the ticket list holds no row of, as the graph says
 * it, and a draft's word where it was never released. */
export function EpicGraphNodeState(props: {
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

/** The member's state, over the card: the list's own chip, its dispatch
 * where it is ready, from the row the list holds; or, where it holds none, the
 * state the graph says, and a draft's word where it was never released. */
function EpicGraphMemberState(props: {
  readonly card: EpicGraphCard;
  readonly held: EpicGraphCardsHeld;
}): ReactNode {
  const { node } = props.card;
  const row = props.held.rows.get(node.ticket);
  if (row === undefined)
    return <EpicGraphNodeState node={node} graph={props.held.graph} />;
  if (ticketListStandingOf(row) !== "Ready")
    return <TicketListState row={row} />;
  return (
    <TicketRowDispatchScope
      partition={props.held.partition}
      ticket={row.ticket}
      sequence={row.sequence}
    >
      {(dispatch, notes) => (
        <>
          <TicketListState row={row} dispatch={dispatch} />
          <span className="epic-card-notes">{notes}</span>
        </>
      )}
    </TicketRowDispatchScope>
  );
}

export function EpicGraphMemberCard(props: {
  readonly card: EpicGraphCard;
  readonly run: EpicGraphRun | undefined;
  readonly held: EpicGraphCardsHeld;
}): ReactNode {
  const text = useCopyText();
  const { card, run } = props;
  const { node } = card;
  const title = node.title ?? text({ id: "epics-card-untitled" });
  const row = props.held.rows.get(node.ticket);
  const runWords = run === undefined ? undefined : epicGraphRunWords(run);
  const place = landingQueuePlaceOf(props.held.queues, node.ticket);
  return (
    <foreignObject
      x={card.x}
      y={card.y}
      width={card.width}
      height={card.height}
    >
      <div className="epic-card" data-ticket={node.ticket} data-member="">
        <Link
          to="/$tenant/$project/tickets/$ticket"
          params={{ ...props.held.partition, ticket: String(node.ticket) }}
          className="epic-card-link"
          aria-label={text({
            id: "epics-card-open",
            args: { ticket: String(node.ticket), title },
          })}
          title={title}
        >
          <span className="epic-card-number">{`#${String(node.ticket)}`}</span>
          <span className="epic-card-title">{title}</span>
          {runWords === undefined && place === undefined ? null : (
            <span className="epic-card-foot">
              {runWords === undefined ? null : (
                <span className="epic-card-run" title={text(runWords.detail)}>
                  {text(runWords.label)}
                </span>
              )}
              <LandingQueueChip place={place} inLink />
            </span>
          )}
        </Link>
        <span className="epic-card-state">
          <EpicGraphMemberState card={card} held={props.held} />
        </span>
        {row === undefined ? null : (
          <span className="epic-card-waits">
            <TicketListDependencies
              row={row}
              standings={props.held.standings}
            />
          </span>
        )}
      </div>
    </foreignObject>
  );
}

export function EpicGraphOutsideCard(props: {
  readonly card: EpicGraphCard;
  readonly held: EpicGraphCardsHeld;
}): ReactNode {
  const text = useCopyText();
  const { card } = props;
  const { node } = card;
  const title = node.title ?? text({ id: "epics-card-untitled" });
  const standing =
    node.phase === undefined
      ? undefined
      : dependencyStandingOf(node.phase, props.held.standings.get(node.ticket));
  return (
    <foreignObject
      x={card.x}
      y={card.y}
      width={card.width}
      height={card.height}
    >
      <div className="epic-card" data-ticket={node.ticket} data-outside="">
        <Link
          to="/$tenant/$project/tickets/$ticket"
          params={{ ...props.held.partition, ticket: String(node.ticket) }}
          className="epic-card-link"
          aria-label={text({
            id: "epics-card-open-outside",
            args: { ticket: String(node.ticket), title },
          })}
          title={title}
        >
          <span className="epic-card-head">
            <span className="epic-card-number">{`#${String(node.ticket)}`}</span>
            {standing === undefined ? null : (
              <TicketStateLabel standing={standing} size="small" />
            )}
          </span>
          <span className="epic-card-title" data-lines="1">
            {title}
          </span>
        </Link>
      </div>
    </foreignObject>
  );
}

export const epicGraphCardKinds = {
  Member: EpicGraphMemberCard,
  Outside: EpicGraphOutsideCard,
} as const;

export type EpicGraphCardKinds = typeof epicGraphCardKinds;
