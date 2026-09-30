/**
 * The creation doors against a real server: every outcome they answer, the race
 * between two creators of one new tenant, what the triggers refuse even from the
 * owner, and which role may reach any of it.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { postgresProjectCreation } from "../../src/adapters/postgres/projectCreation.ts";
import {
  apiRole,
  configurationImporterRole,
  finalizerRole,
  poolPlaneRole,
  projectCreateFunction,
  projectCreationGrantsFunction,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
} from "../../src/interpreter/operationInbox.ts";
import type {
  ProjectCreationAnswer,
  ProjectCreationWrite,
} from "../../src/interpreter/projectCreation.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessRolePool,
  postgresHarnessStalled,
  type PostgresHarness,
} from "./harness.ts";
import type pg from "pg";

let harness: PostgresHarness;
let apiPool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  apiPool = postgresHarnessRolePool(apiRole);
});
after(async () => {
  await apiPool.end();
  await harness.close();
});

/** A partition whose tenant no other case has named. */
function freshPartition(label: string): Partition {
  return {
    tenant: asTenantId(`tenant-${label}-${randomUUID()}`),
    project: asProjectId(`project-${label}`),
  };
}

/** One creation of a new tenant by one member, under an identity no other case is using. */
function creation(
  partition: Partition,
  overrides: Partial<ProjectCreationWrite> = {},
): ProjectCreationWrite {
  return {
    partition,
    tenantNew: true,
    operation: asOperationId(`operation-${randomUUID()}`),
    authority: {
      kind: asAuthorityKind("Member"),
      subject: asAuthoritySubject("alice"),
    },
    ...overrides,
  };
}

function creator(): ReturnType<typeof postgresProjectCreation> {
  return postgresProjectCreation(apiPool);
}

async function projectsIn(tenant: string): Promise<readonly unknown[]> {
  return harness.query(
    "SELECT project, lifecycle FROM project WHERE tenant=$1 ORDER BY project",
    [tenant],
  );
}

test("a new tenant is made with its project, its capacity account and the operation that made both", async () => {
  const partition = freshPartition("new");
  const write = creation(partition);
  assert.deepEqual(await creator().create(write), {
    outcome: "Created",
    tenantCreated: true,
    grantsWritten: false,
  });
  assert.deepEqual(await projectsIn(partition.tenant), [
    { project: partition.project, lifecycle: "Active" },
  ]);
  assert.equal(
    (
      await harness.query(
        "SELECT count(*)::int AS held FROM capacity_account WHERE account=project_capacity_account($1,$2)",
        [partition.tenant, partition.project],
      )
    )[0]?.["held"],
    1,
  );
  assert.deepEqual(
    await harness.query(
      `SELECT operation, tenant, project, tenant_created, authority_kind, authority_subject
         FROM project_creation_operation WHERE tenant=$1`,
      [partition.tenant],
    ),
    [
      {
        operation: write.operation,
        tenant: partition.tenant,
        project: partition.project,
        tenant_created: true,
        authority_kind: "Member",
        authority_subject: "alice",
      },
    ],
  );
});

test("a replay answers the creation it repeats, whatever the caller now expects of the tenant", async () => {
  const partition = freshPartition("replay");
  const write = creation(partition);
  await creator().create(write);
  for (const tenantNew of [true, false])
    assert.deepEqual(await creator().create({ ...write, tenantNew }), {
      outcome: "AlreadyCreated",
      tenantCreated: true,
      grantsWritten: false,
    });
  assert.equal((await projectsIn(partition.tenant)).length, 1);
});

test("a replay after its own grants are recorded is told so, and recording again changes nothing", async () => {
  const partition = freshPartition("recorded");
  const write = creation(partition);
  const beside = creation(freshPartition("unrecorded"));
  await creator().create(write);
  await creator().create(beside);
  await creator().recordGrants(write.operation);
  assert.equal((await creator().create(beside)).grantsWritten, false);
  const first = await harness.query(
    "SELECT recorded_at FROM project_creation_grant WHERE operation=$1",
    [write.operation],
  );
  await creator().recordGrants(write.operation);
  assert.deepEqual(await creator().create(write), {
    outcome: "AlreadyCreated",
    tenantCreated: true,
    grantsWritten: true,
  });
  assert.deepEqual(
    await harness.query(
      "SELECT recorded_at FROM project_creation_grant WHERE operation=$1",
      [write.operation],
    ),
    first,
  );
});

