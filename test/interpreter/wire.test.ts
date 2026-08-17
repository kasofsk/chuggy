/**
 * The parse at the store boundary: what it accepts, what it refuses, and that
 * it refuses by returning rather than by throwing.
 *
 * The tampering cases are the point of the file. A store that handed back the
 * object it was given would pass every round-trip here and refuse nothing, so
 * each case edits stored text the way something outside this process would and
 * asks what comes back.
 *
 * The constructor roster is walked against `cmdTags` rather than against a list
 * written here, because a thirteenth command with no schema arm is exactly the
 * drift a hand-written roster hides.
 *
 * THE ROUND TRIP IS THE ENCODE DIRECTION'S RUN-TIME CHECK. `EntryWire` pins
 * that direction at compile time (`src/interpreter/wire.ts`); what a type
 * cannot say is that the bytes read back as the entry that was written, deps
 * and their order included, and that is what the round trip here holds.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cmdTags,
  jArrive,
  jCompleteDuplicate,
  jDequeue,
  jDispatch,
  jEvalReduce,
  jGateResolve,
  jOpRetry,
  jRelease,
  jRevalFail,
  jRevoke,
  jTaskDone,
  jWorkReduce,
  type Cmd,
} from "../../src/actor/command.ts";
import { recordEquals } from "../../src/actor/equality.ts";
import type { Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import { journalStoreStub } from "../../src/adapters/journalStoreStub.ts";
import type { StepRecord } from "../../src/domain/core.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { wExclusive, wNone, woNone } from "../../src/domain/wrapUp.ts";
import {
  encodeEntry,
  parseEntry,
  type Parsed,
} from "../../src/interpreter/wire.ts";
import { flatProgram, refinementInstance } from "../actor/harness.ts";
import { depsOf, id } from "../domain/fixtures.ts";

const config = refinementInstance;

/** A well-formed record, so a case about a command is not also a case about a record. */
const plainRecord: StepRecord = {
  label: "ticket-released",
  transitions: [{ ticket: id(1), from: "PDraft", to: "PPending" }],
  effects: [],
  attempt: woNone,
};

/** One command per constructor, keyed by its own tag so the roster can be checked against the vocabulary. */
const oneOfEach: Readonly<Record<Cmd["cmd"], Cmd>> = {
  JArrive: jArrive(depsOf(1), flatProgram, asProjectId(1), wExclusive(1)),
  JRelease: jRelease(id(1)),
  JRevoke: jRevoke(id(1)),
  JDispatch: jDispatch(id(1)),
  JTaskDone: jTaskDone(id(1), asTaskId(2), "VFail"),
  JWorkReduce: jWorkReduce(id(1)),
  JEvalReduce: jEvalReduce(id(1)),
  JDequeue: jDequeue(id(1), true),
  JGateResolve: jGateResolve(id(1), "WFailed"),
  JCompleteDuplicate: jCompleteDuplicate(id(1)),
  JRevalFail: jRevalFail(id(1)),
  JOpRetry: jOpRetry(id(1)),
};

/** Through the wire and back, which is the only route a stored entry ever takes. */
function reread(entry: Entry): Parsed<Entry> {
  return parseEntry(JSON.parse(encodeEntry(entry)) as unknown);
}

/** The parsed value, or a failure naming the refusal, so a case reads as one assertion. */
function accepted(parsed: Parsed<Entry>): Entry {
  assert.equal(
    parsed.parsed,
    "Ok",
    parsed.parsed === "Refused" ? parsed.why : "",
  );
  assert.ok(parsed.parsed === "Ok");
  return parsed.value;
}

test("a journaled entry survives the wire unchanged, record and all", () => {
  const state = journalStep(
    config,
    actorInit(),
    jArrive(depsOf(), flatProgram, asProjectId(1), wNone),
  );
  const written = state.journal[0];
  assert.ok(written !== undefined);
  const read = accepted(reread(written));
  assert.equal(read.seq, written.seq);
  assert.deepEqual(read.cmd, written.cmd);
  assert.ok(recordEquals(read.rec, written.rec));
});

test("every command this machine declares has a schema arm, and the roster is the vocabulary's", () => {
  assert.deepEqual([...Object.keys(oneOfEach)].sort(), [...cmdTags].sort());
  for (const [tag, cmd] of Object.entries(oneOfEach)) {
    const read = accepted(reread({ seq: 1, cmd, rec: plainRecord }));
    assert.deepEqual(read.cmd, cmd, `${tag} did not survive the wire`);
  }
});

