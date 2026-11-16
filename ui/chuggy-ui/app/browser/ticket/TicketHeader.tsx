/**
 * The head of every tab of the ticket page, drawn through `PageHeader`: the
 * title with its number, the state label with the one fragment beside it and
 * its place in a landing queue where it holds one, the actions, the epics it
 * belongs to, and the tabs. Once the header has scrolled out of view, the
 * primitive's bar holds the small label and the title in its place.
 *
 * A STATE THAT CHANGES UNDER THE READER IS SAID, once, through a status nobody
 * sees, in the word the label shows; the state the page opens on is not.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { LandingQueuePlace } from "../../core/landingQueues.ts";
import { ticketStateAnnounced } from "../../core/ticketHeader.ts";
import type {
  TicketHeaderFragment,
  TicketStateStanding,
} from "../../core/ticketHeader.ts";
import type { Copy } from "../../core/copy.ts";
import { LandingQueueChip } from "./LandingQueueChip.tsx";
import { TicketRunMarkDrawn } from "./TicketRunMark.tsx";
import { TicketRunTime } from "./TicketRunTime.tsx";
import { TicketStateLabel } from "./TicketStateLabel.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { PageHeader } from "../ui/PageHeader.tsx";

import "./ticket.css";

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
          <TicketRunTime runs={[fragment.run]} nowMs={props.nowMs} />
        </span>
      );
    case "Landed":
      return (
        <span className="ticket-header-fragment">
          <TicketRunMarkDrawn mark="Merge" tone="finalization" />
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

/** The status a change of state is said in, empty until the state changes. */
function TicketStateAnnouncement(props: {
  readonly standing: TicketStateStanding;
}): ReactNode {
  const text = useCopyText();
  const [seen, setSeen] = useState<{
    readonly standing: TicketStateStanding;
    readonly said: Copy | undefined;
  }>({ standing: props.standing, said: undefined });
  if (seen.standing !== props.standing)
    setSeen({
      standing: props.standing,
      said: ticketStateAnnounced(seen.standing, props.standing) ?? seen.said,
    });
  return (
    <p role="status" className="visually-hidden">
      {seen.said === undefined ? null : text(seen.said)}
    </p>
  );
}

export function TicketHeader(props: {
  readonly ticket: number;
  readonly title: string;
  readonly standing: TicketStateStanding;
  readonly fragment: TicketHeaderFragment;
  readonly queued?: LandingQueuePlace | undefined;
  readonly nowMs: number;
  readonly epics: ReactNode;
  readonly actions: ReactNode;
  readonly notes: ReactNode;
}): ReactNode {
  return (
    <PageHeader
      title={props.title}
      number={props.ticket}
      status={
        <>
          <TicketStateAnnouncement standing={props.standing} />
          <TicketStateLabel standing={props.standing} size="page" />
          <TicketHeaderFragmentDrawn
            fragment={props.fragment}
            nowMs={props.nowMs}
          />
          <LandingQueueChip place={props.queued} />
        </>
      }
      statusCondensed={
        <TicketStateLabel standing={props.standing} size="small" />
      }
      overflow={props.actions}
    >
      {props.epics}
      {props.notes}
    </PageHeader>
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
  const text = useCopyText();
  return (
    <nav
      aria-label={text({ id: "ticket-tabs-nav-label" })}
      className="ticket-tabs"
    >
      <ul>
        <TicketTab to="/$tenant/$project/tickets/$ticket" params={params}>
          {text({ id: "ticket-tab-overview" })}
        </TicketTab>
        <TicketTab
          to="/$tenant/$project/tickets/$ticket/runs"
          params={params}
          within={props.runsWithin}
        >
          {text({ id: "ticket-tab-runs" })}
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
          {text({ id: "ticket-tab-configuration" })}
        </TicketTab>
        <TicketTab to="/$tenant/$project/tickets/$ticket/usage" params={params}>
          {text({ id: "ticket-tab-usage" })}
        </TicketTab>
      </ul>
    </nav>
  );
}
