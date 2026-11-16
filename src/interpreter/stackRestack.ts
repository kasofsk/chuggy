/**
 * Whether a Stacked ticket pending unstacked is sent back to Work to evaluate
 * over the queue ahead of it, and over which line. `model/stacking.qnt` states
 * it as `canRestack`, with `restackLine` the line and `restackedOver` the line
 * its latest re-stack was sent back over.
 *
 * A RE-STACK IS PAID FOR BY THE LINE AHEAD CHANGING. A ticket is not sent back
 * again over the same tickets at the same commits as its latest re-stack, so
 * one whose new cycle ended unstacked — the line changed under it, the stack
 * conflicted, the remote refused it — waits for the line ahead to differ.
 *
 * A LINE THE TICKET'S WORK DOES NOT MERGE WITH IS NO RE-STACK. Before a ticket
 * is sent back, the stack it would be sent back over is folded: the target's
 * tip, the line's accepted commits, then its own. A fold that conflicts sends
 * nothing back and records nothing, so the ticket stays pending until it holds,
 * and its landing then records the conflict as a `MergeConflict`, which ends
 * its chain and releases its rank. A refused fold is kept, for as long as the
 * process runs, against the tip, the line and the accepted commit it was made
 * of, and is not folded again until one of them differs. `model/stacking.qnt`
 * has no notion of a conflict and `canRestack` guards an optional action, so
 * declining a re-stack narrows what it allows; the `MergeConflict` send-back of
 * a queued ticket is outside it, and `model/refinement.qnt` reduces it to
 * `FinalizationNeedsWork`.
 *
 * It takes plain data and reads nothing, the memo of refused folds being a map
 * its caller holds, so it replays without a database.
 */

import type { TicketId } from "../domain/ids.ts";
import type { GitObjectId } from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import { stackFor, type StackEntry, type StackMember } from "./stackChoice.ts";

/** A Stacked ticket whose finalization waits on the holder of its reference. */
export interface RestackCandidate {
  readonly ticket: TicketId;
  /** Its evaluations that ran over a stack and sent it back to work. */
  readonly stackFailures: number;
  /** The line its latest re-stack was sent back over, absent where it has none. */
  readonly restackedOver: readonly StackMember[] | undefined;
}

function restackSameLine(
  left: readonly StackMember[],
  right: readonly StackMember[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (member, at) =>
        member.ticket === right[at]?.ticket &&
        member.commit === right[at].commit,
    )
  );
}

/**
 * The line the candidate is sent back to stack over, or undefined where it is
 * not sent back: it is not a Stacked entry pending unstacked in `queue`, it
 * could not stack now, or it would stack over the line it was last sent back
 * over. The holder has nothing ahead of it, so it is never sent back.
 */
export function restackLine(
  candidate: RestackCandidate,
  queue: readonly StackEntry[],
): readonly StackMember[] | undefined {
  const entry = queue.find((each) => each.ticket === candidate.ticket);
  if (
    entry?.policy !== "Stacked" ||
    entry.phase !== "Pending" ||
    entry.stack !== undefined
  )
    return undefined;
  const line = stackFor(
    {
      ticket: candidate.ticket,
      policy: "Stacked",
      stackFailures: candidate.stackFailures,
      rank: entry.rank,
    },
    queue,
  );
  if (line === undefined) return undefined;
  if (
    candidate.restackedOver !== undefined &&
    restackSameLine(line, candidate.restackedOver)
  )
    return undefined;
  return line;
}

/** What one re-stack's fold is made of: the target's tip, the line, and the ticket's accepted commit. */
export interface RestackFold {
  readonly tip: GitObjectId;
  readonly line: readonly StackMember[];
  readonly accepted: GitObjectId;
}

/** The folds that conflicted, by ticket, which the composition root gives one finalizer process. */
export interface RestackRefusals {
  readonly folds: Map<string, RestackFold>;
}

/** The most refused folds one process keeps; forgetting one only folds it again. */
export const restackRefusalsMax = 1024;

/** A process's memo of refused folds, empty at its start. */
export function restackRefusals(): RestackRefusals {
  return { folds: new Map() };
}

function restackRefusalKey(partition: Partition, ticket: TicketId): string {
  return JSON.stringify([partition.tenant, partition.project, ticket]);
}

/** Whether the ticket's fold over exactly these inputs conflicted. */
export function restackRefused(
  refusals: RestackRefusals,
  partition: Partition,
  ticket: TicketId,
  fold: RestackFold,
): boolean {
  const refused = refusals.folds.get(restackRefusalKey(partition, ticket));
  return (
    refused !== undefined &&
    refused.tip === fold.tip &&
    refused.accepted === fold.accepted &&
    restackSameLine(refused.line, fold.line)
  );
}

/** Keeps the ticket's conflicting fold in place of any before it, forgetting the oldest past the bound. */
export function restackRefuse(
  refusals: RestackRefusals,
  partition: Partition,
  ticket: TicketId,
  fold: RestackFold,
): void {
  const key = restackRefusalKey(partition, ticket);
  refusals.folds.delete(key);
  refusals.folds.set(key, fold);
  for (const oldest of refusals.folds.keys()) {
    if (refusals.folds.size <= restackRefusalsMax) break;
    refusals.folds.delete(oldest);
  }
  if (refusals.folds.size > restackRefusalsMax)
    throw new Error("restackRefuse: the memo outgrew its bound");
}

/** Forgets the ticket's refused fold, once one over other inputs folded cleanly. */
export function restackForget(
  refusals: RestackRefusals,
  partition: Partition,
  ticket: TicketId,
): void {
  refusals.folds.delete(restackRefusalKey(partition, ticket));
}
