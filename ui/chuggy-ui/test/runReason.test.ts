import { expect, test } from "vitest";

import type { ExecutionResponse } from "../../../src/contract/responses.ts";
import {
  runReasonAttempt,
  runReasonCharsMax,
  runReasonFullCharsMax,
  runReasonOf,
} from "../app/core/runReason.ts";
import { runAttempt, runDigest, runSummary } from "./runPageFixture.tsx";

function executionOf(
  attempts: readonly Record<string, unknown>[],
  result?: Record<string, unknown>,
): ExecutionResponse {
  return {
    ...runSummary(),
    attempts,
    ...(result === undefined ? {} : { result }),
  } as unknown as ExecutionResponse;
}

const lost = (attempt: string, number: number) =>
  runAttempt(attempt, {
    number,
    state: "Lost",
    evidence: "RunFailed",
    error: { bytes: 9 },
  });

test("the reason is the newest attempt's, where it ended without a result and left text", () => {
  expect(runReasonAttempt(executionOf([lost("a1", 1)]))).toBe("a1");
  expect(runReasonAttempt(executionOf([lost("a2", 2), lost("a1", 1)]))).toBe(
    "a2",
  );
});

test("an earlier attempt's text never speaks for the run that followed it", () => {
  const live = runAttempt("a2", { number: 2, state: "Running" });
  expect(runReasonAttempt(executionOf([lost("a1", 1), live]))).toBeUndefined();
  const silent = runAttempt("a2", { number: 2, state: "Lost" });
  expect(
    runReasonAttempt(executionOf([lost("a1", 1), silent])),
  ).toBeUndefined();
});

test("a run that reported has no reason to give", () => {
  const reported = runAttempt("a1", { state: "Reported", error: { bytes: 9 } });
  const result = {
    manifest: "m1",
    attempt: "a1",
    schemaVersion: 3,
    digest: runDigest,
    verdict: "Pass",
    recordedAt: "2026-08-27T00:01:00Z",
    artifacts: [],
  };
  expect(runReasonAttempt(executionOf([reported], result))).toBeUndefined();
});

test("a reason is the worker's first line, and its whole is kept", () => {
  expect(runReasonOf("  killed\nby the runner\n")).toEqual({
    line: "killed",
    full: "killed\nby the runner",
  });
  expect(runReasonOf(" \n ")).toBeUndefined();
});

test("a reason past the row's bound is cut short, and its whole past its own", () => {
  const long = "x".repeat(runReasonFullCharsMax + 1);
  const reason = runReasonOf(long);
  expect(Array.from(reason?.line ?? "")).toHaveLength(runReasonCharsMax);
  expect(reason?.line.endsWith("…")).toBe(true);
  expect(Array.from(reason?.full ?? "")).toHaveLength(runReasonFullCharsMax);
  const fits = "y".repeat(runReasonCharsMax);
  expect(runReasonOf(fits)?.line).toBe(fits);
});
