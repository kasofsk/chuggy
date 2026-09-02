/**
 * The resume proof, at the tier that can hold it: a real PostgreSQL, the real
 * worker-plane routes over the plane role's own pool, a real filesystem store,
 * and the provisioning command that opens the session.
 *
 * THIS IS THE ONE CLAIM NO UNIT COULD MAKE ALONE. The session is the truth and
 * the pod is a cache, and nothing under `src/` proves that until a second
 * attempt reads back what the first one wrote through the same routes a pod
 * would use. Unit by unit each half was asserted against doubles for the other,
 * which is a test of the doubles.
 *
 * THE ONLY DOUBLE IS THE AGENT. What a session pod would call `query()` for is
 * absent here, because a gate may assume neither a model credential nor the
 * public internet; `scripts/session-resume-drill.sh` is where a real runtime
 * answers a real question, and this is where the durable claims are pinned.
 *
 * A SESSION IS OPENED BY THE PROVISIONING COMMAND, run as a command, because
 * `src/roots/provisionAgentSession.ts` is a root and nothing may import one —
 * and because a boundary only the owner may execute is one no suite should
 * reach through some other identity.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import type { FastifyInstance } from "fastify";

import { artifactStore } from "../../src/adapters/artifacts/artifactStore.ts";
import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import {
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
  type SessionBearerSecret,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { asPlacementId } from "../../src/interpreter/schedulerIdentity.ts";
import { sessionStoreBatchBytesMax } from "../../src/contract/http.ts";
import { postgresHarnessUrl } from "./harness.ts";
import { inertRunEvidence } from "../adapters/workerPlaneFixtures.ts";
import {
  sessionRigAttempt,
  sessionRigOpen,
  sessionRigProject,
  sessionRigTurn,
  sessionRigTurnState,
  type SessionRig,
  type SessionRigAttempt,
} from "./sessionHarness.ts";

const execute = promisify(execFile);

const artifactRoot = mkdtempSync(join(tmpdir(), "chuggy-session-resume-"));
after(() => {
  rmSync(artifactRoot, { recursive: true, force: true });
});

/** The runtime session id a first attempt binds, which a second one must resume. */
const reference = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";

/** What the first attempt writes, one batch per line-bearing body. */
const firstBatches = [
  '{"type":"user","uuid":"u-1"}\n',
  '{"type":"assistant","uuid":"u-2"}\n{"type":"result","uuid":"u-3"}\n',
  '{"type":"system","uuid":"u-4"}\n',
];

/** What the second attempt appends after resuming, which is what makes the store grow. */
const secondBatches = ['{"type":"user","uuid":"u-5"}\n'];

function digestOf(content: string): string {
  return createHash("sha256").update(Buffer.from(content)).digest("hex");
}

/** Opens one session through the provisioning command, as the identity that owns the boundary. */
async function provisionedSession(
  partition: Partition,
  session: SessionId,
): Promise<string> {
  const ran = await execute(
    process.execPath,
    ["--experimental-strip-types", "src/roots/provisionAgentSession.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CHUG_PROVISION_SESSION_DATABASE_URL: postgresHarnessUrl(),
        CHUG_PROVISION_SESSION_ACTION: "open",
        CHUG_PROVISION_SESSION_TENANT: partition.tenant,
        CHUG_PROVISION_SESSION_PROJECT: partition.project,
        CHUG_PROVISION_SESSION_SESSION: session,
        CHUG_PROVISION_SESSION_KIND: "Lead",
        CHUG_PROVISION_SESSION_PRINCIPAL: `21:https://auth.invalid${session}`,
        CHUG_PROVISION_SESSION_CAPABILITIES: "RepositoryRead,RunCommands",
        CHUG_PROVISION_SESSION_CREDENTIAL_SLOT: "claude-code",
      },
    },
  );
  return ran.stdout;
}

/** The plane a pod actually talks to: the session ports over the plane role, and a real store. */
function resumePlane(rig: SessionRig): FastifyInstance {
  return createWorkerPlaneApp({
    authority: { authenticate: () => Promise.resolve(undefined) },
    heartbeats: { heartbeat: () => Promise.resolve(true) },
    heartbeatLeaseSecs: 300,
    artifacts: { store: () => Promise.resolve({ stored: "Stored" as const }) },
    reservations: {
      reserve: () => Promise.resolve({ reserved: "Reserved" as const }),
    },
    reports: { report: () => Promise.resolve({ ingested: "Fenced" as const }) },
    runEvidence: inertRunEvidence,
    ready: () => Promise.resolve(true),
    uploadBytesMax: sessionStoreBatchBytesMax,
    sessions: {
      authority: rig.plane,
      heartbeats: rig.plane,
      heartbeatLeaseSecs: 300,
      references: rig.plane,
      turns: rig.plane,
      settlements: rig.plane,
      records: rig.plane,
      queries: rig.plane,
      store: artifactStore({
        root: artifactRoot,
        writeBytesMax: sessionStoreBatchBytesMax,
      }),
      turnPollIntervalMs: 10,
      turnPollSecsMax: 1,
      pollsMax: 8,
    },
  });
}

