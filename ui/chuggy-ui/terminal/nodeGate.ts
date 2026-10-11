/**
 * Stops the setup program on a Node too old to run it, with the report that
 * says which Node it needs.
 *
 * The entry imports this module first and the bundle keeps that order, so
 * this is the first thing the file does: nothing the rest of it needs of a
 * newer Node has been evaluated yet. The line is written to the descriptor
 * itself and the process ended at once, because a write left in a queue is
 * lost when the process ends, and carrying on would run what this Node cannot.
 */

import { writeSync } from "node:fs";

import { setupNodeAccepted, setupNodeMajor } from "../app/core/setupProgram.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";

/** Where the program was run from, as a `next:` line names it. */
export const script = process.argv[1] ?? "chuggy-setup.mjs";

if (!setupNodeAccepted(process.versions.node)) {
  const report: SetupReport = {
    report: "NodeOld",
    major: setupNodeMajor(process.versions.node),
  };
  writeSync(1, `${setupReportLines(report, script).join("\n")}\n`);
  process.exit(setupReportExit(report));
}
