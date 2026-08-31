/**
 * The one record a ticket panel keeps of a submission it is still following,
 * and the whole of when that record goes away.
 *
 * THE CACHE'S OWN EXPIRY IS TURNED OFF, AND REMOVAL IS THIS FILE'S. The entry
 * has no reader of its own, and `gcTime` for such an entry is armed once when
 * the entry is built and is not restarted by a later write — so a timed record
 * would be collected part-way through a follow that is still running, and the
 * panel remounting after that would offer a submission it had already made. A
 * follow has no wall clock to bound it either: a deferred submission waits
 * whatever `retry-after` the server names, up to the contract's cap, on every
 * one of its attempts.
 *
 * WHAT ENDS A RECORD IS THE API ANSWERING, AND NOTHING ELSE DOES. `held` is
 * written once per submission and `dropped` where the answer arrives — an
 * operation settled, or a submission the API declined to make — and every other
 * ending keeps it, because a browser that lost the answer has learnt nothing
 * about what the machine did. A record that stands is resolved by asking again:
 * a mount picks it up, and so does a press, and each poll either brings the
 * answer that drops it or leaves it for the next.
 *
 * SO A RECORD OUTLIVES A FOLLOW BY DESIGN, AND A TAB HOLDS AT MOST ONE PER
 * TICKET whose submission the API has not yet answered for. One that is never
 * answered — an API that stays unreachable — is held for as long as the tab
 * lives, which is the point: an identity nobody knows the fate of is the one
 * thing that must not be forgotten and drawn again.
 */

import type { QueryClient } from "@tanstack/react-query";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { projectHeldScope } from "../core/projectQueryKeys.ts";
import { ticketAttemptKey } from "../core/ticketActions.ts";
import type { TicketAttempt } from "../core/ticketActions.ts";

/**
 * Registered for the partition's whole held scope rather than for one ticket's
 * key, so a reader who submits on many tickets leaves one registration behind
 * and not one per ticket.
 */
function ticketAttemptUntimed(
  client: QueryClient,
  partition: PartitionIdentity,
): void {
  client.setQueryDefaults(projectHeldScope(partition), {
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** Held before the submission is made, because the identity is drawn before it
 * and an acceptance this screen never saw is still an acceptance. */
export function ticketAttemptHeld(
  client: QueryClient,
  partition: PartitionIdentity,
  ticket: number,
  attempt: TicketAttempt,
): void {
  ticketAttemptUntimed(client, partition);
  client.setQueryData<TicketAttempt>(
    ticketAttemptKey(partition, ticket),
    attempt,
  );
}

export function ticketAttemptRead(
  client: QueryClient,
  partition: PartitionIdentity,
  ticket: number,
): TicketAttempt | undefined {
  return client.getQueryData<TicketAttempt>(
    ticketAttemptKey(partition, ticket),
  );
}

export function ticketAttemptDropped(
  client: QueryClient,
  partition: PartitionIdentity,
  ticket: number,
): void {
  client.removeQueries({
    queryKey: ticketAttemptKey(partition, ticket),
    exact: true,
  });
}
