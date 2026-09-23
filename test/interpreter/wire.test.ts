/**
 * The parse at the store boundary: what it accepts, what it refuses, and that
 * it refuses by returning rather than by throwing.
 *
 * The tampering cases are the point of the file. A store that handed back the
 * object it was given would pass every round-trip here and refuse nothing, so
 * each case edits stored text the way something outside this process would and
 * asks what comes back.
 *
 * The constructor rosters are walked against `ticketEventTags` and
 * `decisionEventTags` rather than against lists written here, because an event
 * with no schema arm is exactly the drift a hand-written roster hides.
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
  finalizationResultEvent,
  releaseTicketEvent,
  resumeTicketEvent,
  revokeEvent,
  taskDoneEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import type { Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import { encodeDecisionEvent } from "../../src/generated/model-api.ts";
import {
  ticketEventTags,
  type TicketEvent,
} from "../../src/domain/generated/modelTypes.ts";
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
  plainDefinitionOf,
  plainPolicy,
  refinementInstance,
} from "../actor/harness.ts";
import { aDispatchSource } from "../../src/domain/config.ts";
import {
  id,
  judgedReport,
  resultFor,
  stoppedReport,
} from "../domain/fixtures.ts";

const config = refinementInstance;

/** One decision event per constructor, keyed by its own tag so the roster can be checked against the vocabulary. */
const oneOfEach: Readonly<Record<DecisionEvent["type"], DecisionEvent>> = {
  CreateTicket: releaseTicketEvent(plainDefinitionOf(1, new Set([2]))),
  Revoke: revokeEvent(id(1)),
  Dispatch: dispatchEvent(id(1), aDispatchSource),
  TaskDone: taskDoneEvent(
    id(1),
    evaluationTaskOf(1, 1, 1, 1, 1),
    judgedReport(evaluationTaskOf(1, 1, 1, 1, 1), "EvaluatorFail"),
  ),
  FinalizationResult: finalizationResultEvent(
    id(1),
    "FinalizationNeedsWork",
    1,
  ),
  ResumeTicket: resumeTicketEvent(id(1)),
};

const judge = evaluationTaskOf(1, 1, 1, 1, 1);
const judged = { ticket: 1, report: judgedReport(judge, "EvaluatorFail") };
const reworked = {
  ...judged,
  evidence: [{ evaluator: 1, resultRef: resultFor(judge).resultRef }],
};
const workFailure = {
  ticket: 1,
  task: workTaskOf(1, 1),
  evidence: 1,
};
const finalized = { ticket: 1, workCycle: 1, generation: 1, evidence: 1 };

/** One ticket event per constructor, which is every arm a journal row can carry. */
const eventOfEach: Readonly<Record<TicketEvent["type"], TicketEvent>> = {
  TicketCreated: { type: "TicketCreated", value: plainDefinitionOf(1) },
  TicketDispatched: {
    type: "TicketDispatched",
    value: { ticket: 1, source: aDispatchSource },
  },
  TicketRevoked: { type: "TicketRevoked", value: 1 },
  TicketWorkResumed: { type: "TicketWorkResumed", value: 1 },
  TicketEvaluationResumed: { type: "TicketEvaluationResumed", value: 1 },
  TicketFinalizationResumed: { type: "TicketFinalizationResumed", value: 1 },
  TicketWorkResultAccepted: {
    type: "TicketWorkResultAccepted",
    value: {
      ticket: 1,
      result: resultFor(workTaskOf(1, 1)),
      acceptedSourceRef: aDispatchSource,
    },
  },
  TicketWorkProcessFailed: {
    type: "TicketWorkProcessFailed",
    value: workFailure,
  },
  TicketWorkExecutionUnavailable: {
    type: "TicketWorkExecutionUnavailable",
    value: workFailure,
  },
  TicketEvaluationProgressed: {
    type: "TicketEvaluationProgressed",
    value: judged,
  },
  TicketEvaluationPassed: { type: "TicketEvaluationPassed", value: judged },
  TicketEvaluationReworkStarted: {
    type: "TicketEvaluationReworkStarted",
    value: reworked,
  },
  TicketEvaluationFailureEscalated: {
    type: "TicketEvaluationFailureEscalated",
    value: reworked,
  },
  TicketEvaluationBlocked: {
    type: "TicketEvaluationBlocked",
    value: {
      ticket: 1,
      report: stoppedReport(judge, "ExecutionUnavailableFailure"),
    },
  },
  TicketFinalizationSucceeded: {
    type: "TicketFinalizationSucceeded",
    value: finalized,
  },
  TicketFinalizationNeedsWork: {
    type: "TicketFinalizationNeedsWork",
    value: finalized,
  },
  TicketFinalizationUnavailable: {
    type: "TicketFinalizationUnavailable",
    value: finalized,
  },
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
    releaseTicketEvent(plainDefinitionOf(1)),
    plainPolicy,
  );
  const written = state.journal[0];
  assert.ok(written !== undefined);
  return written;
}

