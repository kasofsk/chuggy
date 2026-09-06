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
 * THE REPORT OF A FAILED STAGE CARRIES THE END OF WHAT THE FAILING COMMAND
 * WROTE. The report is what a rework of the ticket is briefed with, and the
 * diagnostic artifact is not; a report that says only the exit status sends
 * the next attempt to guess what the gate found. The tail is taken because a
 * gate names what it found after it ran. It is the tail of the capture, which
 * ends where the capture's bound did, so an excerpt of a truncated capture says
 * so rather than passing for the end of the run.
 *
 * THE REPORT IS MEASURED AFTER EVERYTHING THAT CAN CHANGE ITS LENGTH. The row
 * it becomes refuses a control character, a lone surrogate and any length past
 * its bound, and a refused report is a lost attempt rather than the verdict
 * the stage reached. So the credential scrub runs here, before the cut, since
 * a replacement is longer than what it replaces; control characters become
 * spaces and lone surrogates the replacement character before anything is
 * measured; and every cut lands on a code point. The scrub the entrypoint
 * applies afterwards finds nothing left to replace.
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

/** The characters one stage's report keeps, mirroring the manifest's `resultReportCharsMax`. */
export const workerCheckReportCharsMax = 8_192;

/** What the report says before the failing command's output, which is what makes the excerpt readable as one. */
const checkReportExcerptLabel = "; last output of ";

/** What a scrub is where the caller hands none, which is the suite's case and never the worker's. */
const checkNoScrub = (text) => text;

/** The escape that introduces a terminal control sequence, spelled by code because it is not printable. */
const checkEscape = String.fromCodePoint(0x1b);

/**
 * One terminal control sequence, or any lone control character, which the
 * report row refuses. Built from the escape's code rather than written into a
 * pattern, because a control character spelled in a literal is what the lint
 * rule against them refuses, and here the control character is the point.
 */
const checkControlSequence = new RegExp(
  `${checkEscape}\\[[0-?]*[ -/]*[@-~]|\\p{Cc}`,
  "gu",
);

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

/** Text as the report row accepts it: well formed, with escapes and control characters made spaces. */
function checkClean(text) {
  return text.toWellFormed().replace(checkControlSequence, " ");
}

/** What a command wrote, as one printable line with its whitespace collapsed. */
function checkPrintable(text) {
  return checkClean(text).replace(/\s+/gu, " ").trim();
}

/** The longest head of a well-formed text within this many code units that ends on a code point. */
function checkHead(text, units) {
  let head = "";
  for (const point of text) {
    if (head.length + point.length > units) break;
    head += point;
  }
  return head;
}

/** The longest tail of a well-formed text within this many code units that starts on a code point. */
function checkTail(text, units) {
  let tail = "";
  for (const point of [...text].reverse()) {
    if (tail.length + point.length > units) break;
    tail = point + tail;
  }
  return tail;
}

/**
 * The end of what the failing command wrote, scrubbed and printable, in the
 * room the status lines leave. Nothing is appended where there is no room for
 * the label and at least one character, or where nothing printable was written.
 */
function checkReportExcerpt(failed, room, scrub) {
  const printable = checkPrintable(scrub(failed.output));
  const capture = failed.truncated ? " (capture truncated)" : "";
  const label = checkClean(
    scrub(`${checkReportExcerptLabel}${failed.command}${capture}: `),
  );
  const kept = room - label.length;
  if (printable.length === 0 || kept < 1) return "";
  return `${label}${checkTail(printable, kept)}`;
}

/** The stage's report: every command that ran, its status, and the end of what the failing one wrote. */
function checkReport(commands, ran, scrub) {
  const skipped = commands.length - ran.length;
  const lines = [
    ...ran.map(checkReportLine),
    ...(skipped > 0 ? [`${String(skipped)} later command(s) did not run`] : []),
  ];
  const status = checkHead(
    checkClean(scrub(lines.join("; "))),
    workerCheckReportCharsMax,
  );
  const failed = ran.find((outcome) => !checkPassed(outcome));
  if (failed === undefined) return status;
  const room = workerCheckReportCharsMax - status.length;
  return `${status}${checkReportExcerpt(failed, room, scrub)}`;
}

/**
 * Runs one check stage: every command in order, stopping at the first that does
 * not exit cleanly, and reporting each command's own status through the
 * caller's credential scrub.
 */
export async function runChecks(context, commands, services = {}) {
  if (commands.length === 0)
    throw new Error("check stage was handed no commands to run");
  const {
    spawnProcess = spawn,
    write = (text) => process.stdout.write(text),
    scrub = checkNoScrub,
  } = services;
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
      summary: checkReport(commands, ran, scrub),
    },
  };
}
