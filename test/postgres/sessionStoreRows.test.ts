/**
 * The rows that point at a session's transcript: what recording one batch
 * answers, the two quotas that refuse one, and the trigger that makes a
 * recorded batch permanent.
 *
 * THE ROW IS RECORDED WITHOUT THE PLANE READING A BYTE. Everything asserted
 * here is decided from the batch number, the digest and the sizes offered, so a
 * retry of one batch is safe and a batch merged into another is a conflict —
 * which is what lets the pod retry without the plane parsing a payload.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  nativeHttpPageItemsMax,
  sessionStoreBatchBytesMax,
  sessionStoreBytesMax,
  sessionStorePageBatchesMax,
} from "../../src/contract/http.ts";
import {
  sessionRigAttempt,
  sessionRigOpen,
  sessionRigProject,
  sessionRigSession,
  sessionRigTurn,
  type SessionRig,
  type SessionRigAttempt,
} from "./sessionHarness.ts";

let rig: SessionRig;
before(async () => {
  rig = await sessionRigOpen();
});
after(async () => {
  await rig.close();
});

/** A digest of the right shape, distinct for each thing a case names. */
function digestOf(label: string): string {
  return label
    .padEnd(8, "0")
    .slice(0, 8)
    .replace(/[^0-9a-f]/gu, "a")
    .repeat(8);
}

/** A session with a live attempt, which is the only thing that may write a batch. */
async function storing(label: string) {
  const partition = await sessionRigProject(rig, label);
  const session = await sessionRigSession(rig, partition, label);
  await sessionRigTurn(rig, partition, session, label);
  const held = await sessionRigAttempt(rig, partition, session, label);
  return { partition, session, held };
}

function offering(held: SessionRigAttempt, stream: string, batch: number) {
  return {
    secret: held.secret,
    gen: held.attempt.generation,
    stream,
    batch,
    digest: digestOf("abcdef12"),
    bytes: 128,
    events: 4,
  };
}

test("a batch is stored once, re-offered identically, and refused when it differs", async () => {
  const { held } = await storing("stored");
  const first = offering(held, "runtime-1", 1);
  assert.equal(await rig.plane.record(first), "Stored");
  assert.equal(await rig.plane.record(first), "AlreadyStored");
  assert.equal(
    await rig.plane.record({ ...first, digest: digestOf("beefbeef") }),
    "Conflict",
  );
  assert.equal(await rig.plane.record({ ...first, bytes: 129 }), "Conflict");
});

test("a batch that is not the next one of its stream is out of order", async () => {
  const { held } = await storing("ordered");
  assert.equal(
    await rig.plane.record(offering(held, "runtime-1", 2)),
    "OutOfOrder",
  );
  assert.equal(
    await rig.plane.record(offering(held, "runtime-1", 1)),
    "Stored",
  );
  assert.equal(
    await rig.plane.record(offering(held, "runtime-1", 3)),
    "OutOfOrder",
  );
  assert.equal(
    await rig.plane.record(offering(held, "runtime-1", 2)),
    "Stored",
  );
  assert.equal(
    await rig.plane.record(offering(held, "runtime-1/sub", 1)),
    "Stored",
  );
});

test("a stream no path could hold, and a digest of the wrong shape, are conflicts", async () => {
  const { held } = await storing("shapes");
  assert.equal(
    await rig.plane.record(offering(held, "runtime with a space", 1)),
    "Conflict",
  );
  assert.equal(
    await rig.plane.record(offering(held, "runtime\tone", 1)),
    "Conflict",
  );
  assert.equal(
    await rig.plane.record({
      ...offering(held, "runtime-1", 1),
      digest: "not-a-digest",
    }),
    "Conflict",
  );
});

test("a batch above the body bound and a session above its own bound are both refused", async () => {
  const { partition, session, held } = await storing("quota");
  assert.equal(
    await rig.plane.record({
      ...offering(held, "runtime-1", 1),
      bytes: sessionStoreBatchBytesMax + 1,
    }),
    "QuotaExceeded",
  );
  assert.equal(
    await rig.plane.record({
      ...offering(held, "runtime-1", 1),
      events: sessionStoreBatchBytesMax + 1,
    }),
    "QuotaExceeded",
  );
  const filled = Math.floor(sessionStoreBytesMax / sessionStoreBatchBytesMax);
  await rig.harness.query(
    `INSERT INTO session_store_batch
       (tenant,project,session,stream,batch,digest,bytes,events)
     SELECT $1,$2,$3,'runtime-full',filling,
            encode(sha256(convert_to(filling::text,'UTF8')),'hex'),$4,1
       FROM generate_series(1,$5) AS filling`,
    [
      partition.tenant,
      partition.project,
      session,
      sessionStoreBatchBytesMax,
      filled,
    ],
  );
  assert.equal(
    await rig.plane.record({
      ...offering(held, "runtime-full", filled + 1),
      bytes: 1,
    }),
    "QuotaExceeded",
  );
});

