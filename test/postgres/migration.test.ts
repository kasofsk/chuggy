import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  accountIdentityFunction,
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizationFunction,
  finalizerRole,
  migrationLedger,
  migrations,
  notificationPublishFunction,
  projectChangeAppendFunction,
  projectChangeRetainedFunction,
  projectChangeSweepFunction,
  schedulerRole,
  repositoryBindingReadFunction,
  schemaTextSet,
  selectorServiceRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresMigrate,
  postgresMigrateCompatible,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
  runtimeSchemaContract,
} from "../../src/adapters/postgres/runtimeSchema.ts";
import {
  agentSessionPromptCharsMax,
  sessionPromptCeilings,
  nativeHttpPathSegmentCharsMax,
  projectChangeResourceCharsMax,
  sessionIdentityCharsMax,
  selectorHandoffNoteBytesMax,
  sessionTurnInputCharsMax,
  sessionTurnResultCharsMax,
} from "../../src/contract/http.ts";
import { briefFinalizationModes } from "../../src/contract/rosters.ts";
import {
  leadMillisecondsPerDecision,
  leadTokensPerDecision,
} from "../../src/adapters/postgres/schema/migrations/059-lead-decisions.ts";
import {
  allSessionCapabilities,
  sessionCapabilitiesMax,
} from "../../src/interpreter/agentSession.ts";
import { allSessionTurnFailures } from "../../src/interpreter/agentSession.ts";
import { leadToolAllowlist } from "../../src/interpreter/leadTools.ts";
import { leadToolCallsPerDecision } from "../../src/adapters/postgres/schema/migrations/061-lead-tools.ts";
import { allSessionAttemptEvidences } from "../../src/interpreter/sessionScheduler.ts";
import { schemaContractAccepts } from "../../src/interpreter/serviceRuntime.ts";
import { allProjectChangeKinds } from "../../src/interpreter/projectChange.ts";
import { resumeTags } from "../../src/domain/generated/modelTypes.ts";
import { schemaCompatibilityPrecondition } from "../../src/interpreter/serviceRuntime.ts";
import { postgresHarnessUrl } from "./harness.ts";
import type pg from "pg";
import {
  encodeDecisionEventText,
  parseTicketCommand,
} from "../../src/interpreter/wire.ts";
import { postgresHarnessEntry } from "./harness.ts";
import { postgresHarnessEpoch, postgresHarnessProject } from "./harness.ts";
import { postgresProjectStore } from "../../src/adapters/postgres/projectStore.ts";
import { asInstallationId, asTicketId } from "../../src/domain/ids.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import type { ProjectRead } from "../../src/interpreter/nativeWeb.ts";

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
/**
 * The retained image's staged tail is every migration declared past the one it
 * published, read from the declared list rather than copied beside it: a
 * staged advance is only possible where the retained image understands the
 * whole target, so a literal tail is a copy that must equal the declaration and
 * silently stops the case testing anything the day it does not.
 */
const retainedImageContract = runtimeSchemaContract(publishingImageRequired, [
  ...publishingImageRequired,
  ...migrations
    .filter(
      ({ version }) =>
        version >
        Math.max(...publishingImageRequired.map((each) => each.version)),
    )
    .map(({ version, name }) => ({ version, name })),
]);

const declaredLatest = Math.max(...migrations.map(({ version }) => version));
const installationAuthorityMigration = migrations.find(
  ({ name }) => name === "the installation authority",
);
if (installationAuthorityMigration === undefined)
  throw new Error("the installation authority migration is not declared");

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
    if (migration.version === 25)
      await subject.query("SET chuggy.initializing_journal = 'on'");
    for (const statement of migration.statements)
      await subject.query(statement);
    if (migration.version === 25)
      await subject.query("RESET chuggy.initializing_journal");
    await subject.query(
      "INSERT INTO schema_migration (version,name) VALUES ($1,$2)",
      [migration.version, migration.name],
    );
  }
}

