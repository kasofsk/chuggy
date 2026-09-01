/**
 * The check stage the worker runs itself: the command lines the plane resolved,
 * run in order in the repository workspace, and the verdict, report and
 * diagnostic they produce.
 *
 * THE WORKER RUNS THE LIST IT WAS HANDED. `Commands` mode carries the resolved
 * lines, so nothing here reads a configuration block, and a stage's lines can
 * gain another source without a second path into the worker.
 *
 * THE FIRST NONZERO EXIT STOPS THE STAGE. What follows a failing command cannot
 * be trusted to mean anything, so the commands after it do not run and are not
 * reported as having passed.
 *
 * THE REPORT KEEPS THE STATUS AND NOT ONLY THE VERDICT, because a gate that
 * could not run and a gate that found something are both a failed stage and are
 * not the same fact. The captured output is the diagnostic artifact's, bounded
 * per command so a chatty gate cannot take the run's memory with it.
 */

import { spawn } from "node:child_process";

/** The characters one command's captured output keeps before it is truncated. */
export const workerCheckOutputCharsMax = 262_144;

/** The characters one stage's report keeps, which is the manifest summary's bound. */
export const workerCheckReportCharsMax = 8_192;

/** The resolved command lines this task runs itself, or nothing when an agent runs it. */
export function workerCheckCommands(task) {
  const mode = task.worker?.mode;
  return mode?.type === "Commands" ? mode.commands : undefined;
}

/** One command's exit as a reader reads it: a status, or the signal that replaced one. */
function checkExit(code, signal) {
  return code === null
    ? { exitStatus: null, signal: signal ?? "unknown" }
    : { exitStatus: code };
}

/** One command's account: what ran, how it ended, and what it wrote. */
async function runCheckCommand(command, directory, spawnProcess) {
  const child = spawnProcess("/bin/sh", ["-eu", "-c", command], {
    cwd: directory,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let truncated = false;
  const capture = (chunk) => {
    const room = workerCheckOutputCharsMax - output.length;
    if (chunk.length > room) truncated = true;
    output += chunk.slice(0, room);
  };
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", capture);
  }
  const [code, signal] = await new Promise((settle, refuse) => {
    child.once("error", refuse);
    child.once("close", (exitCode, exitSignal) =>
      settle([exitCode, exitSignal]),
    );
  });
  return { command, ...checkExit(code, signal), truncated, output };
}

/** How one command's end reads in the stage's report. */
function checkReportLine(ran) {
  return ran.exitStatus === null
    ? `${ran.command} was killed by ${ran.signal}`
    : `${ran.command} exited ${String(ran.exitStatus)}`;
}

/** The stage's report: every command that ran, and the status it ended with. */
function checkReport(commands, ran) {
  const skipped = commands.length - ran.length;
  const lines = [
    ...ran.map(checkReportLine),
    ...(skipped > 0 ? [`${String(skipped)} later command(s) did not run`] : []),
  ];
  return lines.join("; ").slice(0, workerCheckReportCharsMax);
}

/**
 * Runs one check stage: every command in order, stopping at the first that does
 * not exit zero, and reporting each command's own status.
 */
export async function runChecks(context, commands, spawnProcess = spawn) {
  if (commands.length === 0)
    throw new Error("check stage was handed no commands to run");
  const ran = [];
  for (const command of commands) {
    const outcome = await runCheckCommand(
      command,
      context.directory,
      spawnProcess,
    );
    ran.push(outcome);
    if (outcome.exitStatus !== 0) break;
  }
  const passed =
    ran.length === commands.length &&
    ran.every((outcome) => outcome.exitStatus === 0);
  return {
    output: { checks: ran },
    result: {
      verdict: passed ? "Pass" : "Fail",
      summary: checkReport(commands, ran),
    },
  };
}
