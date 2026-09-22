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
import { migration008 } from "../../src/adapters/postgres/schema/migrations/008-escalation-sum.ts";
import {
  leadObservationTokensPerDecisionAt009,
  migration009,
} from "../../src/adapters/postgres/schema/migrations/009-work-fanout.ts";
import { migration010 } from "../../src/adapters/postgres/schema/migrations/010-task-identity.ts";
import {
  leadObservationTokensPerDecisionAt011,
  migration011,
} from "../../src/adapters/postgres/schema/migrations/011-evaluator-keys.ts";
import { migration012 } from "../../src/adapters/postgres/schema/migrations/012-task-report.ts";
import { migration013 } from "../../src/adapters/postgres/schema/migrations/013-released-ticket.ts";
import { leadDispatchesPerDecision } from "../../src/adapters/postgres/schema/migrations/baseline/seed.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  acceptanceFunction,
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  draftReleaseFunction,
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
import { finalizationUnavailableKinds } from "../../src/contract/rosters.ts";
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
       format('{"seq":%s,"event":{"type":"%s","value":{"%s":%s}},"rec":{}}',
              k.step*$3+n,k.type,
              CASE WHEN k.type IN ('ReleaseTicket','CreateTicket')
                   THEN 'id' ELSE 'ticket' END,n),
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

/**
 * At the installed schema and no vintage: 013 re-renders the release index
 * over the key the payload now carries, and these reads spell the same key, so
 * a case pinned behind it would ask the adapter for a field no row holds.
 */
test("the release index is what answers every read of a ticket's release", async () => {
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
      leadObservationTokensPerDecisionAt011,
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
 * `native_action_kind_is_known` refuses `HandoffBlock` first; the rows carry
 * the phase and resume spellings 006 renamed, so 006 is the schema they are
 * asked of.
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
    await installationAt(subject, migration006.version);
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
    await installationAt(subject, migration004.version);
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
    await installationAt(subject, migration004.version);
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
    await installationAt(subject, migration004.version);
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
 * driven at a width the arms before it admit and it alone refuses. Every
 * pending migration applies in one transaction, so any of those refusals
 * leaves the ledger where the installation started.
 */
for (const [label, bound] of [
  ["noaccounts", leadObservationTokensPerDecisionAt004],
  ["threedeletions", leadObservationTokensPerDecisionAt005],
  ["workfanout", leadObservationTokensPerDecisionAt009],
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
  await migrationDatabase("workfanout_turn_fits", async (subject) => {
    await turnOfWidth(subject, leadObservationTokensPerDecisionAt009);
    assert.ok((await postgresMigrate(subject)).includes(migration009.version));
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

/** Brings the subject to the schema a named migration left, and no further. */
async function installationAt(
  subject: pg.Pool,
  migration: number,
  what = `the schema migration ${String(migration)} left`,
): Promise<void> {
  const through = migrations
    .slice(0, migration)
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
async function installationBefore(
  subject: pg.Pool,
  migration: number,
): Promise<void> {
  await installationAt(subject, migration - 1);
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
      await installationAt(subject, migration005.version, what);
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
    await installationAt(subject, migration005.version);
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
    await installationAt(subject, migration005.version);
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
 * the combinator stored it and as the rewrite leaves it: two stages, and none
 * at all. Both sides are literals because no encoder in this tree can write
 * the deleted key or the width any more.
 */
const rewrittenPrograms: readonly (readonly [number, string, string])[] = [
  [
    1,
    '[{"fanout":2,"combinator":"UnanimousPass"},{"fanout":1,"combinator":"AnyPass"}]',
    '[{"fanout":2},{"fanout":1}]',
  ],
  [2, "[]", "[]"],
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
        program,
      })),
    );
  });
});

test("the boundary admits the surviving spellings and the absent keys, and refuses the deleted ones", async () => {
  await migrationDatabase("threedeletions_boundary", async (subject) => {
    await installationAt(subject, migration005.version);
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
    await installationAt(subject, migration006.version);
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
    await installationAt(subject, migration006.version);
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
    await installationAt(subject, migration006.version);
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
         format('{"seq":%s,"event":{"type":"%s","value":{"id":%s}},"rec":{}}',
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
                      THEN j.entry::jsonb->'event'->'value'->'id' END)=to_jsonb(1)`,
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
    await installationAt(subject, migration007.version);
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
    assert.deepEqual(
      [...installed],
      [...finalizationUnavailableKinds],
      "the installed roster matches the runtime, member for member and in order",
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

/**
 * One journal entry and no projection row: the guard reads the journal the
 * actor replays, and a projection emptied ahead of it is no wipe.
 */
const journaledDecision = deletionJournalRow(1, "{}");

test("a fresh install records the reason and the resume becoming one escalation", async () => {
  await migrationDatabase("escalation_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration008.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration008.version],
        )
      ).rows,
      [
        {
          version: migration008.version,
          name: "a parked ticket carries one escalation and the evidence for it",
        },
      ],
    );
  });
});

test("a journal with an entry in it refuses the migration and names the wipe", async () => {
  await migrationDatabase("escalation_guard", async (subject) => {
    await installationBefore(subject, migration008.version);
    await subject.query(`${deletionPartition}\n${journaledDecision}`);
    await assert.rejects(postgresMigrate(subject), /wipe-tickets\.sql/u);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name='ticket_projection' AND column_name IN ('reason','resume_at')
           ORDER BY column_name`,
        )
      ).rows,
      [{ column_name: "reason" }, { column_name: "resume_at" }],
      "the columns the guard refused over are the columns it left",
    );
    assert.deepEqual(
      (
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        )
      )
        .map(({ version }) => version)
        .at(-1),
      migration008.version - 1,
    );
  });
});

/** Every escalation a parked ticket may carry, and one the machine has never had. */
const escalationKinds = [
  "NoEscalation",
  "WorkFailureEscalated",
  "WorkExecutionUnavailableEscalated",
  "EvaluationFailureEscalated",
  "EvaluationBlockedEscalated",
  "FinalizationUnavailableEscalated",
] as const;

const escalationUnknown = "ReworkBudgetExhausted";

test("the projection carries one escalation and no name off its roster", async () => {
  await migrationDatabase("escalation_projection", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(deletionPartition);
    for (const [index, kind] of escalationKinds.entries())
      await subject.query(
        `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,escalation)
         VALUES('tenant-5','project-5',$1,'Escalated',1,$2)`,
        [index + 1, kind],
      );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT escalation FROM ticket_projection ORDER BY ticket",
        )
      ).rows,
      escalationKinds.map((escalation) => ({ escalation })),
    );
    await assert.rejects(
      subject.query(
        `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,escalation)
         VALUES('tenant-5','project-5',90,'Escalated',1,$1)`,
        [escalationUnknown],
      ),
      /ticket_projection_escalation_is_known/u,
    );
    await subject.query(
      `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
       VALUES('tenant-5','project-5',94,'Pending',1)`,
    );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT escalation,escalation_evidence FROM ticket_projection WHERE ticket=94",
        )
      ).rows,
      [{ escalation: "NoEscalation", escalation_evidence: null }],
      "a ticket nothing parked carries the escalation that is none",
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT count(*)::int AS held FROM information_schema.columns
            WHERE table_name='ticket_projection' AND column_name IN ('reason','resume_at')`,
        )
      ).rows,
      [{ held: 0 }],
    );
  });
});

test("the projection admits evidence only beside an escalation, and the desk reads it", async () => {
  await migrationDatabase("escalation_evidence", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(deletionPartition);
    await assert.rejects(
      subject.query(
        `INSERT INTO ticket_projection
           (tenant,project,ticket,phase,seq,escalation,escalation_evidence)
         VALUES('tenant-5','project-5',91,'Work',1,'NoEscalation','RuntimeVersionUnsupported')`,
      ),
      /ticket_projection_evidence_needs_an_escalation/u,
    );
    await subject.query(
      `INSERT INTO ticket_projection
         (tenant,project,ticket,phase,seq,escalation,escalation_evidence)
       VALUES('tenant-5','project-5',92,'Escalated',1,
              'WorkExecutionUnavailableEscalated','RuntimeVersionUnsupported'),
             ('tenant-5','project-5',93,'Escalated',1,
              'EvaluationFailureEscalated',NULL)`,
    );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT escalation_evidence FROM ticket_projection WHERE ticket IN (92,93) ORDER BY ticket",
        )
      ).rows,
      [
        { escalation_evidence: "RuntimeVersionUnsupported" },
        { escalation_evidence: null },
      ],
      "evidence is what an escalation may carry, not what it must",
    );
    for (const [role, privilege, table, column] of [
      [apiRole, "SELECT", "ticket_projection", "escalation"],
      [apiRole, "SELECT", "ticket_projection", "escalation_evidence"],
      [ticketServiceRole, "UPDATE", "ticket_projection", "escalation"],
      [ticketServiceRole, "UPDATE", "ticket_projection", "escalation_evidence"],
      [ticketServiceRole, "SELECT", "execution", "completion_operation"],
      [ticketServiceRole, "SELECT", "execution", "blocked_reason"],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            `SELECT has_column_privilege($1,'public.${table}',$2,$3) AS granted`,
            [role, column, privilege],
          )
        ).rows[0]?.granted,
        true,
        `${role} ${privilege} ${table}.${column}`,
      );
  });
});

test("the desk task takes the projection's roster and keeps the arm its settled rows are at", async () => {
  await migrationDatabase("escalation_desk", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${deletionJournalRow(1, "{}")}`);
    const task = async (
      index: number,
      escalation: string,
      state: string,
    ): Promise<unknown> =>
      subject.query(
        `INSERT INTO native_action
           (tenant,project,action,authorizing_seq,effect_position,ticket,
            action_version,kind,escalation,required_capability,state)
         VALUES('tenant-5','project-5',$1,1,$2,$3,1,'TicketEscalation',$4,'ResolveTicket',$5)`,
        [`action-${String(index)}`, index, index + 1, escalation, state],
      );
    for (const [index, kind] of escalationKinds.entries())
      await task(index, kind, "Withdrawn");
    assert.deepEqual(
      (
        await subject.query(
          "SELECT escalation FROM native_action ORDER BY effect_position",
        )
      ).rows,
      escalationKinds.map((escalation) => ({ escalation })),
    );
    await task(90, "DependencyRevoked", "Withdrawn");
    await assert.rejects(
      task(91, "DependencyRevoked", "Open"),
      /native_action_escalation_check/u,
      "the settled arm is the settled rows' and no live row reaches it",
    );
    await assert.rejects(
      task(92, escalationUnknown, "Withdrawn"),
      /native_action_escalation_check/u,
    );
  });
});

/**
 * An event at each shape the wipe leaves reachable, and the two vintages it
 * does not — read at the schema 008 left, the last one whose release tag
 * carries a fan-out.
 */