/** The headers one attempt's pod speaks with, which is the only credential these routes take. */
function held(secret: SessionBearerSecret) {
  return { authorization: `Bearer ${secret}` };
}

/** Appends one batch through the route a pod uses, and refuses anything but acceptance. */
async function storedBatch(
  app: FastifyInstance,
  secret: SessionBearerSecret,
  batch: number,
  content: string,
): Promise<void> {
  const answered = await app.inject({
    method: "PUT",
    url: `/v1/session/store/${encodeURIComponent(reference)}/${String(batch)}`,
    headers: { ...held(secret), "content-type": "application/octet-stream" },
    payload: Buffer.from(content),
  });
  assert.equal(answered.statusCode, 204, answered.body);
}

/** One page of a stream as the route answers it, which is what a resuming pod loads. */
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
): Promise<StorePage> {
  const answered = await app.inject({
    method: "GET",
    url: `/v1/session/store/${encodeURIComponent(reference)}`,
    headers: held(secret),
  });
  assert.equal(answered.statusCode, 200, answered.body);
  return JSON.parse(answered.body) as StorePage;
}

/** Claims the one queued turn, refusing a mailbox that had nothing for this attempt. */
async function claimedTurn(
  app: FastifyInstance,
  secret: SessionBearerSecret,
): Promise<{ readonly turn: string; readonly ordinal: number }> {
  const answered = await app.inject({
    method: "GET",
    url: "/v1/session/turn",
    headers: held(secret),
  });
  assert.equal(answered.statusCode, 200, answered.body);
  return JSON.parse(answered.body) as {
    readonly turn: string;
    readonly ordinal: number;
  };
}

/** Everything one drive of the loop produced, which every case below reads from. */
interface Resumed {
  readonly rig: SessionRig;
  readonly app: FastifyInstance;
  readonly partition: Partition;
  readonly session: SessionId;
  readonly first: SessionRigAttempt;
  readonly second: SessionRigAttempt;
  readonly opened: string;
  readonly facts: Record<string, unknown>;
  readonly loaded: StorePage;
  readonly grown: StorePage;
  readonly rows: readonly Record<string, unknown>[];
}

/** Places one attempt, which is what turns a queued turn into a pod that may claim it. */
async function placedAttempt(
  rig: SessionRig,
  partition: Partition,
  session: SessionId,
  label: string,
): Promise<SessionRigAttempt> {
  const attempt = await sessionRigAttempt(rig, partition, session, label);
  assert.equal(
    await rig.scheduler.attemptPlaced(attempt.attempt, asPlacementId(label)),
    true,
  );
  return attempt;
}

/** The first attempt: bind the runtime session, write the store, answer the turn. */
async function resumeFirstAttempt(
  app: FastifyInstance,
  first: SessionRigAttempt,
): Promise<void> {
  const claimed = await claimedTurn(app, first.secret);
  const bound = await app.inject({
    method: "PUT",
    url: "/v1/session/reference",
    headers: held(first.secret),
    payload: { reference },
  });
  assert.equal(bound.statusCode, 204, bound.body);
  for (const [at, content] of firstBatches.entries())
    await storedBatch(app, first.secret, at + 1, content);
  const answered = await app.inject({
    method: "POST",
    url: "/v1/session/turn/answer",
    headers: held(first.secret),
    payload: {
      turn: claimed.turn,
      result: "ok",
      batchFirst: 1,
      batchLast: firstBatches.length,
    },
  });
  assert.equal(answered.statusCode, 204, answered.body);
}

/**
 * One whole drive: a provisioned session, an attempt that writes and is lost,
 * and a second attempt that resumes from the store alone and appends to it.
 */
async function resumeDrive(): Promise<Resumed> {
  const rig = await sessionRigOpen();
  const partition = await sessionRigProject(rig, "resume");
  const session = asSessionId(`session-resume-${randomUUID()}`);
  const opened = await provisionedSession(partition, session);
  const app = resumePlane(rig);
  await sessionRigTurn(rig, partition, session, "one");
  const first = await placedAttempt(rig, partition, session, "first");
  await resumeFirstAttempt(app, first);
  assert.equal(
    await rig.scheduler.attemptEnded(first.attempt, "Vanished"),
    true,
  );
  await sessionRigTurn(rig, partition, session, "two");
  const second = await placedAttempt(rig, partition, session, "second");
  const facts = JSON.parse(
    (
      await app.inject({
        method: "GET",
        url: "/v1/session",
        headers: held(second.secret),
      })
    ).body,
  ) as Record<string, unknown>;
  const loaded = await storePage(app, second.secret);
  for (const [at, content] of secondBatches.entries())
    await storedBatch(
      app,
      second.secret,
      firstBatches.length + at + 1,
      content,
    );
  const grown = await storePage(app, second.secret);
  const rows = await rig.harness.query(
    `SELECT stream,batch::text AS batch,digest,bytes::text AS bytes
       FROM session_store_batch
      WHERE tenant=$1 AND project=$2 AND session=$3 ORDER BY stream,batch`,
    [partition.tenant, partition.project, session],
  );
  return {
    rig,
    app,
    partition,
    session,
    first,
    second,
    opened,
    facts,
    loaded,
    grown,
    rows,
  };
}

