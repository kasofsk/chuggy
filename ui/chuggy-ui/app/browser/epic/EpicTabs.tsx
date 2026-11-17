/**
 * The epic page's tabs, drawn through `TabNav`: each a link to its own
 * address, which the router marks current, and the same whatever the epic's
 * state. Tickets carries how many members the epic holds and History how
 * many revisions it has had. The edit page is none of them, so none is
 * current there.
 *
 * Each tab's content opens with a heading naming the tab, a level under the
 * page's title. The current tab already says the name where it is seen, so
 * the heading is drawn only for whoever reads the page by its headings.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { TabNav, TabNavLink } from "../ui/TabNav.tsx";

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
  const exact = { exact: true, includeSearch: false };
  return (
    <TabNav label={text({ id: "epics-tabs-label" })}>
      <TabNavLink
        to="/$tenant/$project/epics/$epic"
        params={params}
        activeOptions={exact}
      >
        {text({ id: "epics-tab-overview" })}
      </TabNavLink>
      <TabNavLink
        to="/$tenant/$project/epics/$epic/tickets"
        params={params}
        activeOptions={exact}
        count={props.memberCount}
      >
        {text({ id: "epics-tab-tickets" })}
      </TabNavLink>
      <TabNavLink
        to="/$tenant/$project/epics/$epic/graph"
        params={params}
        activeOptions={exact}
      >
        {text({ id: "epics-tab-graph" })}
      </TabNavLink>
      <TabNavLink
        to="/$tenant/$project/epics/$epic/history"
        params={params}
        activeOptions={exact}
        count={props.revisionCount}
      >
        {text({ id: "epics-tab-history" })}
      </TabNavLink>
    </TabNav>
  );
}

/** The heading a tab's content opens with, named as its tab is. */
export function EpicTabHeading(props: {
  readonly tab:
    | "epics-tab-overview"
    | "epics-tab-tickets"
    | "epics-tab-graph"
    | "epics-tab-history";
}): ReactNode {
  const text = useCopyText();
  return <h2 className="visually-hidden">{text({ id: props.tab })}</h2>;
}
