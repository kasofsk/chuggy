/**
 * That every line `codeSentences.ts` and `ticketCreationRun.ts` hand a screen
 * fits one short line in words a reader needs no glossary for.
 *
 * Each switch is driven across its whole roster with realistic values, and the
 * samples are keyed by code, so a member the wire gains does not compile here
 * until it has a sample, and one written over the limit fails.
 */

import { expect, test } from "vitest";

import {
  draftReleaseRefusalCodes,
  escalationKinds,
  nativeActionKinds,
  operationRefusalCodes,
  operationStates,
} from "../../../src/contract/rosters.ts";
import type { ApiFailure } from "../app/core/apiRequest.ts";
import { configurationPagesMax } from "../app/core/apiRoutes.ts";
import {
  draftRevisionFailureSentence,
  draftRevisionRefusalCodes,
  draftRevisionRefusalSentence,
  escalationKindSentence,
  mutationDeferralCodes,
  mutationDeferralSentence,
  mutationRefusalCodes,
  mutationRefusalSentence,
  nativeActionKindSentence,
  operationFailureSentence,
  operationRefusalSentence,
  operationStateSentence,
  ticketFollowingSentence,
} from "../app/core/codeSentences.ts";
import { freshnessLabel } from "../app/core/freshness.ts";
import {
  creationContextSentence,
  creationDraftChangedSentence,
  creationDraftDeletedSentence,
  creationDraftHeldSentence,
  creationDraftUnreadSentence,
  creationProjectNotActiveSentence,
  creationStaleSentence,
  creationStaleUnreadSentence,
  creationTicketExistsSentence,
  type CreationDraftHeld,
} from "../app/core/ticketCreationRun.ts";
import { operationRefusalSamples } from "./operationRefusalFixture.ts";

const lineLengthMax = 60;

/** Words only someone who has read this repository would use. */
const internalWords =
  /\b(?:actors?|mailbox(?:es)?|journal(?:ed|s)?|boundar(?:y|ies)|projections?|budgets?|attempt refs?|generations?|evaluators?)\b/iu;

function expectShort(lines: readonly string[]): void {
  for (const line of lines) {
    expect(line.length, line).toBeLessThanOrEqual(lineLengthMax);
    expect(line, line).not.toMatch(internalWords);
  }
}

const ticket = 289;
const dependencies = [290, 291];

const refusals = operationRefusalSamples(ticket, dependencies);

const unknownCode = "SubmissionQuotaExhausted";

const failures: { readonly [O in ApiFailure["outcome"]]: ApiFailure } = {
  Unauthenticated: { outcome: "Unauthenticated" },
  Absent: { outcome: "Absent" },
  Conflict: { outcome: "Conflict", code: unknownCode, body: {} },
  Retryable: { outcome: "Retryable", code: unknownCode, retryAfterSeconds: 3 },
  Rejected: { outcome: "Rejected", code: unknownCode, status: 400, body: {} },
  Fault: { outcome: "Fault", code: unknownCode, status: 500 },
  Unreachable: { outcome: "Unreachable", reason: "Failed to fetch" },
  Unreadable: { outcome: "Unreadable", reason: "expected string at title" },
};

test("every escalation, open action and operation state is one short line", () => {
  expectShort([
    ...escalationKinds.map(escalationKindSentence),
    ...nativeActionKinds.map(nativeActionKindSentence),
    ...operationStates.map(operationStateSentence),
  ]);
});

test("every refusal a settled operation carries is one short line", () => {
  expectShort([
    ...operationRefusalCodes.map((code) =>
      operationRefusalSentence(refusals[code]),
    ),
    operationRefusalSentence({
      type: "TaskNotCurrent",
      value: {
        ticket,
        task: {
          type: "EvaluationTask",
          value: {
            ticket,
            workCycle: 12,
            stage: 10,
            generation: 4,
            evaluator: 6,
          },
        },
      },
    }),
    operationRefusalSentence({
      type: "DependencyCycle",
      value: { ticket, dependencies: [290] },
    }),
  ]);
});

test("every way a ticket stays on its revision is one short line", () => {
  expectShort(
    [
      ...draftReleaseRefusalCodes.map((code) =>
        ticketFollowingSentence({ verdict: "Held", code }),
      ),
      ticketFollowingSentence({ verdict: "Trimmed" }),
    ].filter((line) => line !== undefined),
  );
});

test("every refusal, deferral and failure a submission meets is one short line", () => {
  expectShort([
    ...mutationRefusalCodes.map(mutationRefusalSentence),
    ...draftRevisionRefusalCodes.map(draftRevisionRefusalSentence),
    ...[...mutationDeferralCodes, unknownCode].map(mutationDeferralSentence),
    ...Object.values(failures).map(operationFailureSentence),
    ...Object.values(failures).map(draftRevisionFailureSentence),
    ...mutationRefusalCodes.map((code) =>
      operationFailureSentence({ outcome: "Conflict", code, body: {} }),
    ),
    ...mutationDeferralCodes.map((code) =>
      operationFailureSentence({
        outcome: "Retryable",
        code,
        retryAfterSeconds: 3,
      }),
    ),
  ]);
});

const held = {
  draft: { ticket },
  body: undefined,
  operation: "op-1",
  unsettled: false,
} as unknown as CreationDraftHeld;

test("every line a creation's submit says is one short line", () => {
  expectShort([
    creationContextSentence({ context: "NoRepository" }),
    creationContextSentence({ context: "NoReadyConfiguration" }),
    creationContextSentence({
      context: "ReadyConfigurationUnknown",
      pagesRead: configurationPagesMax,
    }),
    creationStaleSentence,
    creationStaleUnreadSentence,
    creationProjectNotActiveSentence,
    creationDraftChangedSentence,
    creationDraftHeldSentence(held),
    creationDraftHeldSentence({ ...held, unsettled: true }),
    creationDraftUnreadSentence,
    creationDraftDeletedSentence(ticket),
    creationTicketExistsSentence(ticket),
  ]);
});

test("a held draft's line says whether it was released, settled or not", () => {
  expect(creationDraftHeldSentence(held)).toMatch(/· Not released$/u);
  expect(creationDraftHeldSentence({ ...held, unsettled: true })).toMatch(
    /· Maybe released$/u,
  );
});

test("a panel never read says so in one word", () => {
  expect(freshnessLabel(Date.now(), undefined)).toBe("Unknown");
});

test("a line over the limit or in the repository's own words is caught", () => {
  expect(() => {
    expectShort(["x".repeat(lineLengthMax + 1)]);
  }).toThrow();
  expect(() => {
    expectShort(["Mailbox full"]);
  }).toThrow();
});
