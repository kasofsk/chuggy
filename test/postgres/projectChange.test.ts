/**
 * The durable change log against a real server: that an append survives only a
 * commit, that its doorbell rings once for a transaction however much it
 * appended, that every writer the schema declares reaches it, and that the
 * sweep keeps it bounded and says what it left.
 *
 * THE DOORBELL IS READ ON A CONNECTION OF ITS OWN, because a notification is
 * delivered to sessions other than the one that wrote it and only once the
 * writer commits. A case reading it on the writing session would be asserting
 * that the server queued something, which is the half a rollback does anyway.
 *
 * NOTHING HERE SLEEPS FOR AN ABSENCE. A case claiming a delivery never
 * happened commits a sibling one and waits for that instead, then counts what
 * arrived: delivery on one connection is ordered, so the sibling arriving
 * alone is the absence, decided rather than waited out.
 *
 * THE SWEEP CASE IS LAST AND IT IS INSTALLATION-WIDE. The bound is over the
 * whole log rather than one project, so a sweep run before another case would
 * be deleting that case's rows; it is written where nothing follows it, and it
 * fills the log by insert rather than through the append boundary because what
 * it is about is which rows survive rather than how they arrived.
 *
 * THE EXECUTION SIDE IS DRIVEN AS `chuggy_scheduler`. Every trigger on those
 * four relations fires as whoever wrote the row, so a case driving them as the
 * migration owner would prove the trigger bodies parse rather than that the
 * deployment may run them.
 */

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import pg from "pg";

import {
  notificationPublishFunction,
  projectChangeAppendFunction,
  projectChangeRetainedFunction,
  projectChangeSweepFunction,
} from "../../src/adapters/postgres/schema.ts";
import { notificationKinds } from "../../src/contract/rosters.ts";
import {
  projectChangeChannel,
  projectChangePayload,
  projectChangeRetentionMax,
} from "../../src/interpreter/projectChange.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessProject, postgresHarnessUrl } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;

before(async () => {
  rig = await schedulerRigOpen();
});

after(async () => {
  await rig.close();
});

/** How long a case waits for a delivery it has already committed the write for. */
const doorbellWaitMsMax = 5_000;

/** How often that wait asks the server, which is what bounds the loop asking. */
const doorbellAskMs = 25;

/** How many further asks a case makes before it claims nothing else arrived. */
const doorbellQuiesceAsks = 4;

/** How far past the bound the sweep case fills the log, which is what it then removes. */
const projectChangeSweptExcess = 4;

/** One connection listening on the change channel, and every payload it was handed. */
interface ProjectChangeDoorbell {
  readonly rung: readonly string[];
  readonly settled: (deliveries: number) => Promise<void>;
  readonly quiesced: () => Promise<void>;
}

/** Listens on the channel for the body, and gives the connection back whatever it did. */
async function withDoorbell(
  body: (doorbell: ProjectChangeDoorbell) => Promise<void>,
): Promise<void> {
  const listener = new pg.Client({ connectionString: postgresHarnessUrl() });
  await listener.connect();
  const rung: string[] = [];
  listener.on("notification", (delivered) => {
    rung.push(delivered.payload ?? "");
  });
  try {
    await listener.query(`LISTEN ${projectChangeChannel}`);
    await body({
      rung,
      settled: async (deliveries) => {
        for (
          let waited = 0;
          waited < doorbellWaitMsMax;
          waited += doorbellAskMs
        ) {
          await listener.query("SELECT 1");
          if (rung.length >= deliveries) return;
          await delay(doorbellAskMs);
        }
        throw new Error(
          `project change: ${String(deliveries)} delivery(s) never arrived, ${String(rung.length)} did`,
        );
      },
      quiesced: async () => {
        for (let asked = 0; asked < doorbellQuiesceAsks; asked += 1) {
          await listener.query("SELECT 1");
          await delay(doorbellAskMs);
        }
      },
    });
  } finally {
    await listener.end();
  }
}

/** Every change this partition has appended, oldest first. */
async function changesOf(
  partition: Partition,
): Promise<readonly { kind: string; resource: string }[]> {
  return (await rig.harness.query(
    `SELECT kind,resource FROM project_change
      WHERE tenant=$1 AND project=$2 ORDER BY sequence`,
    [partition.tenant, partition.project],
  )) as readonly { kind: string; resource: string }[];
}

