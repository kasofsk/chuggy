/**
 * The recording world's own promises, asked of it directly rather than through
 * a walk.
 *
 * THE ONE THAT MATTERS IS ABSORPTION, and it has two halves that pull opposite
 * ways: a re-emitted ROW must be absorbed whole, and a row's own repeated
 * effects must not absorb against each other. The cases below drive both from
 * the port side, where a walk can only reach them by arranging a crash.
 *
 * The rest are refusals — the shapes a correct executor cannot produce, refused
 * here because this is the last place a scrambled row is cheap to catch.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Effect } from "../effects/effect.ts";
import type { StepRecord } from "../domain/measure.ts";
import type { Delivery } from "../interp/ports.ts";
import { createRecordingWorld } from "./recording-world.ts";

/** The revoke cascade's record: one seq, three effects, two of them identical. */
const cascade: StepRecord = {
  label: "ticket-revoked",
  transitions: [
    { ticket: 1, from: "PWorking", to: "PRevoked" },
    { ticket: 2, from: "PDraft", to: "PEscalated" },
    { ticket: 3, from: "PDraft", to: "PEscalated" },
  ],
  effects: ["Revoke", "OpenHumanTask", "OpenHumanTask"],
  landing: { tag: "WONone" },
};

/** An arrival's record: one effect, and no transition to attribute it to. */
const arrival: StepRecord = {
  label: "ticket-arrived",
  transitions: [],
  effects: ["CreateDraft"],
  landing: { tag: "WONone" },
};

function delivery(
  seq: number,
  ordinal: number,
  effect: Effect,
  rec: StepRecord,
): Delivery {
  return { seq, ordinal, effect, rec };
}

/** The cascade's three deliveries, as the interpreter builds them. */
const revoked = delivery(8, 0, "Revoke", cascade);
const parkedFirst = delivery(8, 1, "OpenHumanTask", cascade);
const parkedSecond = delivery(8, 2, "OpenHumanTask", cascade);

test("a row's repeated effects are recorded once each, not collapsed", () => {
  const world = createRecordingWorld();
  world.ports.fabric.cancel(revoked);
  world.ports.desk.openTask(parkedFirst);
  world.ports.desk.openTask(parkedSecond);
  assert.deepEqual(
    world.ledger().map((entry) => [entry.call, entry.ordinal]),
    [
      ["cancel", 0],
      ["openTask", 1],
      ["openTask", 2],
    ],
  );
});

test("a re-emitted row is absorbed whole, however many times it arrives", () => {
  const world = createRecordingWorld();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    world.ports.fabric.cancel(revoked);
    world.ports.desk.openTask(parkedFirst);
    world.ports.desk.openTask(parkedSecond);
  }
  assert.equal(world.ledger().length, 3);
  assert.equal(world.recorded("cancel").length, 1);
  assert.equal(world.recorded("openTask").length, 2);
});

test("the same effect under a different decision is a different thing to do", () => {
  const world = createRecordingWorld();
  world.ports.authoring.createDraft(delivery(1, 0, "CreateDraft", arrival));
  world.ports.authoring.createDraft(delivery(2, 0, "CreateDraft", arrival));
  assert.deepEqual(
    world.recorded("createDraft").map((entry) => entry.seq),
    [1, 2],
  );
});

test("the ledger records the decision's subject, and none where there is none", () => {
  const world = createRecordingWorld();
  world.ports.authoring.createDraft(delivery(1, 0, "CreateDraft", arrival));
  world.ports.fabric.cancel(revoked);
  assert.deepEqual(
    world.ledger().map((entry) => entry.ticket),
    [undefined, 1],
  );
});

// === The refusals ==========================================================

test("a key that comes back carrying a different effect is refused", () => {
  // The row itself has been REWRITTEN between emissions — same seq, same
  // ordinal, a different effect sitting there. Nothing downstream could detect
  // it, and the ledger would become a record of something that never happened.
  const rewritten: StepRecord = {
    ...cascade,
    effects: ["OpenHumanTask", "Revoke", "OpenHumanTask"],
  };
  const world = createRecordingWorld();
  world.ports.desk.openTask(parkedFirst);
  assert.throws(
    () => {
      world.ports.fabric.cancel(delivery(8, 1, "Revoke", rewritten));
    },
    {
      name: "AssertionError",
      message: /key 8:1 was openTask\/OpenHumanTask and has come back/,
    },
  );
});

test("a delivery whose record does not hold that effect there is refused", () => {
  const world = createRecordingWorld();
  assert.throws(
    () => {
      world.ports.fabric.cancel(delivery(8, 2, "Revoke", cascade));
    },
    {
      name: "AssertionError",
      message:
        /ordinal 2 was delivered as Revoke, which is not what its record holds/,
    },
  );
});

test("a delivery past the end of its record's list is refused", () => {
  const world = createRecordingWorld();
  assert.throws(
    () => {
      world.ports.desk.openTask(delivery(8, 3, "OpenHumanTask", cascade));
    },
    { name: "AssertionError" },
  );
});

test("an ordinal that is not a count is refused", () => {
  const world = createRecordingWorld();
  assert.throws(
    () => {
      world.ports.fabric.cancel(delivery(8, -1, "Revoke", cascade));
    },
    {
      name: "AssertionError",
      message: /ordinal is a non-negative safe integer, got -1/,
    },
  );
});

test("the ledger is a copy, so a reader cannot rewrite what the world was asked", () => {
  const world = createRecordingWorld();
  world.ports.authoring.createDraft(delivery(1, 0, "CreateDraft", arrival));
  const held = world.ledger();
  (held as { length: number }).length = 0;
  assert.equal(world.ledger().length, 1);
});
