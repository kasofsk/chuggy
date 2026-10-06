/**
 * Where each action the ticket's repository declares stands for the commit the
 * ticket landed at: the read, asked again on a clock, and the row's body.
 *
 * What a reporter sent is drawn as text and as an address a press opens
 * outside the console, never as markup. A read that did not answer is the one
 * line any read on this page is drawn as, and it is this row's alone.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiTicketActionReach } from "../../core/apiRoutes.ts";
import {
  ticketDeliveryPolledMs,
  ticketDeliveryRead,
  ticketDeliveryResource,
} from "../../core/ticketDelivery.ts";
import type {
  TicketDeliveryLine,
  TicketDeliveryState,
} from "../../core/ticketDelivery.ts";
import { actionReachArm } from "../../core/tones.ts";
import { usePanelResource } from "../api.ts";
import { DataSection } from "../DataPanel.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Pill } from "../ui/Pill.tsx";

import "./ticket.css";

/** The lines one ticket's read answers, kept across a poll that is out or failed. */
export function useTicketDelivery(
  partition: PartitionIdentity,
  ticket: number,
): TicketDeliveryState {
  return ticketDeliveryRead(
    usePanelResource(
      partition,
      "Ticket",
      ticketDeliveryResource(ticket),
      (ports) => apiTicketActionReach(ports, partition, ticket),
      ticketDeliveryPolledMs,
    ),
  );
}

function DeliveryLine(props: { readonly line: TicketDeliveryLine }): ReactNode {
  const line = props.line;
  const arm = actionReachArm(line.reach);
  return (
    <li className="ticket-delivery-line">
      <span className="ticket-delivery-name">{line.name}</span>
      <span className="ticket-delivery-mark">
        <Pill tone={arm.tone}>{arm.word}</Pill>
      </span>
      <span className="ticket-delivery-report">
        {line.commit === undefined ? null : <Identity label={line.commit} />}
        {line.link === undefined ? null : (
          <a href={line.link.href} rel="noopener noreferrer" target="_blank">
            {line.link.host}
          </a>
        )}
      </span>
      {line.detail === undefined ? null : (
        <p className="ticket-delivery-detail">{line.detail}</p>
      )}
    </li>
  );
}

export function TicketDelivery(props: {
  readonly state: TicketDeliveryState;
}): ReactNode {
  return (
    <DataSection state={props.state}>
      {(lines) => (
        <ul className="ticket-delivery">
          {lines.map((line) => (
            <DeliveryLine key={line.action} line={line} />
          ))}
        </ul>
      )}
    </DataSection>
  );
}
