/**
 * The epic page's Graph tab: the members and the tickets outside the epic
 * they wait on, as the canvas draws them, or the one line its read is drawn as
 * while it is not ready. The canvas is loaded on its own, once the tab is.
 */

import { lazy, Suspense, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { EpicGraphResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Notice } from "../ui/Notice.tsx";
import { epicGraphCardKinds, epicGraphCardsHeldOf } from "./EpicGraphCards.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";
import type { EpicPageHeld } from "./EpicPageHeld.tsx";

import "./epicGraph.css";

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
  const { partition, rowsState, queues } = props.held;
  const tickets = readValue(rowsState)?.tickets;
  const cardsHeld = useMemo(
    () => epicGraphCardsHeldOf(partition, props.graph, tickets, queues),
    [partition, props.graph, tickets, queues],
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

export function EpicGraphTab(): ReactNode {
  const held = useEpicPageHeld();
  const text = useCopyText();
  const state = held.graphState;
  return (
    <section
      className="epic-graph-section"
      aria-label={text({ id: "epics-graph-label" })}
    >
      {state.state === "Ready" ? (
        <EpicGraphReady held={held} graph={state.value} />
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
