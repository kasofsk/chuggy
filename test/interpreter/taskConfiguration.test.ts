import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allTaskConfigurationFaults,
  authoredTaskConfigurationReadiness,
  briefingLineCharsMax,
  commandLinesMax,
} from "../../src/interpreter/taskConfiguration.ts";

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

/** The ready document with the work stage a case is about. */
function workOf(work: unknown): unknown {
  return { ...configuration, work };
}

test("a work stage names its commands or briefs an agent, never both or neither", () => {
  const commanded = { commands: ["./request-build"] };
  assert.deepEqual(authoredTaskConfigurationReadiness(workOf(commanded)), {
    readiness: "Ready",
    configuration: { ...configuration, work: commanded },
  });
  for (const work of [
    {},
    { ...commanded, instructions: ["Change the importer."] },
    { authority: { network: true } },
  ]) {
    assert.deepEqual(
      authoredTaskConfigurationReadiness(workOf(work)),
      { readiness: "Incomplete", fault: "WorkKindAmbiguous" },
      JSON.stringify(work),
    );
  }
});

test("a document that names no work stage is refused at the field it lacks", () => {
  const absent: Record<string, unknown> = { ...configuration };
  delete absent["work"];
  for (const document of [absent, workOf(undefined)]) {
    assert.deepEqual(authoredTaskConfigurationReadiness(document), {
      readiness: "Incomplete",
      fault: "WorkInvalid",
    });
  }
});

test("a narrowing a commanded work stage cannot honour is refused, never dropped", () => {
  for (const work of [
    { commands: ["./request-build"], authority: { network: true } },
    { commands: ["./request-build"], practices: [] },
  ]) {
    assert.deepEqual(
      authoredTaskConfigurationReadiness(workOf(work)),
      { readiness: "Incomplete", fault: "WorkFieldUnknown" },
      JSON.stringify(work),
    );
  }
});

test("a commanded work stage's list is bounded and made of readable lines", () => {
  for (const commands of [
    [],
    "./request-build",
    [1],
    Array.from({ length: commandLinesMax + 1 }, () => "./request-build"),
  ]) {
    assert.deepEqual(
      authoredTaskConfigurationReadiness(workOf({ commands })),
      { readiness: "Incomplete", fault: "CommandsInvalid" },
      JSON.stringify(commands),
    );
  }
  for (const [line, fault] of [
    ["", "EmptyLine"],
    ["x".repeat(briefingLineCharsMax + 1), "TextTooLong"],
    ["./request-build\nrm -rf /", "TextUnreadable"],
  ] as const) {
    assert.deepEqual(
      authoredTaskConfigurationReadiness(workOf({ commands: [line] })),
      { readiness: "Incomplete", fault },
      "a commanded work line is read like any other authored line",
    );
  }
});

test("every fault the work stage names is one a refusal can be recorded under", () => {
  for (const fault of [
    "CommandsInvalid",
    "WorkKindAmbiguous",
    "WorkFieldUnknown",
  ] as const) {
    assert.ok(allTaskConfigurationFaults.includes(fault), fault);
  }
});
