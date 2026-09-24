/**
 * That every refusal a settled operation carries reads as a sentence, and that
 * a refusal the machine decided names the numbers a reader needs to act on it.
 *
 * The samples are keyed by code and checked against the whole roster, so a
 * code the wire gains is a compile error here before it is a sentence nobody
 * has read.
 */

import { expect, test } from "vitest";

import {
  operationRefusalCodes,
  type OperationRefusalCode,
} from "../../../src/contract/rosters.ts";
import { operationRefusalLabel } from "../app/core/codeLabels.ts";
import {
  operationRefusalSentence,
  type OperationRefusal,
} from "../app/core/codeSentences.ts";

/** A refusal whose one payload is a ticket number. */
function ticketRefused<
  Code extends Extract<OperationRefusal, { readonly value: number }>["type"],
>(type: Code, ticket: number) {
  return { type, value: ticket } as const;
}

const samples: {
  readonly [Code in OperationRefusalCode]: Extract<
    OperationRefusal,
    { readonly type: Code }
  >;
} = {
  TicketAlreadyExists: ticketRefused("TicketAlreadyExists", 41),
  DependenciesNotFound: {
    type: "DependenciesNotFound",
    value: { ticket: 41, dependencies: [17, 23] },
  },
  SelfDependency: ticketRefused("SelfDependency", 41),
  TicketNotFound: ticketRefused("TicketNotFound", 41),
  TicketNotPending: ticketRefused("TicketNotPending", 41),
  TicketIdentityMismatch: ticketRefused("TicketIdentityMismatch", 41),
  TicketRevisionStale: {
    type: "TicketRevisionStale",
    value: { ticket: 41, expected: 2, current: 5 },
  },
  TicketDependenciesChanged: ticketRefused("TicketDependenciesChanged", 41),
  DependenciesIncomplete: {
    type: "DependenciesIncomplete",
    value: { ticket: 41, dependencies: [17, 23, 29] },
  },
  TicketNotRevocable: ticketRefused("TicketNotRevocable", 41),
  TicketNotResumable: ticketRefused("TicketNotResumable", 41),
  TaskNotCurrent: {
    type: "TaskNotCurrent",
    value: {
      ticket: 41,
      task: { type: "WorkTask", value: { ticket: 41, cycle: 3 } },
    },
  },
  FinalizationNotCurrent: {
    type: "FinalizationNotCurrent",
    value: { ticket: 41, workCycle: 3, generation: 2 },
  },
  AuthoringChanged: { type: "AuthoringChanged" },
  ConfigurationInvalid: { type: "ConfigurationInvalid" },
  TicketChanged: { type: "TicketChanged" },
  SelectionChanged: { type: "SelectionChanged" },
  ExecutionSourceUnreadable: { type: "ExecutionSourceUnreadable" },
  ExecutionSourceDenied: { type: "ExecutionSourceDenied" },
  BriefNamesNoRepository: { type: "BriefNamesNoRepository" },
  TicketCapacityReached: { type: "TicketCapacityReached" },
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
    "#41 waits on #17, #23 and #29, which are not done yet",
  );
  expect(operationRefusalSentence(samples.DependenciesNotFound)).toBe(
    "#41 depends on #17 and #23, which the project has no ticket for",
  );
  expect(
    operationRefusalSentence({
      type: "DependenciesIncomplete",
      value: { ticket: 41, dependencies: [17] },
    }),
  ).toBe("#41 waits on #17, which is not done yet");
});

test("a stale revision names the one written against and the one held", () => {
  const sentence = operationRefusalSentence(samples.TicketRevisionStale);
  expect(sentence).toContain("#41");
  expect(sentence).toContain("revision 2");
  expect(sentence).toContain("revision 5");
});

test("a task that is not current names the task it was for", () => {
  expect(operationRefusalSentence(samples.TaskNotCurrent)).toContain(
    "the work of cycle 3 of #41",
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
  expect(evaluation).toContain(
    "evaluator 6 of stage 2, generation 4, in work cycle 3 of #41",
  );
});

test("a finalization that is not current names its work cycle and generation", () => {
  expect(operationRefusalSentence(samples.FinalizationNotCurrent)).toContain(
    "work cycle 3, generation 2 of #41",
  );
});

test("the refusal two release contradictions share names each of them", () => {
  const sentence = operationRefusalSentence(samples.ConfigurationInvalid);
  expect(sentence).toContain("configuration");
  expect(sentence).toContain("pull request");
});

/** The three only an update reaches promise no edit the ticket page does not offer. */
test("a refusal only an update reaches offers no edit", () => {
  for (const code of [
    "TicketIdentityMismatch",
    "TicketRevisionStale",
    "TicketDependenciesChanged",
  ] as const)
    expect(operationRefusalSentence(samples[code])).not.toMatch(
      /\b(edit|revise|update)\b/iu,
    );
});
