/**
 * The one word each failed request is drawn as, and the lines built on it.
 *
 * The roster below is keyed by outcome, so an outcome the contract gains does
 * not compile here until a case for it is written, as the switch it drives
 * does not compile until it has a word.
 */

import { expect, test } from "vitest";

import type { ApiFailure } from "../app/core/apiRequest.ts";
import {
  failureOfThrown,
  failureWords,
  readFailedLine,
} from "../app/core/failureWords.ts";
import {
  inquiryAskRefusalSentence,
  inquiryAskRefused,
} from "../app/core/leadInquiries.ts";
import { memberRunnerRemoved } from "../app/core/myRunner.ts";
import { repositoryImportRefused } from "../app/core/repositoryImport.ts";
import { repositoryLandingRefusal } from "../app/core/repositoryLanding.ts";
import { runnersPlacementRefusal } from "../app/core/runners.ts";
import { selectorSettingsRefusal } from "../app/core/selectorSettingsForm.ts";

const every: { readonly [O in ApiFailure["outcome"]]: ApiFailure } = {
  Unauthenticated: { outcome: "Unauthenticated" },
  Absent: { outcome: "Absent" },
  Conflict: { outcome: "Conflict", code: "VersionMoved", body: {} },
  Retryable: {
    outcome: "Retryable",
    code: "MailboxBackpressure",
    retryAfterSeconds: 1,
  },
  Rejected: {
    outcome: "Rejected",
    code: "InvalidRequest",
    status: 400,
    body: {},
  },
  Fault: { outcome: "Fault", code: "InternalError", status: 500 },
  Unreachable: { outcome: "Unreachable", reason: "fetch failed" },
  Unreadable: { outcome: "Unreadable", reason: "expected string at title" },
};

const failures = Object.values(every);

/** What a failure carries that only a person reporting it should read. */
function failureInternals(failure: ApiFailure): readonly string[] {
  return [
    "API",
    ...("code" in failure ? [failure.code] : []),
    ...("reason" in failure ? [failure.reason] : []),
  ];
}

test("every outcome is one word of at most two", () => {
  expect(
    Object.fromEntries(
      failures.map((failure) => [failure.outcome, failureWords(failure).word]),
    ),
  ).toStrictEqual({
    Unauthenticated: "Signed out",
    Absent: "Not found",
    Conflict: "Refused",
    Retryable: "Busy",
    Rejected: "Refused",
    Fault: "Server error",
    Unreachable: "Offline",
    Unreadable: "Update needed",
  });
  for (const failure of failures)
    expect(
      failureWords(failure).word.split(" ").length,
      failure.outcome,
    ).toBeLessThanOrEqual(2);
});

test("what an outcome carries beyond its word is its detail, and in no word or line", () => {
  for (const failure of failures) {
    const words = failureWords(failure);
    const internals = failureInternals(failure).slice(1);
    expect(words.detail, failure.outcome).toBe(internals[0]);
    for (const drawn of [
      words.word,
      readFailedLine(undefined, failure),
      readFailedLine("Tickets", failure),
    ])
      for (const internal of failureInternals(failure))
        expect(drawn, failure.outcome).not.toContain(internal);
  }
});

test("a failed read is its noun, that it was not read, and its word, and an absence says only that it is not found", () => {
  expect(readFailedLine("Tickets", every.Unreachable)).toBe(
    "Tickets · Not read · Offline",
  );
  expect(readFailedLine(undefined, every.Unreachable)).toBe(
    "Not read · Offline",
  );
  expect(readFailedLine("More", every.Fault)).toBe(
    "More · Not read · Server error",
  );
  expect(readFailedLine("Draft", every.Absent)).toBe("Draft · Not found");
  expect(readFailedLine(undefined, every.Absent)).toBe("Not found");
});

test("a throw in place of an answer is drawn in the same words as an answer the console could not read", () => {
  const thrown = failureOfThrown(new Error("boom"));
  expect(thrown).toStrictEqual({ outcome: "Unreadable", reason: "boom" });
  expect(failureWords(thrown)).toStrictEqual({
    word: "Update needed",
    detail: "boom",
  });
});

/** Every write's generic fallback, as the line it leaves. */
const writeLines: readonly (readonly [
  string,
  (failure: ApiFailure) => string,
])[] = [
  ["a member's runners removed", (failure) => memberRunnerRemoved(failure)],
  ["a landing saved", repositoryLandingRefusal],
  ["a placement saved", runnersPlacementRefusal],
  ["selector settings saved", (failure) => selectorSettingsRefusal(failure, 0)],
  [
    "an inquiry asked",
    (failure) => inquiryAskRefusalSentence(inquiryAskRefused(failure)),
  ],
  ["an import pressed", repositoryImportRefused],
];

test("no write's line says its refusal twice, or carries a code", () => {
  for (const [write, line] of writeLines)
    for (const failure of failures) {
      const drawn = line(failure);
      const parts = drawn.split(" · ");
      expect(new Set(parts).size, `${write}: ${drawn}`).toBe(parts.length);
      expect(drawn, write).not.toMatch(/(?:Failed|Refused) · Refused/u);
      for (const internal of failureInternals(failure))
        expect(drawn, write).not.toContain(internal);
    }
});
