import assert from "node:assert/strict";
import { test } from "node:test";

import { phaseTags, type Core } from "../../src/domain/generated/modelTypes.ts";
import {
  decodeCore,
  decodeDecisionEvent,
  encodeCore,
} from "../../src/generated/model-api.ts";

const core: Core = {
  tickets: new Map([
    [
      7,
      {
        phase: "Pending",
        deps: new Set([3]),
        artifact: "NoArtifact",
        workFanout: 1,
        program: [{ fanout: 1 }],
        tasks: new Set(),
        record: [],
        spawned: 0,
        resumeAt: "NoResume",
        reason: "NoReason",
        completions: 0,
      },
    ],
  ]),
};

test("generated JSON codec round-trips nested lists, sets, maps and records", () => {
  const wire = encodeCore(core);
  assert.deepEqual(wire, {
    tickets: [
      [
        7,
        {
          phase: "Pending",
          deps: [3],
          artifact: "NoArtifact",
          workFanout: 1,
          program: [{ fanout: 1 }],
          tasks: [],
          record: [],
          spawned: 0,
          resumeAt: "NoResume",
          reason: "NoReason",
          completions: 0,
        },
      ],
    ],
  });
  assert.deepEqual(decodeCore(wire), core);
});

test("generated codecs reject an integer outside the JavaScript-safe mapping", () => {
  assert.throws(() =>
    decodeCore({ tickets: [[Number.MAX_SAFE_INTEGER + 1, {}]] }),
  );
});

test("generated codecs refuse duplicates that JSON could otherwise collapse", () => {
  assert.throws(() =>
    decodeCore({
      tickets: [
        [7, {}],
        [7, {}],
      ],
    }),
  );
  assert.throws(() =>
    decodeDecisionEvent({
      type: "ReleaseTicket",
      value: {
        ticket: 7,
        deps: [3, 3],
        prog: [{ fanout: 1 }],
        workFanout: 1,
      },
    }),
  );
});

test("generated constructor roster is the exhaustive model phase vocabulary", () => {
  assert.deepEqual(phaseTags, [
    "Pending",
    "Working",
    "Evaluating",
    "Finalizing",
    "Done",
    "Escalated",
    "Revoked",
  ]);
});
