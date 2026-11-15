/**
 * A ticket on an epic's graph, as a card: a dot along its top for each ticket
 * it waits on, filled where that one is Done; its state's mark, its number,
 * its title's label as a kicker where the label tells cards apart, a tag
 * where it is outside the epic, and its place in a landing queue where it has
 * one; then the rest of its title in two lines, and on the goal how many of
 * what it waits on are Done. The card is a button that
 * selects the ticket, or clears it where it is the one selected; pointing at
 * it, but never by touch, or focusing it from the keyboard previews it. A port
 * a strong line lands on is lit. A ticket outside the epic is a dashed card
 * with a tag, so which tickets the epic holds does not rest on hue alone.
 */

import { useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { EpicGraphTicket } from "../../core/epicGraph.ts";
import { epicGraphTitledOf } from "../../core/epicGraphLayers.ts";
import type { LandingQueuePlace } from "../../core/landingQueues.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import { LandingQueueChip } from "../ticket/LandingQueueChip.tsx";
import { TicketStateMark } from "../ticket/TicketStateLabel.tsx";

import "./epicGraph.css";

/** A dependency's dot along a card's top. */
export interface EpicGraphPort {
  readonly ticket: number;
  readonly met: boolean;
  /** A strong line lands on it. */
  readonly lit: boolean;
}

/** How a preview of a card starts or ends: by a pointer resting on it, or by
 * the keyboard's focus. */
export type EpicGraphPreviewBy = "pointer" | "focus";

/** A card's ticket previewed, or no longer. */
export type EpicGraphPreviewed = (
  ticket: number,
  previewed: boolean,
  by: EpicGraphPreviewBy,
) => void;

/** How a card is drawn against the rest of its graph. */
export interface EpicGraphCardDrawn {
  readonly selected: boolean;
  /** Out of the chain of the ticket in focus. */
  readonly dimmed: boolean;
  /** Its step on the longest chain, where that is drawn. */
  readonly step: number | undefined;
  /** The goal, drawn across its layer. */
  readonly goal: boolean;
  /** Its title's label is too common to tell cards apart. */
  readonly kickerHidden: boolean;
}

function EpicGraphCardPorts(props: {
  readonly ports: readonly EpicGraphPort[];
}): ReactNode {
  if (props.ports.length === 0) return null;
  return (
    <span className="epic-card-ports" aria-hidden="true">
      {props.ports.map((port) => (
        <span
          key={port.ticket}
          className="epic-card-port"
          data-ticket={port.ticket}
          data-met={port.met ? "" : undefined}
          data-lit={port.lit ? "" : undefined}
        />
      ))}
    </span>
  );
}

/** The card's first line: its mark, number, kicker, outside tag and chip. */
function EpicGraphCardHead(props: {
  readonly ticket: EpicGraphTicket;
  readonly kicker: string | undefined;
  readonly place: LandingQueuePlace | undefined;
}): ReactNode {
  const text = useCopyText();
  const { node, standing } = props.ticket;
  return (
    <span className="epic-card-head">
      <span className="epic-card-mark">
        <TicketStateMark standing={standing} />
      </span>
      <span className="epic-card-number">{String(node.ticket)}</span>
      {props.kicker === undefined ? null : (
        <span className="epic-card-kicker">{props.kicker}</span>
      )}
      {node.member ? null : (
        <span className="epic-card-outside">
          {text({ id: "epics-card-outside-tag" })}
        </span>
      )}
      <LandingQueueChip place={props.place} inLink />
    </span>
  );
}

/** What a card's button does when pressed, pointed at and focused. A focus
 * a pointer's press brought is no keyboard's, so it previews nothing. */
function useEpicGraphCardHandlers(
  ticket: number,
  onSelect: (ticket: number) => void,
  onPreview: EpicGraphPreviewed,
) {
  const pressed = useRef(false);
  const pointed = (previewed: boolean) => (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    onPreview(ticket, previewed, "pointer");
  };
  return {
    onClick: () => {
      onSelect(ticket);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      onSelect(ticket);
    },
    onPointerEnter: pointed(true),
    onPointerLeave: pointed(false),
    onPointerDown: () => {
      pressed.current = true;
    },
    onPointerUp: () => {
      pressed.current = false;
    },
    onFocus: () => {
      if (pressed.current) pressed.current = false;
      else onPreview(ticket, true, "focus");
    },
    onBlur: () => {
      pressed.current = false;
      onPreview(ticket, false, "focus");
    },
  };
}

/** On the goal, how many of what it waits on are Done; on the longest chain,
 * its step. */
function EpicGraphCardFoot(props: {
  readonly drawn: EpicGraphCardDrawn;
  readonly done: number;
  readonly count: number;
}): ReactNode {
  const text = useCopyText();
  const { drawn, done, count } = props;
  return (
    <>
      {drawn.goal ? (
        <span className="epic-card-goal">
          {text({ id: "epics-graph-done", args: { done, count } })}
        </span>
      ) : null}
      {drawn.step === undefined ? null : (
        <span className="epic-card-step" aria-hidden="true">
          {drawn.step}
        </span>
      )}
    </>
  );
}

export function EpicGraphCard(props: {
  readonly ticket: EpicGraphTicket;
  readonly ports: readonly EpicGraphPort[];
  readonly drawn: EpicGraphCardDrawn;
  readonly place: LandingQueuePlace | undefined;
  readonly onSelect: (ticket: number) => void;
  readonly onPreview: EpicGraphPreviewed;
}): ReactNode {
  const text = useCopyText();
  const handlers = useEpicGraphCardHandlers(
    props.ticket.node.ticket,
    props.onSelect,
    props.onPreview,
  );
  const { node, standing } = props.ticket;
  const { drawn } = props;
  const label = ticketStateLabelOf(standing);
  const title = node.title ?? text({ id: "epics-card-untitled" });
  const titled = epicGraphTitledOf(title);
  const kicker = drawn.kickerHidden ? undefined : titled.kicker;
  const ticket = String(node.ticket);
  const met = props.ports.filter((port) => port.met).length;
  return (
    <div
      className="epic-card"
      data-ticket={node.ticket}
      data-member={node.member ? "" : undefined}
      data-outside={node.member ? undefined : ""}
      data-tone={label.tone}
      data-standing={standing}
      data-dim={drawn.dimmed ? "" : undefined}
      data-step={drawn.step}
      data-goal={drawn.goal ? "" : undefined}
    >
      <button
        type="button"
        className="epic-card-button"
        aria-pressed={drawn.selected}
        aria-label={text({
          id: node.member ? "epics-card" : "epics-card-outside",
          args: {
            ticket,
            title,
            state: text(label.word),
            done: met,
            count: props.ports.length,
          },
        })}
        title={title}
        {...handlers}
      >
        <EpicGraphCardPorts ports={props.ports} />
        <EpicGraphCardHead
          ticket={props.ticket}
          kicker={kicker}
          place={props.place}
        />
        <span className="epic-card-title">{titled.rest}</span>
        <EpicGraphCardFoot
          drawn={drawn}
          done={met}
          count={props.ports.length}
        />
      </button>
    </div>
  );
}