/** Runs the migration command against one database and returns what it reported. */
async function migrationCommandRun(
  url: string,
  adoptingInstallationId?: string,
): Promise<{ readonly code: number; readonly report: string }> {
  const run = promisify(execFile)(
    process.execPath,
    ["--experimental-strip-types", "src/roots/migrate.ts"],
    {
      cwd: process.cwd(),
      env: {
        CHUG_MIGRATE_DATABASE_URL: url,
        ...(adoptingInstallationId === undefined
          ? {}
          : { CHUG_MIGRATE_ADOPT_INSTALLATION_ID: adoptingInstallationId }),
      },
    },
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
  appliedLatest: number,
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
    [{ version: appliedLatest }],
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
    for (const migration of migrations
      .slice(10)
      .filter(
        ({ version }) => version < installationAuthorityMigration.version,
      )) {
      await subject.query("BEGIN");
      for (const statement of migration.statements)
        await subject.query(statement);
      await subject.query("COMMIT");
    }

    await subject.query("BEGIN");
    await assert.rejects(async () => {
      for (const statement of installationAuthorityMigration.statements)
        await subject.query(statement);
    }, /existing journal has no installation authority/u);
    await subject.query("ROLLBACK");

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

test("an empty staged legacy journal cannot silently acquire an authority", async () => {
  await migrationDatabase("stage", async (subject) => {
    await migrationSeedApplied(subject, installationAuthorityMigration.version);
    await subject.query("SET chuggy.initializing_journal = 'on'");
    await assertDivergentMigrationRefused(
      subject,
      installationAuthorityMigration.version - 1,
    );
    const retainedAfterPublication = runtimeSchemaContract(
      retainedImageContract.required,
      migrations.map(({ version, name }) => ({ version, name })),
    );
    await assert.rejects(
      postgresMigrateCompatible(subject, {
        current: currentRuntimeSchemaContract,
        retainedPrevious: retainedAfterPublication,
      }),
      /existing journal has no installation authority/u,
    );
    assert.equal(
      (
        await schemaCompatibilityPrecondition(
          postgresRuntimeSchema(subject),
          retainedAfterPublication,
        ).check(new AbortController().signal)
      ).met,
      "Met",
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
      (
        await schemaCompatibilityPrecondition(
          postgresRuntimeSchema(subject),
          currentRuntimeSchemaContract,
        ).check(new AbortController().signal)
      ).met,
      "Met",
    );
  });
});

test("fresh journals receive different durable installation authorities", async () => {
  const identities: string[] = [];
  for (const label of ["authority_a", "authority_b"]) {
    await migrationDatabase(label, async (subject) => {
      await postgresMigrate(subject);
      const first = await subject.query<{ installation_id: string }>(
        "SELECT installation_id FROM installation_authority",
      );
      await postgresMigrate(subject);
      const restarted = await subject.query<{ installation_id: string }>(
        "SELECT installation_id FROM installation_authority",
      );
      assert.deepEqual(restarted.rows, first.rows);
      identities.push(first.rows[0]?.installation_id ?? "");
    });
  }
  assert.equal(identities.length, 2);
  assert.notEqual(identities[0], identities[1]);
});

test("an initialized legacy journal cannot silently acquire an authority", async () => {
  await migrationDatabase("authority_legacy", async (subject) => {
    await migrationSeedApplied(subject, installationAuthorityMigration.version);
    await subject.query(
      "INSERT INTO project (tenant,project,lifecycle) VALUES ('tenant','project','Active')",
    );
    await subject.query("SET chuggy.initializing_journal = 'on'");
    await assert.rejects(
      postgresMigrate(subject),
      /existing journal has no installation authority/u,
    );
    assert.deepEqual(
      (
        await subject.query<{ relation: string | null }>(
          "SELECT to_regclass('public.installation_authority')::text AS relation",
        )
      ).rows,
      [{ relation: null }],
    );
  });
});

test("an operator can adopt an initialized legacy journal under a named authority", async () => {
  await migrationDatabase("authority_adopt", async (subject, url) => {
    await migrationSeedApplied(subject, installationAuthorityMigration.version);
    await subject.query(
      "INSERT INTO project (tenant,project,lifecycle) VALUES ('tenant','project','Active')",
    );
    const adopted = "b1fc3e12-c1fb-4cc0-89ea-fb4018428cbc";
    assert.deepEqual(await migrationCommandRun(url, adopted), {
      code: 0,
      report: `migrate: applied ${migrations
        .filter(
          ({ version }) => version >= installationAuthorityMigration.version,
        )
        .map(({ version }) => version)
        .join(",")}`,
    });
    assert.deepEqual(
      (
        await subject.query<{ installation_id: string }>(
          "SELECT installation_id FROM installation_authority",
        )
      ).rows,
      [{ installation_id: adopted }],
    );
  });
});

test("adoption is refused unless installation authority migration is pending", async () => {
  await migrationDatabase("authority_not_pending", async (subject) => {
    await postgresMigrate(subject);
    await assert.rejects(
      postgresMigrateCompatible(
        subject,
        {
          current: currentRuntimeSchemaContract,
          retainedPrevious: currentRuntimeSchemaContract,
        },
        asInstallationId("f8cf696a-91fa-4db9-97c5-9ef49ae85cdc"),
      ),
      /adoption was requested but its migration is not pending/u,
    );
  });
});

test("a fresh journal refuses an adoption identity", async () => {
  await migrationDatabase("authority_fresh_adopt", async (subject) => {
    await assert.rejects(
      postgresMigrateCompatible(
        subject,
        {
          current: currentRuntimeSchemaContract,
          retainedPrevious: currentRuntimeSchemaContract,
        },
        asInstallationId("209989e8-c688-4ba2-9449-f80a87f169c5"),
      ),
      /fresh journal generates its installation authority/u,
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

/**
 * The rename below breaks a migration only where the server resolves the
 * function's name as it applies it, which a `plpgsql` body does not: one names
 * its own dependencies when it runs.
 */
test("a statement that fails is a failure and not a could-not-run, and takes its ledger row with it", async () => {
  const sabotaged = migrations.findLast(({ statements }) =>
    statements.some(
      (statement) =>
        statement.includes(accountIdentityFunction) &&
        !statement.includes("plpgsql"),
    ),
  )?.version;
  assert.notEqual(
    sabotaged,
    undefined,
    "no migration resolves the function as it applies",
  );
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

/**
 * Applies every migration above one, so a case pinned at that migration still
 * offers a current adapter the relations it selects.
 */
async function applyMigrationsAbove(
  subject: pg.Pool,
  version: number,
): Promise<void> {
  for (const migration of migrations.filter((one) => one.version > version))
    for (const statement of migration.statements)
      await subject.query(statement);
}

async function seedEscalatedProjections(subject: pg.Pool): Promise<void> {
  const store = postgresProjectStore(subject);
  const epoch = await postgresHarnessEpoch(store);
  const partition = await postgresHarnessProject(store, "dependable-backfill");
  const entries = [
    {
      seq: 1,
      ticket: 1,
      label: "ticket-revoked",
      transitions: [{ ticket: 1, from: "Pending", to: "Escalated" }],
    },
    {
      seq: 2,
      ticket: 2,
      label: "ticket-escalated rework_budget_exhausted",
      transitions: [{ ticket: 2, from: "Evaluating", to: "Escalated" }],
    },
  ];
  await subject.query("BEGIN");
  for (const entry of entries) {
    await subject.query(
      `INSERT INTO decision_input
          (tenant,project,ordinal,input_kind,input_id,base_priority,lifecycle_generation,
           state,decided_seq,terminal_at,settled_authority_kind,settled_authority_subject)
         VALUES ($1,$2,$3,'Continuation',$4,'Continuation',1,'Journaled',$3,now(),
                 'ProjectTicketWriter','owner')`,
      [
        partition.tenant,
        partition.project,
        entry.seq,
        `cause-${String(entry.seq)}`,
      ],
    );
    await subject.query(
      `INSERT INTO journal_entry
          (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
           recovery_epoch,cause_kind,cause_id)
         VALUES ($1,$2,$3,$4,$5,$6,'owner',1,$7,'Continuation',$8)`,
      [
        partition.tenant,
        partition.project,
        entry.seq,
        JSON.stringify({
          seq: entry.seq,
          event: { type: "Revoke", value: 99 },
          rec: {
            label: entry.label,
            transitions: entry.transitions,
            effects: [],
          },
        }),
        `digest-${String(entry.seq)}`,
        entry.seq === 1 ? "genesis" : "digest-1",
        epoch,
        `cause-${String(entry.seq)}`,
      ],
    );
    await subject.query(
      `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
         VALUES ($1,$2,$3,'Escalated',$4)`,
      [partition.tenant, partition.project, entry.ticket, entry.seq],
    );
  }
  await subject.query("COMMIT");
}

async function assertDependableBackfill(subject: pg.Pool): Promise<void> {
  await migrationSeedApplied(subject, 23);
  await seedEscalatedProjections(subject);
  await applyMigration(subject, 23);
  assert.deepEqual(
    (
      await subject.query<{ ticket: string; dependable: boolean }>(
        `SELECT ticket::text,dependable FROM ticket_projection ORDER BY ticket`,
      )
    ).rows,
    [
      { ticket: "1", dependable: false },
      { ticket: "2", dependable: true },
    ],
  );
}

test("migration 23 backfills only dependency-revoked escalations as undependable", async () => {
  await migrationDatabase("dependable_backfill", async (subject) => {
    await assertDependableBackfill(subject);
  });
});

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

test("the configuration importer is fenced and holds only its two functions", async () => {
  await migrationDatabase("configurationimporter", async (subject) => {
    await migrationSeedApplied(subject, 29);
    await applyMigration(subject, 29);
    for (const [signature, granted] of [
      [
        "import_repository_configuration(text,text,text,text,text,text,text,text,text,text,text,text)",
        true,
      ],
      [`${repositoryBindingReadFunction}(text,text)`, true],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [configurationImporterRole, signature],
          )
        ).rows[0]?.granted,
        granted,
      );
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_table_privilege($1,'project','SELECT') AS granted",
          [configurationImporterRole],
        )
      ).rows[0]?.granted,
      false,
    );
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_column_privilege($1,'project_repository','recovery_epoch','UPDATE') AS granted",
          [boundaryOwnerRole],
        )
      ).rows[0]?.granted,
      true,
    );
  });
});

test("migration 26 replaces the finalization door on an upgraded database", async () => {
  await migrationDatabase("handoff_outcomes", async (subject) => {
    await migrationSeedApplied(subject, 26);
    await subject.query(`INSERT INTO recovery_epoch (epoch) VALUES ('epoch')`);
    await subject.query(
      `INSERT INTO project (tenant,project,lifecycle,head,ingress_next)
       VALUES ('tenant','project','Active',1,1)`,
    );
    await subject.query(`SET session_replication_role = replica`);
    await subject.query(
      `INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id) VALUES
       ('tenant','project',1,'{}','digest','genesis','owner',1,'epoch',
        'Operation','legacy-operation')`,
    );
    await subject.query(`SET session_replication_role = origin`);
    const before = await subject.query<{ body: string }>(
      `SELECT pg_get_functiondef($1::regprocedure) AS body`,
      [
        `${finalizationFunction}(text,text,text,text,text,text,bigint,text,text,text)`,
      ],
    );
    assert.doesNotMatch(before.rows[0]?.body ?? "", /PromotionAccepted/u);
    await subject.query(
      `INSERT INTO finalization_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
        request_generation) VALUES ('tenant','project','legacy-in-flight',1,1,1,1,1)`,
    );

    await applyMigration(subject, 26);

    assert.equal(
      (
        await subject.query<{ kind: string }>(
          `SELECT kind FROM finalization_request WHERE request='legacy-in-flight'`,
        )
      ).rows[0]?.kind,
      "RunFinalizer",
    );

    const after = await subject.query<{ body: string }>(
      `SELECT pg_get_functiondef($1::regprocedure) AS body`,
      [
        `${finalizationFunction}(text,text,text,text,text,text,bigint,text,text,text)`,
      ],
    );
    assert.match(after.rows[0]?.body ?? "", /PromotionAccepted/u);
    assert.match(
      after.rows[0]?.body ?? "",
      /bound\.verdict IS NOT DISTINCT FROM 'Promoted'/u,
    );
    assert.match(after.rows[0]?.body ?? "", /HandoffPublicationUnproven/u);
  });
});

test("migration 27 makes cross-repository request configuration immutable", async () => {
  await migrationDatabase("cross_repository_finalizer", async (subject) => {
    await migrationSeedApplied(subject, 27);
    await applyMigration(subject, 27);
    const constraints = await subject.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
        WHERE c.conrelid='project_repository'::regclass
          AND c.conname='project_repository_pkey'`,
    );
    assert.match(
      constraints.rows[0]?.definition ?? "",
      /PRIMARY KEY \(tenant, project, repository\)/u,
    );
    const trigger = await subject.query<{ enabled: string }>(
      `SELECT t.tgenabled AS enabled FROM pg_trigger t
        WHERE t.tgrelid='finalization_request_configuration'::regclass
          AND t.tgname='finalization_request_configuration_is_written_once'`,
    );
    assert.equal(trigger.rows[0]?.enabled, "O");
    const door = await subject.query<{ security_definer: boolean }>(
      `SELECT p.prosecdef AS security_definer FROM pg_proc p
        WHERE p.oid='read_accepted_handoff_promotion(text,text,bigint)'::regprocedure`,
    );
    assert.equal(door.rows[0]?.security_definer, true);
  });
});

const appendCall = `${projectChangeAppendFunction}(text,text,text,text)`;

/** Who may execute each of the change log's three doors on an upgraded database. */
const projectChangeExecutors = [
  [schedulerRole, appendCall, true],
  [finalizerRole, appendCall, false],
  [apiRole, appendCall, false],
  [ticketServiceRole, appendCall, false],
  [apiRole, `${projectChangeSweepFunction}(bigint)`, true],
  [apiRole, `${projectChangeRetainedFunction}(bigint)`, true],
  [schedulerRole, `${projectChangeSweepFunction}(bigint)`, false],
  [finalizerRole, `${projectChangeSweepFunction}(bigint)`, false],
] as const;

/** What the API holds on the relation itself, which is the read and nothing else. */
const projectChangeApiPrivileges = [
  ["SELECT", true],
  ["INSERT", false],
  ["UPDATE", false],
  ["DELETE", false],
] as const;

test("migration 38 grants the change log's doors to the roles that reach them", async () => {
  await migrationDatabase("project_change_grants", async (subject) => {
    await migrationSeedApplied(subject, 38);
    await applyMigration(subject, 38);
    for (const [role, signature, granted] of projectChangeExecutors) {
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [role, signature],
          )
        ).rows[0]?.granted,
        granted,
        `${role} may execute ${signature}`,
      );
    }
    for (const [privilege, granted] of projectChangeApiPrivileges) {
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'project_change',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        granted,
        `${apiRole} holds ${privilege} on the change log`,
      );
    }
  });
});

test("migration 38 leaves an upgraded database bridging and replayable from nothing", async () => {
  await migrationDatabase("project_change", async (subject) => {
    await migrationSeedApplied(subject, 38);
    await applyMigration(subject, 38);
    assert.equal(
      (
        await subject.query<{ retained: boolean }>(
          `SELECT ${projectChangeRetainedFunction}(0) AS retained`,
        )
      ).rows[0]?.retained,
      true,
      "an empty log has lost nothing a cursor was holding",
    );
    await subject.query(
      "INSERT INTO recovery_epoch (epoch) VALUES ('epoch-project-change')",
    );
    await subject.query(
      `INSERT INTO project (tenant,project,lifecycle,head,ingress_next)
       VALUES ('tenant','project','Active',1,1)`,
    );
    await subject.query(
      `SELECT ${notificationPublishFunction}('tenant','project','Draft','draft',NULL,NULL)`,
    );
    assert.deepEqual(
      (
        await subject.query<{ kind: string; resource: string }>(
          "SELECT kind,resource FROM project_change ORDER BY sequence",
        )
      ).rows,
      [{ kind: "Draft", resource: "draft" }],
    );
  });
});

/** An upgraded installation's escalation: parked in the projection, named only on the desk. */
async function seedDeskOnlyEscalation(subject: pg.Pool): Promise<void> {
  await subject.query(`INSERT INTO recovery_epoch (epoch) VALUES ('epoch')`);
  await subject.query(
    `INSERT INTO project (tenant,project,lifecycle,head,ingress_next)
     VALUES ('tenant','project','Active',1,1)`,
  );
  await subject.query(`SET session_replication_role = replica`);
  await subject.query(
    `INSERT INTO journal_entry
     (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
      recovery_epoch,cause_kind,cause_id) VALUES
     ('tenant','project',1,'{}','digest','genesis','owner',1,'epoch',
      'Operation','legacy-operation')`,
  );
  for (const [ticket, phase] of [
    [1, "Escalated"],
    [2, "Working"],
  ] as const)
    await subject.query(
      `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
       VALUES ('tenant','project',$1,$2,1)`,
      [ticket, phase],
    );
  await subject.query(
    `INSERT INTO native_action
     (tenant,project,action,authorizing_seq,effect_position,ticket,action_version,
      kind,reason,required_capability)
     VALUES ('tenant','project','escalation',1,0,1,1,
       'TicketEscalation','GasExhausted','ResolveTicket')`,
  );
  await subject.query(`SET session_replication_role = origin`);
}

async function assertProjectedReasonGrants(subject: pg.Pool): Promise<void> {
  for (const [role, privilege, granted] of [
    [apiRole, "SELECT", true],
    [apiRole, "UPDATE", false],
    [ticketServiceRole, "UPDATE", true],
  ] as const)
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_column_privilege($1,'ticket_projection','reason',$2) AS granted",
          [role, privilege],
        )
      ).rows[0]?.granted,
      granted,
      `${role} holds ${privilege} on the projected reason`,
    );
}

test("migration 39 projects the reason an upgraded database kept only on the desk", async () => {
  await migrationDatabase("escalation_reason", async (subject) => {
    await migrationSeedApplied(subject, 39);
    await seedDeskOnlyEscalation(subject);

    await applyMigration(subject, 39);

    assert.deepEqual(
      (
        await subject.query<{ ticket: string; reason: string }>(
          "SELECT ticket,reason FROM ticket_projection ORDER BY ticket",
        )
      ).rows,
      [
        { ticket: "1", reason: "GasExhausted" },
        { ticket: "2", reason: "NoReason" },
      ],
    );
    await assertProjectedReasonGrants(subject);
    await assert.rejects(
      subject.query(
        "UPDATE ticket_projection SET reason='NotAWall' WHERE ticket=1",
      ),
    );
  });
});

test("the migration that projects the reason leaves a database already carrying it alone", async () => {
  await migrationDatabase("escalation_reason_again", async (subject) => {
    await migrationSeedApplied(subject, 39);
    await seedDeskOnlyEscalation(subject);
    await applyMigration(subject, 39);
    await applyMigration(subject, 39);
    assert.deepEqual(
      (
        await subject.query<{ reason: string }>(
          "SELECT reason FROM ticket_projection WHERE ticket=1",
        )
      ).rows,
      [{ reason: "GasExhausted" }],
    );
    await assertProjectedReasonGrants(subject);
  });
});

test("migration 40 preserves bindings and activates the established binding", async () => {
  await migrationDatabase("repository_activation", async (subject) => {
    await migrationSeedApplied(subject, 40);
    await subject.query(`INSERT INTO recovery_epoch(epoch) VALUES('epoch-40')`);
    await subject.query(
      `INSERT INTO project(tenant,project,lifecycle,head,ingress_next)
       VALUES('tenant-40','project-40','Active',0,1)`,
    );
    await subject.query(
      `INSERT INTO project_repository(tenant,project,repository,recovery_epoch,bound_at)
       VALUES('tenant-40','project-40','established','epoch-40','2026-01-01'),
             ('tenant-40','project-40','historical','epoch-40','2026-01-02')`,
    );

    await applyMigration(subject, 40);

    assert.deepEqual(
      (
        await subject.query(
          `SELECT repository,recovery_epoch
             FROM ${repositoryBindingReadFunction}('tenant-40','project-40')`,
        )
      ).rows,
      [{ repository: "established", recovery_epoch: "epoch-40" }],
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT repository FROM project_repository
            WHERE tenant='tenant-40' AND project='project-40' ORDER BY repository`,
        )
      ).rows,
      [{ repository: "established" }, { repository: "historical" }],
    );
  });
});

