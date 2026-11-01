/**
 * That every refusal a settled operation carries reads as a sentence, and that
 * a refusal the machine decided names the numbers a reader needs to act on it.
 *
 * The samples are keyed by code and checked against the whole roster, so a
 * code the wire gains is a compile error here before it is a sentence nobody
 * has read.
 */

import { expect, test } from "vitest";

import { operationRefusalCodes } from "../../../src/contract/rosters.ts";
import { operationRefusalLabel } from "../app/core/codeLabels.ts";
import { operationRefusalSentence } from "../app/core/codeSentences.ts";
import {
  operationRefusalSamples,
  type OperationRefusalSamples,
} from "./operationRefusalFixture.ts";

const samples: OperationRefusalSamples = {
  ...operationRefusalSamples(41, [17, 23]),
  DependencyCycle: {
    type: "DependencyCycle",
    value: { ticket: 41, dependencies: [17] },
  },
  DependenciesIncomplete: {
    type: "DependenciesIncomplete",
    value: { ticket: 41, dependencies: [17, 23, 29] },
  },
};

const said = operationRefusalCodes.map((code) =>
  operationRefusalSentence(samples[code]),
);

test("every refusal reads as a distinct sentence that quotes no code", () => {
  for (const sentence of said) {
    expect(sentence).toContain(" ");
    for (const code of operationRefusalCodes)
      expect(sentence).not.toContain(code);
  }
  expect(new Set(said).size).toBe(said.length);
});

test("every refusal has a distinct label", () => {
  const labels = operationRefusalCodes.map(operationRefusalLabel);
  expect(new Set(labels).size).toBe(labels.length);
});

test("a refusal over one ticket names that ticket", () => {
  for (const code of operationRefusalCodes) {
    const sample = samples[code];
    if ("value" in sample && typeof sample.value === "number")
      expect(operationRefusalSentence(sample)).toContain("#41");
  }
});

test("a refusal over dependencies names the ticket and each dependency", () => {
  expect(operationRefusalSentence(samples.DependenciesIncomplete)).toBe(
    "#41 waits on #17, #23 and #29 · Not done yet",
  );
  expect(operationRefusalSentence(samples.DependenciesNotFound)).toBe(
    "#41 depends on missing #17 and #23",
  );
  expect(
    operationRefusalSentence({
      type: "DependenciesIncomplete",
      value: { ticket: 41, dependencies: [17] },
    }),
  ).toBe("#41 waits on #17 · Not done yet");
});

test("a dependency refused for what it is says what to depend on instead", () => {
  expect(operationRefusalSentence(samples.DependenciesRevoked)).toBe(
    "#41 depends on revoked #17 and #23 · Pick open ones",
  );
  expect(operationRefusalSentence(samples.DependencyCycle)).toBe(
    "#41 cannot depend on #17 · Would form a cycle",
  );
  expect(
    operationRefusalSentence({
      type: "DependencyCycle",
      value: { ticket: 41, dependencies: [17, 23] },
    }),
  ).toBe("#41 cannot depend on #17 and #23 · Would form a cycle");
});

test("a stale revision names the one written against and the one held", () => {
  const sentence = operationRefusalSentence(samples.TicketRevisionStale);
  expect(sentence).toContain("#41");
  expect(sentence).toContain("revision 2");
  expect(sentence).toContain("revision 5");
});

test("a task that is not current names the task it was for", () => {
  expect(operationRefusalSentence(samples.TaskNotCurrent)).toContain(
    "Report for cycle 3 work of #41",
  );
  const evaluation = operationRefusalSentence({
    type: "TaskNotCurrent",
    value: {
      ticket: 41,
      task: {
        type: "EvaluationTask",
        value: {
          ticket: 41,
          workCycle: 3,
          stage: 2,
          generation: 4,
          evaluator: 6,
        },
      },
    },
  });
  expect(evaluation).toContain("Report for cycle 3 stage 2 of #41");
});

test("a finalization that is not current names its work cycle", () => {
  expect(operationRefusalSentence(samples.FinalizationNotCurrent)).toContain(
    "Finalizing result for cycle 3 of #41",
  );
});

test("a release refused for its pairing names the brief, and one refused for its configuration does not", () => {
  const sentence = operationRefusalSentence(samples.ConfigurationInvalid);
  expect(sentence).toMatch(/configuration/iu);
  expect(sentence).not.toMatch(/brief/iu);
  for (const code of [
    "BriefNamesNoRepository",
    "BriefChecksUncommanded",
    "ConfigurationFromAnotherRepository",
  ] as const)
    expect(operationRefusalSentence(samples[code])).toMatch(/brief/iu);
});

/** The two only an update reaches promise no edit the ticket page does not offer. */
test("a refusal only an update reaches offers no edit", () => {
  for (const code of ["TicketIdentityMismatch", "TicketRevisionStale"] as const)
    expect(operationRefusalSentence(samples[code])).not.toMatch(
      /\b(edit|revise|update)\b/iu,
    );
});
