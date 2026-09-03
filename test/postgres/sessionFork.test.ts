/**
 * The fork proof, at the tier that can hold it: a real PostgreSQL, the real
 * worker-plane routes over the plane role's own pool, and a real filesystem
 * store.
 *
 * A RESUME AND A FORK DIFFER IN THE ONE FACT THE STORE IS KEYED BY. A resuming
 * attempt reads the session that wrote the batches, so a route addressing the
 * caller's own session is right there by accident; a fork reads its PARENT'S,
 * and the same route addresses a directory nothing ever stood in. A live
 * installation measured that with `./sessionResume.test.ts` green throughout
 * (kasofsk/chuggy#551), so the case a fork needs is its own and not a variation
 * of that one.
 *
 * THE OBJECTS ARE REAL BECAUSE THE ADDRESS IS WHAT IS BEING PROVED. A store
 * double keyed by batch number alone answers any session's bytes at one address,
 * which is green over exactly this defect and is what the route's unit suite
 * was. Here the bytes are on a filesystem keyed the way a deployment keys them,
 * and the reads the route made are recorded so a case can say which session was
 * addressed rather than only what came back.
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
import type {
  SessionBearerSecret,
  SessionId,
} from "../../src/interpreter/agentSession.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { inertWorkerPlane } from "../adapters/workerPlaneFixtures.ts";
import {
  sessionRigAttempt,
  sessionRigOpen,
  sessionRigProject,
  sessionRigSession,
  sessionRigTurn,
  type SessionRig,
  type SessionRigAttempt,
} from "./sessionHarness.ts";

const artifactRoot = mkdtempSync(join(tmpdir(), "chuggy-session-fork-"));
after(() => {
  rmSync(artifactRoot, { recursive: true, force: true });
});

/** What the lead writes, one batch per line-bearing body, and what a fork must load. */
const leadBatches = [
  '{"type":"user","uuid":"f-1"}\n',
  '{"type":"assistant","uuid":"f-2"}\n{"type":"result","uuid":"f-3"}\n',
];

/** The plane a pod talks to, with every object read recorded at the address it was asked at. */
function forkPlane(rig: SessionRig): {
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
    sessions: {
      authority: rig.plane,
      heartbeats: rig.plane,
      heartbeatLeaseSecs: 300,
      references: rig.plane,
      turns: rig.plane,
      settlements: rig.plane,
      holds: rig.plane,
      records: rig.plane,
      queries: rig.plane,
      store: {
        storeBatch: (object) => volume.storeBatch(object),
        readBatch: (object) => {
          addressed.push(`${object.session}/${String(object.batch)}`);
          return volume.readBatch(object);
        },
      },
      turnPollIntervalMs: 10,
      turnPollSecsMax: 1,
      pollsMax: 8,
    },
  });
  return { app, addressed };
}

function held(secret: SessionBearerSecret) {
  return { authorization: `Bearer ${secret}` };
}

/** One page of a stream as the route answers it, which is what a forking pod loads. */
interface StorePage {
  readonly batches: readonly {
    readonly batch: number;
    readonly content?: string;
    readonly read?: string;
  }[];
  readonly nextAfter?: number;
}

async function storePage(
  app: FastifyInstance,
  secret: SessionBearerSecret,
  stream: string,
): Promise<StorePage> {
  const answered = await app.inject({
    method: "GET",
    url: `/v1/session/store/${encodeURIComponent(stream)}`,
    headers: held(secret),
  });
  assert.equal(answered.statusCode, 200, answered.body);
  return JSON.parse(answered.body) as StorePage;
}

/**
 * A lead that has run: a bound runtime reference, the batches written through
 * the route a pod writes them through, and a turn SETTLED over them — a fork is
 * read to the head of a whole exchange, so a lead whose turn is still open has
 * nothing for one to load.
 */
async function forkRunLead(
  rig: SessionRig,
  app: FastifyInstance,
  partition: Partition,
  label: string,
): Promise<{ readonly session: SessionId; readonly stream: string }> {
  const session = await sessionRigSession(rig, partition, label, {
    kind: "Lead",
    principal: `principal-${label}`,
  });
  const turn = await sessionRigTurn(rig, partition, session, label);
  const attempt = await sessionRigAttempt(rig, partition, session, label);
  const stream = randomUUID();
  const claimed = await app.inject({
    method: "GET",
    url: "/v1/session/turn",
    headers: held(attempt.secret),
  });
  assert.equal(claimed.statusCode, 200, claimed.body);
  const bound = await app.inject({
    method: "PUT",
    url: "/v1/session/reference",
    headers: held(attempt.secret),
    payload: { reference: stream },
  });
  assert.equal(bound.statusCode, 204, bound.body);
  for (const [at, content] of leadBatches.entries()) {
    const stored = await app.inject({
      method: "PUT",
      url: `/v1/session/store/${encodeURIComponent(stream)}/${String(at + 1)}`,
      headers: {
        ...held(attempt.secret),
        "content-type": "application/octet-stream",
      },
      payload: Buffer.from(content),
    });
    assert.equal(stored.statusCode, 204, stored.body);
  }
  const answered = await app.inject({
    method: "POST",
    url: "/v1/session/turn/answer",
    headers: held(attempt.secret),
    payload: {
      turn,
      result: "ok",
      batchFirst: 1,
      batchLast: leadBatches.length,
    },
  });
  assert.equal(answered.statusCode, 204, answered.body);
  return { session, stream };
}

