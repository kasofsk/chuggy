/**
 * The selected ticket on a phone, in a sheet fixed to the foot of the screen
 * in place of the side panel: its state, number and Close; its title; what it
 * depends on and what it blocks, each a row of pills that select that ticket;
 * and its place in the layers, a link to its page and, where the side panel
 * offers it, dispatch.
 *
 * Beside it the page gains room the sheet's height, so the last layer can
 * scroll clear of it. A ticket selected from the sheet has its card scrolled
 * to the middle of the room above the sheet, unless it is already in view
 * there. The room is an SVG's own height, since the served policy refuses a
 * `style`.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { EpicGraphResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { epicGraphNeighboursOf } from "../../core/epicGraph.ts";
import type { EpicGraphTicket } from "../../core/epicGraph.ts";
import type { EpicGraphLayered } from "../../core/epicGraphLayers.ts";
import { epicGraphSheetScrollOf } from "../../core/epicGraphSheet.ts";
import type { ProjectTableRow } from "../../core/projectTableRows.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import { useViewportMotion } from "../shell/viewport.ts";
import { Button } from "../ui/Button.tsx";
import {
  EpicGraphSideActions,
  EpicGraphSideMark,
  EpicGraphSidePlace,
} from "./EpicGraphSide.tsx";

import "./epicGraph.css";

/** One row of pills under its heading, or the word for none. */
function EpicGraphSheetRow(props: {
  readonly heading: string;
  readonly tickets: readonly number[];
  readonly held: ReadonlyMap<number, EpicGraphTicket>;
  readonly onTicket: (ticket: number) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <section className="epic-graph-sheet-row">
      <h4 className="epic-graph-side-heading">{props.heading}</h4>
      {props.tickets.length === 0 ? (
        <p className="epic-graph-side-none">
          {text({ id: "epics-side-none" })}
        </p>
      ) : (
        <ul className="epic-graph-sheet-pills" aria-label={props.heading}>
          {props.tickets.map((ticket) => {
            const other = props.held.get(ticket);
            const title =
              other?.node.title ?? text({ id: "epics-card-untitled" });
            return (
              <li key={ticket}>
                <button
                  type="button"
                  className="epic-graph-sheet-pill"
                  aria-label={text({
                    id: "epics-sheet-ticket",
                    args: {
                      ticket: String(ticket),
                      title,
                      state:
                        other === undefined
                          ? ""
                          : text(ticketStateLabelOf(other.standing).word),
                    },
                  })}
                  title={title}
                  onClick={() => {
                    props.onTicket(ticket);
                  }}
                >
                  {other === undefined ? null : (
                    <EpicGraphSideMark standing={other.standing} />
                  )}
                  <span className="epic-graph-sheet-number">
                    {String(ticket)}
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

/** The nearest ancestor that scrolls, or none where the document does. */
function epicGraphSheetScrollerOf(element: Element): Element | undefined {
  for (
    let at = element.parentElement;
    at !== null && at !== document.body;
    at = at.parentElement
  ) {
    const { overflowY } = getComputedStyle(at);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      at.scrollHeight > at.clientHeight
    )
      return at;
  }
  return undefined;
}

/** Scrolls the ticket's card to the middle of the room above the sheet,
 * unless it is already wholly in it. */
function epicGraphSheetScrolled(
  sheet: HTMLElement,
  ticket: number,
  motion: boolean,
): void {
  const card = sheet
    .closest(".epic-graph")
    ?.querySelector(`.epic-card[data-ticket="${String(ticket)}"]`);
  if (card === null || card === undefined) return;
  const scroller = epicGraphSheetScrollerOf(card);
  const top = Math.max(0, scroller?.getBoundingClientRect().top ?? 0);
  const bottom = Math.max(top, sheet.getBoundingClientRect().top);
  const box = card.getBoundingClientRect();
  const by = epicGraphSheetScrollOf(
    { top: box.top, bottom: box.bottom },
    { top, bottom },
  );
  if (by === undefined) return;
  const options: ScrollToOptions = {
    top: by,
    behavior: motion ? "smooth" : "auto",
  };
  if (scroller === undefined) window.scrollBy(options);
  else scroller.scrollBy(options);
}

/** The sheet's height, as each observation of its size reports it, the
 * first of which comes once it is drawn. */
function useEpicGraphSheetHeight(sheet: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (sheet === null || typeof ResizeObserver === "undefined")
      return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries)
        setHeight(
          entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height,
        );
    });
    observer.observe(sheet);
    return () => {
      observer.disconnect();
    };
  }, [sheet]);
  return height;
}

/** The ticket's state mark, number and state word, and Close. */
function EpicGraphSheetHead(props: {
  readonly ticket: EpicGraphTicket;
  readonly onClose: () => void;
}): ReactNode {
  const text = useCopyText();
  const { node, standing } = props.ticket;
  const label = ticketStateLabelOf(standing);
  return (
    <div className="epic-graph-sheet-head" data-tone={label.tone}>
      <EpicGraphSideMark standing={standing} />
      <span className="epic-graph-sheet-number">{`#${String(node.ticket)}`}</span>
      <span className="epic-graph-sheet-word">{text(label.word)}</span>
      <Button
        size="icon"
        variant="quiet"
        named={text({ id: "ui-close" })}
        onClick={props.onClose}
      >
        <svg
          aria-hidden="true"
          className="size-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </Button>
    </div>
  );
}

/** Where the ticket stands in the layers, a link to its page, and dispatch
 * where the side panel offers it. */
function EpicGraphSheetFoot(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: EpicGraphTicket;
  readonly layered: EpicGraphLayered;
  readonly row: ProjectTableRow | undefined;
}): ReactNode {
  return (
    <div className="epic-graph-sheet-foot">
      <EpicGraphSidePlace
        ticket={props.ticket.node.ticket}
        layered={props.layered}
      />
      <EpicGraphSideActions
        partition={props.partition}
        ticket={props.ticket}
        row={props.row}
      />
    </div>
  );
}

export function EpicGraphSheet(props: {
  readonly partition: PartitionIdentity;
  readonly graph: EpicGraphResponse;
  readonly ticket: EpicGraphTicket;
  readonly layered: EpicGraphLayered;
  readonly row: ProjectTableRow | undefined;
  readonly onTicket: (ticket: number | undefined) => void;
}): ReactNode {
  const text = useCopyText();
  const motion = useViewportMotion();
  const { node } = props.ticket;
  const { dependsOn, blocks } = epicGraphNeighboursOf(props.graph, node.ticket);
  const [sheet, setSheet] = useState<HTMLElement | null>(null);
  const height = useEpicGraphSheetHeight(sheet);
  const chosen = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (sheet === null || chosen.current !== node.ticket) return;
    chosen.current = undefined;
    epicGraphSheetScrolled(sheet, node.ticket, motion);
  }, [sheet, node.ticket, motion]);
  const onTicket = (ticket: number) => {
    chosen.current = ticket;
    props.onTicket(ticket);
  };
  return (
    <>
      <svg
        className="epic-graph-sheet-room"
        width={1}
        height={height}
        aria-hidden="true"
      />
      <aside
        ref={setSheet}
        className="epic-graph-sheet"
        aria-label={text({ id: "epics-side-label" })}
        data-ticket={node.ticket}
      >
        <EpicGraphSheetHead
          ticket={props.ticket}
          onClose={() => {
            props.onTicket(undefined);
          }}
        />
        <h3 className="epic-graph-sheet-title">
          {node.title ?? text({ id: "epics-card-untitled" })}
        </h3>
        <EpicGraphSheetRow
          heading={text({ id: "epics-side-depends-on" })}
          tickets={dependsOn}
          held={props.layered.tickets}
          onTicket={onTicket}
        />
        <EpicGraphSheetRow
          heading={text({ id: "epics-side-blocks" })}
          tickets={blocks}
          held={props.layered.tickets}
          onTicket={onTicket}
        />
        <EpicGraphSheetFoot
          partition={props.partition}
          ticket={props.ticket}
          layered={props.layered}
          row={props.row}
        />
      </aside>
    </>
  );
}
