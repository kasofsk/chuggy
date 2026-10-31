/**
 * What a ticket arriving under the ticket page's key does to the one held
 * there, whichever writer brought it: a `Ticket` frame, which carries the
 * ticket's own read, or an action's confirmation, which carries the project's
 * row. The row is the narrower of the two, lacking every field marked below as
 * the own read's. Of those, the brief, the configuration, its overrides, the
 * program and the dependencies are set by a release or an update and by
 * nothing else, and an update moves the revision; the run totals only lag.
 * The following is answered by the own read alone, its absence included.
 *
 * So one rule serves both writers. An arrival older than what is held is
 * dropped. Over a held read of the same revision it is written with every
 * own-read field it lacks kept from what is held, but for an own read's absent
 * following. Anything else is written only where it is the own read: a row
 * with nothing to merge into is not drawn, and the ticket is read again
 * instead.
 */

import type { TicketResponse } from "../../../../src/contract/responses.ts";

type TicketField = keyof TicketResponse;

/**
 * Whether each field is carried by the project's row as well (`false`), or by
 * the ticket's own read alone: kept from what is held when an arrival lacks it
 * (`true`), or kept only when the arrival is the row (`"Answered"`). Every
 * field of the contract is named, so a field the contract gains does not
 * compile until it is placed here.
 */
const ticketFieldOwnReadOnly = {
  ticket: false,
  title: false,
  repository: false,
  creator: false,
  revision: false,
  phase: false,
  sequence: false,
  changedAt: false,
  releasedAt: false,
  escalation: false,
  revokedDependencies: false,
  openDependencies: false,
  brief: true,
  configurationRevision: true,
  configurationVersion: true,
  overrides: true,
  selection: true,
  program: true,
  dependencies: true,
  following: "Answered",
  runTotals: true,
} as const satisfies Record<TicketField, boolean | "Answered">;

const ticketFields = Object.keys(ticketFieldOwnReadOnly) as TicketField[];

const ticketOwnReadFields: Record<
  TicketArriving["carried"],
  readonly TicketField[]
> = {
  OwnRead: ticketFields.filter(
    (field) => ticketFieldOwnReadOnly[field] === true,
  ),
  ProjectRow: ticketFields.filter(
    (field) => ticketFieldOwnReadOnly[field] !== false,
  ),
};

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

function ticketArrivalOwnRead(
  held: TicketResponse,
  carried: TicketArriving["carried"],
): Partial<TicketResponse> {
  const kept: Partial<TicketResponse> = {};
  for (const field of ticketOwnReadFields[carried])
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
      representation: {
        ...ticketArrivalOwnRead(held, arriving.carried),
        ...ticket,
      },
    };
  return arriving.carried === "OwnRead"
    ? { arrival: "Write", representation: ticket }
    : { arrival: "Reread" };
}
