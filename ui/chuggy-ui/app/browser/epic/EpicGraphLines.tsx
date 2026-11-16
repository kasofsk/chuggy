/**
 * The lines of an epic's graph, in one SVG under its cards. Where the cards
 * and their ports are is read once per layout: when the graph is laid out and
 * when its drawing changes size, never while a ticket is previewed, which
 * only writes.
 *
 * A look is drawn in one of two layers: a new look fades in through its whole
 * layer over the one before, which fades out under it, and nothing animates
 * per line. A redraw of the same look, after the drawing changes size,
 * replaces its paths and leaves its fade as it is.
 */

import { useLayoutEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { epicGraphEdgeKey } from "../../core/epicGraph.ts";
import type { EpicGraphPoint } from "../../core/epicGraph.ts";
import type { EpicGraphLayered } from "../../core/epicGraphLayers.ts";
import {
  epicGraphLinesOf,
  epicGraphLookSame,
  epicGraphPlacedNone,
} from "../../core/epicGraphLines.ts";
import type {
  EpicGraphLines as EpicGraphLinesKinds,
  EpicGraphLook,
  EpicGraphPlaced,
  EpicGraphPlacedCard,
} from "../../core/epicGraphLines.ts";

/** The cards and ports under a drawing, against its top left corner, and the
 * drawing's size. */
function epicGraphPlacedOf(drawing: HTMLElement): {
  readonly placed: EpicGraphPlaced;
  readonly size: string;
} {
  const origin = drawing.getBoundingClientRect();
  const across = (box: DOMRect) => box.left - origin.left + box.width / 2;
  const cards = new Map<number, EpicGraphPlacedCard>();
  const ports = new Map<string, EpicGraphPoint>();
  for (const card of drawing.querySelectorAll<HTMLElement>(
    ".epic-card[data-ticket]",
  )) {
    const ticket = Number(card.dataset["ticket"]);
    const box = card.getBoundingClientRect();
    cards.set(ticket, {
      top: { x: across(box), y: box.top - origin.top },
      bottom: { x: across(box), y: box.bottom - origin.top },
    });
    for (const port of card.querySelectorAll<HTMLElement>(
      ".epic-card-port[data-ticket]",
    )) {
      const dot = port.getBoundingClientRect();
      ports.set(epicGraphEdgeKey(Number(port.dataset["ticket"]), ticket), {
        x: across(dot),
        y: dot.top - origin.top + dot.height / 2,
      });
    }
  }
  return {
    placed: { cards, ports },
    size: `${String(origin.width)}x${String(origin.height)}`,
  };
}

/** Where the cards were measured: once each time the graph is laid out, and
 * again only when the drawing's size changes. */
function useEpicGraphPlaced(
  element: HTMLElement | null,
  layered: EpicGraphLayered,
): EpicGraphPlaced {
  const [placed, setPlaced] = useState(epicGraphPlacedNone);
  useLayoutEffect(() => {
    if (element === null) return undefined;
    let size = "";
    const measure = () => {
      const measured = epicGraphPlacedOf(element);
      size = measured.size;
      setPlaced(measured.placed);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (
        box !== undefined &&
        `${String(box.width)}x${String(box.height)}` !== size
      )
        measure();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element, layered]);
  return placed;
}

/** The look each layer draws, and which is in front: a new look takes the
 * layer behind and brings it to the front. */
interface EpicGraphLooks {
  readonly front: 0 | 1;
  readonly looks: readonly [EpicGraphLook, EpicGraphLook | undefined];
}

function useEpicGraphLooks(look: EpicGraphLook): EpicGraphLooks {
  const [looks, setLooks] = useState<EpicGraphLooks>({
    front: 0,
    looks: [look, undefined],
  });
  const shown = looks.looks[looks.front];
  if (shown !== undefined && epicGraphLookSame(shown, look)) return looks;
  const front = looks.front === 0 ? 1 : 0;
  const next: EpicGraphLooks = {
    front,
    looks: front === 0 ? [look, looks.looks[1]] : [looks.looks[0], look],
  };
  setLooks(next);
  return next;
}

const epicGraphLinesKinds: readonly (keyof EpicGraphLinesKinds)[] = [
  "faint",
  "strong",
  "met",
  "chain",
  "knots",
];

function EpicGraphLinesLayer(props: {
  readonly layered: EpicGraphLayered;
  readonly look: EpicGraphLook | undefined;
  readonly placed: EpicGraphPlaced;
  readonly shown: boolean;
}): ReactNode {
  const { layered, look, placed } = props;
  const lines = useMemo(
    () =>
      look === undefined ? undefined : epicGraphLinesOf(layered, look, placed),
    [layered, look, placed],
  );
  return (
    <g
      className="epic-graph-lines-look"
      data-shown={props.shown ? "" : undefined}
    >
      {epicGraphLinesKinds.map((kind) =>
        lines === undefined || lines[kind] === "" ? null : (
          <path
            key={kind}
            className="epic-graph-line"
            data-kind={kind}
            d={lines[kind]}
          />
        ),
      )}
    </g>
  );
}

export function EpicGraphLines(props: {
  readonly drawing: HTMLElement | null;
  readonly layered: EpicGraphLayered;
  readonly look: EpicGraphLook;
}): ReactNode {
  const placed = useEpicGraphPlaced(props.drawing, props.layered);
  const { front, looks } = useEpicGraphLooks(props.look);
  const behind = front === 0 ? 1 : 0;
  return (
    <svg className="epic-graph-lines" aria-hidden="true">
      {[behind, front].map((layer) => (
        <EpicGraphLinesLayer
          key={layer}
          layered={props.layered}
          look={looks[layer]}
          placed={placed}
          shown={layer === front}
        />
      ))}
    </svg>
  );
}
