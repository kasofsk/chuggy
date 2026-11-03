import assert from "node:assert/strict";
import test from "node:test";

import {
  runEndedEvidences,
  runUsageInstantSecsMax,
  runUsageUtilizationMax,
  runUsageWindows,
  workerRunEndedSchema,
  workerRunTotalsSchema,
  workerRunUsageSchema,
} from "../../src/contract/workerPlane.ts";
import { runTotalsBody } from "../adapters/workerPlaneFixtures.ts";

const reading = {
  utilization: 0.8,
  resetsAt: 1_800_000_000,
  observedAt: 1_799_990_000,
};

const totalsWith = (usage: unknown) => ({ ...runTotalsBody, usage });

test("a run's usage is keyed by every window the roster names and by no other", () => {
  assert.deepEqual(
    Object.keys(workerRunUsageSchema.shape).sort(),
    [...runUsageWindows].sort(),
  );
});

test("a run's totals carry no usage, either window alone or both", () => {
  for (const offered of [
    runTotalsBody,
    totalsWith({}),
    totalsWith({ five_hour: reading }),
    totalsWith({ seven_day: reading }),
    totalsWith({ five_hour: reading, seven_day: reading }),
    totalsWith({
      five_hour: {
        utilization: runUsageUtilizationMax,
        resetsAt: runUsageInstantSecsMax,
        observedAt: runUsageInstantSecsMax,
      },
      seven_day: { utilization: 0, resetsAt: 1, observedAt: 1 },
    }),
  ])
    assert.deepEqual(
      workerRunTotalsSchema.parse(offered),
      offered,
      JSON.stringify(offered),
    );
});

test("a run's usage naming a window the roster does not, or a reading out of its bounds, is refused", () => {
  for (const [usage, why] of [
    [{ seven_day_opus: reading }, "an unknown window"],
    [{ five_hour: { ...reading, extra: 1 } }, "an unknown field"],
    [
      { five_hour: { ...reading, utilization: -0.01 } },
      "a negative utilization",
    ],
    [
      { five_hour: { ...reading, utilization: runUsageUtilizationMax + 1 } },
      "a utilization over its ceiling",
    ],
    [{ five_hour: { ...reading, utilization: Number.NaN } }, "NaN"],
    [{ five_hour: { ...reading, utilization: Infinity } }, "an infinity"],
    [{ five_hour: { ...reading, resetsAt: 1.5 } }, "a fractional reset"],
    [{ five_hour: { ...reading, resetsAt: 0 } }, "a reset at the epoch"],
    [
      { five_hour: { ...reading, resetsAt: runUsageInstantSecsMax + 1 } },
      "a reset past the last date",
    ],
    [
      { five_hour: { ...reading, observedAt: -1 } },
      "a reading before the epoch",
    ],
    [
      { five_hour: { ...reading, observedAt: "1799990000" } },
      "an instant as text",
    ],
    [
      { five_hour: { utilization: 0.5, resetsAt: 1 } },
      "a reading never observed",
    ],
    [[reading], "a list"],
  ] as const)
    assert.equal(
      workerRunTotalsSchema.safeParse(totalsWith(usage)).success,
      false,
      why,
    );
});

test("a run's end names its limit with either part, both or neither, beside any evidence", () => {
  for (const evidence of runEndedEvidences)
    for (const limit of [
      undefined,
      {},
      { window: "five_hour" },
      { resetsAt: 1_800_000_000 },
      { window: "seven_day", resetsAt: runUsageInstantSecsMax },
    ]) {
      const offered = limit === undefined ? { evidence } : { evidence, limit };
      assert.deepEqual(
        workerRunEndedSchema.parse(offered),
        offered,
        JSON.stringify(offered),
      );
    }
});

test("a run's limit naming a window the roster does not, or a reset out of its bounds, is refused", () => {
  for (const [limit, why] of [
    [{ window: "seven_day_opus" }, "an unknown window"],
    [{ window: "five_hour", reason: "x" }, "an unknown field"],
    [{ resetsAt: 1.5 }, "a fractional reset"],
    [{ resetsAt: 0 }, "a reset at the epoch"],
    [{ resetsAt: runUsageInstantSecsMax + 1 }, "a reset past the last date"],
    [{ resetsAt: Infinity }, "an infinite reset"],
  ] as const)
    assert.equal(
      workerRunEndedSchema.safeParse({ evidence: "RunRateLimited", limit })
        .success,
      false,
      why,
    );
});
