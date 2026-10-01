/**
 * Why a run ended without a result, in its worker's own words: which attempt
 * left them, and the line a row draws of them.
 *
 * The reason belongs to the run that ended the execution, so an earlier
 * attempt's text never speaks for a later one. The text is the worker's and
 * is drawn as text, never as markup.
 */

import type { ExecutionResponse } from "../../../../src/contract/responses.ts";
import { runSummaryOf } from "./runSummary.ts";

/** The most characters a row's reason draws before it is cut short. */
export const runReasonCharsMax = 120;

/** The most characters of a reason kept whole, for hover. */
export const runReasonFullCharsMax = 2_000;

/** A worker's reason as a row draws it, and whole. */
export interface RunReason {
  readonly line: string;
  readonly full: string;
}

/** The newest attempt, where it ended without a result and its worker left text saying why. */
export function runReasonAttempt(
  execution: ExecutionResponse,
): string | undefined {
  const newest = [...execution.attempts]
    .sort((left, right) => left.number - right.number)
    .at(-1);
  if (newest?.error === undefined) return undefined;
  return runSummaryOf(newest, execution.result).summary === "Ended"
    ? newest.attempt
    : undefined;
}

function runReasonCut(text: string, charsMax: number): string {
  const points = Array.from(text);
  return points.length > charsMax
    ? `${points.slice(0, charsMax - 1).join("")}…`
    : text;
}

/** The worker's first line, cut short, and its whole; none where it said nothing. */
export function runReasonOf(text: string): RunReason | undefined {
  const full = text.trim();
  const line = full.split(/\r?\n/u)[0]?.trim() ?? "";
  if (line === "") return undefined;
  return {
    line: runReasonCut(line, runReasonCharsMax),
    full: runReasonCut(full, runReasonFullCharsMax),
  };
}
