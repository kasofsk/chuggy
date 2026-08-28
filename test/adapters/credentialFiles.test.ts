/**
 * The credential source against real files: what a configured repository
 * resolves to, what an unconfigured one does, and the difference between a
 * denial and an outage.
 *
 * THE NEGATIVE SPACE IS HALF THE POINT. A resolution must carry no message that
 * could quote a secret, a repository this deployment names no file for must be
 * denied rather than reported unreachable, a file bigger than a credential may
 * be must be refused rather than truncated into a different one, and a value
 * must be read afresh for every act rather than remembered from the first.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  credentialFiles,
  credentialFilesDefaults,
  credentialFilesPrecondition,
  forgeCredentialFiles,
  forgeCredentialFilesPrecondition,
} from "../../src/adapters/credentials/credentialFiles.ts";
import {
  asForgeBindingId,
  asForgeCredentialReference,
} from "../../src/interpreter/changeProposal.ts";
import {
  finalizerIdentityCharsMax,
  asRepositoryId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";

const one = asRepositoryId("https://example.invalid/one.git");
const other = asRepositoryId("https://example.invalid/other.git");

const binding = (repository = one): RepositoryBinding => ({
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  repository,
  recoveryEpoch: asRecoveryEpoch("epoch-1"),
});

function directory(t: TestContext): string {
  const made = mkdtempSync(join(tmpdir(), "chuggy-credentials-"));
  t.after(() => {
    rmSync(made, { recursive: true, force: true });
  });
  return made;
}

test("a configured repository resolves to what its file holds", async (t) => {
  const root = directory(t);
  const path = join(root, "one");
  writeFileSync(path, "secret-a1b2c3\n");
  const resolved = await credentialFiles({
    sources: [{ repository: one, path }],
  }).credential(binding());
  assert.deepEqual(resolved, {
    resolved: "Credential",
    credential: "secret-a1b2c3",
  });
});

test("a credential larger than a stored identity remains available", async (t) => {
  const root = directory(t);
  const path = join(root, "one");
  const credential = "s".repeat(finalizerIdentityCharsMax + 1);
  writeFileSync(path, credential);
  assert.deepEqual(
    await credentialFiles({ sources: [{ repository: one, path }] }).credential(
      binding(),
    ),
    { resolved: "Credential", credential },
  );
});

test("a repository this deployment names no file for is denied", async (t) => {
  const root = directory(t);
  const path = join(root, "one");
  writeFileSync(path, "secret-a1b2c3");
  const source = credentialFiles({ sources: [{ repository: one, path }] });
  assert.deepEqual(await source.credential(binding(other)), {
    resolved: "Denied",
  });
});

test("repository roles resolve only their independently named credential", async (t) => {
  const root = directory(t);
  const workPath = join(root, "work");
  const handoffPath = join(root, "handoff");
  writeFileSync(workPath, "work-secret");
  writeFileSync(handoffPath, "handoff-secret");
  const source = credentialFiles({
    sources: [
      { repository: one, credentialReference: "work-reader", path: workPath },
      {
        repository: other,
        credentialReference: "handoff-writer",
        path: handoffPath,
      },
    ],
  });
  assert.deepEqual(
    await source.credential({
      ...binding(one),
      credentialReference: "handoff-writer",
    }),
    { resolved: "Denied" },
  );
  assert.deepEqual(
    await source.credential({
      ...binding(other),
      credentialReference: "handoff-writer",
    }),
    { resolved: "Credential", credential: "handoff-secret" },
  );
  assert.deepEqual(
    await source.credential({
      ...binding(other),
      credentialReference: "unknown-role",
    }),
    { resolved: "Denied" },
  );
});

test("a named file that cannot be read is an outage and not a denial", async (t) => {
  const root = directory(t);
  const absent = join(root, "absent");
  const empty = join(root, "empty");
  writeFileSync(empty, "\n  \n");
  const unreadable = join(root, "unreadable");
  writeFileSync(unreadable, "secret-a1b2c3");
  chmodSync(unreadable, 0o000);
  const oversized = join(root, "oversized");
  writeFileSync(
    oversized,
    "s".repeat(credentialFilesDefaults.credentialBytesMax + 1),
  );
  for (const path of [absent, empty, unreadable, oversized]) {
    const resolved = await credentialFiles({
      sources: [{ repository: one, path }],
    }).credential(binding());
    assert.deepEqual(resolved, { resolved: "Unavailable" }, path);
  }
});

test("a value longer than the credential source admits is refused, not truncated", async (t) => {
  const root = directory(t);
  const path = join(root, "one");
  writeFileSync(
    path,
    "s".repeat(credentialFilesDefaults.credentialBytesMax + 1),
  );
  assert.deepEqual(
    await credentialFiles({ sources: [{ repository: one, path }] }).credential(
      binding(),
    ),
    { resolved: "Unavailable" },
  );
});

test("every act reads the file again rather than the first act's value", async (t) => {
  const root = directory(t);
  const path = join(root, "one");
  writeFileSync(path, "secret-first");
  const source = credentialFiles({ sources: [{ repository: one, path }] });
  assert.deepEqual(await source.credential(binding()), {
    resolved: "Credential",
    credential: "secret-first",
  });
  writeFileSync(path, "secret-second");
  assert.deepEqual(await source.credential(binding()), {
    resolved: "Credential",
    credential: "secret-second",
  });
  rmSync(path);
  assert.deepEqual(await source.credential(binding()), {
    resolved: "Unavailable",
  });
});

test("a mapping that answers one repository two ways is refused at construction", (t) => {
  const root = directory(t);
  assert.throws(
    () =>
      credentialFiles({
        sources: [
          { repository: one, path: join(root, "a") },
          { repository: one, path: join(root, "b") },
        ],
      }),
    /a repository names two files/u,
  );
});

/** One forge binding this deployment names, over the file a case writes for it. */
function forgeBinding(path: string, reference = "forge-alpha-proposals") {
  return {
    forge: asForgeBindingId("forge-alpha"),
    repositoryHost: "example.invalid",
    credentialReference: asForgeCredentialReference(reference),
    path,
  };
}

