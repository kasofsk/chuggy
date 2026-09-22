import assert from "node:assert/strict";
import { test } from "node:test";

import {
  phaseTags,
  type EvaluationInstance,
  type TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import {
  decodeTicketGraph,
  decodeDecisionEvent,
  encodeTicketGraph,
} from "../../src/generated/model-api.ts";

/** A judgement still running, which is the only shape carrying a map of evaluators. */
const instance: EvaluationInstance = {
  workCycle: 1,
  input: { ticket: 7, workResult: 1 },
  plan: { stages: [{ key: 1, evaluators: [{ key: 1 }] }] },
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
  input: { ticket: 7, workResult: 1 },
  plan: { stages: [{ key: 1, evaluators: [{ key: 1 }] }] },
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
        deps: new Set([3]),
        artifact: "NoArtifact",
        program: [{ key: 1, evaluators: [{ key: 1 }] }],
        tasks: new Set(),
        evaluations: [instance],
        workCyclesStarted: 0,
        spawned: 0,
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
          deps: [3],
          artifact: "NoArtifact",
          program: [{ key: 1, evaluators: [{ key: 1 }] }],
          tasks: [],
          evaluations: [wiredInstance],
          workCyclesStarted: 0,
          spawned: 0,
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
    decodeDecisionEvent({
      type: "CreateTicket",
      value: {
        ticket: 7,
        deps: [3, 3],
        prog: [{ key: 1, evaluators: [{ key: 1 }] }],
      },
    }),
  );
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
