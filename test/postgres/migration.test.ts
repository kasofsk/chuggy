import { leadToolAllowlist } from "../../src/interpreter/leadTools.ts";
import {
  leadDispatchesPerDecision,
  leadObservationTokensPerDecision,
} from "../../src/adapters/postgres/schema/migrations/baseline/seed.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  draftReviseFunction,
  finalizerRole,
  migrations,
  migrationLedger,
  projectChangeAppendFunction,
  projectChangeRetainedFunction,
  projectChangeSweepFunction,
  repositoryBindingListFunction,
  repositoryBindingWriteFunction,
  repositoryLandingReadFunction,
  repositoryLandingWriteFunction,
  repositoryRetirementWriteFunction,
  schedulerRole,
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
} from "../../src/adapters/postgres/runtimeSchema.ts";
import {
  agentSessionPromptCharsMax,
  projectChangeResourceCharsMax,
  sessionIdentityCharsMax,
  sessionPromptCeilings,
  sessionTurnInputCharsMax,
  sessionTurnResultCharsMax,
} from "../../src/contract/http.ts";
import { allSessionCapabilities } from "../../src/interpreter/agentSession.ts";
import { allSessionTurnFailures } from "../../src/interpreter/agentSession.ts";
import { allSessionAttemptEvidences } from "../../src/interpreter/sessionScheduler.ts";
import { allProjectChangeKinds } from "../../src/interpreter/projectChange.ts";
import { schemaCompatibilityPrecondition } from "../../src/interpreter/serviceRuntime.ts";
import { postgresHarnessUrl } from "./harness.ts";
import type pg from "pg";

