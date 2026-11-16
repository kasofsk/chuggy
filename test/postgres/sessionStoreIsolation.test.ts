/**
 * The store boundary, at the tier that can hold it: a real PostgreSQL, the real
 * worker-plane routes over the plane role's own pool, and a real filesystem
 * store. A session that is nobody's fork may read its own store and nothing
 * else, and the rows are what say so — so a stranger's page is empty AND no
 * object was addressed, because a route that read the rows it was given and
 * then addressed an object of its own choosing would pass the first assertion
 * alone.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { FastifyInstance } from "fastify";

import { artifactStore } from "../../src/adapters/artifacts/artifactStore.ts";
import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import { sessionStoreBatchBytesMax } from "../../src/contract/http.ts";
import type { SessionBearerSecret } from "../../src/interpreter/agentSession.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { inertWorkerPlane } from "../adapters/workerPlaneFixtures.ts";
import {
  sessionRigAttempt,
  sessionRigOpen,
  sessionRigPlaneService,
  sessionRigProject,
  sessionRigSession,
  sessionRigTurn,
  type SessionRig,
} from "./sessionHarness.ts";

const artifactRoot = mkdtempSync(join(tmpdir(), "chuggy-session-store-"));
after(() => {
  rmSync(artifactRoot, { recursive: true, force: true });
});

const written = [
  '{"type":"user","uuid":"s-1"}\n',
  '{"type":"assistant","uuid":"s-2"}\n{"type":"result","uuid":"s-3"}\n',
];

function held(secret: SessionBearerSecret) {
  return { authorization: `Bearer ${secret}` };
}

/** The plane a pod talks to, with every object read recorded at the address it was asked at. */
function recordingPlane(rig: SessionRig): {
  readonly app: FastifyInstance;
  readonly addressed: string[];
} {
  const volume = artifactStore({
    root: artifactRoot,
    writeBytesMax: sessionStoreBatchBytesMax,
  });
  const addressed: string[] = [];
  const app = createWorkerPlaneApp({
    ...inertWorkerPlane(sessionStoreBatchBytesMax),
    sessions: sessionRigPlaneService(rig, {
      storeBatch: (object) => volume.storeBatch(object),
      readBatch: (object) => {
        addressed.push(`${object.session}/${String(object.batch)}`);
        return volume.readBatch(object);
      },
    }),
  });
  return { app, addressed };
}

/** A thread that has run: a bound reference, its batches stored, and a turn settled over them. */
async function threadThatWrote(
  rig: SessionRig,
  app: FastifyInstance,
  partition: Partition,
): Promise<{ readonly stream: string; readonly secret: SessionBearerSecret }> {
  const writer = await sessionRigSession(rig, partition, "writer");
  const turn = await sessionRigTurn(rig, partition, writer, "writer");
  const { secret } = await sessionRigAttempt(rig, partition, writer, "writer");
  const stream = randomUUID();
  const claimed = await app.inject({
    method: "GET",
    url: "/v1/session/turn",
    headers: held(secret),
  });
  assert.equal(claimed.statusCode, 200, claimed.body);
  const bound = await app.inject({
    method: "PUT",
    url: "/v1/session/reference",
    headers: held(secret),
    payload: { reference: stream },
  });
  assert.equal(bound.statusCode, 204, bound.body);
  for (const [at, content] of written.entries()) {
    const stored = await app.inject({
      method: "PUT",
      url: `/v1/session/store/${encodeURIComponent(stream)}/${String(at + 1)}`,
      headers: { ...held(secret), "content-type": "application/octet-stream" },
      payload: Buffer.from(content),
    });
    assert.equal(stored.statusCode, 204, stored.body);
  }
  const answered = await app.inject({
    method: "POST",
    url: "/v1/session/turn/answer",
    headers: held(secret),
    payload: { turn, result: "ok", batchFirst: 1, batchLast: written.length },
  });
  assert.equal(answered.statusCode, 204, answered.body);
  return { stream, secret };
}

async function storePage(
  app: FastifyInstance,
  secret: SessionBearerSecret,
  stream: string,
): Promise<{ readonly batches: readonly unknown[] }> {
  const page = await app.inject({
    method: "GET",
    url: `/v1/session/store/${encodeURIComponent(stream)}`,
    headers: held(secret),
  });
  assert.equal(page.statusCode, 200, page.body);
  return JSON.parse(page.body) as { readonly batches: readonly unknown[] };
}

test("a session that is nobody's fork reads no other session's objects", async () => {
  const rig = await sessionRigOpen();
  const { app, addressed } = recordingPlane(rig);
  try {
    const partition = await sessionRigProject(rig, "store-isolation");
    const writer = await threadThatWrote(rig, app, partition);
    assert.equal(
      (await storePage(app, writer.secret, writer.stream)).batches.length,
      written.length,
      "the writer reads its own store, so the stranger's empty page is the boundary and not an empty store",
    );

    const strangerSession = await sessionRigSession(rig, partition, "stranger");
    await sessionRigTurn(rig, partition, strangerSession, "stranger");
    const stranger = await sessionRigAttempt(
      rig,
      partition,
      strangerSession,
      "stranger",
    );
    addressed.length = 0;
    assert.deepEqual(await storePage(app, stranger.secret, writer.stream), {
      batches: [],
    });
    assert.deepEqual(addressed, []);
    const listed = await app.inject({
      method: "GET",
      url: "/v1/session/store",
      headers: held(stranger.secret),
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.deepEqual(JSON.parse(listed.body), { streams: [] });
  } finally {
    await app.close();
    await rig.close();
  }
});
