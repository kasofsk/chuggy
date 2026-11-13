/**
 * The deletion doors against a real server: a project that never ran work is
 * deleted with everything it is, a project that did is refused with what holds
 * it, a tenant holding no project is deleted with its claims and links and its
 * name made again, and only the API reaches either door.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { postgresForgeInstallationRecording } from "../../src/adapters/postgres/forgeInstallation.ts";
import {
  postgresProjectDeletion,
  postgresTenantDeletion,
} from "../../src/adapters/postgres/unrunDeletion.ts";
import {
  apiRole,
  projectDeleteFunction,
  schedulerRole,
  tenantDeleteFunction,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  projectDeletionHoldingsAt174,
  projectDeletionRelationsAt174,
} from "../../src/adapters/postgres/schema/migrations/174-unrun-deletion.ts";
import {
  asForgeAccount,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
} from "../../src/interpreter/forgeInstallation.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessDenial,
  postgresHarnessHistory,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessReleaseSubmission,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";
import { fixtureBoundRepository } from "./repositoryBindingFixture.ts";
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

/**
 * Every relation keyed by a project that its deletion does not empty, and why
 * no project it deletes holds a row there: what holds the project, a relation
 * reached only beneath one of those, the project row itself, or a cursor.
 */
const unrunDeletionBeneath: Readonly<Record<string, string>> = {
  journal_entry: "ReleasedTicket",
  finalization_request: "ReleasedTicket",
  finalization_attempt: "ReleasedTicket",
  finalization_change_proposal: "ReleasedTicket",
  finalization_reconciliation: "ReleasedTicket",
  commit_permit: "ReleasedTicket",
  native_action: "ReleasedTicket",
  native_action_resolution: "ReleasedTicket",
  evaluation_stack: "ReleasedTicket",
  evaluation_stack_beneath: "ReleasedTicket",
  evaluation_stack_dead: "ReleasedTicket",
  evaluation_stack_none: "ReleasedTicket",
  evaluation_stack_removal: "ReleasedTicket",
  execution: "Execution",
  execution_attempt: "Execution",
  execution_attempt_limit: "Execution",
  execution_request: "Execution",
  execution_request_task: "Execution",
  execution_result: "Execution",
  execution_result_artifact: "Execution",
  execution_result_report: "Execution",
  execution_result_source: "Execution",
  execution_run: "Execution",
  execution_run_context: "Execution",
  execution_run_model_usage: "Execution",
  execution_run_total: "Execution",
  execution_run_transcript_batch: "Execution",
  execution_run_turn: "Execution",
  execution_verdict_carry: "Execution",
  worker_artifact_reservation: "Execution",
  agent_account_limit: "Execution",
  agent_account_usage: "Execution",
  agent_session: "Session",
  session_attempt: "Session",
  session_store_batch: "Session",
  session_turn: "Session",
  session_turn_context: "Session",
  worker_pool: "WorkerPool",
  action_observation: "ActionObservation",
  project: "the project row, deleted last",
  selector_inventory_state:
    "the selector's cursor, a position and no row of the project's",
};

/** Every relation carrying both a tenant and a project column, partitions read through their parent. */
async function projectKeyedRelations(): Promise<readonly string[]> {
  const found = await harness.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
        AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                    AND a.attname='tenant' AND NOT a.attisdropped)
        AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                    AND a.attname='project' AND NOT a.attisdropped)
      ORDER BY c.relname`,
  );
  return found.map((row) => String(row["relname"]));
}

/** How many rows of each project-keyed relation name the partition, the relations naming none left out. */
async function rowsNaming(
  partition: Partition,
): Promise<Readonly<Record<string, number>>> {
  const held: Record<string, number> = {};
  for (const relation of await projectKeyedRelations()) {
    const found = await harness.query(
      `SELECT count(*)::int AS held FROM public.${relation} WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    );
    const count = Number(found[0]?.["held"]);
    if (count > 0) held[relation] = count;
  }
  return held;
}

function freshPartition(label: string): Partition {
  return {
    tenant: asTenantId(`tenant-${label}-${randomUUID()}`),
    project: asProjectId(`project-${label}`),
  };
}

async function created(
  partition: Partition,
  standing: "Unclaimed" | "Administers",
  subject = "alice",
): Promise<string> {
  const found = await harness.query(
    `SELECT outcome, tenant_created FROM create_project($1,$2,$3,false,$4,'Member',$5)`,
    [
      partition.tenant,
      partition.project,
      standing,
      `operation-${randomUUID()}`,
      subject,
    ],
  );
  return `${String(found[0]?.["outcome"])}:${String(found[0]?.["tenant_created"])}`;
}

