/**
 * The check stage the worker runs itself, driven against real processes.
 *
 * THE CASES BELOW SPAWN `/bin/sh`, because what the stage claims is about exit
 * status, ordering and captured output, and a stubbed child process would be a
 * restatement of the code rather than a check on it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  runChecks,
  workerCheckCommands,
  workerCheckOutputCharsMax,
} from "./checks.mjs";

const workspace = { directory: process.cwd() };

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
  const { result, output } = await runChecks(workspace, [
    "exit 0",
    "printf done",
  ]);

  assert.equal(result.verdict, "Pass");
  assert.equal(result.summary, "exit 0 exited 0; printf done exited 0");
  assert.deepEqual(
    output.checks.map((check) => check.exitStatus),
    [0, 0],
  );
});

test("a nonzero exit fails the stage", async () => {
  const { result } = await runChecks(workspace, ["exit 1"]);

  assert.equal(result.verdict, "Fail");
});

test("a stage stops at the first command that does not exit zero", async () => {
  const { result, output } = await runChecks(workspace, [
    "exit 0",
    "exit 1",
    "exit 0",
  ]);

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
  const couldNotRun = await runChecks(workspace, ["exit 2"]);
  const found = await runChecks(workspace, ["exit 1"]);

  assert.equal(couldNotRun.result.summary, "exit 2 exited 2");
  assert.equal(found.result.summary, "exit 1 exited 1");
  assert.equal(couldNotRun.result.verdict, "Fail");
  assert.equal(found.result.verdict, "Fail");
});

test("a command killed by a signal is reported as killed and fails the stage", async () => {
  const { result, output } = await runChecks(workspace, ["kill -TERM $$"]);

  assert.equal(result.verdict, "Fail");
  assert.equal(output.checks[0].exitStatus, null);
  assert.equal(output.checks[0].signal, "SIGTERM");
  assert.equal(result.summary, "kill -TERM $$ was killed by SIGTERM");
});

test("both streams are captured and a chatty command is bounded", async () => {
  const { output } = await runChecks(workspace, [
    "printf out; printf err >&2",
    `yes chatter | head -c ${String(workerCheckOutputCharsMax * 2)}`,
  ]);

  assert.ok(output.checks[0].output.includes("out"));
  assert.ok(output.checks[0].output.includes("err"));
  assert.equal(output.checks[0].truncated, false);
  assert.equal(output.checks[1].output.length, workerCheckOutputCharsMax);
  assert.equal(output.checks[1].truncated, true);
});

test("a stage handed no commands is a crashed run and never a pass", async () => {
  await assert.rejects(
    runChecks(workspace, []),
    /check stage was handed no commands to run/u,
  );
});

test("each command runs in the workspace the stage was given", async () => {
  const { output } = await runChecks({ directory: "/" }, ["pwd"]);

  assert.equal(output.checks[0].output.trim(), "/");
});