/** An installation whose drafts were authored before a draft carried a brief. */
async function seedBrieflessDraft(subject: pg.Pool): Promise<void> {
  await subject.query(`INSERT INTO recovery_epoch (epoch) VALUES ('epoch')`);
  await subject.query(
    `INSERT INTO project (tenant,project,lifecycle,head,ingress_next,ticket_next)
     VALUES ('tenant','project','Active',1,1,2)`,
  );
  await subject.query(
    `INSERT INTO configuration_revision
       (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
     VALUES ('tenant','project','revision','{}','digest','User','author')`,
  );
  await subject.query(
    `INSERT INTO draft VALUES ('tenant','project',1,1,'Draft','revision')`,
  );
  await subject.query(
    `INSERT INTO draft_revision
       (tenant,project,ticket,authoring_version,configuration_revision,authoring,
        authority_kind,authority_subject)
     VALUES ('tenant','project',1,1,'revision','authoring','User','author')`,
  );
}

test("migration 42 opens the brief's doors to the roles that reach it and no others", async () => {
  await migrationDatabase("ticket_brief_grants", async (subject) => {
    await migrationSeedApplied(subject, 42);
    await applyMigration(subject, 42);
    for (const [role, relation, privilege, granted] of [
      [apiRole, "draft_brief", "SELECT", true],
      [apiRole, "draft_brief", "INSERT", false],
      [apiRole, "draft_brief", "UPDATE", false],
      [apiRole, "draft_brief_link", "SELECT", true],
      [apiRole, "draft_brief_link", "INSERT", false],
      [ticketServiceRole, "draft_brief", "SELECT", true],
      [ticketServiceRole, "draft_brief", "UPDATE", false],
      [schedulerRole, "draft_brief", "SELECT", true],
      [schedulerRole, "draft_brief_link", "SELECT", true],
      [boundaryOwnerRole, "draft_brief", "INSERT", true],
      [boundaryOwnerRole, "draft_brief_link", "DELETE", true],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,$2,$3) AS granted",
            [role, relation, privilege],
          )
        ).rows[0]?.granted,
        granted,
        `${role} holds ${privilege} on ${relation}`,
      );
  });
});

