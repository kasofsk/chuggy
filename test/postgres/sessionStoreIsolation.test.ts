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

import { artifactStore } from "../../src/adapters/artifacts/artifactStore.ts";
import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import { sessionStoreBatchBytesMax } from "../../src/contract/http.ts";
import type { SessionBearerSecret } from "../../src/interpreter/agentSession.ts";
import { inertWorkerPlane } from "../adapters/workerPlaneFixtures.ts";
import {
  sessionRigAttempt,
  sessionRigOpen,
  sessionRigPlaneService,
  sessionRigProject,
  sessionRigSession,
  sessionRigTurn,
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

test("a session that is nobody's fork reads no other session's objects", async () => {
  const rig = await sessionRigOpen();
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
  try {
    const partition = await sessionRigProject(rig, "store-isolation");

    const writer = await sessionRigSession(rig, partition, "writer");
    const turn = await sessionRigTurn(rig, partition, writer, "writer");
    const writing = await sessionRigAttempt(rig, partition, writer, "writer");
    const stream = randomUUID();
    const claimed = await app.inject({
      method: "GET",
      url: "/v1/session/turn",
      headers: held(writing.secret),
    });
    assert.equal(claimed.statusCode, 200, claimed.body);
    const bound = await app.inject({
      method: "PUT",
      url: "/v1/session/reference",
      headers: held(writing.secret),
      payload: { reference: stream },
    });
    assert.equal(bound.statusCode, 204, bound.body);
    for (const [at, content] of written.entries()) {
      const stored = await app.inject({
        method: "PUT",
        url: `/v1/session/store/${encodeURIComponent(stream)}/${String(at + 1)}`,
        headers: {
          ...held(writing.secret),
          "content-type": "application/octet-stream",
        },
        payload: Buffer.from(content),
      });
      assert.equal(stored.statusCode, 204, stored.body);
    }
    const answered = await app.inject({
      method: "POST",
      url: "/v1/session/turn/answer",
      headers: held(writing.secret),
      payload: {
        turn,
        result: "ok",
        batchFirst: 1,
        batchLast: written.length,
      },
    });
    assert.equal(answered.statusCode, 204, answered.body);

    const own = await app.inject({
      method: "GET",
      url: `/v1/session/store/${encodeURIComponent(stream)}`,
      headers: held(writing.secret),
    });
    assert.equal(own.statusCode, 200, own.body);
    assert.equal(
      (JSON.parse(own.body) as { batches: unknown[] }).batches.length,
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
    const page = await app.inject({
      method: "GET",
      url: `/v1/session/store/${encodeURIComponent(stream)}`,
      headers: held(stranger.secret),
    });
    assert.equal(page.statusCode, 200, page.body);
    assert.deepEqual(JSON.parse(page.body), { batches: [] });
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
