/**
 * Giving a project an image, and reading it back, at the pure tier: the media
 * type recovered from an identity's own text, and the two halves over a fake
 * store and a fake minting port.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asProjectArtifactId } from "../../src/interpreter/finalizerPreparation.ts";
import type {
  ProjectArtifactPort,
  ProjectArtifactRead,
  ProjectArtifactReadRequest,
  ProjectArtifactWrite,
  ProjectArtifactWritten,
} from "../../src/interpreter/finalizerPreparation.ts";
import {
  projectArtifactFetched,
  projectArtifactIdentityText,
  projectArtifactMediaTypeOf,
  projectArtifactUploaded,
  type ProjectArtifactMinting,
} from "../../src/interpreter/projectArtifact.ts";
import { asArtifactDigest } from "../../src/interpreter/resultManifest.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";

const partition: Partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

/** A minting port that draws identities in order, so a case can name the one it minted. */
function countingMinting(): ProjectArtifactMinting & {
  readonly minted: string[];
} {
  const minted: string[] = [];
  let drawn = 0;
  return {
    minted,
    mint: (mediaType) => {
      drawn += 1;
      const artifact = asProjectArtifactId(
        projectArtifactIdentityText(mediaType, `token-${String(drawn)}`),
      );
      minted.push(artifact);
      return artifact;
    },
  };
}

/** A store that answers whatever one case chose and records what it was asked. */
function fakeStore(
  written: ProjectArtifactWritten,
  read: ProjectArtifactRead = { read: "NotFound" },
): ProjectArtifactPort & {
  readonly writes: ProjectArtifactWrite[];
  readonly reads: ProjectArtifactReadRequest[];
} {
  const writes: ProjectArtifactWrite[] = [];
  const reads: ProjectArtifactReadRequest[] = [];
  return {
    writes,
    reads,
    writeArtifact: (write) => {
      writes.push(write);
      return Promise.resolve(written);
    },
    readArtifact: (request) => {
      reads.push(request);
      return Promise.resolve(read);
    },
  };
}

test("the media type an identity was minted with is what a read recovers", () => {
  const minting = countingMinting();
  const artifact = minting.mint("image/png");
  assert.equal(projectArtifactMediaTypeOf(artifact), "image/png");
});

test("an identity naming no separator, or a media type the roster does not admit, recovers nothing", () => {
  assert.equal(
    projectArtifactMediaTypeOf(asProjectArtifactId("no-separator-here")),
    undefined,
  );
  assert.equal(
    projectArtifactMediaTypeOf(asProjectArtifactId("image/svg+xml:token")),
    undefined,
  );
  assert.equal(
    projectArtifactMediaTypeOf(asProjectArtifactId("text/plain:token")),
    undefined,
  );
});

test("a media type the roster does not admit is refused before anything is minted or written", async () => {
  const minting = countingMinting();
  const store = fakeStore({
    written: "Artifact",
    digest: asArtifactDigest("0".repeat(64)),
  });
  const uploaded = await projectArtifactUploaded(
    minting,
    store,
    partition,
    "image/svg+xml",
    new TextEncoder().encode("<svg/>"),
  );
  assert.deepEqual(uploaded, { uploaded: "NotAnImage" });
  assert.deepEqual(minting.minted, []);
  assert.deepEqual(store.writes, []);
});

test("an admitted upload mints an identity carrying its media type and writes the bytes behind it", async () => {
  const minting = countingMinting();
  const digest = asArtifactDigest("1".repeat(64));
  const store = fakeStore({ written: "Artifact", digest });
  const content = new TextEncoder().encode("a png, more or less");
  const uploaded = await projectArtifactUploaded(
    minting,
    store,
    partition,
    "image/png",
    content,
  );
  assert.deepEqual(uploaded, {
    uploaded: "Artifact",
    artifact: minting.minted[0],
    digest,
  });
  assert.deepEqual(store.writes, [
    { partition, artifact: minting.minted[0], content },
  ]);
});

test("a store that could not write is an outage and never a refused upload", async () => {
  const minting = countingMinting();
  const store = fakeStore({ written: "Unavailable", retryAfterSeconds: 3 });
  const uploaded = await projectArtifactUploaded(
    minting,
    store,
    partition,
    "image/jpeg",
    new TextEncoder().encode("evidence"),
  );
  assert.deepEqual(uploaded, { uploaded: "Unavailable", retryAfterSeconds: 3 });
});

test("reading an identity that names no admitted media type answers not found before the store is asked", async () => {
  const store = fakeStore({
    written: "Artifact",
    digest: asArtifactDigest("0".repeat(64)),
  });
  const fetched = await projectArtifactFetched(
    store,
    partition,
    asProjectArtifactId("not-a-minted-identity"),
  );
  assert.deepEqual(fetched, { fetched: "NotFound" });
  assert.deepEqual(store.reads, []);
});

test("reading back answers the same bytes and the media type its identity carries", async () => {
  const content = new TextEncoder().encode("a gif, more or less");
  const store = fakeStore(
    { written: "Artifact", digest: asArtifactDigest("0".repeat(64)) },
    { read: "Content", content },
  );
  const artifact = asProjectArtifactId(
    projectArtifactIdentityText("image/gif", "token-1"),
  );
  const fetched = await projectArtifactFetched(store, partition, artifact);
  assert.deepEqual(fetched, {
    fetched: "Content",
    content,
    mediaType: "image/gif",
  });
  assert.deepEqual(store.reads, [{ partition, artifact }]);
});

test("a read the store could not answer and one it never wrote are each their own answer", async () => {
  const artifact = asProjectArtifactId(
    projectArtifactIdentityText("image/webp", "token-1"),
  );
  const missing = fakeStore(
    { written: "Artifact", digest: asArtifactDigest("0".repeat(64)) },
    { read: "NotFound" },
  );
  assert.deepEqual(await projectArtifactFetched(missing, partition, artifact), {
    fetched: "NotFound",
  });
  const down = fakeStore(
    { written: "Artifact", digest: asArtifactDigest("0".repeat(64)) },
    { read: "Unavailable", retryAfterSeconds: 7 },
  );
  assert.deepEqual(await projectArtifactFetched(down, partition, artifact), {
    fetched: "Unavailable",
    retryAfterSeconds: 7,
  });
});