const escalationEvents: readonly (readonly [string, unknown, boolean])[] = [
  [
    "a block naming its ticket alone",
    { type: "ExecutionBlocked", value: { ticket: 1 } },
    true,
  ],
  ["a block naming no ticket", { type: "ExecutionBlocked", value: {} }, false],
  [
    "the release tag this image writes",
    {
      type: "CreateTicket",
      value: { ticket: 1, deps: [], prog: [], workFanout: 1 },
    },
    true,
  ],
  [
    "the release tag it was renamed from",
    {
      type: "ReleaseTicket",
      value: { ticket: 1, deps: [], prog: [], workFanout: 1 },
    },
    false,
  ],
  [
    "the finalization outcome this image writes",
    {
      type: "FinalizationResult",
      value: { ticket: 1, out: "FinalizationNeedsWork" },
    },
    true,
  ],
  [
    "the outcome it was renamed from",
    {
      type: "FinalizationResult",
      value: { ticket: 1, out: "FinalizationFailed" },
    },
    false,
  ],
];

test("the boundary admits a block that names only its ticket, and neither spelling the wipe retired", async () => {
  await migrationDatabase("escalation_events", async (subject) => {
    await installationAt(subject, migration008.version);
    for (const [label, event, admitted] of escalationEvents)
      assert.deepEqual(
        (
          await subject.query<{ admitted: boolean }>(
            "SELECT decision_event_is_valid($1::jsonb) AS admitted",
            [JSON.stringify(event)],
          )
        ).rows,
        [{ admitted }],
        label,
      );
  });
});

/** A running work execution the scheduler's door can conclude, and the wall it concludes at. */
const escalationExecution = `${deletionJournalRow(1, "{}")};
  UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
  INSERT INTO configuration_revision
    (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
  VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
  INSERT INTO input_bundle(tenant,project,bundle,digest)
  VALUES('tenant-5','project-5','bundle-5',repeat('b',64));
  INSERT INTO execution_request
    (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
     kind,capacity_account,configuration_revision,configuration_digest,
     input_bundle,input_bundle_digest)
  SELECT 'tenant-5','project-5','request-5',1,0,1,1,'SpawnWork',a.account,
         'revision-5','digest-5','bundle-5',repeat('b',64)
    FROM capacity_account a
   WHERE a.account=project_capacity_account('tenant-5','project-5');
  INSERT INTO execution_request_task(tenant,project,request,task,kind,cycle)
  VALUES('tenant-5','project-5','request-5',1,'Work',1);
  INSERT INTO execution
    (tenant,project,execution,ticket,task,source_request,account,cluster,
     configuration_revision,configuration_digest,status)
  SELECT 'tenant-5','project-5','execution-5',1,1,'request-5',a.account,a.cluster,
         'revision-5','digest-5','Running'
    FROM capacity_account a
   WHERE a.account=project_capacity_account('tenant-5','project-5')`;

const escalationWall = "ExecutionProfileUnavailable";

test("the scheduler's door journals a block naming its ticket and leaves the wall on the execution", async () => {
  await migrationDatabase("escalation_block", async (subject) => {
    await installationAt(subject, migration011.version);
    await subject.query(`${deletionPartition}\n${escalationExecution}`);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT result,operation FROM submit_task_completion
             ('tenant-5','project-5','execution-5',1,1,0,'Blocked',NULL,NULL,
              'WorkExecutionUnavailableEscalated','operation-escalated','subject-5')`,
        )
      ).rows,
      [{ result: "BindingMismatch", operation: null }],
      "the reason this door takes is a wall, not an escalation",
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT result,operation FROM submit_task_completion
             ('tenant-5','project-5','execution-5',1,1,0,'Blocked',NULL,NULL,$1,
              'operation-blocked','subject-5')`,
          [escalationWall],
        )
      ).rows,
      [{ result: "Submitted", operation: "operation-blocked" }],
    );
    assert.deepEqual(
      (
        await subject.query<{ event: unknown }>(
          "SELECT (command::jsonb)->'event' AS event FROM operation WHERE operation='operation-blocked'",
        )
      ).rows,
      [{ event: { type: "ExecutionBlocked", value: { ticket: 1 } } }],
      "the event names the ticket and nothing else",
    );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT status,outcome,blocked_reason FROM execution WHERE execution='execution-5'",
        )
      ).rows,
      [
        {
          status: "Terminal",
          outcome: "Blocked",
          blocked_reason: escalationWall,
        },
      ],
      "the wall stays evidence beside the execution",
    );
  });
});

test("the approval door writes a desk task at no escalation", async () => {
  await migrationDatabase("escalation_approval", async (subject) => {
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
    assert.deepEqual(
      (
        await subject.query(
          "SELECT escalation FROM native_action WHERE action='action-5'",
        )
      ).rows,
      [{ escalation: "NoEscalation" }],
    );
  });
});

test("a fresh install records the work fan-out leaving the ticket", async () => {
  await migrationDatabase("fanout_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration009.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration009.version],
        )
      ).rows,
      [
        {
          version: migration009.version,
          name: "a work set is one task, so a ticket authors no fan-out",
        },
      ],
    );
  });
});

test("a journal with an entry in it refuses the fan-out leaving and names the wipe", async () => {
  await migrationDatabase("fanout_guard", async (subject) => {
    await installationBefore(subject, migration009.version);
    await subject.query(`${deletionPartition}\n${journaledDecision}`);
    await assert.rejects(postgresMigrate(subject), /wipe-tickets\.sql/u);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name='dispatch_candidate' AND column_name='work_fanout'`,
        )
      ).rows,
      [{ column_name: "work_fanout" }],
      "the column the guard refused over is the column it left",
    );
    assert.deepEqual(
      (
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        )
      )
        .map(({ version }) => version)
        .at(-1),
      migration009.version - 1,
    );
  });
});

/** What a candidate hangs from: the project's dispatch view and the revision it was cut against. */
const fanoutDispatchView = `
  INSERT INTO configuration_revision
    (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
  VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
  INSERT INTO dispatch_view(tenant,project,recovery_epoch,watermark,schema_version,digest)
  VALUES('tenant-5','project-5','epoch-5',1,1,repeat('a',64))`;

function fanoutCandidate(ticket: number, version: number): string {
  return `INSERT INTO dispatch_candidate
       (tenant,project,ticket,ticket_version,program,
        configuration_revision,configuration_digest,configuration_canonical)
     VALUES('tenant-5','project-5',${String(ticket)},${String(version)},'[]',
            'revision-5','digest-5','{}')`;
}

test("a candidate publishes no width and keeps the floors that stood beside it", async () => {
  await migrationDatabase("fanout_candidate", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${fanoutDispatchView}`);
    await subject.query(fanoutCandidate(1, 1));
    assert.deepEqual(
      (
        await subject.query(
          `SELECT count(*)::int AS held FROM information_schema.columns
            WHERE table_name='dispatch_candidate' AND column_name='work_fanout'`,
        )
      ).rows,
      [{ held: 0 }],
    );
    for (const [what, ticket, version] of [
      ["a candidate for no ticket", 0, 1],
      ["a candidate at no version", 2, 0],
    ] as const)
      await assert.rejects(
        subject.query(fanoutCandidate(ticket, version)),
        /dispatch_candidate_check/u,
        what,
      );
  });
});

/** The release tag at each shape, and the width this image refuses to be told. */
const fanoutEvents: readonly (readonly [string, unknown, boolean])[] = [
  [
    "the release tag this image writes",
    { type: "CreateTicket", value: { ticket: 1, deps: [], prog: [] } },
    true,
  ],
  [
    "a release still naming the width it was authored at",
    {
      type: "CreateTicket",
      value: { ticket: 1, deps: [], prog: [], workFanout: 1 },
    },
    false,
  ],
  [
    "a release naming a width of none",
    {
      type: "CreateTicket",
      value: { ticket: 1, deps: [], prog: [], workFanout: null },
    },
    false,
  ],
];

test("the boundary admits a release that names no fan-out and refuses one that names any", async () => {
  await migrationDatabase("fanout_events", async (subject) => {
    await installationAt(subject, migration012.version);
    for (const [label, event, admitted] of fanoutEvents)
      assert.deepEqual(
        (
          await subject.query<{ admitted: boolean }>(
            "SELECT decision_event_is_valid($1::jsonb) AS admitted",
            [JSON.stringify(event)],
          )
        ).rows,
        [{ admitted }],
        label,
      );
  });
});

/** The validator the fan-out left, named as the grants that govern it name it. */
const fanoutValidator = "public.decision_event_is_valid(jsonb)";

test("the validator replaced whole stays the boundary owner's and nobody's to execute", async () => {
  await migrationDatabase("fanout_validator", async (subject) => {
    await postgresMigrate(subject);
    for (const role of [apiRole, ticketServiceRole, "public"])
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [role, fanoutValidator],
          )
        ).rows[0]?.granted,
        false,
        role,
      );
    assert.equal(
      (
        await subject.query<{ owner: string }>(
          "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = $1::regprocedure",
          [fanoutValidator],
        )
      ).rows[0]?.owner,
      boundaryOwnerRole,
    );
  });
});

test("a fresh install records the task identity arriving in columns", async () => {
  await migrationDatabase("identity_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration010.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration010.version],
        )
      ).rows,
      [
        {
          version: migration010.version,
          name: "a task is named by its cycle, its stage, its generation and its evaluator",
        },
      ],
    );
  });
});

test("a journal with an entry in it refuses the identity arriving and names the wipe", async () => {
  await migrationDatabase("identity_guard", async (subject) => {
    await installationBefore(subject, migration010.version);
    await subject.query(`${deletionPartition}\n${journaledDecision}`);
    await assert.rejects(postgresMigrate(subject), /wipe-tickets\.sql/u);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT count(*)::int AS held FROM information_schema.columns
           WHERE table_name='execution_request_task' AND column_name='cycle'`,
        )
      ).rows,
      [{ held: 0 }],
      "the column the guard refused over is a column it never added",
    );
    assert.deepEqual(
      (
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        )
      )
        .map(({ version }) => version)
        .at(-1),
      migration010.version - 1,
    );
  });
});

/** What a request task hangs from: a journalled decision, a revision and the request it authorized. */
const identityRequest = `${deletionJournalRow(1, "{}")};
  INSERT INTO configuration_revision
    (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
  VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
  INSERT INTO input_bundle(tenant,project,bundle,digest)
  VALUES('tenant-5','project-5','bundle-5',repeat('b',64));
  INSERT INTO execution_request
    (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
     kind,capacity_account,configuration_revision,configuration_digest,
     input_bundle,input_bundle_digest)
  SELECT 'tenant-5','project-5','request-5',1,0,1,1,'SpawnWork',a.account,
         'revision-5','digest-5','bundle-5',repeat('b',64)
    FROM capacity_account a
   WHERE a.account=project_capacity_account('tenant-5','project-5')`;

function identityTask(task: number, columns: string, values: string): string {
  return `INSERT INTO execution_request_task(tenant,project,request,task,${columns})
     VALUES('tenant-5','project-5','request-5',${String(task)},${values})`;
}

/** Every shape an identity can arrive in, and what the relation answers it. */
const identityShapes: readonly (readonly [
  string,
  string,
  string,
  RegExp | undefined,
])[] = [
  ["a work task naming its cycle", "kind,cycle", "'Work',1", undefined],
  [
    "an evaluation naming the whole of one",
    "kind,cycle,stage,generation,evaluator",
    "'Evaluation',1,1,1,1",
    undefined,
  ],
  ["a task naming no cycle at all", "kind", "'Work'", /cycle/u],
  [
    "a work task at a cycle of none",
    "kind,cycle",
    "'Work',0",
    /execution_request_task_check/u,
  ],
  [
    "a work task that also names a stage",
    "kind,cycle,stage",
    "'Work',1,1",
    /execution_request_task_check/u,
  ],
  [
    "a work task that also names a generation",
    "kind,cycle,generation",
    "'Work',1,1",
    /execution_request_task_check/u,
  ],
  [
    "a work task that also names an evaluator",
    "kind,cycle,evaluator",
    "'Work',1,1",
    /execution_request_task_check/u,
  ],
  [
    "an evaluation at the stage index this column used to take",
    "kind,cycle,stage,generation,evaluator",
    "'Evaluation',1,0,1,1",
    /execution_request_task_check/u,
  ],
  [
    "an evaluation naming no stage",
    "kind,cycle,generation,evaluator",
    "'Evaluation',1,1,1",
    /execution_request_task_check/u,
  ],
  [
    "an evaluation naming no generation",
    "kind,cycle,stage,evaluator",
    "'Evaluation',1,1,1",
    /execution_request_task_check/u,
  ],
  [
    "an evaluation naming no evaluator",
    "kind,cycle,stage,generation",
    "'Evaluation',1,1,1",
    /execution_request_task_check/u,
  ],
];

test("a request task carries a whole identity for its kind and no half of one", async () => {
  await migrationDatabase("identity_columns", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${identityRequest}`);
    for (const [
      order,
      [what, columns, values, refused],
    ] of identityShapes.entries()) {
      const insert = identityTask(order + 1, columns, values);
      if (refused === undefined) await subject.query(insert);
      else await assert.rejects(subject.query(insert), refused, what);
    }
  });
});

