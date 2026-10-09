/**
 * One ticket: where it stands and what may be done to it, the run going now or
 * the question it waits on, what has run for it, and — a click away — its
 * brief, what it has cost, where it came from and what became of it once it
 * landed.
 *
 * The brief, the configuration and the program the ledger groups by are the
 * ticket's own, which is what it runs, and not the draft's, which a Pending
 * ticket's author may have revised past it; the draft is read for the
 * provenance alone. One clock ticks the whole page, so a running row, a
 * cycle's open span and a panel's freshness all age together.
 */

import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  DraftResponse,
  DispatchViewResponse,
  ExecutionsResponse,
  LeadReadResponse,
  NativeActionResponse,
  TicketNativeActionsResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiDraft,
  apiTicket,
  apiTicketDispatchView,
  apiTicketNativeActions,
} from "../core/apiRoutes.ts";
import type { PanelState } from "../core/freshness.ts";
import type { TicketDeliveryState } from "../core/ticketDelivery.ts";
import {
  ticketLandingCurrent,
  ticketLandingFragment,
  ticketLandingFragmentSays,
  ticketLandingsHeld,
} from "../core/ticketLandings.ts";
import type { TicketLandingsState } from "../core/ticketLandings.ts";
import {
  parkedOverridesFence,
  parkedOverridesUnsaved,
} from "../core/parkedOverrides.ts";
import type { ParkedOverridesTyped } from "../core/parkedOverrides.ts";
import { projectLeadPresent } from "../core/projectLead.ts";
import {
  manualDispatchAction,
  ticketDispatchList,
} from "../core/ticketActions.ts";
import {
  offersAnswered,
  offersDispatchByHand,
  ticketOffers,
  ticketOffersAllowed,
} from "../core/ticketOffers.ts";
import type { TicketOffers } from "../core/ticketOffers.ts";
import { ticketPageFacts } from "../core/ticketPageFacts.ts";
import type { TicketPageFacts } from "../core/ticketPageFacts.ts";
import { resumedFrom, ticketSlot } from "../core/ticketSituation.ts";
import type { TicketSlot as Slot } from "../core/ticketSituation.ts";
import { usePanelList, usePanelResource } from "./api.ts";
import { FreshnessInstants, useNowMs } from "./Freshness.tsx";
import { useLead } from "./LeadPage.tsx";
import { currentAnchor } from "./ports.ts";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { DetailsSlot, TopBarSlot } from "./shell/slots.tsx";
import {
  TicketActingScope,
  TicketAnswerActions,
  TicketBarActions,
} from "./TicketActions.tsx";
import type { TicketActing } from "./TicketActions.tsx";
import { useTicketDelivery } from "./ticket/TicketDelivery.tsx";
import { TicketTopBar } from "./ticket/TicketHead.tsx";
import {
  LandingFragment,
  useTicketLandings,
} from "./ticket/TicketLandings.tsx";
import {
  TicketLedgerPanel,
  useTicketExecutions,
} from "./ticket/TicketLedger.tsx";
import {
  TicketPageDetails,
  TicketSections,
  ticketSections,
  ticketSectionsOpened,
} from "./ticket/TicketSections.tsx";
import {
  ParkedOverrides,
  parkedOverridesSaving,
  useParkedOverridesSave,
} from "./ticket/ParkedOverrides.tsx";
import { TicketSlot } from "./ticket/TicketSlot.tsx";
import { TicketStatus } from "./ticket/TicketStatus.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";

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

function readValue<T>(state: PanelState<T>): T | undefined {
  return state.state === "Ready" ? state.value : undefined;
}

/** Where the page's own head belongs while the shell has taken it: the top bar
 * and the details pane fill only once the ticket has been read. */
