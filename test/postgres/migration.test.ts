import { leadToolAllowlist } from "../../src/interpreter/leadTools.ts";
import { migration003 } from "../../src/adapters/postgres/schema/migrations/003-no-handoff.ts";
import {
  leadObservationTokensPerDecisionAt004,
  migration004,
} from "../../src/adapters/postgres/schema/migrations/004-no-accounts.ts";
import {
  leadObservationTokensPerDecisionAt005,
  migration005,
} from "../../src/adapters/postgres/schema/migrations/005-three-deletions.ts";
import { migration006 } from "../../src/adapters/postgres/schema/migrations/006-rename.ts";
import { migration007 } from "../../src/adapters/postgres/schema/migrations/007-finalization-unavailable.ts";
import { encodeDispatchProgram } from "../../src/interpreter/dispatchView.ts";
import type { StageDefinition } from "../../src/domain/generated/modelTypes.ts";
import { leadDispatchesPerDecision } from "../../src/adapters/postgres/schema/migrations/baseline/seed.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  acceptanceFunction,
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  draftReviseFunction,
  finalizationFunction,
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
  runtimeSchemaContract,
} from "../../src/adapters/postgres/runtimeSchema.ts";
import {
  agentSessionPromptCharsMax,
  projectChangeResourceCharsMax,
  sessionIdentityCharsMax,
  sessionPromptCeilings,
  sessionTurnInputCharsMax,
  sessionTurnResultCharsMax,
} from "../../src/contract/http.ts";
import { briefFinalizationDefault } from "../../src/interpreter/ticketBrief.ts";
import { allSessionCapabilities } from "../../src/interpreter/agentSession.ts";
import { allSessionTurnFailures } from "../../src/interpreter/agentSession.ts";
import { allSessionAttemptEvidences } from "../../src/interpreter/sessionScheduler.ts";
import { allProjectChangeKinds } from "../../src/interpreter/projectChange.ts";
import { allFinalizationHoldKinds } from "../../src/interpreter/finalizer.ts";
import { schemaCompatibilityPrecondition } from "../../src/interpreter/serviceRuntime.ts";
import { postgresHarnessUrl } from "./harness.ts";
import type pg from "pg";
import { postgresHarnessEpoch, postgresHarnessProject } from "./harness.ts";
import { postgresProjectStore } from "../../src/adapters/postgres/projectStore.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { encodeDraftAuthoring } from "../../src/interpreter/authoring.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import { postgresDomainConfigurationPrecondition } from "../../src/adapters/postgres/domainConfiguration.ts";
import type { ProjectRead } from "../../src/interpreter/nativeWeb.ts";

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

const journalInstantsReleases = 400;

const journalInstantsEvents = [
  "ReleaseTicket",
  "TaskDone",
  "FinalizationResult",
];

function releasedPage(read: ProjectRead): readonly (string | undefined)[] {
  if (read.result !== "Found")
    throw new Error("migration case: the project has no page");
  return read.project.tickets.map((ticket) => ticket.releasedAt);
}

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

test("the baseline's index is what answers every read of a ticket's release", async () => {
  await migrationDatabase("journal_instants_index", async (subject, url) => {
    await postgresMigrate(subject);
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

async function seedProposingBinding(subject: pg.Pool): Promise<void> {
  await subject.query(`INSERT INTO recovery_epoch(epoch) VALUES('epoch-91')`);
  await subject.query(
    `INSERT INTO project(tenant,project,lifecycle,head,ingress_next,ticket_next)
     VALUES('tenant-91','project-91','Active',0,1,1)`,
  );
  await subject.query(
    `INSERT INTO project_repository(tenant,project,repository,recovery_epoch,landing_mode)
     VALUES('tenant-91','project-91','bound-91','epoch-91','PullRequest')`,
  );
  await subject.query(
    `INSERT INTO configuration_revision
       (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
     VALUES('tenant-91','project-91','revision-91','{}','digest-91','User','author')`,
  );
}

async function createdProposingDraft(subject: pg.Pool, branch: string | null) {
  return (
    await subject.query<{ result: string; ticket: string | null }>(
      `SELECT result,ticket::text AS ticket FROM ${draftCreateFunction}(
         'tenant-91','project-91','revision-91','digest-91',0,$1,
         NULL,'Land it.','{}'::text[],'{}'::text[],$2,NULL,NULL,'bound-91','User','author')`,
      [encodeDraftAuthoring(plainAuthoring), branch],
    )
  ).rows;
}

async function createdUnboundDraft(subject: pg.Pool) {
  return (
    await subject.query<{ result: string }>(
      `SELECT result FROM ${draftCreateFunction}(
         'tenant-91','project-91','revision-91','digest-91',0,$1,
         NULL,'Land it.','{}'::text[],'{}'::text[],NULL,NULL,NULL,NULL,'User','author')`,
      [encodeDraftAuthoring(plainAuthoring)],
    )
  ).rows;
}

test("the draft door falls back to the landing this tree defaults to", async () => {
  assert.equal(briefFinalizationDefault.mode, "Push");
  await migrationDatabase("i91fallback", async (subject) => {
    await postgresMigrate(subject);
    await seedProposingBinding(subject);
    assert.deepEqual(await createdUnboundDraft(subject), [
      { result: "Created" },
    ]);
    assert.deepEqual(
      (
        await subject.query<{ finalization_mode: string }>(
          `SELECT finalization_mode FROM draft_brief`,
        )
      ).rows,
      [{ finalization_mode: briefFinalizationDefault.mode }],
    );
  });
});

test("the baseline's door refuses the brief its own resolution left with no head", async () => {
  await migrationDatabase("i91unbranched", async (subject) => {
    await postgresMigrate(subject);
    await seedProposingBinding(subject);

    assert.deepEqual(await createdProposingDraft(subject, null), [
      { result: "LandingUnbranched", ticket: null },
    ]);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT ticket FROM draft WHERE tenant='tenant-91' AND project='project-91'`,
        )
      ).rows,
      [],
      "a refused brief mints no ticket",
    );
  });
});

test("a pull request may default its base but requires a distinct head", async () => {
  await migrationDatabase("i91pairing", async (subject) => {
    await postgresMigrate(subject);
    await seedProposingBinding(subject);

    const created = await createdProposingDraft(subject, "refs/heads/rt/work");
    assert.equal(created[0]?.result, "Created");
    for (const [written, why] of [
      ["branch=NULL", "names no branch to open from"],
      ["finalization_target=branch", "opens from its own base"],
    ] as const)
      await assert.rejects(
        subject.query(
          `UPDATE draft_brief SET ${written}
            WHERE tenant='tenant-91' AND project='project-91'`,
        ),
        /draft_brief_finalization_is_whole/u,
        `no pull request ${why}`,
      );
    await subject.query(
      `UPDATE draft_brief SET finalization_target='refs/heads/rt/landing'
        WHERE tenant='tenant-91' AND project='project-91'`,
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
      leadObservationTokensPerDecisionAt005,
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

/**
 * One insert per narrowed constraint a row can reach, each carrying the
 * literal that constraint used to admit.
 * `native_action_kind_names_its_capability` has no reachable row of its own,
 * because PostgreSQL evaluates a relation's checks in name order and
 * `native_action_kind_is_known` refuses `HandoffBlock` first.
 */
const handoffLiterals: readonly (readonly [string, string])[] = [
  [
    "ticket_projection_phase_is_known",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
     VALUES('tenant-3','project-3',1,'PublishingHandoff',1)`,
  ],
  [
    "ticket_projection_resume_is_known",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,resume_at)
     VALUES('tenant-3','project-3',1,'Work',1,'ResumePublishingHandoff')`,
  ],
  [
    "project_continuation_expected_phase_check",
    `INSERT INTO project_continuation
       (tenant,project,continuation,kind,authorizing_seq,effect_position,
        ticket,expected_ticket_version,expected_phase,task_set_generation)
     VALUES('tenant-3','project-3','continuation-3','ReduceWork',1,0,1,1,'HandoffBlocked',1)`,
  ],
  [
    "finalization_request_kind_is_known",
    `INSERT INTO finalization_request
       (tenant,project,request,authorizing_seq,effect_position,
        ticket,ticket_version,request_generation,kind)
     VALUES('tenant-3','project-3','request-3',1,0,1,1,1,'PromoteForHandoff')`,
  ],
  [
    "native_action_kind_is_known",
    `INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,
        ticket,action_version,kind,reason,required_capability)
     VALUES('tenant-3','project-3','action-3',1,0,1,1,'HandoffBlock','NoReason','ResolveTicket')`,
  ],
  [
    "native_action_resolution_is_known",
    `INSERT INTO native_action_resolution(tenant,project,action,resolution)
     VALUES('tenant-3','project-3','action-3','RetryHandoff')`,
  ],
];

test("a fresh install records the handoff removal and keeps none of its objects", async () => {
  await migrationDatabase("nohandoff_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration003.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration003.version],
        )
      ).rows,
      [
        {
          version: migration003.version,
          name: "the handoff phases leave the schema",
        },
      ],
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT to_regclass('finalization_request_configuration')::text AS table_left,
                  to_regprocedure('read_accepted_handoff_promotion(text,text,bigint)')::text AS promotion_left,
                  to_regprocedure('finalization_request_configuration_is_written_once()')::text AS trigger_left`,
        )
      ).rows,
      [{ table_left: null, promotion_left: null, trigger_left: null }],
    );
  });
});