test("grants are recorded only for an operation that created a project", async () => {
  await assert.rejects(
    creator().recordGrants(asOperationId(`operation-${randomUUID()}`)),
    /project_creation_grant_operation_fkey/u,
  );
});

test("an identity spent on one creation is a conflict for any other and writes nothing", async () => {
  const partition = freshPartition("conflict");
  const write = creation(partition);
  await creator().create(write);
  const other = { ...partition, project: asProjectId("other") };
  for (const changed of [
    { ...write, partition: other },
    {
      ...write,
      authority: { ...write.authority, subject: asAuthoritySubject("bob") },
    },
    {
      ...write,
      authority: { ...write.authority, kind: asAuthorityKind("Other") },
    },
  ])
    assert.deepEqual(await creator().create(changed), {
      outcome: "OperationConflict",
      tenantCreated: false,
      grantsWritten: false,
    });
  assert.equal((await projectsIn(partition.tenant)).length, 1);
});

test("a tenant that stands is taken from a caller expecting a new one, and nothing is written", async () => {
  const partition = freshPartition("taken");
  await creator().create(creation(partition));
  const later = creation(
    { ...partition, project: asProjectId("second") },
    {
      authority: {
        kind: asAuthorityKind("Member"),
        subject: asAuthoritySubject("bob"),
      },
    },
  );
  assert.deepEqual(await creator().create(later), {
    outcome: "TenantTaken",
    tenantCreated: false,
    grantsWritten: false,
  });
  assert.equal((await projectsIn(partition.tenant)).length, 1);
  assert.deepEqual(
    await harness.query(
      "SELECT operation FROM project_creation_operation WHERE operation=$1",
      [later.operation],
    ),
    [],
  );
});

test("a caller administering a tenant that stands adds a project to it without making it again", async () => {
  const partition = freshPartition("existing");
  await creator().create(creation(partition));
  const second = { ...partition, project: asProjectId("second") };
  assert.deepEqual(
    await creator().create(creation(second, { tenantNew: false })),
    { outcome: "Created", tenantCreated: false, grantsWritten: false },
  );
  assert.equal((await projectsIn(partition.tenant)).length, 2);
});

test("a caller administering a tenant no row holds makes the row", async () => {
  const partition = freshPartition("unrecorded");
  assert.deepEqual(
    await creator().create(creation(partition, { tenantNew: false })),
    { outcome: "Created", tenantCreated: true, grantsWritten: false },
  );
});

test("a project the tenant already has is not made twice", async () => {
  const partition = freshPartition("exists");
  await creator().create(creation(partition));
  assert.deepEqual(
    await creator().create(creation(partition, { tenantNew: false })),
    { outcome: "ProjectExists", tenantCreated: false, grantsWritten: false },
  );
  assert.equal((await projectsIn(partition.tenant)).length, 1);
});

test("of two creators racing for one new tenant, the one that waited is told it is taken", async () => {
  const partition = freshPartition("race");
  const first = await harness.begin();
  let second: Promise<ProjectCreationAnswer>;
  try {
    await first.query(`SET LOCAL ROLE ${apiRole}`);
    await first.query(
      `SELECT outcome FROM ${projectCreateFunction}($1,$2,true,$3,'Member','alice')`,
      [partition.tenant, partition.project, `operation-${randomUUID()}`],
    );
    second = creator().create(
      creation(
        { ...partition, project: asProjectId("second") },
        {
          authority: {
            kind: asAuthorityKind("Member"),
            subject: asAuthoritySubject("bob"),
          },
        },
      ),
    );
    await postgresHarnessStalled(harness.pool, 1);
  } catch (failure) {
    await first.rollback();
    throw failure;
  }
  await first.commit();
  assert.deepEqual(await second, {
    outcome: "TenantTaken",
    tenantCreated: false,
    grantsWritten: false,
  });
  assert.deepEqual(await projectsIn(partition.tenant), [
    { project: partition.project, lifecycle: "Active" },
  ]);
});