/** The five columns the reads need, which is what the grant may open and no more. */
const journalInstantsColumns = [
  "tenant",
  "project",
  "seq",
  "entry",
  "committed_at",
];

/**
 * The grant is column-level, so `has_table_privilege` answers false for the
 * table even where it is held, and the question has to be asked of each column.
 * It is asked of every column the table has rather than of a list written here,
 * because a grant one column too wide reads exactly like a grant that is right
 * and a list would not be asking about the column that was added.
 */
test("migration 56 opens five journal columns to the API and leaves the rest shut", async () => {
  await migrationDatabase("journal_instants_grants", async (subject) => {
    await migrationSeedApplied(subject, 56);
    await applyMigration(subject, 56);
    const columns = await subject.query<{ column: string; granted: boolean }>(
      `SELECT a.attname AS column,
              has_column_privilege($1,'journal_entry',a.attname,'SELECT') AS granted
         FROM pg_attribute a
        WHERE a.attrelid='journal_entry'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [apiRole],
    );
    assert.ok(
      columns.rows.length > journalInstantsColumns.length,
      "the journal has columns beyond the ones this grant opens",
    );
    assert.deepEqual(
      columns.rows.filter((each) => each.granted).map((each) => each.column),
      journalInstantsColumns,
      `what ${apiRole} may read of journal_entry`,
    );
    for (const privilege of ["INSERT", "UPDATE", "DELETE"] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'journal_entry',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        false,
        `${apiRole} holds ${privilege} on journal_entry`,
      );
  });
});

/** How many tickets the index case releases, which is what gives a scan something to cost. */
const journalInstantsReleases = 400;

/**
 * The event types the fixture writes per ticket, the release first. The other
 * two also name their ticket in `event.value.ticket`, which is what makes the
 * index's partial predicate load-bearing: a predicate widened past the release
 * event indexes them too, and the release lookup then reads three entries where
 * it should read one.
 */
const journalInstantsEvents = [
  "ReleaseTicket",
  "TaskDone",
  "FinalizationResult",
];

/** Every listed ticket's release instant, which is what a page read is asked for here. */
function releasedPage(read: ProjectRead): readonly (string | undefined)[] {
  if (read.result !== "Found")
    throw new Error("migration case: the project has no page");
  return read.project.tickets.map((ticket) => ticket.releasedAt);
}

/**
 * Releases that many tickets into one project, each with the entry that released
 * it and the later entries that name it again. Both directions of the
 * entry/input pair are deferred foreign keys, so the inserts commit together or
 * not at all, and the ANALYZE is what lets the planner cost the rows the table
 * now holds.
 */
async function seedReleasedTickets(
  subject: pg.Pool,
  partition: { readonly tenant: string; readonly project: string },
  epoch: string,
): Promise<void> {
  const kinds = journalInstantsEvents
    .map((type, step) => `(${String(step)},'${type}')`)
    .join(",");
  const entries = journalInstantsReleases * journalInstantsEvents.length;
  await subject.query("BEGIN");
  await subject.query(
    `INSERT INTO decision_input
       (tenant,project,ordinal,input_kind,input_id,base_priority,
        lifecycle_generation,state,decided_seq,terminal_at)
     SELECT $1,$2,k.step*$3+n,'Continuation','entry-'||(k.step*$3+n),
            'Continuation',1,'Journaled',k.step*$3+n,now()
       FROM generate_series(1,$3::bigint) n, (VALUES ${kinds}) AS k(step,type)`,
    [partition.tenant, partition.project, journalInstantsReleases],
  );
  await subject.query(
    `INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id)
     SELECT $1,$2,k.step*$3+n,
       format('{"seq":%s,"event":{"type":"%s","value":{"ticket":%s}},"rec":{}}',
              k.step*$3+n,k.type,n),
       'digest-'||(k.step*$3+n),'previous-'||(k.step*$3+n),'owner',1,$4,
       'Continuation','entry-'||(k.step*$3+n)
       FROM generate_series(1,$3::bigint) n, (VALUES ${kinds}) AS k(step,type)`,
    [partition.tenant, partition.project, journalInstantsReleases, epoch],
  );
  await subject.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
     SELECT $1,$2,n,'Pending',n FROM generate_series(1,$3::bigint) n`,
    [partition.tenant, partition.project, journalInstantsReleases],
  );
  await subject.query(
    "UPDATE project SET head=$3 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project, entries],
  );
  await subject.query("COMMIT");
  await subject.query("ANALYZE journal_entry");
}

/** The release index's own counters: how often it answered, and how many rows it gave up. */
async function releaseIndexUse(
  subject: pg.Pool,
): Promise<{ scans: number; tuples: number }> {
  const found = await subject.query<{ scans: string; tuples: string }>(
    `SELECT idx_scan::text AS scans, idx_tup_read::text AS tuples
       FROM pg_stat_all_indexes
      WHERE relname='journal_entry'
        AND indexrelname='journal_entry_release_ticket'`,
  );
  const row = found.rows[0];
  if (row === undefined)
    throw new Error("migration case: there is no release index to use");
  return { scans: Number(row.scans), tuples: Number(row.tuples) };
}

/**
 * The index's own counters either side of each real read, rather than a plan
 * asserted against a copy of the query: an index whose predicate no longer
 * implies a read's is one the planner cannot enter, which is what the scan count
 * catches, and it is asked of all three reads because a copy left behind by an
 * edit to the others is what asking one of them would miss. The tuple count is
 * asked of the ticket's own read alone, where one entry is what a lookup costs
 * and anything more is a key that stopped matching the index or a predicate that
 * stopped excluding the other entries naming the ticket — not of the pages,
 * which are free to answer the whole lateral in a single indexed pass.
 */
test("migration 56's index is what answers every read of a ticket's release", async () => {
  await migrationDatabase("journal_instants_index", async (subject, url) => {
    await migrationSeedApplied(subject, 56);
    await applyMigration(subject, 56);
    await applyMigrationsAbove(subject, 56);
    const store = postgresProjectStore(subject);
    const epoch = await postgresHarnessEpoch(store);
    const partition = await postgresHarnessProject(store, "journal-instants");
    await seedReleasedTickets(subject, partition, epoch);
    const single = postgresPool(url, {
      connectionsMax: 1,
      connectionWaitMs: 5_000,
      statementTimeoutMs: 10_000,
    });
    const reads = postgresNativeReads(single);
    try {
      for (const [what, read] of [
        [
          "the ticket's own read",
          async () => [(await reads.ticket(partition, asTicketId(1)))?.phase],
        ],
        [
          "the page in identity order",
          async () =>
            releasedPage(await reads.project(partition, { limit: 10 })),
        ],
        [
          "the page in recent-activity order",
          async () =>
            releasedPage(
              await reads.project(partition, {
                limit: 10,
                order: "RecentActivity",
              }),
            ),
        ],
      ] as const) {
        const before = await releaseIndexUse(subject);
        const listed = await read();
        assert.ok(listed.length >= 1, `${what} listed no ticket`);
        for (const each of listed)
          assert.ok(each !== undefined, `${what} left a ticket unread`);
        await single.query("SELECT pg_stat_force_next_flush()");
        assert.ok(
          (await releaseIndexUse(subject)).scans > before.scans,
          `${what} was answered without the index that exists for it`,
        );
      }
      const before = await releaseIndexUse(subject);
      assert.ok(
        (await reads.ticket(partition, asTicketId(1)))?.releasedAt !==
          undefined,
        "the ticket read carries the release instant",
      );
      await single.query("SELECT pg_stat_force_next_flush()");
      const after = await releaseIndexUse(subject);
      assert.ok(
        after.tuples - before.tuples <= 1,
        `one ticket's release cost ${String(after.tuples - before.tuples)} entries out of the index, so it was scanned for rather than looked up`,
      );
    } finally {
      await single.end();
    }
  });
});

test("migration 42 leaves an upgraded database's drafts unbriefed and briefs the next", async () => {
  await migrationDatabase("ticket_brief", async (subject) => {
    await migrationSeedApplied(subject, 42);
    await seedBrieflessDraft(subject);

    await applyMigration(subject, 42);

    assert.deepEqual(
      (await subject.query("SELECT ticket FROM draft_brief")).rows,
      [],
      "an upgraded installation's drafts are the ones with no brief",
    );
    const created = await subject.query<{ result: string; ticket: string }>(
      `SELECT result,ticket::text AS ticket FROM create_draft('tenant','project','revision','digest',1,
         'authoring','Fix the importer.',ARRAY['https://example.test/one'],
         'refs/heads/rt/ticket-brief','User','author')`,
    );
    assert.equal(created.rows[0]?.result, "Created");
    assert.deepEqual(
      (
        await subject.query<{ ticket: string; intent: string; branch: string }>(
          "SELECT ticket::text AS ticket,intent,branch FROM draft_brief ORDER BY ticket",
        )
      ).rows,
      [
        {
          ticket: created.rows[0]?.ticket ?? "",
          intent: "Fix the importer.",
          branch: "refs/heads/rt/ticket-brief",
        },
      ],
    );
    assert.deepEqual(
      (
        await subject.query<{ ordinal: number; url: string }>(
          "SELECT ordinal,url FROM draft_brief_link ORDER BY ordinal",
        )
      ).rows,
      [{ ordinal: 1, url: "https://example.test/one" }],
    );
    await assert.rejects(
      subject.query(
        "UPDATE draft_brief SET branch='rt/ticket-brief' WHERE ticket=$1",
        [created.rows[0]?.ticket],
      ),
      "the branch a brief names is a reference under one namespace",
    );
  });
});

test("migration 43 widens a kind check installed before that kind existed", async () => {
  await migrationDatabase("native_action_change", async (subject) => {
    await migrationSeedApplied(subject, 43);
    await subject.query(
      `ALTER TABLE project_change
         DROP CONSTRAINT project_change_kind_is_known,
         ADD CONSTRAINT project_change_kind_is_known CHECK
           (kind IN (${schemaTextSet(
             allProjectChangeKinds.filter((kind) => kind !== "NativeAction"),
           )}))`,
    );
    const append = `SELECT ${projectChangeAppendFunction}('tenant','project','NativeAction','1')`;
    await assert.rejects(
      () => subject.query(append),
      /project_change_kind_is_known/u,
      "the log installed with 38 refuses a kind it was created before",
    );

    await applyMigration(subject, 43);

    await subject.query(append);
    assert.deepEqual(
      (
        await subject.query(
          "SELECT kind,resource FROM project_change ORDER BY sequence",
        )
      ).rows,
      [{ kind: "NativeAction", resource: "1" }],
    );
  });
});

test("migration 44 returns the scheduler the bundle references its briefing joins", async () => {
  await migrationDatabase("scheduler_bundle_reference", async (subject) => {
    await migrationSeedApplied(subject, 44);
    const privilege = async (relation: string, verb: string) =>
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_table_privilege($1,$2,$3) AS granted",
          [schedulerRole, relation, verb],
        )
      ).rows[0]?.granted;
    assert.equal(
      await privilege("input_bundle_reference", "SELECT"),
      false,
      "migration 13 revoked the read migration 37's join needs",
    );

    await applyMigration(subject, 44);

    for (const [relation, verb, granted] of [
      ["input_bundle_reference", "SELECT", true],
      ["input_bundle_reference", "INSERT", false],
      ["input_bundle_reference", "UPDATE", false],
      ["input_bundle_reference", "DELETE", false],
      ["input_bundle", "SELECT", false],
    ] as const)
      assert.equal(
        await privilege(relation, verb),
        granted,
        `${schedulerRole} holds ${verb} on ${relation}`,
      );
  });
});

