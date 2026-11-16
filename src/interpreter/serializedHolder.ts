/**
 * Which Serialized ticket may land on a reference, and who waits on it. The
 * holder is derived from the projection and the journal every time and stored
 * nowhere, so releasing it is not a move anyone makes: a ticket stops holding
 * when the facts below stop being true of it.
 *
 * A TICKET HOLDS A RANK WHILE IT IS ON THE WORK, EVALUATION, FINALIZATION PATH
 * AND ITS CHAIN OF WORK CYCLES HAS ONE. The rank is the position of its first
 * finalization request since the chain last broke. A chain is the work cycles
 * a `RecheckRequired` or `Restack` send-back links, so a re-check, a re-stack,
 * the re-evaluation after either and an invalidation keep the rank, and a
 * landing, a merge conflict or other send-back, an evaluation failure returning the ticket to
 * rework, a revoke, an escalation and a blocked evaluator each end the chain or
 * leave the path, and so release it with no code of their own.
 *
 * THE HOLDER OF A REFERENCE IS THE LOWEST RANK, IN WHATEVER PHASE. Only the
 * holder can reach a landing or a re-check, so a ticket sent back to re-check
 * is always the lowest, and nothing that ranked after it lands ahead of it.
 * Waiting does not escalate and has no timeout. Only a `GitMerge` names a
 * policy, so a Direct one, a pull request and a landing of nothing are in no
 * queue, and a ticket naming no repository is in none either: nothing it does
 * can collide on a reference it does not name.
 *
 * A reference is `(partition, repository, target)`, the target being what the
 * landing advances: a merged proposal's base, never the branch it is opened
 * from. An absent target is the repository's default, which this does not
 * resolve: a ticket naming that default and one omitting it are two queues. A
 * git merge's mode is not part of it, so a push and a merged proposal onto one
 * reference queue together.
 */

import type { BriefFinalizationOf } from "../contract/brief.ts";
import type { TicketPhase } from "../contract/rosters.ts";
import type { TicketId } from "../domain/ids.ts";
import type { Partition } from "./projectStore.ts";

/** The phases a ticket passes through between its work and its landing. */
export const serializedPathPhases: readonly TicketPhase[] = [
  "Work",
  "Evaluation",
  "Finalization",
];

/** What a queue reads of one ticket. */
export interface SerializedCandidate {
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly phase: TicketPhase;
  /** How its brief lands it, absent for a ticket carrying no brief. */
  readonly finalization: BriefFinalizationOf<string> | undefined;
  readonly repository: string | undefined;
  readonly target: string | undefined;
  /** The journal position of its first finalization request since its chain of work cycles last broke, absent where it has none. */
  readonly rank: number | undefined;
}

/** One reference's queue: who holds it, and the other ranked tickets in rank order, who wait on it. */
export interface SerializedQueue {
  readonly partition: Partition;
  readonly repository: string;
  readonly target: string | undefined;
  readonly holder: TicketId;
  readonly waiting: readonly TicketId[];
}

function serializedHolds(candidate: SerializedCandidate): boolean {
  const { finalization } = candidate;
  return (
    finalization?.kind === "GitMerge" &&
    finalization.policy !== "Direct" &&
    candidate.repository !== undefined &&
    serializedPathPhases.includes(candidate.phase) &&
    candidate.rank !== undefined
  );
}

function serializedKey(candidate: SerializedCandidate): string {
  return JSON.stringify([
    candidate.partition.tenant,
    candidate.partition.project,
    candidate.repository,
    candidate.target ?? null,
  ]);
}

/** Orders by rank, then by ticket, so no two orders disagree. */
function serializedBefore(
  left: SerializedCandidate,
  right: SerializedCandidate,
): number {
  return (
    (left.rank ?? 0) - (right.rank ?? 0) ||
    Number(left.ticket) - Number(right.ticket)
  );
}

/** The queue of every reference at least one Serialized ticket holds or waits on. */
export function serializedQueues(
  candidates: readonly SerializedCandidate[],
): readonly SerializedQueue[] {
  const grouped = new Map<string, SerializedCandidate[]>();
  for (const candidate of candidates) {
    if (!serializedHolds(candidate)) continue;
    const key = serializedKey(candidate);
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }
  const queues: SerializedQueue[] = [];
  for (const members of grouped.values()) {
    const ranked = [...members].sort(serializedBefore);
    const holder = ranked[0];
    if (holder === undefined) continue;
    queues.push({
      partition: holder.partition,
      repository: holder.repository ?? "",
      target: holder.target,
      holder: holder.ticket,
      waiting: ranked.slice(1).map((member) => member.ticket),
    });
  }
  return queues;
}

/** The tickets whose finalization requests may not be claimed, with the partition each is in. */
export function serializedWaiting(
  queues: readonly SerializedQueue[],
): readonly { readonly partition: Partition; readonly ticket: TicketId }[] {
  return queues.flatMap((queue) =>
    queue.waiting.map((ticket) => ({ partition: queue.partition, ticket })),
  );
}
