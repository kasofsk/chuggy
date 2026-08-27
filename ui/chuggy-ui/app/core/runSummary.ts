/**
 * What one run's summary pane says, decided from the attempt and the result the
 * execution recorded.
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

/** As much of an attempt as the summary pane reads. */
export interface RunAttemptSummary {
  readonly attempt: string;
  readonly state: AttemptState;
  readonly evidence?: AttemptEvidence | undefined;
}

export type RunSummary =
  | { readonly summary: "Report"; readonly report: string }
  | { readonly summary: "SchemaTooOld"; readonly sentence: string }
  | { readonly summary: "Ended"; readonly sentence: string }
  | { readonly summary: "Live"; readonly sentence: string }
  | { readonly summary: "Absent"; readonly sentence: string };

/** The label the wire gave, or the admission that the row carries none. */
function runEndedSentence(evidence: AttemptEvidence | undefined): string {
  return `ended without a result: ${evidence ?? "no reason was recorded"}`;
}

function runSummaryWithoutResult(attempt: RunAttemptSummary): RunSummary {
  switch (attempt.state) {
    case "Placing":
    case "Running":
      return {
        summary: "Live",
        sentence: "this run has not ended, so it has recorded no summary yet",
      };
    case "Lost":
    case "Withdrawn":
    case "Superseded":
      return { summary: "Ended", sentence: runEndedSentence(attempt.evidence) };
    case "Reported":
      return {
        summary: "Absent",
        sentence: "this run reported, and no result is recorded against it",
      };
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
    return {
      summary: "SchemaTooOld",
      sentence: "report schema too old: this manifest predates the summary",
    };
  const report = result.report;
  return report === undefined
    ? {
        summary: "Absent",
        sentence: "this run recorded a result and no summary with it",
      }
    : { summary: "Report", report };
}
