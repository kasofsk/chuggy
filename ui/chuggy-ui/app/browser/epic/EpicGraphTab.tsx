/**
 * The epic page's Graph tab: the members and the tickets outside the epic
 * they wait on, drawn beside the ticket selected, or the one line its read is
 * drawn as while it is not ready. The ticket selected is the address's, and
 * none where it names none. Where the page is narrow a drawn graph is headed
 * by the way to the same tickets as a list.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { Notice } from "../ui/Notice.tsx";
import { TextLink } from "../ui/TextLink.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";
import { EpicTabHeading } from "./EpicTabs.tsx";
import { EpicGraphView } from "./EpicGraphView.tsx";

import "./epicGraph.css";

/** The graph's own place, holding a line where the graph is not yet drawn. */
function EpicGraphFrameSaying(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="epic-graph-frame">
      <p className="epic-graph-saying">{props.children}</p>
    </div>
  );
}

/** The Tickets tab, which the sheet shows only where the page is narrow. */
function EpicGraphAsList(): ReactNode {
  const held = useEpicPageHeld();
  const text = useCopyText();
  return (
    <p className="epic-graph-as-list">
      <TextLink
        to="/$tenant/$project/epics/$epic/tickets"
        params={{ ...held.partition, epic: String(held.epic) }}
      >
        {text({ id: "epics-graph-as-list" })}
      </TextLink>
    </p>
  );
}

export function EpicGraphTab(props: {
  /** The ticket the address selects, if it names one. */
  readonly ticket: number | undefined;
  readonly onTicket: (ticket: number | undefined) => void;
}): ReactNode {
  const held = useEpicPageHeld();
  const text = useCopyText();
  const state = held.graphState;
  const drawn = (): ReactNode => {
    switch (state.state) {
      case "Pending":
        return (
          <EpicGraphFrameSaying>
            {text({ id: "epics-graph-loading" })}
          </EpicGraphFrameSaying>
        );
      case "Ready":
        return state.value.nodes.length === 0 ? (
          <EpicGraphFrameSaying>
            {text({ id: "epics-graph-empty" })}
          </EpicGraphFrameSaying>
        ) : (
          <>
            <EpicGraphAsList />
            <EpicGraphView
              held={held}
              graph={state.value}
              ticket={props.ticket}
              onTicket={props.onTicket}
            />
          </>
        );
      case "Absent":
      case "Failed":
        return (
          <div className="epic-graph-frame">
            <Notice
              tone="danger"
              inline
              detail={text({ id: "epics-graph-failed" })}
            />
          </div>
        );
    }
  };
  return (
    <section
      className="epic-graph-section"
      aria-label={text({ id: "epics-graph-label" })}
    >
      <EpicTabHeading tab="epics-tab-graph" />
      {drawn()}
    </section>
  );
}