/** How many changes this partition has appended, which is what a delta is read from. */
async function changeCount(partition: Partition): Promise<number> {
  return (await changesOf(partition)).length;
}

/** Publishes one notification and answers the change its bridge appended. */
async function publishedChange(
  partition: Partition,
  kind: string,
  resource: string,
): Promise<string> {
  await rig.harness.query(
    `SELECT ${notificationPublishFunction}($1,$2,$3,$4,NULL,NULL)`,
    [partition.tenant, partition.project, kind, resource],
  );
  const appended = (await rig.harness.query(
    `SELECT max(sequence)::text AS sequence FROM project_change
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  )) as readonly { sequence: string | null }[];
  const sequence = appended[0]?.sequence;
  if (sequence === null || sequence === undefined) {
    throw new Error("project change: the publication bridged to nothing");
  }
  return sequence;
}

test("a rolled-back change is neither appended nor rung", async () => {
  const rolled = await postgresHarnessProject(rig.harness.store, "rolled-back");
  const kept = await postgresHarnessProject(rig.harness.store, "committed");
  await withDoorbell(async (doorbell) => {
    const session = await rig.harness.begin();
    await session.query(
      `SELECT ${notificationPublishFunction}($1,$2,'Ticket','1',NULL,NULL)`,
      [rolled.tenant, rolled.project],
    );
    const staged = (await session.query(
      `SELECT count(*)::text AS staged FROM project_change
        WHERE tenant=$1 AND project=$2`,
      [rolled.tenant, rolled.project],
    )) as readonly { staged: string }[];
    assert.equal(staged[0]?.staged, "1", "the transaction staged its append");
    await session.rollback();

    await publishedChange(kept, "Ticket", "1");
    await doorbell.settled(1);
    await doorbell.quiesced();
    assert.deepEqual(await changesOf(rolled), []);
    assert.deepEqual(doorbell.rung, [projectChangePayload]);
  });
});

test("a committed change is appended and rings the doorbell", async () => {
  const partition = await postgresHarnessProject(rig.harness.store, "rung");
  await withDoorbell(async (doorbell) => {
    await publishedChange(partition, "Draft", "draft-one");
    await doorbell.settled(1);
    assert.deepEqual(await changesOf(partition), [
      { kind: "Draft", resource: "draft-one" },
    ]);
    assert.deepEqual(doorbell.rung, [projectChangePayload]);
  });
});

test("one transaction rings once however many changes it appended", async () => {
  const partition = await postgresHarnessProject(
    rig.harness.store,
    "coalesced",
  );
  const sibling = await postgresHarnessProject(
    rig.harness.store,
    "coalesced-after",
  );
  const appended = 50;
  await withDoorbell(async (doorbell) => {
    const session = await rig.harness.begin();
    await session.query(
      `SELECT ${projectChangeAppendFunction}($1,$2,'Ticket',counted::text)
         FROM generate_series(1,$3::bigint) AS series(counted)`,
      [partition.tenant, partition.project, appended],
    );
    await session.commit();
    await publishedChange(sibling, "Ticket", "1");
    await doorbell.settled(2);
    await doorbell.quiesced();
    assert.equal(await changeCount(partition), appended);
    assert.equal(doorbell.rung.length, 2);
  });
});

test("every publication kind bridges to a change of the same kind and resource", async () => {
  const partition = await postgresHarnessProject(rig.harness.store, "bridged");
  for (const [index, kind] of notificationKinds.entries()) {
    await publishedChange(partition, kind, `resource-${String(index)}`);
  }
  assert.deepEqual(
    await changesOf(partition),
    notificationKinds.map((kind, index) => ({
      kind,
      resource: `resource-${String(index)}`,
    })),
  );
});

/** One registration of its own project, written through the scheduler's own store. */
async function schedulerRegistration(label: string) {
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const published = await changeCount(project.partition);
  const registered = await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    1,
  );
  assert.equal(registered.registered, "Registered");
  const found = await rig.pool.query<{ execution: string }>(
    "SELECT execution FROM execution WHERE tenant=$1 AND project=$2",
    [project.partition.tenant, project.partition.project],
  );
  const execution = found.rows[0]?.execution;
  assert.ok(execution, "the registration left an execution to watch");
  return {
    partition: project.partition,
    epoch: project.epoch,
    execution,
    published,
  };
}

/** Opens one attempt by hand, which writes that relation and touches no other. */
async function schedulerAttemptRow(
  registration: Awaited<ReturnType<typeof schedulerRegistration>>,
  label: string,
): Promise<string> {
  const attempt = `attempt-${label}-${randomUUID()}`;
  await rig.pool.query(
    `INSERT INTO execution_attempt (tenant,project,execution,attempt,attempt_number,
       recovery_epoch,lease_owner,lease_expires_at,capability,capability_secret_digest,manifest)
     VALUES ($1,$2,$3,$4,1,$5,$6,now()+interval '1 hour',$7,repeat('0',64),$8)`,
    [
      registration.partition.tenant,
      registration.partition.project,
      registration.execution,
      attempt,
      registration.epoch,
      `owner-${attempt}`,
      `capability-${attempt}`,
      `manifest-${attempt}`,
    ],
  );
  return attempt;
}

test("each execution relation's own write appends one change naming the execution", async () => {
  const registration = await schedulerRegistration("execution-writes");
  const partition = registration.partition;
  const named = [partition.tenant, partition.project];
  const execution = registration.execution;
  const base = registration.published;
  assert.equal(await changeCount(partition), base + 1);

  await rig.pool.query(
    "UPDATE execution SET status='Admitted' WHERE tenant=$1 AND project=$2 AND execution=$3",
    [...named, execution],
  );
  assert.equal(await changeCount(partition), base + 2);

  const attempt = await schedulerAttemptRow(registration, "execution-writes");
  assert.equal(await changeCount(partition), base + 3);

  await rig.pool.query(
    `UPDATE execution_attempt SET state='Running'
      WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt=$4`,
    [...named, execution, attempt],
  );
  assert.equal(await changeCount(partition), base + 4);

  const manifest = `manifest-${randomUUID()}`;
  const taken = await rig.pool.query<{ ordinal: string }>(
    `UPDATE project SET manifest_next=manifest_next+1
      WHERE tenant=$1 AND project=$2 RETURNING manifest_next-1 AS ordinal`,
    named,
  );
  await rig.pool.query(
    `INSERT INTO execution_result (tenant,project,manifest,execution,attempt,
       manifest_ordinal,schema_version,digest,verdict)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,'Pass')`,
    [
      ...named,
      manifest,
      execution,
      attempt,
      taken.rows[0]?.ordinal,
      createHash("sha256").update(manifest).digest("hex"),
    ],
  );
  assert.equal(await changeCount(partition), base + 5);

  await rig.pool.query(
    `INSERT INTO execution_result_artifact
       (tenant,project,manifest,ordinal,role,path,digest,bytes)
     VALUES ($1,$2,$3,1,'Handoff','handoff/one.txt',$4,1)`,
    [...named, manifest, createHash("sha256").update("one").digest("hex")],
  );
  const appended = (await changesOf(partition)).slice(base);
  assert.equal(appended.length, 6);
  assert.deepEqual(
    [...new Set(appended.map((row) => `${row.kind} ${row.resource}`))],
    [`Execution ${execution}`],
  );
});

test("an attempt update touching only the lease appends nothing", async () => {
  const registration = await schedulerRegistration("lease-only");
  const attempt = await schedulerAttemptRow(registration, "lease-only");
  const before = await changeCount(registration.partition);
  await rig.pool.query(
    `UPDATE execution_attempt
        SET lease_owner=lease_owner||'-renewed',lease_expires_at=now()+interval '2 hours'
      WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt=$4`,
    [
      registration.partition.tenant,
      registration.partition.project,
      registration.execution,
      attempt,
    ],
  );
  assert.equal(await changeCount(registration.partition), before);
});

test("an update assigning a watched column its own value appends nothing", async () => {
  const registration = await schedulerRegistration("unchanged");
  const attempt = await schedulerAttemptRow(registration, "unchanged");
  const named = [registration.partition.tenant, registration.partition.project];
  const before = await changeCount(registration.partition);
  await rig.pool.query(
    `UPDATE execution_attempt SET state=state,ended_at=ended_at
      WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt=$4`,
    [...named, registration.execution, attempt],
  );
  await rig.pool.query(
    `UPDATE execution SET status=status,terminal_at=terminal_at
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...named, registration.execution],
  );
  assert.equal(await changeCount(registration.partition), before);
});

