/**
 * The check stage the worker runs itself, driven against real processes.
 *
 * THE CASES BELOW SPAWN `/bin/sh`, because what the stage claims is about exit
 * status, ordering and captured output, and a stubbed child process would be a
 * restatement of the code rather than a check on it.
 *
 * THE BOUNDS THE PLANE OWNS ARE IMPORTED FROM IT. A running worker cannot read
 * the TypeScript the plane is written in, so this module restates the upload
 * bound it is written against; the cases below import the plane's own and
 * refuse the restatement once it stops being the same figure.
 */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { workerPlaneUploadBytesMax } from "../../src/contract/http.ts";
import { resultReportCharsMax } from "../../src/interpreter/resultManifest.ts";
import {
  briefingLineCharsMax,
  evaluationChecksMax,
} from "../../src/interpreter/taskConfiguration.ts";
import { credentialScrub } from "./runEvidence.mjs";
import {
  runChecks,
  workerCheckArtifactBytesMax,
  workerCheckCommands,
  workerCheckOutputCharsMax,
  workerCheckReportCharsMax,
  workerCheckStageOutputCharsMax,
} from "./checks.mjs";

const workspace = { directory: process.cwd() };

/** The character a capture can hold that costs an escape rather than a byte. */
const controlCharacter = String.fromCodePoint(1);

/** The printable character an authored command line can hold that costs the most bytes. */
const replacementCharacter = String.fromCodePoint(0xfffd);

/** That control character as a serialized artifact spells it. */
const controlEscape = JSON.stringify(controlCharacter).slice(1, -1);

/** A command that writes more than one command's capture keeps. */
const chatty = `yes chatter | head -c ${String(workerCheckOutputCharsMax * 2)}`;

/**
 * One stage, run with its streaming discarded unless the case is about that.
 * A suite that let a chatty command through would print what it produced.
 */
function ran(commands, services = {}) {
  return runChecks(workspace, commands, {
    write: () => undefined,
    ...services,
  });
}

test("a check stage is the mode the task carries and nothing else", () => {
  assert.deepEqual(
    workerCheckCommands({
      worker: { mode: { type: "Commands", commands: ["true", "false"] } },
    }),
    ["true", "false"],
  );
  assert.equal(
    workerCheckCommands({
      worker: { mode: { type: "SingleAgent", agent: "Claude", arguments: [] } },
    }),
    undefined,
  );
  assert.equal(workerCheckCommands({}), undefined);
});

test("a stage whose every command exits zero passes", async () => {
  const { result, output } = await ran(["exit 0", "printf done"]);

  assert.equal(result.verdict, "Pass");
  assert.equal(result.summary, "exit 0 exited 0; printf done exited 0");
  assert.deepEqual(
    output.checks.map((check) => check.exitStatus),
    [0, 0],
  );
});

test("a nonzero exit fails the stage", async () => {
  const { result } = await ran(["exit 1"]);

  assert.equal(result.verdict, "Fail");
});

test("a stage stops at the first command that does not exit zero", async () => {
  const { result, output } = await ran(["exit 0", "exit 1", "exit 0"]);

  assert.equal(result.verdict, "Fail");
  assert.deepEqual(
    output.checks.map((check) => check.command),
    ["exit 0", "exit 1"],
  );
  assert.ok(
    result.summary.includes("1 later command(s) did not run"),
    result.summary,
  );
});

test("the report separates a gate that could not run from one that found something", async () => {
  const couldNotRun = await ran(["exit 2"]);
  const found = await ran(["exit 1"]);

  assert.equal(couldNotRun.result.summary, "exit 2 exited 2");
  assert.equal(found.result.summary, "exit 1 exited 1");
  assert.equal(couldNotRun.result.verdict, "Fail");
  assert.equal(found.result.verdict, "Fail");
});