/** Every source the relation admits an execution under, and the one no task names any more. */
const identitySources: readonly (readonly [string, string, boolean])[] = [
  ["a requirement a task named for itself", "ExplicitTask", false],
  ["a requirement its kind named", "TaskKindDefault", true],
  ["a requirement its ticket named", "TicketDefault", true],
  ["the platform's requirement", "PlatformDefault", true],
];

function identityRegistration(task: number, source: string): string {
  return `INSERT INTO execution
     (tenant,project,execution,ticket,task,source_request,account,cluster,
      configuration_revision,configuration_digest,requirement_identity,
      requirement_value,requirement_digest,requirement_source,
      platform_default_version,status)
   SELECT 'tenant-5','project-5','execution-${source}',1,${String(task)},'request-5',
          a.account,a.cluster,'revision-5','digest-5','requirement-${source}',
          '{"mode":"Container","operatingSystem":"Linux","architecture":"Amd64","image":"worker"}'::jsonb,
          repeat('e',64),'${source}',1,'Running'
     FROM capacity_account a
    WHERE a.account=project_capacity_account('tenant-5','project-5')`;
}

test("an execution registered under a requirement a task named is refused", async () => {
  await migrationDatabase("identity_sources", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(`${deletionPartition}\n${identityRequest}`);
    await subject.query(identityTask(1, "kind,cycle", "'Work',1"));
    for (const evaluator of [1, 2, 3]) {
      await subject.query(
        identityTask(
          evaluator + 1,
          "kind,cycle,stage,generation,evaluator",
          `'Evaluation',1,1,1,${String(evaluator)}`,
        ),
      );
    }
    for (const [order, [what, source, admitted]] of identitySources.entries()) {
      const insert = identityRegistration(order + 1, source);
      if (admitted) await subject.query(insert);
      else
        await assert.rejects(
          subject.query(insert),
          /execution_requirement_source_known/u,
          what,
        );
    }
  });
});

/** The identity as the relation holds it, in the order the columns arrived. */
const identityColumns = [
  "tenant",
  "project",
  "request",
  "task",
  "kind",
  "stage",
  "cycle",
  "generation",
  "evaluator",
];

test("the api reads every column of the identity and writes none of them", async () => {
  await migrationDatabase("identity_grants", async (subject) => {
    await postgresMigrate(subject);
    const columns = await subject.query<{ column: string; granted: boolean }>(
      `SELECT a.attname AS column,
              has_column_privilege($1,'execution_request_task',a.attname,'SELECT') AS granted
         FROM pg_attribute a
        WHERE a.attrelid='execution_request_task'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [apiRole],
    );
    assert.deepEqual(
      columns.rows.map((each) => each.column),
      identityColumns,
      "the relation holds the identity and nothing beside it",
    );
    assert.deepEqual(
      columns.rows.filter((each) => each.granted).map((each) => each.column),
      identityColumns,
      `what ${apiRole} may read of execution_request_task`,
    );
    for (const privilege of ["INSERT", "UPDATE", "DELETE"] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'execution_request_task',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        false,
        `${apiRole} holds ${privilege} on execution_request_task`,
      );
  });
});

/** A completion at each identity, and each way of naming one this image refuses. */
const identityEvents: readonly (readonly [string, unknown, boolean])[] = [
  [
    "a completion naming the work task it settled",
    { type: "WorkTask", value: { ticket: 1, cycle: 1 } },
    true,
  ],
  [
    "a completion naming the evaluator it settled",
    {
      type: "EvaluationTask",
      value: { ticket: 1, workCycle: 1, stage: 1, generation: 1, evaluator: 1 },
    },
    true,
  ],
  [
    "a completion naming a work task at no cycle",
    { type: "WorkTask", value: { ticket: 1 } },
    false,
  ],
  [
    "a completion naming an evaluator at no generation",
    {
      type: "EvaluationTask",
      value: { ticket: 1, workCycle: 1, stage: 1, evaluator: 1 },
    },
    false,
  ],
  [
    "a completion naming an evaluation the work arm's way",
    { type: "EvaluationTask", value: { ticket: 1, cycle: 1 } },
    false,
  ],
  [
    "a completion naming a task this machine has no constructor for",
    { type: "Task", value: { ticket: 1, cycle: 1 } },
    false,
  ],
  ["a completion whose task is the number it used to be", 1, false],
];

function identityCompletion(task: unknown): unknown {
  return {
    type: "TaskDone",
    value: {
      ticket: 1,
      task,
      verdict: "Pass",
      result: { manifest: 1, digest: 1, schema: 1 },
    },
  };
}

test("the boundary admits a completion that names its task and refuses one that numbers it", async () => {
  await migrationDatabase("identity_events", async (subject) => {
    await installationAt(subject, migration010.version);
    for (const [label, task, admitted] of identityEvents)
      assert.deepEqual(
        (
          await subject.query<{ admitted: boolean }>(
            "SELECT decision_event_is_valid($1::jsonb) AS admitted",
            [JSON.stringify(identityCompletion(task))],
          )
        ).rows,
        [{ admitted }],
        label,
      );
    for (const [label, event] of [
      [
        "a completion naming the number and no identity",
        {
          type: "TaskDone",
          value: {
            ticket: 1,
            tid: 1,
            verdict: "Pass",
            result: { manifest: 1, digest: 1, schema: 1 },
          },
        },
      ],
      [
        "a completion naming both the identity and the number",
        {
          type: "TaskDone",
          value: {
            ticket: 1,
            tid: 1,
            task: { type: "WorkTask", value: { ticket: 1, cycle: 1 } },
            verdict: "Pass",
            result: { manifest: 1, digest: 1, schema: 1 },
          },
        },
      ],
    ] as const)
      assert.deepEqual(
        (
          await subject.query<{ admitted: boolean }>(
            "SELECT decision_event_is_valid($1::jsonb) AS admitted",
            [JSON.stringify(event)],
          )
        ).rows,
        [{ admitted: false }],
        label,
      );
  });
});

/**
 * A running execution at an identity its request authorized, ready for the
 * scheduler's door, carrying the verdict a worker attested — or, at `null`, no
 * result at all, which is every execution the door is asked to block.
 */
function identityExecution(
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

/** Each kind of task the door settles, the identity its row carries and the identity it journals. */
const identityCompletions: readonly (readonly [
  string,
  number,
  string,
  string,
  string,
  unknown,
])[] = [
  [
    "the work task it settled, at the cycle its row carries",
    1,
    "SpawnWork",
    "kind,cycle",
    "'Work',3",
    { type: "WorkTask", value: { ticket: 1, cycle: 3 } },
  ],
  [
    "the evaluator it settled, at the stage and generation its row carries",
    2,
    "SpawnEvaluation",
    "kind,cycle,stage,generation,evaluator",
    "'Evaluation',2,4,5,6",
    {
      type: "EvaluationTask",
      value: { ticket: 1, workCycle: 2, stage: 4, generation: 5, evaluator: 6 },
    },
  ],
];

test("the scheduler's door journals the identity it read off the task it settled", async () => {
  await migrationDatabase("identity_completion", async (subject) => {
    await installationAt(subject, migration012.version);
    await subject.query(
      `${deletionPartition}\n${deletionJournalRow(1, "{}")};
       UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
       INSERT INTO configuration_revision
         (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
       VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
       INSERT INTO input_bundle(tenant,project,bundle,digest)
       VALUES('tenant-5','project-5','bundle-5',repeat('b',64))`,
    );
    for (const [
      what,
      ordinal,
      requestKind,
      columns,
      values,
      identity,
    ] of identityCompletions) {
      const at = String(ordinal);
      await subject.query(
        identityExecution(ordinal, requestKind, columns, values),
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT result,operation FROM submit_task_completion
               ('tenant-5','project-5','execution-${at}',1,${at},${at},'Passed',
                'manifest-${at}',repeat('d',64),NULL,'operation-done-${at}','subject-5')`,
          )
        ).rows,
        [{ result: "Submitted", operation: `operation-done-${at}` }],
        what,
      );
      assert.deepEqual(
        (
          await subject.query<{ task: unknown; numbered: boolean }>(
            `SELECT (command::jsonb)#>'{event,value,task}' AS task,
                    ((command::jsonb)#>'{event,value}') ? 'tid' AS numbered
               FROM operation WHERE operation='operation-done-${at}'`,
          )
        ).rows,
        [{ task: identity, numbered: false }],
        what,
      );
    }
  });
});

/** The door replaced whole, named as the grants that govern it name it. */
const identityDoor =
  "public.submit_task_completion(text,text,text,bigint,bigint,integer,text,text,text,text,text,text)";

test("the door replaced whole keeps its owner and the one role that may open it", async () => {
  await migrationDatabase("identity_door", async (subject) => {
    await postgresMigrate(subject);
    for (const [role, granted] of [
      [schedulerRole, true],
      [apiRole, false],
      [ticketServiceRole, false],
      ["public", false],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [role, identityDoor],
          )
        ).rows[0]?.granted,
        granted,
        role,
      );
    assert.equal(
      (
        await subject.query<{ owner: string }>(
          "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = $1::regprocedure",
          [identityDoor],
        )
      ).rows[0]?.owner,
      boundaryOwnerRole,
    );
  });
});

test("a fresh install records the stage becoming the roster it runs", async () => {
  await migrationDatabase("evaluatorkeys_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration011.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration011.version],
        )
      ).rows,
      [
        {
          version: migration011.version,
          name: "a stage names the evaluators it runs, and its key is its place",
        },
      ],
    );
  });
});

