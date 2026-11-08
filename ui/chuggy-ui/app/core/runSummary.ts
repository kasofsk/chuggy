/**
 * Whether one run has a summary, decided from the attempt and the result the
 * execution recorded, and which of the result's artifacts are listed beside it.
 *
 * A result belongs to the attempt it names, so an attempt that ended without
 * one is never read under another attempt's verdict.
 */

import { resultReportSchemaVersionMin } from "../../../../src/contract/http.ts";
import type { ExecutionResponse } from "../../../../src/contract/responses.ts";
import type { AttemptState } from "../../../../src/contract/rosters.ts";

type ExecutionResult = NonNullable<ExecutionResponse["result"]>;

/**
 * Where an agent run uploads its own result event, as the worker core names it
 * in kasofsk/chuggy-common's `entrypoint.mjs`. Its summary and its figures are
 * what a run's details already draw.
 */
export const runResultPath = ".chuggy/agent-result.json";

/** A result's artifacts as its details list them: all but the run's own result. */
export function runArtifactsListed<T extends { readonly path: string }>(
  artifacts: readonly T[],
): readonly T[] {
  return artifacts.filter((artifact) => artifact.path !== runResultPath);
}

/** As much of an attempt as the summary pane reads. */
export interface RunAttemptSummary {
  readonly attempt: string;
  readonly state: AttemptState;
}

export type RunSummary =
  | { readonly summary: "Report"; readonly report: string }
  | { readonly summary: "SchemaTooOld" }
  | { readonly summary: "Ended" }
  | { readonly summary: "Live" }
  | { readonly summary: "Absent" };

function runSummaryWithoutResult(attempt: RunAttemptSummary): RunSummary {
  switch (attempt.state) {
    case "Placing":
    case "Running":
      return { summary: "Live" };
    case "Lost":
    case "Withdrawn":
    case "Superseded":
      return { summary: "Ended" };
    case "Reported":
      return { summary: "Absent" };
  }
}

/**
 * The worker's own summary where the result carries one, and otherwise the
 * reason there is none.
 */
export function runSummaryOf(
  attempt: RunAttemptSummary,
  result: ExecutionResult | undefined,
): RunSummary {
  if (result === undefined || result.attempt !== attempt.attempt)
    return runSummaryWithoutResult(attempt);
  if (result.schemaVersion < resultReportSchemaVersionMin)
    return { summary: "SchemaTooOld" };
  const report = result.report;
  return report === undefined
    ? { summary: "Absent" }
    : { summary: "Report", report };
}
