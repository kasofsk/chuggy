/**
 * An epic's graph in layers, beside the ticket selected on it: a bar with the
 * key and its counts, the toggle for the longest chain and the one for the
 * tickets outside the epic; then each layer `core/epicGraphLayers.ts` places
 * as a row, its number, its done count and a spine filled to the share done
 * beside its cards, which wrap; then the goal, where there is one, across the
 * foot; and the side panel.
 *
 * The ticket in focus, a preview over the selection, keeps everything up and
 * down its chain as it is and dims the rest. Escape clears the selection, and
 * so does pressing the selected card again. Selecting a ticket turns the
 * longest chain off, and clearing it turns the chain back on.
 *
 * Nothing here carries a `style`, which the served policy refuses: a size is
 * the sheet's, and the spine's fill is an SVG's own geometry.
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type {
  EpicGraphResponse,
  LandingQueuesResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy } from "../../core/copy.ts";
import { epicGraphSelectedOf, epicGraphTraced } from "../../core/epicGraph.ts";
import type { EpicGraphTicket } from "../../core/epicGraph.ts";
import {
  epicGraphKickersCommonOf,
  epicGraphLayeredOf,
  epicGraphTitledOf,
} from "../../core/epicGraphLayers.ts";
import type { EpicGraphLayered } from "../../core/epicGraphLayers.ts";
import { epicGraphTicketsOf } from "../../core/epics.ts";
import { landingQueuePlaceOf } from "../../core/landingQueues.ts";
import { projectTableRow } from "../../core/projectTableRows.ts";
import type { ProjectTableRow } from "../../core/projectTableRows.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import type { TicketStateStanding } from "../../core/ticketHeader.ts";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { TicketStateMark } from "../ticket/TicketStateLabel.tsx";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { EpicGraphCard } from "./EpicGraphCard.tsx";
import type { EpicPageHeld } from "./EpicPageHeld.tsx";
import { EpicGraphSide, EpicGraphSideSummary } from "./EpicGraphSide.tsx";

import "./epicGraph.css";

/** What every card on one graph is drawn against. */
interface EpicGraphCardsHeld {
  readonly layered: EpicGraphLayered;
  readonly selected: number | undefined;
  /** The tickets kept as they are, around the ticket in focus. */
  readonly kept: ReadonlySet<number> | undefined;
  /** Each ticket's step on the longest chain, where that is drawn. */
  readonly steps: ReadonlyMap<number, number>;
  readonly kickersHidden: ReadonlySet<string>;
  readonly queues: LandingQueuesResponse | undefined;
  readonly onSelect: (ticket: number) => void;
  readonly onPreview: (ticket: number | undefined) => void;
}

function EpicGraphCardHeld(props: {
  readonly ticket: EpicGraphTicket;
  readonly held: EpicGraphCardsHeld;
}): ReactNode {
  const { held } = props;
  const { node } = props.ticket;
  const { kicker } = epicGraphTitledOf(node.title ?? "");
  return (
    <EpicGraphCard
      ticket={props.ticket}
      ports={(held.layered.dependsOn.get(node.ticket) ?? []).map((ticket) => ({
        ticket,
        met: held.layered.tickets.get(ticket)?.standing === "Done",
      }))}
      drawn={{
        selected: held.selected === node.ticket,
        dimmed: held.kept !== undefined && !held.kept.has(node.ticket),
        step: held.steps.get(node.ticket),
        goal: held.layered.goal === node.ticket,
        kickerHidden: kicker !== undefined && held.kickersHidden.has(kicker),
      }}
      place={landingQueuePlaceOf(held.queues, node.ticket)}
      onSelect={held.onSelect}
      onPreview={held.onPreview}
    />
  );
}

/** The groups the key counts the members by. */
const epicGraphKeyed: readonly {
  readonly standing: TicketStateStanding;
  readonly word: Copy;
  readonly of: readonly TicketStateStanding[];
}[] = [
  { standing: "Done", word: { id: "epics-graph-key-done" }, of: ["Done"] },
  {
    standing: "Work",
    word: { id: "epics-graph-key-running" },
    of: ["Work", "Evaluation", "Finalization"],
  },
  { standing: "Ready", word: { id: "epics-graph-key-ready" }, of: ["Ready"] },
  {
    standing: "Blocked",
    word: { id: "epics-graph-key-blocked" },
    of: ["Blocked"],
  },
  {
    standing: "Escalated",
    word: { id: "epics-graph-key-escalated" },
    of: ["Escalated"],
  },
];

