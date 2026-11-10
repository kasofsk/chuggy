/**
 * An epic's graph as a canvas the reader pans and zooms: the members and the
 * tickets outside the epic they wait on, as cards laid out left to right by
 * `core/epicGraph.ts`, each connector a curve from a dependency to its
 * dependent ending in an arrowhead.
 *
 * It opens fitted to the graph and never zoomed in past its own size. Dragging
 * the background pans it and the controls zoom it within bounds; the wheel is
 * left to the page, so scrolling over the graph still scrolls the page. The
 * view is an SVG transform rather than a `style`, which the served policy
 * refuses. Full screen is the browser's where it has it, and otherwise the
 * canvas laid over the page.
 *
 * It is loaded on its own, once the Graph tab asks for it.
 */

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent, ReactNode, RefObject } from "react";

import type { EpicGraphResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  epicGraphConnectorPath,
  epicGraphDrawn,
  epicGraphFitted,
  epicGraphRunOf,
  epicGraphViewTransform,
  epicGraphZoomed,
  epicGraphZoomStep,
} from "../../core/epicGraph.ts";
import type {
  EpicGraphDrawn,
  EpicGraphSize,
  EpicGraphView,
} from "../../core/epicGraph.ts";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import type {
  EpicGraphCardKinds,
  EpicGraphCardsHeld,
} from "./EpicGraphCards.tsx";
import type { EpicPageHeld } from "./EpicPageHeld.tsx";

import "./epicGraph.css";

type EpicGraphFull = "None" | "Screen" | "Overlay";

/** Full screen: the browser's, where it offers it and grants it, and the
 * canvas laid over the page where it does not, which Escape leaves. */
function useEpicGraphFull(frame: RefObject<HTMLElement | null>): {
  readonly full: EpicGraphFull;
  readonly toggled: () => void;
} {
  const [full, setFull] = useState<EpicGraphFull>("None");
  useEffect(() => {
    const changed = (): void => {
      const screened =
        frame.current !== null && document.fullscreenElement === frame.current;
      setFull((was) => (screened ? "Screen" : was === "Screen" ? "None" : was));
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
    };
  }, [frame]);
  useEffect(() => {
    if (full !== "Overlay") return undefined;
    const pressed = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFull("None");
    };
    document.addEventListener("keydown", pressed);
    return () => {
      document.removeEventListener("keydown", pressed);
    };
  }, [full]);
  const toggled = (): void => {
    const element = frame.current;
    if (full === "Screen") {
      void document.exitFullscreen();
      return;
    }
    if (full === "Overlay" || element === null) {
      setFull("None");
      return;
    }
    if (
      document.fullscreenEnabled &&
      typeof element.requestFullscreen === "function"
    )
      element.requestFullscreen().catch(() => {
        setFull("Overlay");
      });
    else setFull("Overlay");
  };
  return { full, toggled };
}

/** The frame's size, read once it is drawn and again whenever it resizes. */
function useEpicGraphFrameSize(
  frame: RefObject<HTMLElement | null>,
): EpicGraphSize {
  const [size, setSize] = useState<EpicGraphSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = frame.current;
    if (element === null) return undefined;
    const measured = (width: number, height: number): void => {
      setSize((was) =>
        was.width === width && was.height === height ? was : { width, height },
      );
    };
    const box = element.getBoundingClientRect();
    measured(box.width, box.height);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries)
        measured(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [frame]);
  return size;
}

/** The view, fitted afresh whenever the graph's size or the frame's moves,
 * and panned by dragging the background. */
function useEpicGraphView(drawn: EpicGraphDrawn, size: EpicGraphSize) {
  const fittedFor = `${String(drawn.width)}x${String(drawn.height)}@${String(size.width)}x${String(size.height)}`;
  const [held, setHeld] = useState(() => ({
    fittedFor,
    view: epicGraphFitted(drawn, size),
  }));
  if (held.fittedFor !== fittedFor)
    setHeld({ fittedFor, view: epicGraphFitted(drawn, size) });
  const viewed = useCallback(
    (view: EpicGraphView) => {
      setHeld({ fittedFor, view });
    },
    [fittedFor],
  );
  const dragging = useRef<{ x: number; y: number; view: EpicGraphView }>(
    undefined,
  );
  const pan = {
    onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0 || (event.target as Element).closest("a, button"))
        return;
      dragging.current = {
        x: event.clientX,
        y: event.clientY,
        view: held.view,
      };
      if (typeof event.currentTarget.setPointerCapture === "function")
        event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
      const from = dragging.current;
      if (from === undefined) return;
      viewed({
        ...from.view,
        x: from.view.x + event.clientX - from.x,
        y: from.view.y + event.clientY - from.y,
      });
    },
    onPointerUp: () => {
      dragging.current = undefined;
    },
    onPointerCancel: () => {
      dragging.current = undefined;
    },
  };
  return { view: held.view, viewed, pan };
}