async function resumeClosed(drive: Resumed): Promise<void> {
  await drive.app.close();
  await drive.rig.close();
}

test("a session that lost its attempt is given a second one, numbered after it", async () => {
  const drive = await resumeDrive();
  try {
    assert.match(drive.opened, /^Opened: Lead session /u);
    const attempts = await drive.rig.harness.query(
      `SELECT attempt,attempt_number::text AS attempt_number,state,evidence
         FROM session_attempt
        WHERE tenant=$1 AND project=$2 AND session=$3 ORDER BY attempt_number`,
      [drive.partition.tenant, drive.partition.project, drive.session],
    );
    assert.deepEqual(attempts, [
      {
        attempt: drive.first.attempt.attempt,
        attempt_number: "1",
        state: "Lost",
        evidence: "Vanished",
      },
      {
        attempt: drive.second.attempt.attempt,
        attempt_number: "2",
        state: "Running",
        evidence: null,
      },
    ]);
    assert.notEqual(
      drive.first.attempt.attempt,
      drive.second.attempt.attempt,
      "one attempt identity served two attempts",
    );
  } finally {
    await resumeClosed(drive);
  }
});

test("the second attempt is told the runtime session the first one bound", async () => {
  const drive = await resumeDrive();
  try {
    assert.equal(drive.facts["agentReference"], reference);
    assert.equal(drive.facts["session"], drive.session);
    assert.equal(drive.facts["kind"], "Lead");
  } finally {
    await resumeClosed(drive);
  }
});

test("the store the second attempt loads is every batch the first one confirmed", async () => {
  const drive = await resumeDrive();
  try {
    assert.deepEqual(
      drive.loaded.batches,
      firstBatches.map((content, at) => ({ batch: at + 1, content })),
    );
    assert.equal(drive.loaded.nextAfter, undefined);
  } finally {
    await resumeClosed(drive);
  }
});

test("the store grew across the attempts and lost nothing it already held", async () => {
  const drive = await resumeDrive();
  try {
    const whole = [...firstBatches, ...secondBatches];
    assert.equal(drive.grown.batches.length, whole.length);
    assert.deepEqual(
      drive.grown.batches,
      whole.map((content, at) => ({ batch: at + 1, content })),
    );
    assert.deepEqual(
      drive.rows,
      whole.map((content, at) => ({
        stream: reference,
        batch: String(at + 1),
        digest: digestOf(content),
        bytes: String(Buffer.byteLength(content)),
      })),
    );
  } finally {
    await resumeClosed(drive);
  }
});

test("the lost attempt's bearer is refused every route, and its generation is fenced", async () => {
  const drive = await resumeDrive();
  try {
    for (const [method, url] of [
      ["GET", "/v1/session"],
      ["GET", `/v1/session/store/${encodeURIComponent(reference)}`],
      ["POST", "/v1/session/heartbeat"],
    ] as const) {
      const answered = await drive.app.inject({
        method,
        url,
        headers: held(drive.first.secret),
      });
      assert.equal(answered.statusCode, 401, `${method} ${url}`);
      assert.deepEqual(JSON.parse(answered.body), { action: "stop" });
    }
    const stream = asSessionStoreStream(reference);
    assert.equal(
      await drive.rig.plane.record({
        secret: drive.second.secret,
        generation: drive.second.attempt.generation + 1,
        stream,
        batch: 1,
        digest: digestOf(firstBatches[0] ?? ""),
        bytes: 1,
        events: 1,
      }),
      "Fenced",
    );
  } finally {
    await resumeClosed(drive);
  }
});

test("the turn the resumed attempt failed for a store refusal loses no batch", async () => {
  const drive = await resumeDrive();
  try {
    const turn = asSessionTurnId(
      (await claimedTurn(drive.app, drive.second.secret)).turn,
    );
    const failed = await drive.app.inject({
      method: "POST",
      url: "/v1/session/turn/failure",
      headers: held(drive.second.secret),
      payload: { turn, failure: "StoreRefused" },
    });
    assert.equal(failed.statusCode, 204, failed.body);
    const state = await sessionRigTurnState(
      drive.rig,
      drive.partition,
      drive.session,
      turn,
    );
    assert.equal(state["state"], "Failed");
    assert.equal(state["failure"], "StoreRefused");
    assert.equal(state["batch_first"], null);
    const rows = await drive.rig.harness.query(
      `SELECT batch::text AS batch,digest FROM session_store_batch
        WHERE tenant=$1 AND project=$2 AND session=$3 ORDER BY batch`,
      [drive.partition.tenant, drive.partition.project, drive.session],
    );
    assert.deepEqual(
      rows,
      [...firstBatches, ...secondBatches].map((content, at) => ({
        batch: String(at + 1),
        digest: digestOf(content),
      })),
    );
  } finally {
    await resumeClosed(drive);
  }
});
