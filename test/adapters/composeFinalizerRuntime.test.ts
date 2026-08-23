/**
 * The finalizer's outermost composition: the preconditions a deployment is held
 * to, and the ports it promotes through once they are met.
 *
 * THE GIT PORT IS BUILT ON DEMAND AND THAT IS LOAD-BEARING. Opening a scratch
 * refuses an absent git by raising, so composing one before the preconditions
 * are asked would turn `git-available` into a crash and report nothing.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { composeFinalizerRuntime } from "../../src/compose.ts";
import {
  finalizerSettingsOf,
  type FinalizerSettings,
} from "../../src/interpreter/finalizerSettings.ts";

function settings(t: TestContext): FinalizerSettings {
  const root = mkdtempSync(join(tmpdir(), "chuggy-compose-finalizer-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const credential = join(root, "credential");
  writeFileSync(credential, "secret-a1b2c3");
  return finalizerSettingsOf({
    CHUG_FINALIZER_DATABASE_URL: "postgres://finalizer@localhost/chuggy",
    CHUG_FINALIZER_OWNER: "finalizer-1",
    CHUG_FINALIZER_RECOVERY_EPOCH: "epoch-1",
    CHUG_FINALIZER_ARTIFACT_ROOT: root,
    CHUG_FINALIZER_GIT_SCRATCH_ROOT: join(root, "scratch"),
    CHUG_FINALIZER_GIT_COMMIT_NAME: "chuggy",
    CHUG_FINALIZER_GIT_COMMIT_EMAIL: "chuggy@example.invalid",
    CHUG_FINALIZER_CREDENTIAL_SOURCES: JSON.stringify([
      { repository: "https://example.invalid/one.git", path: credential },
    ]),
    PATH: process.env["PATH"] ?? "",
  });
}

test("a deployment is held to its git, its scratch, its storage and its credentials", async (t) => {
  const composition = composeFinalizerRuntime(settings(t));
  assert.deepEqual(
    composition.preconditions.map((precondition) => precondition.name),
    [
      "git-available",
      "git-scratch-writable",
      "artifact-root-writable",
      "repository-credentials-available",
    ],
  );
  const signal = new AbortController().signal;
  for (const precondition of composition.preconditions)
    assert.equal(await precondition.check(signal), true, precondition.name);
});

test("the composed service promotes through the port and stores under the named root", (t) => {
  const parsed = settings(t);
  const service = composeFinalizerRuntime(parsed).service();
  assert.equal(service.artifactRoot, parsed.artifactRoot);
  assert.equal(typeof service.git.promoteCandidate, "function");
});

test("composing yields no git port until one is asked for", (t) => {
  const parsed = settings(t);
  const composition = composeFinalizerRuntime({
    ...parsed,
    git: { ...parsed.git, environment: { PATH: parsed.artifactRoot } },
  });
  assert.throws(() => composition.service());
});
