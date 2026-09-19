/**
 * What a ticket reference drawn anywhere under the shell is told, and where
 * following one goes.
 *
 * THE READ IS THE PAGES' OWN, NOT A SECOND ONE. The facts come from the entry
 * the Tickets screen holds its unfiltered rows under, so a reference costs a
 * read only where nothing has read that yet, paging the table deeper names more
 * references, and a change frame that rewrites a row rewrites what every
 * reference to it says. A reference resolving through a read of its own would
 * be the second place a ticket is decided, and the two would answer differently
 * the day one of them changed.
 *
 * A REFERENCE OUTSIDE THOSE ROWS STILL FOLLOWS. Where the ticket's number is
 * all this knows, the chip draws the number and the link still goes to the
 * ticket's own screen — the path is the number under the open project and needs
 * nothing read to write it.
 */

import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { adoptedTickets } from "../../core/adoptedTickets.ts";
import { usePanelResource } from "../api.ts";
import { TicketReferenceProvider } from "../ui/ticketReferenceHeld.tsx";
import type { TicketReferenceFacts } from "../ui/ticketReferenceHeld.tsx";

export function TicketReferenceWiring(props: {
  readonly partition: PartitionIdentity;
  readonly children: ReactNode;
}): ReactNode {
  const partition = props.partition;
  const navigate = useNavigate();
  const state = usePanelResource(
    partition,
    "Ticket",
    "adopted-tickets",
    (ports) => adoptedTickets(ports, partition),
  );
  const known = useMemo(() => {
    const byNumber = new Map<number, TicketReferenceFacts>();
    if (state.state === "Ready")
      for (const row of state.value.tickets)
        byNumber.set(row.ticket, { title: undefined, state: row.state });
    return byNumber;
  }, [state]);
  const held = useMemo(
    () => ({
      factsOf: (ticket: number) => known.get(ticket),
      hrefOf: (ticket: number) =>
        `/${partition.tenant}/${partition.project}/tickets/${String(ticket)}`,
      open: (ticket: number) => {
        void navigate({
          to: "/$tenant/$project/tickets/$ticket",
          params: {
            tenant: partition.tenant,
            project: partition.project,
            ticket: String(ticket),
          },
        });
      },
    }),
    [known, navigate, partition.tenant, partition.project],
  );
  return (
    <TicketReferenceProvider held={held}>
      {props.children}
    </TicketReferenceProvider>
  );
}
