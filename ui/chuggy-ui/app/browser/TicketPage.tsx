/**
 * One ticket: what it is, what every run for it has spent, where it came from,
 * what has run for it, and what a person may do to it.
 *
 * The draft is read once here and handed to the two panels that need it, so
 * the brief and the provenance are one observation of the same resource rather
 * than two that can disagree on screen. The total is the server's own sum over
 * every attempt of every execution, including the ones past the page the
 * executions panel reads, which is why it is drawn from the ticket's own read.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  DraftResponse,
  DispatchViewResponse,
  TicketNativeActionsResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiDraft,
  apiDispatchView,
  apiTicket,
  apiTicketNativeActions,
} from "../core/apiRoutes.ts";
import { escalationReasonSentence } from "../core/codeSentences.ts";
import type { PanelState } from "../core/freshness.ts";
import { ticketDispatchList } from "../core/ticketActions.ts";
import { usePanelList, usePanelResource } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { RunTotalsLine } from "./RunEvidence.tsx";
import { TicketActions } from "./TicketActions.tsx";
import { TicketExecutions } from "./TicketExecutions.tsx";
import { TicketBrief, TicketProvenance } from "./TicketProvenance.tsx";

function TicketHeadline(props: { readonly ticket: TicketResponse }): ReactNode {
  const { phase, reason, runTotals } = props.ticket;
  return (
    <div className="ticket-head">
      <span className={`phase phase-${phase.toLowerCase()}`}>{phase}</span>
      <span className="ticket-sequence">
        at project sequence {props.ticket.sequence}
      </span>
      {reason === undefined ? null : (
        <p className="ticket-reason">{escalationReasonSentence(reason)}</p>
      )}
      {runTotals === undefined ? (
        <p className="panel-note">
          no run has recorded evidence for this ticket
        </p>
      ) : (
        <RunTotalsLine totals={runTotals} />
      )}
    </div>
  );
}

function TicketBody(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly ticketState: PanelState<TicketResponse>;
  readonly draftState: PanelState<DraftResponse>;
  readonly openState: PanelState<TicketNativeActionsResponse>;
  readonly dispatchState: PanelState<DispatchViewResponse>;
}): ReactNode {
  return (
    <>
      <DataPanel title={`ticket ${props.ticket}`} state={props.ticketState}>
        {(value) => <TicketHeadline ticket={value} />}
      </DataPanel>
      <TicketBrief state={props.draftState} />
      <TicketActions
        partition={props.partition}
        ticket={props.ticket}
        state={props.ticketState}
        openState={props.openState}
        dispatchState={props.dispatchState}
      />
      <TicketProvenance partition={props.partition} state={props.draftState} />
      <TicketExecutions partition={props.partition} ticket={props.ticket} />
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
  if (!Number.isSafeInteger(ticket) || ticket <= 0)
    return (
      <p className="panel-absent">
        the address names no ticket this console can read
      </p>
    );
  return (
    <TicketBody
      partition={partition}
      ticket={ticket}
      ticketState={ticketState}
      draftState={draftState}
      openState={openState}
      dispatchState={dispatchState}
    />
  );
}
