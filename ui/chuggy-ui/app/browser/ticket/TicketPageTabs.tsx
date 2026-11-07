/**
 * The ticket page's four tabs, each its own address under the page's layout.
 * The layout makes every read once and hands it down here, so switching tabs
 * reads nothing again and one clock still ticks the page.
 */

import type { ReactNode } from "react";

import { TicketConfiguration } from "../TicketProvenance.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { TicketRunsList } from "./TicketRuns.tsx";
import { readValue, useTicketPageHeld } from "./TicketPageHeld.tsx";
import { TicketUsage } from "./TicketUsage.tsx";

export { TicketOverviewTab } from "./TicketOverview.tsx";

/** A draft never released has run nothing, so it has no runs and no usage. */
export function TicketRunsTab(): ReactNode {
  const held = useTicketPageHeld();
  if (held.draft !== undefined) return <EmptyState label="Nothing has run" />;
  return <TicketRunsList held={held} />;
}

/** The configuration the ticket runs under, or that it names none; a draft's
 * is the one it names now. */
export function TicketConfigurationTab(): ReactNode {
  const held = useTicketPageHeld();
  if (held.draft !== undefined)
    return (
      <TicketConfiguration partition={held.partition} ticket={held.draft} />
    );
  const ticket = readValue(held.reads.ticketState);
  if (ticket !== undefined && ticket.configurationRevision === undefined)
    return <EmptyState label="No configuration" />;
  return <TicketConfiguration partition={held.partition} ticket={ticket} />;
}

export function TicketUsageTab(): ReactNode {
  const held = useTicketPageHeld();
  if (held.draft !== undefined)
    return <EmptyState label="No run figures yet" />;
  return <TicketUsage held={held} />;
}