/** A program at each shape, and every one this image refuses to be handed. */
const evaluatorKeyPrograms: readonly (readonly [string, unknown, boolean])[] = [
  [
    "a stage naming the evaluators it runs, keyed as the author keyed them",
    [{ key: 1, evaluators: [{ key: 1 }, { key: 3 }] }],
    true,
  ],
  [
    "a program whose stages are keyed by the places they hold",
    [
      { key: 1, evaluators: [{ key: 1 }] },
      { key: 2, evaluators: [{ key: 2 }] },
    ],
    true,
  ],
  [
    "a stage still naming the width it was authored at",
    [{ key: 1, fanout: 1, evaluators: [{ key: 1 }] }],
    false,
  ],
  [
    "a stage keyed anywhere but the place it holds",
    [{ key: 2, evaluators: [{ key: 1 }] }],
    false,
  ],
  [
    "a stage that runs no evaluator at all",
    [{ key: 1, evaluators: [] }],
    false,
  ],
  [
    "a stage naming one evaluator twice",
    [{ key: 1, evaluators: [{ key: 1 }, { key: 1 }] }],
    false,
  ],
  [
    "a stage naming an evaluator no ticket can spawn",
    [{ key: 1, evaluators: [{ key: 0 }] }],
    false,
  ],
  [
    "a stage combined a way this machine has no name for",
    [{ key: 1, evaluators: [{ key: 1 }], combinator: "AnyPass" }],
    false,
  ],
  ["a stage with no key at all", [{ evaluators: [{ key: 1 }] }], false],
  ["a stage keyed by text", [{ key: "1", evaluators: [{ key: 1 }] }], false],
  [
    "an evaluator keyed by text",
    [{ key: 1, evaluators: [{ key: "1" }] }],
    false,
  ],
  ["a stage whose evaluators are a number", [{ key: 1, evaluators: 3 }], false],
];

function evaluatorKeyRelease(prog: unknown): unknown {
  return { type: "CreateTicket", value: { ticket: 1, deps: [], prog } };
}

test("a journal with an entry in it refuses the roster arriving and names the wipe", async () => {
  await migrationDatabase("evaluatorkeys_guard", async (subject) => {
    await installationBefore(subject, migration011.version);
    await subject.query(`${deletionPartition}\n${journaledDecision}`);
    await assert.rejects(postgresMigrate(subject), /wipe-tickets\.sql/u);
    assert.deepEqual(
      (
        await subject.query<{ admitted: boolean }>(
          "SELECT decision_event_is_valid($1::jsonb) AS admitted",
          [JSON.stringify(evaluatorKeyRelease([{ fanout: 1 }]))],
        )
      ).rows,
      [{ admitted: true }],
      "the shape the guard refused over is the shape it left admitted",
    );
    assert.deepEqual(
      (
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        )
      )
        .map(({ version }) => version)
        .at(-1),
      migration011.version - 1,
    );
  });
});

test("the boundary admits a program that names its evaluators and refuses one that counts them", async () => {
  await migrationDatabase("evaluatorkeys_events", async (subject) => {
    await installationAt(subject, migration012.version);
    for (const [label, prog, admitted] of evaluatorKeyPrograms)
      assert.deepEqual(
        (
          await subject.query<{ admitted: boolean }>(
            "SELECT decision_event_is_valid($1::jsonb) AS admitted",
            [JSON.stringify(evaluatorKeyRelease(prog))],
          )
        ).rows,
        [{ admitted }],
        label,
      );
  });
});

/**
 * The mailbox bound and the seeded budget move together, as they did at 009:
 * a stage weighs its roster, so the widest observation is wider and the
 * floor argued from it follows.
 */
test("the roster arriving widens the mailbox bound and re-seeds the budget with it", async () => {
  await migrationDatabase("evaluatorkeys_mailbox", async (subject) => {
    await postgresMigrate(subject);
    const bound = (
      await subject.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
          WHERE c.conrelid = 'session_turn'::regclass
            AND c.conname = 'session_turn_text_is_bounded'`,
      )
    ).rows[0]?.definition;
    assert.ok(bound !== undefined, "the mailbox bound was not found");
    assert.ok(bound.includes(String(leadObservationTokensPerDecisionAt011)));
    assert.ok(!bound.includes(String(leadObservationTokensPerDecisionAt009)));
    for (const relation of [
      "selector_runtime_settings",
      "selector_runtime_settings_history",
    ]) {
      const rows = (
        await subject.query<{ controls: string }>(
          `SELECT controls FROM ${relation}`,
        )
      ).rows;
      assert.ok(rows.length >= 1, `${relation} is seeded`);
      for (const { controls } of rows) {
        assert.ok(
          controls.includes(
            `"tokensPerDecision":${String(leadObservationTokensPerDecisionAt011)}`,
          ),
          `${relation} carries the re-seeded budget`,
        );
        assert.ok(
          !controls.includes(String(leadObservationTokensPerDecisionAt009)),
          `${relation} no longer carries 009's`,
        );
      }
    }
  });
});

test("a fresh install records the completion carrying a report", async () => {
  await migrationDatabase("taskreport_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration012.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration012.version],
        )
      ).rows,
      [
        {
          version: migration012.version,
          name: "a completion carries the report its task terminated under",
        },
      ],
    );
  });
});

/** The result a produced report carries, as the codec spells a reference to one. */
const reportResultRef = { manifest: 1, digest: 1, schema: 1 };

/** Each report a completion may carry, and each way of carrying one this image refuses. */
const taskReports: readonly (readonly [string, unknown, boolean])[] = [
  [
    "a work task reporting the result it produced",
    { type: "WorkResultReport", value: { result: reportResultRef } },
    true,
  ],
  [
    "a work result whose manifest is named by text",
    {
      type: "WorkResultReport",
      value: { result: { ...reportResultRef, manifest: "1" } },
    },
    false,
  ],
  [
    "a work result that produced nothing to reference",
    { type: "WorkResultReport", value: {} },
    false,
  ],
  [
    "an evaluator reporting the verdict it reached",
    {
      type: "EvaluationResultReport",
      value: { result: reportResultRef, verdict: "EvaluatorFail" },
    },
    true,
  ],
  [
    "an evaluator reporting the verdict the manifest attested instead of its own",
    {
      type: "EvaluationResultReport",
      value: { result: reportResultRef, verdict: "Fail" },
    },
    false,
  ],
  [
    "an evaluator reporting a result at no verdict at all",
    { type: "EvaluationResultReport", value: { result: reportResultRef } },
    false,
  ],
  [
    "a task reporting the wall its execution hit",
    {
      type: "TerminalFailureReport",
      value: { evidence: 1, kind: "ExecutionUnavailableFailure" },
    },
    true,
  ],
  [
    "a task reporting the process that died under it",
    {
      type: "TerminalFailureReport",
      value: { evidence: 1, kind: "ProcessFailure" },
    },
    true,
  ],
  [
    "a failure at a kind this machine has no name for",
    {
      type: "TerminalFailureReport",
      value: { evidence: 1, kind: "EvaluatorProcessFailed" },
    },
    false,
  ],
  [
    "a failure at no kind at all",
    { type: "TerminalFailureReport", value: { evidence: 1 } },
    false,
  ],
  [
    "a failure naming no evidence a reader could open",
    { type: "TerminalFailureReport", value: { kind: "ProcessFailure" } },
    false,
  ],
  [
    "a failure whose evidence is named by text",
    {
      type: "TerminalFailureReport",
      value: { evidence: "1", kind: "ProcessFailure" },
    },
    false,
  ],
  [
    "a report naming the ticket its task already names",
    {
      type: "TerminalFailureReport",
      value: { ticket: 1, evidence: 1, kind: "ProcessFailure" },
    },
    false,
  ],
  [
    "a report at a constructor this machine has none of",
    { type: "TaskTerminal", value: { evidence: 1, kind: "ProcessFailure" } },
    false,
  ],
  [
    "a fourth constructor carrying a well-formed judgement",
    {
      type: "TaskJudgementReport",
      value: {
        result: { manifest: 1, digest: 1, schema: 1 },
        verdict: "EvaluatorPass",
      },
    },
    false,
  ],
  ["a report that is the text of one", "TerminalFailureReport", false],
];

function taskReportCompletion(report: unknown): unknown {
  return {
    type: "TaskDone",
    value: {
      ticket: 1,
      task: { type: "WorkTask", value: { ticket: 1, cycle: 1 } },
      report,
    },
  };
}

/** The completion the vintage before this one wrote, which is what the guard is for. */
const attestedCompletion = {
  type: "TaskDone",
  value: {
    ticket: 1,
    task: { type: "WorkTask", value: { ticket: 1, cycle: 1 } },
    verdict: "Pass",
    result: reportResultRef,
  },
};

/** The whole events this image refuses, each for something the report replaced. */
const taskReportRefused: readonly (readonly [string, unknown])[] = [
  [
    "a completion attesting a verdict beside the report it carries",
    {
      type: "TaskDone",
      value: {
        ticket: 1,
        task: { type: "WorkTask", value: { ticket: 1, cycle: 1 } },
        verdict: "Pass",
        report: {
          type: "WorkResultReport",
          value: { result: reportResultRef },
        },
      },
    },
  ],
  [
    "a completion picking the edge a failed stage is taken on",
    {
      type: "TaskDone",
      value: {
        ticket: 1,
        task: { type: "WorkTask", value: { ticket: 1, cycle: 1 } },
        onFailure: "ReworkEvaluationFailure",
        report: {
          type: "WorkResultReport",
          value: { result: reportResultRef },
        },
      },
    },
  ],
  ["the completion the vintage before this one wrote", attestedCompletion],
  [
    "the reduce a failed stage used to be concluded by",
    {
      type: "EvalReduce",
      value: { ticket: 1, onFailure: "ReworkEvaluationFailure" },
    },
  ],
  [
    "the block that named a ticket rather than the task whose wall it was",
    { type: "ExecutionBlocked", value: { ticket: 1 } },
  ],
  [
    "a release naming its dependencies and no program",
    { type: "CreateTicket", value: { ticket: 1, deps: [] } },
  ],
  [
    "a release naming its program and no dependencies",
    {
      type: "CreateTicket",
      value: { ticket: 1, prog: [{ key: 1, evaluators: [{ key: 1 }] }] },
    },
  ],
];

test("a journal with an entry in it refuses the report arriving and names the wipe", async () => {
  await migrationDatabase("taskreport_guard", async (subject) => {
    await installationBefore(subject, migration012.version);
    await subject.query(`${deletionPartition}\n${journaledDecision}`);
    await assert.rejects(postgresMigrate(subject), /wipe-tickets\.sql/u);
    assert.deepEqual(
      (
        await subject.query<{ admitted: boolean }>(
          "SELECT decision_event_is_valid($1::jsonb) AS admitted",
          [JSON.stringify(attestedCompletion)],
        )
      ).rows,
      [{ admitted: true }],
      "the shape the guard refused over is the shape it left admitted",
    );
    assert.deepEqual(
      (
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        )
      )
        .map(({ version }) => version)
        .at(-1),
      migration012.version - 1,
    );
  });
});

test("the boundary admits a completion that reports what its task produced and refuses one that attests a verdict", async () => {
  await migrationDatabase("taskreport_events", async (subject) => {
    await installationAt(subject, migration012.version);
    for (const [label, report, admitted] of taskReports)
      assert.deepEqual(
        (
          await subject.query<{ admitted: boolean }>(
            "SELECT decision_event_is_valid($1::jsonb) AS admitted",
            [JSON.stringify(taskReportCompletion(report))],
          )
        ).rows,
        [{ admitted }],
        label,
      );
    for (const [label, event] of taskReportRefused)
      assert.deepEqual(
        (
          await subject.query<{ admitted: boolean }>(
            "SELECT decision_event_is_valid($1::jsonb) AS admitted",
            [JSON.stringify(event)],
          )
        ).rows,
        [{ admitted: false }],
        label,
      );
  });
});

