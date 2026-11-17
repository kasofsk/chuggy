/**
 * The ticket page's four tabs, each its own address under the page's layout,
 * and the row of links to them. The layout makes every read once and hands
 * it down here, so switching tabs reads nothing again and one clock still
 * ticks the page.
 *
 * Each tab's content opens with a heading naming the tab, a level under the
 * page's title. The current tab already says the name where it is seen, so
 * the heading is drawn only for whoever reads the page by its headings.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { TicketConfiguration } from "../TicketProvenance.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { TabNav, TabNavLink } from "../ui/TabNav.tsx";
import { TicketOverview } from "./TicketOverview.tsx";
import { TicketRunsList } from "./TicketRuns.tsx";
import { useTicketPageHeld } from "./TicketPageHeld.tsx";
import { readValue } from "../../core/freshness.ts";
import { TicketUsage } from "./TicketUsage.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

/** The tabs, the same whatever the ticket's state; Runs carries how many runs
 * the page holds once it holds any, with a + where the page is cut off. Runs
 * is current on a page under it as well as on its own address. */
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
  const exact = { exact: true, includeSearch: false };
  const text = useCopyText();
  return (
    <TabNav label={text({ id: "ticket-tabs-nav-label" })}>
      <TabNavLink
        to="/$tenant/$project/tickets/$ticket"
        params={params}
        activeOptions={exact}
      >
        {text({ id: "ticket-tab-overview" })}
      </TabNavLink>
      <TabNavLink
        to="/$tenant/$project/tickets/$ticket/runs"
        params={params}
        activeOptions={{ exact: !props.runsWithin, includeSearch: false }}
        aria-current={props.runsWithin ? "page" : undefined}
        count={
          runCount === 0
            ? undefined
            : props.runCountCut
              ? `${String(runCount)}+`
              : runCount
        }
      >
        {text({ id: "ticket-tab-runs" })}
      </TabNavLink>
      <TabNavLink
        to="/$tenant/$project/tickets/$ticket/configuration"
        params={params}
        activeOptions={exact}
      >
        {text({ id: "ticket-tab-configuration" })}
      </TabNavLink>
      <TabNavLink
        to="/$tenant/$project/tickets/$ticket/usage"
        params={params}
        activeOptions={exact}
      >
        {text({ id: "ticket-tab-usage" })}
      </TabNavLink>
    </TabNav>
  );
}

/** The heading a tab's content opens with, named as its tab is. */
export function TicketTabHeading(props: {
  readonly tab:
    | "ticket-tab-overview"
    | "ticket-tab-runs"
    | "ticket-tab-configuration"
    | "ticket-tab-usage";
}): ReactNode {
  const text = useCopyText();
  return <h2 className="visually-hidden">{text({ id: props.tab })}</h2>;
}

export function TicketOverviewTab(): ReactNode {
  return (
    <>
      <TicketTabHeading tab="ticket-tab-overview" />
      <TicketOverview />
    </>
  );
}

/** A draft never released has run nothing, so it has no runs and no usage. */
export function TicketRunsTab(): ReactNode {
  const held = useTicketPageHeld();
  const text = useCopyText();
  return (
    <>
      <TicketTabHeading tab="ticket-tab-runs" />
      {held.draft !== undefined ? (
        <EmptyState label={text({ id: "ticket-nothing-has-run" })} />
      ) : (
        <TicketRunsList held={held} />
      )}
    </>
  );
}

/** The configuration the ticket runs under, or that it names none; a draft's
 * is the one it names now. */
export function TicketConfigurationTab(): ReactNode {
  return (
    <>
      <TicketTabHeading tab="ticket-tab-configuration" />
      <TicketConfigurationTabBody />
    </>
  );
}

function TicketConfigurationTabBody(): ReactNode {
  const held = useTicketPageHeld();
  const text = useCopyText();
  if (held.draft !== undefined)
    return (
      <TicketConfiguration partition={held.partition} ticket={held.draft} />
    );
  const ticket = readValue(held.reads.ticketState);
  if (ticket !== undefined && ticket.configurationRevision === undefined)
    return <EmptyState label={text({ id: "ticket-page-no-configuration" })} />;
  return <TicketConfiguration partition={held.partition} ticket={ticket} />;
}

export function TicketUsageTab(): ReactNode {
  const held = useTicketPageHeld();
  const text = useCopyText();
  return (
    <>
      <TicketTabHeading tab="ticket-tab-usage" />
      {held.draft !== undefined ? (
        <EmptyState label={text({ id: "ticket-usage-no-figures" })} />
      ) : (
        <TicketUsage held={held} />
      )}
    </>
  );
}