test("every narrowed constraint a row can reach refuses the literal the handoff phases left it", async () => {
  await migrationDatabase("nohandoff_checks", async (subject) => {
    await postgresMigrate(subject);
    /**
     * The pairing trigger runs before the row is checked and would refuse a
     * handoff resolution first, so it stands aside for its own constraint.
     */
    await subject.query(
      `ALTER TABLE native_action_resolution
       DISABLE TRIGGER native_action_resolution_pairs_with_its_kind`,
    );
    for (const [constraint, refused] of handoffLiterals)
      await assert.rejects(
        subject.query(refused),
        new RegExp(constraint, "u"),
        constraint,
      );
  });
});

test("the boundary admits neither a handoff outcome nor a handoff resolution", async () => {
  await migrationDatabase("nohandoff_boundary", async (subject) => {
    await postgresMigrate(subject);
    await assert.rejects(
      subject.query(
        `SELECT * FROM ${finalizationFunction}(
           'tenant-3','project-3','request-3','attempt-3','PromotionAccepted',
           NULL,1,'epoch-3','operation-3','finalizer')`,
      ),
      /PromotionAccepted is not one this boundary submits/u,
    );
    const resolution = JSON.stringify({
      version: 1,
      command: "ResolveNativeAction",
      action: "action-3",
      authorizingSeq: 1,
      resolution: "RetryHandoff",
    });
    assert.deepEqual(
      (
        await subject.query<{ admitted: boolean }>(
          "SELECT public_ticket_command_is_valid($1::jsonb) AS admitted",
          [resolution],
        )
      ).rows,
      [{ admitted: false }],
    );
    assert.deepEqual(
      (
        await subject.query<{ result: string }>(
          `SELECT result FROM ${acceptanceFunction}(
             'tenant-3','project-3','operation-3','User','author','v1',
             'key-3','payload-3','{}'::text[],'{}'::text[],$1,10,20,NULL)`,
          [resolution],
        )
      ).rows,
      [{ result: "InvalidCommand" }],
    );
  });
});

test("a ticket still in a handoff phase refuses the migration untouched", async () => {
  await migrationDatabase("nohandoff_guard", async (subject) => {
    const before = migrations
      .slice(0, migration003.version - 1)
      .map(({ version, name }) => ({ version, name }));
    const held = runtimeSchemaContract(before);
    assert.deepEqual(
      await postgresMigrateCompatible(subject, {
        current: held,
        retainedPrevious: held,
      }),
      { migrated: "Applied", versions: before.map(({ version }) => version) },
    );
    await subject.query(
      `INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-3','project-3','Active')`,
    );
    await subject.query(
      `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
       VALUES('tenant-3','project-3',1,'PublishingHandoff',1)`,
    );
    await assert.rejects(
      postgresMigrate(subject),
      /handoff rows remain in ticket_projection/u,
    );
    assert.deepEqual(
      await postgresRuntimeSchema(subject).applied(
        new AbortController().signal,
      ),
      before,
    );
  });
});

/**
 * The two ways a stored entry says a step reached an account wall: the step
 * record's label, and the reason a blocked execution was reported under.
 */
const walledEntries: readonly (readonly [string, string])[] = [
  [
    "the record's label",
    JSON.stringify({
      seq: 1,
      event: {
        type: "TaskDone",
        value: { ticket: 1, tid: 1, verdict: "Fail" },
      },
      rec: {
        label: "ticket-escalated gas_exhausted",
        transitions: [{ ticket: 1, from: "Evaluating", to: "Escalated" }],
        effects: [],
      },
    }),
  ],
  [
    "the blocked event's reason",
    JSON.stringify({
      seq: 1,
      event: {
        type: "ExecutionBlocked",
        value: { ticket: 1, reason: "FinalizationBudgetExhausted" },
      },
      rec: {
        label: "ticket-escalated execution_blocked",
        transitions: [{ ticket: 1, from: "Finalizing", to: "Escalated" }],
        effects: [],
      },
    }),
  ],
];

/** What an image that still had the accounts wrote as its deployment policy. */
const accountedAuthoringPolicy =
  '{"nTickets":2,"nTasks":1,"reworkPolicy":{"type":"BudgetedRework","value":1},"gas":3,"finalizationPricing":{"type":"Budgeted","value":1},"maxStages":1}';

/** The same policy as the image without them encodes it, key order included. */
const unaccountedAuthoringPolicy = '{"nTickets":2,"nTasks":1,"maxStages":1}';

/**
 * One insert per narrowed reason check, each carrying a literal that check
 * used to admit. Both literals are offered to both relations, so a narrowing
 * that dropped only one of them is a red.
 */
const accountLiterals: readonly (readonly [string, string])[] = [
  [
    "ticket_projection_reason_is_known",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,reason)
     VALUES('tenant-4','project-4',1,'Escalated',1,'GasExhausted')`,
  ],
  [
    "ticket_projection_reason_is_known",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,reason)
     VALUES('tenant-4','project-4',1,'Escalated',1,'FinalizationBudgetExhausted')`,
  ],
  [
    "native_action_reason_check",
    `INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,
        ticket,action_version,kind,reason,required_capability)
     VALUES('tenant-4','project-4','action-4',1,0,1,1,'TicketEscalation','GasExhausted','ResolveTicket')`,
  ],
  [
    "native_action_reason_check",
    `INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,
        ticket,action_version,kind,reason,required_capability)
     VALUES('tenant-4','project-4','action-4',1,0,1,1,'TicketEscalation','FinalizationBudgetExhausted','ResolveTicket')`,
  ],
];

/** Brings the subject to the schema the accounts were still in. */
async function accountedInstallation(subject: pg.Pool): Promise<void> {
  const before = migrations
    .slice(0, migration004.version - 1)
    .map(({ version, name }) => ({ version, name }));
  const held = runtimeSchemaContract(before);
  assert.deepEqual(
    await postgresMigrateCompatible(subject, {
      current: held,
      retainedPrevious: held,
    }),
    { migrated: "Applied", versions: before.map(({ version }) => version) },
  );
}

test("a fresh install records the accounts leaving and keeps none of their columns", async () => {
  await migrationDatabase("noaccounts_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration004.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration004.version],
        )
      ).rows,
      [
        {
          version: migration004.version,
          name: "the accounts leave the schema",
        },
      ],
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT table_name || '.' || column_name AS present
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND ((table_name = 'ticket_projection'
                    AND column_name IN ('gas_left','rework_left','finalization_left','reason'))
                OR (table_name = 'dispatch_candidate'
                    AND column_name IN ('rework_policy','finalization_pricing','resume_pricing','program')))
            ORDER BY present`,
        )
      ).rows,
      [
        { present: "dispatch_candidate.program" },
        { present: "ticket_projection.reason" },
      ],
    );
  });
});

test("every narrowed reason check refuses the literals the accounts left it", async () => {
  await migrationDatabase("noaccounts_checks", async (subject) => {
    await postgresMigrate(subject);
    for (const [constraint, refused] of accountLiterals)
      await assert.rejects(
        subject.query(refused),
        new RegExp(constraint, "u"),
        refused,
      );
  });
});

test("the release the boundary admits carries no pricing, and no blocked reason names an account", async () => {
  await migrationDatabase("noaccounts_boundary", async (subject) => {
    await postgresMigrate(subject);
    const admits = async (event: unknown): Promise<boolean | null> =>
      (
        await subject.query<{ admitted: boolean | null }>(
          "SELECT decision_event_is_valid($1::jsonb) AS admitted",
          [JSON.stringify(event)],
        )
      ).rows[0]?.admitted ?? null;
    assert.equal(
      await admits({
        type: "ReleaseTicket",
        value: {
          ticket: 1,
          deps: [],
          prog: [{ fanout: 1, combinator: "UnanimousPass" }],
          workFanout: 1,
          finalizer: "ManagedFinalizer",
        },
      }),
      true,
    );
    assert.equal(
      await admits({
        type: "ExecutionBlocked",
        value: { ticket: 1, reason: "WorkFailed" },
      }),
      true,
    );
    for (const reason of ["GasExhausted", "FinalizationBudgetExhausted"])
      assert.equal(
        await admits({
          type: "ExecutionBlocked",
          value: { ticket: 1, reason },
        }),
        false,
        reason,
      );
  });
});

/** Each relation the guard names, with a row it has to see there. */
const walledRows: readonly (readonly [string, string])[] = [
  [
    "ticket_projection",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,reason)
     VALUES('tenant-4','project-4',1,'Escalated',1,'GasExhausted')`,
  ],
  [
    "native_action",
    `INSERT INTO recovery_epoch(epoch) VALUES('epoch-4');
     INSERT INTO decision_input
       (tenant,project,ordinal,input_kind,input_id,base_priority,
        lifecycle_generation,state,decided_seq,terminal_at)
     VALUES('tenant-4','project-4',1,'Operation','operation-4','Ordinary',1,'Journaled',1,now());
     INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id)
     VALUES('tenant-4','project-4',1,'{}','digest-4','genesis','owner',1,'epoch-4','Operation','operation-4');
     INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,
        ticket,action_version,kind,reason,required_capability)
     VALUES('tenant-4','project-4','action-4',1,0,1,1,'TicketEscalation','FinalizationBudgetExhausted','ResolveTicket')`,
  ],
];