test("migration 45 gives the finalizer the brief its target is narrowed by", async () => {
  await migrationDatabase("finalizer_ticket_brief", async (subject) => {
    await migrationSeedApplied(subject, 45);
    const privilege = async (relation: string, verb: string) =>
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_table_privilege($1,$2,$3) AS granted",
          [finalizerRole, relation, verb],
        )
      ).rows[0]?.granted;
    assert.equal(
      await privilege("draft_brief", "SELECT"),
      false,
      "migration 42 gave the brief to the roles that render it and to no other",
    );

    await applyMigration(subject, 45);

    for (const [relation, verb, granted] of [
      ["draft_brief", "SELECT", true],
      ["draft_brief", "INSERT", false],
      ["draft_brief", "UPDATE", false],
      ["draft_brief", "DELETE", false],
      ["draft_brief_link", "SELECT", true],
      ["draft_brief_link", "INSERT", false],
      ["draft_brief_link", "DELETE", false],
      ["draft", "SELECT", false],
    ] as const)
      assert.equal(
        await privilege(relation, verb),
        granted,
        `${finalizerRole} holds ${verb} on ${relation}`,
      );
  });
});

test("migration 50 lands an existing brief where its work happened and takes a target from the next", async () => {
  await migrationDatabase("brief_finalization", async (subject) => {
    await migrationSeedApplied(subject, 50);
    await seedBrieflessDraft(subject);
    await subject.query(
      `INSERT INTO draft_brief (tenant,project,ticket,intent,branch)
       VALUES ('tenant','project',1,'Fix the importer.','refs/heads/rt/ticket-brief')`,
    );

    await applyMigration(subject, 50);

    assert.deepEqual(
      (
        await subject.query<{ mode: string; target: string | null }>(
          "SELECT finalization_mode AS mode,finalization_target AS target FROM draft_brief",
        )
      ).rows,
      [{ mode: "Push", target: null }],
      "a brief written before the columns existed lands on the branch it names",
    );
    const created = await subject.query<{ result: string; ticket: string }>(
      `SELECT result,ticket::text AS ticket FROM create_draft('tenant','project','revision','digest',1,
         'authoring','Fix the importer.',ARRAY[]::text[],
         'refs/heads/rt/work','Push','refs/heads/rt/landing','User','author')`,
    );
    assert.equal(created.rows[0]?.result, "Created");
    assert.deepEqual(
      (
        await subject.query<{ branch: string; target: string | null }>(
          `SELECT branch,finalization_target AS target FROM draft_brief
            WHERE ticket=$1`,
          [created.rows[0]?.ticket],
        )
      ).rows,
      [{ branch: "refs/heads/rt/work", target: "refs/heads/rt/landing" }],
    );
    for (const [column, value] of [
      ["finalization_mode", "Rebase"],
      ["finalization_target", "rt/landing"],
    ] as const)
      await assert.rejects(
        subject.query(`UPDATE draft_brief SET ${column}=$2 WHERE ticket=$1`, [
          created.rows[0]?.ticket,
          value,
        ]),
        `the brief refuses ${column}=${value}`,
      );
  });
});

test("migration 51 admits a mode installed before it existed and refuses one opening from or into nothing", async () => {
  await migrationDatabase("brief_pull_request", async (subject) => {
    await migrationSeedApplied(subject, 51);
    await subject.query(
      `ALTER TABLE draft_brief
         DROP CONSTRAINT draft_brief_finalization_mode_is_known,
         ADD CONSTRAINT draft_brief_finalization_mode_is_known CHECK
           (finalization_mode IN (${schemaTextSet(
             briefFinalizationModes.filter((mode) => mode !== "PullRequest"),
           )}))`,
    );
    await seedBrieflessDraft(subject);
    await subject.query(
      `INSERT INTO draft_brief (tenant,project,ticket,intent,branch)
       VALUES ('tenant','project',1,'Fix the importer.','refs/heads/rt/ticket-brief')`,
    );
    const landing = `UPDATE draft_brief
        SET finalization_mode='PullRequest',finalization_target='refs/heads/rt/landing'
      WHERE ticket=1`;
    await assert.rejects(
      () => subject.query(landing),
      /draft_brief_finalization_mode_is_known/u,
      "the brief installed with 50 refuses a mode it was created before",
    );

    await applyMigration(subject, 51);

    assert.deepEqual(
      (
        await subject.query<{ mode: string; target: string | null }>(
          "SELECT finalization_mode AS mode,finalization_target AS target FROM draft_brief",
        )
      ).rows,
      [{ mode: "Push", target: null }],
      "a brief that already lands by pushing is untouched",
    );
    await subject.query(landing);
    assert.deepEqual(
      (
        await subject.query<{ mode: string; target: string | null }>(
          "SELECT finalization_mode AS mode,finalization_target AS target FROM draft_brief",
        )
      ).rows,
      [{ mode: "PullRequest", target: "refs/heads/rt/landing" }],
    );
    for (const [written, why] of [
      ["finalization_target=NULL", "loses the reference it opens into"],
      [
        "finalization_mode='PullRequest',finalization_target=NULL",
        "is written naming no reference at all",
      ],
      ["branch=NULL", "names no branch to open from"],
      ["branch=finalization_target", "opens from its own base"],
    ] as const)
      await assert.rejects(
        () => subject.query(`UPDATE draft_brief SET ${written} WHERE ticket=1`),
        /draft_brief_finalization_is_whole/u,
        `no pull request ${why}`,
      );
  });
});

