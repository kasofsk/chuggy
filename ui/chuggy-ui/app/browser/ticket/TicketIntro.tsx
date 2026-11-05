/**
 * The head of the ticket page: its title.
 */

import type { ReactNode } from "react";

import type { TicketResponse } from "../../../../../src/contract/responses.ts";
import "./ticket.css";

export function TicketIntro(props: {
  readonly ticket: TicketResponse;
}): ReactNode {
  return (
    <header className="min-w-0">
      <h1 className="text-2xl font-strong text-ink-1 min-w-0 break-words">
        {props.ticket.title ?? "Ticket"}
      </h1>
    </header>
  );
}
