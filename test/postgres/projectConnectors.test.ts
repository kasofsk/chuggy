/**
 * A project's connectors against a real server: the fenced create, replace and
 * removal, the bound on how many a project holds, the history each write
 * appends and nothing may change, the partition every door is keyed by, and
 * which roles reach which door.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresProjectConnectors } from "../../src/adapters/postgres/projectConnectors.ts";
import {
  apiRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import {
  connectorChangesPageMax,
  connectorsProjectMax,
  type Connector,
} from "../../src/contract/connectors.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  type Authority,
} from "../../src/interpreter/operationInbox.ts";
import type { ProjectConnectorChange } from "../../src/interpreter/projectConnectors.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessPartition,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let apiPool: pg.Pool;
let workerPool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  apiPool = postgresHarnessRolePool(apiRole);
  workerPool = postgresHarnessRolePool(workerPlaneRole);
});
after(async () => {
  await workerPool.end();
  await apiPool.end();
  await harness.close();
});

function store() {
  return postgresProjectConnectors(apiPool);
}

const alice: Authority = {
  kind: asAuthorityKind("Member"),
  subject: asAuthoritySubject("alice"),
};
const bob: Authority = {
  kind: asAuthorityKind("Member"),
  subject: asAuthoritySubject("bob"),
};

const aws: Connector = {
  name: "aws-prod",
  kind: "Aws",
  settings: { roleArn: "arn:aws:iam::123456789012:role/jobs" },
};
const awsTagged: Connector = {
  ...aws,
  settings: { ...aws.settings, sessionTags: true },
};
const gcp: Connector = {
  name: "gcp",
  kind: "Gcp",
  settings: { projectNumber: "1234", pool: "chuggy", provider: "jobs" },
};
const anthropic: Connector = {
  name: "anthropic",
  kind: "Anthropic",
  settings: {
    organizationId: "org-1",
    federationRuleId: "rule-1",
    workspaceId: "ws-1",
  },
};

async function project(label: string): Promise<Partition> {
  const partition = postgresHarnessPartition(label);
  await harness.store.createProject(partition);
  return partition;
}

async function created(
  partition: Partition,
  connector: Connector,
): Promise<void> {
  assert.deepEqual(
    await store().write({ partition, connector, authority: alice }),
    { outcome: "Created", revision: 1 },
  );
}

/** Every change row of the partition, as the table holds it, oldest first. */
async function changeRows(
  partition: Partition,
): Promise<readonly Record<string, unknown>[]> {
  return harness.query(
    `SELECT authority_kind, authority_subject, name, action, kind, settings
       FROM project_connector_change
      WHERE tenant=$1 AND project=$2 ORDER BY change`,
    [partition.tenant, partition.project],
  );
}

test("a created connector reads back with its settings, and lists by name", async () => {
  const partition = await project("connector-created");
  await created(partition, gcp);
  await created(partition, awsTagged);
  await created(partition, anthropic);
  assert.deepEqual(await store().connector(partition, "aws-prod"), {
    connector: awsTagged,
    revision: 1,
  });
  assert.deepEqual(
    (await store().connectors(partition)).map((each) => each.connector),
    [anthropic, awsTagged, gcp],
  );
  assert.equal(await store().connector(partition, "absent"), undefined);
});

test("a replace against the revision that stands moves it, and session tags read back as written", async () => {
  const partition = await project("connector-replaced");
  await created(partition, aws);
  assert.deepEqual(
    await store().write({
      partition,
      connector: awsTagged,
      expectedRevision: 1,
      authority: bob,
    }),
    { outcome: "Changed", revision: 2 },
  );
  assert.deepEqual(await store().connector(partition, "aws-prod"), {
    connector: awsTagged,
    revision: 2,
  });
  const untagged: Connector = {
    ...aws,
    settings: { ...aws.settings, sessionTags: false },
  };
  assert.deepEqual(
    await store().write({
      partition,
      connector: untagged,
      expectedRevision: 2,
      authority: bob,
    }),
    { outcome: "Changed", revision: 3 },
  );
  assert.deepEqual(
    (await store().connector(partition, "aws-prod"))?.connector,
    untagged,
  );
});

