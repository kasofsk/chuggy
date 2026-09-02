/**
 * The session-keyed half of the artifact store against a real filesystem: a
 * batch written and drawn back, two sessions that cannot reach each other, and
 * the three ways a batch has no bytes.
 *
 * THE KEY IS THE SESSION AND NOT THE ATTEMPT, which is the whole point of the
 * store, so the cases below name no attempt anywhere and a batch written under
 * one bearer is drawn back with nothing but the session, the stream and the
 * number.
 *
 * AN ABSENCE, AN OUTAGE AND A FAULT ARE THREE ANSWERS. A batch nobody wrote is
 * `NotFound`, a volume that will not answer is `Unavailable`, and bytes that
 * are not a stored object — a link standing where one should be — are `Corrupt`
 * rather than the content of whatever the link points at.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  artifactProjectDirectory,
  artifactSessionFile,
  artifactSessionRoot,
} from "../../src/adapters/artifacts/artifactKey.ts";
import {
  artifactStore,
  type ArtifactStore,
} from "../../src/adapters/artifacts/artifactStore.ts";
import { sessionStoreBatchesMax } from "../../src/contract/http.ts";
import {
  asSessionId,
  asSessionStoreStream,
} from "../../src/interpreter/agentSession.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";

/** One project whose identity carries every character a path would otherwise take. */
const partition: Partition = {
  tenant: asTenantId("tenant/../one"),
  project: asProjectId("project one"),
};

const session = asSessionId("session/../one");
const stream = asSessionStoreStream("1a2b/subagent-7");

/** One opened store and the root it was opened over. */
interface Fixture {
  readonly root: string;
  readonly store: ArtifactStore;
}

async function fixtureOpen(
  t: TestContext,
  writeBytesMax?: number,
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "chuggy-session-store-"));
  t.after(() => {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    store: artifactStore({
      root,
      ...(writeBytesMax === undefined ? {} : { writeBytesMax }),
    }),
  };
}

/** Where one batch of the case's own session stands under a fixture's root. */
function fixtureFile(fixture: Fixture, batch: number): string {
  return artifactSessionFile(
    artifactProjectDirectory(fixture.root, partition.tenant, partition.project),
    session,
    stream,
    batch,
  );
}

const bytes = (line: string) => new TextEncoder().encode(line);

test("one batch written under a session is drawn back by the session alone", async (t) => {
  const fixture = await fixtureOpen(t);
  const content = '{"one":1}\n{"two":2}\n';
  assert.deepEqual(
    await fixture.store.storeBatch({
      partition,
      session,
      stream,
      batch: 1,
      content: bytes(content),
    }),
    { stored: "Stored" },
  );
  assert.deepEqual(
    await fixture.store.readBatch({ partition, session, stream, batch: 1 }),
    { read: "Content", content },
  );
});

test("a stored batch is read-only, so no later write can change what a digest named", async (t) => {
  const fixture = await fixtureOpen(t);
  await fixture.store.storeBatch({
    partition,
    session,
    stream,
    batch: 1,
    content: bytes("{}\n"),
  });
  assert.equal(statSync(fixtureFile(fixture, 1)).mode & 0o222, 0);
});

test("the same batch offered twice is one object, and different bytes are a conflict", async (t) => {
  const fixture = await fixtureOpen(t);
  const offer = (line: string) =>
    fixture.store.storeBatch({
      partition,
      session,
      stream,
      batch: 4,
      content: bytes(line),
    });
  assert.deepEqual(await offer('{"a":1}\n'), { stored: "Stored" });
  assert.deepEqual(await offer('{"a":1}\n'), { stored: "Stored" });
  assert.deepEqual(await offer('{"a":1}{}\n'), { stored: "Conflict" });
  assert.deepEqual(
    await fixture.store.readBatch({ partition, session, stream, batch: 4 }),
    { read: "Content", content: '{"a":1}\n' },
  );
});

/**
 * The byte count is the cheap arm and the digest is the one that decides. A
 * case whose two offers differ in length is answered before any digest is
 * taken, so it cannot see a commit that hashes the bytes it was handed instead
 * of the object already standing there — which is the whole of what makes a
 * retry of an unacknowledged batch safe.
 */
