/**
 * The journal store over SQLite: one row per decision, keyed by the decision's
 * own sequence number, with the executor cursor in a table beside it.
 *
 * THE PRIMARY KEY IS THE SEQUENCE NUMBER, which carries the dedup memory past
 * the process and makes Single writer structural outside it: a rollout briefly
 * running two dispatchers has the loser crash on the constraint rather than
 * fork history. It is a second line of defense, never the first — nothing here
 * decides who may write.
 *
 * ROWS ARE WIRE TEXT AND EVERY LOAD PASSES THE PARSE, exactly as the stub keeps
 * them. The store is on disk and the disk is outside this process's control, so
 * a row edited behind the executor's back arrives as a tampered journal and is
 * refused by returning, never trusted and never thrown on.
 *
 * THE CURSOR IS BESIDE THE ROWS AND DELIBERATELY NOT WITH THEM: a checkpoint
 * lost to a crash re-emits its suffix, which is the regression the model draws
 * and the ports promise absorption for. It is the one table that is overwritten
 * rather than appended to, and it holds one row by construction.
 *
 * DURABILITY IS THE CONNECTION'S, so the constructor sets it and then reads it
 * back. Write-ahead mode with a full sync is the whole of what makes `append`
 * resolve only once the entry would survive a crash; a connection that did not
 * take both cannot keep that promise, and a store that cannot keep it is a
 * start-up failure rather than a slower one.
 */

import type { DatabaseSync, StatementSync } from "node:sqlite";

import type { Entry } from "../actor/journal.ts";
import type { JournalStore } from "../interpreter/ports.ts";
import { parseJournal, type Parsed } from "../interpreter/wire.ts";

/** The two tables this adapter creates and solely owns; the cursor's check is what keeps it a single row. */
const sqliteJournalSchema = `
  CREATE TABLE IF NOT EXISTS journal (
    seq INTEGER PRIMARY KEY,
    entry TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS cursor (
    onlyRow INTEGER PRIMARY KEY CHECK (onlyRow = 1),
    applied INTEGER NOT NULL
  ) STRICT;
`;

/** What `PRAGMA synchronous` reads back once FULL has taken, since the pragma answers in its own numbering. */
const sqliteJournalSynchronousFull = 2;

/** Sets the durability `append`'s promise rests on, and refuses a connection that did not take it. */
function sqliteJournalDurable(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  const mode = db.prepare("PRAGMA journal_mode").get()?.["journal_mode"];
  const synchronous = db.prepare("PRAGMA synchronous").get()?.["synchronous"];
  if (mode !== "wal" || Number(synchronous) !== sqliteJournalSynchronousFull) {
    throw new Error(
      `sqliteJournal: the connection kept journal_mode ${String(mode)} and synchronous ${String(synchronous)}, so an entry that resolved would not be durable`,
    );
  }
}

/** Reads the stored text back, refusing a row that is not JSON before the schema is ever asked; a column some other writer left untyped coerces here and is refused by one of those two. */
function sqliteJournalRead(select: StatementSync): Parsed<readonly Entry[]> {
  const raw: unknown[] = [];
  for (const row of select.all()) {
    const text = String(row["entry"]);
    try {
      raw.push(JSON.parse(text) as unknown);
    } catch {
      return { parsed: "Refused", why: `a stored row is not JSON: ${text}` };
    }
  }
  return parseJournal(raw);
}

/** The checkpoint the cursor row holds, or zero when no row was ever written; what a checkpoint may be is `recover`'s. */
function sqliteJournalCursor(select: StatementSync): number {
  const applied = select.get()?.["applied"];
  return applied === undefined ? 0 : Number(applied);
}

/** The store over an open connection, whose two tables it creates here and owns alone. */
export function sqliteJournal(db: DatabaseSync): JournalStore {
  sqliteJournalDurable(db);
  db.exec(sqliteJournalSchema);
  const insert = db.prepare("INSERT INTO journal (seq, entry) VALUES (?, ?)");
  const selectEntries = db.prepare("SELECT entry FROM journal ORDER BY seq");
  const selectCursor = db.prepare("SELECT applied FROM cursor");
  const upsertCursor = db.prepare(
    "INSERT INTO cursor (onlyRow, applied) VALUES (1, ?) ON CONFLICT (onlyRow) DO UPDATE SET applied = excluded.applied",
  );
  return {
    append: (entry) => {
      insert.run(entry.seq, JSON.stringify(entry));
      return Promise.resolve();
    },
    load: () => Promise.resolve(sqliteJournalRead(selectEntries)),
    loadCursor: () => Promise.resolve(sqliteJournalCursor(selectCursor)),
    saveCursor: (applied) => {
      upsertCursor.run(applied);
      return Promise.resolve();
    },
  };
}
