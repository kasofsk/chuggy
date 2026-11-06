/**
 * The head of the ticket page: its title and the epics it belongs to.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { TicketResponse } from "../../../../../src/contract/responses.ts";
import { EpicChips } from "../EpicChips.tsx";
import "./ticket.css";

export function TicketIntro(props: {
  readonly ticket: TicketResponse;
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <header className="min-w-0">
      <h1 className="text-2xl font-strong text-ink-1 min-w-0 break-words">
        {props.ticket.title ?? "Ticket"}
      </h1>
      <EpicChips partition={props.partition} epics={props.ticket.epics} />
    </header>
  );
}