test("a forge resolves its own credential and never a repository's", async (t) => {
  const root = directory(t);
  const path = join(root, "forge");
  writeFileSync(path, "forge-secret\n");
  const source = forgeCredentialFiles({ bindings: [forgeBinding(path)] });
  assert.deepEqual(
    await source.credential({
      forge: asForgeBindingId("forge-alpha"),
      credential: asForgeCredentialReference("forge-alpha-proposals"),
    }),
    { resolved: "Credential", credential: "forge-secret" },
  );
  assert.deepEqual(
    await source.credential({
      forge: asForgeBindingId("forge-alpha"),
      credential: asForgeCredentialReference("some-other-credential"),
    }),
    { resolved: "Denied" },
  );
});

test("a forge credential is refused rather than quoted where the file is not one", async (t) => {
  const root = directory(t);
  const absent = join(root, "absent");
  const empty = join(root, "empty");
  writeFileSync(empty, "\n  \n");
  const oversized = join(root, "oversized");
  writeFileSync(oversized, "s".repeat(finalizerIdentityCharsMax + 1));
  for (const path of [absent, empty, oversized]) {
    const resolved = await forgeCredentialFiles({
      bindings: [forgeBinding(path)],
    }).credential({
      forge: asForgeBindingId("forge-alpha"),
      credential: asForgeCredentialReference("forge-alpha-proposals"),
    });
    assert.deepEqual(resolved, { resolved: "Unavailable" }, path);
    assert.deepEqual(Object.keys(resolved), ["resolved"], path);
  }
});

test("a forge credential file the port would refuse fails the precondition too", async (t) => {
  const root = directory(t);
  const path = join(root, "forge");
  writeFileSync(path, "s".repeat(finalizerIdentityCharsMax + 1));
  const signal = new AbortController().signal;
  const precondition = forgeCredentialFilesPrecondition({
    bindings: [forgeBinding(path)],
  });
  assert.equal(precondition.name, "forge-credentials-available");
  assert.equal(await precondition.check(signal), false);
  writeFileSync(path, "forge-secret");
  assert.equal(await precondition.check(signal), true);
  assert.equal(
    await forgeCredentialFilesPrecondition({ bindings: [] }).check(signal),
    true,
    "a deployment binding no forge meets the precondition it has nothing to fail",
  );
});

test("two forge bindings naming one credential two files are refused at construction", (t) => {
  const root = directory(t);
  assert.throws(
    () =>
      forgeCredentialFiles({
        bindings: [
          forgeBinding(join(root, "a")),
          { ...forgeBinding(join(root, "b")), repositoryHost: "other.invalid" },
        ],
      }),
    /a credential names two files/u,
  );
});

test("the precondition is met only when every named credential reads", async (t) => {
  const root = directory(t);
  const present = join(root, "one");
  writeFileSync(present, "secret-a1b2c3");
  const signal = new AbortController().signal;
  assert.equal(
    await credentialFilesPrecondition({
      sources: [{ repository: one, path: present }],
    }).check(signal),
    true,
  );
  const partial = credentialFilesPrecondition({
    sources: [
      { repository: one, path: present },
      { repository: other, path: join(root, "absent") },
    ],
  });
  assert.equal(partial.name, "repository-credentials-available");
  assert.equal(await partial.check(signal), false);
});
