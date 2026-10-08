/**
 * What a ledger row says of its execution's result: the line drawn beneath it,
 * the one expander that opens the result whole, and the commands a command
 * stage ran as that expander lists them.
 *
 * The line is the report's opening, cut as a worker's reason is cut, and gives
 * way to that reason where the newest attempt left one. The expander is chosen
 * by what carried the stage, an absent carrier read as an agent's. Which
 * artifact it reads is decided here from the result's own listing, so a row
 * that is only drawn reads nothing; what the read answers is the browser's.
 */

import {
  checkOutputPath,
  checkOutputSchema,
} from "../../../../src/contract/checkOutput.ts";
import type { CheckOutputEntry } from "../../../../src/contract/checkOutput.ts";
import type { ExecutionResponse } from "../../../../src/contract/responses.ts";
import { runReasonAttempt, runReasonOf } from "./runReason.ts";
import type { RunReason } from "./runReason.ts";

/** The built-in output an agent's worker writes its summary to. */
export const runResultSummaryName = "work-summary";

/** The row's line: the report's opening, unless the worker left a reason. */
export function runResultLineOf(
  execution: ExecutionResponse,
): RunReason | undefined {
  if (runReasonAttempt(execution) !== undefined) return undefined;
  const report = execution.result?.report;
  return report === undefined ? undefined : runReasonOf(report);
}

/** The expander a result opens, and the ordinal of the output it reads. */
export type RunResultOpened =
  | {
      readonly opened: "Report";
      readonly report: string;
      readonly summary: number | undefined;
    }
  | {
      readonly opened: "Commands";
      readonly commands: number;
      readonly report: string | undefined;
    };

type ResultArtifact = NonNullable<
  ExecutionResponse["result"]
>["artifacts"][number];

function runResultOutput(
  artifacts: readonly ResultArtifact[],
  matched: (output: NonNullable<ResultArtifact["output"]>) => boolean,
): number | undefined {
  return artifacts.find(
    (artifact) => artifact.output !== undefined && matched(artifact.output),
  )?.ordinal;
}

/** "Commands" for a command stage whose result lists its commands, and
 * otherwise "Report" where there is a report to draw. */
export function runResultOpenedOf(
  execution: ExecutionResponse,
): RunResultOpened | undefined {
  const result = execution.result;
  if (result === undefined) return undefined;
  const report = result.report;
  const commanded = execution.carrier === "Commands";
  const commands = commanded
    ? runResultOutput(
        result.artifacts,
        (output) => output.path === checkOutputPath,
      )
    : undefined;
  if (commands !== undefined) return { opened: "Commands", commands, report };
  if (report === undefined) return undefined;
  const summary = commanded
    ? undefined
    : runResultOutput(
        result.artifacts,
        (output) => output.name === runResultSummaryName,
      );
  return { opened: "Report", report, summary };
}

export type RunCommandEnd = "Passed" | "Failed" | "Killed";

/** One command the stage ran, as its row draws it. */
export interface RunCommand {
  readonly command: string;
  readonly end: RunCommandEnd;
  readonly output: string;
  readonly truncated: boolean;
  /** Whether its output is drawn before a reader asks: the failing one's is. */
  readonly open: boolean;
}

function runCommandEnd(entry: CheckOutputEntry): RunCommandEnd {
  if (entry.exitStatus === null) return "Killed";
  return entry.exitStatus === 0 ? "Passed" : "Failed";
}

/** The commands in the order they ran, or none where the content is not the
 * document a command stage writes. */
export function runResultCommandsOf(
  content: string,
): readonly RunCommand[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  const read = checkOutputSchema.safeParse(parsed);
  if (!read.success || read.data.checks.length === 0) return undefined;
  return read.data.checks.map((entry) => {
    const end = runCommandEnd(entry);
    return {
      command: entry.command,
      end,
      output: entry.output,
      truncated: entry.truncated,
      open: end !== "Passed",
    };
  });
}
