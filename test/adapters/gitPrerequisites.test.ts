/**
 * The two things a promotion adapter needs before it can serve any work, each
 * asked as the verdict a runtime reports rather than as an exception.
 *
 * A GIT THAT IS NOT THERE IS UNMET AND NOT A CRASH, which is the whole reason
 * these exist beside `scratchOpen`'s refusal; the environment naming an empty
 * path is how a deployment without git is reached with no git uninstalled.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  gitAvailablePrecondition,
  gitScratchWritablePrecondition,
} from "../../src/adapters/git/gitPrerequisites.ts";

const signal = new AbortController().signal;

function directory(t: TestContext): string {
  const made = mkdtempSync(join(tmpdir(), "chuggy-prerequisites-"));
  t.after(() => {
    chmodSync(made, 0o700);
    rmSync(made, { recursive: true, force: true });
  });
  return made;
}

async function unmet(check: Promise<boolean>): Promise<boolean> {
  return check.catch(() => false);
}

test("git is available where this suite's own environment finds it", async () => {
  const precondition = gitAvailablePrecondition(process.env);
  assert.equal(precondition.name, "git-available");
  assert.equal(await unmet(precondition.check(signal)), true);
});

test("an environment whose path names no git leaves the precondition unmet", async (t) => {
  const empty = directory(t);
  assert.equal(
    await unmet(gitAvailablePrecondition({ PATH: empty }).check(signal)),
    false,
  );
});

test("a scratch is made where it is missing and reported where it cannot be", async (t) => {
  const root = directory(t);
  const scratch = join(root, "nested", "scratch");
  const precondition = gitScratchWritablePrecondition(scratch);
  assert.equal(precondition.name, "git-scratch-writable");
  assert.equal(await unmet(precondition.check(signal)), true);
  chmodSync(root, 0o500);
  assert.equal(
    await unmet(
      gitScratchWritablePrecondition(join(root, "refused")).check(signal),
    ),
    false,
  );
});