/**
 * Each task the door settles, what its row carries, and the report it journals:
 * a produced work result, an evaluator's own verdict, a work task that produced
 * none, an evaluator whose execution never ran, and an evaluator whose process
 * died with its retries.
 */
const taskReportCompletions: readonly (readonly [
  string,
  number,
  string,
  string,
  string,
  "Pass" | "Fail" | null,
  string,
  (digest: number) => unknown,
])[] = [
  [
    "the work task that produced a result",
    1,
    "SpawnWork",
    "kind,cycle",
    "'Work',3",
    "Pass",
    "'Passed','manifest-1',repeat('d',64),NULL",
    (digest) => ({
      ticket: 1,
      task: { type: "WorkTask", value: { ticket: 1, cycle: 3 } },
      report: {
        type: "WorkResultReport",
        value: { result: { manifest: 1, digest, schema: 1 } },
      },
    }),
  ],
  [
    "the evaluator that reached a verdict of its own",
    2,
    "SpawnEvaluation",
    "kind,cycle,stage,generation,evaluator",
    "'Evaluation',2,4,5,6",
    "Fail",
    "'Failed','manifest-2',repeat('d',64),NULL",
    (digest) => ({
      ticket: 1,
      task: {
        type: "EvaluationTask",
        value: {
          ticket: 1,
          workCycle: 2,
          stage: 4,
          generation: 5,
          evaluator: 6,
        },
      },
      report: {
        type: "EvaluationResultReport",
        value: {
          result: { manifest: 2, digest, schema: 1 },
          verdict: "EvaluatorFail",
        },
      },
    }),
  ],
  [
    "the work task that produced none",
    3,
    "SpawnWork",
    "kind,cycle",
    "'Work',7",
    "Fail",
    "'Failed','manifest-3',repeat('d',64),NULL",
    () => ({
      ticket: 1,
      task: { type: "WorkTask", value: { ticket: 1, cycle: 7 } },
      report: {
        type: "TerminalFailureReport",
        value: { evidence: 3, kind: "ProcessFailure" },
      },
    }),
  ],
  [
    "the evaluator whose execution hit a definitive wall",
    4,
    "SpawnEvaluation",
    "kind,cycle,stage,generation,evaluator",
    "'Evaluation',8,9,10,11",
    null,
    "'Blocked',NULL,NULL,'ExecutionProfileUnavailable'",
    () => ({
      ticket: 1,
      task: {
        type: "EvaluationTask",
        value: {
          ticket: 1,
          workCycle: 8,
          stage: 9,
          generation: 10,
          evaluator: 11,
        },
      },
      report: {
        type: "TerminalFailureReport",
        value: { evidence: 4, kind: "ExecutionUnavailableFailure" },
      },
    }),
  ],
  [
    "the evaluator whose process died under the manifest the scheduler sealed",
    5,
    "SpawnEvaluation",
    "kind,cycle,stage,generation,evaluator",
    "'Evaluation',12,13,14,15",
    "Fail",
    "'ProcessFailed','manifest-5',repeat('d',64),NULL",
    () => ({
      ticket: 1,
      task: {
        type: "EvaluationTask",
        value: {
          ticket: 1,
          workCycle: 12,
          stage: 13,
          generation: 14,
          evaluator: 15,
        },
      },
      report: {
        type: "TerminalFailureReport",
        value: { evidence: 5, kind: "ProcessFailure" },
      },
    }),
  ],
  [
    "the work task whose process died the same way",
    6,
    "SpawnWork",
    "kind,cycle",
    "'Work',16",
    "Fail",
    "'ProcessFailed','manifest-6',repeat('d',64),NULL",
    () => ({
      ticket: 1,
      task: { type: "WorkTask", value: { ticket: 1, cycle: 16 } },
      report: {
        type: "TerminalFailureReport",
        value: { evidence: 6, kind: "ProcessFailure" },
      },
    }),
  ],
];

