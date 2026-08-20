/**
 * The parse at the store boundary: what it accepts, what it refuses, and that
 * it refuses by returning rather than by throwing.
 *
 * The tampering cases are the point of the file. A store that handed back the
 * object it was given would pass every round-trip here and refuse nothing, so
 * each case edits stored text the way something outside this process would and
 * asks what comes back.
 *
 * The constructor roster is walked against `decisionEventTags` rather than
 * against a list written here, because a decision event with no schema arm is
 * exactly the drift a hand-written roster hides.
 *
 * THE ROUND TRIP IS THE ENCODE DIRECTION'S ONLY CHECK. The codec is generated
 * from the model, so nothing in this tree states the schema twice; what a
 * generator cannot say is that the bytes read back as the entry that was
 * written, a release's dependency set included, and that is what the round trip
 * here holds.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decisionEventTags,
  dispatchEvent,
  evalReduceEvent,
  executionBlockedEvent,
  finalizationResultEvent,
  releaseTicketEvent,
  resumeTicketEvent,
  revokeEvent,
  taskDoneEvent,
  workReduceEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import { recordEquals } from "../../src/actor/equality.ts";
import type { Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import {
  encodeEntry,
  parseEntry,
  parseJournal,
  type Parsed,
} from "../../src/interpreter/wire.ts";
import {
  plainAuthoring,
  plainResult,
  refinementInstance,
} from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";
import type { StepRecord } from "../../src/domain/generated/modelTypes.ts";

const config = refinementInstance;

/** A well-formed record, so a case about a decision event is not also a case about a record. */
const plainRecord: StepRecord = {
  label: "dispatch",
  transitions: [{ ticket: id(1), from: "Pending", to: "Working" }],
  effects: ["SpawnWorkTasks"],
};

