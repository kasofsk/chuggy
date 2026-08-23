import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  migrationLedger,
  migrations,
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
] as const;
const publishingImageRequired = [
  ...retainedImageRequired,
  { version: 16, name: "runtime schema readiness" },
] as const;
const retainedImageContract = runtimeSchemaContract(publishingImageRequired, [
  ...publishingImageRequired,
  { version: 17, name: "selector context account read" },
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
      { version: 17, name: "unknown migration" },
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
    [{ version: 16 }],
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
      { migrated: "Applied", versions: [17] },
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
  await migrationDatabase("failing", async (subject, url) => {
    await migrationSeedApplied(subject, declaredLatest);
    await subject.query(
      "ALTER FUNCTION project_capacity_account(text,text) RENAME TO project_capacity_account_renamed",
    );
    const run = await migrationCommandRun(url);
    assert.equal(run.code, 1);
    assert.match(run.report, /project_capacity_account/u);
    assert.equal(
      (
        await subject.query<{ latest: number | null }>(
          "SELECT max(version) AS latest FROM schema_migration",
        )
      ).rows[0]?.latest,
      declaredLatest - 1,
    );
  });
});
