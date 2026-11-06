/**
 * The ticket page's four tabs, each its own address under the page's layout.
 * The layout makes every read once and hands it down here, so switching tabs
 * reads nothing again and one clock still ticks the page.
 */

import type { ReactNode } from "react";

import { TicketConfiguration } from "../TicketProvenance.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { TicketActivity } from "./TicketActivity.tsx";
import { TicketRunsList } from "./TicketRuns.tsx";
import { readValue, useTicketPageHeld } from "./TicketPageHeld.tsx";

export { TicketOverviewTab } from "./TicketOverview.tsx";

export function TicketRunsTab(): ReactNode {
  return <TicketRunsList held={useTicketPageHeld()} />;
}

/** The configuration the ticket runs under, or that it names none. */
export function TicketConfigurationTab(): ReactNode {
  const held = useTicketPageHeld();
  const ticket = readValue(held.reads.ticketState);
  if (ticket !== undefined && ticket.configurationRevision === undefined)
    return <EmptyState label="No configuration" />;
  return <TicketConfiguration partition={held.partition} ticket={ticket} />;
}

export function TicketUsageTab(): ReactNode {
  const held = useTicketPageHeld();
  return (
    <TicketActivity
      ticket={readValue(held.reads.ticketState)}
      page={readValue(held.reads.pageState)}
      truncated={held.facts.truncated}
      delivery={held.reads.deliveryState}
    />
  );
}
