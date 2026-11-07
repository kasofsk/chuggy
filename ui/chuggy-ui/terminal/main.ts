/**
 * The setup program's entry: a person's coding agent runs this file under
 * Node, reads the lines it prints, and runs the command its last line names.
 *
 * The Node check is imported first and for its effect, so nothing below it is
 * evaluated on a Node too old to run it. Everything decided is decided in
 * `ui/chuggy-ui/app/core/`; this composes the machine's ports and the pacing
 * its environment names, runs once and prints the report, in the words of
 * the console's own catalog.
 */

import { script } from "./nodeGate.ts";

import { copyTextEn } from "../app/copy/catalog.ts";
import { setupAnswersAsked } from "../app/core/setupArguments.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import { setupRun } from "../app/core/setupRun.ts";
import { pacingOf, portsOf } from "./ports.ts";

const argv = process.argv.slice(2);

void setupRun(portsOf(script), argv, pacingOf()).then((report) => {
  const lines = setupReportLines(
    report,
    script,
    copyTextEn,
    setupAnswersAsked(argv),
  );
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exitCode = setupReportExit(report);
});
