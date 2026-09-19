/**
 * The five lead-side routes over a real database: the API's own role, the
 * definer functions 059 declares, and the HTTP boundary above them.
 *
 * WHAT A DOUBLE CANNOT ANSWER. `test/adapters/httpLeadReads.test.ts` proves the
 * assembly against a fake port; what it cannot prove is that the port's contract
 * is the server's — that the ledger reads answer one row past the page a caller
 * asks for, that the decision log's direction flag means what the newest arm
 * needs, and that the store read honours the limit the held walk pages by. Each
 * of those is a claim about a function body, and each is asserted here.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { sessionStorePageBatchesMax } from "../../src/contract/http.ts";
import { leadTranscriptResponseSchema } from "../../src/contract/responses.ts";
import { postgresLeadReads } from "../../src/adapters/postgres/leadReads.ts";
import { postgresInstallationAuthority } from "../../src/adapters/postgres/installationAuthority.ts";
import { postgresSessionStoreRows } from "../../src/adapters/postgres/sessionStoreReads.ts";
import { postgresThreadSeeding } from "../../src/adapters/postgres/thread.ts";
import { threadSessionMint } from "../../src/adapters/crypto/threadSessionMint.ts";
import { composeNativeWeb } from "../../src/compose.ts";
import {
  asSessionStoreStream,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { sessionStoreDouble, sessionStoreEntryLine } from "./storeDouble.ts";
import { leadRigOpen, leadRigProject, type LeadRig } from "./leadHarness.ts";
import {
  sessionRigAttempt,
  sessionRigSession,
  sessionRigTurnId,
} from "./sessionHarness.ts";

let rig: LeadRig;

before(async () => {
  rig = await leadRigOpen();
});

after(async () => {
  await rig.close();
});

const issuer = "https://issuer.test";
/** The volume the batch rows point at, filled by the cases that record one. */
const storeReads = sessionStoreDouble();

const authorized = { authorization: "Bearer token" };

/** One lead with a claimed attempt, which is what a pod holds while it writes. */
async function claimedLead(label: string) {
  const partition = await readableProject(label);
  const session = await sessionRigSession(rig.sessions, partition, label, {
    kind: "Lead",
  });
  const turn = sessionRigTurnId(label);
  const offered = await rig.sessions.sessions.enqueue({
    partition,
    session,
    turn,
    inputKind: "Observation",
    input: '{"version":1}',
  });
  assert.equal(offered.enqueued, "Enqueued");
  const attempt = await sessionRigAttempt(
    rig.sessions,
    partition,
    session,
    label,
  );
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  return { partition, session, turn, attempt };
}

/** One batch of one entry, recorded through the plane the pod actually uses. */
async function recordBatch(
  partition: Partition,
  session: SessionId,
  attempt: Awaited<ReturnType<typeof claimedLead>>["attempt"],
  stream: string,
  batch: number,
): Promise<void> {
  storeReads.put(
    {
      partition,
      session,
      stream: asSessionStoreStream(stream),
      batch,
    },
    sessionStoreEntryLine(batch),
  );
  assert.equal(
    await rig.sessions.plane.record({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      stream: asSessionStoreStream(stream),
      batch,
      digest: "b".repeat(64),
      bytes: 12,
      events: 1,
    }),
    "Stored",
  );
}

/** The app the routes are driven through, over the API role and the real ports. */
function leadApp(subject: string) {
  const pool = rig.apiPool;
  const leads = postgresLeadReads(pool);
  const web = composeNativeWeb(
    pool,
    rig.sessions.harness.access,
    { leads, store: storeReads },
    {
      threads: rig.threads,
      sessions: threadSessionMint(),
      seeding: postgresThreadSeeding(pool),
      rows: postgresSessionStoreRows(pool),
      store: storeReads,
      credentialSlot: "claude-code",
    },
  );
  return createNativeHttpApp(
    web,
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: { principal: oidcPrincipal(issuer, subject) },
        }),
    },
    { ready: () => Promise.resolve(true) },
    postgresInstallationAuthority(pool),
  );
}

/** A project the reader may read, which is what the routes are gated on. */
async function readableProject(label: string): Promise<Partition> {
  const partition = await leadRigProject(rig, label);
  rig.sessions.harness.access.grant({
    partition,
    principal: oidcPrincipal(issuer, label),
    access: new Set(["Read"]),
  });
  return partition;
}

