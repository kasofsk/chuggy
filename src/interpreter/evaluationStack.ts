/**
 * The stack an evaluation runs over, prepared once per ticket and work cycle
 * by the finalizer before the cycle's first evaluation spawns, and the facts a
 * choice of the next stack is made from. `stackChoice.ts` decides; this is the
 * door it is gathered through and what it leaves.
 *
 * A cycle is left either a record or an explicit decision to evaluate
 * unstacked, never both, and neither ever changes. A cycle with neither is not
 * yet prepared: its spawn waits, up to a bound, and then evaluates unstacked
 * and is never prepared afterwards. Whether a record stands is derived each
 * time from the landings since its tip and the tickets still beneath, and kept
 * nowhere.
 */

import type { TicketId } from "../domain/ids.ts";
import {
  asGitRefName,
  gitStackRefPrefix,
  type GitObjectId,
  type GitRefName,
} from "./finalizer.ts";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";
import type { StackEntry, StackMember, StackStanding } from "./stackChoice.ts";

/** The ref a cycle's stack commit is published at, which a plain clone fetches. */
export function stackRefOf(ticket: number, cycle: number): GitRefName {
  return asGitRefName(`${gitStackRefPrefix}${String(ticket)}/${String(cycle)}`);
}

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

/** Why a cycle was decided unstacked. */
export const unstackedReasons = [
  "Unchosen",
  "Conflicted",
  "Unpublished",
] as const;
export type UnstackedReason = (typeof unstackedReasons)[number];

/** What preparing a cycle left: the stack, or the reason it is evaluated unstacked. */
export type StackPrepared =
  | { readonly prepared: "Stack"; readonly stack: EvaluationStack }
  | {
      readonly prepared: "Unstacked";
      readonly ticket: TicketId;
      readonly cycle: number;
      readonly reason: UnstackedReason;
    };

/** What a cycle was prepared as, absent where it has not been. */
export type StackDecision =
  | { readonly decided: "Stack"; readonly record: EvaluationStack }
  | { readonly decided: "Unstacked"; readonly reason: UnstackedReason };

/** A Stacked ticket's accepted work whose cycle has no evaluation, record or decision yet. */
export interface UnpreparedStack {
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly cycle: number;
  readonly repository: string;
  /** The commit the work was accepted at. */
  readonly commit: GitObjectId;
}

/** A stack due to be taken down, with the project it was written in. */
export interface RemovableStack {
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly cycle: number;
  readonly repository: string;
  /** The commit the stack was recorded at, which is all the ref may be taken down from. */
  readonly commit: GitObjectId;
}

/** A cycle decided to be evaluated unstacked because its stack could not be published, whose push may have landed unrecorded. */
export interface UnrecordedStack {
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly cycle: number;
  readonly repository: string;
  /** The commit the work was accepted at, which any stack of the cycle contains. */
  readonly candidate: GitObjectId;
}

/** A Stacked ticket being evaluated over a stack, with what decides whether the stack still stands. */
export interface EvaluatingStack {
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly cycle: number;
  readonly repository: string;
  /** The reference its brief lands on, absent for the repository's default. */
  readonly target: string | undefined;
  readonly standing: StackStanding;
}

/** What offering an invalidation to the finalizer's door answered. */
export type StackInvalidationOffered =
  "Submitted" | "AlreadySubmitted" | "Refused";

export interface EvaluationStackStore {
  /**
   * Leaves the cycle its preparation, in one transaction, unless the cycle
   * already has one (`Present`) or has already begun evaluating
   * (`Evaluated`), in which case nothing is written.
   */
  prepare(
    partition: Partition,
    prepared: StackPrepared,
  ): Promise<"Written" | "Present" | "Evaluated">;
  /**
   * The accepted work of Stacked tickets nothing has yet prepared, at most
   * `limit` of them. The bounded reads take their rows in an order keyed on
   * `rotation`, which the store takes from its own clock where none is given,
   * so rows that never clear cannot hold the rest out of the limit.
   */
  unprepared(
    limit: number,
    rotation?: number,
  ): Promise<readonly UnpreparedStack[]>;
  /** What the cycle was prepared as. */
  decision(
    partition: Partition,
    ticket: TicketId,
    cycle: number,
  ): Promise<StackDecision | undefined>;
  read(
    partition: Partition,
    ticket: TicketId,
    cycle: number,
  ): Promise<EvaluationStack | undefined>;
  /** The record of the work cycle of the ticket's latest passed work, absent where that cycle was evaluated unstacked. */
  current(
    partition: Partition,
    ticket: TicketId,
  ): Promise<EvaluationStack | undefined>;
  /** Whether an evaluation of the cycle has been registered, which is when its stack is no longer chosen. */
  evaluated(
    partition: Partition,
    ticket: TicketId,
    cycle: number,
  ): Promise<boolean>;
  /**
   * The stacks not yet taken down whose ticket is Done or Revoked or has begun
   * a later work cycle, at most `limit` of them.
   */
  removable(
    limit: number,
    rotation?: number,
  ): Promise<readonly RemovableStack[]>;
  /** The cycles decided Unpublished that are over and not yet taken down, at most `limit` of them. */
  unrecorded(
    limit: number,
    rotation?: number,
  ): Promise<readonly UnrecordedStack[]>;
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
  /**
   * The Stacked tickets being evaluated over a stack that no invalidation has
   * been offered for, at most `limit` of them.
   */
  evaluating(
    limit: number,
    rotation?: number,
  ): Promise<readonly EvaluatingStack[]>;
  /**
   * Offers the invalidation of a ticket's evaluation of the cycle to the one
   * door that submits it, which marks the stack dead in the same transaction.
   * Offering it again, for the same ticket and cycle, submits nothing new.
   */
  invalidate(
    partition: Partition,
    ticket: TicketId,
    cycle: number,
    epoch: RecoveryEpoch,
  ): Promise<StackInvalidationOffered>;
  /** The cycles of the ticket whose stack was found no longer standing, each with the journal position it was found at. */
  dead(
    partition: Partition,
    ticket: TicketId,
  ): Promise<ReadonlyMap<number, number>>;
}