/** The whole log's bounds, which is what the sweep moves and the retained-check reads. */
async function projectChangeBounds(): Promise<{
  earliest: number;
  latest: number;
  held: number;
}> {
  const [read] = (await rig.harness.query(
    `SELECT coalesce(min(sequence),0)::text AS earliest,
            coalesce(max(sequence),0)::text AS latest,
            count(*)::text AS held FROM project_change`,
  )) as readonly { earliest: string; latest: string; held: string }[];
  if (read === undefined) {
    throw new Error("project change: the log reported no bounds");
  }
  return {
    earliest: Number(read.earliest),
    latest: Number(read.latest),
    held: Number(read.held),
  };
}

/** The oldest sequences the log is holding, which is the end a sweep works from. */
async function projectChangeOldest(count: number): Promise<readonly number[]> {
  return (
    (await rig.harness.query(
      `SELECT sequence::text AS held FROM project_change
        ORDER BY project_change.sequence LIMIT $1`,
      [count],
    )) as readonly { held: string }[]
  ).map((row) => Number(row.held));
}

/** Runs one sweep with the bound given and answers how many rows it removed. */
async function sweptRows(limit: number): Promise<number> {
  const [removed] = (await rig.harness.query(
    `SELECT ${projectChangeSweepFunction}($1::bigint)::text AS removed`,
    [limit],
  )) as readonly { removed: string }[];
  if (removed === undefined) {
    throw new Error("project change: the sweep answered nothing");
  }
  return Number(removed.removed);
}

