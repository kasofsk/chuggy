/**
 * What the migration suites open a database with and seed one from: a database
 * at a version of the schema, cloned from a template migrated there once per
 * process and dropped as the process ends, and the rows and fixtures the cases
 * of more than one migration are written against.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after } from "node:test";
import {
  apiRole,
  boundaryOwnerRole,
  migrations,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresMigrate,
  postgresMigrateCompatible,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";
import {
  postgresRuntimeSchema,
  runtimeSchemaContract,
} from "../../src/adapters/postgres/runtimeSchema.ts";
import { postgresHarnessUrl } from "./harness.ts";
import type pg from "pg";

function databaseUrl(database: string): string {
  const url = new URL(postgresHarnessUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

export async function migrationDatabase(
  label: string,
  body: (subject: pg.Pool, url: string) => Promise<void>,
  template?: string,
): Promise<void> {
  const database = `chuggy_${label}_${randomUUID().replaceAll("-", "")}`;
  const admin = postgresPool(postgresHarnessUrl());
  await admin.query(
    template === undefined
      ? `CREATE DATABASE ${database}`
      : `CREATE DATABASE ${database} TEMPLATE ${template}`,
  );
  const url = databaseUrl(database);
  const subject = postgresPool(url);
  try {
    await body(subject, url);
  } finally {
    await subject.end();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
}

/** The state a database a test opens on was migrated to: the whole schema, or through one version. */
type MigrationStart = "Migrated" | number;

/** Each start's template database, built once by migrating an empty one there. */
const migrationTemplates = new Map<MigrationStart, Promise<string>>();

function migrationTemplate(start: MigrationStart): Promise<string> {
  const held = migrationTemplates.get(start);
  if (held !== undefined) return held;
  const template = (async () => {
    const database = `chuggy_template_${randomUUID().replaceAll("-", "")}`;
    const admin = postgresPool(postgresHarnessUrl());
    await admin.query(`CREATE DATABASE ${database}`);
    await admin.end();
    const subject = postgresPool(databaseUrl(database));
    try {
      if (start === "Migrated") await postgresMigrate(subject);
      else await installationAt(subject, start);
    } finally {
      await subject.end();
    }
    return database;
  })();
  migrationTemplates.set(start, template);
  return template;
}

after(async () => {
  const admin = postgresPool(postgresHarnessUrl());
  try {
    for (const template of migrationTemplates.values())
      await admin.query(
        `DROP DATABASE IF EXISTS ${await template} WITH (FORCE)`,
      );
  } finally {
    await admin.end();
  }
});

/** A database opened on `start`, cloned from its template rather than migrated again. */
export async function migrationDatabaseAt(
  start: MigrationStart,
  label: string,
  body: (subject: pg.Pool, url: string) => Promise<void>,
): Promise<void> {
  const template = await migrationTemplate(start);
  await migrationDatabase(label, body, template);
}

export async function migrationHasFunction(
  subject: pg.Pool,
  signature: string,
): Promise<boolean> {
  const found = await subject.query<{ present: boolean }>(
    `SELECT to_regprocedure($1) IS NOT NULL AS present`,
    [signature],
  );
  return found.rows[0]?.present === true;
}

/** A tenant's row where the schema has the relation, so a seed stands on either side of 026. */
export function tenantSeed(tenant: string): string {
  return `DO $seed$ BEGIN
    IF to_regclass('public.tenant') IS NOT NULL THEN
      INSERT INTO tenant(tenant) VALUES('${tenant}') ON CONFLICT DO NOTHING;
    END IF; END $seed$;`;
}

export async function seedLandinglessBinding(subject: pg.Pool): Promise<void> {
  await subject.query(`INSERT INTO recovery_epoch(epoch) VALUES('epoch-90')`);
  await subject.query(tenantSeed("tenant-90"));
  await subject.query(
    `INSERT INTO project(tenant,project,lifecycle,head,ingress_next)
     VALUES('tenant-90','project-90','Active',0,1)`,
  );
  await subject.query(
    `INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
     VALUES('tenant-90','project-90','bound-90','epoch-90')`,
  );
}

export async function assertDoorsStandOwned(
  subject: pg.Pool,
  signatures: readonly string[],
): Promise<void> {
  for (const signature of signatures) {
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
          [apiRole, signature],
        )
      ).rows[0]?.granted,
      true,
      signature,
    );
    assert.equal(
      (
        await subject.query<{ owner: string }>(
          `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc
            WHERE oid = $1::regprocedure`,
          [signature],
        )
      ).rows[0]?.owner,
      boundaryOwnerRole,
      signature,
    );
  }
}

