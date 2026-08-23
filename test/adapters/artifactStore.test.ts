/**
 * The artifact store against a real filesystem: what confirms a sealed manifest,
 * what hands a preparation bytes, and where a project's own evidence is written.
 *
 * A DIRECTORY IS A STORE GOOD ENOUGH TO PROVE EVERY ANSWER, so every case here
 * runs against a temporary root and the suite needs no network and no service.
 * What is asserted is the filesystem's own behaviour rather than a description
 * of it: the absent path, the wrong size, the wrong digest, the writable object
 * and the identity that resolves nowhere.
 *
 * THE NEGATIVE SPACE IS HALF THE POINT. Bytes must not come back for an artifact
 * whose content hashes to anything but the digest that was pinned, a link must
 * not stand in for the object it points at nor anywhere in the directories that
 * lead to it — on the read paths or under a project's own write — one project
 * must not read another's objects, and an outage must not read as an artifact
 * that failed.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  artifactAttemptFile,
  artifactOwnedFile,
  artifactProjectDirectory,
  artifactWithinProject,
} from "../../src/adapters/artifacts/artifactKey.ts";
import {
  artifactStore,
  type ArtifactStore,
} from "../../src/adapters/artifacts/artifactStore.ts";
import { asProjectArtifactId } from "../../src/interpreter/finalizerPreparation.ts";
import {
  acceptResultManifest,
  asArtifactDigest,
  asArtifactPath,
  asResultManifestId,
  type ArtifactPath,
  type CanonicalManifest,
  type ResultManifest,
} from "../../src/interpreter/resultManifest.ts";
import {
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/schedulerIdentity.ts";
import { branchDiffOutput } from "../../src/interpreter/operationsView.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";

/** The hash the control plane seals a manifest under, which is also the store's own. */
function digestOf(value: string | CanonicalManifest): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** One project whose identity carries every character a path would otherwise take. */
const partition: Partition = {
  tenant: asTenantId("tenant/../one"),
  project: asProjectId("project one"),
};

const execution = asExecutionId("execution-1");
const attempt = asAttemptId("attempt-1");

/** One opened store and the root it was opened over. */
interface Fixture {
  readonly root: string;
  readonly store: ArtifactStore;
}

