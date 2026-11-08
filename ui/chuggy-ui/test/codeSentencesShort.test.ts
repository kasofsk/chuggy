/**
 * That every line `codeSentences.ts` and `ticketCreationRun.ts` hand a screen
 * is short in each of its parts, in words a reader needs no glossary for.
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
import {
  draftDeletionFailureSentence,
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
import { copyTextEn } from "../app/copy/catalog.ts";
import type { Copy } from "../app/core/copy.ts";

const lineLengthMax = 60;

/** A line's words, or nothing where there is no line. */
function textOf(copy: Copy | undefined): string | undefined {
  return copy === undefined ? undefined : copyTextEn(copy);
}

/** Words only someone who has read this repository would use. */
const internalWords =
  /\b(?:actors?|mailbox(?:es)?|journal(?:ed|s)?|boundar(?:y|ies)|projections?|budgets?|attempt refs?|generations?|evaluators?)\b/iu;

function expectShort(lines: readonly string[]): void {
  for (const line of lines) {
    for (const part of line.split(" · "))
      expect(part.length, line).toBeLessThanOrEqual(lineLengthMax);
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
    ...escalationKinds.map((each) => copyTextEn(escalationKindSentence(each))),
    ...nativeActionKinds.map((each) =>
      copyTextEn(nativeActionKindSentence(each)),
    ),
    ...operationStates.map((each) => copyTextEn(operationStateSentence(each))),
  ]);
});

test("every refusal a settled operation carries is one short line", () => {
  expectShort([
    ...operationRefusalCodes.map((code) =>
      copyTextEn(operationRefusalSentence(refusals[code])),
    ),
    copyTextEn(
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
    ),
    copyTextEn(
      operationRefusalSentence({
        type: "DependencyCycle",
        value: { ticket, dependencies: [290] },
      }),
    ),
  ]);
});

test("every way a ticket stays on its revision is one short line", () => {
  expectShort(
    [
      ...draftReleaseRefusalCodes.map((code) =>
        textOf(ticketFollowingSentence({ verdict: "Held", code })),
      ),
      textOf(ticketFollowingSentence({ verdict: "Trimmed" })),
    ].filter((line) => line !== undefined),
  );
});

test("every refusal, deferral and failure a submission meets is one short line", () => {
  expectShort([
    ...mutationRefusalCodes.map((each) =>
      copyTextEn(mutationRefusalSentence(each)),
    ),
    ...draftRevisionRefusalCodes.map((each) =>
      copyTextEn(draftRevisionRefusalSentence(each)),
    ),
    ...[...mutationDeferralCodes, unknownCode].map((each) =>
      copyTextEn(mutationDeferralSentence(each)),
    ),
    ...Object.values(failures).map((each) =>
      copyTextEn(operationFailureSentence(each)),
    ),
    ...Object.values(failures).map((each) =>
      copyTextEn(draftRevisionFailureSentence(each)),
    ),
    ...Object.values(failures).map((each) =>
      copyTextEn(draftDeletionFailureSentence(each)),
    ),
    ...draftRevisionRefusalCodes.map((code) =>
      copyTextEn(
        draftDeletionFailureSentence({ outcome: "Conflict", code, body: {} }),
      ),
    ),
    ...mutationRefusalCodes.map((code) =>
      copyTextEn(
        operationFailureSentence({ outcome: "Conflict", code, body: {} }),
      ),
    ),
    ...mutationDeferralCodes.map((code) =>
      copyTextEn(
        operationFailureSentence({
          outcome: "Retryable",
          code,
          retryAfterSeconds: 3,
        }),
      ),
    ),
  ]);
});

const held = {
  draft: { ticket },
  origin: "Created",
  body: undefined,
  operation: "op-1",
  unsettled: false,
} as unknown as CreationDraftHeld;

test("every line a creation's submit says is one short line", () => {
  expectShort(
    [
      creationContextSentence({ context: "NoRepository" }),
      creationContextSentence({ context: "NoReadyConfiguration" }),
      creationContextSentence({ context: "ReadyConfigurationUnknown" }),
      creationStaleSentence,
      creationStaleUnreadSentence,
      creationProjectNotActiveSentence,
      creationDraftChangedSentence,
      creationDraftHeldSentence(held),
      creationDraftHeldSentence({ ...held, unsettled: true }),
      creationDraftUnreadSentence,
      creationDraftHeldSentence({ ...held, origin: "Followed" }),
      creationDraftDeletedSentence(held),
      creationDraftDeletedSentence({ ...held, origin: "Followed" }),
      creationTicketExistsSentence(held),
      creationTicketExistsSentence({ ...held, origin: "Followed" }),
    ].map(copyTextEn),
  );
});

test("a held draft's line says whether it was released, settled or not", () => {
  expect(copyTextEn(creationDraftHeldSentence(held))).toMatch(
    /· Not released$/u,
  );
  expect(
    copyTextEn(creationDraftHeldSentence({ ...held, unsettled: true })),
  ).toMatch(/· Maybe released$/u);
});

test("a panel never read says so in one word", () => {
  expect(copyTextEn(freshnessLabel(Date.now(), undefined))).toBe("Unknown");
});

test("a part of a line over the limit or in the repository's own words is caught, and a joined line holds each part to it", () => {
  expect(() => {
    expectShort(["x".repeat(lineLengthMax + 1)]);
  }).toThrow();
  expect(() => {
    expectShort([`Held · ${"x".repeat(lineLengthMax + 1)}`]);
  }).toThrow();
  expectShort([`${"x".repeat(lineLengthMax)} · ${"x".repeat(lineLengthMax)}`]);
  expect(() => {
    expectShort(["Mailbox full"]);
  }).toThrow();
});
