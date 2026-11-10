/**
 * The epic page's three tabs, each its own address under the page's layout:
 * the overview with the graph first, then the summary, then the description;
 * the members, each drawn as the ticket list draws a ticket; and the
 * revisions, newest first. The layout makes every read and hands it down here.
 */

import { lazy, Suspense, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  EpicGraphResponse,
  EpicHistoryResponse,
  EpicViewResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { epicHistoryQuery } from "../../core/epics.ts";
import { instantFigure } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import { projectTableRow } from "../../core/projectTableRows.ts";
import { ticketListStandingOf } from "../../core/ticketListView.ts";
import { usePanelState } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { TicketListRow } from "../ProjectTable.tsx";
import { TicketTitleNumber, TicketTitleWords } from "../TicketCells.tsx";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { epicGraphCardKinds, epicGraphCardsHeldOf } from "./EpicGraphCards.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";
import type { EpicPageHeld } from "./EpicPageHeld.tsx";

import "../ProjectTable.css";
import "./epic.css";

const EpicGraphCanvas = lazy(() => import("./EpicGraphCanvas.tsx"));

/** The canvas's own place, holding a line where the canvas is not yet drawn. */
function EpicGraphFrameSaying(props: { readonly children: string }): ReactNode {
  return (
    <div className="epic-graph-frame" data-saying="">
      <p className="epic-graph-saying">{props.children}</p>
    </div>
  );
}

function EpicGraphReady(props: {
  readonly held: EpicPageHeld;
  readonly graph: EpicGraphResponse;
}): ReactNode {
  const text = useCopyText();
  const [outsideShown, setOutsideShown] = useState(true);
  const { partition, rowsState } = props.held;
  const tickets = readValue(rowsState)?.tickets;
  const cardsHeld = useMemo(
    () => epicGraphCardsHeldOf(partition, props.graph, tickets),
    [partition, props.graph, tickets],
  );
  const outside = props.graph.nodes.filter((node) => !node.member).length;
  if (props.graph.nodes.length === 0)
    return (
      <EpicGraphFrameSaying>
        {text({ id: "epics-graph-empty" })}
      </EpicGraphFrameSaying>
    );
  return (
    <>
      {outside === 0 ? null : (
        <Checkbox
          label={text({
            id: "epics-graph-outside-shown",
            args: { count: outside },
          })}
          checked={outsideShown}
          onChange={setOutsideShown}
        />
      )}
      <Suspense
        fallback={
          <EpicGraphFrameSaying>
            {text({ id: "epics-graph-loading" })}
          </EpicGraphFrameSaying>
        }
      >
        <EpicGraphCanvas
          held={props.held}
          cards={epicGraphCardKinds}
          cardsHeld={cardsHeld}
          graph={props.graph}
          outsideShown={outsideShown}
        />
      </Suspense>
    </>
  );
}

/** The graph, or the one line its read is drawn as while it is not ready. */
function EpicGraphSection(props: { readonly held: EpicPageHeld }): ReactNode {
  const text = useCopyText();
  const state = props.held.graphState;
  return (
    <section
      className="epic-graph-section"
      aria-label={text({ id: "epics-graph-label" })}
    >
      {state.state === "Ready" ? (
        <EpicGraphReady held={props.held} graph={state.value} />
      ) : state.state === "Pending" ? (
        <EpicGraphFrameSaying>
          {text({ id: "epics-graph-loading" })}
        </EpicGraphFrameSaying>
      ) : (
        <div className="epic-graph-frame" data-saying="">
          <Notice
            tone="danger"
            inline
            detail={text({ id: "epics-graph-failed" })}
          />
        </div>
      )}
    </section>
  );
}

/** What the epic says of itself, once it is read. */
function EpicOverviewWords(props: {
  readonly view: EpicViewResponse;
}): ReactNode {
  const text = useCopyText();
  const { view } = props;
  return (
    <>
      {view.summary === undefined ? null : (
        <Panel title={text({ id: "epics-field-summary" })}>
          <p>{view.summary}</p>
        </Panel>
      )}
      {view.description === "" ? null : (
        <Panel title={text({ id: "epics-field-description" })}>
          <MarkdownReport text={view.description} />
        </Panel>
      )}
    </>
  );
}

export function EpicOverviewTab(): ReactNode {
  const held = useEpicPageHeld();
  const view = readValue(held.epicState);
  return (
    <div className="grid min-w-0 gap-4">
      <EpicGraphSection held={held} />
      {view === undefined ? null : <EpicOverviewWords view={view} />}
    </div>
  );
}

/** A member the ticket list does not hold, drawn by its number and title. */
function EpicTicketsUnheld(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly title: string | undefined;
}): ReactNode {
  return (
    <li className="ticket-list-item" data-ticket={props.ticket}>
      <article className="ticket-list-row">
        <div className="ticket-list-head">
          <h3 className="ticket-list-title">
            <TicketTitleWords
              partition={props.partition}
              ticket={props.ticket}
              title={props.title}
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
  const titles = new Map(
    (readValue(held.graphState)?.nodes ?? []).map((node) => [
      node.ticket,
      node.title,
    ]),
  );
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
              title={titles.get(ticket)}
            />
          ) : (
            <TicketListRow
              key={ticket}
              row={row}
              standings={standings}
              partition={held.partition}
              nowMs={held.nowMs}
              creatorEmails={held.creatorEmails}
            />
          );
        })}
    </ul>
  );
}

/** One page of the revisions, and under it the older one once it is asked for. */
function EpicHistoryPage(props: {
  readonly state: PanelState<EpicHistoryResponse>;
  readonly held: EpicPageHeld;
}): ReactNode {
  const text = useCopyText();
  const [older, setOlder] = useState(false);
  const state = props.state;
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const { revisions, nextAfter } = state.value;
  return (
    <>
      <ol
        className="grid gap-1 text-sm"
        aria-label={text({ id: "epics-revisions-label" })}
      >
        {revisions.map((revision) => (
          <li key={revision.revision} className="flex flex-wrap gap-2">
            <span>
              {text({
                id: "epics-revision",
                args: { revision: String(revision.revision) },
              })}
            </span>
            <span>{revision.title}</span>
            <span className="text-ink-3">{revision.actor.subject}</span>
            <Figure
              figure={instantFigure(revision.changedAt, props.held.nowMs)}
            />
          </li>
        ))}
      </ol>
      {nextAfter === undefined ? null : older ? (
        <EpicHistoryOlder held={props.held} after={nextAfter} />
      ) : (
        <div>
          <Button
            size="sm"
            onClick={() => {
              setOlder(true);
            }}
          >
            {text({ id: "epics-show-older" })}
          </Button>
        </div>
      )}
    </>
  );
}

/** A page older than the newest, read once the reader asks for it. */
function EpicHistoryOlder(props: {
  readonly held: EpicPageHeld;
  readonly after: number;
}): ReactNode {
  const state = usePanelState(
    epicHistoryQuery(props.held.partition, props.held.epic, props.after),
  );
  return <EpicHistoryPage state={state} held={props.held} />;
}

export function EpicHistoryTab(): ReactNode {
  const held = useEpicPageHeld();
  const text = useCopyText();
  return (
    <Panel title={text({ id: "epics-history" })}>
      <EpicHistoryPage state={held.historyState} held={held} />
    </Panel>
  );
}