test("a command killed by a signal is reported as killed and fails the stage", async () => {
  const { result, output } = await ran(["kill -TERM $$"]);

  assert.equal(result.verdict, "Fail");
  assert.equal(output.checks[0].exitStatus, null);
  assert.equal(output.checks[0].signal, "SIGTERM");
  assert.equal(result.summary, "kill -TERM $$ was killed by SIGTERM");
});

test("a command killed by a signal stops the stage like any other failure", async () => {
  const { result, output } = await ran(["kill -TERM $$", "printf ran"]);

  assert.equal(result.verdict, "Fail");
  assert.deepEqual(
    output.checks.map((check) => check.command),
    ["kill -TERM $$"],
  );
  assert.equal(
    result.summary,
    "kill -TERM $$ was killed by SIGTERM; 1 later command(s) did not run",
  );
});

test("both streams are captured and a chatty command is bounded", async () => {
  const { output } = await ran(["printf out; printf err >&2", chatty]);

  assert.ok(output.checks[0].output.includes("out"));
  assert.ok(output.checks[0].output.includes("err"));
  assert.equal(output.checks[0].truncated, false);
  assert.equal(output.checks[1].output.length, workerCheckOutputCharsMax);
  assert.equal(output.checks[1].truncated, true);
});

test("what a stage captures across its commands is bounded as one total", async () => {
  const { output } = await ran([chatty, chatty]);

  const kept = output.checks.reduce(
    (total, check) => total + check.output.length,
    0,
  );
  assert.ok(
    workerCheckOutputCharsMax * 2 > workerCheckStageOutputCharsMax,
    "the case must ask for more than the stage total",
  );
  assert.equal(kept, workerCheckStageOutputCharsMax);
  assert.equal(output.checks[1].truncated, true);
});

test("the worker is written against the bounds the plane enforces", () => {
  assert.equal(workerCheckArtifactBytesMax, workerPlaneUploadBytesMax);
  assert.equal(workerCheckReportCharsMax, resultReportCharsMax);
});

test("the worst artifact a stage can produce is one the plane accepts", () => {
  const command = replacementCharacter.repeat(briefingLineCharsMax);
  const perCommand = Math.ceil(
    workerCheckStageOutputCharsMax / evaluationChecksMax,
  );
  const checks = Array.from({ length: evaluationChecksMax }, () => ({
    command,
    exitStatus: null,
    signal: "SIGKILL",
    truncated: true,
    output: controlCharacter.repeat(perCommand),
  }));
  const serialized = `${JSON.stringify({ checks }, null, 2)}\n`;
  const scrub = credentialScrub([controlEscape.repeat(3)]);

  assert.ok(
    Buffer.byteLength(scrub(serialized)) < workerPlaneUploadBytesMax,
    `the worst artifact is ${String(Buffer.byteLength(scrub(serialized)))} bytes`,
  );
});

test("a stage handed no commands is a crashed run and never a pass", async () => {
  await assert.rejects(ran([]), /check stage was handed no commands to run/u);
});

test("each command runs in the workspace the stage was given", async () => {
  const { output } = await runChecks({ directory: "/" }, ["pwd"], {
    write: () => undefined,
  });

  assert.equal(output.checks[0].output.trim(), "/");
});

test("what a command writes reaches the worker's own stdout as it runs", async () => {
  const written = [];

  const { output } = await runChecks(
    workspace,
    ["printf out; printf err >&2"],
    { write: (text) => written.push(text) },
  );

  assert.equal(written.join(""), output.checks[0].output);
  assert.ok(written.join("").includes("out"));
  assert.ok(written.join("").includes("err"));
});

test("stdout keeps what the capture had to drop", async () => {
  const written = [];

  const { output } = await ran([chatty], {
    write: (text) => written.push(text),
  });

  assert.equal(output.checks[0].output.length, workerCheckOutputCharsMax);
  assert.equal(written.join("").length, workerCheckOutputCharsMax * 2);
});