/** The key with each group's count of members, Escalated only where a member
 * is; the toggle for the longest chain where there is one; and the toggle for
 * the tickets outside the epic where it holds any. */
function EpicGraphBar(props: {
  readonly tickets: ReadonlyMap<number, EpicGraphTicket>;
  readonly chain: number;
  readonly chainShown: boolean;
  readonly onChainShown: (shown: boolean) => void;
  readonly outside: number;
  readonly outsideShown: boolean;
  readonly onOutsideShown: (shown: boolean) => void;
}): ReactNode {
  const text = useCopyText();
  const members = [...props.tickets.values()].filter(
    (ticket) => ticket.node.member,
  );
  const keyed = epicGraphKeyed
    .map((key) => ({
      ...key,
      count: members.filter((ticket) => key.of.includes(ticket.standing))
        .length,
    }))
    .filter((key) => key.standing !== "Escalated" || key.count > 0);
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
            {text(key.word)}{" "}
            <span className="epic-graph-key-count">{key.count}</span>
          </li>
        ))}
      </ul>
      <div className="epic-graph-toggles">
        {props.chain === 0 ? null : (
          <Button
            size="sm"
            pressed={props.chainShown}
            onClick={() => {
              props.onChainShown(!props.chainShown);
            }}
          >
            {text({ id: "epics-graph-chain" })}{" "}
            <span className="epic-graph-key-count">{props.chain}</span>
          </Button>
        )}
        {props.outside === 0 ? null : (
          <Checkbox
            label={text({
              id: "epics-graph-outside-shown",
              args: { count: props.outside },
            })}
            checked={props.outsideShown}
            onChange={props.onOutsideShown}
          />
        )}
      </div>
    </div>
  );
}

