/**
 * The desk's own promise, against the real table: a repeated `emissionKey` is
 * the same instruction, never a second one.
 *
 * THE STUB STATES THE CONTRACT AND THIS RUNS IT. `src/adapters/deskStub.ts`
 * absorbs against a map, which cannot fail the way a store can; the store's
 * primary key is what has to hold here, and a second delivery that inserted a
 * row would be the double instruction the port forbids.
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { deskEvents } from "../../src/adapters/deskEvents.ts";
import { allEffects } from "../../src/domain/effect.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  emissionKey,
  type DeskPort,
  type Emission,
} from "../../src/interpreter/ports.ts";
import type { DeskLog } from "../../src/interpreter/registry.ts";

/** A fresh desk over a database that lives only as long as the case does. */
function deskSubject(t: {
  after: (close: () => void) => void;
}): DeskPort & DeskLog {
  const database = new DatabaseSync(":memory:");
  t.after(() => {
    database.close();
  });
  return deskEvents(database);
}

/** One emission, at the decision and effect position a case names. */
function emissionAt(
  seq: number,
  effectIndex: number,
  ticket: number,
): Emission {
  return { seq, effectIndex, ticket: asTicketId(ticket) };
}

test("each of the four instructions lands under its own emission key", async (t) => {
  const desk = deskSubject(t);
  await desk.createDraft(emissionAt(1, 0, 1));
  await desk.revoke(emissionAt(2, 0, 1));
  await desk.openHumanTask(emissionAt(3, 0, 1));
  await desk.complete(emissionAt(4, 0, 1));
  const events = await desk.eventsFor(asTicketId(1));
  assert.deepEqual(
    events.map((event) => event.effect),
    ["CreateDraft", "Revoke", "OpenHumanTask", "Complete"],
  );
  assert.deepEqual(
    events.map((event) => event.key),
    ["1:0", "2:0", "3:0", "4:0"],
  );
});

test("every effect the desk stores reads back as the constructor it was", async (t) => {
  const desk = deskSubject(t);
  await desk.createDraft(emissionAt(1, 0, 1));
  const stored = (await desk.eventsFor(asTicketId(1))).at(0);
  assert.ok(stored !== undefined);
  assert.ok(allEffects.includes(stored.effect));
  assert.equal(stored.ticket, asTicketId(1));
});

test("a second delivery of a stored emission changes nothing", async (t) => {
  const desk = deskSubject(t);
  const emission = emissionAt(7, 1, 2);
  await desk.openHumanTask(emission);
  await desk.openHumanTask(emission);
  const events = await desk.eventsFor(asTicketId(2));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.key, emissionKey(emission));
});

test("a re-delivery lands on the row it already holds and does not move it", async (t) => {
  const desk = deskSubject(t);
  const first = emissionAt(1, 0, 1);
  await desk.createDraft(first);
  await desk.openHumanTask(emissionAt(2, 0, 1));
  await desk.createDraft(first);
  assert.deepEqual(
    (await desk.eventsFor(asTicketId(1))).map((event) => event.key),
    ["1:0", "2:0"],
  );
});

test("one ticket's log carries nothing another ticket was told", async (t) => {
  const desk = deskSubject(t);
  await desk.createDraft(emissionAt(1, 0, 1));
  await desk.createDraft(emissionAt(2, 0, 2));
  assert.deepEqual(
    (await desk.eventsFor(asTicketId(2))).map((event) => event.key),
    ["2:0"],
  );
  assert.equal((await desk.eventsFor(asTicketId(3))).length, 0);
});