test("a ticket parked at an account wall refuses the migration untouched", async () => {
  for (const [relation, seeded] of walledRows)
    await migrationDatabase("noaccounts_guard", async (subject) => {
      await accountedInstallation(subject);
      await subject.query(
        `INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-4','project-4','Active');
         ${seeded}`,
      );
      await assert.rejects(
        postgresMigrate(subject),
        new RegExp(`no longer admits remain in ${relation}`, "u"),
        relation,
      );
      assert.deepEqual(
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        ),
        migrations
          .slice(0, migration004.version - 1)
          .map(({ version, name }) => ({ version, name })),
        relation,
      );
    });
});

test("a journal that names an account wall refuses the migration untouched", async () => {
  for (const [what, entry] of walledEntries)
    await migrationDatabase("noaccounts_journal", async (subject) => {
      await accountedInstallation(subject);
      await subject.query(
        `INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-4','project-4','Active');
         INSERT INTO recovery_epoch(epoch) VALUES('epoch-4');
         INSERT INTO decision_input
           (tenant,project,ordinal,input_kind,input_id,base_priority,
            lifecycle_generation,state,decided_seq,terminal_at)
         VALUES('tenant-4','project-4',1,'Operation','operation-4','Ordinary',1,'Journaled',1,now());
         INSERT INTO journal_entry
           (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
            recovery_epoch,cause_kind,cause_id)
         VALUES('tenant-4','project-4',1,$entry$${entry}$entry$,
                'digest-4','genesis','owner',1,'epoch-4','Operation','operation-4')`,
      );
      await assert.rejects(
        postgresMigrate(subject),
        /no longer admits remain in journal_entry/u,
        what,
      );
      assert.deepEqual(
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        ),
        migrations
          .slice(0, migration004.version - 1)
          .map(({ version, name }) => ({ version, name })),
        what,
      );
    });
});

/** A lead session holding one queued turn of `chars`, on an installation the accounts are still in. */
async function turnOfWidth(subject: pg.Pool, chars: number): Promise<void> {
  await accountedInstallation(subject);
  await subject.query(
    `INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-4','project-4','Active');
     INSERT INTO execution_cluster(cluster,slots_max,policy_revision)
     VALUES('cluster-4',1,1);
     INSERT INTO capacity_account(account,cluster,reserved,maximum,policy_revision)
     VALUES('account-4','cluster-4',0,1,1);
     INSERT INTO agent_session
       (tenant,project,session,kind,principal,capabilities,credential_slot,account,cluster)
     VALUES('tenant-4','project-4','session-4','Lead','principal-4','{}',
            'slot-4','account-4','cluster-4');
     INSERT INTO session_turn(tenant,project,session,turn,ordinal,input_kind,input)
     VALUES('tenant-4','project-4','session-4','turn-4',1,'Observation',
            repeat('x',${String(chars)}))`,
  );
}

/**
 * Each migration that narrows the mailbox bound guards it at its own figure,
 * and an arm that never matches reads exactly like one that works, so each is
 * driven at the width only it refuses. Every pending migration applies in one
 * transaction, so either refusal leaves the ledger where the installation
 * started.
 */
for (const [label, bound] of [
  ["noaccounts", leadObservationTokensPerDecisionAt004],
  ["threedeletions", leadObservationTokensPerDecisionAt005],
] as const)
  test(`a session turn wider than ${label}'s bound refuses the migration untouched`, async () => {
    await migrationDatabase(`${label}_turn_wide`, async (subject) => {
      await turnOfWidth(subject, bound + 1);
      await assert.rejects(
        postgresMigrate(subject),
        /no longer admits remain in session_turn/u,
      );
      assert.deepEqual(
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        ),
        migrations
          .slice(0, migration004.version - 1)
          .map(({ version, name }) => ({ version, name })),
      );
    });
  });

test("a session turn at the narrowed bound migrates", async () => {
  await migrationDatabase("threedeletions_turn_fits", async (subject) => {
    await turnOfWidth(subject, leadObservationTokensPerDecisionAt005);
    assert.ok((await postgresMigrate(subject)).includes(migration005.version));
  });
});

/**
 * The rewrite and the start-up check, held against each other. Migration 004
 * renders the retained keys itself, so nothing but a case like this says the
 * text it renders is text the image that installs it will start against.
 */
test("a policy row migration 004 rewrote is one this image starts against", async () => {
  await migrationDatabase("noaccounts_precondition", async (subject) => {
    await accountedInstallation(subject);
    await subject.query(
      `INSERT INTO deployment_authoring_policy(singleton,domain_configuration)
       VALUES(true,$1)`,
      [accountedAuthoringPolicy],
    );
    assert.ok((await postgresMigrate(subject)).includes(migration004.version));
    assert.equal(
      (
        await postgresDomainConfigurationPrecondition(
          subject,
          refinementInstance,
        ).check(new AbortController().signal)
      ).met,
      "Met",
    );
  });
});

test("the authoring policy loses the keys the accounts configured", async () => {
  await migrationDatabase("noaccounts_policy", async (subject) => {
    await accountedInstallation(subject);
    await subject.query(
      `INSERT INTO deployment_authoring_policy(singleton,domain_configuration)
       VALUES(true,$1)`,
      [accountedAuthoringPolicy],
    );
    assert.ok((await postgresMigrate(subject)).includes(migration004.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT domain_configuration FROM deployment_authoring_policy",
        )
      ).rows,
      [{ domain_configuration: unaccountedAuthoringPolicy }],
    );
  });
});

/** Brings the subject to the schema the three deleted values were still in. */
async function installationBefore(
  subject: pg.Pool,
  migration: number,
): Promise<void> {
  const before = migrations
    .slice(0, migration - 1)
    .map(({ version, name }) => ({ version, name }));
  const held = runtimeSchemaContract(before);
  assert.deepEqual(
    await postgresMigrateCompatible(subject, {
      current: held,
      retainedPrevious: held,
    }),
    { migrated: "Applied", versions: before.map(({ version }) => version) },
  );
}

/** What every row below hangs from: a project and an epoch. */
const deletionPartition = `
  INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-5','project-5','Active');
  INSERT INTO recovery_epoch(epoch) VALUES('epoch-5');`;

