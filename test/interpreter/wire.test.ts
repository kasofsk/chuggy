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
import { evaluationTaskOf } from "../../src/domain/task.ts";
import { encodeDecisionEvent } from "../../src/generated/model-api.ts";
import {
  encodeEntry,
  parseEntry,
  parseJournal,
  parseStoredTicketCommand,
  parseTicketCommand,
  type Parsed,
} from "../../src/interpreter/wire.ts";
import { asOperationDecisionEvent } from "../../src/interpreter/ticketCommand.ts";
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
  transitions: [{ ticket: id(1), from: "Pending", to: "Work" }],
  effects: ["SpawnWorkTasks"],
};

/** One decision event per constructor, keyed by its own tag so the roster can be checked against the vocabulary. */
const oneOfEach: Readonly<Record<DecisionEvent["type"], DecisionEvent>> = {
  CreateTicket: releaseTicketEvent(id(1), {
    ...plainAuthoring,
    deps: new Set([2]),
  }),
  Revoke: revokeEvent(id(1)),
  Dispatch: dispatchEvent(id(1)),
  TaskDone: taskDoneEvent(
    id(1),
    evaluationTaskOf(1, 1, 1, 1, 1),
    "Fail",
    plainResult,
  ),
  WorkReduce: workReduceEvent(id(1)),
  EvalReduce: evalReduceEvent(id(1), "ReworkEvaluationFailure"),
  FinalizationResult: finalizationResultEvent(id(1), "FinalizationNeedsWork"),
  ExecutionBlocked: executionBlockedEvent(id(1)),
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
    encodeEntry({ seq: 1, event: oneOfEach.CreateTicket, rec: plainRecord }),
  ) as { event: { value: { deps: number[] } } };
  written.event.value.deps = [1, 1];
  const refused = parseEntry(written);
  assert.equal(refused.parsed, "Refused");
  assert.ok(refused.parsed === "Refused");
  assert.match(refused.why, /set contains a duplicate/);
});

test("the same release with distinct deps is accepted, so the refusal is about the repeat", () => {
  const written = JSON.parse(
    encodeEntry({ seq: 1, event: oneOfEach.CreateTicket, rec: plainRecord }),
  ) as { event: { value: { deps: number[] } } };
  written.event.value.deps = [1, 2];
  const read = accepted(parseEntry(written));
  assert.ok(read.event.type === "CreateTicket");
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

test("a decide carrying a finalization result is refused, as a reduction and a release are", () => {
  for (const closed of [
    oneOfEach.FinalizationResult,
    oneOfEach.WorkReduce,
    oneOfEach.EvalReduce,
    oneOfEach.CreateTicket,
  ]) {
    const refused = parseTicketCommand(
      JSON.stringify({
        version: 1,
        command: "Decide",
        event: encodeDecisionEvent(closed),
      }),
    );
    assert.equal(refused.parsed, "Refused", closed.type);
    assert.ok(refused.parsed === "Refused");
    assert.match(refused.why, /not a public decision command/);
    assert.throws(
      () => asOperationDecisionEvent(closed),
      /not a public decision command/,
      closed.type,
    );
  }
});

test("the finalizer's own envelope is read only by the parse a writer reads its inbox with", () => {
  const submitted = {
    version: 1,
    command: "SubmitFinalizationResult",
    request: "6:0:RunFinalizer",
    attempt: "attempt-1",
    requestGeneration: 6,
    recoveryEpoch: "epoch-1",
    outcome: "FinalizationSucceeded",
  };
  const text = JSON.stringify(submitted);
  assert.deepEqual(parseStoredTicketCommand(text), {
    parsed: "Ok",
    value: submitted,
  });
  assert.equal(parseTicketCommand(text).parsed, "Refused");
  for (const broken of [
    { ...submitted, version: 2 },
    { ...submitted, request: "" },
    { ...submitted, attempt: "" },
    { ...submitted, requestGeneration: 0 },
    { ...submitted, requestGeneration: 1.5 },
    { ...submitted, recoveryEpoch: "" },
    { ...submitted, outcome: "FinalizationHeld" },
  ]) {
    const refused = parseStoredTicketCommand(JSON.stringify(broken));
    assert.equal(refused.parsed, "Refused", JSON.stringify(broken));
    assert.ok(refused.parsed === "Refused");
    assert.match(refused.why, /finalization submission fields are invalid/);
  }
});

/**
 * The scheduler's own envelope. `submit_task_completion` builds its event from
 * the ticket alone now that the phase says which escalation a block is, so the
 * wall it recorded travels on the execution and not in these bytes.
 */
test("a stored block names its ticket and nothing else", () => {
  assert.deepEqual(
    parseStoredTicketCommand(
      JSON.stringify({
        version: 1,
        command: "Decide",
        event: { type: "ExecutionBlocked", value: { ticket: 1 } },
      }),
    ),
    {
      parsed: "Ok",
      value: {
        version: 1,
        command: "Decide",
        event: { type: "ExecutionBlocked", value: { ticket: 1 } },
      },
    },
  );
});

/**
 * The hold kind is the evidence the escalation records, and the mailbox names
 * it exactly when the outcome is the one it explains, so a submission pairing
 * the two any other way is not one the boundary could have written.
 */
test("a submission carries its hold kind exactly when it reports one", () => {
  const held = {
    version: 1,
    command: "SubmitFinalizationResult",
    request: "6:0:RunFinalizer",
    requestGeneration: 6,
    recoveryEpoch: "epoch-1",
    outcome: "FinalizationResultUnavailable",
    kind: "RepositoryUnbound",
  };
  assert.deepEqual(parseStoredTicketCommand(JSON.stringify(held)), {
    parsed: "Ok",
    value: held,
  });
  for (const broken of [
    { ...held, kind: "ApprovalDeclined" },
    { ...held, kind: undefined },
    { ...held, outcome: "FinalizationNeedsWork", attempt: "attempt-1" },
  ]) {
    const refused = parseStoredTicketCommand(JSON.stringify(broken));
    assert.equal(refused.parsed, "Refused", JSON.stringify(broken));
    assert.ok(refused.parsed === "Refused");
    assert.match(refused.why, /finalization submission fields are invalid/);
  }
});
