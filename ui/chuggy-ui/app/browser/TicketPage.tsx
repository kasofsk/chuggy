/**
 * One ticket: what it is, where it came from, what has run for it, and what a
 * person may do to it.
 *
 * The draft is read once here and handed to the two panels that need it, so
 * the brief and the provenance are one observation of the same resource rather
 * than two that can disagree on screen.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  DraftResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import { apiDraft, apiTicket } from "../core/apiRoutes.ts";
import { escalationReasonSentence } from "../core/codeSentences.ts";
import type { PanelState } from "../core/freshness.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import { usePanelQuery } from "./api.ts";
import { Panel } from "./Panel.tsx";
import { TicketActions } from "./TicketActions.tsx";
import { TicketExecutions } from "./TicketExecutions.tsx";
import { TicketBrief, TicketProvenance } from "./TicketProvenance.tsx";

function TicketHeadline(props: { readonly ticket: TicketResponse }): ReactNode {
  const { phase, reason } = props.ticket;
  return (
    <div className="ticket-head">
      <span className={`phase phase-${phase.toLowerCase()}`}>{phase}</span>
      <span className="ticket-sequence">
        at project sequence {props.ticket.sequence}
      </span>
      {reason === undefined ? null : (
        <p className="ticket-reason">{escalationReasonSentence(reason)}</p>
      )}
    </div>
  );
}

function TicketBody(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly ticketState: PanelState<TicketResponse>;
  readonly draftState: PanelState<DraftResponse>;
}): ReactNode {
  return (
    <>
      <Panel title={`ticket ${props.ticket}`} state={props.ticketState}>
        {(value) => <TicketHeadline ticket={value} />}
      </Panel>
      <TicketBrief state={props.draftState} />
      <TicketActions
        partition={props.partition}
        ticket={props.ticket}
        state={props.ticketState}
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
  const ticketState = usePanelQuery(
    projectResourceKey(partition, "Ticket", String(ticket)),
    (ports) => apiTicket(ports, partition, ticket),
  );
  const draftState = usePanelQuery(
    projectResourceKey(partition, "Draft", String(ticket)),
    (ports) => apiDraft(ports, partition, ticket),
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
    />
  );
}