/** Brings the subject to the schema a named migration left, and no further. */
export async function installationAt(
  subject: pg.Pool,
  migration: number,
  what = `the schema migration ${String(migration)} left`,
): Promise<void> {
  const through = migrations
    .filter(({ version }) => version <= migration)
    .map(({ version, name }) => ({ version, name }));
  const held = runtimeSchemaContract(through);
  assert.equal(
    (
      await postgresMigrateCompatible(subject, {
        current: held,
        retainedPrevious: held,
      })
    ).migrated,
    "Applied",
    what,
  );
  assert.deepEqual(
    await postgresRuntimeSchema(subject).applied(new AbortController().signal),
    through,
    what,
  );
}

/** Brings the subject to the schema the migration under test is about to change. */
export async function installationBefore(
  subject: pg.Pool,
  migration: number,
): Promise<void> {
  await installationAt(subject, migration - 1);
}

/** What every seeded row hangs from: a project and an epoch. */
export const deletionPartition = `
  ${tenantSeed("tenant-5")}
  INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-5','project-5','Active');
  INSERT INTO recovery_epoch(epoch) VALUES('epoch-5');`;

export function deletionJournalRow(seq: number, entry: string): string {
  const ordinal = String(seq);
  return `INSERT INTO decision_input
       (tenant,project,ordinal,input_kind,input_id,base_priority,
        lifecycle_generation,state,decided_seq,terminal_at)
     VALUES('tenant-5','project-5',${ordinal},'Operation','operation-${ordinal}','Ordinary',
            1,'Journaled',${ordinal},now());
     INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id)
     VALUES('tenant-5','project-5',${ordinal},$entry$${entry}$entry$,
            'digest-${ordinal}','genesis','owner',1,'epoch-5','Operation','operation-${ordinal}')`;
}

/**
 * A row every journal admits, 014's included, where a case needs an entry to
 * hang a row from and not what the entry says.
 */
export const journalledRevocation = JSON.stringify({
  seq: 1,
  event: { type: "TicketRevoked", value: 1 },
});

/** A claimed finalization request, and the attempt a case gives an outcome to. */
export function renamedFinalization(attempt: string): string {
  return `${deletionJournalRow(1, journalledRevocation)};
  UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
  INSERT INTO configuration_revision
    (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
  VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
  INSERT INTO input_bundle(tenant,project,bundle,digest)
  VALUES('tenant-5','project-5','bundle-5',repeat('b',64));
  INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
  VALUES('tenant-5','project-5','repository-5','epoch-5');
  INSERT INTO finalization_request
    (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
     request_generation,state,claim_owner,claim_generation,claim_expires_at,
     recovery_epoch,kind,work_cycle,finalization_generation)
  VALUES('tenant-5','project-5','request-5',1,0,1,1,1,'Open','owner',1,now(),
         'epoch-5','RunFinalizer',1,1);
  INSERT INTO finalization_attempt
    (tenant,project,attempt,request,ticket,repository,input_bundle,input_bundle_digest,
     target_ref,target_commit,strategy,configuration_revision,configuration_digest,
     attempt_digest,approval_required,outcome,candidate_commit,failure_kind)
  VALUES('tenant-5','project-5','attempt-5','request-5',1,'repository-5','bundle-5',
         repeat('b',64),'refs/heads/main',repeat('c',40),'Merge','revision-5','digest-5',
         repeat('d',64),${attempt})`;
}

/** The attempts a finalization door binds to: one that failed to prepare, and one prepared and awaiting approval. */
export const renamedAttemptFailed = "false,'Failed',NULL,'PreparationFailed'";
export const renamedAttemptPrepared = "true,'Prepared',repeat('c',40),NULL";

/**
 * A running execution at an identity its request authorized, ready for the
 * scheduler's door, carrying the verdict a worker attested — or, at `null`, no
 * result at all, which is every execution the door is asked to block.
 */
export function identityExecution(
  ordinal: number,
  requestKind: string,
  columns: string,
  values: string,
  verdict: "Pass" | "Fail" | null = "Pass",
  digest: string = "repeat('d',64)",
  ticket: number = 1,
): string {
  const at = String(ordinal);
  const on = String(ticket);
  return `
  INSERT INTO execution_request
    (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
     kind,capacity_account,configuration_revision,configuration_digest,
     input_bundle,input_bundle_digest)
  SELECT 'tenant-5','project-5','request-${at}',1,${at},${on},1,'${requestKind}',a.account,
         'revision-5','digest-5','bundle-5',repeat('b',64)
    FROM capacity_account a
   WHERE a.account=project_capacity_account('tenant-5','project-5');
  INSERT INTO execution_request_task(tenant,project,request,task,${columns})
  VALUES('tenant-5','project-5','request-${at}',${at},${values});
  INSERT INTO execution
    (tenant,project,execution,ticket,task,source_request,account,cluster,
     configuration_revision,configuration_digest,status)
  SELECT 'tenant-5','project-5','execution-${at}',${on},${at},'request-${at}',a.account,a.cluster,
         'revision-5','digest-5','Running'
    FROM capacity_account a
   WHERE a.account=project_capacity_account('tenant-5','project-5');
  INSERT INTO execution_attempt
    (tenant,project,execution,attempt,attempt_number,recovery_epoch,
     capability,capability_secret_digest,manifest)
  VALUES('tenant-5','project-5','execution-${at}','attempt-${at}',1,'epoch-5',
         'capability-${at}',repeat('c',64),'manifest-${at}');${
           verdict === null
             ? ""
             : `
  INSERT INTO execution_result
    (tenant,project,manifest,execution,attempt,manifest_ordinal,schema_version,digest,verdict)
  VALUES('tenant-5','project-5','manifest-${at}','execution-${at}','attempt-${at}',
         ${at},1,${digest},'${verdict}')`
         }`;
}

