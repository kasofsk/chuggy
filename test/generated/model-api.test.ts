import assert from "node:assert/strict";
import { test } from "node:test";

import {
  phaseTags,
  type TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import {
  decodeTicketGraph,
  decodeDecisionEvent,
  encodeTicketGraph,
} from "../../src/generated/model-api.ts";

const graph: TicketGraph = {
  tickets: new Map([
    [
      7,
      {
        phase: "Pending",
        deps: new Set([3]),
        artifact: "NoArtifact",
        program: [{ fanout: 1 }],
        tasks: new Set(),
        record: [],
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
          program: [{ fanout: 1 }],
          tasks: [],
          record: [],
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
        prog: [{ fanout: 1 }],
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
