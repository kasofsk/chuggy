/**
 * The journal store's PROMISES, one test each — the port's documentation held
 * to by a suite rather than by a reader.
 *
 * A STUB'S TEST IS A CONTRACT'S TEST. Everything here would be as true of a
 * store that wrote to a disk, which is the point: what is checked is durable
 * ordered append, ordered read, the append fence, and the refusal to have an
 * opinion about a row's contents. The one promise not checked is the one this
 * implementation cannot make — surviving the process — and the crash-seam suite
 * is where that promise's CONSUMER is exercised instead, by crashing the actor
 * and rebuilding it from a store that outlived it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../domain/assert.ts";
import type { Entry } from "../spine/entry.ts";
import { e1, e2, e3, goodJ } from "../spine/refinement-fixtures.test.ts";
import { createInMemoryJournalStore } from "./in-memory-journal-store.ts";

test("append then read: every row, oldest first, exactly as it was appended", () => {
  const store = createInMemoryJournalStore();
  assert.deepEqual(store.readAll(), []);
  assert.equal(store.length(), 0);

  for (const entry of goodJ) {
    store.append(entry);
  }
  assert.equal(store.length(), 3);
  assert.deepEqual(store.readAll(), [e1, e2, e3]);
  // Ordered read is idempotent: asking twice answers the same, and asking does
  // not consume.
  assert.deepEqual(store.readAll(), store.readAll());
});

test("the append fence: a seq that is not the next one is refused", () => {
  const store = createInMemoryJournalStore();
  // A gap. The log would then have no row at seq 1, and a replay would start
  // from a decision that has no predecessor.
  assert.throws(() => {
    store.append(e2);
  }, AssertionError);
  assert.equal(store.length(), 0);

  store.append(e1);
  // A DUPLICATE seq is the second writer's signature, and the store cannot tell
  // it from a retried append whose acknowledgement was lost. It refuses and
  // lets the caller — which knows which of the two it is — decide.
  assert.throws(() => {
    store.append(e1);
  }, AssertionError);
  assert.throws(() => {
    store.append(e3);
  }, AssertionError);
  assert.equal(store.length(), 1);

  store.append(e2);
  assert.deepEqual(store.readAll(), [e1, e2]);
});

test("a refused append leaves the log exactly as it was", () => {
  const store = createInMemoryJournalStore();
  store.append(e1);
  const before = store.readAll();
  assert.throws(() => {
    store.append({ ...e2, seq: 7 });
  }, AssertionError);
  assert.deepEqual(store.readAll(), before);
  assert.equal(store.length(), 1);
});

test("a row that is not a journal row never becomes durable", () => {
  const store = createInMemoryJournalStore();
  // The cast is the point of the test: a real store is handed rows across a
  // boundary the compiler does not police — from a decoder, from another
  // process's bytes — and this is the last moment one can be refused cheaply.
  assert.throws(() => {
    store.append({
      seq: 1,
      cmd: { tag: "JNope" },
      rec: e1.rec,
    } as unknown as Entry);
  }, AssertionError);
  assert.throws(() => {
    store.append({ seq: 1, cmd: e1.cmd } as unknown as Entry);
  }, AssertionError);
  assert.equal(store.length(), 0);
});

test("the read is a copy ALL THE WAY DOWN: the log cannot be rewritten behind the actor's back", () => {
  const store = createInMemoryJournalStore();
  // Rows this test OWNS. Appending the shared fixtures would make the
  // comparison below vacuous the moment the copy leaked: the mutation would
  // land on the fixture and on the log at once, and both sides of the equality
  // would move together.
  const own = structuredClone([e1, e2]);
  for (const row of own) {
    store.append(row);
  }
  const expected = structuredClone(store.readAll());

  // The array, spliced.
  const rows = store.readAll() as unknown[];
  rows.pop();
  rows.push({ seq: 3, cmd: e3.cmd, rec: e3.rec });

  // ...and the rows themselves, edited one and two levels in — which a
  // one-level copy would have let straight through to the durable log.
  const inner = store.readAll() as {
    seq: number;
    cmd: { deps?: Set<number> };
    rec: { label: string };
  }[];
  const first = inner[0];
  assert.ok(first !== undefined);
  first.seq = 99;
  first.rec.label = "ticket-done";
  first.cmd.deps?.add(7);

  // An append-only log that a caller could splice is not append-only, and the
  // theorems have no answer for a journal that changed under them.
  assert.deepEqual(store.readAll(), expected);
  assert.equal(store.length(), 2);
});

test("the store decides nothing: an ILLEGAL row is stored verbatim, because legality is not its question", () => {
  const store = createInMemoryJournalStore();
  // A well-shaped row recording a decision no state could have enabled, with a
  // record no decider would have produced. `journalLegalOn` is what refuses it,
  // and `recoverFrom` is where that refusal happens — one layer above here.
  const illegal: Entry = {
    seq: 1,
    cmd: { tag: "JDispatch", ticket: 4 },
    rec: e3.rec,
  };
  store.append(illegal);
  // Stored, and handed back unchanged: a store that had refused this would be
  // deciding, and a store that had "fixed" it would be deciding louder.
  assert.deepEqual(store.readAll(), [illegal]);
  // Deterministic in the only sense a store can be: the same rows in the same
  // order are the same log, with nothing of its own added.
  const twin = createInMemoryJournalStore();
  twin.append(illegal);
  assert.deepEqual(twin.readAll(), store.readAll());
});