test("a journaled entry survives the wire unchanged", () => {
  const written = journaledRelease();
  assert.deepEqual(accepted(reread(written)), written);
});

test("every ticket event this machine declares has a schema arm, and the roster is the vocabulary's", () => {
  assert.deepEqual(
    [...Object.keys(eventOfEach)].sort(),
    [...ticketEventTags].sort(),
  );
  for (const [tag, event] of Object.entries(eventOfEach)) {
    const read = accepted(reread({ seq: 1, event }));
    assert.deepEqual(read.event, event, `${tag} did not survive the wire`);
  }
});

test("every decision event this machine declares is spelled in a command", () => {
  assert.deepEqual(
    [...Object.keys(oneOfEach)].sort(),
    [...decisionEventTags].sort(),
  );
});

test("a release naming a ticket twice is refused, which is the gap between an array and the model's set", () => {
  const written = JSON.parse(
    encodeEntry({ seq: 1, event: eventOfEach.TicketCreated }),
  ) as { event: { value: { dependencies: number[] } } };
  written.event.value.dependencies = [1, 1];
  const refused = parseEntry(written);
  assert.equal(refused.parsed, "Refused");
  assert.ok(refused.parsed === "Refused");
  assert.match(refused.why, /set contains a duplicate/);
});

test("the same release with distinct deps is accepted, so the refusal is about the repeat", () => {
  const written = JSON.parse(
    encodeEntry({ seq: 1, event: eventOfEach.TicketCreated }),
  ) as { event: { value: { dependencies: number[] } } };
  written.event.value.dependencies = [1, 2];
  const read = accepted(parseEntry(written));
  assert.ok(read.event.type === "TicketCreated");
  assert.deepEqual(read.event.value.dependencies, new Set([1, 2]));
});

test("a multi-dep release is written as an array and read back as the set it was", () => {
  const entry: Entry = {
    seq: 1,
    event: {
      type: "TicketCreated",
      value: plainDefinitionOf(1, new Set([2, 1])),
    },
  };
  assert.match(encodeEntry(entry), /"dependencies":\[(1,2|2,1)\]/);
  assert.deepEqual(accepted(reread(entry)), entry);
});