test("a write naming a revision that does not stand changes nothing and names the one that does", async () => {
  const partition = await project("connector-stale-write");
  await created(partition, aws);
  const before = await changeRows(partition);
  assert.deepEqual(
    await store().write({ partition, connector: awsTagged, authority: bob }),
    { outcome: "Stale", standing: 1 },
  );
  assert.deepEqual(
    await store().write({
      partition,
      connector: awsTagged,
      expectedRevision: 2,
      authority: bob,
    }),
    { outcome: "Stale", standing: 1 },
  );
  assert.deepEqual(
    await store().write({
      partition,
      connector: gcp,
      expectedRevision: 1,
      authority: bob,
    }),
    { outcome: "Stale" },
  );
  assert.deepEqual(await store().connector(partition, "aws-prod"), {
    connector: aws,
    revision: 1,
  });
  assert.equal(await store().connector(partition, "gcp"), undefined);
  assert.deepEqual(await changeRows(partition), before);
});

test("a removal against the revision that stands removes it, and any other changes nothing", async () => {
  const partition = await project("connector-removed");
  await created(partition, aws);
  const before = await changeRows(partition);
  for (const expectedRevision of [undefined, 2])
    assert.deepEqual(
      await store().remove({
        partition,
        name: "aws-prod",
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        authority: bob,
      }),
      { outcome: "Stale", standing: 1 },
    );
  assert.deepEqual(
    await store().remove({
      partition,
      name: "absent",
      expectedRevision: 1,
      authority: bob,
    }),
    { outcome: "Stale" },
  );
  assert.deepEqual(await changeRows(partition), before);
  assert.deepEqual(
    await store().remove({
      partition,
      name: "aws-prod",
      expectedRevision: 1,
      authority: bob,
    }),
    { outcome: "Removed", revision: 1 },
  );
  assert.equal(await store().connector(partition, "aws-prod"), undefined);
  assert.deepEqual(await store().connectors(partition), []);
  await created(partition, aws);
});

test("a create past the bound is refused, and a replace at it is not", async () => {
  const partition = await project("connector-bound");
  for (let index = 0; index < connectorsProjectMax; index += 1)
    await created(partition, { ...gcp, name: `gcp-${String(index)}` });
  const before = await changeRows(partition);
  assert.deepEqual(
    await store().write({ partition, connector: aws, authority: alice }),
    { outcome: "LimitReached" },
  );
  assert.equal(await store().connector(partition, "aws-prod"), undefined);
  assert.deepEqual(await changeRows(partition), before);
  assert.equal(
    (await store().connectors(partition)).length,
    connectorsProjectMax,
  );
  assert.deepEqual(
    await store().write({
      partition,
      connector: { ...aws, name: "gcp-0" },
      expectedRevision: 1,
      authority: alice,
    }),
    { outcome: "Changed", revision: 2 },
  );
});

test("a write into a project that is not there is answered as such", async () => {
  assert.deepEqual(
    await store().write({
      partition: postgresHarnessPartition("connector-no-project"),
      connector: aws,
      authority: alice,
    }),
    { outcome: "ProjectAbsent" },
  );
});

/** What a change says happened, without the identity and instant the server gave it. */
function projectConnectorsChangeContent(
  change: ProjectConnectorChange,
): Record<string, unknown> {
  return change.action === "Removed"
    ? { authority: change.authority, action: change.action, name: change.name }
    : {
        authority: change.authority,
        action: change.action,
        connector: change.connector,
      };
}

test("each create, replace and removal appends one change, read newest first", async () => {
  const partition = await project("connector-history");
  await created(partition, aws);
  assert.equal(
    (
      await store().write({
        partition,
        connector: awsTagged,
        expectedRevision: 1,
        authority: bob,
      })
    ).outcome,
    "Changed",
  );
  assert.equal(
    (
      await store().remove({
        partition,
        name: "aws-prod",
        expectedRevision: 2,
        authority: alice,
      })
    ).outcome,
    "Removed",
  );
  assert.deepEqual(await changeRows(partition), [
    {
      authority_kind: "Member",
      authority_subject: "alice",
      name: "aws-prod",
      action: "Created",
      kind: "Aws",
      settings: aws.settings,
    },
    {
      authority_kind: "Member",
      authority_subject: "bob",
      name: "aws-prod",
      action: "Changed",
      kind: "Aws",
      settings: awsTagged.settings,
    },
    {
      authority_kind: "Member",
      authority_subject: "alice",
      name: "aws-prod",
      action: "Removed",
      kind: null,
      settings: null,
    },
  ]);
  const changes = await store().changes(partition);
  assert.deepEqual(changes.map(projectConnectorsChangeContent), [
    { authority: alice, action: "Removed", name: "aws-prod" },
    { authority: bob, action: "Changed", connector: awsTagged },
    { authority: alice, action: "Created", connector: aws },
  ]);
  for (const change of changes)
    assert.ok(!Number.isNaN(Date.parse(change.changedAt)), change.changedAt);
});

