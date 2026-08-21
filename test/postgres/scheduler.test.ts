/**
 * Migration nine against a real server: that the durable execution scheduler's
 * relations apply, that its triggers refuse what they exist to refuse, and
 * that its functions decide what their names claim.
 *
 * THE FRESH DATABASE IS THE GATE'S OWN. `.chug/tasks/check-postgres.sh`
 * creates a database per run and drops it when the run ends, so every case
 * here already runs against a schema this run applied from nothing. What is
 * left to say is that re-applying adds nothing, which is a claim about the
 * ledger and is where the first case looks.
 *
 * THE REFUSALS ARE ATTEMPTED RATHER THAN LOOKED UP. A case that read a
 * catalogue row would prove the server had been told a rule, not that it
 * applies one — and every rule here exists because a scheduler that got past
 * it would settle work the ticket service alone may settle.
 *
 * EACH CASE GETS ITS OWN CLUSTER AND ACCOUNT, not just its own partition. What
 * a cluster and an account report is a fact about every project drawing on
 * them, so cases sharing one would be counting each other's registrations.
 */

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import {
  activeWorkFunction,
  accountIdentityFunction,
  backlogFunction,
  completionFunction,
  digestFoldFunction,
  migrations,
  schedulerRole,
  statusMoveFunction,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresMigrate,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";
import {
  allAttemptStates,
  allExecutionStatuses,
  allSchedulerIncidentKinds,
  executionAccountActiveCount,
  executionActiveCount,
  executionLegalMove,
  executionReservationDeficit,
  type CapacityExecution,
  type ExecutionStatus,
} from "../../src/interpreter/executionScheduler.ts";
import {
  allArtifactRoles,
  asArtifactDigest,
  resultDigestFold,
  resultManifestSchemaVersion,
} from "../../src/interpreter/resultManifest.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

/** The migration this suite is about, named once so the ledger case and the report agree. */
const schedulerMigrationVersion = 9;

/** How wide a case's own cluster is, which is capacity rather than semantics. */
const schedulerClusterSlots = 32;

/** What a case's own account reserves and may borrow up to. */
const schedulerAccountReserved = 12;
const schedulerAccountMaximum = 16;

/**
 * How many logical tasks a case's spawn request declares. The authoring
 * fixture's fanout is one, so the fixture widens the request the way a wider
 * fanout would have — a case about capacity needs several slots to fill.
 */
const schedulerTasksPerRequest = 10;

/** One case's registered project: the spawn request it draws work from, and the capacity it draws on. */
interface SchedulerFixture {
  readonly partition: Partition;
  readonly cluster: string;
  readonly request: string;
  readonly ticket: string;
  readonly effect: number;
  readonly tasks: readonly string[];
  readonly revision: string;
  readonly digest: string;
  readonly epoch: string;
}

/** The spawn request a released and dispatched ticket leaves, with the pins it carries. */
async function schedulerRequest(partition: Partition): Promise<{
  request: string;
  ticket: string;
  effect_position: number;
  configuration_revision: string;
  configuration_digest: string;
}> {
  const [found] = (await harness.query(
    `SELECT request, ticket, effect_position, configuration_revision, configuration_digest
       FROM execution_request
      WHERE tenant=$1 AND project=$2 AND kind='SpawnWork'`,
    [partition.tenant, partition.project],
  )) as readonly {
    request: string;
    ticket: string;
    effect_position: number;
    configuration_revision: string;
    configuration_digest: string;
  }[];
  if (found === undefined) {
    throw new Error("postgres scheduler: the dispatch left no spawn request");
  }
  return found;
}

/** The request's declared work, widened to the slots a capacity case needs to fill. */
async function schedulerTasks(
  partition: Partition,
  request: string,
): Promise<readonly string[]> {
  const partitioned = [partition.tenant, partition.project, request];
  const declared = (await harness.query(
    `SELECT task FROM execution_request_task
      WHERE tenant=$1 AND project=$2 AND request=$3 ORDER BY task`,
    partitioned,
  )) as readonly { task: string }[];
  for (let more = declared.length; more < schedulerTasksPerRequest; more++) {
    await harness.query(
      `INSERT INTO execution_request_task (tenant,project,request,task,kind)
       VALUES ($1,$2,$3,$4,'Work')`,
      [...partitioned, more + 1],
    );
  }
  return (
    (await harness.query(
      `SELECT task FROM execution_request_task
        WHERE tenant=$1 AND project=$2 AND request=$3 ORDER BY task`,
      partitioned,
    )) as readonly { task: string }[]
  ).map((row) => row.task);
}

/** A project with one dispatched ticket, a cluster of its own, and an account drawing on it. */
async function schedulerFixture(label: string): Promise<SchedulerFixture> {
  const partition = await postgresHarnessProject(harness.store, label);
  await postgresHarnessHistory(
    harness,
    partition,
    label,
    postgresHarnessJournal().length,
  );
  const request = await schedulerRequest(partition);
  const tasks = await schedulerTasks(partition, request.request);
  const cluster = `cluster-${label}-${randomUUID()}`;
  await harness.query(
    "INSERT INTO execution_cluster (cluster, slots_max, policy_revision) VALUES ($1,$2,1)",
    [cluster, schedulerClusterSlots],
  );
  const repointed = await harness.query(
    `UPDATE capacity_account SET cluster=$3, reserved=$4, maximum=$5
      WHERE account=${accountIdentityFunction}($1,$2) RETURNING account`,
    [
      partition.tenant,
      partition.project,
      cluster,
      schedulerAccountReserved,
      schedulerAccountMaximum,
    ],
  );
  if (repointed.length !== 1) {
    throw new Error(
      `postgres scheduler: provisioning ${partition.project} left it no capacity account to draw on`,
    );
  }
  return {
    partition,
    cluster,
    request: request.request,
    ticket: request.ticket,
    effect: request.effect_position,
    tasks,
    revision: request.configuration_revision,
    digest: request.configuration_digest,
    epoch: await harness.store.currentRecoveryEpoch(),
  };
}

/** Registers one logical task of the fixture's spawn request, at the position given. */
async function schedulerRegister(
  fixture: SchedulerFixture,
  label: string,
  at = 0,
): Promise<string> {
  const task = fixture.tasks[at];
  if (task === undefined) {
    throw new Error(
      `postgres scheduler: the spawn request has no task at ${String(at)}`,
    );
  }
  const execution = `execution-${label}-${randomUUID()}`;
  await harness.query(
    `INSERT INTO execution (tenant,project,execution,ticket,task,source_request,
       account,cluster,configuration_revision,configuration_digest)
     VALUES ($1,$2,$3,$4,$5,$6,${accountIdentityFunction}($1,$2),$7,$8,$9)`,
    [
      fixture.partition.tenant,
      fixture.partition.project,
      execution,
      fixture.ticket,
      task,
      fixture.request,
      fixture.cluster,
      fixture.revision,
      fixture.digest,
    ],
  );
  return execution;
}

/** Moves a registration through the statuses given, one legal move per statement. */
async function schedulerAdvance(
  fixture: SchedulerFixture,
  execution: string,
  ...statuses: readonly ExecutionStatus[]
): Promise<void> {
  for (const status of statuses) {
    await harness.query(
      "UPDATE execution SET status=$4 WHERE tenant=$1 AND project=$2 AND execution=$3",
      [fixture.partition.tenant, fixture.partition.project, execution, status],
    );
  }
}

/** Opens an attempt on a registration, taking the next attempt number the row hands out. */
async function schedulerAttempt(
  fixture: SchedulerFixture,
  execution: string,
  label: string,
  state = "Placing",
  generation = 1,
): Promise<string> {
  const attempt = `attempt-${label}-${randomUUID()}`;
  const [taken] = (await harness.query(
    `UPDATE execution SET attempt_next = attempt_next + 1
      WHERE tenant=$1 AND project=$2 AND execution=$3
      RETURNING attempt_next - 1 AS attempt_number`,
    [fixture.partition.tenant, fixture.partition.project, execution],
  )) as readonly { attempt_number: string }[];
  await harness.query(
    `INSERT INTO execution_attempt (tenant,project,execution,attempt,attempt_number,
       generation,recovery_epoch,state,ended_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
       CASE WHEN $8 IN ('Placing','Running') THEN NULL ELSE now() END)`,
    [
      fixture.partition.tenant,
      fixture.partition.project,
      execution,
      attempt,
      taken?.attempt_number,
      generation,
      fixture.epoch,
      state,
    ],
  );
  return attempt;
}

/** One recorded result: its identity, the digest it was verified under, and its project ordinal. */
interface SchedulerResult {
  readonly manifest: string;
  readonly digest: string;
  readonly ordinal: string;
}

/** Records a verified result for an attempt, taking the project's next manifest ordinal. */
async function schedulerResult(
  fixture: SchedulerFixture,
  execution: string,
  attempt: string,
  label: string,
  verdict = "Pass",
): Promise<SchedulerResult> {
  const manifest = `manifest-${label}-${randomUUID()}`;
  const digest = createHash("sha256").update(manifest).digest("hex");
  const [taken] = (await harness.query(
    `UPDATE project SET manifest_next = manifest_next + 1
      WHERE tenant=$1 AND project=$2 RETURNING manifest_next - 1 AS ordinal`,
    [fixture.partition.tenant, fixture.partition.project],
  )) as readonly { ordinal: string }[];
  await harness.query(
    `INSERT INTO execution_result (tenant,project,manifest,execution,attempt,
       manifest_ordinal,schema_version,digest,verdict)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      fixture.partition.tenant,
      fixture.partition.project,
      manifest,
      execution,
      attempt,
      taken?.ordinal,
      resultManifestSchemaVersion,
      digest,
      verdict,
    ],
  );
  return { manifest, digest, ordinal: taken?.ordinal ?? "" };
}

/** What the completion boundary answered, and the operation identity the caller offered it. */
interface SchedulerSubmission {
  readonly result: string;
  readonly operation: string | null;
  readonly ordinal: string | null;
  readonly offered: string;
}

/** Submits one completion, letting the caller name the binding it claims to hold. */
async function schedulerSubmit(
  fixture: SchedulerFixture,
  execution: string,
  label: string,
  claim: {
    ticket?: string;
    task?: string;
    effect?: number;
    outcome: string;
    manifest?: string | null;
    digest?: string | null;
    reason?: string | null;
  },
): Promise<SchedulerSubmission> {
  const offered = `completion-${label}-${randomUUID()}`;
  const [answered] = (await harness.query(
    `SELECT result, operation, ordinal
       FROM ${completionFunction}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      fixture.partition.tenant,
      fixture.partition.project,
      execution,
      claim.ticket ?? fixture.ticket,
      claim.task ?? fixture.tasks[0],
      claim.effect ?? fixture.effect,
      claim.outcome,
      claim.manifest ?? null,
      claim.digest ?? null,
      claim.reason ?? null,
      offered,
      `scheduler-${label}`,
    ],
  )) as readonly {
    result: string;
    operation: string | null;
    ordinal: string | null;
  }[];
  if (answered === undefined) {
    throw new Error(
      "postgres scheduler: the completion boundary answered nothing",
    );
  }
  return { ...answered, offered };
}