test("a row is refused, with the field named, for each way the wire can lie", () => {
  const dispatched = eventOfEach.TicketDispatched;
  const cases: readonly (readonly [string, unknown, RegExp])[] = [
    [
      "a sequence number that is not a whole number",
      { seq: 1.5, event: dispatched },
      /"seq"/,
    ],
    [
      "an event tag this machine has not got",
      { seq: 1, event: { type: "JSquash", value: 1 } },
      /"event"/,
    ],
    [
      "a command where an event belongs",
      { seq: 1, event: oneOfEach.Dispatch },
      /"event"/,
    ],
    [
      "a ticket id that is not a whole number",
      { seq: 1, event: { type: "TicketRevoked", value: 1.5 } },
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

test("a whole journal is refused when it is not a list of rows, and by the index of the row that lied", () => {
  const notAList = parseJournal({ seq: 1 });
  assert.equal(notAList.parsed, "Refused");
  assert.ok(notAList.parsed === "Refused");
  assert.match(notAList.why, /a journal is an array of entries/);

  const good = { seq: 1, event: eventOfEach.TicketDispatched };
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

test("a decide carrying a dispatch is refused, as a finalization result, a completion and a release are", () => {
  for (const closed of [
    oneOfEach.FinalizationResult,
    oneOfEach.TaskDone,
    oneOfEach.CreateTicket,
    oneOfEach.Dispatch,
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
    request: "6:0:FinalizeTicket",
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

/** The evaluation task and the report a stored completion of one carries. */
const storedTask = {
  type: "EvaluationTask",
  value: { ticket: 1, workCycle: 1, stage: 1, generation: 1, evaluator: 1 },
};
const storedReport = {
  type: "TerminalFailureReport",
  value: { failure: { task: storedTask, evidence: 4 }, kind: "ProcessFailure" },
};

/** The scheduler's envelope around one completion value, as the store holds it. */
function storedCompletion(value: unknown): string {
  return JSON.stringify({
    version: 1,
    command: "Decide",
    event: { type: "TaskDone", value },
  });
}

/**
 * The scheduler's own envelope: `submit_task_completion` names the task it
 * settled and the report it terminated under, and the two model-typed fields
 * come back as the generated decoders read them.
 */
test("a stored completion names its task and the report it terminated under", () => {
  const text = storedCompletion({
    ticket: 1,
    task: storedTask,
    report: storedReport,
  });
  assert.deepEqual(parseStoredTicketCommand(text), {
    parsed: "Ok",
    value: {
      version: 1,
      command: "Decide",
      event: {
        type: "TaskDone",
        value: {
          ticket: 1,
          task: {
            type: "EvaluationTask",
            value: {
              ticket: id(1),
              workCycle: 1,
              stage: 1,
              generation: 1,
              evaluator: 1,
            },
          },
          report: {
            type: "TerminalFailureReport",
            value: {
              failure: {
                task: {
                  type: "EvaluationTask",
                  value: {
                    ticket: id(1),
                    workCycle: 1,
                    stage: 1,
                    generation: 1,
                    evaluator: 1,
                  },
                },
                evidence: 4,
              },
              kind: "ProcessFailure",
            },
          },
        },
      },
    },
  });
  assert.equal(parseTicketCommand(text).parsed, "Refused");
});

/** The boundary writes the ticket, the task and the report, so bytes carrying more were not written by it. */
test("a stored completion is refused for every field the boundary cannot have written", () => {
  for (const [why, value] of [
    [
      "a field beside the ones the boundary writes",
      {
        ticket: 1,
        task: storedTask,
        report: storedReport,
        edge: "ReworkEvaluationFailure",
      },
    ],
    ["no ticket at all", { task: storedTask, report: storedReport }],
    [
      "a ticket named by text",
      { ticket: "1", task: storedTask, report: storedReport },
    ],
    [
      "a task at no constructor of this machine",
      {
        ticket: 1,
        task: { type: "FinalizerTask", value: { ticket: 1 } },
        report: storedReport,
      },
    ],
    [
      "a report still naming its ticket",
      {
        ticket: 1,
        task: storedTask,
        report: {
          type: "TerminalFailureReport",
          value: { ticket: 1, kind: "ProcessFailure" },
        },
      },
    ],
  ] as const) {
    assert.equal(
      parseStoredTicketCommand(storedCompletion(value)).parsed,
      "Refused",
      why,
    );
  }
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
    request: "6:0:FinalizeTicket",
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
