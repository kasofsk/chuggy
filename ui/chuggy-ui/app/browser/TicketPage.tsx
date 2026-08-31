/**
 * One ticket: where it is, what may be done to it, what it is metered by, what
 * has run for it and what all of that cost.
 *
 * The draft is read once here and handed to everything that needs it, so the
 * brief, the authoring the ledger groups by and the provenance are one
 * observation rather than three that can disagree on screen. The situation
 * column is short and the detail is in the main body under the ledger, reached
 * by anchors rather than tabs: the ledger is the page, and a tab would hide it.
 * One clock ticks the whole page, so a running row, a cycle's open span and a
 * panel's freshness all age together.
 */

import { useParams } from "@tanstack/react-router";
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
import { ticketDispatchList } from "../core/ticketActions.ts";
import { usePanelList, usePanelResource } from "./api.ts";
import { useNowMs } from "./Freshness.tsx";
import { TicketActions } from "./TicketActions.tsx";
import { TicketHead } from "./ticket/TicketHead.tsx";
import {
  TicketLedgerPanel,
  useTicketExecutions,
} from "./ticket/TicketLedger.tsx";
import { TicketMain } from "./ticket/TicketMain.tsx";
import { ticketPageFacts } from "./ticket/ticketPageFacts.ts";
import type { TicketPageFacts } from "./ticket/ticketPageFacts.ts";
import {
  TicketSituation,
  usageSectionFigure,
} from "./ticket/TicketSituation.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import type { SectionEntry } from "./ui/SectionList.tsx";

import "./ticket/ticket.css";

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

/** One anchor per region of the main body, each with the one figure it is about. */
export function ticketSections(
  ticket: TicketResponse,
  facts: TicketPageFacts,
): readonly SectionEntry[] {
  const ledger = facts.ledger;
  return [
    {
      id: "cycles",
      label: "Cycles",
      note:
        ledger === undefined
          ? "Not read"
          : `${String(ledger.cycles.length)} · ${String(ledger.spend.executions)} runs`,
    },
    { id: "usage", label: "Usage", figure: usageSectionFigure(ticket) },
    { id: "brief", label: "Brief" },
    { id: "provenance", label: "Provenance" },
  ];
}

function TicketAside(props: {
  readonly ticket: TicketResponse | undefined;
  readonly facts: TicketPageFacts;
  readonly actions: ReactNode;
  readonly nowMs: number;
}): ReactNode {
  const ticket = props.ticket;
  const ledger = props.facts.ledger;
  const accounts = props.facts.accounts;
  if (ticket === undefined || ledger === undefined || accounts === undefined)
    return <aside className="situation">{props.actions}</aside>;
  return (
    <TicketSituation
      ticket={ticket}
      facts={ledger}
      accounts={accounts}
      stageCount={props.facts.stageCount}
      sections={ticketSections(ticket, props.facts)}
      actions={props.actions}
      nowMs={props.nowMs}
    />
  );
}

function TicketBody(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly reads: TicketReads;
  readonly nowMs: number;
}): ReactNode {
  const ticket = readValue(props.reads.ticketState);
  const draft = readValue(props.reads.draftState);
  const page = readValue(props.reads.pageState);
  const facts = ticketPageFacts(ticket, draft, page);
  const rework = facts.accounts?.rework;
  const actions = (
    <TicketActions
      partition={props.partition}
      ticket={props.ticket}
      state={props.reads.ticketState}
      openState={props.reads.openState}
      dispatchState={props.reads.dispatchState}
      resume={facts.resume}
      {...(rework?.max === undefined
        ? {}
        : { rework: { left: rework.left ?? 0, max: rework.max } })}
    />
  );
  return (
    <>
      {ticket === undefined ? null : (
        <TicketHead
          ticket={ticket}
          intent={draft?.brief?.intent}
          page={page}
          truncated={facts.truncated}
          nowMs={props.nowMs}
        />
      )}
      <div className="ticket-grid">
        <TicketAside
          ticket={ticket}
          facts={facts}
          actions={actions}
          nowMs={props.nowMs}
        />
        <TicketMain
          partition={props.partition}
          draftState={props.reads.draftState}
          ledger={
            <TicketLedgerPanel
              partition={props.partition}
              page={props.reads.pageState}
              authoring={facts.authoring}
              nowMs={props.nowMs}
            />
          }
          totals={ticket?.runTotals}
          page={page}
        />
      </div>
    </>
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
