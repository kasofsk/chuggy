/**
 * The stack an evaluation ran over, kept once per ticket and work cycle, and
 * the facts a choice of the next stack is made from. `stackChoice.ts` decides;
 * this is the door it is gathered through and the record it leaves.
 *
 * A cycle with no record was evaluated unstacked. A record is written when the
 * cycle's first evaluation spawns and never changes: whether it stands is
 * derived each time from the landings since its tip and the tickets still
 * beneath, and kept nowhere.
 */

import type { TicketId } from "../domain/ids.ts";
import type { GitObjectId } from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import type { StackEntry, StackMember } from "./stackChoice.ts";

/** One cycle's stack, as it was written. */
export interface EvaluationStack {
  readonly ticket: TicketId;
  readonly cycle: number;
  readonly repository: string;
  /** The reference the stack was built on, as the finalization attempts name it. */
  readonly target: string;
  /** The reference's commit the stack was built on. */
  readonly tip: GitObjectId;
  /** The tickets beneath, bottom first, each with the accepted commit it must land. */
  readonly beneath: readonly StackMember[];
  readonly stackCommit: GitObjectId;
  readonly stackTree: GitObjectId;
}

export interface EvaluationStackStore {
  /** Writes the record unless the cycle has one, and says which it was. */
  record(
    partition: Partition,
    stack: EvaluationStack,
  ): Promise<"Written" | "Present">;
  read(
    partition: Partition,
    ticket: TicketId,
    cycle: number,
  ): Promise<EvaluationStack | undefined>;
  /** Notes that a cycle's stack commit was taken down, and says whether this was the first note. */
  remove(
    partition: Partition,
    ticket: TicketId,
    cycle: number,
  ): Promise<"Removed" | "Gone">;
  /** The ranked tickets of one reference, `target` absent for the repository's default. */
  queue(
    partition: Partition,
    repository: string,
    target: string | undefined,
  ): Promise<readonly StackEntry[]>;
  /** The evaluations of a ticket that ran over a stack and sent it back to work. */
  stackFailures(partition: Partition, ticket: TicketId): Promise<number>;
}
