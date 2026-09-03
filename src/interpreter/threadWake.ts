/**
 * The bounded pass that turns a change-log row into a turn in a member's
 * mailbox, and nothing else. It reads a cursor, reads one page of candidates,
 * offers each of them one wake, and moves the cursor once. It is pure —
 * nothing here reaches a store, a clock or a route except through
 * `ThreadWakeService` — and it composes no body: the document names the reason
 * and the resource, and a thread that wants the ticket reads it with its own
 * tools.
 *
 * THE TURN IDENTITY IS DERIVED, NOT MINTED. `threadWakeTurn` is a pure
 * function of the change sequence and the session, so a pass that crashed
 * after enqueuing and before advancing re-offers THE SAME turn and is told
 * `AlreadyWoken`. That is the whole reason the cursor may be moved outside the
 * enqueues' transaction, and it is why the session is carried as a digest
 * rather than verbatim: a session identity may be as wide as the column that
 * holds it, so a turn id that spelled one out could not also fit.
 *
 * A WAKE THAT LANDS NOWHERE IS SKIPPED, NOT RETRIED, and the cursor still
 * moves past it. A member whose mailbox is full has more waiting than they
 * have read, and a wake retried until it fits would make their mailbox a
 * queue of notices nobody asked for; a thread that is closed, ownerless or
 * absent has nobody to tell. The pass counts each of those and carries on,
 * because one member's mailbox is not the pass's business to stop for.
 *
 * A CURSOR MAY ONLY MOVE PAST A SEQUENCE THE PASS READ WHOLE. One change row
 * wakes one thread per member who authored a revision of the ticket it names,
 * so a page that filled its bound may hold only part of the last sequence's
 * candidates — and a cursor moved past that sequence would drop the rest of
 * them permanently and silently. So a full page advances to the highest
 * sequence BELOW its last, which the ordering makes complete, and its last
 * sequence is read again next pass, where what was already woken answers
 * `AlreadyWoken`. The one case with no complete sequence to move to is a page
 * entirely of one sequence: there the pass moves past it anyway and says so in
 * `truncatedAt`, because the alternative is a cursor that can never move again
 * for any project and no bound a deployment can set would free it.
 *
 * THE PASS TRUSTS THE PAGE'S ORDER AND CHECKS IT. The reasoning above holds
 * only where a page is a PREFIX of the window after the cursor, so a page that
 * is not in sequence order, or that is wider than the bound it was asked for,
 * raises rather than deriving a cursor from an order it does not have.
 */

import { createHash } from "node:crypto";

import type { SessionId, SessionTurnId } from "./agentSession.ts";
import { asSessionTurnId } from "./agentSession.ts";
import type { Principal } from "./principal.ts";
import type { Partition } from "./projectStore.ts";
import {
  threadWakeDocument,
  threadWakeText,
  type ThreadWakeReason,
} from "./thread.ts";

/** One change row the roster says wakes one member's thread. */
export interface ThreadWakeCandidate {
  readonly sequence: number;
  readonly partition: Partition;
  readonly reason: ThreadWakeReason;
  readonly resource: string;
  readonly principal: Principal;
  readonly session: SessionId;
}

/**
 * What one wake offered a member's mailbox. Two arms are a turn — the second
 * being the replay the derived identity makes possible — and the other four
 * are a mailbox there was no turn to put in.
 */
export type ThreadWakeOffered =
  | { readonly woken: "Woken" | "AlreadyWoken"; readonly ordinal: number }
  | { readonly woken: "NoThread" | "Closed" | "Orphaned" | "Backlogged" };

/**
 * The durable side of one pass. `candidates` answers in sequence order and
 * within the limit it was given; `advance` answers the sequence the cursor
 * holds afterwards, which is what lets the pass assert it moved.
 */
export interface ThreadWakeStore {
  cursor(): Promise<number>;
  candidates(
    after: number,
    limit: number,
  ): Promise<readonly ThreadWakeCandidate[]>;
  wake(input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly turn: SessionTurnId;
    readonly input: string;
  }): Promise<ThreadWakeOffered>;
  advance(sequence: number): Promise<number>;
}

