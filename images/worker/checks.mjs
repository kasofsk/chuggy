/**
 * The check stage the worker runs itself: the command lines the plane resolved,
 * run in order in the repository workspace, and the verdict, report and
 * diagnostic they produce.
 *
 * THE WORKER RUNS THE LIST IT WAS HANDED. `Commands` mode carries the resolved
 * lines, so nothing here reads a configuration block, and a stage's lines can
 * gain another source without a second path into the worker.
 *
 * THE FIRST FAILURE STOPS THE STAGE, and a command killed by a signal is a
 * failure like any other. What follows a command that did not exit cleanly
 * cannot be trusted to mean anything, so the commands after it do not run and
 * are not reported as having passed.
 *
 * THE REPORT KEEPS THE STATUS AND NOT ONLY THE VERDICT, because a gate that
 * could not run and a gate that found something are both a failed stage and are
 * not the same fact.
 *
 * WHAT A COMMAND WRITES GOES TWO PLACES. It is streamed to the worker's own
 * stdout as it arrives, so a stage that dies mid-run leaves the pod log the
 * account it reached; and it is captured, bounded, for the diagnostic artifact
 * the plane keeps.
 *
 * THE CAPTURE IS BOUNDED AGAINST THE UPLOAD AND NOT AGAINST MEMORY. The
 * artifact the plane refuses is the one that turns a stage's Fail into a
 * crashed run, so the stage's whole room is taken from what one upload may
 * weigh, and one command's own cap only keeps a single chatty gate from
 * spending all of it.
 */

import { spawn } from "node:child_process";

/**
 * What one upload may weigh, mirroring the worker plane's `uploadBytesMax`
 * default. A body over it is refused, and a refused diagnostic ends the attempt
 * as a crashed run rather than the verdict the stage actually reached.
 */
export const workerCheckArtifactBytesMax = 4_194_304;

/**
 * What one character of a stage's own text can cost in that artifact. The
 * artifact is UTF-8 JSON, where the worst character escapes rather than
 * encoding as bytes, and it then passes the credential scrub, which can only
 * lengthen what it replaces. Neither is measured here: both are bounds, and the
 * suite builds the worst case and weighs it.
 */
const checkArtifactCharBytesMax = 8;

/** The room the artifact's own keys, indentation and command lines are left. */
const checkArtifactFrameBytesMax = 65_536;

/** The characters one whole stage keeps, which is what is left of the upload. */
export const workerCheckStageOutputCharsMax = Math.floor(
  (workerCheckArtifactBytesMax - checkArtifactFrameBytesMax) /
    checkArtifactCharBytesMax,
);

/** The characters one command keeps, so no single command spends the stage's room. */
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

/** Whether this command ended the way a stage may carry on after. */
function checkPassed(outcome) {
  return outcome.exitStatus === 0;
}

/** One command's account: what ran, how it ended, and what it wrote. */
async function runCheckCommand(command, room, services) {
  const child = services.spawnProcess("/bin/sh", ["-eu", "-c", command], {
    cwd: services.directory,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let truncated = false;
  const capture = (chunk) => {
    services.write(chunk);
    const left = Math.min(workerCheckOutputCharsMax, room) - output.length;
    if (chunk.length > left) truncated = true;
    output += chunk.slice(0, Math.max(left, 0));
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
 * not exit cleanly, and reporting each command's own status.
 */
export async function runChecks(context, commands, services = {}) {
  if (commands.length === 0)
    throw new Error("check stage was handed no commands to run");
  const { spawnProcess = spawn, write = (text) => process.stdout.write(text) } =
    services;
  const ran = [];
  let kept = 0;
  for (const command of commands) {
    const outcome = await runCheckCommand(
      command,
      workerCheckStageOutputCharsMax - kept,
      { directory: context.directory, spawnProcess, write },
    );
    kept += outcome.output.length;
    ran.push(outcome);
    if (!checkPassed(outcome)) break;
  }
  const passed = ran.length === commands.length && ran.every(checkPassed);
  return {
    output: { checks: ran },
    result: {
      verdict: passed ? "Pass" : "Fail",
      summary: checkReport(commands, ran),
    },
  };
}
