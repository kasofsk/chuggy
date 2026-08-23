import assert from "node:assert/strict";
import { test } from "node:test";

import { asCanonicalConfiguration } from "../../src/interpreter/authoring.ts";
import {
  branchDiffOutput,
  checkedExecutionListQuery,
  configuredOutputs,
  workSummaryOutput,
} from "../../src/interpreter/operationsView.ts";

test("standard completion outputs have stable presentation contracts", () => {
  assert.deepEqual(
    configuredOutputs(
      asCanonicalConfiguration('{"image":"worker:v1","version":1}'),
    ),
    [branchDiffOutput, workSummaryOutput],
  );
});

test("configuration declares bounded custom structured output presentation", () => {
  const outputs = configuredOutputs(
    asCanonicalConfiguration(
      '{"image":"worker:v1","outputs":[{"mediaType":"application/json","name":"coverage","path":"reports/coverage.json","renderer":"Json","schema":{"type":"object"}}],"version":1}',
    ),
  );
  assert.deepEqual(outputs.at(-1), {
    name: "coverage",
    path: "reports/coverage.json",
    mediaType: "application/json",
    renderer: "Json",
    schema: { type: "object" },
  });
});

test("execution selections reject empty, duplicate, and unbounded pages", () => {
  assert.throws(() => checkedExecutionListQuery({ limit: 0 }), RangeError);
  assert.throws(
    () =>
      checkedExecutionListQuery({
        limit: 10,
        selection: { selection: "Selected", states: [] },
      }),
    RangeError,
  );
  assert.throws(
    () =>
      checkedExecutionListQuery({
        limit: 10,
        selection: { selection: "Selected", states: ["Queued", "Queued"] },
      }),
    RangeError,
  );
});