/** A registration carried to `Running` with a verified result waiting, which is what a completion needs. */
async function schedulerReported(
  fixture: SchedulerFixture,
  label: string,
  verdict = "Pass",
): Promise<{ execution: string; result: SchedulerResult }> {
  const execution = await schedulerRegister(fixture, label);
  await schedulerAdvance(
    fixture,
    execution,
    "Admitted",
    "Launching",
    "Running",
  );
  const attempt = await schedulerAttempt(fixture, execution, label);
  return {
    execution,
    result: await schedulerResult(fixture, execution, attempt, label, verdict),
  };
}

test("migration nine is recorded once and re-migrating this database applies nothing", async () => {
  const declared = migrations.find(
    (each) => each.version === schedulerMigrationVersion,
  );
  assert.ok(declared !== undefined);
  assert.deepEqual(
    await harness.query(
      "SELECT version, name FROM schema_migration WHERE version=$1",
      [schedulerMigrationVersion],
    ),
    [{ version: declared.version, name: declared.name }],
  );
  const again = postgresPool(postgresHarnessUrl());
  try {
    assert.deepEqual(await postgresMigrate(again), []);
  } finally {
    await again.end();
  }
  assert.deepEqual(
    await harness.query(
      "SELECT count(*)::text AS count FROM schema_migration WHERE version=$1",
      [schedulerMigrationVersion],
    ),
    [{ count: "1" }],
  );
});

