/**
 * Every answer to `JournalStore` under the one contract, and then the promises
 * only the SQLite store is in a position to be asked for.
 *
 * WHAT IS NOT IN THE CONTRACT AND WHY. The primary key's refusal of a repeated
 * sequence number is doc 009's decision about one store rather than a promise
 * `src/interpreter/ports.ts` makes, and the stub keeps its rows in an array
 * that cannot express it; asserting it over both would be asserting a contract
 * this tree has not written. So it is stated here against the store that owes
 * it, as is durability — the stub survives no crash and is not meant to.
 *
 * THE DURABILITY CASE SPENDS A PROCESS because `append` promises the entry
 * would survive a crash, and nothing inside this process can be asked whether
 * that is true. The child is killed uncatchably after its appends resolve, so
 * what the reopened file holds is the whole of the evidence.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { journalLegalOn } from "../../src/actor/journal.ts";
import { journalStoreStub } from "../../src/adapters/journalStoreStub.ts";
import { sqliteJournal } from "../../src/adapters/sqliteJournal.ts";
import { refinementInstance } from "../actor/harness.ts";
import {
  journalStoreContract,
  journalStoreEntries,
  journalStoreLoaded,
  type JournalStoreSubject,
} from "./journalStoreContract.ts";

/** A throwaway directory for one case, since a store on disk needs a disk. */
function journalStoreTempDir(): string {
  return mkdtempSync(join(tmpdir(), "chuggy-journal-"));
}

/** The stub as a subject: its rows are an array, so an outside edit is an assignment. */
function journalStoreStubSubject(): JournalStoreSubject {
  const store = journalStoreStub();
  return {
    store,
    tamper: (seq, text) => {
      store.rows[seq - 1] = text;
    },
    close: () => undefined,
  };
}

/** The SQLite store as a subject: an outside edit is the `UPDATE` a second process would run. */
function sqliteJournalSubject(): JournalStoreSubject {
  const dir = journalStoreTempDir();
  const db = new DatabaseSync(join(dir, "journal.db"));
  const store = sqliteJournal(db);
  const update = db.prepare("UPDATE journal SET entry = ? WHERE seq = ?");
  return {
    store,
    tamper: (seq, text) => {
      update.run(text, seq);
    },
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

journalStoreContract("the stub", journalStoreStubSubject);
journalStoreContract("sqlite", sqliteJournalSubject);

test("sqlite: a connection that cannot keep a write-ahead log is refused at construction", () => {
  const db = new DatabaseSync(":memory:");
  assert.throws(() => sqliteJournal(db), /journal_mode/);
  db.close();
});

test("sqlite: a second append of a journaled seq is refused, and the stored history does not fork", async (t) => {
  const subject = sqliteJournalSubject();
  t.after(() => {
    subject.close();
  });
  const first = journalStoreEntries()[0];
  assert.ok(first !== undefined);
  await subject.store.append(first);
  const rival = { ...first, rec: { ...first.rec, label: "forked" } };
  await assert.rejects(async () => {
    await subject.store.append(rival);
  }, /UNIQUE constraint failed: journal\.seq/);
  const loaded = await journalStoreLoaded(subject.store);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.rec.label, first.rec.label);
});

/** Resolves when the child says its appends resolved, which is what puts the kill after durability. */
function sqliteJournalCrashAppended(child: ChildProcess): Promise<void> {
  const said = child.stdout;
  if (said === null) {
    return Promise.reject(
      new Error("the crash child was spawned with no stdout to hear"),
    );
  }
  return new Promise((resolve, reject) => {
    said.once("data", () => {
      resolve();
    });
    child.once("exit", (code) => {
      reject(
        new Error(
          `the crash child exited with ${String(code)} before it appended anything`,
        ),
      );
    });
  });
}

test("sqlite: entries whose appends resolved survive the process being killed", async (t) => {
  const dir = journalStoreTempDir();
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const path = join(dir, "journal.db");
  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, "sqliteJournalCrashChild.ts"), path],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await sqliteJournalCrashAppended(child);
  child.kill("SIGKILL");
  await once(child, "exit");
  assert.equal(child.signalCode, "SIGKILL");

  const db = new DatabaseSync(path);
  t.after(() => {
    db.close();
  });
  const loaded = await journalStoreLoaded(sqliteJournal(db));
  assert.deepEqual(
    loaded.map((entry) => entry.seq),
    journalStoreEntries().map((entry) => entry.seq),
  );
  assert.ok(journalLegalOn(refinementInstance, loaded));
});