test("a tenant, a creation and its recorded grants stand as written, even for the owner", async () => {
  const partition = freshPartition("immutable");
  const write = creation(partition);
  await creator().create(write);
  await creator().recordGrants(write.operation);
  for (const statement of [
    "UPDATE tenant SET created_at=now() WHERE tenant=$1",
    "DELETE FROM tenant WHERE tenant=$1",
    "UPDATE project_creation_operation SET tenant_created=false WHERE tenant=$1",
    "DELETE FROM project_creation_operation WHERE tenant=$1",
    `UPDATE project_creation_grant SET recorded_at=now() WHERE operation IN (
       SELECT operation FROM project_creation_operation WHERE tenant=$1)`,
    `DELETE FROM project_creation_grant WHERE operation IN (
       SELECT operation FROM project_creation_operation WHERE tenant=$1)`,
  ])
    await assert.rejects(
      harness.query(statement, [partition.tenant]),
      /rows are immutable/u,
      statement,
    );
});

test("at most one creation made a tenant, and none names an unbounded identity", async () => {
  const partition = freshPartition("once");
  await creator().create(creation(partition));
  await assert.rejects(
    harness.query(
      `INSERT INTO project_creation_operation
         (operation,tenant,project,tenant_created,authority_kind,authority_subject)
         VALUES($1,$2,$3,true,'Member','bob')`,
      [`operation-${randomUUID()}`, partition.tenant, partition.project],
    ),
    /project_creation_operation_creates_a_tenant_once/u,
  );
  await assert.rejects(
    harness.query(
      `SELECT * FROM ${projectCreateFunction}($1,'project',true,$2,'Member','alice')`,
      [`tenant-bounded-${randomUUID()}`, "o".repeat(257)],
    ),
    /project_creation_operation_is_bounded/u,
  );
});

test("a project naming no tenant row is refused", async () => {
  await assert.rejects(
    harness.query(
      "INSERT INTO project(tenant,project,lifecycle) VALUES($1,'orphan','Active')",
      [`tenant-orphan-${randomUUID()}`],
    ),
    /project_names_a_tenant/u,
  );
});

test("the API executes the creation doors and reaches no relation behind them", async () => {
  const write = creation(freshPartition("api"));
  await creator().create(write);
  for (const call of [
    `SELECT * FROM ${projectCreateFunction}('tenant-${randomUUID()}','project','t','operation-${randomUUID()}','Member','alice')`,
    `SELECT ${projectCreationGrantsFunction}('${write.operation}')`,
  ])
    assert.equal(await harness.attemptAs(apiRole, call), undefined, call);
  for (const relation of [
    "tenant",
    "project_creation_operation",
    "project_creation_grant",
  ])
    for (const statement of [
      `SELECT * FROM ${relation}`,
      `INSERT INTO ${relation} DEFAULT VALUES`,
    ])
      assert.match(
        (await harness.attemptAs(apiRole, statement)) ?? "",
        postgresHarnessDenial(relation),
        statement,
      );
});

test("no runtime role but the API creates a project or records its grants", async () => {
  for (const [door, call] of [
    [
      projectCreateFunction,
      `SELECT * FROM ${projectCreateFunction}('tenant','project','t','operation','Member','alice')`,
    ],
    [
      projectCreationGrantsFunction,
      `SELECT ${projectCreationGrantsFunction}('operation')`,
    ],
  ] as const)
    for (const role of [
      ticketServiceRole,
      selectorServiceRole,
      schedulerRole,
      finalizerRole,
      workerPlaneRole,
      poolPlaneRole,
      configurationImporterRole,
    ])
      assert.match(
        (await harness.attemptAs(role, call)) ?? "",
        postgresHarnessDenial(door),
        role,
      );
});