/** One decision event per constructor, keyed by its own tag so the roster can be checked against the vocabulary. */
const oneOfEach: Readonly<Record<DecisionEvent["type"], DecisionEvent>> = {
  ReleaseTicket: releaseTicketEvent(id(1), {
    ...plainAuthoring,
    deps: new Set([2]),
  }),
  Revoke: revokeEvent(id(1)),
  Dispatch: dispatchEvent(id(1)),
  TaskDone: taskDoneEvent(id(1), asTaskId(2), "Fail", plainResult),
  WorkReduce: workReduceEvent(id(1)),
  EvalReduce: evalReduceEvent(id(1)),
  FinalizationResult: finalizationResultEvent(id(1), "FinalizationFailed"),
  ExecutionBlocked: executionBlockedEvent(id(1), "ExecutionPolicyDenied"),
  ResumeTicket: resumeTicketEvent(id(1)),
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

/** The one honest entry every store case below stores. */
function journaledRelease(): Entry {
  const state = journalStep(
    config,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  const written = state.journal[0];
  assert.ok(written !== undefined);
  return written;
}

test("a journaled entry survives the wire unchanged, record and all", () => {
  const written = journaledRelease();
  const read = accepted(reread(written));
  assert.equal(read.seq, written.seq);
  assert.deepEqual(read.event, written.event);
  assert.ok(recordEquals(read.rec, written.rec));
});

test("every decision event this machine declares has a schema arm, and the roster is the vocabulary's", () => {
  assert.deepEqual(
    [...Object.keys(oneOfEach)].sort(),
    [...decisionEventTags].sort(),
  );
  for (const [tag, event] of Object.entries(oneOfEach)) {
    const read = accepted(reread({ seq: 1, event, rec: plainRecord }));
    assert.deepEqual(read.event, event, `${tag} did not survive the wire`);
  }
});

test("a release naming a ticket twice is refused, which is the gap between an array and the model's set", () => {
  const written = JSON.parse(
    encodeEntry({ seq: 1, event: oneOfEach.ReleaseTicket, rec: plainRecord }),
  ) as { event: { value: { deps: number[] } } };
  written.event.value.deps = [1, 1];
  const refused = parseEntry(written);
  assert.equal(refused.parsed, "Refused");
  assert.ok(refused.parsed === "Refused");
  assert.match(refused.why, /set contains a duplicate/);
});

test("the same release with distinct deps is accepted, so the refusal is about the repeat", () => {
  const written = JSON.parse(
    encodeEntry({ seq: 1, event: oneOfEach.ReleaseTicket, rec: plainRecord }),
  ) as { event: { value: { deps: number[] } } };
  written.event.value.deps = [1, 2];
  const read = accepted(parseEntry(written));
  assert.ok(read.event.type === "ReleaseTicket");
  assert.deepEqual(read.event.value.deps, new Set([1, 2]));
});

test("a multi-dep release is written as an array and read back as the set it was", () => {
  const entry: Entry = {
    seq: 1,
    event: releaseTicketEvent(id(1), {
      ...plainAuthoring,
      deps: new Set([2, 1]),
    }),
    rec: plainRecord,
  };
  assert.match(encodeEntry(entry), /"deps":\[(1,2|2,1)\]/);
  assert.deepEqual(accepted(reread(entry)), entry);
});

test("a row is refused, with the field named, for each way the wire can lie", () => {
  const cases: readonly (readonly [string, unknown, RegExp])[] = [
    [
      "a sequence number that is not a whole number",
      { seq: 1.5, event: oneOfEach.Dispatch, rec: plainRecord },
      /"seq"/,
    ],
    [
      "a decision-event tag this machine has not got",
      { seq: 1, event: { type: "JSquash", value: 1 }, rec: plainRecord },
      /"event"/,
    ],
    [
      "a phase outside the vocabulary",
      {
        seq: 1,
        event: oneOfEach.Dispatch,
        rec: {
          ...plainRecord,
          transitions: [{ ticket: 1, from: "PParked", to: "Done" }],
        },
      },
      /"rec",\s+"transitions"/,
    ],
    ["a missing record", { seq: 1, event: oneOfEach.Dispatch }, /"rec"/],
    [
      "a ticket id that is not a whole number",
      { seq: 1, event: { type: "Dispatch", value: 1.5 }, rec: plainRecord },
      /"event"/,
    ],
    ["nothing at all", null, /received null/],
  ];
  for (const [what, row, where] of cases) {
    const refused = parseEntry(row);
    assert.equal(refused.parsed, "Refused", `${what} was accepted`);
    assert.ok(refused.parsed === "Refused");
    assert.match(refused.why, where, what);
  }
});

/**
 * The model types a record's effects as strings, so the wire carries any of
 * them and the vocabulary is enforced by the pure decision planner.
 */
test("an effect string outside the vocabulary passes the wire, which does not know the vocabulary", () => {
  const read = accepted(
    parseEntry({
      seq: 1,
      event: oneOfEach.Dispatch,
      rec: { ...plainRecord, effects: ["Deploy"] },
    }),
  );
  assert.deepEqual(read.rec.effects, ["Deploy"]);
});

test("a whole journal is refused when it is not a list of rows, and by the index of the row that lied", () => {
  const notAList = parseJournal({ seq: 1 });
  assert.equal(notAList.parsed, "Refused");
  assert.ok(notAList.parsed === "Refused");
  assert.match(notAList.why, /a journal is an array of entries/);

  const good = { seq: 1, event: oneOfEach.Dispatch, rec: plainRecord };
  const badRow = parseJournal([good, { ...good, seq: 1.5 }]);
  assert.equal(badRow.parsed, "Refused");
  assert.ok(badRow.parsed === "Refused");
  assert.match(badRow.why, /^1: /);

  const both = parseJournal([good, { ...good, seq: 2 }]);
  assert.ok(both.parsed === "Ok");
  assert.deepEqual(
    both.value.map((entry) => entry.seq),
    [1, 2],
  );
});
