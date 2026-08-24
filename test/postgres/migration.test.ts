import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  accountIdentityFunction,
  apiRole,
  boundaryOwnerRole,
  migrationLedger,
  migrations,
  schedulerRole,
  repositoryBindingReadFunction,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresMigrateCompatible,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
  runtimeSchemaContract,
} from "../../src/adapters/postgres/runtimeSchema.ts";
import { schemaCompatibilityPrecondition } from "../../src/interpreter/serviceRuntime.ts";
import { postgresHarnessUrl } from "./harness.ts";
import type pg from "pg";
import {
  encodeDecisionEventText,
  parseTicketCommand,
} from "../../src/interpreter/wire.ts";
import { postgresHarnessEntry } from "./harness.ts";

const retainedImageRequired = [
  { version: 1, name: "the project foundation" },
  { version: 2, name: "the project inbox" },
  { version: 3, name: "the project decision" },
  { version: 4, name: "the tenure fence" },
  { version: 5, name: "the durable prioritized decision mailbox" },
  { version: 6, name: "native web reads" },
  { version: 7, name: "native versioned authoring" },
  { version: 8, name: "bounded durable project notifications" },
  { version: 9, name: "selector-independent durable dispatch" },
  { version: 10, name: "hot-reloadable selector controls" },
  { version: 11, name: "durable selector attempts and permits" },
  { version: 12, name: "the durable execution scheduler" },
  { version: 13, name: "the durable finalizer" },
  { version: 14, name: "native project access" },
  { version: 15, name: "native operational reads" },
  { version: 16, name: "runtime schema readiness" },
  { version: 17, name: "selector context account read" },
] as const;
const publishingImageRequired = [
  ...retainedImageRequired,
  { version: 18, name: "selector review schema readiness" },
] as const;
const retainedImageContract = runtimeSchemaContract(publishingImageRequired, [
  ...publishingImageRequired,
  {
    version: 19,
    name: "the execution requirement a migrated database never got",
  },
  { version: 20, name: "repository configuration provenance" },
]);

const declaredLatest = Math.max(...migrations.map(({ version }) => version));

