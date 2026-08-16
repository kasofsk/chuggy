/**
 * THE JOURNAL STORE PORT — the durability boundary the journaled actor decides
 * on one side of and nothing decides on the other.
 *
 * The actor is a single writer whose whole safety argument is that a decision
 * is durable BEFORE any effect of it can reach the world. This port is where
 * "durable" stops being a word: everything above it is the pure state machine
 * `model/refinement.qnt` proves, and everything below it is a store that keeps
 * bytes in order and answers for them afterwards.
 *
 * THE PORT IS DECLARED HERE, WITH ITS CONSUMER, AND IMPLEMENTED ELSEWHERE. It
 * is a contract the pure core states, not a thing the pure core reaches: a
 * `JournalStore` arrives as an argument, which is the one way a pure module may
 * hold a capability. `src/adapters/in-memory-journal-store.ts` is today's only
 * implementation and it is named after being in memory, while the port is named
 * after what it promises.
 *
 * ==========================================================================
 * WHAT IT PROMISES
 * ==========================================================================
 *
 *   DURABLE APPEND. When `append` RETURNS, the row has survived: a process that
 *   dies immediately afterwards finds it in `readAll`. This is the promise the
 *   discipline is built on — the actor emits nothing for a decision until the
 *   append has returned — so an implementation that buffers and returns early
 *   has not implemented this port, whatever its type says.
 *
 *   ORDERED APPEND. Rows are appended in sequence-number order with no gaps,
 *   starting at 1, and `append` REFUSES any row whose seq is not exactly one
 *   past the last durable row's. That refusal is not the store having an
 *   opinion about the decision — it never opens `cmd` or `rec` — it is the
 *   store keeping the one structural promise a log can keep, and it is also the
 *   fence: a SECOND writer's first append collides on a seq the log already
 *   holds, so the single-writer rule fails loudly at the durability boundary
 *   instead of silently interleaving two actors' decisions.
 *
 *   ORDERED READ. `readAll` returns every durable row, oldest first, in append
 *   order — the order the executor's cursor indexes and the order the legality
 *   fold assumes. It is total, idempotent, and unaffected by how many times it
 *   is called; it never returns a partial log, because a reader cannot tell a
 *   truncated log from a shorter one and would replay into a state that never
 *   existed.
 *
 *   IT DECIDES NOTHING. No row is rewritten, reordered, merged, compacted or
 *   dropped; nothing is derived from a row's contents. A store that skipped a
 *   row it judged redundant would be deciding, and the theorems would be
 *   proving things about a journal the store does not keep.
 *
 * ==========================================================================
 * IDEMPOTENCE, STATED HONESTLY
 * ==========================================================================
 *
 * `readAll` is idempotent. `append` IS NOT, and must not pretend to be: handed
 * a seq the log already holds, it cannot distinguish a client retrying an
 * append whose acknowledgement was lost from a second writer overwriting
 * history, and those two want opposite answers. It refuses, and the caller —
 * which knows which of the two it is — decides. The absorption the design
 * actually needs is downstream of here anyway: effects are keyed by their
 * decision's seq and the WORLD absorbs a redelivered key, which is the property
 * `refinement-invariants.ts` states and the crash-seam suite exercises.
 *
 * ==========================================================================
 * WHERE IT MAY FAIL
 * ==========================================================================
 *
 *   - `append` may fail: the medium is full or unwritable, an fsync fails, or a
 *     newer writer has fenced this one. It signals by throwing. Nothing has
 *     been emitted for that decision — that is what journal-before-effect buys
 *     — so a failed append loses a decision and nothing else, and the actor may
 *     re-decide it from a state that never moved.
 *   - A crash DURING an append may leave the tail row either present or absent,
 *     and a caller cannot know which. Both are safe, for the same reason: an
 *     absent row is a decision that never happened, and a present one is a
 *     decision whose effects the executor has simply not reached yet. What a
 *     store may never do is leave the row PARTIALLY present — a row is durable
 *     or it is not.
 *   - `readAll` may fail if the medium is unreadable. It may not fail by
 *     returning a shorter log.
 *
 * ==========================================================================
 * TWO SIGNATURE CHOICES WORTH THE ARGUMENT
 * ==========================================================================
 *
 * IT IS SYNCHRONOUS. The journal write is the single writer's critical section:
 * while an append is in flight, nothing may be decided and nothing may be
 * emitted, because both would be acting on a journal whose contents are not yet
 * settled. An asynchronous signature would express exactly the concurrency this
 * design forbids, and would put an `await` on the path the purity rule exists
 * to keep replayable. A real store implements this by blocking until the row is
 * durable, which is what the caller means.
 *
 * `readAll` RETURNS `unknown` ROWS. A durable store returns what it stored, not
 * what it was promised: the bytes outlive the process whose types described
 * them, so the reader validates (`hasEntryShape`) before believing them, and
 * `recoverFrom` is where that happens. Typing the read as `Entry[]` would be
 * typing the port to the convenience of the in-memory stub — the one
 * implementation for which it happens to be true — and the first real adapter
 * would either break the signature or lie in it.
 */

import type { Entry } from "./entry.ts";

export type JournalStore = {
  /**
   * Append one row, durably and in order. Returns once the row has survived;
   * throws if it could not be made durable, or if its seq is not exactly one
   * past the last durable row's.
   */
  append(entry: Entry): void;

  /**
   * Every durable row, oldest first. The rows are `unknown` because they
   * outlive the process that wrote them; `hasEntryShape` is the gate that turns
   * them back into `Entry`.
   */
  readAll(): readonly unknown[];

  /** How many rows are durable — the seq of the last one, since seqs are dense from 1. */
  length(): number;
};
