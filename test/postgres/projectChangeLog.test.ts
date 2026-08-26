/**
 * The change log adapter against a real server, with no HTTP anywhere near it:
 * the four reads the hub makes of the log, and the doorbell's own connection.
 *
 * THE DOORBELL IS PROVED BY RINGING IT. Nothing here asserts that the adapter
 * sends the right `LISTEN`; a case that read the statement would pass on a
 * channel nothing publishes to. Every case commits an append and waits for the
 * watcher to hear about it, which is the only claim a browser depends on.
 *
 * A LOST CONNECTION IS PRODUCED, NOT SIMULATED. The listener's backend is
 * terminated from another session, because a stub that emitted `error` on
 * command would be asserting this file's belief about what `pg` does when a
 * server goes away.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  postgresProjectChangeDoorbell,
  postgresProjectChangeLog,
} from "../../src/adapters/postgres/projectChangeLog.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { notificationPublishFunction } from "../../src/adapters/postgres/schema.ts";
import type { ProjectChangeLog } from "../../src/interpreter/projectStream.ts";
import type { ProjectSourceState } from "../../src/contract/events.ts";
import {
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let pool: ReturnType<typeof postgresPool>;
let log: ProjectChangeLog;

before(async () => {
  harness = await postgresHarnessOpen();
  pool = postgresPool(postgresHarnessUrl());
  log = postgresProjectChangeLog(pool);
});

after(async () => {
  await pool.end();
  await harness.close();
});

/** How long a case waits for something it has already committed the write for. */
const waitMsMax = 10_000;
const askMs = 25;

async function reaches(reading: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < waitMsMax; waited += askMs) {
    if (reading()) return;
    await delay(askMs);
  }
  throw new Error(`project change log: ${what} never happened`);
}