/** One session with an attempt to speak through, which is all a reading case needs of it. */
async function forkReader(
  rig: SessionRig,
  partition: Partition,
  label: string,
  opening: { readonly kind: "Inquiry" | "Thread"; readonly parent?: SessionId },
): Promise<SessionRigAttempt> {
  const session = await sessionRigSession(rig, partition, label, {
    kind: opening.kind,
    principal: `principal-${label}`,
    ...(opening.parent === undefined ? {} : { parent: opening.parent }),
  });
  await sessionRigTurn(rig, partition, session, label);
  return sessionRigAttempt(rig, partition, session, label);
}

/** Everything one drive produced: a lead that ran, a fork of it, and a stranger beside it. */
interface Forked {
  readonly rig: SessionRig;
  readonly app: FastifyInstance;
  readonly addressed: string[];
  readonly lead: { readonly session: SessionId; readonly stream: string };
  readonly fork: SessionRigAttempt;
  readonly stranger: SessionRigAttempt;
}

async function forkDrive(): Promise<Forked> {
  const rig = await sessionRigOpen();
  const partition = await sessionRigProject(rig, "fork");
  const { app, addressed } = forkPlane(rig);
  const lead = await forkRunLead(rig, app, partition, "lead");
  const fork = await forkReader(rig, partition, "inquiry", {
    kind: "Inquiry",
    parent: lead.session,
  });
  const stranger = await forkReader(rig, partition, "thread", {
    kind: "Thread",
  });
  return { rig, app, addressed, lead, fork, stranger };
}

async function forkClosed(drive: Forked): Promise<void> {
  await drive.app.close();
  await drive.rig.close();
}

test("a fork loads every batch of its parent's stream, and none of them is a hole", async () => {
  const drive = await forkDrive();
  try {
    drive.addressed.length = 0;
    const page = await storePage(
      drive.app,
      drive.fork.secret,
      drive.lead.stream,
    );
    assert.deepEqual(
      page.batches,
      leadBatches.map((content, at) => ({ batch: at + 1, content })),
    );
    assert.deepEqual(
      drive.addressed,
      leadBatches.map(
        (_content, at) => `${drive.lead.session}/${String(at + 1)}`,
      ),
      "the route addressed an object under a session other than the one that wrote it",
    );
  } finally {
    await forkClosed(drive);
  }
});

test("a fork is told its parent's streams, and asks for one of them by name", async () => {
  const drive = await forkDrive();
  try {
    const listed = await drive.app.inject({
      method: "GET",
      url: "/v1/session/store",
      headers: held(drive.fork.secret),
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.deepEqual(JSON.parse(listed.body), {
      streams: [{ stream: drive.lead.stream, batches: leadBatches.length }],
    });
  } finally {
    await forkClosed(drive);
  }
});

/**
 * The boundary the fix must not widen. A session with no parent may read its own
 * store and nothing else, and the rows are what say so — so the page is empty
 * AND no object was addressed, because a route that read the rows it was given
 * and then addressed an object of its own choosing would pass the first
 * assertion alone.
 */
test("a session that is nobody's fork reads no other session's objects", async () => {
  const drive = await forkDrive();
  try {
    drive.addressed.length = 0;
    const page = await storePage(
      drive.app,
      drive.stranger.secret,
      drive.lead.stream,
    );
    assert.deepEqual(page, { batches: [] });
    assert.deepEqual(drive.addressed, []);
    const listed = await drive.app.inject({
      method: "GET",
      url: "/v1/session/store",
      headers: held(drive.stranger.secret),
    });
    assert.deepEqual(JSON.parse(listed.body), { streams: [] });
  } finally {
    await forkClosed(drive);
  }
});

/**
 * A fork of a session in ANOTHER project reads nothing, and that is the read's
 * own predicate rather than the artifact root's: the store keys a project's
 * directory as well as a session's, so a route trusting the row's session alone
 * would still be inside the caller's partition — which is why the row's session
 * is read under the caller's partition and never a partition of its own.
 */
test("a fork's page is drawn inside its own project", async () => {
  const drive = await forkDrive();
  try {
    const elsewhere = await sessionRigProject(drive.rig, "fork-elsewhere");
    const other = await forkRunLead(
      drive.rig,
      drive.app,
      elsewhere,
      "elsewhere",
    );
    drive.addressed.length = 0;
    assert.deepEqual(
      await storePage(drive.app, drive.fork.secret, other.stream),
      { batches: [] },
    );
    assert.deepEqual(drive.addressed, []);
  } finally {
    await forkClosed(drive);
  }
});
