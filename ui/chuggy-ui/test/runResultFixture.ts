/**
 * Results as a row reads them: a report, the outputs a result lists, and the
 * document a command stage writes of the commands it ran.
 *
 * Shared by the suites about the row's line, its result expander and the
 * decision beneath both, because each reads the same results and differs only
 * in what it asks of them.
 */

import { runDigest, runSettledLost } from "./runPageFixture.tsx";

/** The failing gate ticket 68's check stopped on, in the words it printed. */
export const runResultGateLine =
  "check-comments ERROR ui/chuggy-ui/test/ticketLedger.test.ts:67: a block comment that is not a doc comment";

/** A command stage's report, which opens with each command and how it exited. */
export const runResultCheckReport = `.chug/tasks/ci.sh exited 1 · ${runResultGateLine}`;

/** A reviewer's report, past the length a row's line keeps. */
export const runResultReviewReport = `Changes requested: ${"the ledger draws no result on its row; ".repeat(6)}and the preview interprets nothing.`;

/** An artifact as the result lists it, under the output a case declares it as. */
export function runResultArtifact(
  ordinal: number,
  path: string,
  output?: { readonly name: string; readonly renderer: string },
): Record<string, unknown> {
  return {
    ordinal,
    role: "Diagnostic",
    path,
    digest: runDigest,
    bytes: 2048,
    ...(output === undefined
      ? {}
      : {
          output: {
            name: output.name,
            path,
            mediaType:
              output.renderer === "Json" ? "application/json" : "text/markdown",
            renderer: output.renderer,
          },
        }),
  };
}

export const runResultCheckOutput = runResultArtifact(
  1,
  ".chuggy/check-output.json",
  { name: "check-output", renderer: "Json" },
);

export const runResultWorkSummary = runResultArtifact(
  1,
  ".chuggy/outputs/summary.md",
  { name: "work-summary", renderer: "Markdown" },
);

/** A failed result of attempt `a1` listing what a case names. */
export function runResultFailed(
  report: string | undefined,
  artifacts: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ ...runSettledLost("a1"), artifacts, report }).filter(
      ([, value]) => value !== undefined,
    ),
  );
}

/** The commands of a check that passed its first and failed its second. */
export const runResultChecks = [
  {
    command: "npm ci",
    exitStatus: 0,
    truncated: false,
    output: "added 812 packages\n",
  },
  {
    command: ".chug/tasks/ci.sh",
    exitStatus: 1,
    truncated: false,
    output: `check-paths: clean\n${runResultGateLine}\n`,
  },
];

/** The content the artifact route answers for a document a case names. */
export function runResultContent(
  content: string,
  renderer = "Json",
): Record<string, unknown> {
  return {
    read: "Content",
    mediaType: renderer === "Json" ? "application/json" : "text/markdown",
    renderer,
    encoding: "Utf8",
    content,
  };
}