function deletionJournalRow(seq: number, entry: string): string {
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

function deletionReleaseEntry(
  finalizer: string,
  combinator: string,
  seq = 1,
): string {
  return JSON.stringify({
    seq,
    event: {
      type: "ReleaseTicket",
      value: {
        ticket: 1,
        deps: [],
        prog: [{ fanout: 1, combinator }],
        workFanout: 1,
        finalizer,
      },
    },
    rec: { label: "ticket-released", transitions: [], effects: [] },
  });
}

function deletionRevokeEntry(
  transitions: readonly { readonly ticket: number }[],
  seq = 1,
): string {
  return JSON.stringify({
    seq,
    event: { type: "Revoke", value: 1 },
    rec: {
      label: "ticket-revoked",
      transitions: transitions.map(({ ticket }) => ({
        ticket,
        from: "Pending",
        to: ticket === 1 ? "Revoked" : "Escalated",
      })),
      effects: ["CancelTicketWork"],
    },
  });
}

function deletionBlockedEntry(reason: string, seq = 1): string {
  return JSON.stringify({
    seq,
    event: { type: "ExecutionBlocked", value: { ticket: 1, reason } },
    rec: {
      label: "ticket-escalated execution_blocked",
      transitions: [{ ticket: 1, from: "Working", to: "Escalated" }],
      effects: [],
    },
  });
}

/** One row per guard arm, each the smallest thing that arm has to see. */
const deletedRows: readonly (readonly [string, string, string])[] = [
  [
    "ticket_projection",
    "a ticket parked on a revoked dependency",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,reason)
     VALUES('tenant-5','project-5',1,'Escalated',1,'DependencyRevoked')`,
  ],
  [
    "native_action",
    "an open desk task at the parked reason",
    `${deletionJournalRow(1, "{}")};
     INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,
        ticket,action_version,kind,reason,required_capability)
     VALUES('tenant-5','project-5','action-5',1,0,1,1,'TicketEscalation','DependencyRevoked','ResolveTicket')`,
  ],
  [
    "journal_entry",
    "a release that chose no finalizer",
    deletionJournalRow(1, deletionReleaseEntry("NoFinalizer", "UnanimousPass")),
  ],
  [
    "journal_entry",
    "a release whose stage passed on any",
    deletionJournalRow(1, deletionReleaseEntry("ManagedFinalizer", "AnyPass")),
  ],
  [
    "journal_entry",
    "an execution blocked on a revoked dependency",
    deletionJournalRow(1, deletionBlockedEntry("DependencyRevoked")),
  ],
];

/** Rows the guard lets through: each arm's near miss, and the cascade no arm looks for. */
const undeletedRows: readonly (readonly [string, string])[] = [
  [
    "a ticket parked on its own failed work",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,reason)
     VALUES('tenant-5','project-5',1,'Escalated',1,'WorkFailed')`,
  ],
  [
    "a settled desk task at the parked reason",
    `${deletionJournalRow(1, "{}")};
     INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,
        ticket,action_version,kind,reason,required_capability,state)
     VALUES('tenant-5','project-5','action-5',1,0,1,1,'TicketEscalation','DependencyRevoked','ResolveTicket','Withdrawn')`,
  ],
  [
    "a release this machine still admits",
    deletionJournalRow(
      1,
      deletionReleaseEntry("ManagedFinalizer", "UnanimousPass"),
    ),
  ],
  [
    "an execution blocked on its own failed work",
    deletionJournalRow(1, deletionBlockedEntry("WorkFailed")),
  ],
  [
    "a revoke that parked the dependents behind the ticket it named",
    deletionJournalRow(1, deletionRevokeEntry([{ ticket: 1 }, { ticket: 2 }])),
  ],
  ["a journal row that is not a document", deletionJournalRow(1, "not json")],
];

test("a row the three deletions leave unreplayable refuses the migration untouched", async () => {
  for (const [relation, what, seeded] of deletedRows)
    await migrationDatabase("threedeletions_guard", async (subject) => {
      await installationBefore(subject, migration005.version);
      await subject.query(`${deletionPartition}\n${seeded}`);
      await assert.rejects(
        postgresMigrate(subject),
        new RegExp(`no longer admits remain in ${relation}`, "u"),
        what,
      );
      assert.deepEqual(
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        ),
        migrations
          .slice(0, migration005.version - 1)
          .map(({ version, name }) => ({ version, name })),
        what,
      );
    });
});

test("a row each arm must not match migrates", async () => {
  for (const [what, seeded] of undeletedRows)
    await migrationDatabase("threedeletions_admit", async (subject) => {
      await installationBefore(subject, migration005.version);
      await subject.query(`${deletionPartition}\n${seeded}`);
      assert.ok(
        (await postgresMigrate(subject)).includes(migration005.version),
        what,
      );
    });
});

test("a fresh install records the three leaving and keeps no finalizer column", async () => {
  await migrationDatabase("threedeletions_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration005.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration005.version],
        )
      ).rows,
      [
        {
          version: migration005.version,
          name: "the finalizer choice, the revoke cascade and the combinator leave",
        },
      ],
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT column_name AS present
             FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'dispatch_candidate'
              AND column_name IN ('finalizer','program')
            ORDER BY present`,
        )
      ).rows,
      [{ present: "program" }],
    );
  });
});

/** A desk task the rig settled at the parked reason, and the resolution it was settled with. */
const settledDeskTask = `${deletionJournalRow(1, "{}")};
   INSERT INTO native_action
     (tenant,project,action,authorizing_seq,effect_position,
      ticket,action_version,kind,reason,required_capability,state)
   VALUES('tenant-5','project-5','action-5',1,0,1,1,'TicketEscalation','DependencyRevoked','ResolveTicket','Withdrawn');
   INSERT INTO native_action_resolution(tenant,project,action,resolution)
   VALUES('tenant-5','project-5','action-5','Revoke');
   UPDATE native_action SET state='Resolved', resolution='Revoke'
    WHERE tenant='tenant-5' AND project='project-5' AND action='action-5'`;

test("a desk task settled at the parked reason migrates and stays what it recorded", async () => {
  await migrationDatabase("threedeletions_settled", async (subject) => {
    await installationBefore(subject, migration005.version);
    await subject.query(`${deletionPartition}\n${settledDeskTask}`);
    assert.ok((await postgresMigrate(subject)).includes(migration005.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT state,reason FROM native_action WHERE action='action-5'",
        )
      ).rows,
      [{ state: "Resolved", reason: "DependencyRevoked" }],
    );
  });
});

/** Each narrowed reason check, with a row it has to refuse once the migration has run. */
const parkedReasonRows: readonly (readonly [string, string])[] = [
  [
    "ticket_projection_reason_is_known",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,reason)
     VALUES('tenant-5','project-5',1,'Escalated',1,'DependencyRevoked')`,
  ],
  [
    "native_action_reason_check",
    `${deletionJournalRow(1, "{}")};
     INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,
        ticket,action_version,kind,reason,required_capability)
     VALUES('tenant-5','project-5','action-5',1,0,1,1,'TicketEscalation','DependencyRevoked','ResolveTicket')`,
  ],
];

test("the narrowed reason checks refuse a live row at the parked reason", async () => {
  await migrationDatabase("threedeletions_checks", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(deletionPartition);
    for (const [constraint, refused] of parkedReasonRows)
      await assert.rejects(
        subject.query(refused),
        new RegExp(constraint, "u"),
        refused,
      );
  });
});

/**
 * The programs the rewrite has to render, each as the encoder that still wrote
 * the combinator stored it and as the machine now holds it: two stages, and
 * none at all. The stored side is a literal because no encoder in this tree
 * can write the deleted key any more.
 */
const rewrittenPrograms: readonly (readonly [
  number,
  string,
  readonly StageDefinition[],
])[] = [
  [
    1,
    '[{"fanout":2,"combinator":"UnanimousPass"},{"fanout":1,"combinator":"AnyPass"}]',
    [{ fanout: 2 }, { fanout: 1 }],
  ],
  [2, "[]", []],
];

test("a stored dispatch program is rewritten as the encoder without the combinator writes it", async () => {
  await migrationDatabase("threedeletions_program", async (subject) => {
    await installationBefore(subject, migration005.version);
    await subject.query(`${deletionPartition}
       INSERT INTO configuration_revision
         (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
       VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
       INSERT INTO dispatch_view(tenant,project,recovery_epoch,watermark,schema_version,digest)
       VALUES('tenant-5','project-5','epoch-5',1,1,repeat('a',64));`);
    for (const [ticket, stored] of rewrittenPrograms)
      await subject.query(
        `INSERT INTO dispatch_candidate
           (tenant,project,ticket,ticket_version,work_fanout,program,finalizer,
            configuration_revision,configuration_digest,configuration_canonical)
         VALUES('tenant-5','project-5',$1,1,1,$2,'ManagedFinalizer',
                'revision-5','digest-5','{}')`,
        [ticket, stored],
      );
    assert.ok((await postgresMigrate(subject)).includes(migration005.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT ticket::text AS ticket,program FROM dispatch_candidate ORDER BY ticket",
        )
      ).rows,
      rewrittenPrograms.map(([ticket, , program]) => ({
        ticket: String(ticket),
        program: JSON.stringify(encodeDispatchProgram(program)),
      })),
    );
  });
});

test("the boundary admits the surviving spellings and the absent keys, and refuses the deleted ones", async () => {
  await migrationDatabase("threedeletions_boundary", async (subject) => {
    await postgresMigrate(subject);
    const admits = async (event: unknown): Promise<boolean | null> =>
      (
        await subject.query<{ admitted: boolean | null }>(
          "SELECT decision_event_is_valid($1::jsonb) AS admitted",
          [JSON.stringify(event)],
        )
      ).rows[0]?.admitted ?? null;
    const release = (value: Record<string, unknown>): unknown => ({
      type: "ReleaseTicket",
      value: { ticket: 1, deps: [], workFanout: 1, ...value },
    });
    assert.equal(
      await admits(
        release({
          prog: [{ fanout: 1, combinator: "UnanimousPass" }],
          finalizer: "ManagedFinalizer",
        }),
      ),
      true,
      "the spellings a stored entry carries",
    );
    assert.equal(
      await admits(release({ prog: [{ fanout: 1 }] })),
      true,
      "the keys this machine no longer writes",
    );
    assert.equal(
      await admits(
        release({
          prog: [{ fanout: 1, combinator: "UnanimousPass" }],
          finalizer: "NoFinalizer",
        }),
      ),
      false,
      "the finalizer this machine does not have",
    );
    assert.equal(
      await admits(release({ prog: [{ fanout: 1, combinator: "AnyPass" }] })),
      false,
      "the combinator this machine does not have",
    );
    assert.equal(
      await admits({
        type: "ExecutionBlocked",
        value: { ticket: 1, reason: "WorkFailed" },
      }),
      true,
    );
    assert.equal(
      await admits({
        type: "ExecutionBlocked",
        value: { ticket: 1, reason: "DependencyRevoked" },
      }),
      false,
    );
  });
});