function fixtureOpen(t: TestContext): Fixture {
  const root = mkdtempSync(join(tmpdir(), "chuggy-store-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return { root, store: artifactStore({ root }) };
}

/** Stores one attempt-scoped object the way an uploader would, read-only and whole. */
function fixtureStore(
  fixture: Fixture,
  path: string,
  content: string,
  mode = 0o440,
): string {
  const file = artifactAttemptFile(
    artifactProjectDirectory(fixture.root, partition.tenant, partition.project),
    execution,
    attempt,
    asArtifactPath(path),
  );
  if (file === undefined) assert.fail(`${path} resolved nowhere`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, { mode });
  chmodSync(file, mode);
  return file;
}

/** One sealed manifest declaring the handoffs a case named, sealed the one way there is. */
function fixtureManifest(
  handoffs: readonly { path: string; digest: string; bytes: number }[],
): ResultManifest {
  const accepted = acceptResultManifest(
    { partition, execution, attempt },
    asResultManifestId("manifest-1"),
    JSON.stringify({ version: 1, verdict: "Pass", handoffs, diagnostics: [] }),
    digestOf,
  );
  if (accepted.accepted !== "Accepted") {
    assert.fail(`the fixture manifest was ${accepted.code}`);
  }
  return accepted.manifest;
}

/** One declared handoff whose digest and size really are the content's. */
function fixtureDeclared(
  path: string,
  content: string,
): { path: string; digest: string; bytes: number } {
  return { path, digest: digestOf(content), bytes: content.length };
}

/** The one artifact a read asks for, in the shape the handoff port takes. */
function fixtureAsked(path: string, content: string) {
  return {
    execution,
    attempt,
    path: asArtifactPath(path),
    digest: asArtifactDigest(digestOf(content)),
    bytes: content.length,
  };
}

test("a key resolves inside its project or it resolves nowhere at all", () => {
  const directory = artifactProjectDirectory(
    "/store",
    partition.tenant,
    partition.project,
  );
  assert.equal(
    artifactWithinProject(directory, `${directory}/attempt/x`),
    true,
  );
  assert.equal(artifactWithinProject(directory, "/store/elsewhere"), false);
  assert.equal(
    artifactWithinProject(directory, `${directory}x/attempt`),
    false,
  );
  assert.equal(artifactWithinProject(directory, directory), false);
  for (const path of ["../escape", "/absolute", "a\\b", "a/../b"]) {
    assert.equal(
      artifactAttemptFile(directory, execution, attempt, path as ArtifactPath),
      undefined,
      path,
    );
  }
});

test("a manifest whose objects are all stored is confirmed on metadata alone", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureStore(fixture, "one.txt", "one");
  fixtureStore(fixture, "lib/two.txt", "two");
  const verified = await fixture.store.verifyManifest(
    fixtureManifest([
      fixtureDeclared("one.txt", "one"),
      fixtureDeclared("lib/two.txt", "two"),
    ]),
  );
  assert.deepEqual(verified, { verified: "Verified" });
});

test("each way an object fails its declaration is its own failure at its own row", async (t) => {
  const fixture = fixtureOpen(t);
  const absent = await fixture.store.verifyManifest(
    fixtureManifest([fixtureDeclared("one.txt", "one")]),
  );
  assert.deepEqual(absent, {
    verified: "Rejected",
    failure: "Missing",
    at: { role: "Handoff", index: 0 },
  });
  fixtureStore(fixture, "one.txt", "two");
  assert.deepEqual(
    await fixture.store.verifyManifest(
      fixtureManifest([fixtureDeclared("one.txt", "one")]),
    ),
    {
      verified: "Rejected",
      failure: "DigestMismatch",
      at: { role: "Handoff", index: 0 },
    },
  );
  assert.deepEqual(
    await fixture.store.verifyManifest(
      fixtureManifest([{ ...fixtureDeclared("one.txt", "two"), bytes: 4 }]),
    ),
    {
      verified: "Rejected",
      failure: "ByteCountMismatch",
      at: { role: "Handoff", index: 0 },
    },
  );
});

test("an object anybody may still write is not one a digest speaks for", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureStore(fixture, "one.txt", "one", 0o640);
  assert.deepEqual(
    await fixture.store.verifyManifest(
      fixtureManifest([fixtureDeclared("one.txt", "one")]),
    ),
    {
      verified: "Rejected",
      failure: "Mutable",
      at: { role: "Handoff", index: 0 },
    },
  );
});

test("a directory standing where an object should be is not a stored object", async (t) => {
  const fixture = fixtureOpen(t);
  const file = artifactAttemptFile(
    artifactProjectDirectory(fixture.root, partition.tenant, partition.project),
    execution,
    attempt,
    asArtifactPath("one.txt"),
  );
  if (file === undefined) assert.fail("the path resolved nowhere");
  mkdirSync(file, { recursive: true });
  assert.deepEqual(
    await fixture.store.verifyManifest(
      fixtureManifest([fixtureDeclared("one.txt", "one")]),
    ),
    {
      verified: "Rejected",
      failure: "NotDurable",
      at: { role: "Handoff", index: 0 },
    },
  );
});

test("a link standing where an object should be is not a stored object", async (t) => {
  const fixture = fixtureOpen(t);
  const elsewhere = join(fixture.root, "elsewhere.txt");
  writeFileSync(elsewhere, "one", { mode: 0o444 });
  chmodSync(elsewhere, 0o444);
  const file = artifactAttemptFile(
    artifactProjectDirectory(fixture.root, partition.tenant, partition.project),
    execution,
    attempt,
    asArtifactPath("one.txt"),
  );
  if (file === undefined) assert.fail("the path resolved nowhere");
  mkdirSync(dirname(file), { recursive: true });
  symlinkSync(elsewhere, file);
  assert.deepEqual(
    await fixture.store.verifyManifest(
      fixtureManifest([fixtureDeclared("one.txt", "one")]),
    ),
    {
      verified: "Rejected",
      failure: "NotDurable",
      at: { role: "Handoff", index: 0 },
    },
  );
  assert.deepEqual(
    await fixture.store.readHandoff({
      partition,
      artifacts: [fixtureAsked("one.txt", "one")],
    }),
    {
      read: "Rejected",
      failure: "NotDurable",
      at: { role: "Handoff", index: 0 },
    },
  );
});

