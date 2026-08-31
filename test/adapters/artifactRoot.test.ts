/**
 * The one thing artifact storage must be before it is asked for an artifact,
 * asked as the verdict a runtime reports.
 *
 * A ROOT THAT IS NOT THERE STAYS NOT THERE. The check must not make one, because
 * an empty directory standing in for unmounted storage is the failure this
 * precondition exists to report.
 */

import assert from "node:assert/strict";
import {
  runtimePreconditionUndecided,
  type RuntimePreconditionVerdict,
} from "../../src/interpreter/serviceRuntime.ts";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { artifactRootPrecondition } from "../../src/adapters/artifacts/artifactRoot.ts";

const signal = new AbortController().signal;

function directory(t: TestContext): string {
  const made = mkdtempSync(join(tmpdir(), "chuggy-artifact-root-"));
  t.after(() => {
    chmodSync(made, 0o700);
    rmSync(made, { recursive: true, force: true });
  });
  return made;
}

async function unmet(
  check: Promise<RuntimePreconditionVerdict>,
): Promise<boolean> {
  return (await check.catch(runtimePreconditionUndecided)).met === "Met";
}

test("a writable directory meets the precondition and nothing else does", async (t) => {
  const root = directory(t);
  const precondition = artifactRootPrecondition(root);
  assert.equal(precondition.name, "artifact-root-writable");
  assert.equal(await unmet(precondition.check(signal)), true);
  const file = join(root, "file");
  writeFileSync(file, "");
  assert.equal(
    await unmet(artifactRootPrecondition(file).check(signal)),
    false,
  );
  const absent = join(root, "absent");
  assert.equal(
    await unmet(artifactRootPrecondition(absent).check(signal)),
    false,
  );
  assert.equal(existsSync(absent), false);
});

test("a root this process may not write into is reported rather than repaired", async (t) => {
  const root = directory(t);
  chmodSync(root, 0o500);
  assert.equal(
    await unmet(artifactRootPrecondition(root).check(signal)),
    false,
  );
});
