/**
 * The child of the durability case: it appends the contract's journal to the
 * database it is handed, prints one line to say the appends resolved, and then
 * waits to be killed.
 *
 * IT NEVER CLOSES THE DATABASE. A clean close checkpoints the write-ahead log
 * into the main file, which would demonstrate that a shutdown is durable rather
 * than that an append is — and the append is the promise the port makes. The
 * timer is the bound on a child whose parent never got round to killing it.
 */

import { DatabaseSync } from "node:sqlite";

import { sqliteJournal } from "../../src/adapters/sqliteJournal.ts";
import { journalStoreEntries } from "./journalStoreContract.ts";

/** How long an unkilled child waits before giving up on its parent. */
const sqliteJournalCrashChildWaitMs = 30_000;

const path = process.argv[2];
if (path === undefined) {
  throw new Error("sqliteJournalCrashChild: no database path was passed");
}

const store = sqliteJournal(new DatabaseSync(path));
for (const entry of journalStoreEntries()) {
  await store.append(entry);
}
process.stdout.write("appended\n");

setTimeout(() => {
  process.exit(1);
}, sqliteJournalCrashChildWaitMs);