test("every relation migration nine declares is present and reachable", async () => {
  const declared = [
    "capacity_account",
    "execution",
    "execution_attempt",
    "execution_cluster",
    "execution_result",
    "execution_result_artifact",
    "scheduler_incident",
  ];
  const present = (await harness.query(
    `SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1) ORDER BY table_name`,
    [declared],
  )) as readonly { relation: string }[];
  assert.deepEqual(
    present.map((row) => row.relation),
    declared,
  );
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname = ANY($1)`,
      [
        [
          completionFunction,
          activeWorkFunction,
          backlogFunction,
          statusMoveFunction,
          digestFoldFunction,
          "execution_moves_legally",
          "execution_attempt_is_fenced",
          "execution_result_is_immutable",
        ],
      ],
    ),
    [{ count: "8" }],
  );
});

test("one logical task is registered once, and one attempt reports at a time", async () => {
  const fixture = await schedulerFixture("registered-once");
  const execution = await schedulerRegister(fixture, "registered-once");
  await assert.rejects(
    schedulerRegister(fixture, "registered-twice"),
    /execution_names_one_logical_task/,
  );
  await schedulerAttempt(fixture, execution, "reporter");
  await assert.rejects(
    schedulerAttempt(fixture, execution, "usurper"),
    /execution_attempt_one_authoritative/,
  );
});

test("an execution cannot be registered for work the project never authorized", async () => {
  const fixture = await schedulerFixture("unauthorized");
  const registration = (task: string, request: string): Promise<unknown> =>
    harness.query(
      `INSERT INTO execution (tenant,project,execution,ticket,task,source_request,
         account,cluster,configuration_revision,configuration_digest)
       VALUES ($1,$2,$3,$4,$5,$6,${accountIdentityFunction}($1,$2),$7,$8,$9)`,
      [
        fixture.partition.tenant,
        fixture.partition.project,
        `execution-unauthorized-${randomUUID()}`,
        fixture.ticket,
        task,
        request,
        fixture.cluster,
        fixture.revision,
        fixture.digest,
      ],
    );
  await assert.rejects(
    registration("9001", fixture.request),
    /execution_has_its_authorized_task/,
  );
  await assert.rejects(
    registration(fixture.tasks[0] ?? "1", `request-absent-${randomUUID()}`),
    /execution_has_its_authorized_task/,
  );
});

test("a value outside the interpreter's vocabulary is refused by the roster that generated it", async () => {
  const fixture = await schedulerFixture("vocabulary");
  const execution = await schedulerRegister(fixture, "vocabulary");
  const attempt = await schedulerAttempt(fixture, execution, "vocabulary");
  const partition = [fixture.partition.tenant, fixture.partition.project];
  const rejected: readonly [string, readonly unknown[], RegExp][] = [
    [
      `INSERT INTO execution (tenant,project,execution,ticket,task,source_request,account,
         cluster,configuration_revision,configuration_digest,status)
       VALUES ($1,$2,$3,$4,$5,$6,${accountIdentityFunction}($1,$2),$7,$8,$9,'Paused')`,
      [
        ...partition,
        `execution-paused-${randomUUID()}`,
        fixture.ticket,
        fixture.tasks[1],
        fixture.request,
        fixture.cluster,
        fixture.revision,
        fixture.digest,
      ],
      /execution_status_is_known/,
    ],
    [
      `INSERT INTO execution_attempt (tenant,project,execution,attempt,attempt_number,
         recovery_epoch,state,ended_at)
       VALUES ($1,$2,$3,$4,99,$5,'Paused',now())`,
      [
        ...partition,
        execution,
        `attempt-paused-${randomUUID()}`,
        fixture.epoch,
      ],
      /execution_attempt_state_is_known/,
    ],
    [
      `INSERT INTO execution_result (tenant,project,manifest,execution,attempt,
         manifest_ordinal,schema_version,digest,verdict)
       VALUES ($1,$2,$3,$4,$5,9001,1,$6,'Maybe')`,
      [
        ...partition,
        `manifest-maybe-${randomUUID()}`,
        execution,
        attempt,
        createHash("sha256").update("maybe").digest("hex"),
      ],
      /execution_result_verdict_is_known/,
    ],
    [
      `INSERT INTO scheduler_incident (tenant,project,incident,kind,evidence)
       VALUES ($1,$2,$3,'SomethingHappened','evidence')`,
      [...partition, `incident-${randomUUID()}`],
      /scheduler_incident_kind_is_known/,
    ],
  ];
  for (const [statement, values, refusal] of rejected) {
    await assert.rejects(harness.query(statement, values), refusal);
  }
});

test("every attempt state, incident kind and artifact role the interpreter names is one the server stores", async () => {
  const fixture = await schedulerFixture("rosters");
  const execution = await schedulerRegister(fixture, "rosters");
  const attempt = await schedulerAttempt(fixture, execution, "rosters");
  const result = await schedulerResult(fixture, execution, attempt, "rosters");
  const spare = await schedulerRegister(fixture, "rosters-spare", 1);
  const partition = [fixture.partition.tenant, fixture.partition.project];
  const scratch = await harness.begin();
  try {
    for (const [at, state] of allAttemptStates.entries()) {
      await scratch.query(
        `INSERT INTO execution_attempt (tenant,project,execution,attempt,attempt_number,
           recovery_epoch,state,ended_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,
           CASE WHEN $7 IN ('Placing','Running') THEN NULL ELSE now() END)`,
        [
          ...partition,
          spare,
          `attempt-${state}-${randomUUID()}`,
          1000 + at,
          fixture.epoch,
          state,
        ],
      );
      await scratch.query(
        `DELETE FROM execution_attempt
          WHERE tenant=$1 AND project=$2 AND attempt_number=$3`,
        [...partition, 1000 + at],
      );
    }
    for (const kind of allSchedulerIncidentKinds) {
      await scratch.query(
        `INSERT INTO scheduler_incident (tenant,project,incident,kind,evidence)
         VALUES ($1,$2,$3,$4,'evidence')`,
        [...partition, `incident-${kind}-${randomUUID()}`, kind],
      );
    }
    for (const [at, role] of allArtifactRoles.entries()) {
      await scratch.query(
        `INSERT INTO execution_result_artifact (tenant,project,manifest,ordinal,role,path,digest,bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0)`,
        [
          ...partition,
          result.manifest,
          at + 1,
          role,
          `out/${role}.txt`,
          result.digest,
        ],
      );
    }
  } finally {
    await scratch.rollback();
  }
});

test("an artifact path that leaves the attempt's own namespace is refused", async () => {
  const fixture = await schedulerFixture("paths");
  const execution = await schedulerRegister(fixture, "paths");
  const attempt = await schedulerAttempt(fixture, execution, "paths");
  const result = await schedulerResult(fixture, execution, attempt, "paths");
  for (const path of [
    "/etc/passwd",
    "../escape.txt",
    "out/../../escape.txt",
    "out//doubled.txt",
    "out\\windows.txt",
    " leading.txt",
    "trailing.txt ",
  ]) {
    await assert.rejects(
      harness.query(
        `INSERT INTO execution_result_artifact (tenant,project,manifest,ordinal,role,path,digest,bytes)
         VALUES ($1,$2,$3,1,'Handoff',$4,$5,0)`,
        [
          fixture.partition.tenant,
          fixture.partition.project,
          result.manifest,
          path,
          result.digest,
        ],
      ),
      /execution_result_artifact_path_is_normalized/,
    );
  }
});

test("an illegal status move is refused and a settled execution is written once", async () => {
  const fixture = await schedulerFixture("moves");
  const execution = await schedulerRegister(fixture, "moves");
  await assert.rejects(
    schedulerAdvance(fixture, execution, "Running"),
    /may not move from Queued to Running/,
  );
  await schedulerAdvance(
    fixture,
    execution,
    "Admitted",
    "Launching",
    "Running",
  );
  await assert.rejects(
    schedulerAdvance(fixture, execution, "Queued"),
    /may not move from Running to Queued/,
  );
  const settled = await schedulerRegister(fixture, "settled", 1);
  await harness.query(
    `UPDATE execution SET status='Cancelled', terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [fixture.partition.tenant, fixture.partition.project, settled],
  );
  await assert.rejects(
    schedulerAdvance(fixture, settled, "Cancelled"),
    /is already Cancelled, and a settled execution is written once/,
  );
});

