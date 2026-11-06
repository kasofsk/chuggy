/**
 * One ticket, as a header over four tabs: its title, where it stands with the
 * one fragment that says why and what may be done to it, and under the tabs
 * its overview, its runs, the configuration it runs under and its usage.
 *
 * Every read is made here, once, and handed to whichever tab is drawn, so a
 * tab switch reads nothing again. The brief, the configuration and the
 * program the ledger groups by are the ticket's own, which is what it runs,
 * and not the draft's, which a Pending ticket's author may have revised past
 * it; the draft is read for its unreleased edits alone. One clock ticks the
 * whole page, so a running row, a cycle's open span and a panel's freshness
 * all age together.
 */

import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { NativeActionResponse } from "../../../../src/contract/responses.ts";
import { configurationQuery } from "../core/configurationQueries.ts";
import { ticketLandingsHeld } from "../core/ticketLandings.ts";
import {
  parkedOverridesFence,
  parkedOverridesUnsaved,
  parkedSetupOverridable,
} from "../core/parkedOverrides.ts";
import type { ParkedOverridesTyped } from "../core/parkedOverrides.ts";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import type { ProjectAbilities } from "../core/projectAbilities.ts";
import { projectLeadDispatches } from "../core/projectLead.ts";
import { manualDispatchActionOf } from "../core/ticketActions.ts";
import { ticketHeaderFragment } from "../core/ticketHeader.ts";
import { ticketListStandingOf } from "../core/ticketListView.ts";
import {
  offersDispatchByHand,
  ticketOffers,
  ticketOffersAllowed,
  ticketOffersStartable,
} from "../core/ticketOffers.ts";
import type { TicketOffers } from "../core/ticketOffers.ts";
import { ticketPageFacts } from "../core/ticketPageFacts.ts";
import {
  draftQuery,
  ticketDispatchQuery,
  ticketNativeActionsQuery,
  ticketQuery,
} from "../core/ticketQueries.ts";
import type { TicketPageFacts } from "../core/ticketPageFacts.ts";
import { ticketSlot } from "../core/ticketSituation.ts";
import type { TicketSlot as Slot } from "../core/ticketSituation.ts";
import { usePanelState } from "./api.ts";
import { FreshnessInstants, useNowMs } from "./Freshness.tsx";
import { useLead } from "./LeadPage.tsx";
import { useProjectAbilities } from "./projectAbilities.tsx";
import {
  TicketActingScope,
  TicketHeaderActions,
  TicketHeaderNotes,
} from "./TicketActions.tsx";
import type {
  TicketActing,
  TicketHeaderActionsProps,
} from "./TicketActions.tsx";
import { useTicketDelivery } from "./ticket/TicketDelivery.tsx";
import { TicketHeader, TicketTabs } from "./ticket/TicketHeader.tsx";
import { useTicketLandings } from "./ticket/TicketLandings.tsx";
import { useTicketExecutions } from "./ticket/TicketRuns.tsx";
import {
  ParkedOverrides,
  useParkedOverridesSave,
} from "./ticket/ParkedOverrides.tsx";
import {
  readValue,
  TicketPageHeldProvider,
  TicketRunsWithinProvider,
} from "./ticket/TicketPageHeld.tsx";
import type { TicketPageHeld, TicketReads } from "./ticket/TicketPageHeld.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { useWorkRunner } from "./workRunner.tsx";

interface StandingProps {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly reads: TicketReads;
  readonly facts: TicketPageFacts;
  readonly nowMs: number;
}

/** Whether the card offers this reader the setup lines of a ticket whose run
 * stopped at its setup. */
function setupOverridable(
  props: StandingProps,
  abilities: ProjectAbilities,
): boolean {
  const ticket = readValue(props.reads.ticketState);
  const fence =
    ticket === undefined
      ? undefined
      : parkedOverridesFence(ticket, readValue(props.reads.openState)?.actions);
  const asked = ticket?.escalation?.failed?.evidence === "RunSetupFailed";
  return parkedSetupOverridable(
    fence,
    asked ? readValue(props.reads.configurationState)?.canonical : undefined,
    abilities,
  );
}

/** The offers, the one card the slot holds and the escalation its overrides
 * are fenced to, from what the page has read. */
