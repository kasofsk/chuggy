/**
 * The ticket page's four tabs, each its own address under the page's layout.
 * The layout makes every read once and hands it down here, so switching tabs
 * reads nothing again and one clock still ticks the page.
 */

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  DraftResponse,
  DispatchViewResponse,
  ExecutionsResponse,
  LeadReadResponse,
  TicketNativeActionsResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import type { PanelState } from "../../core/freshness.ts";
import type { TicketDeliveryState } from "../../core/ticketDelivery.ts";
import type { TicketLandingsState } from "../../core/ticketLandings.ts";
import type { TicketPageFacts } from "../../core/ticketPageFacts.ts";
import type { TicketSlot as Slot } from "../../core/ticketSituation.ts";
import { TicketConfiguration, TicketRevisions } from "../TicketProvenance.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Panel } from "../ui/Panel.tsx";
import { TicketActivity } from "./TicketActivity.tsx";
import { TicketInstructions } from "./TicketInstructions.tsx";
import { TicketLedgerPanel } from "./TicketLedger.tsx";
import { TicketSlot } from "./TicketSlot.tsx";
import { TicketStatus } from "./TicketStatus.tsx";

/** Everything the page has read, so each part is handed facts and not a query. */
export interface TicketReads {
  readonly ticketState: PanelState<TicketResponse>;
  readonly draftState: PanelState<DraftResponse>;
  readonly openState: PanelState<TicketNativeActionsResponse>;
  readonly dispatchState: PanelState<DispatchViewResponse>;
  readonly pageState: PanelState<ExecutionsResponse>;
  readonly leadState: PanelState<LeadReadResponse>;
  readonly deliveryState: TicketDeliveryState;
  readonly landingsState: TicketLandingsState;
}

export function readValue<T>(state: PanelState<T>): T | undefined {
  return state.state === "Ready" ? state.value : undefined;
}

/** What the layout hands every tab. */
export interface TicketPageHeld {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly reads: TicketReads;
  readonly facts: TicketPageFacts;
  readonly nowMs: number;
  readonly slot: Slot;
  /** The resume line the status bar carries, where it carries one. */
  readonly resumed: string | undefined;
  /** The current landing's fragment while the ticket is finalizing, or null. */
  readonly landing: ReactNode;
  /** What the card offers of the ticket's overrides, where it offers any. */
  readonly overrides: ReactNode;
}

const TicketPageContext = createContext<TicketPageHeld | undefined>(undefined);

export const TicketPageHeldProvider = TicketPageContext.Provider;

function useTicketPageHeld(): TicketPageHeld {
  const held = useContext(TicketPageContext);
  if (held === undefined)
    throw new Error("a ticket tab is drawn only under the ticket page");
  return held;
}

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
  const held = useTicketPageHeld();
  return (
    <section id="cycles" className="scroll-mt-4">
      <TicketLedgerPanel
        partition={held.partition}
        page={held.reads.pageState}
        program={held.facts.program}
        landings={held.reads.landingsState}
        nowMs={held.nowMs}
      />
    </section>
  );
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
