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
 * It takes plain data and reads nothing, so it replays without a database.
 */

import type { TicketId } from "../domain/ids.ts";
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