test("a link standing in a declared path's directory leads out of the project", async (t) => {
  const fixture = fixtureOpen(t);
  const outside = join(fixture.root, "outside");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "b.txt"), "secret", { mode: 0o440 });
  chmodSync(join(outside, "b.txt"), 0o440);
  const file = artifactAttemptFile(
    artifactProjectDirectory(fixture.root, partition.tenant, partition.project),
    execution,
    attempt,
    asArtifactPath("a/b.txt"),
  );
  if (file === undefined) assert.fail("the path resolved nowhere");
  mkdirSync(dirname(dirname(file)), { recursive: true });
  symlinkSync(outside, dirname(file));
  assert.deepEqual(
    await fixture.store.verifyManifest(
      fixtureManifest([fixtureDeclared("a/b.txt", "secret")]),
    ),
    {
      verified: "Rejected",
      failure: "ForeignProject",
      at: { role: "Handoff", index: 0 },
    },
  );
  assert.deepEqual(
    await fixture.store.readHandoff({
      partition,
      artifacts: [fixtureAsked("a/b.txt", "secret")],
    }),
    {
      read: "Rejected",
      failure: "ForeignProject",
      at: { role: "Handoff", index: 0 },
    },
  );
});

test("a path whose links lead in a circle names no object and is never retried", async (t) => {
  const fixture = fixtureOpen(t);
  const file = artifactAttemptFile(
    artifactProjectDirectory(fixture.root, partition.tenant, partition.project),
    execution,
    attempt,
    asArtifactPath("a/b.txt"),
  );
  if (file === undefined) assert.fail("the path resolved nowhere");
  mkdirSync(dirname(dirname(file)), { recursive: true });
  symlinkSync("a", dirname(file));
  assert.deepEqual(
    await fixture.store.verifyManifest(
      fixtureManifest([fixtureDeclared("a/b.txt", "one")]),
    ),
    {
      verified: "Rejected",
      failure: "Missing",
      at: { role: "Handoff", index: 0 },
    },
  );
});

test("a link standing where a project's own artifacts go is written to by nothing", async (t) => {
  const fixture = fixtureOpen(t);
  const directory = artifactProjectDirectory(
    fixture.root,
    partition.tenant,
    partition.project,
  );
  const outside = join(fixture.root, "outside");
  mkdirSync(outside, { recursive: true });
  mkdirSync(directory, { recursive: true });
  symlinkSync(
    outside,
    dirname(artifactOwnedFile(directory, asProjectArtifactId("conflict-1"))),
  );
  const written = await fixture.store.writeArtifact({
    partition,
    artifact: asProjectArtifactId("conflict-1"),
    content: new TextEncoder().encode("evidence"),
  });
  assert.equal(written.written, "Unavailable");
  assert.deepEqual(readdirSync(outside), []);
});

test("an object standing where a directory should be is absent and not an outage", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureStore(fixture, "one.txt", "one");
  assert.deepEqual(
    await fixture.store.verifyManifest(
      fixtureManifest([fixtureDeclared("one.txt/two.txt", "two")]),
    ),
    {
      verified: "Rejected",
      failure: "Missing",
      at: { role: "Handoff", index: 0 },
    },
  );
});