/** A draft authoring of the shape an image that still had the finalizer wrote. */
function deletionFinalizerAuthoring(): string {
  const authoring = JSON.parse(encodeDraftAuthoring(plainAuthoring)) as {
    readonly value: Record<string, unknown>;
  };
  return JSON.stringify({
    ...authoring,
    value: { ...authoring.value, finalizer: "NoFinalizer" },
  });
}

test("an authoring that still names the deleted finalizer no longer decides the landing", async () => {
  await migrationDatabase("threedeletions_draft", async (subject) => {
    await postgresMigrate(subject);
    await seedProposingBinding(subject);
    assert.deepEqual(
      (
        await subject.query<{ result: string }>(
          `SELECT result FROM ${draftCreateFunction}(
             'tenant-91','project-91','revision-91','digest-91',0,$1,
             NULL,'Land it.','{}'::text[],'{}'::text[],'refs/heads/rt/work',
             NULL,NULL,'bound-91','User','author')`,
          [deletionFinalizerAuthoring()],
        )
      ).rows,
      [{ result: "Created" }],
    );
    assert.deepEqual(
      (
        await subject.query<{ finalization_mode: string }>(
          "SELECT finalization_mode FROM draft_brief",
        )
      ).rows,
      [{ finalization_mode: "PullRequest" }],
      "the draft lands where its repository lands",
    );
    assert.deepEqual(
      (
        await subject.query<{ result: string }>(
          `SELECT result FROM ${draftReviseFunction}(
             'tenant-91','project-91',1,1,'revision-91',$1,
             NULL,'Land it.','{}'::text[],'{}'::text[],'refs/heads/rt/work',
             'Push',NULL,'bound-91','User','author')`,
          [deletionFinalizerAuthoring()],
        )
      ).rows,
      [{ result: "Revised" }],
    );
    assert.deepEqual(
      (
        await subject.query<{ finalization_mode: string }>(
          "SELECT finalization_mode FROM draft_brief",
        )
      ).rows,
      [{ finalization_mode: "Push" }],
      "the revision lands where it says",
    );
  });
});

/** The landing each roster has to take, and one neither may. */
const landingRosterRows: readonly (readonly [string, string, string])[] = [
  [
    "draft_brief_finalization_mode_is_known",
    "None",
    `UPDATE draft_brief SET finalization_mode='None'`,
  ],
  [
    "draft_brief_finalization_mode_is_known",
    "Nowhere",
    `UPDATE draft_brief SET finalization_mode='Nowhere'`,
  ],
  [
    "project_repository_landing_mode_is_known",
    "None",
    `UPDATE project_repository SET landing_mode='None'`,
  ],
  [
    "project_repository_landing_mode_is_known",
    "Nowhere",
    `UPDATE project_repository SET landing_mode='Nowhere'`,
  ],
];

test("both landing rosters take the mode that lands nothing and no other new one", async () => {
  await migrationDatabase("threedeletions_none", async (subject) => {
    await postgresMigrate(subject);
    await seedProposingBinding(subject);
    assert.deepEqual(
      await createdProposingDraft(subject, "refs/heads/rt/work"),
      [{ result: "Created", ticket: "1" }],
    );
    for (const [constraint, mode, written] of landingRosterRows)
      if (mode === "None")
        assert.equal(
          (await subject.query(written)).rowCount,
          1,
          `${constraint} takes ${mode}`,
        );
      else
        await assert.rejects(
          subject.query(written),
          new RegExp(constraint, "u"),
          `${constraint} refuses ${mode}`,
        );
  });
});

/** The two briefs a pre-005 image wrote: one that landed nothing, one that landed. */
async function briefsBeforeTheLandingRoster(subject: pg.Pool): Promise<void> {
  await installationBefore(subject, migration005.version);
  await seedProposingBinding(subject);
  for (const authoring of [
    deletionFinalizerAuthoring(),
    encodeDraftAuthoring(plainAuthoring),
  ])
    await subject.query(
      `SELECT result FROM ${draftCreateFunction}(
         'tenant-91','project-91','revision-91','digest-91',0,$1,
         NULL,'Land it.','{}'::text[],'{}'::text[],'refs/heads/rt/work',
         NULL,NULL,'bound-91','User','author')`,
      [authoring],
    );
}

test("a brief that recorded no landing is migrated to the one that lands nothing", async () => {
  await migrationDatabase("threedeletions_landing", async (subject) => {
    await briefsBeforeTheLandingRoster(subject);
    assert.deepEqual(
      (
        await subject.query(
          "SELECT ticket::text AS ticket,finalization_mode FROM draft_brief ORDER BY ticket",
        )
      ).rows,
      [
        { ticket: "1", finalization_mode: null },
        { ticket: "2", finalization_mode: "PullRequest" },
      ],
      "the image before this one recorded no landing for the draft that landed nothing",
    );
    assert.ok((await postgresMigrate(subject)).includes(migration005.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT ticket::text AS ticket,finalization_mode FROM draft_brief ORDER BY ticket",
        )
      ).rows,
      [
        { ticket: "1", finalization_mode: "None" },
        { ticket: "2", finalization_mode: "PullRequest" },
      ],
    );
  });
});

/** Every phase, reason and resume point the rename moves, as it was stored and as it is held now. */
const renamedPhases = [
  ["Pending", "Pending"],
  ["Working", "Work"],
  ["Evaluating", "Evaluation"],
  ["Finalizing", "Finalization"],
  ["Done", "Done"],
  ["Escalated", "Escalated"],
  ["Revoked", "Revoked"],
] as const;

const renamedReasons = [
  ["NoReason", "NoReason"],
  ["WorkFailed", "WorkFailureEscalated"],
  ["ReworkBudgetExhausted", "EvaluationFailureEscalated"],
  ["ExecutionPolicyDenied", "WorkExecutionUnavailableEscalated"],
  ["TicketConfigIncompatible", "WorkExecutionUnavailableEscalated"],
  ["ExecutionProfileUnavailable", "WorkExecutionUnavailableEscalated"],
  ["RuntimeVersionUnsupported", "WorkExecutionUnavailableEscalated"],
  ["RequiredCapabilityUnavailable", "WorkExecutionUnavailableEscalated"],
] as const;

const renamedResumes = [
  ["NoResume", "NoResume"],
  ["ResumeWorking", "ResumeWork"],
  ["ResumeReworking", "ResumeRework"],
  ["ResumeEvaluating", "ResumeEvaluation"],
  ["ResumeFinalizing", "ResumeFinalization"],
] as const;

/** One projected ticket per spelling, each varying the column it is there for and holding the rest still. */
const renamedProjection = [
  ...renamedPhases.map(([stored], index) => ({
    ticket: index + 1,
    phase: stored,
    reason: "NoReason",
    resume: null,
  })),
  ...renamedReasons.map(([stored], index) => ({
    ticket: renamedPhases.length + index + 1,
    phase: "Escalated",
    reason: stored,
    resume: null,
  })),
  ...renamedResumes.map(([stored], index) => ({
    ticket: renamedPhases.length + renamedReasons.length + index + 1,
    phase: "Pending",
    reason: "NoReason",
    resume: stored,
  })),
];

function renamedRowValues(
  rows: readonly (readonly (string | number | null)[])[],
): string {
  return rows
    .map(
      (row) =>
        `(${row.map((cell) => (cell === null ? "NULL" : typeof cell === "number" ? String(cell) : `'${cell}'`)).join(",")})`,
    )
    .join(",");
}

const renamedSeed = `${deletionJournalRow(1, "{}")};
  INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,reason,resume_at)
  VALUES ${renamedRowValues(
    renamedProjection.map(({ ticket, phase, reason, resume }) => [
      "tenant-5",
      "project-5",
      ticket,
      phase,
      1,
      reason,
      resume,
    ]),
  )};
  INSERT INTO native_action
    (tenant,project,action,authorizing_seq,effect_position,ticket,action_version,
     kind,reason,required_capability,state)
  VALUES ${renamedRowValues(
    [...renamedReasons.map(([stored]) => stored), "DependencyRevoked"].map(
      (reason, index) => [
        "tenant-5",
        "project-5",
        `action-${String(index)}`,
        1,
        index,
        index + 1,
        1,
        "TicketEscalation",
        reason,
        "ResolveTicket",
        index === 0 ? "Open" : "Withdrawn",
      ],
    ),
  )};
  INSERT INTO project_continuation
    (tenant,project,continuation,kind,authorizing_seq,effect_position,ticket,
     expected_ticket_version,expected_phase,task_set_generation)
  VALUES ${renamedRowValues(
    renamedPhases.map(([stored], index) => [
      "tenant-5",
      "project-5",
      `continuation-${String(index)}`,
      "ReduceWork",
      1,
      index,
      index + 1,
      1,
      stored,
      1,
    ]),
  )}`;

