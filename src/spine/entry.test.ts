/**
 * The journal row's SCHEMA, its derivation, and the gate that turns a row read
 * back from a store into an `Entry`.
 *
 * THE THREE CLAIMS THIS FILE MAKES:
 *
 *   1. THE STATIC TYPE IS THE SCHEMA'S. Checked at COMPILE time, because that
 *      is where a derivation lives: `derivationIsExact` below is a type-level
 *      equality between `Entry` and the model's row, and it stops compiling the
 *      moment the schema and the row disagree in either direction.
 *   2. THE GATE ACCEPTS EVERY ROW THE MACHINE CAN WRITE. The `Cmd` fixtures are
 *      a `Record<CmdTag, Cmd>`, so the compiler requires one per constructor —
 *      the whole domain, not a sample — and each is typed `Cmd`, so a field
 *      this file spelled wrong would fail to compile rather than quietly test
 *      the gate against a shape the machine never produces.
 *   3. THE GATE REFUSES, FIELD BY FIELD, AND NEVER THROWS. Every mutation below
 *      starts from a row the gate accepts and breaks exactly one thing, so what
 *      the refusal is attributable to is not in question. `undefined` is the
 *      answer for garbage as much as for a near-miss, because the caller is a
 *      process recovering from a crash and an exception raised while deciding
 *      whether the log is readable is the failure being guarded against.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { StepRecord } from "../domain/measure.ts";
import type { Cmd, CmdTag } from "./cmd.ts";
import {
  entryFieldNames,
  entrySchema,
  hasEntryShape,
  type Entry,
} from "./entry.ts";
import { d1, progFlat, wx1 } from "./refinement-fixtures.test.ts";

/** The model's `type Entry = { seq: int, cmd: Cmd, rec: StepRecord }`. */
type ModelRow = {
  readonly seq: number;
  readonly cmd: Cmd;
  readonly rec: StepRecord;
};

type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

/**
 * THE DERIVATION, checked by the compiler. This constant is `true` only while
 * the type derived from `entrySchema` and the model's row are each other; a
 * field added to the schema, a field kind pointed at the wrong type, or a row
 * type written out by hand beside the schema all make it `false`, which is a
 * type error rather than a test that has to be run.
 */
const derivationIsExact: MutuallyAssignable<Entry, ModelRow> = true;

/**
 * One `Cmd` per constructor. A `Record<CmdTag, Cmd>` on purpose: the compiler
 * requires an entry for every arm of the vocabulary, so this roster cannot fall
 * behind `cmd.ts` the way a hand-listed array would.
 */
const oneOfEach: Readonly<Record<CmdTag, Cmd>> = {
  JArrive: {
    tag: "JArrive",
    deps: new Set([1]),
    program: progFlat,
    project: 1,
    wrapUp: wx1,
  },
  JRelease: { tag: "JRelease", ticket: 1 },
  JRevoke: { tag: "JRevoke", ticket: 2 },
  JDispatch: { tag: "JDispatch", ticket: 1 },
  JTaskDone: { tag: "JTaskDone", ticket: 1, tid: 2, verdict: "VFail" },
  JWorkReduce: { tag: "JWorkReduce", ticket: 1 },
  JEvalReduce: { tag: "JEvalReduce", ticket: 1 },
  JDequeue: { tag: "JDequeue", ticket: 1, moved: true },
  JGateResolve: { tag: "JGateResolve", ticket: 1, out: "WFailed" },
  JCompleteDuplicate: { tag: "JCompleteDuplicate", ticket: 1 },
  JRevalFail: { tag: "JRevalFail", ticket: 1 },
  JOpRetry: { tag: "JOpRetry", ticket: 1 },
};

/** A row the gate accepts: the honest arrival row, at seq 1. */
const honest: Entry = { seq: 1, cmd: oneOfEach.JArrive, rec: d1.rec };

/** A row with one field replaced by anything at all. */
function rowWith(field: string, value: unknown): unknown {
  return { ...honest, [field]: value };
}

test("entrySchema: the row is the model's, field for field and in its order", () => {
  assert.deepEqual(entryFieldNames, ["seq", "cmd", "rec"]);
  assert.equal(entrySchema.row, "chuggy.journal.entry");
  assert.equal(entrySchema.version, 1);
  // The derivation is a compile-time fact; naming it at run time is what keeps
  // an unused-constant rule from deleting the check.
  assert.equal(derivationIsExact, true);
});

test("hasEntryShape: accepts a row carrying any decision the vocabulary has", () => {
  const tags = Object.keys(oneOfEach) as CmdTag[];
  assert.equal(tags.length, 12);
  for (const tag of tags) {
    assert.ok(
      hasEntryShape({ seq: 1, cmd: oneOfEach[tag], rec: d1.rec }),
      `refused a well-formed ${tag} row`,
    );
  }
});

test("hasEntryShape: a value that is not a row at all is refused, not thrown at", () => {
  for (const value of [
    undefined,
    null,
    1,
    "seq",
    [],
    new Map(),
    Object.create(null) as unknown,
  ]) {
    assert.equal(hasEntryShape(value), false);
  }
});