test("a dead attempt writes nothing, whatever bearer it still holds", async () => {
  const { held } = await storing("fenced");
  assert.equal(
    await rig.plane.record(offering(held, "runtime-1", 1)),
    "Stored",
  );
  await rig.scheduler.attemptEnded(held.attempt, "StoreRefused");
  assert.equal(
    await rig.plane.record(offering(held, "runtime-1", 2)),
    "Fenced",
  );
  assert.equal(
    await rig.plane.record({
      ...offering(held, "runtime-1", 2),
      gen: 99,
    }),
    "Fenced",
  );
});

test("a recorded batch is written once, by either verb", async () => {
  const { partition, session, held } = await storing("immutable");
  await rig.plane.record(offering(held, "runtime-1", 1));
  await assert.rejects(
    rig.harness.query(
      `UPDATE session_store_batch SET bytes=bytes+1
        WHERE tenant=$1 AND project=$2 AND session=$3`,
      [partition.tenant, partition.project, session],
    ),
    /is written once, and a transcript that could be edited is not a memory/u,
  );
  await assert.rejects(
    rig.harness.query(
      `DELETE FROM session_store_batch
        WHERE tenant=$1 AND project=$2 AND session=$3`,
      [partition.tenant, partition.project, session],
    ),
    /is written once, and a transcript that could be edited is not a memory/u,
  );
});

test("a page of one stream is bounded, and the streams a session holds are counted", async () => {
  const { held } = await storing("reading");
  const pages = sessionStorePageBatchesMax + 2;
  for (let batch = 1; batch <= pages; batch++)
    assert.equal(
      await rig.plane.record(offering(held, "runtime-1", batch)),
      "Stored",
    );
  await rig.plane.record(offering(held, "runtime-1/sub", 1));
  const first = await rig.plane.batches({
    secret: held.secret,
    gen: held.attempt.generation,
    stream: "runtime-1",
    after: 0,
    limit: pages,
  });
  assert.equal(first.length, sessionStorePageBatchesMax);
  assert.deepEqual(
    first.map((batch) => batch.batch),
    Array.from({ length: sessionStorePageBatchesMax }, (_, index) => index + 1),
  );
  const next = await rig.plane.batches({
    secret: held.secret,
    gen: held.attempt.generation,
    stream: "runtime-1",
    after: sessionStorePageBatchesMax,
    limit: pages,
  });
  assert.deepEqual(
    next.map((batch) => batch.batch),
    [sessionStorePageBatchesMax + 1, sessionStorePageBatchesMax + 2],
  );
  assert.deepEqual(
    await rig.plane.streams({
      secret: held.secret,
      gen: held.attempt.generation,
    }),
    [
      { stream: "runtime-1", batches: pages },
      { stream: "runtime-1/sub", batches: 1 },
    ],
  );
  assert.deepEqual(
    await rig.plane.streams({ secret: held.secret, gen: 99 }),
    [],
  );
});

test("the listing is bounded one past the page the plane may answer with", async () => {
  const { partition, session, held } = await storing("many-streams");
  const opened = nativeHttpPageItemsMax + 5;
  await rig.harness.query(
    `INSERT INTO session_store_batch
       (tenant,project,session,stream,batch,digest,bytes,events)
     SELECT $1,$2,$3,'runtime-'||opening,1,
            encode(sha256(convert_to(opening::text,'UTF8')),'hex'),1,1
       FROM generate_series(1,$4) AS opening`,
    [partition.tenant, partition.project, session, opened],
  );
  assert.equal(
    (
      await rig.plane.streams({
        secret: held.secret,
        gen: held.attempt.generation,
      })
    ).length,
    nativeHttpPageItemsMax + 1,
  );
  assert.equal(
    (
      await rig.plane.streams({
        secret: held.secret,
        gen: held.attempt.generation,
        streamsMax: 3,
      })
    ).length,
    3,
  );
});
