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
 * never reads `cmd` or `rec`; the only field it looks at is `seq`, and only to
 * check its own append order. It drops nothing, merges nothing, reorders
 * nothing and derives nothing. The one thing it refuses — a row whose seq is
 * not the next one — is not a judgment about the decision, it is the promise
 * `JournalStore` documents, and it is the fence that makes a second writer
 * loud.
 *
 * IT HOLDS NO CLOCK AND NO AMBIENT CAPABILITY. Nothing here reads time,
 * randomness, the filesystem or the process; a row is stored as it arrived and
 * handed back as it was stored, so replaying against this store twice gives the
 * same answer twice. That is not the purity rule reaching into `src/adapters/`
 * — it does not — it is what makes this store usable in the deterministic runs
 * that prove recovery.
 *
 * WHY THE READ COPIES. `readAll` returns a fresh array every time. The log is
 * append-only, and a caller holding a live reference to the backing array could
 * splice a row out of the journal without going through `append` — which is
 * exactly the "durable log rewritten behind the actor's back" failure the
 * theorems have no answer for. A copy costs a walk of a log that a real store
 * would be paging in from disk anyway.
 */

import { invariant } from "../domain/assert.ts";
import { hasEntryShape, type Entry } from "../spine/entry.ts";
import type { JournalStore } from "../spine/journal-store.ts";

/**
 * A fresh, empty in-memory journal.
 *
 * A factory rather than a class, on the tree's own precedent: nothing else in
 * `src/` declares one, and the closure gives the log the encapsulation a
 * private field would — `rows` is unreachable except through the two methods
 * that keep the promises.
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
      return [...rows];
    },

    length(): number {
      return rows.length;
    },
  };
}
