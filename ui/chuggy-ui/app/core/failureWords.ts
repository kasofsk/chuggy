/**
 * The one word a failed request is drawn as, whatever asked for it.
 *
 * A word is what a reader acts on; the code or the reason text behind it is
 * `detail`, for someone reporting the problem, and is drawn only on hover of
 * the word, never in a line. The switch is total over `ApiFailure`, so an
 * outcome gained does not compile until it has a word.
 */

import type { ApiFailure } from "./apiRequest.ts";
import type { Copy, CopyOrData } from "./copy.ts";

export interface FailureWords {
  readonly word: Copy;
  readonly detail?: CopyOrData;
}

export function failureWords(result: ApiFailure): FailureWords {
  switch (result.outcome) {
    case "Unauthenticated":
      return { word: { id: "failure-signed-out" } };
    case "Absent":
      return { word: { id: "failure-not-found" } };
    case "Conflict":
    case "Rejected":
      return { word: { id: "failure-refused" }, detail: result.code };
    case "Retryable":
      return { word: { id: "failure-busy" }, detail: result.code };
    case "Fault":
      return { word: { id: "failure-server-error" }, detail: result.code };
    case "Unreachable":
      return { word: { id: "failure-no-connection" }, detail: result.reason };
    case "Unreadable":
      return { word: { id: "failure-unreadable" }, detail: result.reason };
  }
}

/** A throw in place of an answer, as the outcome of a read the console could
 * not make sense of, so it is drawn in the same words as any other. */
export function failureOfThrown(thrown: unknown): ApiFailure {
  return {
    outcome: "Unreadable",
    reason:
      thrown instanceof Error ? thrown.message : { id: "failure-read-failed" },
  };
}

/** What a failed read says before its word: what was not read, where the
 * place names it, and that it was not — which an absence already says. */
export function readFailedLead(
  subject: CopyOrData | undefined,
  failure: ApiFailure,
): readonly CopyOrData[] {
  return [
    ...(subject === undefined ? [] : [subject]),
    ...(failure.outcome === "Absent"
      ? []
      : [{ id: "failure-not-read" } as const]),
  ];
}

/** A failed read as one line, for a place that draws a string. */
export function readFailedLine(
  subject: CopyOrData | undefined,
  failure: ApiFailure,
): Copy {
  return readFailedLead(subject, failure).reduceRight<Copy>(
    (rest, lead) => ({ id: "failure-joined", args: { lead, rest } }),
    failureWords(failure).word,
  );
}
