/**
 * The ticket page's four tabs, each its own address under the page's layout,
 * and the row of them drawn through `TabNav`. The layout makes every read once
 * and hands it down here, so switching tabs reads nothing again and one clock
 * still ticks the page. Each tab's body opens on its own name as the heading
 * under the page's title, unseen because its tab already shows it.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { TicketConfiguration } from "../TicketProvenance.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { TabNav, TabNavLink } from "../ui/TabNav.tsx";
import { TicketOverviewBody } from "./TicketOverview.tsx";
import { TicketRunsList } from "./TicketRuns.tsx";
import { readValue, useTicketPageHeld } from "./TicketPageHeld.tsx";
import { TicketUsage } from "./TicketUsage.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy } from "../../core/copy.ts";

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
  readonly count?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <TabNavLink
      to={props.to}
      params={props.params}
      activeOptions={{ exact: props.within !== true, includeSearch: false }}
      aria-current={props.within === true ? "page" : undefined}
      count={props.count}
    >
      {props.children}
    </TabNavLink>
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
    <TabNav label={text({ id: "ticket-tabs-nav-label" })}>
      <TicketTab to="/$tenant/$project/tickets/$ticket" params={params}>
        {text({ id: "ticket-tab-overview" })}
      </TicketTab>
      <TicketTab
        to="/$tenant/$project/tickets/$ticket/runs"
        params={params}
        within={props.runsWithin}
        count={
          runCount === 0
            ? undefined
            : `${String(runCount)}${props.runCountCut ? "+" : ""}`
        }
      >
        {text({ id: "ticket-tab-runs" })}
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
    </TabNav>
  );
}

function TicketTabHeading(props: { readonly name: Copy }): ReactNode {
  const text = useCopyText();
  return <h2 className="visually-hidden">{text(props.name)}</h2>;
}

export function TicketOverviewTab(): ReactNode {
  return (
    <>
      <TicketTabHeading name={{ id: "ticket-tab-overview" }} />
      <TicketOverviewBody />
    </>
  );
}

/** A draft never released has run nothing, so it has no runs and no usage. */
export function TicketRunsTab(): ReactNode {
  const held = useTicketPageHeld();
  const text = useCopyText();
  return (
    <>
      <TicketTabHeading name={{ id: "ticket-tab-runs" }} />
      {held.draft === undefined ? (
        <TicketRunsList held={held} />
      ) : (
        <EmptyState label={text({ id: "ticket-nothing-has-run" })} />
      )}
    </>
  );
}

/** The configuration the ticket runs under, or that it names none; a draft's
 * is the one it names now. */
function TicketConfigurationBody(): ReactNode {
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

export function TicketConfigurationTab(): ReactNode {
  return (
    <>
      <TicketTabHeading name={{ id: "ticket-tab-configuration" }} />
      <TicketConfigurationBody />
    </>
  );
}

export function TicketUsageTab(): ReactNode {
  const held = useTicketPageHeld();
  const text = useCopyText();
  return (
    <>
      <TicketTabHeading name={{ id: "ticket-tab-usage" }} />
      {held.draft === undefined ? (
        <TicketUsage held={held} />
      ) : (
        <EmptyState label={text({ id: "ticket-usage-no-figures" })} />
      )}
    </>
  );
}