test("hasEntryShape: the field set is exact in both directions", () => {
  const { seq, cmd, rec } = honest;
  assert.equal(hasEntryShape({ seq, cmd }), false, "a missing rec");
  assert.equal(hasEntryShape({ cmd, rec }), false, "a missing seq");
  assert.equal(hasEntryShape({ seq, rec }), false, "a missing cmd");
  // An EXTRA field is a row a newer writer wrote, carrying something this
  // process does not understand. Accepting it would silently drop that.
  assert.equal(
    hasEntryShape({ seq, cmd, rec, tenant: "acme" }),
    false,
    "an unknown field",
  );
});

test("hasEntryShape: the sequence number is a safe integer from one up", () => {
  assert.ok(hasEntryShape(rowWith("seq", 1)));
  assert.ok(hasEntryShape(rowWith("seq", Number.MAX_SAFE_INTEGER)));
  for (const bad of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
    1n,
    null,
  ]) {
    assert.equal(
      hasEntryShape(rowWith("seq", bad)),
      false,
      `seq ${String(bad)}`,
    );
  }
});

test("hasEntryShape: a decision event outside the vocabulary is refused", () => {
  for (const bad of [
    { tag: "JLandDuplicate", ticket: 1 },
    { tag: "JRelease" },
    { tag: "JRelease", ticket: 1, extra: 1 },
    { tag: "JRelease", ticket: 0 },
    { tag: "JRelease", ticket: "1" },
    { ticket: 1 },
    "JRelease",
  ]) {
    assert.equal(
      hasEntryShape(rowWith("cmd", bad)),
      false,
      JSON.stringify(bad),
    );
  }
});

test("hasEntryShape: every field of the widest payload is checked", () => {
  const arrive = oneOfEach.JArrive;
  const broken: readonly unknown[] = [
    { ...arrive, deps: [1] },
    { ...arrive, deps: new Set([0]) },
    { ...arrive, program: progFlat[0] },
    { ...arrive, program: [{ fanout: 1, combinator: "CMajority" }] },
    { ...arrive, program: [{ fanout: 1 }] },
    { ...arrive, project: 0 },
    { ...arrive, wrapUp: { tag: "WShared", resource: 1 } },
    { ...arrive, wrapUp: { tag: "WExclusive" } },
    { ...arrive, wrapUp: "WNone" },
  ];
  for (const cmd of broken) {
    assert.equal(
      hasEntryShape(rowWith("cmd", cmd)),
      false,
      JSON.stringify(cmd),
    );
  }
  // ...and the two shapes that ARE in the universe still pass, so the refusals
  // above are attributable to the mutation rather than to the fixture.
  assert.ok(hasEntryShape(rowWith("cmd", { ...arrive, deps: new Set() })));
  assert.ok(
    hasEntryShape(rowWith("cmd", { ...arrive, wrapUp: { tag: "WNone" } })),
  );
});

test("hasEntryShape: the other payload leaves are checked too", () => {
  for (const bad of [
    { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VMaybe" },
    { tag: "JTaskDone", ticket: 1, tid: 0, verdict: "VPass" },
    { tag: "JDequeue", ticket: 1, moved: "true" },
    { tag: "JGateResolve", ticket: 1, out: "WOkay" },
  ]) {
    assert.equal(
      hasEntryShape(rowWith("cmd", bad)),
      false,
      JSON.stringify(bad),
    );
  }
});

test("hasEntryShape: the record's shape is checked; its vocabulary is not", () => {
  const rec = d1.rec;
  for (const bad of [
    { ...rec, transitions: undefined },
    { ...rec, transitions: {} },
    { ...rec, transitions: [{ ticket: 1, from: "PDraft" }] },
    { ...rec, effects: "CreateDraft" },
    { ...rec, effects: [1] },
    { ...rec, label: 1 },
    { ...rec, attempt: { tag: "WOAttempt", project: 1 } },
    { ...rec, attempt: "WONone" },
    // The retired name, carried in the renamed field's place — a pre-rename
    // row, or a writer that never followed the model. The roster is the whole
    // of what refuses it, so the refusal is pinned here rather than assumed.
    {
      label: rec.label,
      transitions: rec.transitions,
      effects: rec.effects,
      landing: rec.attempt,
    },
  ]) {
    assert.equal(
      hasEntryShape(rowWith("rec", bad)),
      false,
      JSON.stringify(bad),
    );
  }

  // A record whose PHASES and EFFECTS are nonsense passes the shape gate, and
  // that is the documented division of labour rather than a hole: the legality
  // fold re-derives the record from the cmd and refuses anything the deciders
  // would not have produced, which is a stronger check than any roster of
  // phases this file could keep current. `journal.test.ts` is where that
  // refusal is pinned.
  const nonsense: StepRecord = {
    label: "no-such-label",
    transitions: [{ ticket: 1, from: "PNowhere", to: "PElsewhere" }] as never,
    effects: ["NoSuchEffect"],
    attempt: { tag: "WONone" },
  };
  assert.ok(hasEntryShape(rowWith("rec", nonsense)));
});
