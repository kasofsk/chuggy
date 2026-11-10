/**
 * The epic page's Overview tab: the epic's description as a document at
 * reading width, and beside it the members running, the ones next, the graph
 * in small as a link to the Graph tab, and the details: the tickets outside
 * the epic it waits on, its revision, and when and by whom it was updated.
 * Where the reader is narrow, that side comes first and the small graph is
 * left out.
 */

import { Link } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  EpicGraphResponse,
  EpicViewResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { EpicGraphTicket } from "../../core/epicGraph.ts";
import { epicActorLabel } from "../../core/epicHistory.ts";
import {
  epicOverviewGraphOf,
  epicOverviewListsOf,
} from "../../core/epicOverview.ts";
import { epicGraphTicketsOf } from "../../core/epics.ts";
import { epicTicketsMembersOf } from "../../core/epicTickets.ts";
import type { EpicTicketsMember } from "../../core/epicTickets.ts";
import { instantFigure } from "../../core/figures.ts";
import { projectTableRow } from "../../core/projectTableRows.ts";
import type { ProjectTableRow } from "../../core/projectTableRows.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { TicketStateMark } from "../ticket/TicketStateLabel.tsx";
import { Figure } from "../ui/Figure.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { EpicGraphLaidLazy } from "./EpicGraphLaidLazy.ts";
import { EpicActor } from "./EpicHistoryTab.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";
import type { EpicPageHeld } from "./EpicPageHeld.tsx";

import "../ticket/ticket.css";
import "./epicOverview.css";

function EpicOverviewTicket(props: {
  readonly partition: PartitionIdentity;
  readonly member: EpicTicketsMember;
  readonly after: boolean;
}): ReactNode {
  const text = useCopyText();
  const { member } = props;
  return (
    <li className="epic-overview-ticket" data-ticket={member.ticket}>
      <Link
        className="epic-overview-ticket-link"
        to="/$tenant/$project/tickets/$ticket"
        params={{ ...props.partition, ticket: String(member.ticket) }}
      >
        <span
          className="epic-overview-ticket-mark ticket-state-ink"
          data-tone={ticketStateLabelOf(member.standing).tone}
        >
          <TicketStateMark standing={member.standing} />
        </span>
        <span className="epic-overview-ticket-title">
          <span className="epic-overview-ticket-number">#{member.ticket}</span>{" "}
          {member.title}
        </span>
      </Link>
      {props.after && member.after.length > 0 ? (
        <p className="epic-overview-after">
          {text({
            id: "epics-overview-after",
            args: {
              tickets: member.after
                .map((ticket) => `#${String(ticket)}`)
                .join(", "),
            },
          })}
        </p>
      ) : null}
    </li>
  );
}

