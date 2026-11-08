/**
 * What one run's summary pane says, and what it refuses to say.
 *
 * The failure this exists for is a run that ended without a result being drawn
 * under another run's verdict: the result belongs to the attempt it names, and
 * a pane that ignored that would report a pass for a run that never finished.
 */

import { expect, test } from "vitest";

import type { ExecutionResponse } from "../../../src/contract/responses.ts";
import {
  runArtifactsListed,
  runResultPath,
  runSummaryOf,
} from "../app/core/runSummary.ts";

type ExecutionResult = NonNullable<ExecutionResponse["result"]>;

function result(over: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    manifest: "m1",
    attempt: "a1",
    schemaVersion: 3,
    digest: "a".repeat(64),
    verdict: "Pass",
    recordedAt: "2026-08-27T00:00:00Z",
    artifacts: [],
    report: "the tests pass",
    ...over,
  };
}

test("a reported run draws the summary its own result carries", () => {
  expect(runSummaryOf({ attempt: "a1", state: "Reported" }, result())).toEqual({
    summary: "Report",
    report: "the tests pass",
  });
});

/** #363: a worker below the schema that carries a summary reports none. */
test("a result older than the summary field is told apart from an absent one", () => {
  expect(
    runSummaryOf(
      { attempt: "a1", state: "Reported" },
      result({ schemaVersion: 2, report: undefined }),
    ),
  ).toEqual({ summary: "SchemaTooOld" });
});

test("a run that ended without a result has ended, whoever's result is held", () => {
  expect(runSummaryOf({ attempt: "a2", state: "Lost" }, result())).toEqual({
    summary: "Ended",
  });
  expect(
    runSummaryOf({ attempt: "a2", state: "Withdrawn" }, undefined),
  ).toEqual({ summary: "Ended" });
});

test("a run still going has no summary yet and is not an absence", () => {
  expect(
    runSummaryOf({ attempt: "a2", state: "Running" }, undefined).summary,
  ).toBe("Live");
  expect(
    runSummaryOf({ attempt: "a2", state: "Placing" }, undefined).summary,
  ).toBe("Live");
});

test("a result carrying no summary is an absence rather than a blank pane", () => {
  expect(
    runSummaryOf(
      { attempt: "a1", state: "Reported" },
      result({ report: undefined }),
    ).summary,
  ).toBe("Absent");
});

/** The run's own result is the summary and figures already drawn, and a row
 * for it reads as a second, unexplained copy. */
test("a result lists every artifact but the run's own result, in order", () => {
  const paths = [".chuggy/check-output.json", runResultPath, "out/notes.md"];
  expect(
    runArtifactsListed(paths.map((path) => ({ path }))).map(
      (artifact) => artifact.path,
    ),
  ).toEqual([".chuggy/check-output.json", "out/notes.md"]);
});