test("a batch re-sent at its own length under other bytes is a conflict, and the stored bytes stand", async (t) => {
  const fixture = await fixtureOpen(t);
  const offer = (line: string) =>
    fixture.store.storeBatch({
      partition,
      session,
      stream,
      batch: 1,
      content: bytes(line),
    });
  assert.deepEqual(await offer('{"a":1}\n'), { stored: "Stored" });
  assert.equal('{"b":2}\n'.length, '{"a":1}\n'.length);
  assert.deepEqual(await offer('{"b":2}\n'), { stored: "Conflict" });
  assert.deepEqual(
    await fixture.store.readBatch({ partition, session, stream, batch: 1 }),
    { read: "Content", content: '{"a":1}\n' },
  );
});

test("no session, stream or project reaches another's batch of the same number", async (t) => {
  const fixture = await fixtureOpen(t);
  await fixture.store.storeBatch({
    partition,
    session,
    stream,
    batch: 1,
    content: bytes("mine\n"),
  });
  for (const object of [
    { partition, session: asSessionId("session-two"), stream, batch: 1 },
    {
      partition,
      session,
      stream: asSessionStoreStream("1a2b/subagent-8"),
      batch: 1,
    },
    {
      partition: { tenant: partition.tenant, project: asProjectId("other") },
      session,
      stream,
      batch: 1,
    },
  ] as const) {
    assert.deepEqual(await fixture.store.readBatch(object), {
      read: "NotFound",
    });
  }
});

test("a batch nobody wrote is absent, and a volume that will not answer is an outage", async (t) => {
  const fixture = await fixtureOpen(t);
  assert.deepEqual(
    await fixture.store.readBatch({ partition, session, stream, batch: 9 }),
    { read: "NotFound" },
  );
  chmodSync(fixture.root, 0o000);
  const drawn = await fixture.store.readBatch({
    partition,
    session,
    stream,
    batch: 9,
  });
  chmodSync(fixture.root, 0o700);
  assert.equal(drawn.read, "Unavailable");
});

test("a link standing where a batch should be is not the batch it points at", async (t) => {
  const fixture = await fixtureOpen(t);
  const file = fixtureFile(fixture, 1);
  const elsewhere = join(fixture.root, "elsewhere.jsonl");
  mkdirSync(dirname(file), { recursive: true });
  await fixture.store.storeBatch({
    partition,
    session,
    stream,
    batch: 2,
    content: bytes("planted\n"),
  });
  symlinkSync(fixtureFile(fixture, 2), elsewhere);
  symlinkSync(elsewhere, file);
  assert.deepEqual(
    await fixture.store.readBatch({ partition, session, stream, batch: 1 }),
    { read: "Corrupt" },
  );
});

test("a link above a batch leads out of its project, and neither read nor write follows it", async (t) => {
  const fixture = await fixtureOpen(t);
  const outside = join(fixture.root, "outside");
  mkdirSync(outside, { recursive: true });
  const directory = artifactSessionRoot(
    artifactProjectDirectory(fixture.root, partition.tenant, partition.project),
    session,
    stream,
  );
  mkdirSync(dirname(directory), { recursive: true });
  symlinkSync(outside, directory);
  assert.deepEqual(
    await fixture.store.readBatch({ partition, session, stream, batch: 1 }),
    { read: "NotFound" },
  );
  const stored = await fixture.store.storeBatch({
    partition,
    session,
    stream,
    batch: 1,
    content: bytes("escaped\n"),
  });
  assert.equal(stored.stored, "Unavailable");
});

test("a batch past what this store holds is refused rather than written", async (t) => {
  const fixture = await fixtureOpen(t, 4);
  assert.deepEqual(
    await fixture.store.storeBatch({
      partition,
      session,
      stream,
      batch: 1,
      content: bytes("more than four\n"),
    }),
    { stored: "Refused", reason: "QuotaExceeded" },
  );
  assert.deepEqual(
    await fixture.store.readBatch({ partition, session, stream, batch: 1 }),
    { read: "NotFound" },
  );
});

test("a batch number outside the store's bound resolves to no path at all", () => {
  const directory = artifactProjectDirectory(
    "/store",
    partition.tenant,
    partition.project,
  );
  for (const batch of [0, -1, 1.5, sessionStoreBatchesMax + 1]) {
    assert.throws(
      () => artifactSessionFile(directory, session, stream, batch),
      RangeError,
      String(batch),
    );
  }
  assert.ok(
    artifactSessionFile(directory, session, stream, 1).startsWith(
      `${artifactSessionRoot(directory, session, stream)}/`,
    ),
  );
});