test("an arrival naming a ticket twice is refused, which is the gap between an array and the model's set", () => {
  const dependent = { ...oneOfEach.JArrive, deps: [id(1), id(1)] };
  const refused = parseEntry({ seq: 1, cmd: dependent, rec: plainRecord });
  assert.equal(refused.parsed, "Refused");
  assert.ok(refused.parsed === "Refused");
  assert.match(refused.why, /the arrival draws a set/);
});

test("the same arrival with distinct deps is accepted, so the refusal is about the repeat", () => {
  const dependent = { ...oneOfEach.JArrive, deps: [id(1), id(2)] };
  accepted(parseEntry({ seq: 1, cmd: dependent, rec: plainRecord }));
});

test("a multi-dep arrival is written as an ascending array and read back as the set it was", () => {
  const entry: Entry = {
    seq: 1,
    cmd: jArrive(depsOf(2, 1), flatProgram, asProjectId(1), wExclusive(1)),
    rec: plainRecord,
  };
  assert.match(encodeEntry(entry), /"deps":\[1,2\]/);
  assert.deepEqual(accepted(reread(entry)), entry);
});

test("a row is refused, with the field named, for each way the wire can lie", () => {
  const cases: readonly (readonly [string, unknown, RegExp])[] = [
    [
      "a sequence number below the first",
      { seq: 0, cmd: oneOfEach.JRelease, rec: plainRecord },
      /seq/,
    ],
    [
      "a command tag this machine has not got",
      { seq: 1, cmd: { cmd: "JSquash", ticket: 1 }, rec: plainRecord },
      /cmd/,
    ],
    [
      "an effect outside the vocabulary",
      {
        seq: 1,
        cmd: oneOfEach.JRelease,
        rec: { ...plainRecord, effects: ["Deploy"] },
      },
      /rec\.effects/,
    ],
    [
      "a phase outside the vocabulary",
      {
        seq: 1,
        cmd: oneOfEach.JRelease,
        rec: {
          ...plainRecord,
          transitions: [{ ticket: 1, from: "PParked", to: "PDone" }],
        },
      },
      /rec\.transitions/,
    ],
    ["a missing record", { seq: 1, cmd: oneOfEach.JRelease }, /rec/],
    [
      "a ticket id that is not a whole number",
      { seq: 1, cmd: { cmd: "JRelease", ticket: 1.5 }, rec: plainRecord },
      /ticket/,
    ],
    ["nothing at all", null, /\$/],
  ];
  for (const [what, row, where] of cases) {
    const refused = parseEntry(row);
    assert.equal(refused.parsed, "Refused", `${what} was accepted`);
    assert.ok(refused.parsed === "Refused");
    assert.match(refused.why, where, what);
  }
});

test("the store refuses a row it cannot read as JSON before the schema is asked", async () => {
  const store = journalStoreStub();
  const state = journalStep(
    config,
    actorInit(),
    jArrive(depsOf(), flatProgram, asProjectId(1), wNone),
  );
  const written = state.journal[0];
  assert.ok(written !== undefined);
  await store.append(written);
  store.rows[0] = "{ not json";
  const loaded = await store.load();
  assert.equal(loaded.parsed, "Refused");
  assert.ok(loaded.parsed === "Refused");
  assert.match(loaded.why, /not JSON/);
});

test("the store refuses a stored row edited into a shape the machine does not write", async () => {
  const store = journalStoreStub();
  const state = journalStep(
    config,
    actorInit(),
    jArrive(depsOf(), flatProgram, asProjectId(1), wNone),
  );
  const written = state.journal[0];
  assert.ok(written !== undefined);
  await store.append(written);
  store.rows[0] = JSON.stringify({
    ...written,
    rec: { ...written.rec, effects: ["Deploy"] },
  });
  const loaded = await store.load();
  assert.equal(loaded.parsed, "Refused");
  assert.ok(loaded.parsed === "Refused");
  assert.match(loaded.why, /effects/);
});

test("an untouched store reads back what it was given", async () => {
  const store = journalStoreStub();
  const state = journalStep(
    config,
    actorInit(),
    jArrive(depsOf(), flatProgram, asProjectId(1), wNone),
  );
  const written = state.journal[0];
  assert.ok(written !== undefined);
  await store.append(written);
  const loaded = await store.load();
  assert.ok(loaded.parsed === "Ok");
  assert.equal(loaded.value.length, 1);
  assert.ok(recordEquals(loaded.value[0]?.rec ?? plainRecord, written.rec));
});
