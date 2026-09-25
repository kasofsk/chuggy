/**
 * What a ticket arriving under the ticket page's key does to the one held
 * there, whichever writer brought it: a `Ticket` frame, which carries the
 * ticket's own read, or an action's confirmation, which carries the project's
 * row. The row is the narrower of the two, lacking every field marked below as
 * the own read's. Of those, the brief, the configuration and the program are
 * set by a release or an update and by nothing else, and an update moves the
 * revision; the run totals only lag.
 *
 * So one rule serves both writers. An arrival older than what is held is
 * dropped. Over a held read of the same revision it is written with every
 * own-read field it lacks kept from what is held. Anything else is written
 * only where it is the own read: a row with nothing to merge into is not
 * drawn, and the ticket is read again instead.
 */

import type { TicketResponse } from "../../../../src/contract/responses.ts";

type TicketField = keyof TicketResponse;

/**
 * Whether each field is carried by the ticket's own read alone or by the
 * project's row as well. Every field of the contract is named, so a field the
 * contract gains does not compile until it is placed here.
 */
const ticketFieldOwnReadOnly = {
  ticket: false,
  title: false,
  revision: false,
  phase: false,
  sequence: false,
  changedAt: false,
  releasedAt: false,
  escalation: false,
  revokedDependencies: false,
  brief: true,
  configurationRevision: true,
  configurationVersion: true,
  program: true,
  runTotals: true,
} as const satisfies Record<TicketField, boolean>;

const ticketOwnReadFields: readonly TicketField[] = (
  Object.keys(ticketFieldOwnReadOnly) as TicketField[]
).filter((field) => ticketFieldOwnReadOnly[field]);

export interface TicketArriving {
  readonly carried: "OwnRead" | "ProjectRow";
  readonly ticket: TicketResponse;
}

export type TicketArrival =
  | { readonly arrival: "Write"; readonly representation: TicketResponse }
  | { readonly arrival: "Keep" }
  | { readonly arrival: "Reread" };

function ticketArrivalFieldKept<Field extends TicketField>(
  kept: Partial<TicketResponse>,
  held: TicketResponse,
  field: Field,
): void {
  const value = held[field];
  if (value !== undefined) kept[field] = value;
}

function ticketArrivalOwnRead(held: TicketResponse): Partial<TicketResponse> {
  const kept: Partial<TicketResponse> = {};
  for (const field of ticketOwnReadFields)
    ticketArrivalFieldKept(kept, held, field);
  return kept;
}

export function ticketArrival(
  held: TicketResponse | undefined,
  arriving: TicketArriving,
): TicketArrival {
  const ticket = arriving.ticket;
  if (held !== undefined && held.sequence > ticket.sequence)
    return { arrival: "Keep" };
  if (held !== undefined && held.revision === ticket.revision)
    return {
      arrival: "Write",
      representation: { ...ticketArrivalOwnRead(held), ...ticket },
    };
  return arriving.carried === "OwnRead"
    ? { arrival: "Write", representation: ticket }
    : { arrival: "Reread" };
}
