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
  ProjectCreationOutcome,
  ProjectCreationWrite,
  TenantStanding,
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

/** One creation of a tenant nothing names by one member, under an identity no other case is using. */
function creation(
  partition: Partition,
  overrides: Partial<ProjectCreationWrite> = {},
): ProjectCreationWrite {
  return {
    partition,
    standing: "Unclaimed",
    reserved: false,
    operation: asOperationId(`operation-${randomUUID()}`),
    authority: {
      kind: asAuthorityKind("Member"),
      subject: asAuthoritySubject("alice"),
    },
    ...overrides,
  };
}

/** The same creator asking again for what `write` made, under a new identity and the given standing. */
function repeated(
  write: ProjectCreationWrite,
  standing: TenantStanding,
): ProjectCreationWrite {
  return {
    ...write,
    standing,
    operation: asOperationId(`operation-${randomUUID()}`),
  };
}

const bob = {
  kind: asAuthorityKind("Member"),
  subject: asAuthoritySubject("bob"),
};

function creator(): ReturnType<typeof postgresProjectCreation> {
  return postgresProjectCreation(apiPool);
}

/** A refusal as the door answers it: about the request's own identity, with nothing made. */
function refused(
  outcome: ProjectCreationOutcome,
  write: ProjectCreationWrite,
): ProjectCreationAnswer {
  return {
    outcome,
    tenantCreated: false,
    grantsWritten: false,
    operation: write.operation,
  };
}

async function projectsIn(tenant: string): Promise<readonly unknown[]> {
  return harness.query(
    "SELECT project, lifecycle FROM project WHERE tenant=$1 ORDER BY project",
    [tenant],
  );
}

async function tenantRows(tenant: string): Promise<number> {
  const found = await harness.query(
    "SELECT count(*)::int AS held FROM tenant WHERE tenant=$1",
    [tenant],
  );
  return Number(found[0]?.["held"]);
}

async function operationRows(operation: string): Promise<number> {
  const found = await harness.query(
    "SELECT count(*)::int AS held FROM project_creation_operation WHERE operation=$1",
    [operation],
  );
  return Number(found[0]?.["held"]);
}

