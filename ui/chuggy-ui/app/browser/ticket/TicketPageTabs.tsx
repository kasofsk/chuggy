/**
 * The ticket page's four tabs, each its own address under the page's layout.
 * The layout makes every read once and hands it down here, so switching tabs
 * reads nothing again and one clock still ticks the page.
 */

import type { ReactNode } from "react";

import { TicketConfiguration, TicketRevisions } from "../TicketProvenance.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Panel } from "../ui/Panel.tsx";
import { TicketActivity } from "./TicketActivity.tsx";
import { TicketInstructions } from "./TicketInstructions.tsx";
import { TicketRunsList } from "./TicketRuns.tsx";
import { TicketSlot } from "./TicketSlot.tsx";
import { TicketStatus } from "./TicketStatus.tsx";
import { readValue, useTicketPageHeld } from "./TicketPageHeld.tsx";

/** The status bar, the card under it, the instructions and the revisions. */
export function TicketOverviewTab(): ReactNode {
  const held = useTicketPageHeld();
  const ticket = readValue(held.reads.ticketState);
  return (
    <>
      <TicketStatus
        partition={held.partition}
        state={held.reads.ticketState}
        page={readValue(held.reads.pageState)}
        resumed={held.resumed}
        landing={held.landing}
        nowMs={held.nowMs}
      />
      <TicketSlot
        partition={held.partition}
        slot={held.slot}
        nowMs={held.nowMs}
        overrides={held.overrides}
      />
      <TicketInstructions
        partition={held.partition}
        state={held.reads.ticketState}
      />
      <Panel title="Revision history" level={2}>
        <TicketRevisions
          partition={held.partition}
          state={held.reads.draftState}
          ticket={ticket}
          nowMs={held.nowMs}
        />
      </Panel>
    </>
  );
}

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
