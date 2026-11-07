/**
 * The epic relations: content bounds, membership without a ticket reference,
 * and a history that is written once.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresHarnessOpen, postgresHarnessProject } from "./harness.ts";
import type { PostgresHarness } from "./harness.ts";

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

async function epicIn(label: string, title = "Epic") {
  const partition = await postgresHarnessProject(harness.store, label);
  await harness.query(
    `INSERT INTO epic(tenant,project,number,revision,title,description,visibility)
     VALUES($1,$2,1,1,$3,'About','Active')`,
    [partition.tenant, partition.project, title],
  );
  return partition;
}

test("an epic holds its content within the bounds and no summary as null", async () => {
  const partition = await epicIn("epic-row");
  const rows = await harness.query(
    `SELECT summary FROM epic WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  assert.equal(rows[0]?.["summary"], null);
  for (const [title, visibility] of [
    ["", "Active"],
    ["  ", "Active"],
    ["x".repeat(201), "Active"],
    ["ok", "Hidden"],
  ] as const) {
    await assert.rejects(() =>
      harness.query(
        `INSERT INTO epic(tenant,project,number,revision,title,description,visibility)
         VALUES($1,$2,2,1,$3,'',$4)`,
        [partition.tenant, partition.project, title, visibility],
      ),
    );
  }
});

test("an epic names a project and a number is held once", async () => {
  const partition = await epicIn("epic-key");
  await assert.rejects(() =>
    harness.query(
      `INSERT INTO epic(tenant,project,number,revision,title,description,visibility)
       VALUES($1,$2,1,1,'Again','','Active')`,
      [partition.tenant, partition.project],
    ),
  );
  await assert.rejects(() =>
    harness.query(
      `INSERT INTO epic(tenant,project,number,revision,title,description,visibility)
       VALUES($1,'no-such-project',1,1,'T','','Active')`,
      [partition.tenant],
    ),
  );
});

test("a member is held without a ticket of that number existing, once per epic", async () => {
  const partition = await epicIn("epic-member");
  const member = (ticket: number) =>
    harness.query(
      `INSERT INTO epic_ticket(tenant,project,epic,ticket) VALUES($1,$2,1,$3)`,
      [partition.tenant, partition.project, ticket],
    );
  await member(999);
  await assert.rejects(() => member(999));
  await assert.rejects(() => member(0));
  await assert.rejects(() =>
    harness.query(
      `INSERT INTO epic_ticket(tenant,project,epic,ticket) VALUES($1,$2,7,1)`,
      [partition.tenant, partition.project],
    ),
  );
});

test("the index of a ticket's epics exists", async () => {
  const rows = await harness.query(
    `SELECT 1 FROM pg_indexes WHERE indexname='epic_ticket_by_ticket'`,
  );
  assert.equal(rows.length, 1);
});

test("a change is appended and neither rewritten nor removed", async () => {
  const partition = await epicIn("epic-change");
  const change = (revision: number, tickets: string) =>
    harness.query(
      `INSERT INTO epic_change(tenant,project,epic,revision,actor_kind,actor_subject,
                               title,description,visibility,tickets)
       VALUES($1,$2,1,$3,'User','someone','Epic','About','Active',${tickets})`,
      [partition.tenant, partition.project, revision],
    );
  await change(1, "'{1,2}'");
  await change(2, "'{}'");
  await assert.rejects(() => change(2, "'{}'"));
  await assert.rejects(() => change(3, "'{0}'"));
  await assert.rejects(
    () =>
      harness.query(`UPDATE epic_change SET title='Other' WHERE project=$1`, [
        partition.project,
      ]),
    /immutable/,
  );
  await assert.rejects(
    () =>
      harness.query(`DELETE FROM epic_change WHERE project=$1`, [
        partition.project,
      ]),
    /immutable/,
  );
});