function EpicGraphControls(props: {
  readonly view: EpicGraphView;
  readonly size: EpicGraphSize;
  readonly drawn: EpicGraphDrawn;
  readonly viewed: (view: EpicGraphView) => void;
}): ReactNode {
  const text = useCopyText();
  const { view, size } = props;
  const controls = [
    {
      id: "epics-graph-zoom-in",
      glyph: "+",
      to: () => epicGraphZoomed(view, epicGraphZoomStep, size),
    },
    {
      id: "epics-graph-zoom-out",
      glyph: "−",
      to: () => epicGraphZoomed(view, 1 / epicGraphZoomStep, size),
    },
    {
      id: "epics-graph-fit",
      glyph: "⤢",
      to: () => epicGraphFitted(props.drawn, size),
    },
  ] as const;
  return (
    <div
      className="epic-graph-controls"
      role="group"
      aria-label={text({ id: "epics-graph-controls" })}
    >
      {controls.map((control) => (
        <button
          key={control.id}
          type="button"
          className="epic-graph-control"
          aria-label={text({ id: control.id })}
          title={text({ id: control.id })}
          onClick={() => {
            props.viewed(control.to());
          }}
        >
          <span aria-hidden="true">{control.glyph}</span>
        </button>
      ))}
    </div>
  );
}

/** The run each member has under way, from the ticket list's row where it
 * holds the member. */
function useEpicGraphRuns(held: EpicPageHeld, drawn: EpicGraphDrawn) {
  const tickets = readValue(held.rowsState)?.tickets;
  return useMemo(() => {
    const byTicket = new Map(
      (tickets ?? []).map((ticket) => [ticket.ticket, ticket]),
    );
    return new Map(
      drawn.cards
        .filter((card) => card.node.member)
        .map((card) => [
          card.node.ticket,
          epicGraphRunOf(byTicket.get(card.node.ticket)),
        ]),
    );
  }, [drawn, tickets]);
}

/** Everything the view transforms, drawn again only when what it draws
 * moves, so a pan redraws nothing under the transform. */
const EpicGraphScene = memo(function EpicGraphScene(props: {
  readonly held: EpicPageHeld;
  readonly cards: EpicGraphCardKinds;
  readonly cardsHeld: EpicGraphCardsHeld;
  readonly drawn: EpicGraphDrawn;
}): ReactNode {
  const arrow = `epic-graph-arrow-${useId().replace(/[^a-zA-Z0-9-]/gu, "")}`;
  const { drawn } = props;
  const runs = useEpicGraphRuns(props.held, drawn);
  const cards = props.cardsHeld;
  return (
    <>
      <defs>
        <marker
          id={arrow}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path className="epic-graph-arrow" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {drawn.connectors.map((connector) => (
        <path
          key={`${String(connector.from)}-${String(connector.to)}`}
          className="epic-graph-connector"
          data-outside={connector.outside ? "" : undefined}
          d={epicGraphConnectorPath(connector)}
          markerEnd={`url(#${arrow})`}
        />
      ))}
      {drawn.cards.map((card) =>
        card.node.member ? (
          <props.cards.Member
            key={card.node.ticket}
            card={card}
            run={runs.get(card.node.ticket)}
            held={cards}
          />
        ) : (
          <props.cards.Outside
            key={card.node.ticket}
            card={card}
            held={cards}
          />
        ),
      )}
    </>
  );
});

export default function EpicGraphCanvas(props: {
  readonly held: EpicPageHeld;
  readonly cards: EpicGraphCardKinds;
  readonly cardsHeld: EpicGraphCardsHeld;
  readonly graph: EpicGraphResponse;
  readonly outsideShown: boolean;
}): ReactNode {
  const text = useCopyText();
  const frame = useRef<HTMLDivElement>(null);
  const drawn = useMemo(
    () => epicGraphDrawn(props.graph, props.outsideShown),
    [props.graph, props.outsideShown],
  );
  const size = useEpicGraphFrameSize(frame);
  const { view, viewed, pan } = useEpicGraphView(drawn, size);
  const { full, toggled } = useEpicGraphFull(frame);
  const fullWord = text({
    id: full === "None" ? "epics-graph-full-enter" : "epics-graph-full-exit",
  });
  return (
    <div ref={frame} className="epic-graph-frame" data-full={full}>
      <svg
        className="epic-graph-canvas"
        role="group"
        aria-label={text({ id: "epics-graph-label" })}
        {...pan}
      >
        <g transform={epicGraphViewTransform(view)}>
          <EpicGraphScene
            held={props.held}
            cards={props.cards}
            cardsHeld={props.cardsHeld}
            drawn={drawn}
          />
        </g>
      </svg>
      <button
        type="button"
        className="epic-graph-control epic-graph-full"
        aria-label={fullWord}
        aria-pressed={full !== "None"}
        title={fullWord}
        onClick={toggled}
      >
        <span aria-hidden="true">{full === "None" ? "⛶" : "✕"}</span>
      </button>
      <EpicGraphControls
        view={view}
        size={size}
        drawn={drawn}
        viewed={viewed}
      />
    </div>
  );
}