export interface ThreadWakeService {
  readonly store: ThreadWakeStore;
  readonly clock: { nowIso(): string };
  readonly wakesPerPassMax: number;
}

export interface ThreadWakeReport {
  readonly read: number;
  readonly woken: number;
  readonly skipped: number;
  readonly cursor: number;
  /**
   * The sequence whose candidates the bound could not hold, where a page held
   * one sequence and nothing else. The pass moved past it, so the members it
   * could not see were not woken for that change.
   */
  readonly truncatedAt?: number;
}

/** What every wake turn's identity opens with, so one is recognisable in a mailbox. */
export const threadWakeTurnPrefix = "thread-wake";

/**
 * The turn a candidate becomes, derived so a replayed candidate is the same
 * turn: the change sequence, which is unique in the log, and the session it
 * wakes, digested so the identity is one width whatever the session's is.
 */
export function threadWakeTurn(candidate: ThreadWakeCandidate): SessionTurnId {
  const session = createHash("sha256").update(candidate.session).digest("hex");
  return asSessionTurnId(
    `${threadWakeTurnPrefix}-${String(candidate.sequence)}-${session}`,
  );
}

/** Where a page's cursor may be moved to, or nothing where the page holds nobody. */
export function threadWakeAdvanced(
  page: readonly ThreadWakeCandidate[],
  limit: number,
): { readonly sequence: number; readonly truncatedAt?: number } | undefined {
  const sequences = page.map((candidate) => candidate.sequence);
  const highest = sequences.reduce(
    (left: number | undefined, right) =>
      left === undefined || right > left ? right : left,
    undefined,
  );
  if (highest === undefined) return undefined;
  if (page.length < limit) return { sequence: highest };
  const below = sequences
    .filter((sequence) => sequence < highest)
    .reduce((left: number | undefined, right) => {
      return left === undefined || right > left ? right : left;
    }, undefined);
  return below === undefined
    ? { sequence: highest, truncatedAt: highest }
    : { sequence: below };
}

/** Refuses a page no ordering makes a prefix of the window, which is what the cursor rests on. */
function orderedPage(
  page: readonly ThreadWakeCandidate[],
  limit: number,
): readonly ThreadWakeCandidate[] {
  if (page.length > limit)
    throw new RangeError(
      `thread wake: a page of ${String(page.length)} answers a bound of ${String(limit)}`,
    );
  for (let index = 1; index < page.length; index += 1) {
    const previous = page[index - 1];
    const current = page[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.sequence < previous.sequence
    )
      throw new RangeError("thread wake: a page out of sequence order");
  }
  return page;
}

export async function threadWakePass(
  service: ThreadWakeService,
): Promise<ThreadWakeReport> {
  const limit = service.wakesPerPassMax;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError(
      `thread wake: ${String(limit)} is not a bound a pass can hold`,
    );
  const started = await service.store.cursor();
  const page = orderedPage(
    await service.store.candidates(started, limit),
    limit,
  );
  const advanced = threadWakeAdvanced(page, limit);
  if (advanced === undefined)
    return { read: 0, woken: 0, skipped: 0, cursor: started };
  let woken = 0;
  for (const candidate of page) {
    const offered = await service.store.wake({
      partition: candidate.partition,
      principal: candidate.principal,
      turn: threadWakeTurn(candidate),
      input: threadWakeText(
        threadWakeDocument({
          wake: candidate.reason,
          resource: candidate.resource,
          at: service.clock.nowIso(),
        }),
      ),
    });
    if (offered.woken === "Woken" || offered.woken === "AlreadyWoken")
      woken += 1;
  }
  const cursor = await service.store.advance(advanced.sequence);
  if (cursor < advanced.sequence)
    throw new Error(
      `thread wake: the cursor holds ${String(cursor)} after being moved to ${String(advanced.sequence)}`,
    );
  return {
    read: page.length,
    woken,
    skipped: page.length - woken,
    cursor,
    ...(advanced.truncatedAt === undefined
      ? {}
      : { truncatedAt: advanced.truncatedAt }),
  };
}
