/**
 * The epic page's tabs, drawn as the ticket page's are: each a link to its
 * own address, which the router marks current, and the same whatever the
 * epic's state. Tickets carries how many members the epic holds.
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
    | "/$tenant/$project/epics/$epic/history";
  readonly params: PartitionIdentity & { readonly epic: string };
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
      </Link>
    </li>
  );
}

export function EpicTabs(props: {
  readonly partition: PartitionIdentity;
  readonly epic: number;
  /** How many tickets the epic holds, absent until it is read. */
  readonly memberCount: number | undefined;
}): ReactNode {
  const text = useCopyText();
  const params = { ...props.partition, epic: String(props.epic) };
  return (
    <nav aria-label={text({ id: "epics-tabs-label" })} className="ticket-tabs">
      <ul>
        <EpicTab to="/$tenant/$project/epics/$epic" params={params}>
          {text({ id: "epics-tab-overview" })}
        </EpicTab>
        <EpicTab to="/$tenant/$project/epics/$epic/tickets" params={params}>
          {text({ id: "epics-tab-tickets" })}
          {props.memberCount === undefined ? null : (
            <span className="ticket-tab-count">{props.memberCount}</span>
          )}
        </EpicTab>
        <EpicTab to="/$tenant/$project/epics/$epic/history" params={params}>
          {text({ id: "epics-tab-history" })}
        </EpicTab>
      </ul>
    </nav>
  );
}
