/**
 * An epic's graph, top to bottom, beside the ticket selected on it: a bar
 * with the key and the toggle for the tickets outside the epic, the cards and
 * edges `core/epicGraph.ts` lays out, the members with no edge in a row under
 * them, and the side panel.
 *
 * The graph is scaled to its panel's width within the bounds the layout
 * states, through the SVG's own size and view box rather than a `style`, which
 * the served policy refuses; wider than that, the panel scrolls sideways and
 * opens centred on the selected card.
 *
 * Its layout is loaded on its own, once the Graph tab draws it.
 */

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type {
  EpicGraphResponse,
  LandingQueuesResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy } from "../../core/copy.ts";
import {
  epicGraphEdgeKeyOf,
  epicGraphEdgePath,
  epicGraphMemberHeight,
  epicGraphMemberWidth,
  epicGraphScaleOf,
  epicGraphScrollOf,
  epicGraphSelectedOf,
  epicGraphTraced,
} from "../../core/epicGraph.ts";
import type {
  EpicGraphDrawn,
  EpicGraphTicket,
  EpicGraphTrace,
} from "../../core/epicGraph.ts";
import { epicGraphTicketsOf } from "../../core/epics.ts";
import { landingQueuePlaceOf } from "../../core/landingQueues.ts";
import { projectTableRow } from "../../core/projectTableRows.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import type { TicketStateStanding } from "../../core/ticketHeader.ts";
import type { ProjectTableRow } from "../../core/projectTableRows.ts";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { TicketStateMark } from "../ticket/TicketStateLabel.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { EpicGraphCard, epicGraphTraceAttribute } from "./EpicGraphCard.tsx";
import type { EpicGraphTraceMark } from "./EpicGraphCard.tsx";
import type { EpicPageHeld } from "./EpicPageHeld.tsx";
import { EpicGraphSide } from "./EpicGraphSide.tsx";
import { EpicGraphLaidLazy } from "./EpicGraphLaidLazy.ts";

import "./epicGraph.css";

/** What every card on one graph is drawn against. */
interface EpicGraphCardsHeld {
  readonly selected: number | undefined;
  readonly trace: EpicGraphTrace | undefined;
  readonly queues: LandingQueuesResponse | undefined;
  readonly onSelect: (ticket: number) => void;
  readonly onTrace: (ticket: number | undefined) => void;
}

function epicGraphTraceMarkOf(
  trace: EpicGraphTrace | undefined,
  lit: boolean,
): EpicGraphTraceMark {
  if (trace === undefined) return undefined;
  return lit ? "Lit" : "Dim";
}

function EpicGraphCardHeld(props: {
  readonly ticket: EpicGraphTicket;
  readonly held: EpicGraphCardsHeld;
}): ReactNode {
  const { held } = props;
  const ticket = props.ticket.node.ticket;
  return (
    <EpicGraphCard
      ticket={props.ticket}
      selected={held.selected === ticket}
      trace={epicGraphTraceMarkOf(
        held.trace,
        held.trace?.tickets.has(ticket) === true,
      )}
      place={landingQueuePlaceOf(held.queues, ticket)}
      onSelect={held.onSelect}
      onTrace={held.onTrace}
    />
  );
}

const epicGraphKeyed: readonly {
  readonly standing: TicketStateStanding;
  readonly word: Copy;
}[] = [
  { standing: "Done", word: { id: "epics-graph-key-done" } },
  { standing: "Work", word: { id: "epics-graph-key-running" } },
  { standing: "Ready", word: { id: "epics-graph-key-ready" } },
  { standing: "Blocked", word: { id: "epics-graph-key-blocked" } },
];

/** The key, Escalated in it where a member is, the line on the arrows, and
 * the toggle for the tickets outside the epic where it holds any. */