test("a new tenant is made with its project, its capacity account and the operation that made both", async () => {
  const partition = freshPartition("new");
  const write = creation(partition);
  assert.deepEqual(await creator().create(write), {
    outcome: "Created",
    tenantCreated: true,
    grantsWritten: false,
    operation: write.operation,
  });
  assert.deepEqual(await projectsIn(partition.tenant), [
    { project: partition.project, lifecycle: "Active" },
  ]);
  assert.deepEqual(
    await harness.query("SELECT tenant FROM tenant WHERE tenant=$1", [
      partition.tenant,
    ]),
    [{ tenant: partition.tenant }],
  );
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

test("a replay answers the creation it repeats, whatever the caller's standing now is", async () => {
  const partition = freshPartition("replay");
  const write = creation(partition);
  await creator().create(write);
  for (const standing of ["Administers", "Claimed", "Unclaimed"] as const)
    assert.deepEqual(await creator().create({ ...write, standing }), {
      outcome: "AlreadyCreated",
      tenantCreated: true,
      grantsWritten: false,
      operation: write.operation,
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
    operation: write.operation,
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
    { ...write, authority: bob },
    {
      ...write,
      authority: { ...write.authority, kind: asAuthorityKind("Other") },
    },
  ])
    assert.deepEqual(
      await creator().create(changed),
      refused("OperationConflict", changed),
    );
  assert.equal((await projectsIn(partition.tenant)).length, 1);
});

test("a tenant that stands is taken from anyone else expecting a new one, and nothing is written", async () => {
  const partition = freshPartition("taken");
  await creator().create(creation(partition));
  const later = creation(
    { ...partition, project: asProjectId("second") },
    { authority: bob },
  );
  assert.deepEqual(
    await creator().create(later),
    refused("TenantTaken", later),
  );
  assert.equal((await projectsIn(partition.tenant)).length, 1);
  assert.equal(await operationRows(later.operation), 0);
});

test("a tenant a tuple names is taken with or without a row, and nothing is written", async () => {
  const rowless = creation(freshPartition("claimed"), { standing: "Claimed" });
  assert.deepEqual(
    await creator().create(rowless),
    refused("TenantTaken", rowless),
  );
  assert.equal(await tenantRows(rowless.partition.tenant), 0);
  const standing = freshPartition("claimed-standing");
  await creator().create(creation(standing));
  const later = creation(
    { ...standing, project: asProjectId("second") },
    { standing: "Claimed", authority: bob },
  );
  assert.deepEqual(
    await creator().create(later),
    refused("TenantTaken", later),
  );
  assert.equal(await operationRows(later.operation), 0);
});

test("a caller administering a tenant that stands adds a project to it without making it again", async () => {
  const partition = freshPartition("existing");
  await creator().create(creation(partition));
  const second = creation(
    { ...partition, project: asProjectId("second") },
    { standing: "Administers", authority: bob },
  );
  assert.deepEqual(await creator().create(second), {
    outcome: "Created",
    tenantCreated: false,
    grantsWritten: false,
    operation: second.operation,
  });
  assert.equal((await projectsIn(partition.tenant)).length, 2);
});

test("a caller administering a tenant no row holds makes the row", async () => {
  const write = creation(freshPartition("unrecorded"), {
    standing: "Administers",
  });
  assert.deepEqual(await creator().create(write), {
    outcome: "Created",
    tenantCreated: true,
    grantsWritten: false,
    operation: write.operation,
  });
});

test("a project the tenant already has is not made twice", async () => {
  const partition = freshPartition("exists");
  await creator().create(creation(partition));
  const again = creation(partition, {
    standing: "Administers",
    authority: bob,
  });
  assert.deepEqual(
    await creator().create(again),
    refused("ProjectExists", again),
  );
  assert.equal((await projectsIn(partition.tenant)).length, 1);
});

test("a reserved name is refused only for a tenant that is new, and nothing is written", async () => {
  const reserved = creation(freshPartition("reserved"), { reserved: true });
  assert.deepEqual(
    await creator().create(reserved),
    refused("TenantReserved", reserved),
  );
  assert.equal(await tenantRows(reserved.partition.tenant), 0);
  const claimed = { ...reserved, standing: "Claimed" as const };
  assert.deepEqual(
    await creator().create(claimed),
    refused("TenantTaken", claimed),
  );
  const administered = { ...reserved, standing: "Administers" as const };
  assert.equal((await creator().create(administered)).outcome, "Created");
  const rowed = creation(
    { ...reserved.partition, project: asProjectId("second") },
    { reserved: true, authority: bob },
  );
  assert.deepEqual(
    await creator().create(rowed),
    refused("TenantTaken", rowed),
  );
});

test("the creator asking again under a new identity is answered with the creation it made, whatever its standing", async () => {
  const partition = freshPartition("again");
  const write = creation(partition);
  await creator().create(write);
  for (const standing of ["Administers", "Claimed", "Unclaimed"] as const) {
    const again = repeated(write, standing);
    assert.deepEqual(await creator().create(again), {
      outcome: "AlreadyCreated",
      tenantCreated: true,
      grantsWritten: false,
      operation: write.operation,
    });
    assert.equal(await operationRows(again.operation), 0, standing);
  }
  await creator().recordGrants(write.operation);
  assert.equal(
    (await creator().create(repeated(write, "Unclaimed"))).grantsWritten,
    true,
  );
});

test("the creator of a project in a tenant it did not make is answered with that creation too", async () => {
  const partition = freshPartition("added");
  await creator().create(creation(partition));
  const added = creation(
    { ...partition, project: asProjectId("second") },
    { standing: "Administers", authority: bob },
  );
  await creator().create(added);
  assert.deepEqual(await creator().create(repeated(added, "Administers")), {
    outcome: "AlreadyCreated",
    tenantCreated: false,
    grantsWritten: false,
    operation: added.operation,
  });
});

test("another authority, or another project, asking again is refused as before", async () => {
  const partition = freshPartition("stranger");
  const write = creation(partition);
  await creator().create(write);
  const stranger = { ...repeated(write, "Unclaimed"), authority: bob };
  assert.deepEqual(
    await creator().create(stranger),
    refused("TenantTaken", stranger),
  );
  const administering = { ...stranger, standing: "Administers" as const };
  assert.deepEqual(
    await creator().create(administering),
    refused("ProjectExists", administering),
  );
  const otherKind = {
    ...repeated(write, "Unclaimed"),
    authority: { ...write.authority, kind: asAuthorityKind("Other") },
  };
  assert.deepEqual(
    await creator().create(otherKind),
    refused("TenantTaken", otherKind),
  );
  const elsewhere = {
    ...repeated(write, "Unclaimed"),
    partition: { ...partition, project: asProjectId("elsewhere") },
  };
  assert.deepEqual(
    await creator().create(elsewhere),
    refused("TenantTaken", elsewhere),
  );
});

test("a standing the door does not know is refused", async () => {
  await assert.rejects(
    harness.query(
      `SELECT * FROM ${projectCreateFunction}($1,'project','Unknown',false,$2,'Member','alice')`,
      [`tenant-standing-${randomUUID()}`, `operation-${randomUUID()}`],
    ),
    /unknown standing/u,
  );
});

test("of two creators racing for one new tenant, the one that waited is told it is taken", async () => {
  const partition = freshPartition("race");
  const first = await harness.begin();
  let second: Promise<ProjectCreationAnswer>;
  try {
    await first.query(`SET LOCAL ROLE ${apiRole}`);
    await first.query(
      `SELECT outcome FROM ${projectCreateFunction}($1,$2,'Unclaimed',false,$3,'Member','alice')`,
      [partition.tenant, partition.project, `operation-${randomUUID()}`],
    );
    second = creator().create(
      creation(
        { ...partition, project: asProjectId("second") },
        { authority: bob },
      ),
    );
    await postgresHarnessStalled(harness.pool, 1);
  } catch (failure) {
    await first.rollback();
    throw failure;
  }
  await first.commit();
  assert.equal((await second).outcome, "TenantTaken");
  assert.deepEqual(await projectsIn(partition.tenant), [
    { project: partition.project, lifecycle: "Active" },
  ]);
});

test("one identity sent twice at once is decided once, and a second request under it is a conflict rather than a fault", async () => {
  const partition = freshPartition("twice");
  const operation = `operation-${randomUUID()}`;
  const first = await harness.begin();
  let conflicting: Promise<ProjectCreationAnswer>;
  try {
    await first.query(`SET LOCAL ROLE ${apiRole}`);
    await first.query(
      `SELECT outcome FROM ${projectCreateFunction}($1,$2,'Unclaimed',false,$3,'Member','alice')`,
      [partition.tenant, partition.project, operation],
    );
    conflicting = creator().create(
      creation(freshPartition("twice-other"), {
        operation: asOperationId(operation),
      }),
    );
    await postgresHarnessStalled(harness.pool, 1);
  } catch (failure) {
    await first.rollback();
    throw failure;
  }
  await first.commit();
  assert.equal((await conflicting).outcome, "OperationConflict");
  assert.equal(await operationRows(operation), 1);
});

test("a tenant, a creation and its recorded grants stand as written, even for the owner", async () => {
  const partition = freshPartition("immutable");
  const write = creation(partition);
  await creator().create(write);
  await creator().recordGrants(write.operation);
  for (const statement of [
    "UPDATE tenant SET tenant=tenant WHERE tenant=$1",
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
      `SELECT * FROM ${projectCreateFunction}($1,'project','Unclaimed',false,$2,'Member','alice')`,
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
    `SELECT * FROM ${projectCreateFunction}('tenant-${randomUUID()}','project','Unclaimed',false,'operation-${randomUUID()}','Member','alice')`,
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
      `SELECT * FROM ${projectCreateFunction}('tenant','project','Unclaimed',false,'operation','Member','alice')`,
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
