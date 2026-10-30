/**
 * How a job's container is started from a runtime, and the statuses its check
 * names an image's faults by, read as the runner and the site that act on them
 * would read them.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  isHeldCredentialVariable,
  workerImageFaults,
  workerImageFaultStatuses,
  workerJobCommand,
  workerRepositoryDirectory,
  workerRuntimeDirectory,
  workerWorkspaceDirectory,
} from "../../src/contract/workerEnvironment.ts";

/** The highest status a shell ends a script with that failed or that it could not read. */
const workerShellFailureStatusMax = 2;

/** The lowest status a shell gives a command it could not start, the ones a signal killed being above it. */
const workerShellReservedFrom = 126;

test("a job's container runs the runtime's check under the image's own shell, from inside the runtime's directory", () => {
  const [shell, check, ...rest] = workerJobCommand;
  assert.equal(shell, "/bin/sh");
  assert.equal(check, `${workerRuntimeDirectory}/check.sh`);
  assert.deepEqual(rest, []);
  assert.ok(workerRuntimeDirectory.startsWith("/"));
});

test("each status the check exits with names one fault, and none is one a shell or a signal could have ended the check with", () => {
  const statuses = Object.values(workerImageFaultStatuses);
  assert.equal(new Set(statuses).size, statuses.length);
  for (const [fault, status] of Object.entries(workerImageFaultStatuses)) {
    assert.ok(
      (workerImageFaults as readonly string[]).includes(fault),
      `${fault} is not an image fault`,
    );
    assert.ok(
      Number.isInteger(status) &&
        status > workerShellFailureStatusMax &&
        status < workerShellReservedFrom,
      `${fault} exits ${String(status)}, which is not the check's own to name`,
    );
  }
});

test("the check names by status every fault met once the image's shell has started it, and none met before", () => {
  const started = workerImageFaults.indexOf("ImageLacksShell") + 1;
  assert.deepEqual(
    Object.keys(workerImageFaultStatuses),
    workerImageFaults.slice(started),
  );
});

test("a job's container works in the contract's workspace and has its repository checked out inside it, apart from the runtime", () => {
  assert.equal(workerWorkspaceDirectory, "/workspace");
  assert.equal(workerRepositoryDirectory, "/workspace/repository");
  assert.ok(
    !workerWorkspaceDirectory.startsWith(`${workerRuntimeDirectory}/`) &&
      !workerRuntimeDirectory.startsWith(`${workerWorkspaceDirectory}/`),
  );
});

test("a held credential is written under a variable ending _FILE, and never under one chuggy, its agent or git reads", () => {
  for (const variable of ["TRACK_RECORD_TOKEN_FILE", "A_FILE", "X9_FILE"])
    assert.ok(isHeldCredentialVariable(variable), variable);
  for (const variable of [
    "TRACK_RECORD_TOKEN",
    "_FILE",
    "9_FILE",
    "track_record_FILE",
    "TRACK-RECORD_FILE",
    "TRACK_RECORD_FILE ",
    "CHUG_TOKEN_FILE",
    "CLAUDE_TOKEN_FILE",
    "GIT_TOKEN_FILE",
  ])
    assert.ok(!isHeldCredentialVariable(variable), variable);
});
