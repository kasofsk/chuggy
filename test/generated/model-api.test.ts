import assert from "node:assert/strict";
import { test } from "node:test";

import {
  phaseTags,
  type Entry,
  type EvaluatorDefinition,
  type EvaluationInstance,
  type Obligation,
  type TicketGraph,
  type TicketRefusal,
} from "../../src/domain/generated/modelTypes.ts";
import {
  decodeEntry,
  decodeObligation,
  decodeTicketGraph,
  decodeTicketCommand,
  decodeTicketRefusal,
  encodeEntry,
  encodeObligation,
  encodeTicketGraph,
  encodeTicketRefusal,
} from "../../src/generated/model-api.ts";

/** The one evaluator every shape here is judged by, and the task it was given. */
const evaluator: EvaluatorDefinition = {
  key: 1,
  task: { workload: 1, inputs: 2, executionRequirements: 3, resultContract: 4 },
};

/** The definition a release froze, which the ticket carries whole. */
const definition = {
  id: 7,
  content: 141,
  dependencies: new Set([3]),
  workConfiguration: {
    workload: 142,
    inputs: 143,
    executionRequirements: 144,
    resultContract: 145,
  },
  evaluationPlan: { stages: [{ key: 1, evaluators: [evaluator] }] },
  finalizationConfiguration: 146,
} as const;

/** The same, as the codec writes it: a set is a list. */
const wiredDefinition = {
  ...definition,
  dependencies: [3],
};

/** A judgement still running, which is the only shape carrying a map of evaluators. */
const instance: EvaluationInstance = {
  workCycle: 1,
  input: { ticket: 7, workResult: 1, acceptedSourceRef: 11 },
  plan: { stages: [{ key: 1, evaluators: [evaluator] }] },
  state: {
    type: "Running",
    value: {
      completedStages: [],
      stage: {
        stageIndex: 0,
        generation: 1,
        evaluators: new Map([
          [
            1,
            { type: "Produced", value: { type: "EvaluatorPassed", value: 1 } },
          ],
        ]),
      },
    },
  },
};

/** The same, as the codec writes it: a map is a list of pairs and a sum is tag and value. */
const wiredInstance = {
  workCycle: 1,
  input: { ticket: 7, workResult: 1, acceptedSourceRef: 11 },
  plan: { stages: [{ key: 1, evaluators: [evaluator] }] },
  state: {
    type: "Running",
    value: {
      completedStages: [],
      stage: {
        stageIndex: 0,
        generation: 1,
        evaluators: [
          [
            1,
            { type: "Produced", value: { type: "EvaluatorPassed", value: 1 } },
          ],
        ],
      },
    },
  },
};

const graph: TicketGraph = {
  tickets: new Map([
    [
      7,
      {
        phase: "Pending",
        definition,
        source: 0,
        evaluations: [instance],
        workCyclesStarted: 0,
        spawned: 0,
        finalizationGeneration: 0,
        escalation: "NoEscalation",
        completions: 0,
      },
    ],
  ]),
};

test("generated JSON codec round-trips nested lists, sets, maps and records", () => {
  const wire = encodeTicketGraph(graph);
  assert.deepEqual(wire, {
    tickets: [
      [
        7,
        {
          phase: "Pending",
          definition: wiredDefinition,
          source: 0,
          evaluations: [wiredInstance],
          workCyclesStarted: 0,
          spawned: 0,
          finalizationGeneration: 0,
          escalation: "NoEscalation",
          completions: 0,
        },
      ],
    ],
  });
  assert.deepEqual(decodeTicketGraph(wire), graph);
});

test("generated codecs reject an integer outside the JavaScript-safe mapping", () => {
  assert.throws(() =>
    decodeTicketGraph({ tickets: [[Number.MAX_SAFE_INTEGER + 1, {}]] }),
  );
});

test("generated codecs refuse duplicates that JSON could otherwise collapse", () => {
  assert.throws(() =>
    decodeTicketGraph({
      tickets: [
        [7, {}],
        [7, {}],
      ],
    }),
  );
  assert.throws(() =>
    decodeTicketCommand({
      type: "CreateTicket",
      value: { ...wiredDefinition, dependencies: [3, 3] },
    }),
  );
});

test("a refusal is its name and its payload, a set of tickets written as a list", () => {
  const refusal: TicketRefusal = {
    type: "DependenciesIncomplete",
    value: { ticket: 7, dependencies: new Set([3, 5]) },
  };
  const wire = encodeTicketRefusal(refusal);
  assert.deepEqual(wire, {
    type: "DependenciesIncomplete",
    value: { ticket: 7, dependencies: [3, 5] },
  });
  assert.deepEqual(decodeTicketRefusal(wire), refusal);
  assert.throws(() => decodeTicketRefusal({ type: "NotEnabled", value: 7 }));
});

test("generated constructor roster is the exhaustive model phase vocabulary", () => {
  assert.deepEqual(phaseTags, [
    "Pending",
    "Work",
    "Evaluation",
    "Finalization",
    "Done",
    "Escalated",
    "Revoked",
  ]);
});

test("a journal row is the seq and the event, tagged as the model spells the constructor", () => {
  const entry: Entry = {
    seq: 3,
    event: {
      type: "TicketWorkProcessFailed",
      value: {
        ticket: 7,
        task: { type: "WorkTask", value: { ticket: 7, cycle: 1 } },
        evidence: 1,
      },
    },
  };
  const wire = encodeEntry(entry);
  assert.deepEqual(wire, {
    seq: 3,
    event: {
      type: "TicketWorkProcessFailed",
      value: {
        ticket: 7,
        task: { type: "WorkTask", value: { ticket: 7, cycle: 1 } },
        evidence: 1,
      },
    },
  });
  assert.deepEqual(decodeEntry(wire), entry);
  assert.throws(() =>
    decodeEntry({ seq: 3, event: { type: "WorkReduce", value: 7 } }),
  );
});

test("an obligation round-trips under its own constructor", () => {
  const cancel: Obligation = {
    type: "CancelTask",
    value: {
      ticket: 7,
      task: { type: "WorkTask", value: { ticket: 7, cycle: 2 } },
    },
  };
  assert.deepEqual(decodeObligation(encodeObligation(cancel)), cancel);
});
