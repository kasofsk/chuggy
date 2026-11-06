/**
 * What the ticket page's layout reads once and hands every tab under it, so
 * switching tabs reads nothing again and one clock still ticks the page.
 */

import { createContext, useContext, useLayoutEffect } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ConfigurationResponse,
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

/** Everything the page has read, so each part is handed facts and not a query. */
export interface TicketReads {
  readonly ticketState: PanelState<TicketResponse>;
  /** The configuration the ticket runs under, pending until it names one. */
  readonly configurationState: PanelState<ConfigurationResponse>;
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
  /** What the card offers of the ticket's overrides, where it offers any. */
  readonly overrides: ReactNode;
  /** The draft drawn in the ticket's place, where it was never released. */
  readonly draft: DraftResponse | undefined;
}

const TicketPageContext = createContext<TicketPageHeld | undefined>(undefined);

export const TicketPageHeldProvider = TicketPageContext.Provider;

export function useTicketPageHeld(): TicketPageHeld {
  const held = useContext(TicketPageContext);
  if (held === undefined)
    throw new Error("a ticket tab is drawn only under the ticket page");
  return held;
}

const TicketRunsWithinContext = createContext<(within: boolean) => void>(
  () => undefined,
);

export const TicketRunsWithinProvider = TicketRunsWithinContext.Provider;

/** Marks the Runs tab current for as long as the page calling it is drawn,
 * which is how a page under the tab at an address of its own sits within it. */
export function useTicketRunsWithin(): void {
  const mark = useContext(TicketRunsWithinContext);
  useLayoutEffect(() => {
    mark(true);
    return () => {
      mark(false);
    };
  }, [mark]);
}