test("an execution cannot change a pin it was registered under or unspend a retry", async () => {
  const fixture = await schedulerFixture("pins");
  const execution = await schedulerRegister(fixture, "pins");
  const where = "WHERE tenant=$1 AND project=$2 AND execution=$3";
  const values = [
    fixture.partition.tenant,
    fixture.partition.project,
    execution,
  ];
  await assert.rejects(
    harness.query(
      `UPDATE execution SET configuration_digest='0'::text ${where}`,
      values,
    ),
    /would change an identity or a pin it was registered under/,
  );
  await assert.rejects(
    harness.query(`UPDATE execution SET account='another' ${where}`, values),
    /would change an identity or a pin it was registered under/,
  );
  await harness.query(
    `UPDATE execution SET retries_spent=retries_spent+1 ${where}`,
    values,
  );
  await assert.rejects(
    harness.query(`UPDATE execution SET retries_spent=0 ${where}`, values),
    /would reuse an attempt number or unspend a retry/,
  );
});

test("a settlement cannot disagree with the manifest the attempt reported", async () => {
  const fixture = await schedulerFixture("disagree");
  const reported = await schedulerReported(fixture, "disagree");
  const operation = `operation-disagree-${randomUUID()}`;
  await harness.query(
    `INSERT INTO operation (tenant,project,operation,authority_kind,authority_subject,
       admission,key_version,key_digest,payload_digest,command,command_tag)
     VALUES ($1,$2,$3,'ExecutionScheduler','subject','CorrectnessReducing','v1',$4,$5,'{}','TaskDone')`,
    [
      fixture.partition.tenant,
      fixture.partition.project,
      operation,
      `key-${operation}`,
      `payload-${operation}`,
    ],
  );
  await assert.rejects(
    harness.query(
      `UPDATE execution SET status='Terminal', outcome='Failed',
         result_manifest=$4, completion_operation=$5, terminal_at=now()
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [
        fixture.partition.tenant,
        fixture.partition.project,
        reported.execution,
        reported.result.manifest,
        operation,
      ],
    ),
    /settles Failed over a manifest that reported Pass/,
  );
});

test("an attempt cannot write after it is fenced, nor move its generation backwards", async () => {
  const fixture = await schedulerFixture("fenced");
  const execution = await schedulerRegister(fixture, "fenced");
  const attempt = await schedulerAttempt(
    fixture,
    execution,
    "fenced",
    "Placing",
    2,
  );
  const where =
    "WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt=$4";
  const values = [
    fixture.partition.tenant,
    fixture.partition.project,
    execution,
    attempt,
  ];
  await assert.rejects(
    harness.query(`UPDATE execution_attempt SET generation=1 ${where}`, values),
    /would move its generation backwards/,
  );
  await assert.rejects(
    harness.query(
      `UPDATE execution_attempt SET attempt_number=attempt_number+50 ${where}`,
      values,
    ),
    /would change the identity or epoch it was issued under/,
  );
  await harness.query(
    `UPDATE execution_attempt SET state='Running' ${where}`,
    values,
  );
  await assert.rejects(
    harness.query(
      `UPDATE execution_attempt SET state='Placing' ${where}`,
      values,
    ),
    /would return to placement after running/,
  );
  await harness.query(
    `UPDATE execution_attempt SET state='Reported', ended_at=now() ${where}`,
    values,
  );
  await assert.rejects(
    harness.query(
      `UPDATE execution_attempt SET lease_owner=NULL, lease_expires_at=NULL ${where}`,
      values,
    ),
    /is already Reported, and a finished attempt is written once/,
  );
});

test("a fenced attempt's manifest is refused, and the attempt beside it is not", async () => {
  const fixture = await schedulerFixture("unfenced");
  const execution = await schedulerRegister(fixture, "unfenced");
  const superseded = await schedulerAttempt(
    fixture,
    execution,
    "unfenced-old",
    "Superseded",
  );
  await assert.rejects(
    schedulerResult(fixture, execution, superseded, "unfenced-old"),
    /was fenced, and a fenced reporter's manifest is not evidence/,
  );
  const current = await schedulerAttempt(fixture, execution, "unfenced-new");
  await schedulerResult(fixture, execution, current, "unfenced-new");
  assert.deepEqual(
    await harness.query(
      "SELECT attempt FROM execution_result WHERE tenant=$1 AND project=$2",
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [{ attempt: current }],
  );
});

test("a result manifest and its artifacts are written once", async () => {
  const fixture = await schedulerFixture("immutable");
  const reported = await schedulerReported(fixture, "immutable");
  const partition = [fixture.partition.tenant, fixture.partition.project];
  await harness.query(
    `INSERT INTO execution_result_artifact (tenant,project,manifest,ordinal,role,path,digest,bytes)
     VALUES ($1,$2,$3,1,'Handoff','out/report.json',$4,7)`,
    [...partition, reported.result.manifest, reported.result.digest],
  );
  const written: readonly string[] = [
    "UPDATE execution_result SET verdict='Fail'",
    "DELETE FROM execution_result",
    "UPDATE execution_result_artifact SET bytes=0",
    "DELETE FROM execution_result_artifact",
  ];
  for (const statement of written) {
    await assert.rejects(
      harness.query(`${statement} WHERE tenant=$1 AND project=$2`, partition),
      /is written once, and a manifest that could be edited is not evidence/,
    );
  }
});

test("the server's move table answers exactly as the interpreter's", async () => {
  const moves = allExecutionStatuses.flatMap((before) =>
    allExecutionStatuses.map((after) => ({ before, after })),
  );
  const answered = (await harness.query(
    `SELECT m.before, m.after, ${statusMoveFunction}(m.before, m.after) AS legal
       FROM unnest($1::text[], $2::text[]) AS m(before, after)`,
    [moves.map((each) => each.before), moves.map((each) => each.after)],
  )) as readonly { before: string; after: string; legal: boolean }[];
  assert.deepEqual(
    answered,
    moves.map((each) => ({
      before: each.before,
      after: each.after,
      legal: executionLegalMove(each.before, each.after),
    })),
  );
});

test("the server folds a manifest digest exactly as the interpreter does", async () => {
  const digests = [
    "0".repeat(64),
    "f".repeat(64),
    createHash("sha256").update("fold").digest("hex"),
    createHash("sha256").update("fold-again").digest("hex"),
  ];
  const folded = (await harness.query(
    `SELECT ${digestFoldFunction}(d) AS folded FROM unnest($1::text[]) AS d`,
    [digests],
  )) as readonly { folded: string }[];
  assert.deepEqual(
    folded.map((row) => row.folded),
    digests.map((digest) => String(resultDigestFold(asArtifactDigest(digest)))),
  );
});

/**
 * How many registrations each status holds while active work is counted. They
 * differ from each other on purpose: equal counts would agree with a function
 * that reported one status under another's name.
 */
const schedulerActiveHeld: readonly (readonly [ExecutionStatus, number])[] = [
  ["Queued", 1],
  ["Admitted", 2],
  ["Launching", 3],
  ["Running", 4],
];

/** Registers the counts above, each carried to its status, and says what was registered. */
async function schedulerHeld(
  fixture: SchedulerFixture,
): Promise<readonly CapacityExecution[]> {
  const path: readonly ExecutionStatus[] = ["Admitted", "Launching", "Running"];
  const registered: CapacityExecution[] = [];
  for (const [status, many] of schedulerActiveHeld) {
    for (let each = 0; each < many; each++) {
      const at = registered.length;
      const execution = await schedulerRegister(
        fixture,
        `active-${status}-${String(each)}`,
        at,
      );
      await schedulerAdvance(
        fixture,
        execution,
        ...path.slice(0, path.indexOf(status) + 1),
      );
      registered.push({
        project: fixture.partition.project,
        ticket: 1,
        task: at + 1,
        account: fixture.partition.project,
        sourceSeq: 1,
        sourceEffect: 0,
        status,
      });
    }
  }
  return registered;
}

test("active work counts the slots the model counts", async () => {
  const fixture = await schedulerFixture("active");
  const registrations = await schedulerHeld(fixture);
  const account = fixture.partition.project;
  const entitlements = new Map([
    [
      account,
      { reserved: schedulerAccountReserved, maximum: schedulerAccountMaximum },
    ],
  ]);
  assert.deepEqual(
    await harness.query(
      `SELECT queued::text, admitted::text, launching::text, running::text,
              cluster_slots_max::text, cluster_active::text, account_maximum::text,
              account_active::text, account_deficit::text
         FROM ${activeWorkFunction}($1,$2)`,
      [fixture.partition.tenant, account],
    ),
    [
      {
        queued: "1",
        admitted: "2",
        launching: "3",
        running: "4",
        cluster_slots_max: String(schedulerClusterSlots),
        cluster_active: String(executionActiveCount(registrations)),
        account_maximum: String(schedulerAccountMaximum),
        account_active: String(
          executionAccountActiveCount(registrations, account),
        ),
        account_deficit: String(
          executionReservationDeficit(entitlements, registrations, account),
        ),
      },
    ],
  );
});

test("the backlog counts live work and the spawn tasks nobody has registered", async () => {
  const fixture = await schedulerFixture("backlog");
  const before = await schedulerBacklog(fixture);
  assert.equal(before.project_backlog, String(fixture.tasks.length));
  const execution = await schedulerRegister(fixture, "backlog");
  const registered = await schedulerBacklog(fixture);
  assert.equal(
    Number(registered.project_backlog) - Number(before.project_backlog),
    1,
  );
  assert.equal(
    Number(registered.installation_backlog) -
      Number(before.installation_backlog),
    1,
  );
  await harness.query(
    `UPDATE execution SET status='Cancelled', terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [fixture.partition.tenant, fixture.partition.project, execution],
  );
  assert.deepEqual(await schedulerBacklog(fixture), before);
});

/** What the backlog guard reports for one project, and for the installation behind it. */
async function schedulerBacklog(
  fixture: SchedulerFixture,
): Promise<{ project_backlog: string; installation_backlog: string }> {
  const [answered] = (await harness.query(
    `SELECT project_backlog::text, installation_backlog::text
       FROM ${backlogFunction}($1,$2)`,
    [fixture.partition.tenant, fixture.partition.project],
  )) as readonly { project_backlog: string; installation_backlog: string }[];
  if (answered === undefined) {
    throw new Error("postgres scheduler: the backlog guard answered nothing");
  }
  return answered;
}

test("a verified result becomes exactly one completion input the ticket service will decide", async () => {
  const fixture = await schedulerFixture("completion");
  const reported = await schedulerReported(fixture, "completion");
  const submitted = await schedulerSubmit(
    fixture,
    reported.execution,
    "completion",
    {
      outcome: "Passed",
      manifest: reported.result.manifest,
      digest: reported.result.digest,
    },
  );
  assert.equal(submitted.result, "Submitted");
  assert.equal(submitted.operation, submitted.offered);
  assert.deepEqual(
    await harness.query(
      `SELECT o.authority_kind, o.admission, o.command_tag, d.base_priority, d.state,
              d.ordinal::text, r.ready
         FROM operation o
         JOIN decision_input d ON d.tenant=o.tenant AND d.project=o.project
          AND d.input_kind='Operation' AND d.input_id=o.operation
         JOIN project_readiness r ON r.tenant=o.tenant AND r.project=o.project
        WHERE o.tenant=$1 AND o.project=$2 AND o.operation=$3`,
      [fixture.partition.tenant, fixture.partition.project, submitted.offered],
    ),
    [
      {
        authority_kind: "ExecutionScheduler",
        admission: "CorrectnessReducing",
        command_tag: "TaskDone",
        base_priority: "Completion",
        state: "Pending",
        ordinal: submitted.ordinal,
        ready: true,
      },
    ],
  );
  assert.deepEqual(
    await harness.query(
      `SELECT status, outcome, result_manifest, completion_operation
         FROM execution WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [fixture.partition.tenant, fixture.partition.project, reported.execution],
    ),
    [
      {
        status: "Terminal",
        outcome: "Passed",
        result_manifest: reported.result.manifest,
        completion_operation: submitted.offered,
      },
    ],
  );
});

test("the completion command carries the manifest ordinal, folded digest and verdict", async () => {
  const fixture = await schedulerFixture("envelope");
  const reported = await schedulerReported(fixture, "envelope", "Fail");
  const submitted = await schedulerSubmit(
    fixture,
    reported.execution,
    "envelope",
    {
      outcome: "Failed",
      manifest: reported.result.manifest,
      digest: reported.result.digest,
    },
  );
  assert.equal(submitted.result, "Submitted");
  assert.deepEqual(
    await harness.query(
      "SELECT command::jsonb AS command FROM operation WHERE operation=$1",
      [submitted.offered],
    ),
    [
      {
        command: {
          version: 1,
          command: "Decide",
          event: {
            type: "TaskDone",
            value: {
              ticket: Number(fixture.ticket),
              tid: Number(fixture.tasks[0]),
              verdict: "Fail",
              result: {
                manifest: Number(reported.result.ordinal),
                digest: resultDigestFold(
                  asArtifactDigest(reported.result.digest),
                ),
                schema: resultManifestSchemaVersion,
              },
            },
          },
        },
      },
    ],
  );
});

test("an identical redelivery is absorbed and a contradictory result preserves the first outcome", async () => {
  const fixture = await schedulerFixture("absorbed");
  const reported = await schedulerReported(fixture, "absorbed");
  const claim = {
    outcome: "Passed",
    manifest: reported.result.manifest,
    digest: reported.result.digest,
  };
  const first = await schedulerSubmit(
    fixture,
    reported.execution,
    "first",
    claim,
  );
  const again = await schedulerSubmit(
    fixture,
    reported.execution,
    "again",
    claim,
  );
  assert.deepEqual(
    {
      result: again.result,
      operation: again.operation,
      ordinal: again.ordinal,
    },
    {
      result: "AlreadySubmitted",
      operation: first.offered,
      ordinal: first.ordinal,
    },
  );
  const contradiction = await schedulerSubmit(
    fixture,
    reported.execution,
    "contradiction",
    { outcome: "Blocked", reason: "ExecutionPolicyDenied" },
  );
  assert.equal(contradiction.result, "AlreadySubmitted");
  assert.equal(contradiction.operation, first.offered);
  assert.deepEqual(
    await harness.query(
      `SELECT outcome, blocked_reason, completion_operation FROM execution
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [fixture.partition.tenant, fixture.partition.project, reported.execution],
    ),
    [
      {
        outcome: "Passed",
        blocked_reason: null,
        completion_operation: first.offered,
      },
    ],
  );
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM decision_input
        WHERE tenant=$1 AND project=$2 AND base_priority='Completion'`,
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [{ count: "1" }],
  );
});

test("a completion whose binding does not hold submits nothing", async () => {
  const fixture = await schedulerFixture("binding");
  const reported = await schedulerReported(fixture, "binding");
  const held = {
    outcome: "Passed",
    manifest: reported.result.manifest,
    digest: reported.result.digest,
  };
  const broken = [
    { ...held, ticket: "9001" },
    { ...held, task: "9001" },
    { ...held, effect: fixture.effect + 1 },
    { ...held, digest: "0".repeat(64) },
    { ...held, outcome: "Failed" },
    {
      ...held,
      outcome: "Blocked",
      manifest: null,
      digest: null,
      reason: "NoReason",
    },
  ];
  for (const claim of broken) {
    const answered = await schedulerSubmit(
      fixture,
      reported.execution,
      "binding",
      claim,
    );
    assert.equal(answered.result, "BindingMismatch");
  }
  assert.deepEqual(
    await harness.query(
      `SELECT status, completion_operation FROM execution
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [fixture.partition.tenant, fixture.partition.project, reported.execution],
    ),
    [{ status: "Running", completion_operation: null }],
  );
  const unknown = await schedulerSubmit(
    fixture,
    `execution-absent-${randomUUID()}`,
    "absent",
    held,
  );
  assert.equal(unknown.result, "UnknownExecution");
});

