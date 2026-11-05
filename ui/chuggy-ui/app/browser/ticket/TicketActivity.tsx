/**
 * What has run for the ticket and what became of it once it landed: the
 * executions' spend by stage and by model, and where delivery stands where
 * the ticket's repository declares actions.
 */

import type { ReactNode } from "react";

import type {
  ExecutionsResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { ticketDeliveryDrawn } from "../../core/ticketDelivery.ts";
import type { TicketDeliveryState } from "../../core/ticketDelivery.ts";
import { Panel } from "../ui/Panel.tsx";
import { TicketDelivery } from "./TicketDelivery.tsx";
import { TicketUsage } from "./TicketUsage.tsx";

import "./ticket.css";

export function TicketActivity(props: {
  readonly ticket: TicketResponse | undefined;
  readonly page: ExecutionsResponse | undefined;
  readonly truncated: boolean;
  readonly delivery: TicketDeliveryState;
}): ReactNode {
  return (
    <Panel title="Activity" level={2}>
      <div className="grid gap-4">
        <TicketUsage
          totals={props.ticket?.runTotals}
          page={props.page}
          truncated={props.truncated}
        />
        {ticketDeliveryDrawn(props.delivery) ? (
          <section className="grid gap-2" aria-labelledby="ticket-delivery">
            <h3 className="panel-title" id="ticket-delivery">
              Delivery
            </h3>
            <TicketDelivery state={props.delivery} />
          </section>
        ) : null}
      </div>
    </Panel>
  );
}