test("migration 55 widens a resume check installed before that point existed", async () => {
  await migrationDatabase("resume_reworking", async (subject) => {
    await migrationSeedApplied(subject, 55);
    await subject.query(
      `ALTER TABLE ticket_projection
         DROP CONSTRAINT ticket_projection_resume_is_known,
         ADD CONSTRAINT ticket_projection_resume_is_known CHECK (
           resume_at IS NULL OR resume_at IN (${schemaTextSet(
             resumeTags.filter((tag) => tag !== "ResumeReworking"),
           )})
         )`,
    );
    const store = postgresProjectStore(subject);
    await postgresHarnessEpoch(store);
    const partition = await postgresHarnessProject(store, "resume-reworking");
    const park = `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,resume_at)
       VALUES ($1,$2,1,'Escalated',1,'ResumeReworking')`;
    const values = [partition.tenant, partition.project];
    await assert.rejects(
      () => subject.query(park, values),
      /ticket_projection_resume_is_known/u,
      "the projection installed with 54 refuses a point it was created before",
    );

    await applyMigration(subject, 55);

    await subject.query(park, values);
    assert.deepEqual(
      (
        await subject.query(
          "SELECT resume_at FROM ticket_projection ORDER BY ticket",
        )
      ).rows,
      [{ resume_at: "ResumeReworking" }],
    );
    await assert.rejects(
      () =>
        subject.query(
          `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,resume_at)
             VALUES ($1,$2,2,'Escalated',1,'ResumeNowhere')`,
          values,
        ),
      /ticket_projection_resume_is_known/u,
      "the widened check is still a check",
    );
  });
});

/** Narrows one roster's check to the members it held before 059 widened it. */
async function migrationNarrowedRoster(
  subject: pg.Pool,
  relation: string,
  constraint: string,
  expression: string,
): Promise<void> {
  await subject.query(
    `ALTER TABLE ${relation}
       DROP CONSTRAINT ${constraint},
       ADD CONSTRAINT ${constraint} CHECK (${expression})`,
  );
}

/** A lead session with one queued turn, which is what a withdrawal moves. */
async function migrationLeadTurn(subject: pg.Pool): Promise<void> {
  const store = postgresProjectStore(subject);
  await postgresHarnessEpoch(store);
  const partition = await postgresHarnessProject(store, "lead-decisions");
  const values = [partition.tenant, partition.project];
  await subject.query(
    `SELECT open_agent_session($1,$2,'session-59','Lead','principal-59',
       NULL,ARRAY[]::text[],'claude-code')`,
    values,
  );
  await subject.query(
    `SELECT enqueue_session_turn($1,$2,'session-59','turn-59','Observation','{}')`,
    values,
  );
}

test("migration 59 widens a kind check installed before these kinds existed", async () => {
  await migrationDatabase("lead_decision_kinds", async (subject) => {
    await migrationSeedApplied(subject, 59);
    await migrationNarrowedRoster(
      subject,
      "project_change",
      "project_change_kind_is_known",
      `kind IN (${schemaTextSet(
        allProjectChangeKinds.filter(
          (kind) => kind !== "AgenticRefusal" && kind !== "Session",
        ),
      )})`,
    );
    const append = (kind: string) =>
      subject.query(
        `SELECT ${projectChangeAppendFunction}('tenant','project',$1,'1')`,
        [kind],
      );
    for (const kind of ["AgenticRefusal", "Session"] as const)
      await assert.rejects(
        () => append(kind),
        /project_change_kind_is_known/u,
        `the log installed with 43 refuses ${kind}`,
      );

    await applyMigration(subject, 59);

    for (const kind of ["AgenticRefusal", "Session"] as const)
      await append(kind);
    assert.deepEqual(
      (await subject.query("SELECT kind FROM project_change ORDER BY sequence"))
        .rows,
      [{ kind: "AgenticRefusal" }, { kind: "Session" }],
    );
    await assert.rejects(
      () => append("Nowhere"),
      /project_change_kind_is_known/u,
      "the widened check is still a check",
    );
  });
});

test("migration 59 widens a failure check installed before the withdrawal existed", async () => {
  await migrationDatabase("lead_decision_failures", async (subject) => {
    await migrationSeedApplied(subject, 59);
    await migrationNarrowedRoster(
      subject,
      "session_turn",
      "session_turn_failure_is_known",
      `failure IS NULL OR failure IN (${schemaTextSet(
        allSessionTurnFailures.filter((failure) => failure !== "TurnWithdrawn"),
      )})`,
    );
    await migrationLeadTurn(subject);
    const withdraw = `UPDATE session_turn
        SET state='Abandoned',failure='TurnWithdrawn',ended_at=now()
      WHERE turn='turn-59'`;
    await assert.rejects(
      () => subject.query(withdraw),
      /session_turn_failure_is_known/u,
      "the mailbox installed with 58 refuses a withdrawal it was created before",
    );

    await applyMigration(subject, 59);

    await subject.query(withdraw);
    assert.deepEqual(
      (await subject.query("SELECT state,failure FROM session_turn")).rows,
      [{ state: "Abandoned", failure: "TurnWithdrawn" }],
    );
    await assert.rejects(
      () =>
        subject.query(
          `UPDATE session_turn SET failure='Nowhere' WHERE turn='turn-59'`,
        ),
      /session_turn_failure_is_known/u,
      "the widened check is still a check",
    );
  });
});

/** Every door 059 opens, beside the one role it is granted to. */
const leadSelectorDoors = [
  "record_agentic_refusals(text,text,text,jsonb,jsonb)",
  "standing_agentic_refusals(text,text,bigint)",
  "lead_session(text,text)",
  "enqueue_lead_turn(text,text,text,text)",
  "read_lead_turn(text)",
  "withdraw_lead_turn(text)",
];
/** The one door both roles hold, which is still a door nobody else may open. */
const leadSharedDoors = [
  "read_selector_interactions(text,text,bigint,bigint,boolean)",
];
const leadApiDoors = [
  "read_agentic_refusals(text,text,bigint,bigint)",
  "read_standing_agentic_refusals(text,text,bigint)",
  "read_selector_planning_intent(text,text)",
  "read_lead_standing(text,text,bigint)",
  "read_lead_store(text,text,text,bigint,bigint)",
  "list_lead_store_streams(text,text,bigint)",
];

/** Nobody but the one role a door is granted to may execute it, `PUBLIC` included. */
async function migrationLeadDoorsAreStrangers(
  executes: (role: string, signature: string) => Promise<boolean | undefined>,
): Promise<void> {
  for (const door of [
    ...leadSelectorDoors,
    ...leadApiDoors,
    ...leadSharedDoors,
  ])
    for (const stranger of ["public", ticketServiceRole, finalizerRole])
      assert.equal(
        await executes(stranger, door),
        false,
        `${stranger} holds nothing on ${door}`,
      );
}

test("migration 59 grants each lead door to exactly one role", async () => {
  await migrationDatabase("lead_grants", async (subject) => {
    await migrationSeedApplied(subject, 60);
    const executes = async (role: string, signature: string) =>
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
          [role, signature],
        )
      ).rows[0]?.granted;
    for (const door of leadSelectorDoors) {
      assert.equal(await executes(selectorServiceRole, door), true, door);
      assert.equal(await executes(apiRole, door), false, door);
    }
    for (const door of leadApiDoors) {
      assert.equal(await executes(apiRole, door), true, door);
      assert.equal(await executes(selectorServiceRole, door), false, door);
    }
    for (const door of leadSharedDoors)
      for (const role of [selectorServiceRole, apiRole])
        assert.equal(
          await executes(role, door),
          true,
          "the console draws the decision log and a fresh lead is seeded from it",
        );
    assert.equal(
      await executes(
        selectorServiceRole,
        "enqueue_session_turn(text,text,text,text,text,text)",
      ),
      false,
      "a role that may name any session may put a turn in a member's thread",
    );
    await migrationLeadDoorsAreStrangers(executes);
    for (const relation of [
      "agent_session",
      "session_turn",
      "session_store_batch",
    ])
      for (const verb of ["SELECT", "INSERT", "UPDATE", "DELETE"])
        assert.equal(
          (
            await subject.query<{ granted: boolean }>(
              "SELECT has_table_privilege($1,$2,$3) AS granted",
              [selectorServiceRole, relation, verb],
            )
          ).rows[0]?.granted,
          false,
          `${selectorServiceRole} reaches ${relation} only through a door`,
        );
    for (const [role, verb] of [
      [selectorServiceRole, "SELECT"],
      [selectorServiceRole, "INSERT"],
      [apiRole, "SELECT"],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'selector_agentic_refusal',$2) AS granted",
            [role, verb],
          )
        ).rows[0]?.granted,
        false,
        `${role} reaches the ledger only through a door`,
      );
  });
});

/** The two limits 059 moves, as the settings row currently holds them. */
async function migrationDecisionLimits(
  subject: pg.Pool,
): Promise<{ readonly tokens: string; readonly duration: string } | undefined> {
  const found = await subject.query<{ tokens: string; duration: string }>(
    `SELECT (controls::jsonb->'limits'->>'tokensPerDecision') AS tokens,
            (controls::jsonb->'limits'->>'millisecondsPerDecision') AS duration
       FROM selector_runtime_settings WHERE singleton=1`,
  );
  return found.rows[0];
}