async function capacityAccounts(partition: Partition): Promise<number> {
  const found = await harness.query(
    `SELECT count(*)::int AS held FROM capacity_account
      WHERE account=project_capacity_account($1,$2)`,
    [partition.tenant, partition.project],
  );
  return Number(found[0]?.["held"]);
}

async function tenantRows(tenant: TenantId): Promise<number> {
  const found = await harness.query(
    "SELECT count(*)::int AS held FROM tenant WHERE tenant=$1",
    [tenant],
  );
  return Number(found[0]?.["held"]);
}

test("every relation keyed by a project is emptied by its deletion or reached only beneath what holds it", async () => {
  const keyed = await projectKeyedRelations();
  const deleted: readonly string[] = projectDeletionRelationsAt174;
  const holdings: readonly string[] = Object.values(
    projectDeletionHoldingsAt174,
  );
  const unaccounted = keyed.filter(
    (relation) =>
      !deleted.includes(relation) &&
      !Object.hasOwn(unrunDeletionBeneath, relation),
  );
  assert.deepEqual(unaccounted, []);
  for (const relation of deleted)
    assert.ok(keyed.includes(relation), `${relation} is keyed by a project`);
  for (const relation of holdings)
    assert.ok(
      Object.hasOwn(unrunDeletionBeneath, relation) &&
        !deleted.includes(relation),
      `${relation} holds a project rather than being deleted with it`,
    );
});

test("a project that released nothing is deleted with its drafts, bindings, configurations, operations, settings and capacity", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    `unrun-${randomUUID()}`,
  );
  const submission = await postgresHarnessReleaseSubmission(
    harness,
    partition,
    "unrun",
  );
  assert.equal(
    (await harness.inbox.accept(submission)).accepted,
    "Accepted",
    "an accepted release no writer decided is no released ticket",
  );
  await fixtureBoundRepository(harness, apiPool, partition, "unrun");
  await harness.query(
    `SELECT set_project_owner_fallback($1,$2,'Strict','Member','alice')`,
    [partition.tenant, partition.project],
  );
  await harness.query(
    `INSERT INTO epic(tenant,project,number,revision,title,description,visibility)
     VALUES($1,$2,1,1,'Epic','About','Active')`,
    [partition.tenant, partition.project],
  );
  const store = postgresProjectDeletion(apiPool);
  assert.deepEqual(await store.holds(partition), []);
  const before = await rowsNaming(partition);
  for (const relation of [
    "draft",
    "configuration_revision",
    "project_repository",
    "project_repository_bind_operation",
    "operation",
    "project_owner_fallback",
    "epic",
  ])
    assert.ok((before[relation] ?? 0) > 0, `${relation} holds a row first`);
  assert.equal(await capacityAccounts(partition), 1);

  assert.deepEqual(await store.delete(partition), { outcome: "Deleted" });
  assert.deepEqual(await rowsNaming(partition), {});
  assert.equal(await capacityAccounts(partition), 0);
  assert.equal(await store.holds(partition), undefined);
  assert.deepEqual(await store.delete(partition), { outcome: "NotFound" });
});

test("a project that released a ticket is refused and named as holding one, and nothing is deleted", async () => {
  const label = `ran-${randomUUID()}`;
  const partition = await postgresHarnessProject(harness.store, label);
  await postgresHarnessHistory(harness, partition, label, 1);
  const store = postgresProjectDeletion(apiPool);
  const held = await store.holds(partition);
  assert.ok(held?.includes("ReleasedTicket"), String(held));
  const before = await rowsNaming(partition);
  assert.deepEqual(await store.delete(partition), {
    outcome: "Held",
    held,
  });
  assert.deepEqual(await rowsNaming(partition), before);
  const lifecycle = await harness.query(
    "SELECT lifecycle FROM project WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  assert.equal(lifecycle[0]?.["lifecycle"], "Active");
});

test("a project a pool is registered for is refused and named as holding it", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    `pooled-${randomUUID()}`,
  );
  await harness.query(
    `INSERT INTO worker_pool(tenant,project,pool,principal,client_id,class)
     VALUES($1,$2,'pool',$3,$4,'Dedicated')`,
    [
      partition.tenant,
      partition.project,
      `principal-${randomUUID()}`,
      `client-${randomUUID()}`,
    ],
  );
  assert.deepEqual(await postgresProjectDeletion(apiPool).delete(partition), {
    outcome: "Held",
    held: ["WorkerPool"],
  });
});