function databaseUrl(database: string): string {
  const url = new URL(postgresHarnessUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

/** One empty database of its own, dropped whatever the body did with it. */
async function migrationDatabase(
  label: string,
  body: (subject: pg.Pool, url: string) => Promise<void>,
): Promise<void> {
  const database = `chuggy_${label}_${randomUUID().replaceAll("-", "")}`;
  const admin = postgresPool(postgresHarnessUrl());
  await admin.query(`CREATE DATABASE ${database}`);
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

/** Applies the declared migrations below `beyond` and records each in the ledger. */
async function migrationSeedApplied(
  subject: pg.Pool,
  beyond: number,
): Promise<void> {
  await subject.query(migrationLedger);
  for (const migration of migrations.filter(
    ({ version }) => version < beyond,
  )) {
    for (const statement of migration.statements)
      await subject.query(statement);
    await subject.query(
      "INSERT INTO schema_migration (version,name) VALUES ($1,$2)",
      [migration.version, migration.name],
    );
  }
}

/** Runs the migration command against one database and returns what it reported. */
async function migrationCommandRun(
  url: string,
): Promise<{ readonly code: number; readonly report: string }> {
  const run = promisify(execFile)(
    process.execPath,
    ["--experimental-strip-types", "src/roots/migrate.ts"],
    { cwd: process.cwd(), env: { CHUG_MIGRATE_DATABASE_URL: url } },
  );
  const settled = await run.catch((failure: unknown) => failure);
  const { stdout, stderr, code } = settled as {
    stdout: string;
    stderr: string;
    code?: number;
  };
  return { code: code ?? 0, report: `${stdout}${stderr}`.trim() };
}

async function seedI2(subject: pg.Pool): Promise<void> {
  await subject.query(`INSERT INTO recovery_epoch (epoch) VALUES ('epoch')`);
  await subject.query(
    `INSERT INTO project (tenant,project,lifecycle,head,ingress_next)
     VALUES ('tenant','project','Active',1,5)`,
  );
  const states = ["Pending", "Succeeded", "Refused", "Cancelled"] as const;
  for (const [index, state] of states.entries()) {
    const operation = state.toLowerCase();
    await subject.query(
      `INSERT INTO operation
       (tenant,project,operation,authority_kind,authority_subject,admission,
        key_version,key_digest,payload_digest,command,lifecycle_generation,state,
        settled_at,settled_authority_kind,settled_authority_subject,
        outcome_code,decided_seq,refused_head,refused_lifecycle_generation)
       VALUES ('tenant','project',$1,'User','subject','Ordinary','v1',$2,$3,
        '{"type":"Dispatch","value":1}',1,$4,
        CASE WHEN $4='Pending' THEN NULL ELSE now() END,
        CASE WHEN $4='Pending' THEN NULL ELSE 'ProjectWriter' END,
        CASE WHEN $4='Pending' THEN NULL ELSE 'owner' END,
        CASE WHEN $4='Refused' THEN 'NotEnabled' ELSE NULL END,
        CASE WHEN $4='Succeeded' THEN 1 ELSE NULL END,
        CASE WHEN $4='Refused' THEN 0 ELSE NULL END,
        CASE WHEN $4='Refused' THEN 1 ELSE NULL END)`,
      [operation, `key-${operation}`, `payload-${operation}`, state],
    );
    await subject.query(
      `INSERT INTO inbox_item (tenant,project,ordinal,operation,consumable)
       VALUES ('tenant','project',$1,$2,$3)`,
      [index + 1, operation, state === "Pending"],
    );
  }
  await subject.query(
    `INSERT INTO operation
     (tenant,project,operation,authority_kind,authority_subject,admission,
      key_version,key_digest,payload_digest,command,lifecycle_generation,state)
     VALUES ('tenant','project','opaque','User','subject','Ordinary',
       'v1','key-opaque','payload-opaque','not-json',1,'Pending')`,
  );
  await subject.query(
    `INSERT INTO inbox_item (tenant,project,ordinal,operation,consumable)
     VALUES ('tenant','project',5,'opaque',true)`,
  );
  await subject.query(
    `INSERT INTO operation
     (tenant,project,operation,authority_kind,authority_subject,admission,
      key_version,key_digest,payload_digest,command,lifecycle_generation,state)
     VALUES ('tenant','project','legacy-release','User','subject','Ordinary',
       'v1','key-release','payload-release',$1,1,'Pending')`,
    [encodeDecisionEventText(postgresHarnessEntry(0).event)],
  );
  await subject.query(
    `INSERT INTO inbox_item (tenant,project,ordinal,operation,consumable)
     VALUES ('tenant','project',6,'legacy-release',true)`,
  );
  await subject.query(
    `INSERT INTO journal_entry
     (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
      recovery_epoch,cause_operation)
     VALUES ('tenant','project',1,'{}','digest','genesis','owner',1,'epoch','succeeded')`,
  );
  await subject.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
     VALUES ('tenant','project',1,'Pending',1)`,
  );
}

async function assertDivergentMigrationRefused(
  subject: pg.Pool,
): Promise<void> {
  const divergentRetained = runtimeSchemaContract(
    retainedImageContract.required,
    [
      ...retainedImageContract.compatible.slice(0, -1),
      { version: declaredLatest, name: "unknown migration" },
    ],
  );
  assert.deepEqual(
    await postgresMigrateCompatible(subject, {
      current: currentRuntimeSchemaContract,
      retainedPrevious: divergentRetained,
    }),
    { migrated: "CouldNotRun" },
  );
  assert.deepEqual(
    (
      await subject.query<{ version: number }>(
        "SELECT version FROM schema_migration ORDER BY version DESC LIMIT 1",
      )
    ).rows,
    [{ version: declaredLatest - 1 }],
  );
}

async function assertMigratedI2(subject: pg.Pool): Promise<void> {
  assert.deepEqual(
    (
      await subject.query(
        `SELECT input_id,state,decided_seq FROM decision_input ORDER BY ordinal`,
      )
    ).rows,
    [
      { input_id: "pending", state: "Pending", decided_seq: null },
      { input_id: "succeeded", state: "Journaled", decided_seq: "1" },
      { input_id: "refused", state: "Refused", decided_seq: null },
      { input_id: "cancelled", state: "Cancelled", decided_seq: null },
      { input_id: "opaque", state: "Refused", decided_seq: null },
      { input_id: "legacy-release", state: "Refused", decided_seq: null },
    ],
  );
  assert.deepEqual(
    (await subject.query(`SELECT cause_kind,cause_id FROM journal_entry`)).rows,
    [{ cause_kind: "Operation", cause_id: "succeeded" }],
  );
  const migrated = await subject.query<{ command: string }>(
    `SELECT command FROM operation WHERE operation='pending'`,
  );
  assert.deepEqual(parseTicketCommand(migrated.rows[0]?.command ?? ""), {
    parsed: "Ok",
    value: {
      version: 1,
      command: "Decide",
      event: { type: "Dispatch", value: 1 },
    },
  });
  assert.deepEqual(
    (
      await subject.query(
        `SELECT state,outcome_code FROM decision_input WHERE input_id='opaque'`,
      )
    ).rows,
    [{ state: "Refused", outcome_code: "CommandUnreadable" }],
  );
  assert.deepEqual(
    (
      await subject.query(
        `SELECT i.state,i.outcome_code,i.terminal_at IS NOT NULL AS terminal
           FROM decision_input i WHERE i.input_id='legacy-release'`,
      )
    ).rows,
    [
      {
        state: "Refused",
        outcome_code: "CommandUnreadable",
        terminal: true,
      },
    ],
  );
  assert.deepEqual(
    (await subject.query(`SELECT ticket_next FROM project`)).rows,
    [{ ticket_next: "2" }],
  );
}

/**
 * The rows migration thirteen alters rather than creates: an escalation raised
 * before `native_action` had an attempt column or a second kind, and a
 * finalization request written before its claim was fenced by an epoch. A
 * migration that only ever runs against an empty schema is a migration nothing
 * has asked to preserve anything.
 */
async function seedBeforeI7(subject: pg.Pool): Promise<void> {
  await subject.query(
    `INSERT INTO native_action
     (tenant,project,action,authorizing_seq,effect_position,ticket,action_version,
      kind,reason,required_capability)
     VALUES ('tenant','project','escalation',1,0,1,1,
       'TicketEscalation','WorkFailed','ResolveTicket')`,
  );
  await subject.query(
    `INSERT INTO native_action_resolution (tenant,project,action,resolution)
     VALUES ('tenant','project','escalation','Resume')`,
  );
  await subject.query(
    `INSERT INTO finalization_request
     (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
      request_generation) VALUES ('tenant','project','1:1:RunFinalizer',1,1,1,1,1)`,
  );
}

/** What migration thirteen must have left those rows saying, and what it must now refuse. */
async function assertMigratedI3(subject: pg.Pool): Promise<void> {
  assert.deepEqual(
    (
      await subject.query(
        `SELECT kind, state, required_capability, attempt FROM native_action`,
      )
    ).rows,
    [
      {
        kind: "TicketEscalation",
        state: "Open",
        required_capability: "ResolveTicket",
        attempt: null,
      },
    ],
  );
  assert.deepEqual(
    (
      await subject.query(
        `SELECT state, recovery_epoch FROM finalization_request`,
      )
    ).rows,
    [{ state: "Open", recovery_epoch: null }],
  );
  await assert.rejects(
    subject.query(
      `INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,ticket,action_version,
        kind,reason,required_capability)
       VALUES ('tenant','project','rival',1,0,2,1,
         'TicketEscalation','WorkFailed','ResolveTicket')`,
    ),
    /native_action_effect_is_materialized_once/u,
  );
  await assert.rejects(
    subject.query(
      `UPDATE finalization_request SET claim_owner='owner', claim_expires_at=now()`,
    ),
    /finalization_request_claim_is_fenced/u,
  );
}

test("each migration runs forward over the rows the slice before it left", async () => {
  const database = `chuggy_i3_${randomUUID().replaceAll("-", "")}`;
  const admin = postgresPool(postgresHarnessUrl());
  await admin.query(`CREATE DATABASE ${database}`);
  const subject = postgresPool(databaseUrl(database));
  try {
    await subject.query(migrationLedger);
    for (const migration of migrations.slice(0, 4)) {
      for (const statement of migration.statements)
        await subject.query(statement);
    }
    await seedI2(subject);
    for (const migration of migrations.slice(4, 10)) {
      await subject.query("BEGIN");
      for (const statement of migration.statements)
        await subject.query(statement);
      await subject.query("COMMIT");
    }
    await seedBeforeI7(subject);
    for (const migration of migrations.slice(10)) {
      await subject.query("BEGIN");
      for (const statement of migration.statements)
        await subject.query(statement);
      await subject.query("COMMIT");
    }

    await assertMigratedI2(subject);
    await assertMigratedI3(subject);
  } finally {
    await subject.end();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
});

test("an incompatible rollout leaves an untouched database untouched", async () => {
  await migrationDatabase("gate", async (subject) => {
    assert.deepEqual(
      await postgresMigrateCompatible(subject, {
        current: currentRuntimeSchemaContract,
        retainedPrevious: runtimeSchemaContract([]),
      }),
      { migrated: "CouldNotRun" },
    );
    assert.deepEqual(
      (
        await subject.query<{ relation: string | null }>(
          "SELECT to_regclass('public.schema_migration')::text AS relation",
        )
      ).rows,
      [{ relation: null }],
    );
  });
});

test("a staged migration advances after its publishing image is retained", async () => {
  await migrationDatabase("stage", async (subject) => {
    await migrationSeedApplied(subject, declaredLatest);
    await assertDivergentMigrationRefused(subject);
    assert.deepEqual(
      await postgresMigrateCompatible(subject, {
        current: currentRuntimeSchemaContract,
        retainedPrevious: retainedImageContract,
      }),
      { migrated: "Applied", versions: [declaredLatest] },
    );
    assert.equal(
      await schemaCompatibilityPrecondition(
        postgresRuntimeSchema(subject),
        retainedImageContract,
      ).check(new AbortController().signal),
      true,
    );
  });
});

test("the command applies the declared schema and the run after it applies nothing", async () => {
  await migrationDatabase("command", async (subject, url) => {
    assert.deepEqual(await migrationCommandRun(url), {
      code: 0,
      report: `migrate: applied ${migrations.map(({ version }) => version).join(",")}`,
    });
    assert.deepEqual(await migrationCommandRun(url), {
      code: 0,
      report: "migrate: the schema was already current",
    });
    assert.equal(
      await schemaCompatibilityPrecondition(
        postgresRuntimeSchema(subject),
        currentRuntimeSchemaContract,
      ).check(new AbortController().signal),
      true,
    );
  });
});

/** Drives the command at a ledger holding the versions below `beyond` and one this image never declared. */
async function migrationForeignLedgerRefused(
  label: string,
  beyond: number,
): Promise<void> {
  const foreign = declaredLatest + 1;
  await migrationDatabase(label, async (subject, url) => {
    await migrationSeedApplied(subject, beyond);
    await subject.query(
      "INSERT INTO schema_migration (version,name) VALUES ($1,$2)",
      [foreign, "a migration a later image declares"],
    );
    assert.deepEqual(await migrationCommandRun(url), {
      code: 2,
      report:
        "migrate: the applied ledger is not a prefix of the schema this image declares, so nothing was applied",
    });
    assert.deepEqual(
      (
        await subject.query<{ version: number }>(
          "SELECT version FROM schema_migration ORDER BY version",
        )
      ).rows.map(({ version }) => version),
      [
        ...migrations
          .filter(({ version }) => version < beyond)
          .map(({ version }) => version),
        foreign,
      ],
    );
  });
}

test("a ledger carrying a version this image does not declare is refused untouched", async () => {
  await migrationForeignLedgerRefused("foreign", declaredLatest);
  await migrationForeignLedgerRefused("rolledback", declaredLatest + 1);
});

test("a statement that fails is a failure and not a could-not-run, and takes its ledger row with it", async () => {
  const sabotaged = migrations.findLast(({ statements }) =>
    statements.some((statement) => statement.includes(accountIdentityFunction)),
  )?.version;
  assert.notEqual(sabotaged, undefined, "no migration names the function");
  const version = sabotaged ?? 0;
  await migrationDatabase("failing", async (subject, url) => {
    await migrationSeedApplied(subject, version);
    await subject.query(
      `ALTER FUNCTION ${accountIdentityFunction}(text,text)
         RENAME TO ${accountIdentityFunction}_renamed`,
    );
    const run = await migrationCommandRun(url);
    assert.equal(run.code, 1);
    assert.match(run.report, new RegExp(accountIdentityFunction, "u"));
    assert.equal(
      (
        await subject.query<{ latest: number | null }>(
          "SELECT max(version) AS latest FROM schema_migration",
        )
      ).rows[0]?.latest,
      version - 1,
    );
  });
});

/** The five columns migration 19 exists to add, whatever order a table has them in. */
const requirementColumns = [
  "requirement_identity",
  "requirement_value",
  "requirement_digest",
  "requirement_source",
  "platform_default_version",
] as const;

/** Takes a database back to the shape one migrated before those columns existed has. */
async function unmaterializeRequirement(subject: pg.Pool): Promise<void> {
  await subject.query(
    "DROP TRIGGER execution_materializes_legacy_requirement ON execution",
  );
  await subject.query(
    "DROP FUNCTION materialize_legacy_execution_requirement()",
  );
  await subject.query(
    `ALTER TABLE execution ${requirementColumns
      .map((column) => `DROP COLUMN ${column} CASCADE`)
      .join(",")}`,
  );
  await subject.query(
    `REVOKE SELECT ON configuration_revision FROM ${schedulerRole}`,
  );
  await subject.query(
    `CREATE OR REPLACE FUNCTION execution_moves_legally() RETURNS trigger
       LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
       BEGIN
         IF (NEW.tenant,NEW.project,NEW.execution,NEW.ticket,NEW.task,
             NEW.source_request,NEW.account,NEW.cluster,
             NEW.configuration_revision,NEW.configuration_digest)
            IS DISTINCT FROM
            (OLD.tenant,OLD.project,OLD.execution,OLD.ticket,OLD.task,
             OLD.source_request,OLD.account,OLD.cluster,
             OLD.configuration_revision,OLD.configuration_digest) THEN
           RAISE EXCEPTION 'execution identity or pin changed';
         END IF;
         RETURN NEW;
       END $$`,
  );
}

/** An execution whose requirement has to be reconstructed from its configuration. */
async function seedLegacyExecution(subject: pg.Pool): Promise<void> {
  await subject.query("SET session_replication_role=replica");
  try {
    await subject.query(
      `INSERT INTO configuration_revision
       (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
       VALUES ('tenant','project','revision',
         '{"image":"registry.example/worker:legacy"}','configuration-digest',
         'ProjectWriter','subject')`,
    );
    await subject.query(
      `INSERT INTO execution
       (tenant,project,execution,ticket,task,source_request,account,cluster,
        configuration_revision,configuration_digest,requirement_identity,
        requirement_value,requirement_digest,requirement_source,
        platform_default_version)
       VALUES ('tenant','project','execution',1,1,'request','account','cluster',
         'revision','configuration-digest','discarded','{}','discarded',
         'PlatformDefault',1)`,
    );
  } finally {
    await subject.query("SET session_replication_role=origin");
  }
}

/** The legacy row carries the platform requirement derived from its configuration. */
async function assertRequirementBackfilled(subject: pg.Pool): Promise<void> {
  const value = {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: "registry.example/worker:legacy",
  };
  assert.deepEqual(
    (
      await subject.query(
        `SELECT requirement_identity,requirement_value,requirement_digest,
                requirement_source,platform_default_version
           FROM execution WHERE execution='execution'`,
      )
    ).rows,
    [
      {
        requirement_identity: "execution",
        requirement_value: value,
        requirement_digest: createHash("sha256")
          .update(JSON.stringify(value), "utf8")
          .digest("hex"),
        requirement_source: "PlatformDefault",
        platform_default_version: "1",
      },
    ],
  );
}

async function applyMigration(
  subject: pg.Pool,
  version: number,
): Promise<void> {
  const migration = migrations.find((one) => one.version === version);
  assert.ok(migration, `migration ${version} is declared`);
  for (const statement of migration.statements) await subject.query(statement);
}

/** Every column is there and none of them is nullable. */
async function assertRequirementColumns(subject: pg.Pool): Promise<void> {
  const columns = await subject.query<{
    column_name: string;
    is_nullable: string;
  }>(
    `SELECT column_name,is_nullable FROM information_schema.columns
      WHERE table_name='execution' AND column_name = ANY($1) ORDER BY column_name`,
    [[...requirementColumns]],
  );
  assert.deepEqual(
    columns.rows.map(({ column_name }) => column_name),
    [...requirementColumns].sort(),
  );
  assert.deepEqual(
    columns.rows.map(({ is_nullable }) => is_nullable),
    columns.rows.map(() => "NO"),
  );
}

/** The constraints, and the trigger the boundary owner has to own to be trusted. */
async function assertRequirementBoundary(subject: pg.Pool): Promise<void> {
  assert.equal(
    (
      await subject.query(
        `SELECT 1 FROM pg_constraint WHERE conrelid='execution'::regclass
           AND conname IN ('execution_requirement_identity_unique',
                           'execution_requirement_source_known',
                           'execution_platform_default_version_positive')`,
      )
    ).rows.length,
    3,
  );
  assert.deepEqual(
    (
      await subject.query<{ owner: string }>(
        `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc
          WHERE proname='materialize_legacy_execution_requirement'`,
      )
    ).rows.map(({ owner }) => owner),
    [boundaryOwnerRole],
  );
  assert.equal(
    (
      await subject.query(
        `SELECT 1 FROM pg_trigger WHERE tgrelid='execution'::regclass
           AND tgname='execution_materializes_legacy_requirement'`,
      )
    ).rows.length,
    1,
  );
}

/** What each side may do with the columns, asked of the server and not of the chain. */
async function assertRequirementGrants(subject: pg.Pool): Promise<void> {
  for (const column of requirementColumns)
    for (const [role, privilege] of [
      [schedulerRole, "INSERT"],
      [apiRole, "SELECT"],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_column_privilege($1,'execution',$2,$3) AS granted",
            [role, column, privilege],
          )
        ).rows[0]?.granted,
        true,
        `${role} holds ${privilege} on ${column}`,
      );
  assert.equal(
    (
      await subject.query<{ granted: boolean }>(
        "SELECT has_table_privilege($1,'configuration_revision','SELECT') AS granted",
        [schedulerRole],
      )
    ).rows[0]?.granted,
    true,
  );
}

test("the requirement a database migrated before the columns existed never got is added", async () => {
  await migrationDatabase("requirement", async (subject) => {
    await migrationSeedApplied(subject, 19);
    await seedLegacyExecution(subject);
    await unmaterializeRequirement(subject);

    await applyMigration(subject, 19);

    await assertRequirementBackfilled(subject);
    await assertRequirementColumns(subject);
    await assertRequirementBoundary(subject);
    await assertRequirementGrants(subject);
  });
});

test("the migration that adds the requirement leaves a database already carrying it alone", async () => {
  await migrationDatabase("requirementagain", async (subject) => {
    await migrationSeedApplied(subject, 19);
    await applyMigration(subject, 19);
    await applyMigration(subject, 19);
    await assertRequirementColumns(subject);
    await assertRequirementBoundary(subject);
    await assertRequirementGrants(subject);
  });
});

test("repository configuration provenance migrates as an immutable API boundary", async () => {
  await migrationDatabase("repositoryprovenance", async (subject) => {
    await migrationSeedApplied(subject, 20);
    await applyMigration(subject, 20);
    assert.equal(
      (
        await subject.query<{ relation: string | null }>(
          "SELECT to_regclass('repository_configuration_provenance')::text AS relation",
        )
      ).rows[0]?.relation,
      "repository_configuration_provenance",
    );
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_function_privilege($1,'import_repository_configuration(text,text,text,text,text,text,text,text,text,text,text)','EXECUTE') AS granted",
          [apiRole],
        )
      ).rows[0]?.granted,
      true,
    );
    for (const privilege of ["UPDATE", "DELETE"])
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'repository_configuration_provenance',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        false,
      );
  });
});

test("the API repository binding read migrates without exposing its table", async () => {
  await migrationDatabase("repositorybindingread", async (subject) => {
    await migrationSeedApplied(subject, 21);
    await applyMigration(subject, 21);
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          `SELECT has_function_privilege($1,'${repositoryBindingReadFunction}(text,text)','EXECUTE') AS granted`,
          [apiRole],
        )
      ).rows[0]?.granted,
      true,
    );
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_table_privilege($1,'project_repository','SELECT') AS granted",
          [apiRole],
        )
      ).rows[0]?.granted,
      false,
    );
  });
});