function EpicGraphBar(props: {
  readonly drawn: EpicGraphDrawn;
  readonly outside: number;
  readonly outsideShown: boolean;
  readonly onOutsideShown: (shown: boolean) => void;
}): ReactNode {
  const text = useCopyText();
  const escalated = [...props.drawn.tickets.values()].some(
    (ticket) => ticket.node.member && ticket.standing === "Escalated",
  );
  const keyed = escalated
    ? [
        ...epicGraphKeyed,
        {
          standing: "Escalated" as const,
          word: { id: "epics-graph-key-escalated" } as const,
        },
      ]
    : epicGraphKeyed;
  return (
    <div className="epic-graph-bar">
      <ul
        className="epic-graph-key"
        aria-label={text({ id: "epics-graph-key" })}
      >
        {keyed.map((key) => (
          <li
            key={key.standing}
            className="epic-graph-key-item"
            data-standing={key.standing}
          >
            <span
              className="epic-graph-mark"
              data-tone={ticketStateLabelOf(key.standing).tone}
            >
              <TicketStateMark standing={key.standing} />
            </span>
            {text(key.word)}
          </li>
        ))}
      </ul>
      <p className="epic-graph-arrows">{text({ id: "epics-graph-arrows" })}</p>
      {props.outside === 0 ? null : (
        <div className="epic-graph-outside">
          <Checkbox
            label={text({
              id: "epics-graph-outside-shown",
              args: { count: props.outside },
            })}
            checked={props.outsideShown}
            onChange={props.onOutsideShown}
          />
        </div>
      )}
    </div>
  );
}

/** The panel the graph scrolls in and its width as last measured, scrolled
 * the first time it is measured so the selected card stands in its middle. */
function useEpicGraphPanel(
  graphWidth: number,
  centre: number | undefined,
): {
  readonly panel: RefObject<HTMLDivElement | null>;
  readonly width: number;
} {
  const panel = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = panel.current;
    if (element === null || typeof ResizeObserver === "undefined")
      return undefined;
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const opened = useRef(false);
  useLayoutEffect(() => {
    const element = panel.current;
    if (opened.current || element === null || width <= 0) return;
    opened.current = true;
    const scale = epicGraphScaleOf(graphWidth, width);
    if (centre !== undefined)
      element.scrollTo({
        left: epicGraphScrollOf(centre * scale, graphWidth * scale, width),
      });
  }, [width, graphWidth, centre]);
  return { panel, width };
}

