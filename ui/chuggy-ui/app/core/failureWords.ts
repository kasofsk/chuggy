/**
 * The one word a failed request is drawn as, whatever asked for it.
 *
 * A word is what a reader acts on; the code or the reason text behind it is
 * `detail`, for someone reporting the problem, and is drawn only on hover of
 * the word, never in a line. The switch is total over `ApiFailure`, so an
 * outcome gained does not compile until it has a word.
 */

import type { ApiFailure } from "./apiRequest.ts";

export interface FailureWords {
  readonly word: string;
  readonly detail?: string;
}

export function failureWords(result: ApiFailure): FailureWords {
  switch (result.outcome) {
    case "Unauthenticated":
      return { word: "Signed out" };
    case "Absent":
      return { word: "Not found" };
    case "Conflict":
    case "Rejected":
      return { word: "Refused", detail: result.code };
    case "Retryable":
      return { word: "Busy", detail: result.code };
    case "Fault":
      return { word: "Server error", detail: result.code };
    case "Unreachable":
      return { word: "Offline", detail: result.reason };
    case "Unreadable":
      return { word: "Update needed", detail: result.reason };
  }
}

/** A throw in place of an answer, as the outcome of a read the console could
 * not make sense of, so it is drawn in the same words as any other. */
export function failureOfThrown(thrown: unknown): ApiFailure {
  return {
    outcome: "Unreadable",
    reason: thrown instanceof Error ? thrown.message : "the read failed",
  };
}

/** What a failed read says before its word: what was not read, where the
 * place names it, and that it was not — which an absence already says. */
export function readFailedLead(
  subject: string | undefined,
  failure: ApiFailure,
): readonly string[] {
  return [
    ...(subject === undefined ? [] : [subject]),
    ...(failure.outcome === "Absent" ? [] : ["Not read"]),
  ];
}

/** A failed read as one line, for a place that draws a string. */
export function readFailedLine(
  subject: string | undefined,
  failure: ApiFailure,
): string {
  return [...readFailedLead(subject, failure), failureWords(failure).word].join(
    " · ",
  );
}
