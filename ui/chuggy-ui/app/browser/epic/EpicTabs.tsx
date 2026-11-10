/**
 * The epic page's tabs, drawn as the ticket page's are: each a link to its
 * own address, which the router marks current, and the same whatever the
 * epic's state. Tickets carries how many members the epic holds and History
 * how many revisions it has had. The edit page is none of them, so none is
 * current there.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";

import "../ticket/ticket.css";

function EpicTab(props: {
  readonly to:
    | "/$tenant/$project/epics/$epic"
    | "/$tenant/$project/epics/$epic/tickets"
    | "/$tenant/$project/epics/$epic/graph"
    | "/$tenant/$project/epics/$epic/history";
  readonly params: PartitionIdentity & { readonly epic: string };
  readonly count?: number | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <li>
      <Link
        to={props.to}
        params={props.params}
        activeOptions={{ exact: true, includeSearch: false }}
        className="ticket-tab"
      >
        {props.children}
        {props.count === undefined ? null : (
          <span className="ticket-tab-count">{props.count}</span>
        )}
      </Link>
    </li>
  );
}

export function EpicTabs(props: {
  readonly partition: PartitionIdentity;
  readonly epic: number;
  /** How many tickets the epic holds, absent until it is read. */
  readonly memberCount: number | undefined;
  /** How many revisions the epic has had, which is the revision it is at,
   * absent until it is read. */
  readonly revisionCount: number | undefined;
}): ReactNode {
  const text = useCopyText();
  const params = { ...props.partition, epic: String(props.epic) };
  return (
    <nav aria-label={text({ id: "epics-tabs-label" })} className="ticket-tabs">
      <ul>
        <EpicTab to="/$tenant/$project/epics/$epic" params={params}>
          {text({ id: "epics-tab-overview" })}
        </EpicTab>
        <EpicTab
          to="/$tenant/$project/epics/$epic/tickets"
          params={params}
          count={props.memberCount}
        >
          {text({ id: "epics-tab-tickets" })}
        </EpicTab>
        <EpicTab to="/$tenant/$project/epics/$epic/graph" params={params}>
          {text({ id: "epics-tab-graph" })}
        </EpicTab>
        <EpicTab
          to="/$tenant/$project/epics/$epic/history"
          params={params}
          count={props.revisionCount}
        >
          {text({ id: "epics-tab-history" })}
        </EpicTab>
      </ul>
    </nav>
  );
}