/** Whether the server says a consumer holding this cursor can still be replayed. */
async function projectChangeRetains(cursor: number): Promise<boolean> {
  const [answered] = (await rig.harness.query(
    `SELECT ${projectChangeRetainedFunction}($1::bigint) AS retained`,
    [cursor],
  )) as readonly { retained: boolean }[];
  if (answered === undefined) {
    throw new Error("project change: the retained check answered nothing");
  }
  return answered.retained;
}

test("a sweep refuses a bound that would remove nothing", async () => {
  for (const limit of [0, -1, null]) {
    await assert.rejects(
      rig.harness.query(`SELECT ${projectChangeSweepFunction}($1::bigint)`, [
        limit,
      ]),
      /at least one row/u,
    );
  }
});

test("the sweep keeps the installation's newest changes and says what it removed", async () => {
  const partition = await postgresHarnessProject(rig.harness.store, "swept");
  await rig.harness.query(
    `INSERT INTO project_change (tenant,project,kind,resource)
     SELECT $1,$2,'Ticket',counted::text
       FROM generate_series(1,$3::bigint) AS series(counted)`,
    [
      partition.tenant,
      partition.project,
      projectChangeRetentionMax + projectChangeSweptExcess,
    ],
  );
  const filled = await projectChangeBounds();
  const excess = filled.held - projectChangeRetentionMax;
  assert.ok(
    excess >= projectChangeSweptExcess,
    `the log was filled past its bound, and holds ${String(filled.held)}`,
  );
  const oldest = await projectChangeOldest(excess + 1);

  assert.equal(
    await sweptRows(excess - 1),
    excess - 1,
    "the sweep removes no more than the bound it was given",
  );
  assert.equal(await sweptRows(excess), 1);
  assert.equal(await sweptRows(excess), 0);

  const swept = await projectChangeBounds();
  assert.deepEqual(
    [swept.held, swept.latest, swept.earliest],
    [projectChangeRetentionMax, filled.latest, oldest.at(excess)],
  );
});

test("the retained check tells a cursor the sweep passed from one it did not", async () => {
  const bounds = await projectChangeBounds();
  assert.ok(bounds.held > 0, "the log has a boundary to be on either side of");
  assert.deepEqual(
    [
      await projectChangeRetains(bounds.earliest - 1),
      await projectChangeRetains(bounds.earliest),
      await projectChangeRetains(bounds.latest),
      await projectChangeRetains(bounds.earliest - 2),
    ],
    [true, true, true, false],
  );
});