/** The four references a task definition is, as a release carries one. */
export const releasedWorkDefinition = {
  workload: 1,
  inputs: 2,
  executionRequirements: 3,
  resultContract: 4,
};

/** The definition the stage's evaluators carry, one each, so a read of one can miss. */
export const releasedEvaluatorDefinition = {
  workload: 5,
  inputs: 6,
  executionRequirements: 7,
  resultContract: 8,
};

export const releasedSecondDefinition = {
  workload: 9,
  inputs: 10,
  executionRequirements: 11,
  resultContract: 12,
};

/** The released ticket a case varies one field of. */
export const releasedWhole = {
  id: 1,
  content: 13,
  dependencies: [2, 3],
  workConfiguration: releasedWorkDefinition,
  evaluationPlan: {
    stages: [
      {
        key: 1,
        evaluators: [
          { key: 1, task: releasedEvaluatorDefinition },
          { key: 3, task: releasedSecondDefinition },
        ],
      },
    ],
  },
  finalizationConfiguration: 14,
};

/** The task a produced report is the obligation of. */
export const releasedTask = {
  type: "WorkTask",
  value: { ticket: 1, cycle: 3 },
};

/** The release the door reads back the definition it reports, as the writer journals one. */
export const releasedEntry = JSON.stringify({
  seq: 1,
  event: ticketCreated(releasedWhole),
});

/** What a case hangs the door off: the release, the revision and the bundle a request pins. */
export async function releasedSeeded(subject: pg.Pool): Promise<void> {
  await subject.query(
    `${deletionPartition}\n${deletionJournalRow(1, releasedEntry)};
     UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
     INSERT INTO configuration_revision
       (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
     VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
     INSERT INTO input_bundle(tenant,project,bundle,digest)
     VALUES('tenant-5','project-5','bundle-5',repeat('b',64))`,
  );
}

/** A release as the journal records one, which is the released ticket under the event's tag. */
export function ticketCreated(value: unknown): unknown {
  return { type: "TicketCreated", value };
}

/** A refusal the machine decided, in the codec's spelling. */
export function commandsRefusal(type: string, value: unknown): string {
  return JSON.stringify({ type, value });
}

/** One payload each machine refusal is admitted with. */
export const commandsRefusals: readonly (readonly [string, unknown])[] = [
  ["TicketAlreadyExists", 1],
  ["DependenciesNotFound", { ticket: 1, dependencies: [2, 3] }],
  ["SelfDependency", 1],
  ["TicketNotFound", 1],
  ["TicketNotPending", 1],
  ["TicketIdentityMismatch", 1],
  ["TicketRevisionStale", { ticket: 1, expected: 2, current: 3 }],
  ["TicketDependenciesChanged", 1],
  ["DependenciesIncomplete", { ticket: 1, dependencies: [2] }],
  ["TicketNotRevocable", 1],
  ["TicketNotResumable", 1],
  ["TaskNotCurrent", { ticket: 1, task: releasedTask }],
  ["FinalizationNotCurrent", { ticket: 1, workCycle: 2, generation: 1 }],
];

/** The boundary's own refusals, which carry none. */
export const commandsBoundaryRefusals = [
  "AuthoringChanged",
  "ConfigurationInvalid",
  "TicketChanged",
  "SelectionChanged",
  "ExecutionSourceUnreadable",
  "ExecutionSourceDenied",
  "BriefNamesNoRepository",
  "TicketCapacityReached",
  "FinalizationRequestClosed",
];

/** Writes one refused input, answering the error it was refused with, if any. */
export async function commandsRefuse(
  subject: pg.Pool,
  ordinal: number,
  code: string,
  refusal: string | null,
): Promise<string | null> {
  try {
    await subject.query(
      `INSERT INTO decision_input
         (tenant,project,ordinal,input_kind,input_id,base_priority,lifecycle_generation,
          state,outcome_code,refusal,refused_head,refused_lifecycle_generation,terminal_at)
       VALUES('tenant-5','project-5',$1,'Operation',$2,'Ordinary',1,
              'Refused',$3,$4,0,1,now())`,
      [ordinal, `input-${String(ordinal)}`, code, refusal],
    );
    return null;
  } catch (error: unknown) {
    return String(error);
  }
}
