/**
 * A ticket's place in its project's landing queues: whether it holds its
 * reference or waits on it, and where. A ticket holds a rank on one reference
 * at most, so the first queue naming it is its only one; a ticket in none,
 * which is every Direct one, has no place.
 *
 * THE RESPONSE'S FIELDS ARE READ HERE AND NOWHERE ELSE, so a field the read
 * renames is one module's change.
 *
 * THE READ IS ASKED AGAIN ON A CLOCK AND ON EVERY TICKET FRAME, since a queue
 * moves with the phase of every ticket in it and no frame names a queue.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { LandingQueuesResponse } from "../../../../src/contract/responses.ts";
import type { Copy } from "./copy.ts";
import { projectListReread } from "./projectQueryKeys.ts";
import type { ProjectList } from "./projectQueryKeys.ts";
import type { Tone } from "./tones.ts";

/**
 * How often the read is asked again while a page draws it. With the slowest
 * answer one request can take it stays inside the console's staleness rule.
 */
export const landingQueuesPolledMs = 30_000;

/** The list entry the read is kept at, which every ticket frame stales. */
export function landingQueuesList(
  partition: PartitionIdentity,
): ProjectList<LandingQueuesResponse> {
  return projectListReread<LandingQueuesResponse>(
    partition,
    "Ticket",
    "landing-queues",
  );
}

/** Where one ticket stands in its queue, counted from one with the holder first. */
export interface LandingQueuePlace {
  readonly holding: boolean;
  readonly position: number;
  readonly total: number;
  /** The ticket holding the reference, which is this one where it holds it. */
  readonly holder: number;
}

/** The ticket's place, or nothing where no queue the read answered names it. */
export function landingQueuePlaceOf(
  queues: LandingQueuesResponse | undefined,
  ticket: number,
): LandingQueuePlace | undefined {
  for (const queue of queues?.queues ?? []) {
    const order = [queue.holder, ...queue.waiting];
    const index = order.indexOf(ticket);
    if (index < 0) continue;
    return {
      holding: index === 0,
      position: index + 1,
      total: order.length,
      holder: queue.holder,
    };
  }
  return undefined;
}

export function landingQueuePlaceTone(place: LandingQueuePlace): Tone {
  return place.holding ? "finalization" : "queued";
}

/** The place as its chip draws it, `position/total`. */
export function landingQueuePlaceFigure(place: LandingQueuePlace): Copy {
  return {
    id: "ticket-queue-place",
    args: { position: String(place.position), total: String(place.total) },
  };
}

/** The place in words, naming the ticket that holds the reference. */
export function landingQueuePlaceWords(place: LandingQueuePlace): Copy {
  const args = {
    position: String(place.position),
    total: String(place.total),
    holder: String(place.holder),
  };
  return place.holding
    ? { id: "ticket-queue-holding", args }
    : { id: "ticket-queue-waiting", args };
}