test("an outcome this boundary does not submit is refused before anything is written", async () => {
  const fixture = await schedulerFixture("outcome");
  const reported = await schedulerReported(fixture, "outcome");
  await assert.rejects(
    schedulerSubmit(fixture, reported.execution, "outcome", {
      outcome: "Retried",
      manifest: reported.result.manifest,
      digest: reported.result.digest,
    }),
    /completion outcome Retried is not one this boundary submits/,
  );
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM decision_input
        WHERE tenant=$1 AND project=$2 AND base_priority='Completion'`,
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [{ count: "0" }],
  );
});

test("a definitive inability completes as a blocked execution with a bounded reason", async () => {
  const fixture = await schedulerFixture("blocked");
  const execution = await schedulerRegister(fixture, "blocked");
  await schedulerAdvance(fixture, execution, "Admitted");
  const submitted = await schedulerSubmit(fixture, execution, "blocked", {
    outcome: "Blocked",
    reason: "TicketConfigIncompatible",
  });
  assert.equal(submitted.result, "Submitted");
  assert.deepEqual(
    await harness.query(
      `SELECT e.status, e.outcome, e.blocked_reason, e.result_manifest,
              o.command_tag, o.command::jsonb->'event'->'value'->>'reason' AS reason
         FROM execution e JOIN operation o
           ON o.tenant=e.tenant AND o.project=e.project AND o.operation=e.completion_operation
        WHERE e.tenant=$1 AND e.project=$2 AND e.execution=$3`,
      [fixture.partition.tenant, fixture.partition.project, execution],
    ),
    [
      {
        status: "Terminal",
        outcome: "Blocked",
        blocked_reason: "TicketConfigIncompatible",
        result_manifest: null,
        command_tag: "ExecutionBlocked",
        reason: "TicketConfigIncompatible",
      },
    ],
  );
});

test("a project in retention admits no completion", async () => {
  const fixture = await schedulerFixture("retention");
  const reported = await schedulerReported(fixture, "retention");
  await harness.query(
    "UPDATE project SET lifecycle='Retention' WHERE tenant=$1 AND project=$2",
    [fixture.partition.tenant, fixture.partition.project],
  );
  const answered = await schedulerSubmit(
    fixture,
    reported.execution,
    "retention",
    {
      outcome: "Passed",
      manifest: reported.result.manifest,
      digest: reported.result.digest,
    },
  );
  assert.equal(answered.result, "NotAdmitted");
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM decision_input
        WHERE tenant=$1 AND project=$2 AND base_priority='Completion'`,
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [{ count: "0" }],
  );
});