function EpicOverviewList(props: {
  readonly partition: PartitionIdentity;
  readonly part: "running" | "next";
  readonly members: readonly EpicTicketsMember[];
}): ReactNode {
  const text = useCopyText();
  const heading = text({
    id:
      props.part === "running"
        ? "epics-overview-running"
        : "epics-overview-next",
  });
  return (
    <section className="epic-overview-part" data-part={props.part}>
      <h2 className="epic-overview-heading">{heading}</h2>
      {props.members.length === 0 ? (
        <p className="epic-overview-none">
          {text({ id: "epics-overview-none" })}
        </p>
      ) : (
        <ul className="epic-overview-tickets" aria-label={heading}>
          {props.members.map((member) => (
            <EpicOverviewTicket
              key={member.ticket}
              partition={props.partition}
              member={member}
              after={props.part === "next"}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The graph in small, without words: blocks filled by state, edges lines. */
function EpicOverviewGraphDrawn(props: {
  readonly graph: EpicGraphResponse;
  readonly tickets: ReadonlyMap<number, EpicGraphTicket>;
}): ReactNode {
  return (
    <EpicGraphLaidLazy
      graph={props.graph}
      tickets={props.tickets}
      outsideShown={false}
    >
      {(drawn) => {
        const small = epicOverviewGraphOf(drawn);
        return (
          <svg
            className="epic-overview-graph-canvas"
            aria-hidden="true"
            width="100%"
            viewBox={`0 0 ${String(small.width)} ${String(small.height)}`}
          >
            {small.lines.map((line) => (
              <polyline
                key={`${String(line.from)}-${String(line.to)}`}
                className="epic-overview-graph-line"
                points={line.points
                  .map((point) => `${String(point.x)},${String(point.y)}`)
                  .join(" ")}
              />
            ))}
            {small.blocks.map((block) => (
              <rect
                key={block.ticket}
                className="epic-overview-graph-block"
                data-ticket={block.ticket}
                data-tone={block.tone}
                data-form={block.form}
                x={block.x}
                y={block.y}
                width={block.width}
                height={block.height}
                rx={14}
              />
            ))}
          </svg>
        );
      }}
    </EpicGraphLaidLazy>
  );
}

function EpicOverviewGraph(props: {
  readonly held: EpicPageHeld;
  readonly graph: EpicGraphResponse | undefined;
  readonly tickets: ReadonlyMap<number, EpicGraphTicket>;
}): ReactNode {
  const text = useCopyText();
  const { graph } = props;
  if (graph === undefined || !graph.nodes.some((node) => node.member))
    return null;
  return (
    <section className="epic-overview-part" data-part="graph">
      <h2 className="epic-overview-heading">
        {text({ id: "epics-overview-graph" })}
      </h2>
      <Link
        className="epic-overview-graph"
        to="/$tenant/$project/epics/$epic/graph"
        params={{ ...props.held.partition, epic: String(props.held.epic) }}
        aria-label={text({ id: "epics-overview-graph-open" })}
      >
        <Suspense fallback={null}>
          <EpicOverviewGraphDrawn graph={graph} tickets={props.tickets} />
        </Suspense>
      </Link>
    </section>
  );
}

function EpicOverviewOutside(props: {
  readonly partition: PartitionIdentity;
  readonly tickets: readonly number[];
}): ReactNode {
  const text = useCopyText();
  if (props.tickets.length === 0) return text({ id: "epics-overview-none" });
  return props.tickets.map((ticket, at) => (
    <span key={ticket}>
      {at === 0 ? null : ", "}
      <Link
        to="/$tenant/$project/tickets/$ticket"
        params={{ ...props.partition, ticket: String(ticket) }}
      >
        #{ticket}
      </Link>
    </span>
  ));
}

/** When the newest revision was saved and by whom, where the history holds it. */
function EpicOverviewUpdated(props: {
  readonly held: EpicPageHeld;
}): ReactNode {
  const newest = readValue(props.held.historyState)?.revisions[0];
  if (newest === undefined) return null;
  return (
    <>
      <Figure figure={instantFigure(newest.changedAt, props.held.nowMs)} />
      {" · "}
      <EpicActor
        label={epicActorLabel(newest.actor, props.held.creatorEmails)}
      />
    </>
  );
}

function EpicOverviewDetails(props: {
  readonly held: EpicPageHeld;
  readonly view: EpicViewResponse;
}): ReactNode {
  const text = useCopyText();
  const rows: readonly { readonly key: string; readonly value: ReactNode }[] = [
    {
      key: text({ id: "epics-overview-outside" }),
      value: (
        <EpicOverviewOutside
          partition={props.held.partition}
          tickets={props.view.waitingOnOutside}
        />
      ),
    },
    {
      key: text({ id: "epics-overview-revision" }),
      value: String(props.view.revision),
    },
    {
      key: text({ id: "epics-overview-updated" }),
      value: <EpicOverviewUpdated held={props.held} />,
    },
  ];
  return (
    <section className="epic-overview-part" data-part="details">
      <h2 className="epic-overview-heading">
        {text({ id: "epics-overview-details" })}
      </h2>
      <dl className="epic-overview-details">
        {rows.map((row) => (
          <div key={row.key} className="epic-overview-detail">
            <dt>{row.key}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function useEpicOverviewRows(
  held: EpicPageHeld,
): ReadonlyMap<number, ProjectTableRow> {
  const tickets = readValue(held.rowsState)?.tickets;
  return useMemo(
    () =>
      new Map(
        (tickets ?? []).map((ticket) => [
          ticket.ticket,
          projectTableRow(ticket),
        ]),
      ),
    [tickets],
  );
}

function EpicOverviewAside(props: {
  readonly held: EpicPageHeld;
  readonly view: EpicViewResponse;
}): ReactNode {
  const { held, view } = props;
  const rows = useEpicOverviewRows(held);
  const graph = readValue(held.graphState);
  const tickets = useMemo(
    () =>
      graph === undefined
        ? new Map<number, EpicGraphTicket>()
        : epicGraphTicketsOf(graph, rows),
    [graph, rows],
  );
  const members = epicTicketsMembersOf(view.tickets, rows, graph);
  const lists = epicOverviewListsOf(
    members,
    new Map([
      ...[...tickets].map(([ticket, held]) => [ticket, held.standing] as const),
      ...members.map((member) => [member.ticket, member.standing] as const),
    ]),
  );
  return (
    <aside className="epic-overview-aside">
      <EpicOverviewList
        partition={held.partition}
        part="running"
        members={lists.running}
      />
      <EpicOverviewList
        partition={held.partition}
        part="next"
        members={lists.next}
      />
      <EpicOverviewGraph held={held} graph={graph} tickets={tickets} />
      <EpicOverviewDetails held={held} view={view} />
    </aside>
  );
}

export function EpicOverviewTab(): ReactNode {
  const held = useEpicPageHeld();
  const text = useCopyText();
  const view = readValue(held.epicState);
  if (view === undefined) return null;
  return (
    <div className="epic-overview">
      <EpicOverviewAside held={held} view={view} />
      <section
        className="epic-overview-description"
        aria-label={text({ id: "epics-overview-description" })}
      >
        {view.description === "" ? (
          <p className="epic-overview-none">
            {text({ id: "epics-overview-no-description" })}
          </p>
        ) : (
          <MarkdownReport text={view.description} bare />
        )}
      </section>
    </div>
  );
}