test("what a binding and a creation are held to still holds of a project not being deleted, even for the owner", async () => {
  const partition = freshPartition("immutable");
  assert.equal(await created(partition, "Unclaimed"), "Created:true");
  await fixtureBoundRepository(harness, apiPool, partition, "immutable");
  for (const relation of [
    "project_repository",
    "project_repository_bind_operation",
    "project_creation_operation",
  ])
    await assert.rejects(
      () =>
        harness.query(
          `DELETE FROM ${relation} WHERE tenant=$1 AND project=$2`,
          [partition.tenant, partition.project],
        ),
      /immutable/u,
      relation,
    );
  await assert.rejects(
    () =>
      harness.query("DELETE FROM tenant WHERE tenant=$1", [partition.tenant]),
    /tenant rows are immutable/u,
  );
});

test("a tenant is held by its projects, deleted once it holds none with its claims and links, and its name is made again", async () => {
  const first = freshPartition("workspace");
  const second = { ...first, project: asProjectId("project-second") };
  assert.equal(await created(first, "Unclaimed"), "Created:true");
  assert.equal(await created(second, "Administers"), "Created:false");
  assert.equal(
    await postgresForgeInstallationRecording(harness.pool).record({
      forge: asForgeId("github"),
      app: asForgeApp("portal"),
      account: asForgeAccount(`account-${randomUUID()}`),
      accountKind: "Organization",
      installationId: asForgeInstallationId("156333284"),
      tenant: first.tenant,
      authority: {
        kind: asAuthorityKind("Member"),
        subject: asAuthoritySubject("alice"),
      },
    }),
    "Recorded",
  );
  await harness.query(
    `INSERT INTO invite_link(tenant,token_digest,role,projects,new_accounts,minted_by,expires_at)
     VALUES($1,$2,'Member','[]'::jsonb,false,'alice',now()+interval '1 day')`,
    [first.tenant, "a".repeat(64)],
  );
  await harness.query(
    `INSERT INTO invite_link(token_digest,create_accounts,new_accounts,minted_by,expires_at,used_by,used_at,workspace)
     VALUES($1,false,false,'site',now()+interval '1 day','alice',now(),$2)`,
    ["b".repeat(64), first.tenant],
  );
  const tenants = postgresTenantDeletion(apiPool);
  const projects = postgresProjectDeletion(apiPool);
  assert.deepEqual(await tenants.holds(first.tenant), ["Project"]);
  assert.deepEqual(await tenants.delete(first.tenant), {
    outcome: "Held",
    held: ["Project"],
  });
  assert.deepEqual(await projects.delete(first), { outcome: "Deleted" });
  assert.deepEqual(await tenants.holds(first.tenant), ["Project"]);
  assert.deepEqual(await projects.delete(second), { outcome: "Deleted" });
  assert.deepEqual(await tenants.holds(first.tenant), []);

  assert.deepEqual(await tenants.delete(first.tenant), { outcome: "Deleted" });
  assert.equal(await tenantRows(first.tenant), 0);
  for (const [relation, where] of [
    ["forge_installation", "tenant=$1"],
    ["invite_link", "tenant=$1 OR workspace=$1"],
  ] as const) {
    const found = await harness.query(
      `SELECT count(*)::int AS held FROM ${relation} WHERE ${where}`,
      [first.tenant],
    );
    assert.equal(Number(found[0]?.["held"]), 0, relation);
  }
  assert.deepEqual(await tenants.delete(first.tenant), { outcome: "Deleted" });
  assert.equal(await created(first, "Unclaimed", "bob"), "Created:true");
});

test("a tenant a member's runner is registered in is refused and named as holding it", async () => {
  const partition = freshPartition("runner");
  assert.equal(await created(partition, "Unclaimed"), "Created:true");
  assert.deepEqual(await postgresProjectDeletion(apiPool).delete(partition), {
    outcome: "Deleted",
  });
  await harness.query(
    `INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
     VALUES($1,'alice','{}',$2,$3)`,
    [partition.tenant, `principal-${randomUUID()}`, `client-${randomUUID()}`],
  );
  assert.deepEqual(
    await postgresTenantDeletion(apiPool).delete(partition.tenant),
    {
      outcome: "Held",
      held: ["PersonalRunner"],
    },
  );
  assert.equal(await tenantRows(partition.tenant), 1);
});

test("only the API executes the deletion doors", async () => {
  for (const role of [schedulerRole, ticketServiceRole])
    for (const call of [
      `SELECT * FROM ${projectDeleteFunction}('t','p')`,
      `SELECT * FROM ${tenantDeleteFunction}('t')`,
    ])
      assert.match(
        (await harness.attemptAs(role, call)) ?? "",
        postgresHarnessDenial(
          call.includes(projectDeleteFunction)
            ? projectDeleteFunction
            : tenantDeleteFunction,
        ),
        `${role}: ${call}`,
      );
});