test("the scheduler's door journals the report the task it settled terminated under", async () => {
  await migrationDatabase("taskreport_completion", async (subject) => {
    await installationAt(subject, migration012.version);
    await subject.query(
      `${deletionPartition}\n${deletionJournalRow(1, "{}")};
       UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
       INSERT INTO configuration_revision
         (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
       VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
       INSERT INTO input_bundle(tenant,project,bundle,digest)
       VALUES('tenant-5','project-5','bundle-5',repeat('b',64))`,
    );
    const folded = (
      await subject.query<{ digest: string }>(
        "SELECT result_digest_fold(repeat('d',64)) AS digest",
      )
    ).rows[0]?.digest;
    assert.ok(folded !== undefined, "the digest fold answered nothing");
    for (const [
      what,
      ordinal,
      requestKind,
      columns,
      values,
      verdict,
      submission,
      expected,
    ] of taskReportCompletions) {
      const at = String(ordinal);
      await subject.query(
        identityExecution(ordinal, requestKind, columns, values, verdict),
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT result,operation FROM submit_task_completion
               ('tenant-5','project-5','execution-${at}',1,${at},${at},${submission},
                'operation-report-${at}','subject-5')`,
          )
        ).rows,
        [{ result: "Submitted", operation: `operation-report-${at}` }],
        what,
      );
      assert.deepEqual(
        (
          await subject.query<{ journalled: unknown }>(
            `SELECT (command::jsonb)#>'{event,value}' AS journalled
               FROM operation WHERE operation='operation-report-${at}'`,
          )
        ).rows,
        [{ journalled: expected(Number(folded)) }],
        what,
      );
    }
    assert.deepEqual(
      (
        await subject.query<{ outcome: string }>(
          `SELECT outcome FROM execution
             WHERE execution IN ('execution-5','execution-6') ORDER BY execution`,
        )
      ).rows,
      [{ outcome: "ProcessFailed" }, { outcome: "ProcessFailed" }],
      "a death the door was told of is the outcome the execution records",
    );
  });
});

test("a fresh install records the ticket released as a definition", async () => {
  await migrationDatabase("released_install", async (subject) => {
    assert.ok((await postgresMigrate(subject)).includes(migration013.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration013.version],
        )
      ).rows,
      [
        {
          version: migration013.version,
          name: "a ticket is released as a definition, and runs at the source it was dispatched from",
        },
      ],
    );
  });
});

/** The four references a task definition is, as a release carries one. */
const releasedWorkDefinition = {
  workload: 1,
  inputs: 2,
  executionRequirements: 3,
  resultContract: 4,
};

/** The definition the stage's evaluators carry, one each, so a read of one can miss. */
const releasedEvaluatorDefinition = {
  workload: 5,
  inputs: 6,
  executionRequirements: 7,
  resultContract: 8,
};

const releasedSecondDefinition = {
  workload: 9,
  inputs: 10,
  executionRequirements: 11,
  resultContract: 12,
};

/** The released ticket every case below varies one field of. */
const releasedWhole = {
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

function releasedEvent(value: unknown): unknown {
  return { type: "CreateTicket", value };
}

function releasedWithout(field: string): unknown {
  const value: Record<string, unknown> = { ...releasedWhole };
  delete value[field];
  return releasedEvent(value);
}

/** Every release this image admits, and every way of naming one it refuses. */
const releasedTickets: readonly (readonly [string, unknown, boolean])[] = [
  [
    "a ticket released as the whole definition it runs at",
    releasedEvent(releasedWhole),
    true,
  ],
  [
    "a ticket released with nothing to wait on and one evaluator to pass",
    releasedEvent({
      ...releasedWhole,
      dependencies: [],
      evaluationPlan: {
        stages: [
          {
            key: 1,
            evaluators: [{ key: 1, task: releasedEvaluatorDefinition }],
          },
        ],
      },
    }),
    true,
  ],
  [
    "the release the vintage before this one wrote",
    releasedEvent({
      ticket: 1,
      deps: [],
      prog: [{ key: 1, evaluators: [{ key: 1 }] }],
    }),
    false,
  ],
  [
    "a release naming its dependencies and its program beside the definition",
    releasedEvent({ ...releasedWhole, deps: [], prog: [] }),
    false,
  ],
  ["a release naming no ticket at all", releasedWithout("id"), false],
  [
    "a release whose ticket is the number no ticket is",
    releasedEvent({ ...releasedWhole, id: 0 }),
    false,
  ],
  [
    "a release whose content is the number no reference is",
    releasedEvent({ ...releasedWhole, content: 0 }),
    false,
  ],
  [
    "a release whose finalization is the number no reference is",
    releasedEvent({ ...releasedWhole, finalizationConfiguration: 0 }),
    false,
  ],
  [
    "a release naming no definition its work runs at",
    releasedWithout("workConfiguration"),
    false,
  ],
  [
    "a release whose work definition names no contract to attest",
    releasedEvent({
      ...releasedWhole,
      workConfiguration: {
        workload: 1,
        inputs: 2,
        executionRequirements: 3,
      },
    }),
    false,
  ],
  [
    "a release whose work definition names its workload by text",
    releasedEvent({
      ...releasedWhole,
      workConfiguration: { ...releasedWorkDefinition, workload: "1" },
    }),
    false,
  ],
  [
    "a release naming no dependencies at all",
    releasedWithout("dependencies"),
    false,
  ],
  [
    "a release waiting on the same ticket twice",
    releasedEvent({ ...releasedWhole, dependencies: [2, 2] }),
    false,
  ],
  [
    "a release waiting on the ticket no ticket is",
    releasedEvent({ ...releasedWhole, dependencies: [0] }),
    false,
  ],
  [
    "a release naming no plan its evaluators run",
    releasedWithout("evaluationPlan"),
    false,
  ],
  [
    "a release whose plan is the list its stages used to be",
    releasedEvent({ ...releasedWhole, evaluationPlan: [] }),
    false,
  ],
  [
    "a release whose evaluator names no definition of its own",
    releasedEvent({
      ...releasedWhole,
      evaluationPlan: { stages: [{ key: 1, evaluators: [{ key: 1 }] }] },
    }),
    false,
  ],
  [
    "a release whose stage is keyed somewhere other than its place",
    releasedEvent({
      ...releasedWhole,
      evaluationPlan: {
        stages: [
          {
            key: 2,
            evaluators: [{ key: 1, task: releasedEvaluatorDefinition }],
          },
        ],
      },
    }),
    false,
  ],
  [
    "a release whose stage runs one evaluator under two names of the same key",
    releasedEvent({
      ...releasedWhole,
      evaluationPlan: {
        stages: [
          {
            key: 1,
            evaluators: [
              { key: 1, task: releasedEvaluatorDefinition },
              { key: 1, task: releasedSecondDefinition },
            ],
          },
        ],
      },
    }),
    false,
  ],
  [
    "a release whose stage runs no evaluator at all",
    releasedEvent({
      ...releasedWhole,
      evaluationPlan: { stages: [{ key: 1, evaluators: [] }] },
    }),
    false,
  ],
];

/** The dispatch carries the source it was taken at, and no dispatch carries none. */
const releasedDispatches: readonly (readonly [string, unknown, boolean])[] = [
  [
    "a dispatch naming the ticket and the source it was taken at",
    { type: "Dispatch", value: { ticket: 1, source: 9 } },
    true,
  ],
  [
    "the dispatch the vintage before this one wrote",
    { type: "Dispatch", value: 1 },
    false,
  ],
  [
    "a dispatch naming no source at all",
    { type: "Dispatch", value: { ticket: 1 } },
    false,
  ],
  [
    "a dispatch at the source no source is",
    { type: "Dispatch", value: { ticket: 1, source: 0 } },
    false,
  ],
  [
    "a dispatch naming its source by text",
    { type: "Dispatch", value: { ticket: 1, source: "9" } },
    false,
  ],
  [
    "a revocation, which names a ticket and nothing else",
    { type: "Revoke", value: 1 },
    true,
  ],
];

/** The task a produced report below is the obligation of. */
const releasedTask = { type: "WorkTask", value: { ticket: 1, cycle: 3 } };

const releasedObligation = {
  task: releasedTask,
  definition: releasedWorkDefinition,
  contextRef: 3,
};

/** What a task returned, which is one reference like every other. */
const releasedResultRef = 5;

function releasedCompletion(report: unknown): unknown {
  return {
    type: "TaskDone",
    value: { ticket: 1, task: releasedTask, report },
  };
}

/** Every produced report this image admits, and every way of producing one it refuses. */
const releasedReports: readonly (readonly [string, unknown, boolean])[] = [
  [
    "a work task reporting the obligation it was given and the source it was accepted at",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: {
          obligation: releasedObligation,
          resultRef: releasedResultRef,
        },
        acceptedSourceRef: 7,
      },
    }),
    true,
  ],
  [
    "an evaluator reporting its own obligation and the verdict it reached",
    {
      type: "TaskDone",
      value: {
        ticket: 1,
        task: {
          type: "EvaluationTask",
          value: {
            ticket: 1,
            workCycle: 2,
            stage: 1,
            generation: 1,
            evaluator: 3,
          },
        },
        report: {
          type: "EvaluationResultReport",
          value: {
            result: {
              obligation: {
                task: {
                  type: "EvaluationTask",
                  value: {
                    ticket: 1,
                    workCycle: 2,
                    stage: 1,
                    generation: 1,
                    evaluator: 3,
                  },
                },
                definition: releasedEvaluatorDefinition,
                contextRef: 2,
              },
              resultRef: releasedResultRef,
            },
            verdict: "EvaluatorPass",
          },
        },
      },
    },
    true,
  ],
  [
    "the produced report the vintage before this one wrote",
    releasedCompletion({
      type: "WorkResultReport",
      value: { result: releasedResultRef },
    }),
    false,
  ],
  [
    "a produced report carrying no obligation at all",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: { resultRef: releasedResultRef },
        acceptedSourceRef: 7,
      },
    }),
    false,
  ],
  [
    "a produced report whose result is the reference it used to be",
    releasedCompletion({
      type: "WorkResultReport",
      value: { result: 7, acceptedSourceRef: 7 },
    }),
    false,
  ],
  [
    "a produced report whose obligation is a definition short",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: {
          obligation: { task: releasedTask, contextRef: 3 },
          resultRef: releasedResultRef,
        },
        acceptedSourceRef: 7,
      },
    }),
    false,
  ],
  [
    "a produced report whose obligation names no context it ran in",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: {
          obligation: {
            task: releasedTask,
            definition: releasedWorkDefinition,
          },
          resultRef: releasedResultRef,
        },
        acceptedSourceRef: 7,
      },
    }),
    false,
  ],
  [
    "a produced report whose obligation is another task's",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: {
          obligation: {
            ...releasedObligation,
            task: { type: "WorkTask", value: { ticket: 1, cycle: 4 } },
          },
          resultRef: releasedResultRef,
        },
        acceptedSourceRef: 7,
      },
    }),
    false,
  ],
  [
    "a work result accepted at no source at all",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: {
          obligation: releasedObligation,
          resultRef: releasedResultRef,
        },
      },
    }),
    false,
  ],
  [
    "a work result accepted at the source no source is",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: {
          obligation: releasedObligation,
          resultRef: releasedResultRef,
        },
        acceptedSourceRef: 0,
      },
    }),
    false,
  ],
  [
    "a produced report referencing nothing it returned",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: { obligation: releasedObligation },
        acceptedSourceRef: 7,
      },
    }),
    false,
  ],
  [
    "a produced report returning a record where a reference belongs",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: {
          obligation: releasedObligation,
          resultRef: { manifest: 1, digest: 2, schema: 1 },
        },
        acceptedSourceRef: 7,
      },
    }),
    false,
  ],
  [
    "a produced report naming what it returned by text",
    releasedCompletion({
      type: "WorkResultReport",
      value: {
        result: { obligation: releasedObligation, resultRef: "5" },
        acceptedSourceRef: 7,
      },
    }),
    false,
  ],
  [
    "a task reporting the process that died under it",
    releasedCompletion({
      type: "TerminalFailureReport",
      value: { evidence: 1, kind: "ProcessFailure" },
    }),
    true,
  ],
];

test("the boundary admits a ticket released as the definition it runs at and refuses the spelling it left", async () => {
  await migrationDatabase("released_events", async (subject) => {
    await postgresMigrate(subject);
    for (const [label, event, admitted] of [
      ...releasedTickets,
      ...releasedDispatches,
      ...releasedReports,
    ])
      assert.deepEqual(
        (
          await subject.query<{ admitted: boolean }>(
            "SELECT decision_event_is_valid($1::jsonb) AS admitted",
            [JSON.stringify(event)],
          )
        ).rows,
        [{ admitted }],
        label,
      );
  });
});

/** The release the vintage before this one stored, which is what the guard is for. */
const releasedBefore = {
  type: "CreateTicket",
  value: { ticket: 1, deps: [], prog: [{ key: 1, evaluators: [{ key: 1 }] }] },
};

test("a journal with an entry in it refuses the definition arriving and names the wipe", async () => {
  await migrationDatabase("released_guard", async (subject) => {
    await installationBefore(subject, migration013.version);
    await subject.query(`${deletionPartition}\n${journaledDecision}`);
    await assert.rejects(postgresMigrate(subject), /wipe-tickets\.sql/u);
    assert.deepEqual(
      (
        await subject.query<{ admitted: boolean }>(
          "SELECT decision_event_is_valid($1::jsonb) AS admitted",
          [JSON.stringify(releasedBefore)],
        )
      ).rows,
      [{ admitted: true }],
      "the shape the guard refused over is the shape it left admitted",
    );
    assert.deepEqual(
      (
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        )
      )
        .map(({ version }) => version)
        .at(-1),
      migration013.version - 1,
    );
  });
});

/** Each row the two relations a release fills admit, and each half one they refuse. */
const releasedRows: readonly (readonly [string, string, boolean])[] = [
  [
    "a definition materialized for the ticket that was released",
    `INSERT INTO ticket_definition(tenant,project,ticket,definition,digest)
     VALUES('tenant-5','project-5',1,'{"image":"worker"}','digest-1')`,
    true,
  ],
  [
    "a definition for the ticket no ticket is",
    `INSERT INTO ticket_definition(tenant,project,ticket,definition,digest)
     VALUES('tenant-5','project-5',0,'{}','digest-0')`,
    false,
  ],
  [
    "a definition that is a document rather than the material it names",
    `INSERT INTO ticket_definition(tenant,project,ticket,definition,digest)
     VALUES('tenant-5','project-5',2,'"worker"','digest-2')`,
    false,
  ],
  [
    "a definition nothing can be addressed by",
    `INSERT INTO ticket_definition(tenant,project,ticket,definition,digest)
     VALUES('tenant-5','project-5',3,'{}','')`,
    false,
  ],
  [
    "the source a ticket bound to a repository was dispatched at",
    `INSERT INTO ticket_source(tenant,project,ticket,source,repository,commit,ref)
     VALUES('tenant-5','project-5',1,7,'owner/repo',repeat('a',40),'refs/heads/main')`,
    true,
  ],
  [
    "the source a ticket naming no repository runs at",
    `INSERT INTO ticket_source(tenant,project,ticket,source)
     VALUES('tenant-5','project-5',2,8)`,
    true,
  ],
  [
    "a source at the reference no reference is",
    `INSERT INTO ticket_source(tenant,project,ticket,source)
     VALUES('tenant-5','project-5',3,0)`,
    false,
  ],
  [
    "a repository named with no commit taken from it",
    `INSERT INTO ticket_source(tenant,project,ticket,source,repository)
     VALUES('tenant-5','project-5',4,9,'owner/repo')`,
    false,
  ],
  [
    "a commit named by no repository it was taken from",
    `INSERT INTO ticket_source(tenant,project,ticket,source,commit)
     VALUES('tenant-5','project-5',5,10,repeat('a',40))`,
    false,
  ],
  [
    "a commit that is not one",
    `INSERT INTO ticket_source(tenant,project,ticket,source,repository,commit)
     VALUES('tenant-5','project-5',6,11,'owner/repo','head')`,
    false,
  ],
];

test("the two relations a release fills hold a whole row and refuse a half one", async () => {
  await migrationDatabase("released_rows", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(deletionPartition);
    for (const [label, row, held] of releasedRows)
      if (held) await subject.query(row);
      else await assert.rejects(subject.query(row), label);
  });
});

/** The release the door reads back the definition it reports, as the writer journals one. */
const releasedEntry = JSON.stringify({
  seq: 1,
  event: releasedEvent(releasedWhole),
  rec: { label: "ticket-released", transitions: [], effects: [] },
});

/** The repository the accepted work result was produced at, and the commit it names. */
const releasedRepository = "owner/repo";
const releasedRef = "refs/heads/main";
const releasedCommit = "a".repeat(40);

async function releasedFold(subject: pg.Pool, digest: string): Promise<number> {
  const found = (
    await subject.query<{ folded: string }>(
      "SELECT result_digest_fold($1)::text AS folded",
      [digest],
    )
  ).rows[0]?.folded;
  if (found === undefined) throw new Error("the digest fold answered nothing");
  return Number(found);
}

async function releasedJournalled(
  subject: pg.Pool,
  operation: string,
): Promise<unknown> {
  return (
    await subject.query<{ journalled: unknown }>(
      `SELECT (command::jsonb)#>'{event,value}' AS journalled
         FROM operation WHERE operation=$1`,
      [operation],
    )
  ).rows[0]?.journalled;
}

/** What every case below hangs the door off: the release, the revision and the bundle a request pins. */
async function releasedSeeded(subject: pg.Pool): Promise<void> {
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

function releasedSubmission(ordinal: number): string {
  const at = String(ordinal);
  return `SELECT result,operation FROM submit_task_completion
     ('tenant-5','project-5','execution-${at}',1,${at},${at},'Passed','manifest-${at}',
      repeat('d',64),NULL,'operation-released-${at}','subject-5')`;
}

test("the door reports the work obligation the release wrote down and the source it was accepted at", async () => {
  await migrationDatabase("released_work", async (subject) => {
    await postgresMigrate(subject);
    await releasedSeeded(subject);
    const digest = await releasedFold(subject, "d".repeat(64));
    const source = await releasedFold(subject, releasedCommit);
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3"),
    );
    await subject.query(
      `INSERT INTO execution_result_source
         (tenant,project,manifest,repository,ref,commit,base,expected_base)
       VALUES('tenant-5','project-5','manifest-1','${releasedRepository}','${releasedRef}',
              '${releasedCommit}',repeat('e',40),repeat('e',40))`,
    );
    assert.deepEqual(
      (await subject.query(releasedSubmission(1))).rows,
      [{ result: "Submitted", operation: "operation-released-1" }],
      "the work result the release was dispatched for",
    );
    assert.deepEqual(
      await releasedJournalled(subject, "operation-released-1"),
      {
        ticket: 1,
        task: { type: "WorkTask", value: { ticket: 1, cycle: 3 } },
        report: {
          type: "WorkResultReport",
          value: {
            result: {
              obligation: {
                task: { type: "WorkTask", value: { ticket: 1, cycle: 3 } },
                definition: releasedWorkDefinition,
                contextRef: 3,
              },
              resultRef: digest,
            },
            acceptedSourceRef: source,
          },
        },
      },
      "the work obligation is the definition the release wrote down",
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT ticket::text AS ticket,source::text AS source,repository,commit,ref
             FROM ticket_source WHERE tenant='tenant-5' AND project='project-5'`,
        )
      ).rows,
      [
        {
          ticket: "1",
          source: String(source),
          repository: releasedRepository,
          commit: releasedCommit,
          ref: releasedRef,
        },
      ],
      "the source the result was accepted at is the source the ticket now runs at",
    );
  });
});