test("a fresh install records the rename", async () => {
  await migrationDatabase("rename_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration006.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration006.version],
        )
      ).rows,
      [
        {
          version: migration006.version,
          name: "the phases, reasons and resume points take the package's names",
        },
      ],
    );
  });
});

test("every stored spelling in a rewritten column becomes the package's", async () => {
  await migrationDatabase("rename_rewrite", async (subject) => {
    await installationBefore(subject, migration006.version);
    await subject.query(`${deletionPartition}\n${renamedSeed}`);
    assert.ok((await postgresMigrate(subject)).includes(migration006.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT ticket::text AS ticket,phase,reason,resume_at FROM ticket_projection ORDER BY ticket",
        )
      ).rows,
      renamedProjection
        .map(({ ticket, phase, reason, resume }) => ({
          ticket: String(ticket),
          phase: renamedPhases.find(([stored]) => stored === phase)?.[1],
          reason: renamedReasons.find(([stored]) => stored === reason)?.[1],
          resume_at:
            resume === null
              ? null
              : renamedResumes.find(([stored]) => stored === resume)?.[1],
        }))
        .sort((left, right) => left.ticket.localeCompare(right.ticket)),
      "the projection",
    );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT reason,state FROM native_action ORDER BY action",
        )
      ).rows,
      [
        ...renamedReasons.map(([, held], index) => ({
          reason: held,
          state: index === 0 ? "Open" : "Withdrawn",
        })),
        { reason: "DependencyRevoked", state: "Withdrawn" },
      ],
      "the desk tasks, the one the revoke settled included",
    );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT expected_phase FROM project_continuation ORDER BY continuation",
        )
      ).rows,
      renamedPhases.map(([, held]) => ({ expected_phase: held })),
      "the continuations",
    );
  });
});

/** Each restated check, with a row at the spelling its column left. */
const renamedAway: readonly (readonly [string, string])[] = [
  [
    "ticket_projection_phase_is_known",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
     VALUES('tenant-5','project-5',1,'Working',1)`,
  ],
  [
    "ticket_projection_reason_is_known",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,reason)
     VALUES('tenant-5','project-5',2,'Escalated',1,'WorkFailed')`,
  ],
  [
    "ticket_projection_resume_is_known",
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,resume_at)
     VALUES('tenant-5','project-5',3,'Pending',1,'ResumeWorking')`,
  ],
  [
    "native_action_reason_check",
    `INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,ticket,
        action_version,kind,reason,required_capability)
     VALUES('tenant-5','project-5','action-5',1,0,1,1,'TicketEscalation','WorkFailed','ResolveTicket')`,
  ],
  [
    "project_continuation_expected_phase_check",
    `INSERT INTO project_continuation
       (tenant,project,continuation,kind,authorizing_seq,effect_position,ticket,
        expected_ticket_version,expected_phase,task_set_generation)
     VALUES('tenant-5','project-5','continuation-5','ReduceWork',1,0,1,1,'Working',1)`,
  ],
];

test("each rewritten column refuses the spelling it left", async () => {
  await migrationDatabase("rename_checks", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${deletionJournalRow(1, "{}")}`);
    for (const [constraint, refused] of renamedAway)
      await assert.rejects(
        subject.query(refused),
        new RegExp(constraint, "u"),
        refused,
      );
  });
});

/** An event at each spelling a stored row can carry and each one a new row will, and one that is neither. */
const renamedEvents: readonly (readonly [unknown, boolean])[] = [
  [
    {
      type: "ReleaseTicket",
      value: { ticket: 1, deps: [], prog: [], workFanout: 1 },
    },
    true,
  ],
  [
    {
      type: "CreateTicket",
      value: { ticket: 1, deps: [], prog: [], workFanout: 1 },
    },
    true,
  ],
  [
    {
      type: "FinalizationResult",
      value: { ticket: 1, out: "FinalizationFailed" },
    },
    true,
  ],
  [
    {
      type: "FinalizationResult",
      value: { ticket: 1, out: "FinalizationNeedsWork" },
    },
    true,
  ],
  [
    {
      type: "FinalizationResult",
      value: { ticket: 1, out: "FinalizationRefused" },
    },
    false,
  ],
  [
    { type: "ExecutionBlocked", value: { ticket: 1, reason: "WorkFailed" } },
    true,
  ],
  [
    {
      type: "ExecutionBlocked",
      value: { ticket: 1, reason: "WorkFailureEscalated" },
    },
    true,
  ],
  [
    {
      type: "ExecutionBlocked",
      value: { ticket: 1, reason: "ReworkBudgetExhausted" },
    },
    true,
  ],
  [
    {
      type: "ExecutionBlocked",
      value: { ticket: 1, reason: "EvaluationFailureEscalated" },
    },
    true,
  ],
  [
    {
      type: "ExecutionBlocked",
      value: { ticket: 1, reason: "ExecutionPolicyDenied" },
    },
    true,
  ],
  [
    {
      type: "ExecutionBlocked",
      value: { ticket: 1, reason: "WorkExecutionUnavailableEscalated" },
    },
    true,
  ],
  [
    { type: "ExecutionBlocked", value: { ticket: 1, reason: "WorkRefused" } },
    false,
  ],
];

test("the boundary admits a stored event's spelling and the one it writes next", async () => {
  await migrationDatabase("rename_boundary", async (subject) => {
    await postgresMigrate(subject);
    for (const [event, admitted] of renamedEvents)
      assert.equal(
        (
          await subject.query<{ admitted: boolean | null }>(
            "SELECT decision_event_is_valid($1::jsonb) AS admitted",
            [JSON.stringify(event)],
          )
        ).rows[0]?.admitted,
        admitted,
        JSON.stringify(event),
      );
    for (const tag of ["ReleaseTicket", "CreateTicket"])
      assert.equal(
        (
          await subject.query<{ admitted: boolean | null }>(
            "SELECT public_ticket_command_is_valid($1::jsonb) AS admitted",
            [
              JSON.stringify({
                version: 1,
                command: "Decide",
                event: {
                  type: tag,
                  value: { ticket: 1, deps: [], prog: [], workFanout: 1 },
                },
              }),
            ],
          )
        ).rows[0]?.admitted,
        false,
        `the public door admits ${tag}`,
      );
  });
});

/** How many entries under each release tag the index case seeds, enough that the planner prefers the index. */
const renamedReleasesPerTag = 400;

test("the release index answers a read at either tag", async () => {
  await migrationDatabase("rename_index", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(deletionPartition);
    const tags = ["ReleaseTicket", "CreateTicket"];
    const tagged = tags
      .map((tag, step) => `(${String(step)},'${tag}')`)
      .join(",");
    await subject.query("BEGIN");
    await subject.query(
      `INSERT INTO decision_input
         (tenant,project,ordinal,input_kind,input_id,base_priority,
          lifecycle_generation,state,decided_seq,terminal_at)
       SELECT 'tenant-5','project-5',k.step*$1+n,'Continuation',
              'entry-'||(k.step*$1+n),'Continuation',1,'Journaled',k.step*$1+n,now()
         FROM generate_series(1,$1::bigint) n, (VALUES ${tagged}) AS k(step,tag)`,
      [renamedReleasesPerTag],
    );
    await subject.query(
      `INSERT INTO journal_entry
         (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
          recovery_epoch,cause_kind,cause_id)
       SELECT 'tenant-5','project-5',k.step*$1+n,
         format('{"seq":%s,"event":{"type":"%s","value":{"ticket":%s}},"rec":{}}',
                k.step*$1+n,k.tag,n),
         'digest-'||(k.step*$1+n),'previous-'||(k.step*$1+n),'owner',1,'epoch-5',
         'Continuation','entry-'||(k.step*$1+n)
         FROM generate_series(1,$1::bigint) n, (VALUES ${tagged}) AS k(step,tag)`,
      [renamedReleasesPerTag],
    );
    await subject.query("COMMIT");
    await subject.query("ANALYZE journal_entry");
    for (const tag of tags) {
      const before = await releaseIndexUse(subject);
      const found = await subject.query(
        `SELECT j.seq FROM journal_entry j
          WHERE j.tenant='tenant-5' AND j.project='project-5'
            AND (CASE WHEN j.entry IS JSON OBJECT
                      THEN j.entry::jsonb->'event'->>'type' END)=$1
            AND (CASE WHEN j.entry IS JSON OBJECT
                      THEN j.entry::jsonb->'event'->'value'->'ticket' END)=to_jsonb(1)`,
        [tag],
      );
      assert.equal(found.rowCount, 1, `${tag} was not seeded`);
      await subject.query("SELECT pg_stat_force_next_flush()");
      assert.ok(
        (await releaseIndexUse(subject)).scans > before.scans,
        `a release at ${tag} was answered without the index that exists for it`,
      );
    }
  });
});

