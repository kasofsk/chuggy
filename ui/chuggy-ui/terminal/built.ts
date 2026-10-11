/**
 * The build's last step: the setup program as it was just built, started once.
 *
 * Every step before this one reads the program's source, and a bundle can
 * differ from its source in ways only running it shows: a module of Node's
 * named so that the bundler puts a stand-in where it was parses, typechecks
 * and builds, and stops on its first call. So the file is run as a person's
 * agent first runs it, bare, under a home made for the purpose with nothing
 * remembered and for a bounded time, and it must print what that run prints
 * and exit as that run exits. Being last, this is also what notices a step
 * that left the output directory without the program in it.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { setupProgramPath } from "../app/core/setupProgram.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";

/** Far past what a first run takes, so what it ends is a program that hung. */
const startMsMax = 30_000;

/** Past anything a first run prints, and enough of a trace to say what stopped it. */
const outputBytesMax = 16_384;

/** What a bare run reports on a machine that remembers nothing. */
const first: SetupReport = { report: "SiteUnknown" };

/** Why the built program is not one a person can run, or nothing where it is. */
function fault(built: string): string | undefined {
  if (!existsSync(built)) return "is not there";
  const home = mkdtempSync(join(tmpdir(), "chuggy-setup-built-"));
  try {
    const ran = spawnSync(process.execPath, [built], {
      env: { HOME: home, PATH: process.env["PATH"] ?? "" },
      encoding: "utf8",
      timeout: startMsMax,
      killSignal: "SIGKILL",
      maxBuffer: outputBytesMax,
    });
    if (ran.error !== undefined)
      return "did not run to its end within its bounds";
    const printed = `${setupReportLines(first, built).join("\n")}\n`;
    if (ran.stdout === printed && ran.status === setupReportExit(first))
      return undefined;
    const said = ran.stderr.split("\n").find((line) => /Error/u.test(line));
    return `did not start as a first run does: exit ${String(ran.status)}${said === undefined ? "" : `, saying ${said.trim()}`}`;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const built = resolve(process.argv[2] ?? "dist", setupProgramPath.slice(1));
const found = fault(built);
process.stdout.write(
  `the setup program at ${built} ${found ?? "starts as a first run does"}\n`,
);
if (found !== undefined) process.exitCode = 1;