test("the scheduler's own credential drives a registration and still meets the trigger", async () => {
  const fixture = await schedulerFixture("credential");
  const execution = await schedulerRegister(fixture, "credential");
  const where = `WHERE tenant='${fixture.partition.tenant}'
      AND project='${fixture.partition.project}' AND execution='${execution}'`;
  assert.equal(
    await harness.attemptAs(
      schedulerRole,
      `UPDATE execution SET status='Admitted' ${where}`,
    ),
    undefined,
  );
  assert.match(
    (await harness.attemptAs(
      schedulerRole,
      `UPDATE execution SET status='Running' ${where}`,
    )) ?? "",
    /may not move from Queued to Running/,
  );
  assert.equal(
    await harness.attemptAs(
      schedulerRole,
      `INSERT INTO execution_attempt (tenant,project,execution,attempt,attempt_number,
         recovery_epoch)
       VALUES ('${fixture.partition.tenant}','${fixture.partition.project}',
         '${execution}','attempt-credential-${randomUUID()}',1,'${fixture.epoch}')`,
    ),
    undefined,
  );
});

test("the scheduler submits a completion through the boundary and settles nothing by hand", async () => {
  const fixture = await schedulerFixture("boundary");
  const reported = await schedulerReported(fixture, "boundary");
  assert.equal(
    await harness.attemptAs(
      schedulerRole,
      `SELECT * FROM ${completionFunction}(
        '${fixture.partition.tenant}','${fixture.partition.project}',
        '${reported.execution}',${fixture.ticket},${fixture.tasks[0] ?? "1"},
        ${String(fixture.effect)},'Passed','${reported.result.manifest}',
        '${reported.result.digest}',NULL,'completion-boundary-${randomUUID()}',
        'scheduler-boundary')`,
    ),
    undefined,
  );
  assert.match(
    (await harness.attemptAs(
      schedulerRole,
      `UPDATE execution SET outcome='Passed'
        WHERE tenant='${fixture.partition.tenant}'
          AND project='${fixture.partition.project}'
          AND execution='${reported.execution}'`,
    )) ?? "",
    /permission denied/,
  );
});
