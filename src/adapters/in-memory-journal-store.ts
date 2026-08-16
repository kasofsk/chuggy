/**
 * The `JournalStore` port's in-memory implementation: an append-only array that
 * keeps every promise the port makes except the one it cannot — surviving the
 * process.
 *
 * IT IS A STUB AND IT IS REAL CODE. What it stands in for is durability, and
 * nothing else: the ordering promise, the append fence, the total ordered read
 * and the refusal to look inside a row are all kept here exactly as a real
 * store must keep them, so a suite that passes against this one is exercising
 * the contract rather than the stand-in. The one promise it cannot keep is
 * stated where the process is: a crash-seam test crashes the ACTOR, not the
 * host, and this store is what survives that crash — which is precisely the
 * separation the port exists to name.
 *
 * IT DECIDES NOTHING, and every line below is arranged to keep that true. It
 * INTERPRETS neither `cmd` nor `rec`: it asks whether the row is a row — the
 * port's shape promise, which every implementation owes — and it reads `seq`,
 * to keep its own append order. It never asks whether the decision was enabled,
 * whether the record is the one a decider would have produced, or whether the
 * row is redundant; those are `journalLegalOn`'s questions, and `recoverFrom`
 * asks them one layer up. It drops nothing, merges nothing, reorders nothing
 * and derives nothing. The two things it refuses — a row that is not a row, and
 * a row whose seq is not the next one — are the promises `JournalStore`
 * documents, the second of which is also the fence that makes a second writer
 * loud.
 *
 * IT HOLDS NO CLOCK AND NO AMBIENT CAPABILITY. Nothing here reads time,
 * randomness, the filesystem or the process; a row is stored as it arrived and
 * handed back as it was stored, so replaying against this store twice gives the
 * same answer twice. That is not the purity rule reaching into `src/adapters/`
 * — it does not — it is what makes this store usable in the deterministic runs
 * that prove recovery.
 *
 * WHY THE READ COPIES, AND WHY ALL THE WAY DOWN. `readAll` returns a fresh
 * DEEP copy every time. The log is append-only, and a caller holding a live
 * reference into it could splice a row out — or, one level in and just as
 * fatally, retag a `cmd` or edit a `rec` — without going through `append`,
 * which is the "durable log rewritten behind the actor's back" failure the
 * theorems have no answer for. A one-level copy stops the first and not the
 * second, so it stops nothing that matters. `structuredClone` is what a real
 * store gets for free by deserializing, and it costs a walk of a log that store
 * would be paging in from disk anyway.
 */

import { invariant } from "../domain/assert.ts";
import { hasEntryShape, type Entry } from "../spine/entry.ts";
import type { JournalStore } from "../spine/journal-store.ts";

/**
 * A fresh, empty in-memory journal.
 *
 * A factory rather than a class, and the reason is the closure rather than a
 * count: `rows` is unreachable except through the two methods that keep the
 * promises, which is the encapsulation a private field would buy and one fewer
 * thing to construct. The tree does declare classes where a class is the right
 * shape — `CoverageBuilder` is a mutable accumulator, and three error types
 * extend `Error` because that is how a `catch` discriminates — so "nothing else
 * in `src/` declares one" was never true and is not the argument.
 */
export function createInMemoryJournalStore(): JournalStore {
  const rows: Entry[] = [];

  return {
    append(entry: Entry): void {
      // The argument is asserted rather than trusted, which is the bar's rule
      // for domain-adjacent code and is doubly right at a durability boundary:
      // this is the last moment a malformed row can be refused cheaply. After
      // it, the row is what some later process replays, and the schema's gate
      // would be reporting a defect one crash too late.
      invariant(
        hasEntryShape(entry),
        "journal store: this is not a journal row",
      );
      invariant(
        entry.seq === rows.length + 1,
        `journal store: append is ordered and dense — expected seq ${String(rows.length + 1)}, got ${String(entry.seq)}`,
      );
      rows.push(entry);
    },

    readAll(): readonly unknown[] {
      return structuredClone(rows);
    },

    length(): number {
      return rows.length;
    },
  };
}
