/**
 * The journal store, in memory, keeping its rows as the wire text a real store
 * would keep.
 *
 * THE TEXT IS THE POINT. A stub that handed back the object it was given would
 * make the parse at the boundary a decoration that never once refused anything;
 * keeping bytes means every read goes through the schema, and a row edited
 * behind the executor's back arrives exactly as a tampered journal does. The
 * bytes come from `encodeEntry` rather than from a serializer written here,
 * because an arrival's deps are a set in the domain and an array on the wire,
 * and `JSON.stringify` writes a set as an empty object without complaining.
 *
 * The cursor is held beside the rows and is deliberately not written with them:
 * a checkpoint that is lost is the cursor regression the model draws
 * nondeterministically, and it is what makes re-emission real rather than
 * hypothetical.
 */

import type { Entry } from "../actor/journal.ts";
import type { JournalStore } from "../interpreter/ports.ts";
import { encodeEntry, parseJournal, type Parsed } from "../interpreter/wire.ts";

/** The store with its rows exposed, so a suite can read what was written and tamper with it. */
export interface JournalStoreStub extends JournalStore {
  readonly rows: string[];
}

/** Reads the stored text back, refusing a row that is not JSON before the schema is ever asked. */
function journalStoreStubRead(
  rows: readonly string[],
): Parsed<readonly Entry[]> {
  const raw: unknown[] = [];
  for (const row of rows) {
    try {
      const value: unknown = JSON.parse(row);
      raw.push(value);
    } catch {
      return { parsed: "Refused", why: `a stored row is not JSON: ${row}` };
    }
  }
  return parseJournal(raw);
}

/** A fresh store: no rows, and a cursor at the zero no checkpoint has moved. */
export function journalStoreStub(): JournalStoreStub {
  const rows: string[] = [];
  let cursor = 0;
  return {
    rows,
    append: (entry) => {
      rows.push(encodeEntry(entry));
      return Promise.resolve();
    },
    load: () => Promise.resolve(journalStoreStubRead(rows)),
    loadCursor: () => Promise.resolve(cursor),
    saveCursor: (applied) => {
      cursor = applied;
      return Promise.resolve();
    },
  };
}