function TicketPortals(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse | undefined;
  readonly facts: TicketPageFacts;
  readonly delivery: TicketDeliveryState;
  readonly nowMs: number;
  readonly onChoose: (id: string) => void;
}): ReactNode {
  const ticket = props.ticket;
  if (ticket === undefined) return null;
  return (
    <>
      <TopBarSlot>
        <TicketTopBar partition={props.partition} ticket={ticket} />
      </TopBarSlot>
      <DetailsSlot>
        <TicketPageDetails
          sections={ticketSections(
            ticket,
            props.facts,
            props.delivery,
            props.nowMs,
          )}
          onChoose={props.onChoose}
        />
      </DetailsSlot>
    </>
  );
}

interface StandingProps {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly reads: TicketReads;
  readonly facts: TicketPageFacts;
  readonly nowMs: number;
}

/** The offers, the one card the slot holds and the escalation its overrides
 * are fenced to, from what the page has read. */
function standingOf(props: StandingProps): {
  readonly offers: TicketOffers;
  readonly slot: Slot;
  readonly fence: NativeActionResponse | undefined;
} {
  const ticket = readValue(props.reads.ticketState);
  if (ticket === undefined)
    return {
      offers: { offers: "Unread" },
      slot: { slot: "Nothing" },
      fence: undefined,
    };
  const dispatchState = props.reads.dispatchState;
  const dispatch =
    dispatchState.state === "Ready"
      ? manualDispatchAction(props.ticket, dispatchState.value)
      : undefined;
  return {
    offers: ticketOffers(props.reads.openState, ticket, dispatch),
    slot: ticketSlot({
      ticket,
      ledger: props.facts.ledger,
      stageCount: props.facts.stageCount,
      open: readValue(props.reads.openState)?.actions,
      executions: readValue(props.reads.pageState)?.executions ?? [],
    }),
    fence: parkedOverridesFence(
      ticket,
      readValue(props.reads.openState)?.actions,
    ),
  };
}

/**
 * The card's overrides and the Resume beside them: Resume is withheld while
 * what was typed is not what the ticket holds, or a save of it is still going,
 * so nobody resumes under settings they believed they had changed.
 */
function useParkedStanding(
  props: StandingProps,
  fence: NativeActionResponse | undefined,
): { readonly overrides: ReactNode; readonly withheld: boolean } {
  const [typed, setTyped] = useState<ParkedOverridesTyped | undefined>(
    undefined,
  );
  const saving = useParkedOverridesSave(props.partition, props.ticket);
  const ticket = readValue(props.reads.ticketState);
  if (ticket === undefined || fence === undefined)
    return { overrides: null, withheld: false };
  return {
    overrides: (
      <ParkedOverrides
        partition={props.partition}
        ticket={ticket}
        fence={fence}
        typed={typed}
        onTyped={setTyped}
        saving={saving}
      />
    ),
    withheld:
      parkedOverridesUnsaved(typed, fence, ticket.overrides) ||
      parkedOverridesSaving(saving),
  };
}

/** The current landing's fragment on the status bar while the ticket is
 * finalizing, and null otherwise. */
function statusLanding(props: StandingProps): ReactNode {
  if (readValue(props.reads.ticketState)?.phase !== "Finalization") return null;
  const landing = ticketLandingCurrent(
    ticketLandingsHeld(props.reads.landingsState),
  );
  if (landing === undefined) return null;
  const fragment = ticketLandingFragment(landing, props.nowMs);
  return ticketLandingFragmentSays(fragment) ? (
    <LandingFragment fragment={fragment} />
  ) : null;
}

/** The status bar and the card under it, which answer through one submission
 * wherever the button pressed is drawn. */
