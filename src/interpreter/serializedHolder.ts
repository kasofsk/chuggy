/**
 * Which Serialized ticket may land on a reference, and who waits on it. The
 * holder is derived from the projection every time and stored nowhere, so
 * releasing it is not a move anyone makes: a ticket stops holding when the facts
 * below stop being true of it.
 *
 * A TICKET HOLDS ONLY WHILE IT IS ON THE WORK, EVALUATION, FINALIZATION PATH AND
 * HAS A REASON TO. The reason is a finalization request still pending, or its
 * latest failed finalization attempt having been `RecheckRequired` with no
 * evaluation sending it back to work since, which is the re-check cycle in
 * flight between a send-back and the request that follows evaluation. A
 * landing, a merge conflict send-back, an evaluation failure returning the
 * ticket to rework, a revoke, an escalation, a blocked evaluator and an
 * `Unavailable` finalization each leave the path or drop both reasons, and so
 * release with no code of their own.
 *
 * THE HOLDER OF A REFERENCE IS THE TICKET WHOSE RE-CHECK IS IN FLIGHT, ELSE THE
 * FIRST PENDING FINALIZATION BY WHERE IT ENTERED. A re-check goes first because
 * the tickets that entered earlier are waiting on it. Only a `GitMerge` names a
 * policy, so a Direct one, a pull request and a landing of nothing are in no
 * queue, and a ticket naming no repository is in none either: nothing it does
 * can collide on a reference it does not name.
 *
 * A reference is `(partition, repository, target)`, and an absent target is the
 * repository's default, which this does not resolve: a ticket naming that
 * default and one omitting it are two queues. A git merge's mode is not part of
 * it, so a push and a merged proposal onto one reference queue together.
 */

import type { BriefFinalizationOf } from "../contract/brief.ts";
import type { TicketPhase } from "../contract/rosters.ts";
import type { TicketId } from "../domain/ids.ts";
import type { Partition } from "./projectStore.ts";

/** The phases a ticket passes through between a send-back to re-check and its landing. */
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
  /** The journal position its finalization request was authorized at, absent where none is pending. */
  readonly entry: number | undefined;
  /** Whether its latest failed finalization attempt was `RecheckRequired` and no evaluation has sent it back to work since. */
  readonly rechecking: boolean;
}

/** One reference's queue: who holds it, and who each other pending finalization waits on. */
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
    finalization.policy === "Serialized" &&
    candidate.repository !== undefined &&
    serializedPathPhases.includes(candidate.phase) &&
    (candidate.entry !== undefined || candidate.rechecking)
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

/** Orders by where the finalization entered, then by ticket, so no two orders disagree. */
function serializedBefore(
  left: SerializedCandidate,
  right: SerializedCandidate,
): number {
  return (
    (left.entry ?? 0) - (right.entry ?? 0) ||
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
    const rechecking = members
      .filter((member) => member.rechecking)
      .sort((left, right) => Number(left.ticket) - Number(right.ticket))[0];
    const pending = members
      .filter((member) => member.entry !== undefined)
      .sort(serializedBefore);
    const holder = rechecking ?? pending[0];
    const first = members[0];
    if (holder === undefined || first === undefined) continue;
    queues.push({
      partition: first.partition,
      repository: first.repository ?? "",
      target: first.target,
      holder: holder.ticket,
      waiting: pending
        .filter((member) => member.ticket !== holder.ticket)
        .map((member) => member.ticket),
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