/** The identity the stage the release names spawns its second evaluator under. */
const releasedEvaluatorTask = {
  type: "EvaluationTask",
  value: { ticket: 1, workCycle: 2, stage: 1, generation: 5, evaluator: 3 },
};

/** The passed work manifest of the cycle the evaluator above judges. */
const releasedJudgedDigest = "f".repeat(64);

/** That cycle's work execution, at a digest of its own so its fold is visible. */
const releasedJudgedWork = identityExecution(
  2,
  "SpawnWork",
  "kind,cycle",
  "'Work',2",
  "Pass",
  `repeat('f',64)`,
);

/**
 * A LATER cycle of the same ticket, passed and written first, so a read that
 * asks the ticket for a work result rather than the cycle takes this one.
 */
const releasedLaterWork = identityExecution(
  3,
  "SpawnWork",
  "kind,cycle",
  "'Work',3",
  "Pass",
  `repeat('9',64)`,
);

/** The same cycle, passed, on ANOTHER ticket: a read not scoped by ticket takes it. */
const releasedOtherTicketWork = identityExecution(
  4,
  "SpawnWork",
  "kind,cycle",
  "'Work',2",
  "Pass",
  `repeat('8',64)`,
  2,
);

test("the door reports the definition the evaluator's own key carries, under what its cycle produced", async () => {
  await migrationDatabase("released_evaluation", async (subject) => {
    await postgresMigrate(subject);
    await releasedSeeded(subject);
    const digest = await releasedFold(subject, "d".repeat(64));
    const judged = await releasedFold(subject, releasedJudgedDigest);
    await subject.query(
      identityExecution(
        1,
        "SpawnEvaluation",
        "kind,cycle,stage,generation,evaluator",
        "'Evaluation',2,1,5,3",
      ),
    );
    await subject.query(releasedLaterWork);
    await subject.query(releasedJudgedWork);
    assert.notEqual(
      judged,
      2,
      "the reference the work reported is not the cycle it ran in",
    );
    assert.notEqual(judged, digest, "nor is it the evaluator's own result");
    assert.deepEqual(
      (await subject.query(releasedSubmission(1))).rows,
      [{ result: "Submitted", operation: "operation-released-1" }],
      "the evaluator the stage the release names runs",
    );
    assert.deepEqual(
      await releasedJournalled(subject, "operation-released-1"),
      {
        ticket: 1,
        task: releasedEvaluatorTask,
        report: {
          type: "EvaluationResultReport",
          value: {
            result: {
              obligation: {
                task: releasedEvaluatorTask,
                definition: releasedSecondDefinition,
                contextRef: judged,
              },
              resultRef: digest,
            },
            verdict: "EvaluatorPass",
          },
        },
      },
      "the evaluator judges under the reference its work cycle reported",
    );
  });
});

/** A definition a second stage carries, distinct from every one the first stage lists. */
const releasedThirdDefinition = {
  workload: 17,
  inputs: 18,
  executionRequirements: 19,
  resultContract: 20,
};

/**
 * A release of TWO stages listing the same evaluator key under different
 * definitions, so a door that selects by evaluator key alone answers the
 * first stage's definition for the second stage's task.
 */
const releasedTwoStageEntry = JSON.stringify({
  seq: 1,
  event: releasedEvent({
    ...releasedWhole,
    evaluationPlan: {
      stages: [
        { key: 1, evaluators: [{ key: 3, task: releasedSecondDefinition }] },
        { key: 2, evaluators: [{ key: 3, task: releasedThirdDefinition }] },
      ],
    },
  }),
  rec: { label: "ticket-released", transitions: [], effects: [] },
});

test("the door reports the definition of the stage the evaluator runs in, not the first stage listing its key", async () => {
  await migrationDatabase("released_second_stage", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(
      `${deletionPartition}\n${deletionJournalRow(1, releasedTwoStageEntry)};
       UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
       INSERT INTO configuration_revision
         (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
       VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
       INSERT INTO input_bundle(tenant,project,bundle,digest)
       VALUES('tenant-5','project-5','bundle-5',repeat('b',64))`,
    );
    const digest = await releasedFold(subject, "d".repeat(64));
    const judged = await releasedFold(subject, releasedJudgedDigest);
    await subject.query(
      identityExecution(
        1,
        "SpawnEvaluation",
        "kind,cycle,stage,generation,evaluator",
        "'Evaluation',2,2,1,3",
      ),
    );
    await subject.query(releasedJudgedWork);
    assert.deepEqual(
      (await subject.query(releasedSubmission(1))).rows,
      [{ result: "Submitted", operation: "operation-released-1" }],
      "the second stage's evaluator runs",
    );
    assert.deepEqual(
      await releasedJournalled(subject, "operation-released-1"),
      {
        ticket: 1,
        task: {
          type: "EvaluationTask",
          value: {
            ticket: 1,
            workCycle: 2,
            stage: 2,
            generation: 1,
            evaluator: 3,
          },
        },
        report: {
          type: "EvaluationResultReport",
          value: {
            result: {
              obligation: {
                task: {
                  type: "EvaluationTask",
                  value: {
                    ticket: 1,
                    workCycle: 2,
                    stage: 2,
                    generation: 1,
                    evaluator: 3,
                  },
                },
                definition: releasedThirdDefinition,
                contextRef: judged,
              },
              resultRef: digest,
            },
            verdict: "EvaluatorPass",
          },
        },
      },
      "the evaluator judges under its own stage's definition",
    );
  });
});

test("an evaluator whose cycle records no passed work result is refused by name", async () => {
  await migrationDatabase("released_unjudged", async (subject) => {
    await postgresMigrate(subject);
    await releasedSeeded(subject);
    await subject.query(
      identityExecution(
        1,
        "SpawnEvaluation",
        "kind,cycle,stage,generation,evaluator",
        "'Evaluation',2,1,5,3",
      ),
    );
    await subject.query(
      identityExecution(2, "SpawnWork", "kind,cycle", "'Work',2", "Fail"),
    );
    await subject.query(releasedLaterWork);
    await subject.query(releasedOtherTicketWork);
    assert.deepEqual(
      (await subject.query(releasedSubmission(1))).rows,
      [{ result: "WorkResultUnrecorded", operation: null }],
      "a judgement whose own cycle records no passed result of its own ticket",
    );
    assert.deepEqual(
      (
        await subject.query<{ held: number }>(
          "SELECT count(*)::int AS held FROM operation WHERE operation='operation-released-1'",
        )
      ).rows,
      [{ held: 0 }],
      "the refused completion journalled nothing",
    );
  });
});

test("a work result nothing observed a source for is refused on a ticket bound to a repository", async () => {
  await migrationDatabase("released_unsourced", async (subject) => {
    await postgresMigrate(subject);
    await releasedSeeded(subject);
    await subject.query(
      `INSERT INTO ticket_source(tenant,project,ticket,source,repository,commit,ref)
       VALUES('tenant-5','project-5',1,7,'${releasedRepository}','${releasedCommit}','${releasedRef}')`,
    );
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',4"),
    );
    assert.deepEqual(
      (await subject.query(releasedSubmission(1))).rows,
      [{ result: "SourceUnrecorded", operation: null }],
      "a pass nothing observed a source for",
    );
    assert.deepEqual(
      (
        await subject.query<{ held: number }>(
          "SELECT count(*)::int AS held FROM operation WHERE operation='operation-released-1'",
        )
      ).rows,
      [{ held: 0 }],
      "the refused completion journalled nothing",
    );
  });
});

/** How many releases the index case seeds, so a scan of them all is visible as one. */
const releasedIndexEntries = 400;

test("the release index answers a read at the key a released ticket names", async () => {
  await migrationDatabase("released_index", async (subject) => {
    await postgresMigrate(subject);
    await subject.query(deletionPartition);
    await subject.query("BEGIN");
    await subject.query(
      `INSERT INTO decision_input
         (tenant,project,ordinal,input_kind,input_id,base_priority,
          lifecycle_generation,state,decided_seq,terminal_at)
       SELECT 'tenant-5','project-5',n,'Continuation','entry-'||n,
              'Continuation',1,'Journaled',n,now()
         FROM generate_series(1,$1::bigint) n`,
      [releasedIndexEntries],
    );
    await subject.query(
      `INSERT INTO journal_entry
         (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
          recovery_epoch,cause_kind,cause_id)
       SELECT 'tenant-5','project-5',n,
         format('{"seq":%s,"event":{"type":"CreateTicket","value":{"id":%s}},"rec":{}}',n,n),
         'digest-'||n,'previous-'||n,'owner',1,'epoch-5','Continuation','entry-'||n
         FROM generate_series(1,$1::bigint) n`,
      [releasedIndexEntries],
    );
    await subject.query("COMMIT");
    await subject.query("ANALYZE journal_entry");
    const before = await releaseIndexUse(subject);
    assert.equal(
      (
        await subject.query(
          `SELECT j.seq FROM journal_entry j
            WHERE j.tenant='tenant-5' AND j.project='project-5'
              AND (CASE WHEN j.entry IS JSON OBJECT
                        THEN j.entry::jsonb->'event'->>'type' END)
                  = ANY (ARRAY['ReleaseTicket'::text, 'CreateTicket'::text])
              AND (CASE WHEN j.entry IS JSON OBJECT
                        THEN j.entry::jsonb->'event'->'value'->'id' END)=to_jsonb(1)`,
        )
      ).rowCount,
      1,
    );
    await subject.query("SELECT pg_stat_force_next_flush()");
    const after = await releaseIndexUse(subject);
    assert.ok(
      after.tuples - before.tuples <= 1,
      `one release cost ${String(after.tuples - before.tuples)} entries out of the index, so it was scanned for rather than looked up`,
    );
  });
});