test("bytes come back only where they hash to the digest the caller pinned", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureStore(fixture, "one.txt", "one");
  const read = await fixture.store.readHandoff({
    partition,
    artifacts: [fixtureAsked("one.txt", "one")],
  });
  if (read.read !== "Files") assert.fail(JSON.stringify(read));
  assert.deepEqual(
    read.files.map((file) => file.path),
    ["one.txt"],
  );
  assert.equal(new TextDecoder().decode(read.files[0]?.content), "one");
  const tampered = await fixture.store.readHandoff({
    partition,
    artifacts: [
      {
        ...fixtureAsked("one.txt", "one"),
        digest: asArtifactDigest(digestOf("other")),
      },
    ],
  });
  assert.deepEqual(tampered, {
    read: "Rejected",
    failure: "DigestMismatch",
    at: { role: "Handoff", index: 0 },
  });
});

test("one project's objects are not reachable from another's, whatever its identity spells", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureStore(fixture, "one.txt", "one");
  const elsewhere = await fixture.store.readHandoff({
    partition: {
      tenant: asTenantId("tenant"),
      project: asProjectId("../../one"),
    },
    artifacts: [fixtureAsked("one.txt", "one")],
  });
  assert.deepEqual(elsewhere, {
    read: "Rejected",
    failure: "Missing",
    at: { role: "Handoff", index: 0 },
  });
});

test("a read past the store's own ceilings is refused before any object is opened", async (t) => {
  const fixture = artifactStore({
    root: fixtureOpen(t).root,
    readArtifactsMax: 1,
    readBytesMax: 2,
  });
  await assert.rejects(
    () =>
      fixture.readHandoff({
        partition,
        artifacts: [
          fixtureAsked("one.txt", "one"),
          fixtureAsked("two.txt", "two"),
        ],
      }),
    RangeError,
  );
  await assert.rejects(
    () =>
      fixture.readHandoff({
        partition,
        artifacts: [fixtureAsked("one.txt", "one")],
      }),
    RangeError,
  );
});

test("a project-owned artifact is written read-only and answers with its own digest", async (t) => {
  const fixture = fixtureOpen(t);
  const written = await fixture.store.writeArtifact({
    partition,
    artifact: asProjectArtifactId("conflict-1"),
    content: new TextEncoder().encode("evidence"),
  });
  assert.deepEqual(written, {
    written: "Artifact",
    digest: digestOf("evidence"),
  });
  const again = await fixture.store.writeArtifact({
    partition,
    artifact: asProjectArtifactId("conflict-1"),
    content: new TextEncoder().encode("evidence"),
  });
  assert.equal(again.written, "Artifact");
});

test("a store whose objects could be rewritten is refused at construction", () => {
  assert.throws(
    () => artifactStore({ root: "/tmp", storedFileMode: 0o640 }),
    RangeError,
  );
  assert.throws(
    () => artifactStore({ root: "/tmp", readBytesMax: 0 }),
    RangeError,
  );
});

test("a root that cannot be written is an outage and never an artifact that failed", async (t) => {
  const fixture = fixtureOpen(t);
  chmodSync(fixture.root, 0o500);
  const written = await fixture.store.writeArtifact({
    partition,
    artifact: asProjectArtifactId("conflict-1"),
    content: new TextEncoder().encode("evidence"),
  });
  chmodSync(fixture.root, 0o700);
  assert.equal(written.written, "Unavailable");
});

test("a declared output preview returns only verified UTF-8 content", async (t) => {
  const fixture = fixtureOpen(t);
  const content = "diff --git a/a.ts b/a.ts\n";
  fixtureStore(fixture, branchDiffOutput.path, content);
  const artifact = {
    ordinal: 1,
    role: "Diagnostic" as const,
    path: branchDiffOutput.path,
    digest: asArtifactDigest(digestOf(content)),
    bytes: content.length,
    output: branchDiffOutput,
  };
  assert.deepEqual(
    await fixture.store.read({ partition, execution, attempt, artifact }),
    {
      read: "Content",
      mediaType: "text/x-diff",
      renderer: "UnifiedDiff",
      content,
    },
  );
  assert.equal(
    (
      await fixture.store.read({
        partition,
        execution,
        attempt,
        artifact: { ...artifact, digest: asArtifactDigest("0".repeat(64)) },
      })
    ).read,
    "Corrupt",
  );
});