function databaseUrl(database: string): string {
  const url = new URL(postgresHarnessUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

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

async function migrationCommandRun(
  url: string,
): Promise<{ readonly code: number; readonly report: string }> {
  const run = promisify(execFile)(
    process.execPath,
    ["--experimental-strip-types", "src/roots/migrate.ts"],
    {
      cwd: process.cwd(),
      env: {
        CHUG_MIGRATE_DATABASE_URL: url,
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

const appendCall = `${projectChangeAppendFunction}(text,text,text,text)`;

const projectChangeExecutors = [
  [schedulerRole, appendCall, true],
  [finalizerRole, appendCall, false],
  [apiRole, appendCall, false],
  [ticketServiceRole, appendCall, true],
  [apiRole, `${projectChangeSweepFunction}(bigint)`, true],
  [apiRole, `${projectChangeRetainedFunction}(bigint)`, true],
  [schedulerRole, `${projectChangeSweepFunction}(bigint)`, false],
  [finalizerRole, `${projectChangeSweepFunction}(bigint)`, false],
] as const;

const projectChangeApiPrivileges = [
  ["SELECT", true],
  ["INSERT", false],
  ["UPDATE", false],
  ["DELETE", false],
] as const;

test("the baseline grants the change log's doors to the roles that reach them", async () => {
  await migrationDatabase("project_change_grants", async (subject) => {
    await postgresMigrate(subject);
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

test("the baseline opens the brief's doors to the roles that reach it and no others", async () => {
  await migrationDatabase("ticket_brief_grants", async (subject) => {
    await postgresMigrate(subject);
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

const journalInstantsColumns = [
  "tenant",
  "project",
  "seq",
  "entry",
  "committed_at",
];

test("the baseline opens five journal columns to the API and leaves the rest shut", async () => {
  await migrationDatabase("journal_instants_grants", async (subject) => {
    await postgresMigrate(subject);
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





const leadSelectorDoorsPaged = "standing_agentic_refusals(text,text,bigint)";

const leadSelectorDoorsAdded = [
  "standing_agentic_refusals_among(text,text,bigint[])",
];

function migrationDoorExecutes(
  subject: pg.Pool,
): (role: string, signature: string) => Promise<boolean | undefined> {
  return async (role, signature) =>
    (
      await subject.query<{ granted: boolean }>(
        "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
        [role, signature],
      )
    ).rows[0]?.granted;
}

async function migrationLeadDoorsAreStrangers(
  executes: (role: string, signature: string) => Promise<boolean | undefined>,
  doors: readonly string[],
): Promise<void> {
  for (const door of doors)
    for (const stranger of ["public", ticketServiceRole, finalizerRole])
      assert.equal(
        await executes(stranger, door),
        false,
        `${stranger} holds nothing on ${door}`,
      );
}

test("the objectives column holds the widest ceiling any kind of session composes", async () => {
  await migrationDatabase("lead_tool_prompt_bound", async (subject) => {
    await postgresMigrate(subject);
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

test("the installed session constraints match the runtime", async () => {
  await migrationDatabase("lead_composition", async (subject) => {
    await postgresMigrate(subject);
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
      "the installed roster matches the runtime",
    );
    assert.deepEqual(
      await members("session_turn", "session_turn_failure_is_known"),
      [...allSessionTurnFailures],
      "the installed roster matches the runtime",
    );
    assert.deepEqual(
      await members("session_attempt", "session_attempt_evidence_is_known"),
      [...allSessionAttemptEvidences],
      "the installed roster matches the runtime",
    );
    assert.deepEqual(
      await members("agent_session", "agent_session_capabilities_are_known"),
      [...allSessionCapabilities],
      "the installed roster matches the runtime",
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

test("the baseline retires the lead-only store reads for the session-keyed pair", async () => {
  await migrationDatabase("thread_store_reads", async (subject) => {
    await postgresMigrate(subject);
    const leadBatches = "read_lead_store(text,text,text,bigint,bigint)";
    const leadStreams = "list_lead_store_streams(text,text,bigint)";
    const sessionBatches =
      "read_session_store_batches(text,text,text,text,bigint,bigint)";
    const sessionStreams = "list_session_store_streams(text,text,text,bigint)";

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

test("the baseline grants the ticket-set standing door to the selector alone", async () => {
  await migrationDatabase("standing_among_grants", async (subject) => {
    await postgresMigrate(subject);
    const executes = migrationDoorExecutes(subject);
    for (const door of leadSelectorDoorsAdded) {
      assert.equal(await executes(selectorServiceRole, door), true, door);
      assert.equal(await executes(apiRole, door), false, door);
    }
    await migrationLeadDoorsAreStrangers(executes, leadSelectorDoorsAdded);
  });
});

test("the baseline takes the paged standing back off the selector", async () => {
  await migrationDatabase("standing_paged_revoked", async (subject) => {
    await postgresMigrate(subject);
    const executes = migrationDoorExecutes(subject);
    assert.equal(
      await executes(selectorServiceRole, leadSelectorDoorsPaged),
      false,
      "no selector read opens it, and a grant nothing opens is one a check cannot tell from a grant something needs",
    );
    assert.equal(
      await executes(
        apiRole,
        "read_standing_agentic_refusals(text,text,bigint)",
      ),
      true,
      "the console still draws a project's standing refusals",
    );
  });
});

test("the table and the function project access was answered from are gone", async () => {
  await migrationDatabase("i83", async (subject) => {
    await postgresMigrate(subject);
    const left = await subject.query<{
      readonly table_left: string | null;
      readonly function_left: string | null;
    }>(
      `SELECT to_regclass('project_membership')::text AS table_left,
              to_regprocedure('authorize_project_access(text,text,text,text)')::text AS function_left`,
    );
    assert.equal(
      left.rows[0]?.table_left,
      null,
      "project_membership is still there",
    );
    assert.equal(
      left.rows[0]?.function_left,
      null,
      "authorize_project_access is still there",
    );
  });
});

async function seedLandinglessBinding(subject: pg.Pool): Promise<void> {
  await subject.query(`INSERT INTO recovery_epoch(epoch) VALUES('epoch-90')`);
  await subject.query(
    `INSERT INTO project(tenant,project,lifecycle,head,ingress_next)
     VALUES('tenant-90','project-90','Active',0,1)`,
  );
  await subject.query(
    `INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
     VALUES('tenant-90','project-90','bound-90','epoch-90')`,
  );
}

test("the landing doors migrate without exposing the relation they read", async () => {
  await migrationDatabase("i90grants", async (subject) => {
    await postgresMigrate(subject);
    for (const signature of [
      `${repositoryLandingReadFunction}(text,text,text)`,
      `${repositoryLandingWriteFunction}(text,text,text,text,text)`,
    ])
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
    for (const privilege of ["SELECT", "UPDATE", "DELETE"])
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'project_repository',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        false,
        privilege,
      );
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_column_privilege($1,'project_repository','landing_mode','UPDATE') AS granted",
          [boundaryOwnerRole],
        )
      ).rows[0]?.granted,
      true,
    );
  });
});

test("a landing no roster names is refused by the column's own constraint", async () => {
  await migrationDatabase("i90roster", async (subject) => {
    await postgresMigrate(subject);
    await seedLandinglessBinding(subject);
    for (const mode of ["Push", "PullRequest", "PullRequestMerge"])
      await subject.query(
        `UPDATE project_repository SET landing_mode=$1
          WHERE tenant='tenant-90' AND project='project-90'`,
        [mode],
      );
    await assert.rejects(
      subject.query(
        `UPDATE project_repository SET landing_mode='Unknown'
          WHERE tenant='tenant-90' AND project='project-90'`,
      ),
      /project_repository_landing_mode_is_known/u,
      "the installed CHECK rejects an unknown landing mode",
    );
  });
});







async function assertDoorsStandOwned(
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

test("the draft doors are owned and granted to their callers", async () => {
  await migrationDatabase("i91grants", async (subject) => {
    await postgresMigrate(subject);
    await assertDoorsStandOwned(subject, [
      `${draftCreateFunction}(text,text,text,text,bigint,text,text,text,text[],text[],text,text,text,text,text,text)`,
      `${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text,text[],text[],text,text,text,text,text,text)`,
    ]);
  });
});

test("repository doors preserve their ownership and restricted grants", async () => {
  await migrationDatabase("i94grants", async (subject) => {
    await postgresMigrate(subject);
    await assertDoorsStandOwned(subject, [
      `${repositoryRetirementWriteFunction}(text,text,text)`,
      `${repositoryBindingListFunction}(text,text,bigint)`,
      `${repositoryLandingReadFunction}(text,text,text)`,
      `${repositoryLandingWriteFunction}(text,text,text,text,text)`,
      `${repositoryBindingWriteFunction}(text,text,text,text,text,text,text)`,
      `${draftCreateFunction}(text,text,text,text,bigint,text,text,text,text[],text[],text,text,text,text,text,text)`,
      `${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text,text[],text[],text,text,text,text,text,text)`,
    ]);
    for (const privilege of ["SELECT", "UPDATE", "DELETE"])
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'project_repository',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        false,
        privilege,
      );
    for (const [role, column, held] of [
      [boundaryOwnerRole, "retired_at", true],
      [boundaryOwnerRole, "landing_mode", true],
      [boundaryOwnerRole, "bound_at", false],
      [apiRole, "retired_at", false],
      [apiRole, "landing_mode", false],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_column_privilege($1,'project_repository',$2,'UPDATE') AS granted",
            [role, column],
          )
        ).rows[0]?.granted,
        held,
        `${role}: ${column}`,
      );
  });
});

test("concurrent migration callers install the baseline once", async () => {
  await migrationDatabase("concurrent", async (subject) => {
    const results = await Promise.all([
      postgresMigrate(subject),
      postgresMigrate(subject),
    ]);
    assert.deepEqual(
      results.flat(),
      migrations.map(({ version }) => version),
    );
    assert.ok(results.some((versions) => versions.length === 0));
    assert.deepEqual(
      await postgresRuntimeSchema(subject).applied(
        new AbortController().signal,
      ),
      currentRuntimeSchemaContract.required,
    );
  });
});

test("historical, divergent and future ledgers are refused untouched by both runners", async () => {
  for (const applied of [
    [
      { version: 1, name: "the project foundation" },
      { version: 94, name: "a binding is retired" },
    ],
    [{ version: 1, name: "another baseline" }],
    [
      ...currentRuntimeSchemaContract.required,
      { version: 999, name: "future" },
    ],
  ]) {
    await migrationDatabase("foreign", async (subject, url) => {
      await subject.query(migrationLedger);
      for (const row of applied)
        await subject.query(
          "INSERT INTO schema_migration(version,name) VALUES($1,$2)",
          [row.version, row.name],
        );
      const run = await migrationCommandRun(url);
      assert.equal(run.code, 2);
      await assert.rejects(postgresMigrate(subject), /incompatible/u);
      assert.deepEqual(
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        ),
        applied,
      );
      assert.equal(
        (
          await subject.query<{ relation: string | null }>(
            "SELECT to_regclass('installation_authority') AS relation",
          )
        ).rows[0]?.relation,
        null,
      );
    });
  }
});

test("an incompatible rollout leaves an empty database untouched", async () => {
  await migrationDatabase("rollout", async (subject) => {
    const incompatible = {
      required: [{ version: 1, name: "the project foundation" }],
      compatible: [{ version: 1, name: "the project foundation" }],
    };
    assert.deepEqual(
      await postgresMigrateCompatible(subject, {
        current: currentRuntimeSchemaContract,
        retainedPrevious: incompatible,
      }),
      { migrated: "CouldNotRun" },
    );
    assert.deepEqual(
      (await subject.query("SELECT to_regclass('schema_migration') AS ledger"))
        .rows,
      [{ ledger: null }],
    );
  });
});

test("a failed baseline rolls back its objects and ledger and can be retried", async () => {
  await migrationDatabase("rollback", async (subject, url) => {
    await subject.query("CREATE TABLE installation_authority (sentinel text)");
    await subject.query(
      "INSERT INTO installation_authority VALUES ('untouched')",
    );
    const run = await migrationCommandRun(url);
    assert.equal(run.code, 1);
    assert.match(run.report, /installation_authority/u);
    assert.deepEqual(
      (
        await subject.query(
          "SELECT to_regclass('schema_migration') AS ledger, to_regclass('agent_session') AS relation, to_regprocedure('command_integer(jsonb)') AS function",
        )
      ).rows,
      [{ ledger: null, relation: null, function: null }],
    );
    assert.deepEqual(
      (await subject.query("SELECT * FROM installation_authority")).rows,
      [{ sentinel: "untouched" }],
    );
    await subject.query("DROP TABLE installation_authority");
    assert.equal((await migrationCommandRun(url)).code, 0);
  });
});

test("fresh selector settings carry current controls and only their initial history", async () => {
  await migrationDatabase("defaults", async (subject) => {
    await postgresMigrate(subject);
    const current = (
      await subject.query<{
        revision: string;
        mode: string;
        dispatch_mode: string;
        controls: string;
      }>(
        "SELECT revision::text,mode,dispatch_mode,controls FROM selector_runtime_settings",
      )
    ).rows[0];
    assert.ok(current !== undefined);
    assert.equal(current.revision, "1");
    assert.equal(current.mode, "Running");
    assert.equal(current.dispatch_mode, "ApprovalRequired");
    const controls = JSON.parse(current.controls) as {
      toolAllowlist: readonly string[];
      limits: { tokensPerDecision: number; dispatchesPerDecision: number };
    };
    assert.deepEqual(controls.toolAllowlist, leadToolAllowlist);
    assert.equal(
      controls.limits.tokensPerDecision,
      leadObservationTokensPerDecision,
    );
    assert.equal(
      controls.limits.dispatchesPerDecision,
      leadDispatchesPerDecision,
    );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT revision::text,mode,dispatch_mode,controls FROM selector_runtime_settings_history",
        )
      ).rows,
      [current],
    );
  });
});