/** What each role may do with the two relations a release fills, and what it may not. */
const releasedPrivileges: readonly (readonly [
  string,
  string,
  string,
  boolean,
])[] = [
  ["ticket_definition", ticketServiceRole, "SELECT", true],
  ["ticket_definition", ticketServiceRole, "INSERT", true],
  ["ticket_definition", ticketServiceRole, "UPDATE", false],
  ["ticket_definition", boundaryOwnerRole, "SELECT", true],
  ["ticket_definition", boundaryOwnerRole, "INSERT", false],
  ["ticket_definition", apiRole, "SELECT", false],
  ["ticket_source", ticketServiceRole, "INSERT", true],
  ["ticket_source", boundaryOwnerRole, "INSERT", true],
  ["ticket_source", boundaryOwnerRole, "UPDATE", false],
  ["ticket_source", schedulerRole, "SELECT", true],
  ["ticket_source", schedulerRole, "INSERT", false],
  ["ticket_source", apiRole, "INSERT", false],
];

/** The columns the api reads off a ticket's source, which is every one it has. */
const releasedSourceColumns = [
  "tenant",
  "project",
  "ticket",
  "source",
  "repository",
  "commit",
  "ref",
];

/** The columns the door that builds an obligation reads a release back out of. */
const releasedEntryColumns = ["tenant", "project", "entry"];

test("the two relations a release fills are open to the roles that write and read them and no others", async () => {
  await migrationDatabase("released_grants", async (subject) => {
    await postgresMigrate(subject);
    for (const [relation, role, privilege, granted] of releasedPrivileges)
      assert.equal(
        (
          await subject.query<{ held: boolean }>(
            "SELECT has_table_privilege($1,$2,$3) AS held",
            [role, `public.${relation}`, privilege],
          )
        ).rows[0]?.held,
        granted,
        `${role} on ${relation} ${privilege}`,
      );
    for (const column of releasedSourceColumns)
      assert.equal(
        (
          await subject.query<{ held: boolean }>(
            "SELECT has_column_privilege($1,'public.ticket_source',$2,'SELECT') AS held",
            [apiRole, column],
          )
        ).rows[0]?.held,
        true,
        `${apiRole} reads ticket_source.${column}`,
      );
    for (const column of releasedEntryColumns)
      assert.equal(
        (
          await subject.query<{ held: boolean }>(
            "SELECT has_column_privilege($1,'public.journal_entry',$2,'SELECT') AS held",
            [boundaryOwnerRole, column],
          )
        ).rows[0]?.held,
        true,
        `${boundaryOwnerRole} reads journal_entry.${column}`,
      );
    assert.equal(
      (
        await subject.query<{ held: boolean }>(
          "SELECT has_table_privilege($1,'public.journal_entry','INSERT') AS held",
          [boundaryOwnerRole],
        )
      ).rows[0]?.held,
      false,
      `${boundaryOwnerRole} writes no journal entry`,
    );
  });
});

/** The predicates the arms weigh a reference and a task definition with. */
const releasedPredicates = [
  "public.command_reference(jsonb)",
  "public.command_task_definition(jsonb)",
];

test("the reference predicates are the boundary owner's and nobody's to execute", async () => {
  await migrationDatabase("released_predicates", async (subject) => {
    await postgresMigrate(subject);
    for (const predicate of releasedPredicates) {
      for (const role of [apiRole, ticketServiceRole, schedulerRole, "public"])
        assert.equal(
          (
            await subject.query<{ granted: boolean }>(
              "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
              [role, predicate],
            )
          ).rows[0]?.granted,
          false,
          `${role} on ${predicate}`,
        );
      assert.equal(
        (
          await subject.query<{ owner: string }>(
            "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = $1::regprocedure",
            [predicate],
          )
        ).rows[0]?.owner,
        boundaryOwnerRole,
        predicate,
      );
    }
  });
});

/** The tag the authority CHECK switched on until a wall became a task's. */
const releasedRetiredTag = "ExecutionBlocked";

test("the authority a completion is admitted under names no tag this machine retired", async () => {
  await migrationDatabase("released_authority", async (subject) => {
    await postgresMigrate(subject);
    const rendered = (
      await subject.query<{ rendered: string }>(
        `SELECT pg_get_constraintdef(oid) AS rendered FROM pg_constraint
          WHERE conname='operation_completion_authority_is_its_boundary'`,
      )
    ).rows[0]?.rendered;
    assert.ok(rendered !== undefined, "the authority CHECK is not installed");
    assert.ok(
      !rendered.includes(releasedRetiredTag),
      `the authority CHECK still switches on ${releasedRetiredTag}`,
    );
    assert.ok(
      rendered.includes("TaskDone"),
      "the authority CHECK stopped weighing the completion it is for",
    );
    await subject.query(deletionPartition);
    await assert.rejects(
      subject.query(
        `INSERT INTO operation
           (tenant,project,operation,authority_kind,authority_subject,admission,
            key_version,key_digest,payload_digest,command,command_tag)
         VALUES('tenant-5','project-5','operation-5','User','author','Ordinary',
                'v1','key-5','payload-5','{}','TaskDone')`,
      ),
      /operation_completion_authority_is_its_boundary/u,
      "a completion from an authority that is not the scheduler's",
    );
  });
});

/** The wipe the migration's guard names, read from the tree rather than restated here. */
const wipeScriptPath = "deploy/rig/wipe-tickets.sql";

function wipeTruncated(script: string): readonly string[] {
  const named = /TRUNCATE TABLE([\s\S]*?)RESTART IDENTITY/u.exec(script)?.[1];
  if (named === undefined)
    throw new Error("the wipe names no relations to truncate");
  return [...named.matchAll(/public\.(\w+)/gu)].map(([, table]) =>
    String(table),
  );
}

/** What the wipe keeps: what a project is, rather than what it has done. */
const wipeKept = [
  "admitted_worker",
  "capacity_account",
  "configuration_revision",
  "deployment_authoring_policy",
  "execution_cluster",
  "forge_installation",
  "installation_authority",
  "project",
  "project_repository",
  "project_repository_bind_operation",
  "recovery_epoch",
  "repository_configuration_provenance",
  "repository_configuration_version",
  "schema_migration",
  "selector_inventory_state",
  "selector_project_settings",
  "selector_project_settings_history",
  "selector_runtime_readiness",
  "selector_runtime_settings",
  "selector_runtime_settings_history",
  "thread_wake_cursor",
  "worker_pool",
  "worker_pool_registration_token",
];

/** The history the wipe is run against: a released draft, a journalled decision and the ticket it projected. */
const wipedHistory = `
  INSERT INTO operation
    (tenant,project,operation,authority_kind,authority_subject,admission,
     key_version,key_digest,payload_digest,command,command_tag)
  VALUES('tenant-91','project-91','operation-91','User','author','Ordinary',
         'v1','key-91','payload-91','{}','CreateTicket');
  INSERT INTO decision_input
    (tenant,project,ordinal,input_kind,input_id,base_priority,lifecycle_generation,
     state,decided_seq,terminal_at)
  VALUES('tenant-91','project-91',50,'Operation','operation-91','Ordinary',1,
         'Journaled',1,now());
  INSERT INTO journal_entry
    (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
     recovery_epoch,cause_kind,cause_id)
  VALUES('tenant-91','project-91',1,'{}','digest-91','genesis','owner',1,'epoch-91',
         'Operation','operation-91');
  INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,escalation)
  VALUES('tenant-91','project-91',1,'Escalated',1,'WorkFailureEscalated');
  UPDATE project SET head=1,ingress_next=51,ticket_next=9,notification_next=4,
                     manifest_next=7
   WHERE tenant='tenant-91' AND project='project-91';
  UPDATE thread_wake_cursor SET sequence=40`;

/** What the seed above fills, so the case proves an emptying rather than an emptiness. */
const wipedFilled = [
  "draft",
  "draft_brief",
  "draft_revision",
  "decision_input",
  "journal_entry",
  "operation",
  "project_change",
  "ticket_projection",
];

async function wipeCounted(
  subject: pg.Pool,
  tables: readonly string[],
): Promise<Record<string, number>> {
  const counted: Record<string, number> = {};
  for (const table of tables)
    counted[table] = (
      await subject.query<{ held: number }>(
        `SELECT count(*)::int AS held FROM public.${table}`,
      )
    ).rows[0]?.held as number;
  return counted;
}

/** The history the wipe is run against: a released draft, a journalled decision and the ticket it projected. */
async function wipeSeeded(subject: pg.Pool): Promise<void> {
  await seedProposingBinding(subject);
  assert.deepEqual(
    await createdProposingDraft(subject, "refs/heads/branch-91"),
    [{ result: "Created", ticket: "1" }],
  );
  assert.deepEqual(
    (
      await subject.query<{ released: boolean }>(
        `SELECT ${draftReleaseFunction}
           ('tenant-91','project-91',1,1,'revision-91','digest-91',true) AS released`,
      )
    ).rows,
    [{ released: true }],
  );
  await subject.query(wipedHistory);
  assert.deepEqual(
    Object.entries(await wipeCounted(subject, wipedFilled))
      .filter(([, held]) => held === 0)
      .map(([table]) => table),
    [],
    "every relation the case counts on was filled",
  );
}

/** What the wipe leaves standing: a project at a fresh install's counters, and the rows it keeps. */
async function wipeStanding(subject: pg.Pool): Promise<void> {
  assert.deepEqual(
    (
      await subject.query(
        `SELECT head::text AS head,ingress_next::text AS ingress,
                ticket_next::text AS ticket,notification_next::text AS notification,
                manifest_next::text AS manifest,lifecycle
           FROM project`,
      )
    ).rows,
    [
      {
        head: "0",
        ingress: "1",
        ticket: "1",
        notification: "1",
        manifest: "1",
        lifecycle: "Active",
      },
    ],
  );
  assert.deepEqual(
    (
      await subject.query(
        "SELECT sequence::text AS sequence FROM thread_wake_cursor",
      )
    ).rows,
    [{ sequence: "0" }],
    "the cursor does not sit past a log that was restarted",
  );
  assert.deepEqual(
    await wipeCounted(subject, [
      "configuration_revision",
      "project_repository",
      "recovery_epoch",
      "selector_inventory_state",
      "selector_runtime_readiness",
      "selector_runtime_settings",
    ]),
    {
      configuration_revision: 1,
      project_repository: 1,
      recovery_epoch: 1,
      selector_inventory_state: 1,
      selector_runtime_readiness: 1,
      selector_runtime_settings: 1,
    },
  );
}

test("the wipe empties every relation it names, resets the counters and keeps the project", async () => {
  const script = await readFile(wipeScriptPath, "utf8");
  await migrationDatabase("wipe_tickets", async (subject) => {
    await postgresMigrate(subject);
    await wipeSeeded(subject);

    await subject.query(script);

    const truncated = wipeTruncated(script);
    assert.deepEqual(
      Object.entries(await wipeCounted(subject, truncated))
        .filter(([, held]) => held !== 0)
        .map(([table]) => table),
      [],
      "every relation the wipe names is empty",
    );
    await wipeStanding(subject);
    assert.deepEqual(
      (
        await subject.query<{ tablename: string }>(
          `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
        )
      ).rows
        .map(({ tablename }) => tablename)
        .filter((table) => !truncated.includes(table)),
      wipeKept,
      "every relation this schema has is either wiped or kept on purpose",
    );
  });
});