function TicketStanding(
  props: StandingProps & { readonly acting: TicketActing },
): ReactNode {
  const abilities = useProjectAbilities(props.partition);
  const { slot, fence, ...standing } = standingOf(props);
  const offers = ticketOffersAllowed(standing.offers, abilities);
  const parked = useParkedStanding(props, fence);
  const asking = slot.slot === "NeedsYou";
  const answered = offersAnswered(offers, asking);
  const ledger = props.facts.ledger;
  return (
    <>
      <TicketStatus
        state={props.reads.ticketState}
        page={readValue(props.reads.pageState)}
        resumed={
          asking || ledger === undefined ? undefined : resumedFrom(ledger)
        }
        landing={statusLanding(props)}
        truncated={props.facts.truncated}
        nowMs={props.nowMs}
        actions={
          <TicketBarActions
            partition={props.partition}
            ticket={props.ticket}
            acting={props.acting}
            offers={offers}
            openState={props.reads.openState}
            dispatchState={props.reads.dispatchState}
            resume={props.facts.resume}
            answered={answered}
            byHand={offersDispatchByHand(
              offers,
              projectLeadPresent(props.reads.leadState),
            )}
          />
        }
      />
      <TicketSlot
        partition={props.partition}
        slot={slot}
        nowMs={props.nowMs}
        overrides={parked.overrides}
        actions={
          <TicketAnswerActions
            acting={props.acting}
            offers={offers}
            answered={
              parked.withheld
                ? answered.filter((action) => action.action !== "Resume")
                : answered
            }
            resume={props.facts.resume}
          />
        }
      />
    </>
  );
}

function TicketBody(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly reads: TicketReads;
  readonly nowMs: number;
}): ReactNode {
  const ticket = readValue(props.reads.ticketState);
  const page = readValue(props.reads.pageState);
  const facts = ticketPageFacts(ticket, page);
  const [open, setOpen] = useState<readonly string[]>(() =>
    ticketSectionsOpened([], currentAnchor()),
  );
  const choose = (id: string): void => {
    setOpen((held) => ticketSectionsOpened(held, id));
  };
  return (
    <FreshnessInstants>
      <TicketPortals
        partition={props.partition}
        ticket={ticket}
        facts={facts}
        delivery={props.reads.deliveryState}
        nowMs={props.nowMs}
        onChoose={choose}
      />
      <div data-fills-width className="grid min-w-0 gap-4">
        <TicketActingScope partition={props.partition} ticket={props.ticket}>
          {(acting) => (
            <TicketStanding
              partition={props.partition}
              ticket={props.ticket}
              reads={props.reads}
              facts={facts}
              nowMs={props.nowMs}
              acting={acting}
            />
          )}
        </TicketActingScope>
        <section id="cycles" className="scroll-mt-4">
          <TicketLedgerPanel
            partition={props.partition}
            page={props.reads.pageState}
            program={facts.program}
            landings={props.reads.landingsState}
            nowMs={props.nowMs}
          />
        </section>
        <TicketSections
          partition={props.partition}
          ticketState={props.reads.ticketState}
          draftState={props.reads.draftState}
          delivery={props.reads.deliveryState}
          page={page}
          open={open}
          onOpenChange={setOpen}
          nowMs={props.nowMs}
        />
      </div>
    </FreshnessInstants>
  );
}

export function TicketPage(): ReactNode {
  const params = useParams({ from: "/$tenant/$project/tickets/$ticket" });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const ticket = Number(params.ticket);
  const nowMs = useNowMs();
  const ticketState = usePanelResource(
    partition,
    "Ticket",
    String(ticket),
    (ports) => apiTicket(ports, partition, ticket),
  );
  const draftState = usePanelResource(
    partition,
    "Draft",
    String(ticket),
    (ports) => apiDraft(ports, partition, ticket),
  );
  const openState = usePanelResource(
    partition,
    "NativeAction",
    String(ticket),
    (ports) => apiTicketNativeActions(ports, partition, ticket),
  );
  const dispatchState = usePanelList(
    ticketDispatchList(partition, ticket),
    (ports) => apiTicketDispatchView(ports, partition, ticket),
  );
  const pageState = useTicketExecutions(partition, ticket);
  const leadState = useLead(partition);
  const deliveryState = useTicketDelivery(partition, ticket);
  const landingsState = useTicketLandings(partition, ticket);
  if (!Number.isSafeInteger(ticket) || ticket <= 0)
    return <EmptyState label="No such ticket" variant="page" />;
  return (
    <TicketBody
      partition={partition}
      ticket={ticket}
      reads={{
        ticketState,
        draftState,
        openState,
        dispatchState,
        pageState,
        leadState,
        deliveryState,
        landingsState,
      }}
      nowMs={nowMs}
    />
  );
}