/** A claimed finalization request, and the attempt the cases below give an outcome to. */
function renamedFinalization(attempt: string): string {
  return `${deletionJournalRow(1, "{}")};
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
     recovery_epoch,kind)
  VALUES('tenant-5','project-5','request-5',1,0,1,1,1,'Open','owner',1,now(),
         'epoch-5','RunFinalizer');
  INSERT INTO finalization_attempt
    (tenant,project,attempt,request,ticket,repository,input_bundle,input_bundle_digest,
     target_ref,target_commit,strategy,configuration_revision,configuration_digest,
     attempt_digest,approval_required,outcome,candidate_commit,failure_kind)
  VALUES('tenant-5','project-5','attempt-5','request-5',1,'repository-5','bundle-5',
         repeat('b',64),'refs/heads/main',repeat('c',40),'Merge','revision-5','digest-5',
         repeat('d',64),${attempt})`;
}

/** The attempt each door below binds to: one that failed to prepare, and one prepared and awaiting approval. */
const renamedAttemptFailed = "false,'Failed',NULL,'PreparationFailed'";
const renamedAttemptPrepared = "true,'Prepared',repeat('c',40),NULL";

test("the finalizer's door concludes at either spelling of the outcome it needs work under", async () => {
  for (const outcome of ["FinalizationFailed", "FinalizationNeedsWork"])
    await migrationDatabase("rename_finalizer", async (subject) => {
      await postgresMigrate(subject);
      await subject.query(
        `${deletionPartition}\n${renamedFinalization(renamedAttemptFailed)}`,
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT result,operation FROM submit_finalization_result
               ('tenant-5','project-5','request-5','attempt-5',$1,'PreparationFailed',
                1,'epoch-5','operation-5','subject-5')`,
            [outcome],
          )
        ).rows,
        [{ result: "Submitted", operation: "operation-5" }],
        outcome,
      );
      assert.deepEqual(
        (
          await subject.query(
            "SELECT command_tag FROM operation WHERE operation='operation-5'",
          )
        ).rows,
        [{ command_tag: "FinalizationResult" }],
        outcome,
      );
    });
  await migrationDatabase("rename_finalizer_refused", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(
      `${deletionPartition}\n${renamedFinalization(renamedAttemptFailed)}`,
    );
    await assert.rejects(
      subject.query(
        `SELECT result FROM submit_finalization_result
           ('tenant-5','project-5','request-5','attempt-5','FinalizationRefused',
            'PreparationFailed',1,'epoch-5','operation-5','subject-5')`,
      ),
      /is not one this boundary submits/u,
    );
  });
});

test("the approval door binds to a ticket the projection holds at the renamed phase", async () => {
  await migrationDatabase("rename_approval", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(
      `${deletionPartition}\n${renamedFinalization(renamedAttemptPrepared)};
       INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
       VALUES('tenant-5','project-5',1,'Finalization',1)`,
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT result,action FROM request_finalization_approval
             ('tenant-5','project-5','attempt-5','action-5','epoch-5')`,
        )
      ).rows,
      [{ result: "Requested", action: "action-5" }],
    );
  });
});

/** A claimed request with no attempt behind it, which is what a held pass leaves. */
const heldRequest = `${deletionJournalRow(1, "{}")};
  UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
  INSERT INTO finalization_request
    (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
     request_generation,state,claim_owner,claim_generation,claim_expires_at,
     recovery_epoch,kind)
  VALUES('tenant-5','project-5','request-5',1,0,1,1,1,'Registered','owner-5',1,
         now()+make_interval(secs=>60),'epoch-5','RunFinalizer')`;

/** The hold door, by the signature a privilege is asked about. */
const heldFunction =
  "record_finalization_hold(text,text,text,text,text,bigint,bigint,text)";

/** The kind the cases below hold a request at, and the one they move it to. */
const heldKind = "TargetUnreadable";
const heldOther = "ProposalDenied";

interface HeldRow {
  readonly hold_kind: string | null;
  readonly hold_passes: number;
  readonly held_since: Date | null;
}

/** A pool whose sessions act as one deployment role, so a grant is exercised rather than asked about. */
function heldRolePool(url: string, role: string): pg.Pool {
  const at = new URL(url);
  at.searchParams.set("options", `-c role=${role}`);
  return postgresPool(at.toString());
}

async function heldRecord(
  subject: pg.Pool,
  kind: string | null,
  claim: { readonly owner: string | null; readonly generation: number } = {
    owner: "owner-5",
    generation: 1,
  },
  request = "request-5",
): Promise<
  readonly { readonly result: string; readonly hold_passes: number }[]
> {
  return (
    await subject.query<{ result: string; hold_passes: number }>(
      `SELECT result,hold_passes FROM record_finalization_hold
         ('tenant-5','project-5',$1,$2,$3,$4,1,'epoch-5')`,
      [request, kind, claim.owner, claim.generation],
    )
  ).rows;
}

async function heldRow(subject: pg.Pool): Promise<HeldRow | undefined> {
  return (
    await subject.query<HeldRow>(
      "SELECT hold_kind,hold_passes,held_since FROM finalization_request WHERE request='request-5'",
    )
  ).rows[0];
}

/** The members a roster check installs, read off the constraint the server holds. */
async function heldRosterOf(
  subject: pg.Pool,
  relation: string,
  constraint: string,
): Promise<readonly string[]> {
  const held = (
    await subject.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
        WHERE c.conrelid = $1::regclass AND c.conname = $2`,
      [relation, constraint],
    )
  ).rows[0]?.definition;
  assert.ok(held !== undefined, `${constraint} was not found`);
  return [...held.matchAll(/'([^']+)'::text/gu)].map((each) => each[1] ?? "");
}

test("a fresh install records the escalation a held finalization reaches", async () => {
  await migrationDatabase("unavailable_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration007.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration007.version],
        )
      ).rows,
      [
        {
          version: migration007.version,
          name: "a finalization nothing can carry out escalates, and says what held it",
        },
      ],
    );
  });
});

test("the two reason rosters admit the escalation and refuse a name neither has", async () => {
  await migrationDatabase("unavailable_reasons", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${deletionJournalRow(1, "{}")}`);
    for (const [ticket, reason, admitted] of [
      [1, "FinalizationUnavailableEscalated", true],
      [2, "FinalizationUnavailable", false],
    ] as const) {
      const projected = subject.query(
        `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,reason)
         VALUES('tenant-5','project-5',${String(ticket)},'Escalated',1,'${reason}')`,
      );
      const desk = subject.query(
        `INSERT INTO native_action
           (tenant,project,action,authorizing_seq,effect_position,ticket,
            action_version,kind,reason,required_capability)
         VALUES('tenant-5','project-5','action-${String(ticket)}',1,${String(ticket)},
                ${String(ticket)},1,'TicketEscalation','${reason}','ResolveTicket')`,
      );
      if (admitted) {
        await projected;
        await desk;
      } else {
        await assert.rejects(projected, /ticket_projection_reason_is_known/u);
        await assert.rejects(desk, /native_action_reason_check/u);
      }
    }
  });
});

/** The envelope the finalizer's door builds, as the mailbox grammar is asked about it. */
function heldEnvelope(outcome: string, kind: string | null): string {
  return JSON.stringify({
    version: 1,
    command: "SubmitFinalizationResult",
    request: "request-5",
    requestGeneration: 1,
    recoveryEpoch: "epoch-5",
    outcome,
    ...(kind === null ? {} : { kind }),
  });
}

/** What one of the two validators answers about one document. */
async function heldAdmits(
  subject: pg.Pool,
  validator: string,
  value: string,
): Promise<boolean | null | undefined> {
  return (
    await subject.query<{ admitted: boolean | null }>(
      `SELECT ${validator}($1::jsonb) AS admitted`,
      [value],
    )
  ).rows[0]?.admitted;
}

test("the two validators admit the outcome a held finalization reports and refuse a name neither has", async () => {
  await migrationDatabase("unavailable_validators", async (subject) => {
    await postgresMigrate(subject);
    for (const [outcome, kind, admitted] of [
      ["FinalizationResultUnavailable", heldKind, true],
      ["FinalizationUnavailable", heldKind, false],
      ["FinalizationResultUnavailable", null, false],
      ["FinalizationNeedsWork", heldKind, false],
      ["FinalizationNeedsWork", null, true],
    ] as const)
      assert.equal(
        await heldAdmits(
          subject,
          "ticket_command_is_valid",
          heldEnvelope(outcome, kind),
        ),
        admitted,
        `${outcome} carrying ${String(kind)}`,
      );
    for (const [outcome, admitted] of [
      ["FinalizationResultUnavailable", true],
      ["FinalizationUnavailable", false],
    ] as const)
      assert.equal(
        await heldAdmits(
          subject,
          "decision_event_is_valid",
          JSON.stringify({
            type: "FinalizationResult",
            value: { ticket: 1, out: outcome },
          }),
        ),
        admitted,
        `the event at ${outcome}`,
      );
  });
});

