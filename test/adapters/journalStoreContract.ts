/**
 * The part of the `JournalStore` contract every answer can keep, as cases run
 * against each of them rather than against one. Durability and the key's
 * refusal are not here, and `test/adapters/journalStore.test.ts` says why.
 *
 * WHAT A SUBJECT ADDS TO THE PORT IS TAMPERING, and it is why this file is
 * parameterized over a subject instead of over a store. The port's promise is
 * that a load passes the parse, and the only way to read that promise is to
 * edit stored text the way something outside the process would — an array
 * element for the stub, an `UPDATE` for a real table — so the edit is the
 * subject's and the assertion is the contract's.
 *
 * THE FIXTURE IS A JOURNAL THE MACHINE COULD HAVE TAKEN, so a round trip can be
 * asserted with `journalLegalOn` rather than with a deep equality that would
 * pass on rows in any order. It is the shortest run with more than one entry,
 * because sequence order is a thing a single row cannot show.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { jArrive, jRelease } from "../../src/actor/command.ts";
import { journalLegalOn, type Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import { asProjectId } from "../../src/domain/ids.ts";
import { wNone } from "../../src/domain/wrapUp.ts";
import type { JournalStore } from "../../src/interpreter/ports.ts";
import { flatProgram, refinementInstance } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

/** One answer to the port, with the two things a case needs beyond it: an outside edit, and a release. */
export interface JournalStoreSubject {
  readonly store: JournalStore;
  tamper(seq: number, text: string): void;
  close(): void;
}

/** A fresh subject, so no case inherits another's rows. */
export type JournalStoreOpen = () => JournalStoreSubject;

/** The fixture journal: an arrival and its release, which is a history `journalLegalOn` accepts. */
export function journalStoreEntries(): readonly Entry[] {
  const arrived = journalStep(
    refinementInstance,
    actorInit(),
    jArrive([], flatProgram, asProjectId(1), wNone),
  );
  return journalStep(refinementInstance, arrived, jRelease(id(1))).journal;
}

/** Appends the whole fixture, in the order the actor journaled it. */
async function journalStoreAppend(store: JournalStore): Promise<void> {
  for (const entry of journalStoreEntries()) {
    await store.append(entry);
  }
}

/** The loaded journal, or a failure naming the refusal, so a case reads as one assertion. */
export async function journalStoreLoaded(
  store: JournalStore,
): Promise<readonly Entry[]> {
  const loaded = await store.load();
  assert.equal(
    loaded.parsed,
    "Ok",
    loaded.parsed === "Refused" ? loaded.why : "",
  );
  assert.ok(loaded.parsed === "Ok");
  return loaded.value;
}

/** That the store refused the whole journal, and said which part of a row it could not read. */
async function journalStoreRefusal(
  store: JournalStore,
  why: RegExp,
): Promise<void> {
  const loaded = await store.load();
  assert.equal(loaded.parsed, "Refused");
  assert.ok(loaded.parsed === "Refused");
  assert.match(loaded.why, why);
}

/** The rows half: what a load returns, and what it refuses to return. */
function journalStoreRowContract(name: string, open: JournalStoreOpen): void {
  test(`${name}: a store nothing was appended to loads an empty journal`, async (t) => {
    const subject = open();
    t.after(() => {
      subject.close();
    });
    assert.deepEqual(await journalStoreLoaded(subject.store), []);
  });

  test(`${name}: what was appended reads back in sequence order, as a run this machine could have taken`, async (t) => {
    const subject = open();
    t.after(() => {
      subject.close();
    });
    await journalStoreAppend(subject.store);
    const loaded = await journalStoreLoaded(subject.store);
    assert.deepEqual(
      loaded.map((entry) => entry.seq),
      journalStoreEntries().map((entry) => entry.seq),
    );
    assert.ok(journalLegalOn(refinementInstance, loaded));
  });

  test(`${name}: a stored row edited into a shape the machine does not write is refused`, async (t) => {
    const subject = open();
    t.after(() => {
      subject.close();
    });
    await journalStoreAppend(subject.store);
    const first = journalStoreEntries()[0];
    assert.ok(first !== undefined);
    subject.tamper(
      first.seq,
      JSON.stringify({ ...first, rec: { ...first.rec, effects: ["Deploy"] } }),
    );
    await journalStoreRefusal(subject.store, /effects/);
  });

  test(`${name}: a stored row that is not JSON is refused before the schema is asked`, async (t) => {
    const subject = open();
    t.after(() => {
      subject.close();
    });
    await journalStoreAppend(subject.store);
    subject.tamper(1, "{ not json");
    await journalStoreRefusal(subject.store, /not JSON/);
  });
}

/** The cursor half: a checkpoint that was never written, and one that replaces another. */
function journalStoreCursorContract(
  name: string,
  open: JournalStoreOpen,
): void {
  test(`${name}: a cursor no checkpoint ever moved reads as zero`, async (t) => {
    const subject = open();
    t.after(() => {
      subject.close();
    });
    assert.equal(await subject.store.loadCursor(), 0);
  });

  test(`${name}: the last checkpoint saved is the one that reads back`, async (t) => {
    const subject = open();
    t.after(() => {
      subject.close();
    });
    await journalStoreAppend(subject.store);
    await subject.store.saveCursor(1);
    assert.equal(await subject.store.loadCursor(), 1);
    await subject.store.saveCursor(2);
    assert.equal(await subject.store.loadCursor(), 2);
    assert.equal(
      (await journalStoreLoaded(subject.store)).length,
      journalStoreEntries().length,
    );
  });
}

/** The port's promises that a store in memory can also keep, against one answer to it. */
export function journalStoreContract(
  name: string,
  open: JournalStoreOpen,
): void {
  journalStoreRowContract(name, open);
  journalStoreCursorContract(name, open);
}