test("migration 59 raises the seeded decision envelope to a lead turn", async () => {
  await migrationDatabase("lead_limits_raised", async (subject) => {
    await migrationSeedApplied(subject, 59);
    const seeded = await migrationDecisionLimits(subject);
    assert.ok(Number(seeded?.tokens) < leadTokensPerDecision);
    assert.ok(Number(seeded?.duration) < leadMillisecondsPerDecision);

    await applyMigration(subject, 59);

    assert.deepEqual(await migrationDecisionLimits(subject), {
      tokens: String(leadTokensPerDecision),
      duration: String(leadMillisecondsPerDecision),
    });
  });
});

test("migration 59 moves a floor and never a value somebody raised", async () => {
  await migrationDatabase("lead_limits_kept", async (subject) => {
    await migrationSeedApplied(subject, 59);
    const held = leadTokensPerDecision * 2;
    await subject.query(
      `UPDATE selector_runtime_settings
          SET controls=jsonb_set(
                jsonb_set(controls::jsonb,'{limits,tokensPerDecision}',
                  to_jsonb($1::bigint)),
                '{limits,millisecondsPerDecision}',to_jsonb($2::bigint))::text
        WHERE singleton=1`,
      [held, leadMillisecondsPerDecision],
    );

    await applyMigration(subject, 59);

    assert.deepEqual(await migrationDecisionLimits(subject), {
      tokens: String(held),
      duration: String(leadMillisecondsPerDecision),
    });
  });
});

test("migration 59 widens a resource check installed before a session named three things", async () => {
  await migrationDatabase("lead_resource_bound", async (subject) => {
    await migrationSeedApplied(subject, 59);
    await migrationNarrowedRoster(
      subject,
      "project_change",
      "project_change_resource_is_bounded",
      `length(resource) BETWEEN 1 AND ${nativeHttpPathSegmentCharsMax}`,
    );
    const resource = "r".repeat(nativeHttpPathSegmentCharsMax + 1);
    const append = () =>
      subject.query(
        `SELECT ${projectChangeAppendFunction}('tenant','project','Session',$1)`,
        [resource],
      );
    await assert.rejects(
      append,
      /project_change_resource_is_bounded/u,
      "a log installed before a session named three things refuses one that does",
    );

    await applyMigration(subject, 59);

    await append();
    assert.deepEqual(
      (await subject.query("SELECT kind FROM project_change")).rows,
      [{ kind: "Session" }],
    );
    await assert.rejects(
      () =>
        subject.query(
          `SELECT ${projectChangeAppendFunction}('tenant','project','Session',$1)`,
          ["r".repeat(projectChangeResourceCharsMax + 1)],
        ),
      /project_change_resource_is_bounded/u,
      "the widened check is still a check",
    );
  });
});

test("migration 59 widens a turn's input check installed before an observation grew", async () => {
  await migrationDatabase("lead_turn_input", async (subject) => {
    await migrationSeedApplied(subject, 59);
    await migrationNarrowedRoster(
      subject,
      "session_turn",
      "session_turn_text_is_bounded",
      `length(input) BETWEEN 1 AND ${selectorHandoffNoteBytesMax}
         AND coalesce(length(result), 0) <= ${sessionTurnResultCharsMax}`,
    );
    await migrationLeadTurn(subject);
    const widen = `UPDATE session_turn SET input=repeat('o',$1) WHERE turn='turn-59'`;
    await assert.rejects(
      () => subject.query(widen, [selectorHandoffNoteBytesMax + 1]),
      /session_turn_text_is_bounded/u,
      "a mailbox installed before an observation named its parts refuses one",
    );

    await applyMigration(subject, 59);

    await subject.query(widen, [selectorHandoffNoteBytesMax + 1]);
    await assert.rejects(
      () => subject.query(widen, [sessionTurnInputCharsMax + 1]),
      /session_turn_text_is_bounded/u,
      "the widened check is still a check",
    );
  });
});

/** The capabilities a session held before the chuggy tools were admitted by three more. */
const capabilitiesBeforeTheTools = allSessionCapabilities.filter(
  (capability) =>
    capability === "RepositoryRead" ||
    capability === "RepositoryWrite" ||
    capability === "RunCommands",
);

/** One session's capability check, as the server renders it. */
async function migrationCapabilityCheck(
  subject: pg.Pool,
): Promise<string | undefined> {
  return (
    await subject.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
        WHERE c.conrelid = 'agent_session'::regclass
          AND c.conname = 'agent_session_capabilities_are_known'`,
    )
  ).rows[0]?.definition;
}

/**
 * Opens a lead holding one capability, answering whatever the server said. The
 * door takes the objectives only after 061 retypes it, so a case that drove one
 * signature either side of the migration would be reporting a missing function
 * as the refusal it was looking for.
 */
async function migrationOpenHolding(
  subject: pg.Pool,
  capability: string,
  prompted: boolean,
): Promise<void> {
  const store = postgresProjectStore(subject);
  await postgresHarnessEpoch(store);
  const partition = await postgresHarnessProject(
    store,
    `lead-tools-${capability}-${prompted ? "after" : "before"}`,
  );
  await subject.query(
    `SELECT open_agent_session($1,$2,$3,'Lead','principal-61',NULL,
       ARRAY[$4]::text[],'claude-code'${prompted ? ",NULL" : ""})`,
    [
      partition.tenant,
      partition.project,
      `session-61-${capability}-${prompted ? "after" : "before"}`,
      capability,
    ],
  );
}

test("migration 61 widens a capability check installed before these capabilities existed", async () => {
  await migrationDatabase("lead_tool_capabilities", async (subject) => {
    await migrationSeedApplied(subject, 61);
    await migrationNarrowedRoster(
      subject,
      "agent_session",
      "agent_session_capabilities_are_known",
      `cardinality(capabilities) BETWEEN 0 AND ${sessionCapabilitiesMax}
         AND capabilities <@ ARRAY[${schemaTextSet([
           ...capabilitiesBeforeTheTools,
         ])}]::text[]`,
    );
    await assert.rejects(
      () => migrationOpenHolding(subject, "ProjectRead", false),
      /agent_session_capabilities_are_known/u,
      "a session table installed before the chuggy tools refuses their capability",
    );

    await applyMigration(subject, 61);

    for (const capability of ["ProjectRead", "DraftAuthor", "LeadDecision"])
      await migrationOpenHolding(subject, capability, true);
    await assert.rejects(
      () => migrationOpenHolding(subject, "Nowhere", true),
      /agent_session_capabilities_are_known/u,
      "the widened check is still a check",
    );

    await migrationDatabase("lead_tool_fresh", async (fresh) => {
      await migrationSeedApplied(fresh, 62);
      assert.equal(
        await migrationCapabilityCheck(subject),
        await migrationCapabilityCheck(fresh),
        "a migrated database ends with the check a fresh one starts with",
      );
    });
  });
});

/** The two tool controls 061 moves, as the settings row currently holds them. */
async function migrationToolControls(
  subject: pg.Pool,
): Promise<{ readonly allowlist: string; readonly calls: string } | undefined> {
  const found = await subject.query<{ allowlist: string; calls: string }>(
    `SELECT (controls::jsonb->>'toolAllowlist') AS allowlist,
            (controls::jsonb->'limits'->>'toolCallsPerDecision') AS calls
       FROM selector_runtime_settings WHERE singleton=1`,
  );
  return found.rows[0];
}

test("migration 61 narrows an allowlist that admitted everything", async () => {
  await migrationDatabase("lead_tool_allowlist", async (subject) => {
    await migrationSeedApplied(subject, 61);
    const seeded = await migrationToolControls(subject);
    assert.equal(seeded?.allowlist, '["*"]');
    assert.ok(Number(seeded?.calls) < leadToolCallsPerDecision);

    await applyMigration(subject, 61);

    const held = await migrationToolControls(subject);
    assert.deepEqual(JSON.parse(held?.allowlist ?? "[]"), [
      ...leadToolAllowlist,
    ]);
    assert.equal(held?.calls, String(leadToolCallsPerDecision));
    assert.deepEqual(
      (
        await subject.query<{ revisions: string }>(
          `SELECT count(*)::text AS revisions
             FROM selector_runtime_settings_history h
             JOIN selector_runtime_settings s ON s.revision=h.revision`,
        )
      ).rows,
      [{ revisions: "1" }],
      "the revision the narrowing mints is recorded like every other",
    );
  });
});

test("migration 61 never overwrites an allowlist somebody wrote", async () => {
  await migrationDatabase("lead_tool_allowlist_kept", async (subject) => {
    await migrationSeedApplied(subject, 61);
    const held = leadToolCallsPerDecision * 2;
    await subject.query(
      `UPDATE selector_runtime_settings
          SET controls=jsonb_set(
                jsonb_set(controls::jsonb,'{toolAllowlist}','["Read"]'::jsonb),
                '{limits,toolCallsPerDecision}',to_jsonb($1::bigint))::text
        WHERE singleton=1`,
      [held],
    );

    await applyMigration(subject, 61);

    assert.deepEqual(await migrationToolControls(subject), {
      allowlist: '["Read"]',
      calls: String(held),
    });
  });
});

test("migration 61 moves the call bound as a floor, even where it narrows beside it", async () => {
  await migrationDatabase("lead_tool_calls_kept", async (subject) => {
    await migrationSeedApplied(subject, 61);
    const held = leadToolCallsPerDecision * 2;
    await subject.query(
      `UPDATE selector_runtime_settings
          SET controls=jsonb_set(controls::jsonb,
                '{limits,toolCallsPerDecision}',to_jsonb($1::bigint))::text
        WHERE singleton=1`,
      [held],
    );

    await applyMigration(subject, 61);

    const moved = await migrationToolControls(subject);
    assert.deepEqual(JSON.parse(moved?.allowlist ?? "[]"), [
      ...leadToolAllowlist,
    ]);
    assert.equal(
      moved?.calls,
      String(held),
      "the row the narrowing writes keeps a bound somebody raised",
    );
  });
});

test("the objectives column holds the widest ceiling any kind of session composes", async () => {
  await migrationDatabase("lead_tool_prompt_bound", async (subject) => {
    await migrationSeedApplied(subject, 62);
    const held = (
      await subject.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
          WHERE c.conrelid = 'agent_session'::regclass
            AND c.conname = 'agent_session_prompt_is_bounded'`,
      )
    ).rows[0]?.definition;
    for (const ceiling of sessionPromptCeilings)
      assert.ok(
        ceiling <= agentSessionPromptCharsMax,
        "the column holds every kind's own ceiling",
      );
    assert.ok(
      held?.includes(String(agentSessionPromptCharsMax)),
      "a kind with a wider ceiling widens this, and its migration replaces the check",
    );
  });
});

