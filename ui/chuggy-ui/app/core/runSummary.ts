/**
 * What one run's summary pane says, decided from the attempt and the result the
 * execution recorded, and which of the result's artifacts are listed beside it.
 *
 * A result belongs to the attempt it names, so an attempt that ended without
 * one is never drawn under another attempt's verdict; a manifest older than the
 * summary field says so rather than leaving the pane blank.
 */

import { resultReportSchemaVersionMin } from "../../../../src/contract/http.ts";
import type { ExecutionResponse } from "../../../../src/contract/responses.ts";
import type {
  AttemptEvidence,
  AttemptState,
} from "../../../../src/contract/rosters.ts";

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
  readonly evidence?: AttemptEvidence | undefined;
}

export type RunSummary =
  | { readonly summary: "Report"; readonly report: string }
  | { readonly summary: "SchemaTooOld"; readonly note: string }
  | { readonly summary: "Ended"; readonly note: string }
  | { readonly summary: "Live"; readonly note: string }
  | { readonly summary: "Absent"; readonly note: string };

/** The label the wire gave, where the row carries one. */
function runEndedNote(evidence: AttemptEvidence | undefined): string {
  return evidence === undefined ? "No result" : `No result · ${evidence}`;
}

function runSummaryWithoutResult(attempt: RunAttemptSummary): RunSummary {
  switch (attempt.state) {
    case "Placing":
    case "Running":
      return { summary: "Live", note: "No summary yet" };
    case "Lost":
    case "Withdrawn":
    case "Superseded":
      return { summary: "Ended", note: runEndedNote(attempt.evidence) };
    case "Reported":
      return { summary: "Absent", note: "No result" };
  }
}

/**
 * The pane's whole content: the worker's own summary where the result carries
 * one, and otherwise the reason there is none.
 */
export function runSummaryOf(
  attempt: RunAttemptSummary,
  result: ExecutionResult | undefined,
): RunSummary {
  if (result === undefined || result.attempt !== attempt.attempt)
    return runSummaryWithoutResult(attempt);
  if (result.schemaVersion < resultReportSchemaVersionMin)
    return { summary: "SchemaTooOld", note: "No summary · older worker" };
  const report = result.report;
  return report === undefined
    ? { summary: "Absent", note: "No summary" }
    : { summary: "Report", report };
}