function standingOf(
  props: StandingProps,
  setupOverridable: boolean,
): {
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
      ? manualDispatchActionOf(props.ticket, dispatchState.value)
      : undefined;
  return {
    offers: ticketOffers(props.reads.openState, ticket, dispatch),
    slot: ticketSlot({
      ticket,
      landings: ticketLandingsHeld(props.reads.landingsState),
      ledger: props.facts.ledger,
      names: props.facts.plan.names,
      open: readValue(props.reads.openState)?.actions,
      executions: readValue(props.reads.pageState)?.executions ?? [],
      setupOverridable,
      nowMs: props.nowMs,
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
  const ticket = readValue(props.reads.ticketState);
  const saving = useParkedOverridesSave(
    props.partition,
    props.ticket,
    ticket !== undefined && fence !== undefined,
  );
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
      parkedOverridesUnsaved(typed, fence, ticket.overrides) || saving.busy,
  };
}

/** What the header offers this reader, and the facts the tabs are handed. */
function useTicketStanding(
  props: StandingProps & { readonly acting: TicketActing },
) {
  const abilities = useProjectAbilities(props.partition);
  const runner = useWorkRunner(props.partition, "Unknown");
  const { slot, fence, ...standing } = standingOf(
    props,
    setupOverridable(props, abilities),
  );
  const { offers, noRunner } = ticketOffersStartable(
    ticketOffersAllowed(standing.offers, abilities),
    runner,
  );
  const parked = useParkedStanding(props, fence);
  const actions: TicketHeaderActionsProps = {
    partition: props.partition,
    ticket: props.ticket,
    phase: readValue(props.reads.ticketState)?.phase,
    acting: props.acting,
    offers,
    openState: props.reads.openState,
    dispatchState: props.reads.dispatchState,
    resume: props.facts.resume,
    withheld: parked.withheld ? ["Resume"] : [],
    duplicates: !projectAbilityRefused(abilities, "mutate"),
    byHand: offersDispatchByHand(
      offers,
      projectLeadDispatches(props.reads.leadState),
    ),
    noRunner,
  };
  const held: TicketPageHeld = {
    ...props,
    slot,
    overrides: parked.overrides,
  };
  return { actions, held };
}

function TicketStandingHeader(props: {
  readonly held: TicketPageHeld;
  readonly actions: TicketHeaderActionsProps;
}): ReactNode {
  const { held } = props;
  const ticket = readValue(held.reads.ticketState);
  if (ticket === undefined) return null;
  const standing = ticketListStandingOf(ticket);
  return (
    <TicketHeader
      ticket={held.ticket}
      title={ticket.title ?? "Ticket"}
      standing={standing}
      fragment={ticketHeaderFragment({
        ticket,
        standing,
        leadDispatches: projectLeadDispatches(held.reads.leadState),
        slot: held.slot,
        landings: ticketLandingsHeld(held.reads.landingsState),
      })}
      nowMs={held.nowMs}
      actions={<TicketHeaderActions {...props.actions} />}
      notes={<TicketHeaderNotes {...props.actions} />}
    />
  );
}

/** The header, the tabs, and the tab the address names under them. */
function TicketStanding(
  props: StandingProps & {
    readonly acting: TicketActing;
    readonly children: ReactNode;
  },
): ReactNode {
  const { actions, held } = useTicketStanding(props);
  const [runsWithin, setRunsWithin] = useState(false);
  return (
    <>
      <TicketStandingHeader held={held} actions={actions} />
      <TicketTabs
        partition={props.partition}
        ticket={props.ticket}
        runCount={readValue(props.reads.pageState)?.executions.length}
        runCountCut={props.facts.truncated}
        runsWithin={runsWithin}
      />
      <TicketRunsWithinProvider value={setRunsWithin}>
        <TicketPageHeldProvider value={held}>
          {props.children}
        </TicketPageHeldProvider>
      </TicketRunsWithinProvider>
    </>
  );
}

function TicketBody(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly reads: TicketReads;
  readonly nowMs: number;
  readonly children: ReactNode;
}): ReactNode {
  const facts = ticketPageFacts(
    readValue(props.reads.ticketState),
    readValue(props.reads.pageState),
    readValue(props.reads.configurationState)?.canonical,
  );
  return (
    <FreshnessInstants>
      <div data-fills-width className="grid min-w-0 gap-4">
        <TicketActingScope
          partition={props.partition}
          ticket={props.ticket}
          drawn={props.reads.ticketState.state === "Ready"}
        >
          {(acting) => (
            <TicketStanding
              partition={props.partition}
              ticket={props.ticket}
              reads={props.reads}
              facts={facts}
              nowMs={props.nowMs}
              acting={acting}
            >
              {props.children}
            </TicketStanding>
          )}
        </TicketActingScope>
      </div>
    </FreshnessInstants>
  );
}

/** The layout every tab is drawn in, handed the tab its address names. */
export function TicketPage(props: { readonly children: ReactNode }): ReactNode {
  const params = useParams({ from: "/$tenant/$project/tickets/$ticket" });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const ticket = Number(params.ticket);
  const nowMs = useNowMs();
  const ticketState = usePanelState(ticketQuery(partition, ticket, "Streamed"));
  const revision = readValue(ticketState)?.configurationRevision ?? "";
  const configurationState = usePanelState({
    ...configurationQuery(partition, revision),
    enabled: revision !== "",
  });
  const draftState = usePanelState(draftQuery(partition, ticket, "Streamed"));
  const openState = usePanelState(ticketNativeActionsQuery(partition, ticket));
  const dispatchState = usePanelState(ticketDispatchQuery(partition, ticket));
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
        configurationState,
        draftState,
        openState,
        dispatchState,
        pageState,
        leadState,
        deliveryState,
        landingsState,
      }}
      nowMs={nowMs}
    >
      {props.children}
    </TicketBody>
  );
}