test("migration 61 leaves a session that was opened before it had objectives", async () => {
  await migrationDatabase("lead_tool_prompt", async (subject) => {
    await migrationSeedApplied(subject, 61);
    await migrationLeadTurn(subject);

    await applyMigration(subject, 61);

    assert.deepEqual(
      (
        await subject.query(
          "SELECT system_prompt FROM agent_session WHERE session='session-59'",
        )
      ).rows,
      [{ system_prompt: null }],
      "a session opened before the column existed holds no objectives",
    );
    assert.deepEqual(
      (
        await subject.query<{ prompted: string }>(
          `SELECT set_session_system_prompt(s.tenant,s.project,'objectives')
             AS prompted FROM agent_session s WHERE s.session='session-59'`,
        )
      ).rows,
      [{ prompted: "Set" }],
      "and takes them when the selector next offers a turn",
    );
  });
});

test("the session migrations compose into the schema a fresh generation renders", async () => {
  await migrationDatabase("lead_composition", async (subject) => {
    await migrationSeedApplied(subject, 62);
    const definition = async (relation: string, constraint: string) =>
      (
        await subject.query<{ definition: string }>(
          `SELECT pg_get_constraintdef(c.oid) AS definition
             FROM pg_constraint c
            WHERE c.conrelid = $1::regclass AND c.conname = $2`,
          [relation, constraint],
        )
      ).rows[0]?.definition;

    const members = async (relation: string, constraint: string) => {
      const held = await definition(relation, constraint);
      assert.ok(held !== undefined, `${constraint} was not found`);
      return [...held.matchAll(/'([^']+)'::text/gu)].map((each) => each[1]);
    };

    assert.deepEqual(
      await members("project_change", "project_change_kind_is_known"),
      [...allProjectChangeKinds],
      "the kind roster 043 wrote and 059 replaced is the roster on main",
    );
    assert.deepEqual(
      await members("session_turn", "session_turn_failure_is_known"),
      [...allSessionTurnFailures],
      "the failure roster 058 wrote and 059 replaced is the roster on main",
    );
    assert.deepEqual(
      await members("session_attempt", "session_attempt_evidence_is_known"),
      [...allSessionAttemptEvidences],
      "the evidence roster 058 wrote and 060 replaced is the roster on main",
    );
    assert.deepEqual(
      await members("agent_session", "agent_session_capabilities_are_known"),
      [...allSessionCapabilities],
      "the capability roster 058 wrote and 061 replaced is the roster on main",
    );
    for (const [relation, constraint, bound] of [
      [
        "project_change",
        "project_change_resource_is_bounded",
        projectChangeResourceCharsMax,
      ],
      [
        "session_turn",
        "session_turn_identity_is_bounded",
        sessionIdentityCharsMax,
      ],
    ] as const) {
      const held = await definition(relation, constraint);
      assert.ok(held?.includes(String(bound)), `${constraint} holds its bound`);
    }
    const input = await definition(
      "session_turn",
      "session_turn_text_is_bounded",
    );
    assert.ok(input?.includes(String(sessionTurnInputCharsMax)));
    assert.ok(input?.includes(String(sessionTurnResultCharsMax)));
  });
});

test("the ledger the api image reads accepts what the session migrations applied", async () => {
  await migrationDatabase("lead_ledger", async (subject) => {
    await migrationSeedApplied(subject, 63);
    const applied = await postgresRuntimeSchema(subject).applied(
      new AbortController().signal,
    );
    assert.equal(
      applied.length,
      Math.max(...applied.map((each) => each.version)),
      "the ledger holds one row per version with no gap and no repeat",
    );
    assert.deepEqual(
      applied.map((each) => each.version).slice(-5),
      [58, 59, 60, 61, 62],
      "the five apply in the order their filenames give them",
    );
    assert.ok(
      schemaContractAccepts(currentRuntimeSchemaContract, applied),
      "the prefix an api image requires is the prefix these three leave",
    );
  });
});

/** The capabilities a session held before a member's thread could originate a draft. */
const capabilitiesBeforeThreads = allSessionCapabilities.filter(
  (capability) => capability !== "DraftOriginate",
);

/** Whether one function signature exists on this database at all. */
async function migrationHasFunction(
  subject: pg.Pool,
  signature: string,
): Promise<boolean> {
  const found = await subject.query<{ present: boolean }>(
    `SELECT to_regprocedure($1) IS NOT NULL AS present`,
    [signature],
  );
  return found.rows[0]?.present === true;
}

test("migration 62 widens a capability check installed before origination existed", async () => {
  await migrationDatabase("thread_capabilities", async (subject) => {
    await migrationSeedApplied(subject, 62);
    await migrationNarrowedRoster(
      subject,
      "agent_session",
      "agent_session_capabilities_are_known",
      `cardinality(capabilities) BETWEEN 0 AND ${sessionCapabilitiesMax}
         AND capabilities <@ ARRAY[${schemaTextSet([
           ...capabilitiesBeforeThreads,
         ])}]::text[]`,
    );
    await assert.rejects(
      () => migrationOpenHolding(subject, "DraftOriginate", true),
      /agent_session_capabilities_are_known/u,
      "a session table installed before threads refuses the roster one is opened with",
    );

    await applyMigration(subject, 62);

    await migrationOpenHolding(subject, "DraftOriginate", true);
    await assert.rejects(
      () => migrationOpenHolding(subject, "Nowhere", true),
      /agent_session_capabilities_are_known/u,
      "the widened check is still a check",
    );

    await migrationDatabase("thread_capabilities_fresh", async (fresh) => {
      await migrationSeedApplied(fresh, 63);
      assert.equal(
        await migrationCapabilityCheck(subject),
        await migrationCapabilityCheck(fresh),
        "a migrated database ends with the check a fresh one starts with",
      );
    });
  });
});

test("migration 62 retires the lead-only store reads for the session-keyed pair", async () => {
  await migrationDatabase("thread_store_reads", async (subject) => {
    await migrationSeedApplied(subject, 62);
    const leadBatches = "read_lead_store(text,text,text,bigint,bigint)";
    const leadStreams = "list_lead_store_streams(text,text,bigint)";
    const sessionBatches =
      "read_session_store_batches(text,text,text,text,bigint,bigint)";
    const sessionStreams = "list_session_store_streams(text,text,text,bigint)";
    assert.equal(await migrationHasFunction(subject, leadBatches), true);
    assert.equal(await migrationHasFunction(subject, sessionBatches), false);

    await applyMigration(subject, 62);

    assert.equal(
      await migrationHasFunction(subject, leadBatches),
      false,
      "a read kept beside its replacement is a read a fix lands in one of",
    );
    assert.equal(await migrationHasFunction(subject, leadStreams), false);
    assert.equal(await migrationHasFunction(subject, sessionBatches), true);
    assert.equal(await migrationHasFunction(subject, sessionStreams), true);
  });
});