test("the finalizer's door weighs the outcome it admits and refuses the name it has none of", async () => {
  await migrationDatabase("unavailable_outcomes", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${heldRequest}`);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT result FROM submit_finalization_result
             ('tenant-5','project-5','request-5',NULL,'FinalizationResultUnavailable',
              '${heldKind}',1,'epoch-5','operation-5','subject-5')`,
        )
      ).rows,
      [{ result: "BindingMismatch" }],
      "the door weighs the outcome rather than refusing the name",
    );
    await assert.rejects(
      subject.query(
        `SELECT result FROM submit_finalization_result
           ('tenant-5','project-5','request-5',NULL,'FinalizationUnavailable',
            '${heldKind}',1,'epoch-5','operation-5','subject-5')`,
      ),
      /is not one this boundary submits/u,
    );
  });
});

test("the hold column is the roster's one home and refuses every kind a resume cannot clear", async () => {
  await migrationDatabase("unavailable_roster", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${heldRequest}`);
    const installed = await heldRosterOf(
      subject,
      "finalization_request",
      "finalization_request_hold_kind_is_known",
    );
    for (const kind of installed)
      assert.ok(
        allFinalizationHoldKinds.some((held) => held === kind),
        `${kind} is a hold the finalizer can reach`,
      );
    const staying = allFinalizationHoldKinds.filter(
      (kind) => !installed.includes(kind),
    );
    assert.ok(staying.length > 0, "a hold that stays a hold is left off");
    for (const kind of [...staying, "NoHoldAtAll"])
      await assert.rejects(
        subject.query(
          `UPDATE finalization_request
              SET hold_kind=$1,hold_passes=1,held_since=now()
            WHERE request='request-5'`,
          [kind],
        ),
        /finalization_request_hold_kind_is_known/u,
        kind,
      );
    for (const [kind, passes, since] of [
      [heldKind, 0, "now()"],
      [heldKind, 1, "NULL"],
      [null, 1, "NULL"],
    ] as const)
      await assert.rejects(
        subject.query(
          `UPDATE finalization_request
              SET hold_kind=$1,hold_passes=${String(passes)},held_since=${since}
            WHERE request='request-5'`,
          [kind],
        ),
        /finalization_request_hold_is_whole/u,
        `${String(kind)} at ${String(passes)}`,
      );
  });
});

test("a recorded hold counts its passes, restarts on another kind and clears on none", async () => {
  await migrationDatabase("unavailable_hold", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${heldRequest}`);
    assert.deepEqual(await heldRow(subject), {
      hold_kind: null,
      hold_passes: 0,
      held_since: null,
    });
    assert.deepEqual(await heldRecord(subject, heldKind), [
      { result: "Recorded", hold_passes: 1 },
    ]);
    const first = await heldRow(subject);
    assert.equal(first?.hold_kind, heldKind);
    assert.ok(first?.held_since instanceof Date);
    assert.deepEqual(await heldRecord(subject, heldKind), [
      { result: "Recorded", hold_passes: 2 },
    ]);
    assert.deepEqual(await heldRow(subject), {
      hold_kind: heldKind,
      hold_passes: 2,
      held_since: first.held_since,
    });
    assert.deepEqual(await heldRecord(subject, heldOther), [
      { result: "Recorded", hold_passes: 1 },
    ]);
    const moved = await heldRow(subject);
    assert.equal(moved?.hold_kind, heldOther);
    assert.equal(moved?.hold_passes, 1);
    assert.notDeepEqual(moved.held_since, first.held_since);
    assert.deepEqual(await heldRecord(subject, null), [
      { result: "Recorded", hold_passes: 0 },
    ]);
    assert.deepEqual(await heldRow(subject), {
      hold_kind: null,
      hold_passes: 0,
      held_since: null,
    });
    await assert.rejects(
      heldRecord(subject, "ApprovalDeclined"),
      /finalization_request_hold_kind_is_known/u,
    );
  });
});

test("the hold is recorded by the pass holding the claim and by nothing else", async () => {
  await migrationDatabase("unavailable_claim", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${heldRequest}`);
    assert.deepEqual(
      await heldRecord(
        subject,
        heldKind,
        { owner: "owner-5", generation: 1 },
        "request-6",
      ),
      [{ result: "UnknownRequest", hold_passes: null }],
    );
    for (const claim of [
      { owner: "owner-6", generation: 1 },
      { owner: "owner-5", generation: 2 },
      { owner: null, generation: 1 },
    ])
      assert.deepEqual(
        await heldRecord(subject, heldKind, claim),
        [{ result: "BindingMismatch", hold_passes: null }],
        JSON.stringify(claim),
      );
    assert.deepEqual(await heldRow(subject), {
      hold_kind: null,
      hold_passes: 0,
      held_since: null,
    });
    await subject.query(
      "UPDATE finalization_request SET claim_owner=NULL,claim_expires_at=NULL,recovery_epoch=NULL WHERE request='request-5'",
    );
    assert.deepEqual(await heldRecord(subject, heldKind), [
      { result: "BindingMismatch", hold_passes: null },
    ]);
  });
});

test("the door concludes unavailable on the recorded hold and on nothing else", async () => {
  for (const [label, recorded, attempt, kind, result] of [
    ["the kind the request is held at", heldKind, null, heldKind, "Submitted"],
    ["no hold at all", null, null, heldKind, "BindingMismatch"],
    ["neither a hold nor a kind", null, null, null, "BindingMismatch"],
    ["another kind", heldKind, null, heldOther, "BindingMismatch"],
    [
      "an attempt's own failure",
      heldKind,
      null,
      "PreparationFailed",
      "BindingMismatch",
    ],
    ["no kind at all", heldKind, null, null, "BindingMismatch"],
    [
      "an attempt beside it",
      heldKind,
      "attempt-5",
      heldKind,
      "BindingMismatch",
    ],
  ] as const)
    await migrationDatabase("unavailable_door", async (subject) => {
      await postgresMigrate(subject);
      await subject.query(`${deletionPartition}\n${heldRequest}`);
      if (recorded !== null) await heldRecord(subject, recorded);
      assert.deepEqual(
        (
          await subject.query(
            `SELECT result FROM submit_finalization_result
               ('tenant-5','project-5','request-5',$1,'FinalizationResultUnavailable',
                $2,1,'epoch-5','operation-5','subject-5')`,
            [attempt, kind],
          )
        ).rows,
        [{ result }],
        label,
      );
      if (result !== "Submitted") return;
      const written = (
        await subject.query<{ command_tag: string; command: string }>(
          "SELECT command_tag,command FROM operation WHERE operation='operation-5'",
        )
      ).rows[0];
      assert.equal(written?.command_tag, "FinalizationResult");
      assert.deepEqual(JSON.parse(written.command), {
        version: 1,
        command: "SubmitFinalizationResult",
        request: "request-5",
        requestGeneration: 1,
        recoveryEpoch: "epoch-5",
        outcome: "FinalizationResultUnavailable",
        kind,
      });
      const kept = await heldRow(subject);
      assert.equal(kept?.hold_kind, heldKind);
      assert.equal(kept?.hold_passes, 1);
      assert.ok(
        kept.held_since instanceof Date,
        "the request keeps its evidence",
      );
    });
});

test("the finalizer records a hold the api role reads and cannot record itself", async () => {
  await migrationDatabase("unavailable_roles", async (subject, url) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${heldRequest}`);
    const finalizer = heldRolePool(url, finalizerRole);
    const api = heldRolePool(url, apiRole);
    try {
      assert.deepEqual(await heldRecord(finalizer, heldKind), [
        { result: "Recorded", hold_passes: 1 },
      ]);
      await assert.rejects(heldRecord(api, heldKind), /permission denied/u);
      assert.deepEqual(
        (
          await api.query(
            "SELECT hold_kind,hold_passes FROM finalization_request WHERE ticket=1",
          )
        ).rows,
        [{ hold_kind: heldKind, hold_passes: 1 }],
      );
      await assert.rejects(
        api.query("SELECT state FROM finalization_request"),
        /permission denied/u,
      );
    } finally {
      await finalizer.end();
      await api.end();
    }
    for (const [role, granted] of [
      [finalizerRole, true],
      [apiRole, false],
      ["public", false],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [role, heldFunction],
          )
        ).rows[0]?.granted,
        granted,
        role,
      );
    assert.equal(
      (
        await subject.query<{ owner: string }>(
          "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = $1::regprocedure",
          [heldFunction],
        )
      ).rows[0]?.owner,
      boundaryOwnerRole,
    );
  });
});
