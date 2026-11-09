/**
 * What a Stacked ticket's evaluation runs over: the tickets ahead of it on its
 * reference, when every one of them is a member of a stack that stands, and
 * nothing otherwise. `model/stacking.qnt` states it; `stands`, `stackFor` and
 * its membership test are that module's definitions of the same names.
 *
 * It takes plain data and reads nothing. The queue, the ranks, the phases, the
 * accepted commits, the stacks recorded and the landings since each stack's tip
 * are gathered before it runs, so the choice replays without a database.
 *
 * `Ready` IS A PHASE THE MODEL HAS AND THE TICKET'S OWN DOES NOT: an
 * evaluation phase whose evaluation has not started. Only a started one is
 * stacked on, so the gatherer tells the two apart.
 */

import type { TicketId } from "../domain/ids.ts";
import type { GitObjectId } from "./finalizer.ts";

/** The most tickets beneath a stack. */
export const stackDepthMax = 3;

/** The stacked evaluation failures after which a ticket evaluates unstacked. */
export const stackFailuresMax = 2;

/** The policies that queue; a Direct ticket is in no queue. */
export type StackPolicy = "Serialized" | "Stacked";

export type StackPhase = "Work" | "Ready" | "Evaluation" | "Pending";

/** A ticket and the accepted commit it lands. */
export interface StackMember {
  readonly ticket: TicketId;
  readonly commit: GitObjectId;
}

/** A recorded stack and the landings on its reference since its tip, in order. */
export interface StackStanding {
  readonly beneath: readonly StackMember[];
  /** At most one more than `beneath` holds: a longer run cannot be a prefix of it. */
  readonly landings: readonly StackMember[];
}

/** One ranked ticket of a reference's queue. */
export interface StackEntry {
  readonly ticket: TicketId;
  readonly policy: StackPolicy;
  readonly phase: StackPhase;
  readonly rank: number;
  /** The commit its work was accepted at. */
  readonly commit: GitObjectId;
  /** The stack its current work cycle was evaluated over, absent where it was evaluated unstacked. */
  readonly stack: StackStanding | undefined;
}

/** The ticket choosing what to evaluate over. */
export interface StackCandidate {
  readonly ticket: TicketId;
  readonly policy: StackPolicy;
  /** Its evaluations that ran over a stack and sent it back to work. */
  readonly stackFailures: number;
  /** Its rank where it keeps one through a re-evaluation, absent at its first. */
  readonly rank: number | undefined;
}

function stackSame(left: StackMember, right: StackMember): boolean {
  return left.ticket === right.ticket && left.commit === right.commit;
}

function stackMembersSame(
  left: readonly StackMember[],
  right: readonly StackMember[],
): boolean {
  return (
    left.length === right.length &&
    left.every((member, at) => {
      const other = right[at];
      return other !== undefined && stackSame(member, other);
    })
  );
}

/**
 * Whether a stack stands: the landings since its tip are a prefix of its
 * beneath, at the same commits, and every ticket still beneath is evaluated or
 * pending at the commit the stack names. A ticket absent from `queue` is no
 * ticket that is.
 */
export function stackStands(
  standing: StackStanding,
  queue: readonly StackEntry[],
): boolean {
  const { beneath, landings } = standing;
  if (landings.length > beneath.length) return false;
  if (!stackMembersSame(landings, beneath.slice(0, landings.length)))
    return false;
  return beneath.slice(landings.length).every((member) => {
    const entry = queue.find((candidate) => candidate.ticket === member.ticket);
    return (
      entry !== undefined &&
      (entry.phase === "Evaluation" || entry.phase === "Pending") &&
      entry.commit === member.commit
    );
  });
}

/** The queue in rank order, then by ticket so no two orders disagree. */
function stackOrdered(queue: readonly StackEntry[]): readonly StackEntry[] {
  return [...queue].sort(
    (left, right) => left.rank - right.rank || left.ticket - right.ticket,
  );
}

/**
 * Whether the entry at `at` of `line` is a member of a stack standing over the
 * entries before it. The holder, first in line, is one while it is evaluated or
 * pending; any other must be pending, Stacked, and stacked over exactly the
 * entries before it, on a stack that stands.
 */
function stackMemberAt(
  line: readonly StackEntry[],
  at: number,
  queue: readonly StackEntry[],
): boolean {
  const entry = line[at];
  if (entry === undefined) return false;
  if (at === 0)
    return entry.phase === "Evaluation" || entry.phase === "Pending";
  const before = line.slice(0, at).map(stackMemberOf);
  return (
    entry.phase === "Pending" &&
    entry.policy === "Stacked" &&
    entry.stack !== undefined &&
    stackMembersSame(entry.stack.beneath, before) &&
    stackStands(entry.stack, queue)
  );
}

function stackMemberOf(entry: StackEntry): StackMember {
  return { ticket: entry.ticket, commit: entry.commit };
}

/**
 * The tickets, bottom first, the candidate's evaluation runs over, or
 * undefined where it runs unstacked: it is not Stacked, it is at its failure
 * cap, nothing is ahead of it, more than the depth is, or an entry ahead is not
 * a member of a stack that stands. A Serialized entry past the holder is such a
 * non-member, so it is a barrier.
 */
export function stackFor(
  candidate: StackCandidate,
  queue: readonly StackEntry[],
): readonly StackMember[] | undefined {
  if (candidate.policy !== "Stacked") return undefined;
  if (candidate.stackFailures >= stackFailuresMax) return undefined;
  const others = queue.filter((entry) => entry.ticket !== candidate.ticket);
  const line = stackOrdered(others).filter(
    (entry) => candidate.rank === undefined || entry.rank < candidate.rank,
  );
  if (line.length === 0 || line.length > stackDepthMax) return undefined;
  if (!line.every((_, at) => stackMemberAt(line, at, others))) return undefined;
  return line.map(stackMemberOf);
}
