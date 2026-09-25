/**
 * One ticket: where it stands and what may be done to it, the run going now or
 * the question it waits on, what has run for it, and — a click away — its
 * brief, what it has cost and where it came from.
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
  TicketNativeActionsResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiDraft,
  apiDispatchView,
  apiTicket,
  apiTicketNativeActions,
} from "../core/apiRoutes.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  manualDispatchAction,
  ticketDispatchList,
} from "../core/ticketActions.ts";
import { offersAnswered, ticketOffers } from "../core/ticketOffers.ts";
import type { TicketOffers } from "../core/ticketOffers.ts";
import { ticketPageFacts } from "../core/ticketPageFacts.ts";
import type { TicketPageFacts } from "../core/ticketPageFacts.ts";
import { resumedFrom, ticketSlot } from "../core/ticketSituation.ts";
import type { TicketSlot as Slot } from "../core/ticketSituation.ts";
import { usePanelList, usePanelResource } from "./api.ts";
import { FreshnessInstants, useNowMs } from "./Freshness.tsx";
import { currentAnchor } from "./ports.ts";
import { DetailsSlot, TopBarSlot } from "./shell/slots.tsx";
import {
  TicketActingScope,
  TicketAnswerActions,
  TicketBarActions,
} from "./TicketActions.tsx";
import type { TicketActing } from "./TicketActions.tsx";
import { TicketTopBar } from "./ticket/TicketHead.tsx";
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
          sections={ticketSections(ticket, props.facts)}
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

/** The offers, and the one card the slot holds, from what the page has read. */
function standingOf(props: StandingProps): {
  readonly offers: TicketOffers;
  readonly slot: Slot;
} {
  const ticket = readValue(props.reads.ticketState);
  if (ticket === undefined)
    return { offers: { offers: "Unread" }, slot: { slot: "Nothing" } };
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
  };
}

/** The status bar and the card under it, which answer through one submission
 * wherever the button pressed is drawn. */
function TicketStanding(
  props: StandingProps & { readonly acting: TicketActing },
): ReactNode {
  const { offers, slot } = standingOf(props);
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
          />
        }
      />
      <TicketSlot
        partition={props.partition}
        slot={slot}
        nowMs={props.nowMs}
        actions={
          <TicketAnswerActions
            acting={props.acting}
            offers={offers}
            answered={answered}
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
        onChoose={choose}
      />
      <div className="grid w-page max-w-full min-w-0 gap-4">
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
            nowMs={props.nowMs}
          />
        </section>
        <TicketSections
          partition={props.partition}
          ticketState={props.reads.ticketState}
          draftState={props.reads.draftState}
          page={page}
          open={open}
          onOpenChange={setOpen}
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
    (ports) =>
      apiDispatchView(ports, partition, {
        ...(ticket > 1 ? { after: ticket - 1 } : {}),
        limit: 1,
      }),
  );
  const pageState = useTicketExecutions(partition, ticket);
  if (!Number.isSafeInteger(ticket) || ticket <= 0)
    return <EmptyState label="No such ticket" variant="page" />;
  return (
    <TicketBody
      partition={partition}
      ticket={ticket}
      reads={{ ticketState, draftState, openState, dispatchState, pageState }}
      nowMs={nowMs}
    />
  );
}