/** Publishes one notification, whose bridge appends the change this suite reads. */
async function appended(
  partition: Partition,
  kind: string,
  resource: string,
): Promise<number> {
  await harness.query(
    `SELECT ${notificationPublishFunction}($1,$2,$3,$4,NULL,NULL)`,
    [partition.tenant, partition.project, kind, resource],
  );
  const found = (await harness.query(
    `SELECT max(sequence)::text AS sequence FROM project_change
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  )) as readonly { sequence: string | null }[];
  const sequence = found[0]?.sequence;
  assert.ok(sequence, "the publication bridged to a change");
  return Number(sequence);
}

test("the log answers only the rows past the sequence it was given", async () => {
  const partition = await postgresHarnessProject(harness.store, "log-since");
  const first = await appended(partition, "Ticket", "1");
  const second = await appended(partition, "Ticket", "2");
  const found = await log.since(first, 500);
  assert.ok(found.length >= 1);
  assert.ok(found.every((row) => row.sequence > first));
  const mine = found.filter((row) => row.sequence === second);
  assert.deepEqual(
    mine.map((row) => [row.kind, row.resource]),
    [["Ticket", "2"]],
  );
  assert.deepEqual(mine[0]?.partition, partition);
});

test("the log never answers more rows than the caller asked for", async () => {
  const partition = await postgresHarnessProject(harness.store, "log-bound");
  const before = await log.latest();
  await appended(partition, "Ticket", "1");
  await appended(partition, "Ticket", "2");
  assert.equal((await log.since(before, 1)).length, 1);
});

test("a replay never crosses a tenant that shares the project's name", async () => {
  const mine = await postgresHarnessProject(harness.store, "log-shared");
  const theirs = {
    tenant: asTenantId(`${String(mine.tenant)}-other`),
    project: mine.project,
  };
  await harness.store.createProject(theirs);
  const opened = await appended(mine, "Ticket", "1");
  await appended(theirs, "Ticket", "9");
  await appended(mine, "Draft", "1");
  assert.deepEqual(
    (await log.after(mine, opened, 10)).map((row) => [row.kind, row.resource]),
    [["Draft", "1"]],
  );
  assert.deepEqual(
    (await log.after(theirs, opened, 10)).map((row) => [
      row.kind,
      row.resource,
    ]),
    [["Ticket", "9"]],
  );
});

test("a replay carries the partition's own rows and no other's", async () => {
  const mine = await postgresHarnessProject(harness.store, "log-mine");
  const theirs = await postgresHarnessProject(harness.store, "log-theirs");
  const opened = await appended(mine, "Ticket", "1");
  await appended(theirs, "Ticket", "9");
  await appended(mine, "Draft", "1");
  const replayed = await log.after(mine, opened, 10);
  assert.deepEqual(
    replayed.map((row) => [row.kind, row.resource]),
    [["Draft", "1"]],
  );
});

test("a sequence the log has swept past is refused as a gap", async () => {
  const partition = await postgresHarnessProject(harness.store, "log-retains");
  await appended(partition, "Ticket", "1");
  const earliest = (await log.since(0, 1))[0]?.sequence;
  assert.ok(earliest !== undefined);
  assert.equal(await log.retains(earliest), true);
  assert.equal(await log.retains(earliest - 1), true);
  assert.equal(await log.retains(earliest - 2), false);
});

test("a sweep the log has nothing stale for removes nothing", async () => {
  const partition = await postgresHarnessProject(harness.store, "log-sweeps");
  await appended(partition, "Ticket", "1");
  const before = (await log.since(0, 1))[0]?.sequence;
  assert.equal(await log.sweep(1_000), 0);
  assert.equal((await log.since(0, 1))[0]?.sequence, before);
});

test("a sweep allowed to remove nothing is refused, not silently idle", async () => {
  await assert.rejects(() => log.sweep(0));
});

interface Heard {
  rings: number;
  readonly states: ProjectSourceState[];
}

function doorbellUrl(name: string): string {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("application_name", name);
  return url.toString();
}

test("an appended change reaches the doorbell's own watcher", async () => {
  const partition = await postgresHarnessProject(harness.store, "log-rings");
  const heard: Heard = { rings: 0, states: [] };
  const doorbell = postgresProjectChangeDoorbell(doorbellUrl("chuggy-rings"));
  doorbell.open({
    rang: () => {
      heard.rings += 1;
    },
    sourced: (state) => heard.states.push(state),
  });
  try {
    await reaches(
      () => heard.states.includes("live"),
      "the doorbell connected",
    );
    const rung = heard.rings;
    await appended(partition, "Ticket", "1");
    await reaches(() => heard.rings > rung, "the doorbell rang");
  } finally {
    await doorbell.close();
  }
});

test("a close during a connect leaves no backend listening", async () => {
  const name = `chuggy-closes-${String(Date.now())}`;
  const heard: Heard = { rings: 0, states: [] };
  const doorbell = postgresProjectChangeDoorbell(doorbellUrl(name));
  doorbell.open({
    rang: () => {
      heard.rings += 1;
    },
    sourced: (state) => heard.states.push(state),
  });
  await doorbell.close();
  const backends = (await harness.query(
    `SELECT count(*)::text AS open FROM pg_stat_activity WHERE application_name=$1`,
    [name],
  )) as readonly { open: string }[];
  assert.equal(backends[0]?.open, "0");
  assert.deepEqual(heard.states, []);
});

test("a terminated listener degrades and then comes back live", async () => {
  const partition = await postgresHarnessProject(harness.store, "log-recovers");
  const name = `chuggy-recovers-${String(Date.now())}`;
  const heard: Heard = { rings: 0, states: [] };
  const doorbell = postgresProjectChangeDoorbell(doorbellUrl(name), {
    reconnectBaseMs: 50,
    reconnectMaxMs: 200,
  });
  doorbell.open({
    rang: () => {
      heard.rings += 1;
    },
    sourced: (state) => heard.states.push(state),
  });
  try {
    await reaches(
      () => heard.states.includes("live"),
      "the doorbell connected",
    );
    await harness.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1`,
      [name],
    );
    await reaches(
      () => heard.states.includes("degraded"),
      "the doorbell noticed the loss",
    );
    await reaches(
      () => heard.states.lastIndexOf("live") > heard.states.indexOf("degraded"),
      "the doorbell came back",
    );
    const rung = heard.rings;
    await appended(partition, "Ticket", "1");
    await reaches(() => heard.rings > rung, "the recovered doorbell rang");
  } finally {
    await doorbell.close();
  }
});