function EpicGraphArrow(props: {
  readonly id: string;
  readonly kind: string;
}): ReactNode {
  return (
    <marker
      id={props.id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"
    >
      <path
        className="epic-graph-arrow"
        data-kind={props.kind}
        d="M 0 0 L 10 5 L 0 10 z"
      />
    </marker>
  );
}

/** The laid out graph, scaled to the panel it scrolls in. */
function EpicGraphDrawing(props: {
  readonly drawn: EpicGraphDrawn;
  readonly held: EpicGraphCardsHeld;
}): ReactNode {
  const text = useCopyText();
  const { drawn, held } = props;
  const arrow = `epic-graph-arrow-${useId().replace(/[^a-zA-Z0-9-]/gu, "")}`;
  const chosen = drawn.cards.find((card) => card.node.ticket === held.selected);
  const { panel, width } = useEpicGraphPanel(
    drawn.width,
    chosen === undefined ? undefined : chosen.x + chosen.width / 2,
  );
  const scale = epicGraphScaleOf(drawn.width, width);
  const arrowOf = (kind: string) => `url(#${arrow}-${kind})`;
  return (
    <div ref={panel} className="epic-graph-scroll">
      <svg
        className="epic-graph-canvas"
        role="group"
        aria-label={text({ id: "epics-graph-label" })}
        width={drawn.width * scale}
        height={drawn.height * scale}
        viewBox={`0 0 ${String(drawn.width)} ${String(drawn.height)}`}
      >
        <defs>
          {["met", "strong", "lit"].map((kind) => (
            <EpicGraphArrow key={kind} id={`${arrow}-${kind}`} kind={kind} />
          ))}
        </defs>
        {drawn.edges.map((edge) => {
          const lit = held.trace?.edges.has(epicGraphEdgeKeyOf(edge)) === true;
          return (
            <path
              key={epicGraphEdgeKeyOf(edge)}
              className="epic-graph-edge"
              data-from={edge.from}
              data-to={edge.to}
              data-met={edge.met ? "" : undefined}
              data-outside={edge.outside ? "" : undefined}
              data-trace={epicGraphTraceAttribute(
                epicGraphTraceMarkOf(held.trace, lit),
              )}
              d={epicGraphEdgePath(edge.points)}
              markerEnd={arrowOf(lit ? "lit" : edge.met ? "met" : "strong")}
            />
          );
        })}
        {drawn.cards.map((card) => (
          <foreignObject
            key={card.node.ticket}
            x={card.x}
            y={card.y}
            width={card.width}
            height={card.height}
          >
            <EpicGraphCardHeld ticket={card} held={held} />
          </foreignObject>
        ))}
      </svg>
    </div>
  );
}

/** The members with no edge either way, as a wrapped row of the same cards. */
function EpicGraphUnconnected(props: {
  readonly drawn: EpicGraphDrawn;
  readonly held: EpicGraphCardsHeld;
}): ReactNode {
  const text = useCopyText();
  if (props.drawn.unconnected.length === 0) return null;
  return (
    <ul
      className="epic-graph-unconnected"
      aria-label={text({ id: "epics-graph-unconnected" })}
    >
      {props.drawn.unconnected.map((ticket) => (
        <li key={ticket.node.ticket}>
          <svg
            className="epic-graph-unconnected-card"
            width={epicGraphMemberWidth}
            height={epicGraphMemberHeight}
          >
            <foreignObject
              width={epicGraphMemberWidth}
              height={epicGraphMemberHeight}
            >
              <EpicGraphCardHeld ticket={ticket} held={props.held} />
            </foreignObject>
          </svg>
        </li>
      ))}
    </ul>
  );
}

/** The graph as it is drawn once it is laid out, beside the ticket selected. */
function EpicGraphViewDrawn(props: {
  readonly held: EpicPageHeld;
  readonly graph: EpicGraphResponse;
  readonly drawn: EpicGraphDrawn;
  readonly rows: ReadonlyMap<number, ProjectTableRow>;
  readonly ticket: number | undefined;
  readonly onTicket: (ticket: number) => void;
  readonly traced: number | undefined;
  readonly onTraced: (ticket: number | undefined) => void;
  readonly outsideShown: boolean;
  readonly onOutsideShown: (shown: boolean) => void;
}): ReactNode {
  const { held, graph, drawn, traced } = props;
  const trace = useMemo(
    () =>
      traced === undefined || !drawn.tickets.has(traced)
        ? undefined
        : epicGraphTraced(traced, drawn.edges),
    [traced, drawn],
  );
  const selected = epicGraphSelectedOf(drawn, props.ticket);
  const chosen =
    selected === undefined ? undefined : drawn.tickets.get(selected);
  const cardsHeld: EpicGraphCardsHeld = {
    selected,
    trace,
    queues: held.queues,
    onSelect: props.onTicket,
    onTrace: props.onTraced,
  };
  return (
    <div className="epic-graph">
      {chosen === undefined ? null : (
        <EpicGraphSide
          partition={held.partition}
          graph={graph}
          ticket={chosen}
          held={drawn.tickets}
          row={props.rows.get(chosen.node.ticket)}
          onTicket={props.onTicket}
        />
      )}
      <div className="epic-graph-panel">
        <EpicGraphBar
          drawn={drawn}
          outside={graph.nodes.filter((node) => !node.member).length}
          outsideShown={props.outsideShown}
          onOutsideShown={props.onOutsideShown}
        />
        {drawn.cards.length === 0 ? null : (
          <EpicGraphDrawing drawn={drawn} held={cardsHeld} />
        )}
        <EpicGraphUnconnected drawn={drawn} held={cardsHeld} />
      </div>
    </div>
  );
}

/** The graph beside the ticket selected; it suspends until its layout's own
 * chunk is loaded. */
export function EpicGraphView(props: {
  readonly held: EpicPageHeld;
  readonly graph: EpicGraphResponse;
  readonly ticket: number | undefined;
  readonly onTicket: (ticket: number) => void;
}): ReactNode {
  const [outsideShown, setOutsideShown] = useState(true);
  const [traced, setTraced] = useState<number | undefined>(undefined);
  const tickets = readValue(props.held.rowsState)?.tickets;
  const rows = useMemo(
    () =>
      new Map(
        (tickets ?? []).map((ticket) => [
          ticket.ticket,
          projectTableRow(ticket),
        ]),
      ),
    [tickets],
  );
  const graphTickets = useMemo(
    () => epicGraphTicketsOf(props.graph, rows),
    [props.graph, rows],
  );
  return (
    <EpicGraphLaidLazy
      graph={props.graph}
      tickets={graphTickets}
      outsideShown={outsideShown}
    >
      {(drawn) => (
        <EpicGraphViewDrawn
          {...props}
          drawn={drawn}
          rows={rows}
          traced={traced}
          onTraced={setTraced}
          outsideShown={outsideShown}
          onOutsideShown={setOutsideShown}
        />
      )}
    </EpicGraphLaidLazy>
  );
}
