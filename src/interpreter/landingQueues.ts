/**
 * The read of a project's landing queues: for each reference a Serialized or
 * Stacked ticket of the project holds or waits on, who holds it and who waits
 * behind it. The queues are `serializedQueues`' over the candidates the store
 * answers, so this read and the finalizer's claim cannot order them apart.
 * Each queue also says its holder's phase and since when it has held it, as
 * the store derives that from the journal.
 *
 * IT IS AUTHORIZED AS THE PROJECT'S TICKET LIST IS, and a project the caller
 * may not read is answered as one that does not exist.
 *
 * THE STORE ANSWERS THE EARLIEST-RANKED CANDIDATES. A ticket holds a queue only
 * ahead of every ticket waiting in it, so a cut by rank leaves each queue it
 * answers with its holder and its earliest waiters, and leaves out a queue
 * whose every ticket ranks after the cut.
 */

import { landingQueueTicketsAnsweredMax } from "../contract/http.ts";
import type { TicketPhase } from "../contract/rosters.ts";
import { authorizedProjectRead } from "./authorizedProject.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import {
  serializedQueues,
  type SerializedCandidate,
  type SerializedQueue,
} from "./serializedHolder.ts";

/** A ranked candidate, with the instant it came to hold its queue where it holds it. */
export interface LandingQueueCandidate extends SerializedCandidate {
  /** The later of its rank's instant and the latest at which a ticket ranked ahead of it on its reference stopped holding, as ISO 8601 in UTC. */
  readonly holderSince: string | undefined;
}

/** One project's ranked queue candidates, in rank order, and whether more were ranked than were answered. */
export interface LandingQueueCandidates {
  readonly candidates: readonly LandingQueueCandidate[];
  readonly truncated: boolean;
}

export interface LandingQueuesStore {
  /** At most `ticketsMax` of the project's candidates holding a rank, the earliest-ranked. */
  rankedCandidates(
    partition: Partition,
    ticketsMax: number,
  ): Promise<LandingQueueCandidates>;
}

/** One queue, with its holder's phase and the instant it came to hold it. */
export interface LandingQueue extends SerializedQueue {
  readonly holderSince: string;
  readonly holderPhase: TicketPhase;
}

/** A project's queues, by repository and then target, and whether the candidates were cut. */
export interface LandingQueues {
  readonly queues: readonly LandingQueue[];
  readonly truncated: boolean;
}

export interface LandingQueueReads {
  read(
    principal: Principal,
    partition: Partition,
  ): Promise<LandingQueues | undefined>;
}

function landingQueuesTextBefore(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** By repository, then by target, a queue naming none first. */
function landingQueuesBefore(
  left: SerializedQueue,
  right: SerializedQueue,
): number {
  return (
    landingQueuesTextBefore(left.repository, right.repository) ||
    landingQueuesTextBefore(left.target ?? "", right.target ?? "")
  );
}

/** `queue` with what its holder's candidate says of it, which must say since when it holds. */
function landingQueuesHeld(
  queue: SerializedQueue,
  candidates: readonly LandingQueueCandidate[],
): LandingQueue {
  const holder = candidates.find(
    (candidate) => candidate.ticket === queue.holder,
  );
  if (holder?.holderSince === undefined)
    throw new Error("landing queues: a holder has no instant it holds from");
  return {
    ...queue,
    holderSince: holder.holderSince,
    holderPhase: holder.phase,
  };
}

/** The queues of one project's candidates, each of which the store must have answered for that project. */
export function landingQueuesOf(
  partition: Partition,
  read: LandingQueueCandidates,
): LandingQueues {
  if (read.candidates.length > landingQueueTicketsAnsweredMax)
    throw new RangeError("landing queues: the store answered past its bound");
  for (const candidate of read.candidates) {
    if (
      candidate.partition.tenant !== partition.tenant ||
      candidate.partition.project !== partition.project
    )
      throw new Error("landing queues: a candidate is another project's");
  }
  return {
    queues: [...serializedQueues(read.candidates)]
      .sort(landingQueuesBefore)
      .map((queue) => landingQueuesHeld(queue, read.candidates)),
    truncated: read.truncated,
  };
}

export function landingQueueReads(ports: {
  readonly access: ProjectAccess;
  readonly store: LandingQueuesStore;
}): LandingQueueReads {
  return {
    read: authorizedProjectRead(ports.access, async (partition) =>
      landingQueuesOf(
        partition,
        await ports.store.rankedCandidates(
          partition,
          landingQueueTicketsAnsweredMax,
        ),
      ),
    ),
  };
}
