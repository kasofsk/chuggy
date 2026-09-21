import { leadToolAllowlist } from "../../src/interpreter/leadTools.ts";
import { migration003 } from "../../src/adapters/postgres/schema/migrations/003-no-handoff.ts";
import { migration004 } from "../../src/adapters/postgres/schema/migrations/004-no-accounts.ts";
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
      [
        encodeDraftAuthoring({
          ...plainAuthoring,
          finalizer: "ManagedFinalizer",
        }),
        branch,
      ],
    )
  ).rows;
}

async function createdUnboundDraft(subject: pg.Pool) {
  return (
    await subject.query<{ result: string }>(
      `SELECT result FROM ${draftCreateFunction}(
         'tenant-91','project-91','revision-91','digest-91',0,$1,
         NULL,'Land it.','{}'::text[],'{}'::text[],NULL,NULL,NULL,NULL,'User','author')`,
      [
        encodeDraftAuthoring({
          ...plainAuthoring,
          finalizer: "ManagedFinalizer",
        }),
      ],
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
     VALUES('tenant-3','project-3',1,'Working',1,'ResumePublishingHandoff')`,
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
                    AND column_name IN ('rework_policy','finalization_pricing','resume_pricing','finalizer')))
            ORDER BY present`,
        )
      ).rows,
      [
        { present: "dispatch_candidate.finalizer" },
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
          finalizer: "NoFinalizer",
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
        new RegExp(`account rows remain in ${relation}`, "u"),
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
        /account rows remain in journal_entry/u,
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
