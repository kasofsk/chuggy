/**
 * The head of every tab of the ticket page: the title with its number, the
 * epics it belongs to, the state label and the one fragment beside it, the actions, and the tabs. Once
 * the header has scrolled out of view, a thin bar holding the small label and
 * the title sticks to the top of the page in its place.
 */

import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { runNowElapsedFigure } from "../../core/runNow.ts";
import type { TicketHeaderFragment } from "../../core/ticketHeader.ts";
import type { TicketListStanding } from "../../core/ticketListView.ts";
import { Figure } from "../ui/Figure.tsx";
import { TicketStateLabel } from "./TicketStateLabel.tsx";

import "./ticket.css";

/** Whether the element is out of view, which nothing says until it has been
 * observed and a browser without the observer never says. */
function useScrolledAway(ref: RefObject<HTMLElement | null>): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof IntersectionObserver === "undefined")
      return undefined;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry !== undefined) setAway(!entry.isIntersecting);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return away;
}

function TicketHeaderFragmentDrawn(props: {
  readonly fragment: TicketHeaderFragment;
  readonly nowMs: number;
}): ReactNode {
  const fragment = props.fragment;
  switch (fragment.fragment) {
    case "None":
      return null;
    case "Words":
      return <span className="ticket-header-fragment">{fragment.words}</span>;
    case "Running":
      return (
        <span className="ticket-header-fragment">
          {`${fragment.step} · `}
          <Figure figure={runNowElapsedFigure(fragment.since, props.nowMs)} />
        </span>
      );
    case "Landed":
      return (
        <span className="ticket-header-fragment">
          {fragment.words}
          {fragment.link === undefined ? null : (
            <>
              {" · "}
              <a
                href={fragment.link.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {fragment.link.label}
              </a>
            </>
          )}
        </span>
      );
  }
}

function TicketHeaderTitle(props: {
  readonly title: string;
  readonly ticket: number;
}): ReactNode {
  return (
    <h1 className="ticket-header-title">
      {props.title}{" "}
      <span className="ticket-header-number">{`#${String(props.ticket)}`}</span>
    </h1>
  );
}

export function TicketHeader(props: {
  readonly ticket: number;
  readonly title: string;
  readonly standing: TicketListStanding;
  readonly fragment: TicketHeaderFragment;
  readonly nowMs: number;
  readonly epics: ReactNode;
  readonly actions: ReactNode;
  readonly notes: ReactNode;
}): ReactNode {
  const header = useRef<HTMLElement>(null);
  const away = useScrolledAway(header);
  return (
    <>
      <div className="ticket-sticky">
        <div className="ticket-sticky-bar" hidden={!away}>
          <TicketStateLabel standing={props.standing} size="small" />
          <span className="ticket-sticky-title">{props.title}</span>
        </div>
      </div>
      <header ref={header} className="ticket-header">
        <TicketHeaderTitle title={props.title} ticket={props.ticket} />
        {props.epics}
        <div className="ticket-header-standing">
          <div className="ticket-header-state">
            <TicketStateLabel standing={props.standing} size="page" />
            <TicketHeaderFragmentDrawn
              fragment={props.fragment}
              nowMs={props.nowMs}
            />
          </div>
          {props.actions}
        </div>
        {props.notes}
      </header>
    </>
  );
}

/** One tab: a link to its own address, which the router marks current, and
 * which `within` marks current under it as well. */
function TicketTab(props: {
  readonly to:
    | "/$tenant/$project/tickets/$ticket"
    | "/$tenant/$project/tickets/$ticket/runs"
    | "/$tenant/$project/tickets/$ticket/configuration"
    | "/$tenant/$project/tickets/$ticket/usage";
  readonly params: PartitionIdentity & { readonly ticket: string };
  readonly within?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <li>
      <Link
        to={props.to}
        params={props.params}
        activeOptions={{ exact: props.within !== true, includeSearch: false }}
        aria-current={props.within === true ? "page" : undefined}
        className="ticket-tab"
      >
        {props.children}
      </Link>
    </li>
  );
}

/** The tabs, the same whatever the ticket's state; Runs carries how many runs
 * the page holds once it holds any, with a + where the page is cut off. */
export function TicketTabs(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly runCount: number | undefined;
  readonly runCountCut: boolean;
  /** Whether a page under the Runs tab is drawn, at an address of its own. */
  readonly runsWithin: boolean;
}): ReactNode {
  const params = { ...props.partition, ticket: String(props.ticket) };
  const runCount = props.runCount ?? 0;
  return (
    <nav aria-label="Ticket" className="ticket-tabs">
      <ul>
        <TicketTab to="/$tenant/$project/tickets/$ticket" params={params}>
          Overview
        </TicketTab>
        <TicketTab
          to="/$tenant/$project/tickets/$ticket/runs"
          params={params}
          within={props.runsWithin}
        >
          Runs
          {runCount === 0 ? null : (
            <span className="ticket-tab-count">
              {props.runCountCut ? `${String(runCount)}+` : runCount}
            </span>
          )}
        </TicketTab>
        <TicketTab
          to="/$tenant/$project/tickets/$ticket/configuration"
          params={params}
        >
          Configuration
        </TicketTab>
        <TicketTab to="/$tenant/$project/tickets/$ticket/usage" params={params}>
          Usage
        </TicketTab>
      </ul>
    </nav>
  );
}
