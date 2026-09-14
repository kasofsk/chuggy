import assert from "node:assert/strict";
import { test } from "node:test";
import { authoredTaskConfigurationReadiness } from "../../src/interpreter/taskConfiguration.ts";

const configuration = {
  brief: {
    motivation: ["Make configuration parsing explicit."],
    acceptanceCriteria: [],
    constraints: [],
  },
  practices: [],
  work: { instructions: [] },
  review: { instructions: [] },
};

test("schemas strip unknown fields and omit explicit undefined at authored boundaries", () => {
  assert.deepEqual(
    authoredTaskConfigurationReadiness({
      ...configuration,
      unknown: "ignored",
      brief: { ...configuration.brief, unknown: "ignored" },
      work: { instructions: [], authority: undefined, unknown: "ignored" },
      authority: { tools: undefined, network: undefined, unknown: "ignored" },
      evaluations: undefined,
      worker: undefined,
    }),
    { readiness: "Ready", configuration: { ...configuration, authority: {} } },
  );
});

test("configuration refusals retain mandatory-field and evaluation precedence", () => {
  const cases = [
    [
      { ...configuration, brief: null, practices: null },
      "BriefingShapeMissing",
    ],
    [
      {
        ...configuration,
        brief: { ...configuration.brief, motivation: null, constraints: null },
      },
      "MotivationInvalid",
    ],
    [{ ...configuration, work: null, review: null }, "WorkInvalid"],
    [
      {
        ...configuration,
        evaluations: [{ purpose: "Check", checks: [], instructions: [] }],
        authority: null,
      },
      "EvaluationKindAmbiguous",
    ],
    [
      {
        ...configuration,
        evaluations: [{ purpose: "Check", checks: [], extra: true }],
        worker: null,
      },
      "EvaluationFieldUnknown",
    ],
    [
      { ...configuration, evaluations: [{ purpose: "Check", checks: [] }] },
      "ChecksInvalid",
    ],
    [{ ...configuration, authority: null, worker: null }, "AuthorityInvalid"],
  ] as const;
  for (const [input, fault] of cases)
    assert.deepEqual(authoredTaskConfigurationReadiness(input), {
      readiness: "Incomplete",
      fault,
    });
});

test("worker compatibility distinguishes absent mode and legacy argument shapes", () => {
  const worker = { setup: [], files: [], arguments: [] };
  assert.deepEqual(
    authoredTaskConfigurationReadiness({ ...configuration, worker }),
    { readiness: "Ready", configuration: { ...configuration, worker } },
  );
  const mode = { type: "SingleAgent", agent: "Claude", arguments: [] };
  const current = { setup: [], files: [], mode };
  assert.deepEqual(
    authoredTaskConfigurationReadiness({
      ...configuration,
      worker: { ...current, arguments: "ignored", extra: true },
    }),
    {
      readiness: "Ready",
      configuration: { ...configuration, worker: current },
    },
  );
  for (const invalid of [
    { ...worker, mode: undefined },
    { ...worker, mode },
    { ...current, mode: { ...mode, model: "unexpected" } },
  ]) {
    assert.deepEqual(
      authoredTaskConfigurationReadiness({ ...configuration, worker: invalid }),
      { readiness: "Incomplete", fault: "WorkerInvalid" },
    );
  }
});