/** A layer's spine, filled from its top to the share of its cards Done. */
function EpicGraphSpine(props: {
  readonly done: number;
  readonly count: number;
}): ReactNode {
  const extent = 100;
  return (
    <svg
      className="epic-graph-spine"
      viewBox={`0 0 1 ${String(extent)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect className="epic-graph-spine-track" width={1} height={extent} />
      <rect
        className="epic-graph-spine-fill"
        width={1}
        height={props.count === 0 ? 0 : (extent * props.done) / props.count}
      />
    </svg>
  );
}

function EpicGraphLayer(props: {
  readonly layer: number;
  readonly tickets: readonly EpicGraphTicket[];
  readonly held: EpicGraphCardsHeld;
}): ReactNode {
  const text = useCopyText();
  const { tickets, held } = props;
  const done = tickets.filter((ticket) => ticket.standing === "Done").length;
  const goal = tickets.some(
    (ticket) => ticket.node.ticket === held.layered.goal,
  );
  return (
    <li className="epic-graph-layer" data-layer={props.layer}>
      <div className="epic-graph-gutter" aria-hidden="true">
        <span className="epic-graph-layer-number">{props.layer}</span>
        <span className="epic-graph-layer-done">{`${String(done)}/${String(tickets.length)}`}</span>
        <EpicGraphSpine done={done} count={tickets.length} />
      </div>
      <ul
        className="epic-graph-cards"
        data-goal={goal ? "" : undefined}
        aria-label={text({
          id: "epics-graph-layer",
          args: { layer: props.layer, done, count: tickets.length },
        })}
      >
        {tickets.map((ticket) => (
          <li key={ticket.node.ticket}>
            <EpicGraphCardHeld ticket={ticket} held={held} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/** Whether the longest chain is drawn: as the reader last set it while the
 * selection stood where it stands, and otherwise only while nothing is
 * selected. */
function useEpicGraphChainShown(
  selected: number | undefined,
): readonly [boolean, (shown: boolean) => void] {
  const [chain, setChain] = useState<{
    readonly shown: boolean;
    readonly selected: number | undefined;
  }>({ shown: selected === undefined, selected });
  const shown =
    chain.selected === selected ? chain.shown : selected === undefined;
  return [
    shown,
    (next: boolean) => {
      setChain({ shown: next, selected });
    },
  ];
}

/** Escape clears the selection while there is one. */
function useEpicGraphEscape(
  selected: number | undefined,
  onTicket: (ticket: number | undefined) => void,
): void {
  useEffect(() => {
    if (selected === undefined) return undefined;
    const cleared = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onTicket(undefined);
    };
    document.addEventListener("keydown", cleared);
    return () => {
      document.removeEventListener("keydown", cleared);
    };
  }, [selected, onTicket]);
}

/** What the cards are drawn against: the ticket in focus, a preview over the
 * selection, and what it keeps; the chain's steps while the chain is drawn
 * and nothing is selected; and the kickers too common to show. Pressing the
 * selected card clears the selection. */
function useEpicGraphCardsHeld(
  layered: EpicGraphLayered,
  selected: number | undefined,
  chainShown: boolean,
  queues: LandingQueuesResponse | undefined,
  onTicket: (ticket: number | undefined) => void,
): EpicGraphCardsHeld {
  const [preview, setPreview] = useState<number | undefined>(undefined);
  const focus = [preview, selected].find(
    (ticket) => ticket !== undefined && layered.layerOf.has(ticket),
  );
  const kept = useMemo(
    () =>
      focus === undefined
        ? undefined
        : epicGraphTraced(focus, layered.edges).tickets,
    [focus, layered],
  );
  const kickersHidden = useMemo(
    () =>
      epicGraphKickersCommonOf(
        layered.layers.flat().map((ticket) => ticket.node.title),
      ),
    [layered],
  );
  return {
    layered,
    selected,
    kept,
    steps:
      chainShown && selected === undefined
        ? new Map(layered.chain.map((ticket, at) => [ticket, at + 1]))
        : new Map(),
    kickersHidden,
    queues,
    onSelect: (ticket) => {
      onTicket(ticket === selected ? undefined : ticket);
    },
    onPreview: setPreview,
  };
}

/** The graph in layers beside the ticket selected. */
function EpicGraphViewLayered(props: {
  readonly held: EpicPageHeld;
  readonly graph: EpicGraphResponse;
  readonly layered: EpicGraphLayered;
  readonly rows: ReadonlyMap<number, ProjectTableRow>;
  readonly ticket: number | undefined;
  readonly onTicket: (ticket: number | undefined) => void;
  readonly outsideShown: boolean;
  readonly onOutsideShown: (shown: boolean) => void;
}): ReactNode {
  const text = useCopyText();
  const { held, graph, layered, onTicket } = props;
  const selected = epicGraphSelectedOf(layered.tickets, props.ticket);
  const [chainShown, setChainShown] = useEpicGraphChainShown(selected);
  useEpicGraphEscape(selected, onTicket);
  const cardsHeld = useEpicGraphCardsHeld(
    layered,
    selected,
    chainShown,
    held.queues,
    onTicket,
  );
  const chosen =
    selected === undefined ? undefined : layered.tickets.get(selected);
  return (
    <div className="epic-graph">
      {chosen === undefined ? (
        <EpicGraphSideSummary layered={layered} onTicket={onTicket} />
      ) : (
        <EpicGraphSide
          partition={held.partition}
          graph={graph}
          ticket={chosen}
          layered={layered}
          row={props.rows.get(chosen.node.ticket)}
          onTicket={onTicket}
        />
      )}
      <div className="epic-graph-panel">
        <EpicGraphBar
          tickets={layered.tickets}
          chain={layered.chain.length}
          chainShown={chainShown}
          onChainShown={setChainShown}
          outside={graph.nodes.filter((node) => !node.member).length}
          outsideShown={props.outsideShown}
          onOutsideShown={props.onOutsideShown}
        />
        <ol
          className="epic-graph-layers"
          aria-label={text({ id: "epics-graph-label" })}
        >
          {layered.layers.map((tickets, at) => (
            <EpicGraphLayer
              key={at}
              layer={at + 1}
              tickets={tickets}
              held={cardsHeld}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

/** The graph in layers beside the ticket selected. */
export function EpicGraphView(props: {
  readonly held: EpicPageHeld;
  readonly graph: EpicGraphResponse;
  readonly ticket: number | undefined;
  readonly onTicket: (ticket: number | undefined) => void;
}): ReactNode {
  const [outsideShown, setOutsideShown] = useState(true);
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
  const layered = useMemo(
    () =>
      epicGraphLayeredOf(
        props.graph,
        epicGraphTicketsOf(props.graph, rows),
        outsideShown,
      ),
    [props.graph, rows, outsideShown],
  );
  return (
    <EpicGraphViewLayered
      {...props}
      layered={layered}
      rows={rows}
      outsideShown={outsideShown}
      onOutsideShown={setOutsideShown}
    />
  );
}