test("the history is read one bounded page at a time, each older than the last", async () => {
  const partition = await project("connector-history-pages");
  await created(partition, aws);
  for (let revision = 1; revision <= connectorChangesPageMax; revision += 1)
    assert.equal(
      (
        await store().write({
          partition,
          connector: revision % 2 === 0 ? aws : awsTagged,
          expectedRevision: revision,
          authority: alice,
        })
      ).outcome,
      "Changed",
    );
  const first = await store().changes(partition);
  assert.equal(first.length, connectorChangesPageMax);
  const last = first.at(-1);
  assert.ok(last !== undefined);
  const second = await store().changes(partition, last.change);
  assert.deepEqual(
    second.map((each) => each.action),
    ["Created"],
  );
  assert.deepEqual(
    first.map((each) => each.change),
    first.map((each) => each.change).sort((left, right) => right - left),
  );
});

/** That `other` reads, writes and removes none of the connector `aws-prod` another project holds. */
async function projectConnectorsNoneIn(other: Partition): Promise<void> {
  assert.equal(await store().connector(other, "aws-prod"), undefined);
  assert.deepEqual(await store().connectors(other), []);
  assert.deepEqual(await store().changes(other), []);
  assert.deepEqual(
    await store().write({
      partition: other,
      connector: awsTagged,
      expectedRevision: 1,
      authority: bob,
    }),
    { outcome: "Stale" },
  );
  assert.deepEqual(
    await store().remove({
      partition: other,
      name: "aws-prod",
      expectedRevision: 1,
      authority: bob,
    }),
    { outcome: "Stale" },
  );
}

test("one project's connectors and history are never reached through another's partition", async () => {
  const mine = await project("connector-mine");
  const theirs: Partition = {
    tenant: mine.tenant,
    project: postgresHarnessPartition("connector-theirs").project,
  };
  await harness.store.createProject(theirs);
  const elsewhere = await project("connector-elsewhere");
  await created(mine, aws);
  for (const other of [theirs, elsewhere]) await projectConnectorsNoneIn(other);
  await created(theirs, gcp);
  assert.deepEqual(await store().connector(mine, "aws-prod"), {
    connector: aws,
    revision: 1,
  });
  assert.deepEqual(
    (await store().connectors(mine)).map((each) => each.connector.name),
    ["aws-prod"],
  );
  assert.deepEqual(
    (await store().changes(mine)).map((each) => each.action),
    ["Created"],
  );
});

test("an update of a change is refused by the database, whoever asks", async () => {
  const partition = await project("connector-history-update");
  await created(partition, aws);
  await assert.rejects(
    harness.query(
      `UPDATE project_connector_change SET authority_subject='mallory'
        WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    /project_connector_change rows are immutable/u,
  );
});

test("a delete of a change is refused by the database, whoever asks", async () => {
  const partition = await project("connector-history-delete");
  await created(partition, aws);
  await assert.rejects(
    harness.query(
      `DELETE FROM project_connector_change WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    /project_connector_change rows are immutable/u,
  );
  assert.equal((await changeRows(partition)).length, 1);
});

test("the worker plane reads one connector and calls no door that writes, lists or reads history", async () => {
  const partition = await project("connector-worker-plane");
  await created(partition, aws);
  assert.deepEqual(
    await postgresProjectConnectors(workerPool).connector(
      partition,
      "aws-prod",
    ),
    { connector: aws, revision: 1 },
  );
  const worker = postgresProjectConnectors(workerPool);
  for (const [door, attempt] of [
    [
      "write_project_connector",
      () => worker.write({ partition, connector: gcp, authority: alice }),
    ],
    [
      "remove_project_connector",
      () =>
        worker.remove({
          partition,
          name: "aws-prod",
          expectedRevision: 1,
          authority: alice,
        }),
    ],
    ["list_project_connectors", () => worker.connectors(partition)],
    ["list_project_connector_changes", () => worker.changes(partition)],
  ] as const)
    await assert.rejects(attempt(), postgresHarnessDenial(door), door);
  for (const relation of ["project_connector", "project_connector_change"])
    await assert.rejects(
      workerPool.query(`SELECT 1 FROM ${relation}`),
      postgresHarnessDenial(relation),
      relation,
    );
  assert.deepEqual(await store().connector(partition, "aws-prod"), {
    connector: aws,
    revision: 1,
  });
});

test("the API reaches the connectors through their doors and never the relations", async () => {
  for (const relation of ["project_connector", "project_connector_change"])
    for (const statement of [
      `SELECT 1 FROM ${relation}`,
      `DELETE FROM ${relation}`,
    ])
      await assert.rejects(
        apiPool.query(statement),
        postgresHarnessDenial(relation),
        statement,
      );
});