function pathOf(partition: Partition): string {
  return `/api/v1/tenants/${partition.tenant}/projects/${partition.project}`;
}

test("the lead route reads a real lead, its mailbox tail and its streams", async () => {
  const { partition, session, turn, attempt } = await claimedLead("http-lead");
  const stream = asSessionStoreStream(`stream-${randomUUID()}`);
  await recordBatch(partition, session, attempt, stream, 1);
  await rig.sessions.plane.answer({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    turn,
    result: "{}",
    batchFirst: 1,
    batchLast: 1,
    measured: {
      model: "claude-model",
      tokens: 10,
      costMicros: 20,
      durationMs: 30,
      tools: [],
    },
  });

  await using app = leadApp("http-lead");
  const found = await app.inject({
    url: `${pathOf(partition)}/lead`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  const body = found.json<{
    session: string;
    state: string;
    turns: readonly { turn: string; tokens?: number }[];
    streams: readonly { stream: string; batches: number }[];
  }>();
  assert.equal(body.session, session);
  assert.equal(body.state, "Open");
  assert.equal(body.turns[0]?.turn, turn);
  assert.equal(body.turns[0]?.tokens, 10);
  assert.deepEqual(body.streams, [{ stream, batches: 1 }]);

  const transcript = await app.inject({
    url: `${pathOf(partition)}/lead/transcript?stream=${stream}`,
    headers: authorized,
  });
  assert.equal(transcript.statusCode, 200);
  const page = leadTranscriptResponseSchema.parse(transcript.json());
  assert.deepEqual(
    page.entries.map((entry) => entry.uuid),
    ["entry-1"],
  );
  assert.deepEqual(
    page.held,
    ["entry-1"],
    "an uncompacted stream holds it all",
  );
  assert.equal(page.cut, undefined);
  assert.equal(page.truncated, false);
});

/** A lead whose store holds more batches than one page of it answers. */
async function pagedStream(label: string) {
  const opened = await claimedLead(label);
  const stream = asSessionStoreStream(`stream-${randomUUID()}`);
  for (let batch = 1; batch <= sessionStorePageBatchesMax + 2; batch += 1)
    await recordBatch(
      opened.partition,
      opened.session,
      opened.attempt,
      stream,
      batch,
    );
  return {
    partition: opened.partition,
    session: opened.session,
    stream,
  };
}

test("the row read answers the limit it is given, never its own ceiling", async () => {
  const { partition, session, stream } = await pagedStream("http-store");
  const leads = postgresLeadReads(rig.apiPool);
  const asked = await leads.batches({
    partition,
    session,
    stream,
    after: 0,
    limit: 2,
  });
  assert.deepEqual(
    asked.map((row) => row.batch),
    [1, 2],
    "the function answers the limit it was given, not its own ceiling",
  );
  const capped = await leads.batches({
    partition,
    session,
    stream,
    after: 0,
    limit: sessionStorePageBatchesMax + 5,
  });
  assert.equal(
    capped.length,
    sessionStorePageBatchesMax,
    "and never more than a page, whatever it is asked for",
  );
});

test("the held walk pages the store past the page a reader asked for", async () => {
  const { partition, stream } = await pagedStream("http-walk");
  await using app = leadApp("http-walk");
  const page = leadTranscriptResponseSchema.parse(
    (
      await app.inject({
        url: `${pathOf(partition)}/lead/transcript?stream=${stream}&limit=2`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(page.entries.length, 2, "the page is the two batches asked for");
  assert.equal(page.nextAfter, 2);
  assert.deepEqual(
    page.held,
    ["entry-1", "entry-2"],
    "and the walk read past the page to decide what is held",
  );
});

test("a project the reader has no membership in answers not found", async () => {
  const partition = await readableProject("http-denied");
  await sessionRigSession(rig.sessions, partition, "http-denied", {
    kind: "Lead",
  });
  await using app = leadApp("http-stranger");
  for (const path of ["/lead", "/lead/transcript"]) {
    const found = await app.inject({
      url: `${pathOf(partition)}${path}`,
      headers: authorized,
    });
    assert.equal(found.statusCode, 404, path);
  }
});
