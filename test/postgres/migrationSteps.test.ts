/**
 * The migrations from 017 on, each case opening an installation at the version
 * before its migration and applying it there.
 */

import { sessionCapabilities } from "../../src/contract/rosters.ts";
import {
  builtInToolCapabilities,
  chuggyToolNames,
} from "../../src/contract/sessionTools.ts";
import { leadToolAllowlist } from "../../src/interpreter/leadTools.ts";
import { migration017 } from "../../src/adapters/postgres/schema/migrations/017-ticket-repin.ts";
import { migration018 } from "../../src/adapters/postgres/schema/migrations/018-attempt-invocation.ts";
import { migration019 } from "../../src/adapters/postgres/schema/migrations/019-session-invocation.ts";
import { migration020 } from "../../src/adapters/postgres/schema/migrations/020-worker-pool-class.ts";
import { migration021 } from "../../src/adapters/postgres/schema/migrations/021-scheduler-reads-pools.ts";
import { migration022 } from "../../src/adapters/postgres/schema/migrations/022-worker-pool-fencing.ts";
import { migration023 } from "../../src/adapters/postgres/schema/migrations/023-worker-pool-release-ends.ts";
import { migration026 } from "../../src/adapters/postgres/schema/migrations/026-project-creation.ts";
import { migration027 } from "../../src/adapters/postgres/schema/migrations/027-forge-claim-per-tenant.ts";
import { migration028 } from "../../src/adapters/postgres/schema/migrations/028-binding-lands-by-pull-request.ts";
import { migration029 } from "../../src/adapters/postgres/schema/migrations/029-project-execution-placement.ts";
import { migration032 } from "../../src/adapters/postgres/schema/migrations/032-session-placement.ts";
import { migration034 } from "../../src/adapters/postgres/schema/migrations/034-held-proposal-currency.ts";
import { migration042 } from "../../src/adapters/postgres/schema/migrations/042-lead-succession.ts";
import { migration043 } from "../../src/adapters/postgres/schema/migrations/043-parked-overrides.ts";
import { migration045 } from "../../src/adapters/postgres/schema/migrations/045-selector-attempt-revision.ts";
import { migration047 } from "../../src/adapters/postgres/schema/migrations/047-workspace-links.ts";
import { migration052 } from "../../src/adapters/postgres/schema/migrations/052-retirement-releases-repository.ts";
import { migration053 } from "../../src/adapters/postgres/schema/migrations/053-release-pairing-refusals.ts";
import { migration055 } from "../../src/adapters/postgres/schema/migrations/055-lead-refusal.ts";
import { migration056 } from "../../src/adapters/postgres/schema/migrations/056-pool-refusal-fault.ts";
import { migration057 } from "../../src/adapters/postgres/schema/migrations/057-attempt-runtime.ts";
import { migration058 } from "../../src/adapters/postgres/schema/migrations/058-project-reads.ts";
import { migration059 } from "../../src/adapters/postgres/schema/migrations/059-execution-resources.ts";
import { migration060 } from "../../src/adapters/postgres/schema/migrations/060-merge-waits.ts";
import {
  migration066,
  toolAllowlistAt066,
} from "../../src/adapters/postgres/schema/migrations/066-lead-lists-repositories.ts";
import {
  migration068,
  toolAllowlistAt068,
} from "../../src/adapters/postgres/schema/migrations/068-lead-fetches-images.ts";
import { migration069 } from "../../src/adapters/postgres/schema/migrations/069-runner-versions.ts";
import { migration070 } from "../../src/adapters/postgres/schema/migrations/070-many-personal-runners.ts";
import {
  migration072,
  toolAllowlistAt072,
} from "../../src/adapters/postgres/schema/migrations/072-lead-reads-run-errors.ts";
import { migration076 } from "../../src/adapters/postgres/schema/migrations/076-pipelines-writable.ts";
import { migration077 } from "../../src/adapters/postgres/schema/migrations/077-tokens-carry-no-capabilities.ts";
import { migration079 } from "../../src/adapters/postgres/schema/migrations/079-lead-reads-ticket-landings.ts";
import { migration081 } from "../../src/adapters/postgres/schema/migrations/081-promotion-declined.ts";
import { migration082 } from "../../src/adapters/postgres/schema/migrations/082-decline-kept-unread.ts";
import { migration083 } from "../../src/adapters/postgres/schema/migrations/083-attempt-base-ref.ts";
import { migration084 } from "../../src/adapters/postgres/schema/migrations/084-thread-dispatch.ts";
import { migration086 } from "../../src/adapters/postgres/schema/migrations/086-several-threads.ts";
import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { postgresPersonalRunnerRegistrationTokens } from "../../src/adapters/postgres/personalRunner.ts";
import { postgresWorkerPoolRegistrationTokens } from "../../src/adapters/postgres/workerPool.ts";
import { migration067 } from "../../src/adapters/postgres/schema/migrations/067-configuration-import-attempts.ts";
import { accessPlaneRole } from "../../src/adapters/postgres/schema/shared.ts";
import { postgresInviteLinks } from "../../src/adapters/postgres/inviteLinks.ts";
import {
  postgresForgeInstallationClaims,
  postgresForgeInstallations,
} from "../../src/adapters/postgres/forgeInstallation.ts";
import {
  asForgeAccount,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
} from "../../src/interpreter/forgeInstallation.ts";
import {
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { baselineToolAllowlist } from "../../src/adapters/postgres/schema/migrations/baseline/seed.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiRole,
  boundaryOwnerRole,
  leadCloseFunction,
  leadRefusalReadFunction,
  leadSessionFunction,
  configurationImporterRole,
  executionPlacementSetFunction,
  finalizerRole,
  forgeInstallationRecordFunction,
  migrations,
  personalRunnerFenceFunction,
  personalSessionOpenFunction,
  poolPlaneRole,
  projectCreateFunction,
  projectCreationGrantsFunction,
  repositoryBindingListFunction,
  repositoryBindingReadFunction,
  repositoryConfigurationImportRecordFunction,
  repositoryBindingWriteFunction,
  repositoryLandingReadFunction,
  repositoryLandingWriteFunction,
  repositoryRetirementWriteFunction,
  schedulerRole,
  selectorServiceRole,
  sessionPlacementSetFunction,
  sessionRouteFunction,
  sessionRunnerStandingFunction,
  sessionTaskReadFunction,
  statusMoveFunction,
  ticketServiceRole,
  workerPlaneRole,
  workerPoolFenceFunction,
  workerPoolReleaseFunction,
  workerTaskReadFunction,
} from "../../src/adapters/postgres/schema.ts";
import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { workerImageFaults } from "../../src/contract/workerEnvironment.ts";
import {
  configurationCpusMax,
  configurationMemoryMibMax,
  configurationMemoryMibMin,
} from "../../src/contract/configurationDocument.ts";
import { workerImageCharsMax } from "../../src/contract/workerPool.ts";
import type pg from "pg";
import {
  assertDoorsStandOwned,
  commandsBoundaryRefusals,
  commandsRefusal,
  commandsRefusalsBefore085,
  commandsRefuse,
  deletionJournalRow,
  deletionPartition,
  identityExecution,
  installationAt,
  installationBefore,
  journalledRevocation,
  migrationDatabase,
  migrationDatabaseAt,
  migrationHasFunction,
  releasedSeeded,
  renamedAttemptPrepared,
  renamedFinalization,
  seedLandinglessBinding,
  tenantSeed,
} from "./migrationHarness.ts";

/**
 * Whether the writer may move a ticket's configuration pin, and that the api
 * role may move neither column of it nor read the digest.
 */
async function repinPrivileges(
  subject: pg.Pool,
  writer: boolean,
): Promise<void> {
  for (const [column, role, privilege, granted] of [
    ["configuration_revision", ticketServiceRole, "UPDATE", writer],
    ["configuration_digest", ticketServiceRole, "UPDATE", writer],
    ["configuration_revision", apiRole, "UPDATE", false],
    ["configuration_digest", apiRole, "UPDATE", false],
    ["configuration_digest", apiRole, "SELECT", false],
  ] as const)
    assert.equal(
      (
        await subject.query<{ held: boolean }>(
          "SELECT has_column_privilege($1,'public.ticket_projection',$2,$3) AS held",
          [role, column, privilege],
        )
      ).rows[0]?.held,
      granted,
      `${role} ${privilege} on ticket_projection.${column}`,
    );
}

test("017 lets the writer re-pin a ticket's configuration, which 016 did not", async () => {
  await migrationDatabaseAt(
    migration017.version - 1,
    "repin_install",
    async (subject) => {
      await repinPrivileges(subject, false);
      assert.ok(
        (await postgresMigrate(subject)).includes(migration017.version),
      );
      await repinPrivileges(subject, true);
    },
  );
});

test("017 migrates a database already holding its grant", async () => {
  await migrationDatabaseAt(
    migration017.version - 1,
    "repin_granted",
    async (subject) => {
      await subject.query(
        `GRANT UPDATE(configuration_revision, configuration_digest)
         ON TABLE public.ticket_projection TO ${ticketServiceRole}`,
      );
      assert.ok(
        (await postgresMigrate(subject)).includes(migration017.version),
      );
      await repinPrivileges(subject, true);
    },
  );
});

/** The columns 018 gives an attempt, by name. */
async function invocationColumns(subject: pg.Pool): Promise<readonly string[]> {
  const found = await subject.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='execution_attempt'
        AND column_name IN ('invocation','invoked')
      ORDER BY column_name`,
  );
  return found.rows.map((row) => row.column_name);
}

test("018 gives an attempt its invocation and the worker plane its one read of it", async () => {
  await migrationDatabase("attempt_invocation", async (subject) => {
    const read = `public.${workerTaskReadFunction}(text)`;
    await installationBefore(subject, migration018.version);
    assert.deepEqual(await invocationColumns(subject), []);
    assert.equal(await migrationHasFunction(subject, read), false);
    assert.ok((await postgresMigrate(subject)).includes(migration018.version));
    assert.deepEqual(await invocationColumns(subject), [
      "invocation",
      "invoked",
    ]);
    for (const [column, role, privilege, granted] of [
      ["invocation", schedulerRole, "UPDATE", true],
      ["invoked", poolPlaneRole, "SELECT", true],
      ["invocation", poolPlaneRole, "SELECT", false],
      ["invocation", workerPlaneRole, "SELECT", false],
      ["invocation", apiRole, "SELECT", false],
    ] as const)
      assert.equal(
        (
          await subject.query<{ held: boolean }>(
            "SELECT has_column_privilege($1,'public.execution_attempt',$2,$3) AS held",
            [role, column, privilege],
          )
        ).rows[0]?.held,
        granted,
        `${role} ${privilege} on execution_attempt.${column}`,
      );
    assert.deepEqual(
      (
        await subject.query<{
          owner: string;
          definer: boolean;
          plane: boolean;
          pool: boolean;
        }>(
          `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
                  has_function_privilege($2,p.oid,'EXECUTE') AS plane,
                  has_function_privilege($3,p.oid,'EXECUTE') AS pool
             FROM pg_proc p WHERE p.oid=to_regprocedure($1)`,
          [read, workerPlaneRole, poolPlaneRole],
        )
      ).rows,
      [{ owner: boundaryOwnerRole, definer: true, plane: true, pool: false }],
    );
  });
});

/** The columns 019 gives a session attempt, by name. */
async function sessionInvocationColumns(
  subject: pg.Pool,
): Promise<readonly string[]> {
  const found = await subject.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='session_attempt'
        AND column_name IN ('invocation','invoked')`,
  );
  return found.rows.map((row) => row.column_name);
}

/** Who owns each named boundary and which runtime roles may execute it, in name order. */
async function sessionInvocationBoundaries(
  subject: pg.Pool,
  signatures: readonly string[],
): Promise<readonly unknown[]> {
  const found = await subject.query<Record<string, unknown>>(
    `SELECT p.oid::regprocedure::text AS signature,
            pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
            has_function_privilege($2,p.oid,'EXECUTE') AS scheduler,
            has_function_privilege($3,p.oid,'EXECUTE') AS plane,
            has_function_privilege($4,p.oid,'EXECUTE') AS pool,
            has_function_privilege($5,p.oid,'EXECUTE') AS api
       FROM pg_proc p WHERE p.oid = ANY(SELECT to_regprocedure(unnest($1::text[])))
      ORDER BY p.proname`,
    [signatures, schedulerRole, workerPlaneRole, poolPlaneRole, apiRole],
  );
  return found.rows;
}

test("019 gives a session attempt its invocation, opened only with one, and the worker plane its one read of it", async () => {
  await migrationDatabase("session_invocation", async (subject) => {
    const bare =
      "open_session_attempt(text,text,text,text,text,text,text,bigint,bigint,bigint,bigint)";
    const invoked = bare.replace("bigint)", "bigint,jsonb)");
    const read = `${sessionTaskReadFunction}(text)`;
    await installationBefore(subject, migration019.version);
    assert.deepEqual(await sessionInvocationColumns(subject), []);
    assert.equal(await migrationHasFunction(subject, bare), true);
    assert.equal(await migrationHasFunction(subject, read), false);
    assert.ok((await postgresMigrate(subject)).includes(migration019.version));
    assert.deepEqual(await sessionInvocationColumns(subject), ["invocation"]);
    assert.equal(await migrationHasFunction(subject, bare), false);
    const owned = { owner: boundaryOwnerRole, definer: true, pool: false };
    assert.deepEqual(
      await sessionInvocationBoundaries(subject, [invoked, read]),
      [
        {
          signature: invoked,
          ...owned,
          scheduler: true,
          plane: false,
          api: false,
        },
        {
          signature: read,
          ...owned,
          scheduler: false,
          plane: true,
          api: false,
        },
      ],
    );
  });
});

/** Every role of the installation holding anything on a pool's class, and what it holds. */
async function poolClassPrivileges(
  subject: pg.Pool,
): Promise<readonly Record<string, unknown>[]> {
  const found = await subject.query<Record<string, unknown>>(
    `SELECT r.rolname AS role,
            has_column_privilege(r.rolname,'public.worker_pool','class','SELECT') AS read,
            has_column_privilege(r.rolname,'public.worker_pool','class','INSERT') AS insert,
            has_column_privilege(r.rolname,'public.worker_pool','class','UPDATE') AS update
       FROM pg_roles r WHERE r.rolname LIKE 'chuggy%'
        AND (has_column_privilege(r.rolname,'public.worker_pool','class','SELECT')
          OR has_column_privilege(r.rolname,'public.worker_pool','class','INSERT')
          OR has_column_privilege(r.rolname,'public.worker_pool','class','UPDATE'))
      ORDER BY r.rolname`,
  );
  return found.rows;
}

/** A pool's class column as the catalogue has it: absent, or present with its default. */
async function poolClassColumn(
  subject: pg.Pool,
): Promise<readonly Record<string, unknown>[]> {
  const found = await subject.query<Record<string, unknown>>(
    `SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='worker_pool' AND column_name='class'`,
  );
  return found.rows;
}

test("020 records a pool's class, the one class there is for each pool already registered", async () => {
  await migrationDatabaseAt(
    migration020.version - 1,
    "worker_pool_class",
    async (subject) => {
      assert.deepEqual(await poolClassColumn(subject), []);
      await subject.query(
        `INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-20','project-20','Active');
       INSERT INTO worker_pool(tenant,project,pool,principal,client_id)
       VALUES('tenant-20','project-20','pool-20','principal-20','client-20')`,
      );
      assert.ok(
        (await postgresMigrate(subject)).includes(migration020.version),
      );
      assert.deepEqual(
        (await subject.query("SELECT pool, class FROM worker_pool")).rows,
        [{ pool: "pool-20", class: "Dedicated" }],
      );
      assert.deepEqual(await poolClassColumn(subject), [
        { column_default: null, is_nullable: "NO" },
      ]);
      for (const refused of ["Personal", "Shared"])
        await assert.rejects(
          subject.query(
            `INSERT INTO worker_pool(tenant,project,pool,class,principal,client_id)
           VALUES('tenant-20','project-20',$1,$1,$1,$1)`,
            [refused],
          ),
          /worker_pool_class_is_known/u,
        );
      assert.deepEqual(await poolClassPrivileges(subject), [
        { role: apiRole, read: true, insert: true, update: false },
        { role: poolPlaneRole, read: true, insert: false, update: false },
        { role: schedulerRole, read: true, insert: false, update: false },
      ]);
    },
  );
});

/** The registry columns the scheduler may read, in the table's own order. */
async function schedulerPoolColumns(
  subject: pg.Pool,
): Promise<readonly string[]> {
  const found = await subject.query<{ attname: string }>(
    `SELECT a.attname FROM pg_attribute a
      WHERE a.attrelid='public.worker_pool'::regclass AND a.attnum>0
        AND NOT a.attisdropped
        AND has_column_privilege($1,a.attrelid,a.attnum,'SELECT')
      ORDER BY a.attnum`,
    [schedulerRole],
  );
  return found.rows.map((row) => row.attname);
}

test("021 lets the scheduler read a registered pool's project, name, declaration, principal and class, and no other column", async () => {
  await migrationDatabaseAt(
    migration021.version - 1,
    "scheduler_pools",
    async (subject) => {
      assert.deepEqual(await schedulerPoolColumns(subject), []);
      assert.ok(
        (await postgresMigrate(subject)).includes(migration021.version),
      );
      assert.deepEqual(await schedulerPoolColumns(subject), [
        "tenant",
        "project",
        "pool",
        "capabilities",
        "principal",
        "class",
      ]);
    },
  );
});

/** Whether each role named may read and write the registration a pool's attempt was claimed under. */
async function poolPrincipalPrivileges(
  subject: pg.Pool,
): Promise<readonly unknown[]> {
  const found = await subject.query<Record<string, unknown>>(
    `SELECT r.role,
            has_column_privilege(r.role,'public.execution_attempt','pool_principal','SELECT') AS read,
            has_column_privilege(r.role,'public.execution_attempt','pool_principal','UPDATE') AS update
       FROM unnest($1::text[]) AS r(role) ORDER BY r.role`,
    [[apiRole, poolPlaneRole, workerPlaneRole]],
  );
  return found.rows;
}

test("022 records the registration a pool's attempt was claimed under, and refuses an installation where a pool holds one already", async () => {
  await migrationDatabase("worker_pool_fencing", async (subject) => {
    const fence = `${workerPoolFenceFunction}(text,text,text)`;
    await installationBefore(subject, migration022.version);
    await releasedSeeded(subject);
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3", null),
    );
    await subject.query(
      "UPDATE execution_attempt SET pool='pool-22', assignment='assignment-22'",
    );
    await assert.rejects(
      postgresMigrate(subject),
      /execution_attempt_pool_principal_is_a_pool_s/u,
      "no principal is guessed for an attempt a pool already holds",
    );
    assert.deepEqual(await sessionInvocationBoundaries(subject, [fence]), []);
    await subject.query(
      "UPDATE execution_attempt SET pool=NULL, assignment=NULL",
    );
    assert.ok((await postgresMigrate(subject)).includes(migration022.version));
    await assert.rejects(
      subject.query(
        "UPDATE execution_attempt SET pool='pool-22', assignment='assignment-22'",
      ),
      /execution_attempt_pool_principal_is_a_pool_s/u,
    );
    await subject.query(
      "UPDATE execution_attempt SET pool='pool-22', assignment='assignment-22', pool_principal='principal-22', capability_secret_digest=NULL",
    );
    assert.deepEqual(await poolPrincipalPrivileges(subject), [
      { role: apiRole, read: false, update: false },
      { role: poolPlaneRole, read: true, update: true },
      { role: workerPlaneRole, read: false, update: false },
    ]);
    assert.deepEqual(await sessionInvocationBoundaries(subject, [fence]), [
      {
        signature: fence,
        owner: boundaryOwnerRole,
        definer: true,
        scheduler: false,
        plane: false,
        pool: false,
        api: true,
      },
    ]);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT array_to_string(proconfig,',') AS settings,
                  EXISTS(SELECT 1 FROM aclexplode(proacl) entry
                          WHERE entry.grantee=0) AS world
             FROM pg_proc WHERE oid=$1::regprocedure`,
          [fence],
        )
      ).rows,
      [{ settings: "search_path=pg_catalog, public, pg_temp", world: false }],
    );
  });
});

/** What the plane serving pools may do to an execution's backoff and status. */
async function poolPlaneExecutionPrivileges(
  subject: pg.Pool,
): Promise<readonly unknown[]> {
  const found = await subject.query<Record<string, unknown>>(
    `SELECT has_column_privilege($1,'public.execution','placement_backoff_from','SELECT') AS reads_backoff,
            has_column_privilege($1,'public.execution','placement_backoff_from','UPDATE') AS locks,
            has_function_privilege($1,'${statusMoveFunction}(text,text)','EXECUTE') AS moves_status`,
    [poolPlaneRole],
  );
  return found.rows;
}

test("023 gives the plane serving pools the release and takes back its reading of the backoff", async () => {
  await migrationDatabase("worker_pool_release", async (subject) => {
    const release = `${workerPoolReleaseFunction}(text,text,text,text,text)`;
    await installationBefore(subject, migration023.version);
    assert.deepEqual(await sessionInvocationBoundaries(subject, [release]), []);
    assert.deepEqual(await poolPlaneExecutionPrivileges(subject), [
      { reads_backoff: true, locks: true, moves_status: true },
    ]);
    assert.ok((await postgresMigrate(subject)).includes(migration023.version));
    assert.deepEqual(await poolPlaneExecutionPrivileges(subject), [
      { reads_backoff: false, locks: true, moves_status: false },
    ]);
    assert.deepEqual(await sessionInvocationBoundaries(subject, [release]), [
      {
        signature: release,
        owner: boundaryOwnerRole,
        definer: true,
        scheduler: false,
        plane: false,
        pool: true,
        api: false,
      },
    ]);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT array_to_string(proconfig,',') AS settings,
                  EXISTS(SELECT 1 FROM aclexplode(proacl) entry
                          WHERE entry.grantee=0) AS world
             FROM pg_proc WHERE oid=$1::regprocedure`,
          [release],
        )
      ).rows,
      [{ settings: "search_path=pg_catalog, public, pg_temp", world: false }],
    );
  });
});

test("026 gives every tenant a project stands in a row of its own, and a project no tenant row holds is refused", async () => {
  await migrationDatabase("project_creation", async (subject) => {
    const doors = [
      `${projectCreateFunction}(text,text,text,boolean,text,text,text)`,
      `${projectCreationGrantsFunction}(text)`,
    ];
    await installationBefore(subject, migration026.version);
    await subject.query(
      `INSERT INTO project(tenant,project,lifecycle) VALUES
         ('tenant-26','project-a','Active'),('tenant-26','project-b','Active'),
         ('other-26','project-a','Active')`,
    );
    assert.ok((await postgresMigrate(subject)).includes(migration026.version));
    assert.deepEqual(
      (await subject.query("SELECT tenant FROM tenant ORDER BY tenant")).rows,
      [{ tenant: "other-26" }, { tenant: "tenant-26" }],
    );
    await assert.rejects(
      subject.query(
        `INSERT INTO project(tenant,project,lifecycle) VALUES('absent-26','project-a','Active')`,
      ),
      /project_names_a_tenant/u,
    );
    assert.deepEqual(
      await sessionInvocationBoundaries(subject, doors),
      doors.map((signature) => ({
        signature,
        owner: boundaryOwnerRole,
        definer: true,
        scheduler: false,
        plane: false,
        pool: false,
        api: true,
      })),
    );
  });
});

/** The columns a forge claim is keyed by, in key order. */
async function forgeClaimKey(subject: pg.Pool): Promise<readonly string[]> {
  const found = await subject.query<{ attname: string }>(
    `SELECT a.attname FROM pg_constraint c
       CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum,ord)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.conname='forge_installation_pkey' ORDER BY k.ord`,
  );
  return found.rows.map((row) => row.attname);
}

/** One claim through the door, answering what the door decided. */
async function forgeClaimRecorded(
  subject: pg.Pool,
  app: string,
  installationId: string,
  tenant: string,
): Promise<unknown> {
  const found = await subject.query<{ recorded: string }>(
    `SELECT ${forgeInstallationRecordFunction}('github',$1,'acme','Organization',$2,$3,'Member','s') AS recorded`,
    [app, installationId, tenant],
  );
  return found.rows[0]?.recorded;
}

/** Every claim as the relation holds it, in an order that does not depend on the key. */
async function forgeClaimRows(subject: pg.Pool): Promise<readonly unknown[]> {
  const found = await subject.query<Record<string, unknown>>(
    `SELECT forge,app,account,account_kind,installation_id,tenant,
            authority_kind,authority_subject,claimed_at::text AS claimed_at
       FROM forge_installation ORDER BY tenant,app`,
  );
  return found.rows;
}

/** Two apps claimed by one tenant and the same account refused to another, as 027 found them. */
async function forgeClaimsBefore027(subject: pg.Pool): Promise<void> {
  assert.equal(
    await forgeClaimRecorded(subject, "portal", "101", "tenant-a"),
    "Recorded",
  );
  assert.equal(
    await forgeClaimRecorded(subject, "worker", "102", "tenant-a"),
    "Recorded",
  );
  assert.equal(
    await forgeClaimRecorded(subject, "portal", "101", "tenant-b"),
    "ClaimedElsewhere",
  );
  assert.deepEqual(await forgeClaimKey(subject), ["forge", "app", "account"]);
}

/** Every reader of a claim, asked for each tenant apart, answers that tenant's own row. */
async function forgeClaimReadersAnswer(subject: pg.Pool): Promise<void> {
  const installations = postgresForgeInstallations(subject);
  const claims = postgresForgeInstallationClaims(subject);
  const asked = {
    forge: asForgeId("github"),
    app: asForgeApp("portal"),
    account: asForgeAccount("acme"),
  };
  for (const [tenant, installationId, held] of [
    ["tenant-a", "101", ["portal", "worker"]],
    ["tenant-b", "103", ["portal"]],
  ] as const) {
    const named = asTenantId(tenant);
    assert.equal(
      (await installations.installation({ ...asked, tenant: named }))
        ?.installationId,
      installationId,
      tenant,
    );
    assert.deepEqual(
      (await claims.claims(named)).claims.map((row) => row.app).sort(),
      held,
      tenant,
    );
    assert.equal(
      (await claims.claim(named, asForgeInstallationId(installationId)))
        ?.account,
      "acme",
      tenant,
    );
  }
}

/** The door is still the boundary owner's and the API's alone, and every role that minted still reads. */
async function forgeClaimGrantsKept(subject: pg.Pool): Promise<void> {
  const door = `${forgeInstallationRecordFunction}(text,text,text,text,text,text,text,text)`;
  assert.deepEqual(await sessionInvocationBoundaries(subject, [door]), [
    {
      signature: door,
      owner: boundaryOwnerRole,
      definer: true,
      scheduler: false,
      plane: false,
      pool: false,
      api: true,
    },
  ]);
  const readers = await subject.query<{ reads: boolean }>(
    `SELECT has_table_privilege(role,'public.forge_installation','SELECT') AS reads
       FROM unnest($1::text[]) AS role`,
    [
      [
        apiRole,
        workerPlaneRole,
        finalizerRole,
        ticketServiceRole,
        configurationImporterRole,
      ],
    ],
  );
  assert.deepEqual(
    readers.rows.map((row) => row.reads),
    [true, true, true, true, true],
  );
}

test("027 keys a forge claim by its tenant, keeping every claim that stood", async () => {
  await migrationDatabaseAt(
    migrations.indexOf(migration027),
    "forge_claim_per_tenant",
    async (subject) => {
      await forgeClaimsBefore027(subject);
      const stood = await forgeClaimRows(subject);
      assert.ok(
        (await postgresMigrate(subject)).includes(migration027.version),
      );
      assert.deepEqual(await forgeClaimKey(subject), [
        "tenant",
        "forge",
        "app",
        "account",
      ]);
      assert.deepEqual(await forgeClaimRows(subject), stood);
      assert.equal(
        await forgeClaimRecorded(subject, "portal", "101", "tenant-a"),
        "AlreadyRecorded",
      );
      assert.equal(
        await forgeClaimRecorded(subject, "portal", "101", "tenant-b"),
        "Recorded",
      );
      assert.equal(
        await forgeClaimRecorded(subject, "portal", "103", "tenant-b"),
        "Reinstalled",
      );
      await forgeClaimReadersAnswer(subject);
      await forgeClaimGrantsKept(subject);
    },
  );
});

test("028 lands a repository bound from here on by pull request, leaving the bindings that stood", async () => {
  await migrationDatabaseAt(
    migrations.indexOf(migration028),
    "binding_lands_by_pull_request",
    async (subject) => {
      await seedLandinglessBinding(subject);
      const landings = async () =>
        (
          await subject.query<{ repository: string; landing_mode: string }>(
            `SELECT repository,landing_mode FROM project_repository
            WHERE tenant='tenant-90' AND project='project-90' ORDER BY repository`,
          )
        ).rows;
      assert.deepEqual(await landings(), [
        { repository: "bound-90", landing_mode: "Push" },
      ]);
      assert.ok(
        (await postgresMigrate(subject)).includes(migration028.version),
      );
      assert.equal(
        (
          await subject.query<{ bound: string }>(
            `SELECT ${repositoryBindingWriteFunction}(
             'tenant-90','project-90','bound-90-after','epoch-90',
             'operation-90','Administrator','test-operator') AS bound`,
          )
        ).rows[0]?.bound,
        "Bound",
      );
      assert.deepEqual(await landings(), [
        { repository: "bound-90", landing_mode: "Push" },
        { repository: "bound-90-after", landing_mode: "PullRequest" },
      ]);
    },
  );
});

/** The placement rows 029 leaves, in project order, and whether each names who set it. */
async function placementRows(subject: pg.Pool): Promise<readonly unknown[]> {
  const found = await subject.query<Record<string, unknown>>(
    `SELECT project, work_route, evaluation_route, set_by_kind, set_at
       FROM project_execution_placement ORDER BY project`,
  );
  return found.rows;
}

/** What 029's constraints refuse: a second routing row, and a setter named in part. */
async function placementRefusals(subject: pg.Pool): Promise<void> {
  await assert.rejects(
    subject.query(`INSERT INTO execution_routing
      (singleton,work_route,evaluation_route,project_routes)
      VALUES (2,'Pool','Pool','{}')`),
    /execution_routing_is_one_row/u,
  );
  await assert.rejects(
    subject.query(
      `UPDATE project_execution_placement SET set_by_kind='Member'`,
    ),
    /project_execution_placement_setter_is_whole/u,
  );
}

test("029 places every project that runs today in cluster, naming no setter, and seeds the routing a scheduler naming none runs", async () => {
  await migrationDatabase("execution_placement", async (subject) => {
    const door = `${executionPlacementSetFunction}(text,text,text,text,text,text)`;
    await installationBefore(subject, migration029.version);
    await subject.query(
      `${tenantSeed("tenant-29")}
       INSERT INTO project(tenant,project,lifecycle) VALUES
         ('tenant-29','project-a','Active'),('tenant-29','project-b','Active')`,
    );
    assert.ok((await postgresMigrate(subject)).includes(migration029.version));
    await subject.query(
      `INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-29','project-c','Active')`,
    );
    assert.deepEqual(
      await placementRows(subject),
      ["project-a", "project-b"].map((project) => ({
        project,
        work_route: "InCluster",
        evaluation_route: "InCluster",
        set_by_kind: null,
        set_at: null,
      })),
      "a project created after the backfill was placed by somebody",
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT work_route, evaluation_route, project_routes FROM execution_routing`,
        )
      ).rows,
      [
        {
          work_route: "InCluster",
          evaluation_route: "InCluster",
          project_routes: {},
        },
      ],
    );
    await placementRefusals(subject);
    assert.deepEqual(await sessionInvocationBoundaries(subject, [door]), [
      {
        signature: door,
        owner: boundaryOwnerRole,
        definer: true,
        scheduler: false,
        plane: false,
        pool: false,
        api: true,
      },
    ]);
  });
});

/** Where each of 032's projects routes its threads and its lead, and from where. */
async function sessionRoutes(subject: pg.Pool): Promise<readonly string[]> {
  const found = await subject.query<{ routed: string }>(
    `SELECT p.project || ' ' || thread.route || '/' || lead.route || ' '
            || thread.source AS routed
       FROM project p
      CROSS JOIN LATERAL ${sessionRouteFunction}(p.tenant,p.project,'Thread') thread
      CROSS JOIN LATERAL ${sessionRouteFunction}(p.tenant,p.project,'Lead') lead
      ORDER BY p.project`,
  );
  return found.rows.map((row) => row.routed);
}

/** What 032's constraints refuse: a second routing row, and a setter named in part. */
async function sessionPlacementRefusals(subject: pg.Pool): Promise<void> {
  await assert.rejects(
    subject.query(`INSERT INTO session_routing
      (singleton,thread_route,lead_route,project_routes)
      VALUES (2,'Pool','Pool','{}')`),
    /session_routing_is_one_row/u,
  );
  await assert.rejects(
    subject.query(`UPDATE project_session_placement SET set_by_kind='Member'`),
    /project_session_placement_setter_is_whole/u,
  );
}

/** A lead session of project-a holding one queued turn, as an installation before 032 holds it. */
const queuedTurnSeed = `
  INSERT INTO execution_cluster(cluster,slots_max,policy_revision)
  VALUES('cluster-32',1,1);
  INSERT INTO capacity_account(account,cluster,reserved,maximum,policy_revision)
  VALUES('account-32','cluster-32',0,1,1);
  INSERT INTO agent_session
    (tenant,project,session,kind,principal,capabilities,credential_slot,account,cluster)
  VALUES('tenant-32','project-a','session-32','Lead','principal-32','{}',
         'slot-32','account-32','cluster-32');
  INSERT INTO session_turn(tenant,project,session,turn,ordinal,input_kind,input)
  VALUES('tenant-32','project-a','session-32','turn-32',1,'Observation','{}')`;

/** That turn stamped in cluster, where it ran, and no default route for a turn queued after it. */
async function queuedTurnStamped(subject: pg.Pool): Promise<void> {
  assert.deepEqual(
    (await subject.query(`SELECT turn, route FROM session_turn`)).rows,
    [{ turn: "turn-32", route: "InCluster" }],
    "a turn queued before the routes ran in cluster",
  );
  await assert.rejects(
    subject.query(
      `INSERT INTO session_turn(tenant,project,session,turn,ordinal,input_kind,input)
       VALUES('tenant-32','project-a','session-32','turn-32-b',2,'Observation','{}')`,
    ),
    /null value in column "route"/u,
    "a turn no door stamped was queued",
  );
}

test("032 places every project's sessions and queued turns in cluster, publishes no routing, and leaves a later project to the default", async () => {
  await migrationDatabase("session_placement", async (subject) => {
    const doors = [
      `${sessionRouteFunction}(text,text,text)`,
      `${sessionRunnerStandingFunction}(text,text,text,bigint)`,
      `${sessionPlacementSetFunction}(text,text,text,text,text,text)`,
    ];
    await installationBefore(subject, migration032.version);
    await subject.query(
      `${tenantSeed("tenant-32")}
       INSERT INTO project(tenant,project,lifecycle) VALUES
         ('tenant-32','project-a','Active'),('tenant-32','project-b','Active');
       ${queuedTurnSeed}`,
    );
    assert.ok((await postgresMigrate(subject)).includes(migration032.version));
    await queuedTurnStamped(subject);
    await subject.query(
      `INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-32','project-c','Active')`,
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT project, set_by_kind, set_at FROM project_session_placement
            ORDER BY project`,
        )
      ).rows,
      ["project-a", "project-b"].map((project) => ({
        project,
        set_by_kind: null,
        set_at: null,
      })),
    );
    assert.deepEqual(
      (await subject.query(`SELECT 1 FROM session_routing`)).rows,
      [],
      "a routing no scheduler published",
    );
    assert.deepEqual(await sessionRoutes(subject), [
      "project-a InCluster/InCluster Project",
      "project-b InCluster/InCluster Project",
      "project-c InCluster/InCluster Default",
    ]);
    await sessionPlacementRefusals(subject);
    assert.deepEqual(
      await sessionInvocationBoundaries(subject, doors),
      doors.map((signature) => ({
        signature,
        owner: boundaryOwnerRole,
        definer: true,
        scheduler: false,
        plane: false,
        pool: false,
        api: true,
      })),
    );
  });
});

/** A held decision for `ticket` at `version`, as its lead recorded it before 034. */
function heldDecisionSeed(
  decision: string,
  named: readonly (readonly [number, number])[],
): string {
  const deliveries = named
    .map(
      ([ticket, version]) =>
        `('${decision}','tenant-34','project-34','${decision}-${String(ticket)}',
          '{"expectedTicketVersion":${String(version)}}',${String(ticket)})`,
    )
    .join(",");
  return `
    INSERT INTO selector_attempt(attempt,tenant,project,state)
      VALUES('${decision}','tenant-34','project-34','Completed');
    INSERT INTO selector_interaction(selector_decision,tenant,project,
      instructions_version,instructions,observed_view,context,tool_activity,
      result,implementation_revision,model_revision,policy_revision,accounting,
      started_at,completed_at)
      VALUES('${decision}','tenant-34','project-34','v','','','','','','r','r',
             'r','',now(),now());
    INSERT INTO selector_proposal_delivery(selector_decision,tenant,project,
      operation,command,ticket) VALUES ${deliveries};`;
}

test("034 ends every held row of a decision naming a ticket that already moved, and keeps the rest", async () => {
  await migrationDatabaseAt(
    migration034.version - 1,
    "held_proposal_currency",
    async (subject) => {
      await subject.query(
        `${tenantSeed("tenant-34")}
       INSERT INTO project(tenant,project,lifecycle)
         VALUES('tenant-34','project-34','Active');
       INSERT INTO ticket_projection(tenant,project,ticket,phase,seq) VALUES
         ('tenant-34','project-34',1,'Work',5),
         ('tenant-34','project-34',2,'Pending',3),
         ('tenant-34','project-34',3,'Pending',2),
         ('tenant-34','project-34',4,'Work',7),
         ('tenant-34','project-34',5,'Pending',1);
       ${heldDecisionSeed("moved", [
         [1, 4],
         [2, 3],
       ])}
       ${heldDecisionSeed("current", [[3, 2]])}
       ${heldDecisionSeed("mixed", [
         [4, 6],
         [5, 1],
       ])}
       UPDATE selector_proposal_delivery SET state='Pending',retry_at=now()
        WHERE selector_decision='mixed' AND ticket=5;`,
      );
      assert.ok(
        (await postgresMigrate(subject)).includes(migration034.version),
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT selector_decision AS decision,ticket::int,state,outcome
             FROM selector_proposal_delivery ORDER BY selector_decision,ticket`,
          )
        ).rows,
        [
          {
            decision: "current",
            ticket: 3,
            state: "AwaitingApproval",
            outcome: null,
          },
          {
            decision: "mixed",
            ticket: 4,
            state: "Terminal",
            outcome: '{"state":"SelectionChanged"}',
          },
          { decision: "mixed", ticket: 5, state: "Pending", outcome: null },
          ...[1, 2].map((ticket) => ({
            decision: "moved",
            ticket,
            state: "Terminal",
            outcome: '{"state":"SelectionChanged"}',
          })),
        ],
      );
      assert.deepEqual(
        (await subject.query(`SELECT 1 FROM selector_proposal_review`)).rows,
        [],
        "a review nobody gave",
      );
    },
  );
});

/** A lead holding objectives and two answered decision turns, as an installation before 042 holds it. */
const measuredLeadSeed = `
  ${tenantSeed("tenant-42")}
  INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-42','project-42','Active');
  INSERT INTO execution_cluster(cluster,slots_max,policy_revision)
  VALUES('cluster-42',1,1);
  INSERT INTO capacity_account(account,cluster,reserved,maximum,policy_revision)
  VALUES('account-42','cluster-42',0,1,1);
  INSERT INTO agent_session
    (tenant,project,session,kind,principal,capabilities,credential_slot,account,
     cluster,system_prompt)
  VALUES('tenant-42','project-42','lead-42','Lead','principal-42','{}',
         'slot-42','account-42','cluster-42','objectives-42');
  INSERT INTO session_turn(tenant,project,session,turn,ordinal,input_kind,input,
    route,state,ended_at,result,model,tokens,cost_micros,duration_ms,tools)
  VALUES
    ('tenant-42','project-42','lead-42','turn-42-a',1,'Observation','{}',
     'InCluster','Answered',now(),'{}','model-42',700,1,1,'{}'),
    ('tenant-42','project-42','lead-42','turn-42-b',2,'Observation','{}',
     'InCluster','Answered',now(),'{}','model-42',900,1,1,'{}')`;

test("042 widens the lead read to its objectives and newest decision measure, and grants the selector its closing door alone", async () => {
  await migrationDatabase("lead_succession", async (subject) => {
    const close = `${leadCloseFunction}(text,text,text)`;
    await installationBefore(subject, migration042.version);
    await subject.query(measuredLeadSeed);
    assert.equal(await migrationHasFunction(subject, close), false);
    assert.ok((await postgresMigrate(subject)).includes(migration042.version));
    assert.deepEqual(
      (
        await subject.query(
          `SELECT session,state,agent_reference,system_prompt,tokens::int
             FROM ${leadSessionFunction}('tenant-42','project-42')`,
        )
      ).rows,
      [
        {
          session: "lead-42",
          state: "Open",
          agent_reference: null,
          system_prompt: "objectives-42",
          tokens: 900,
        },
      ],
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT p.oid::regprocedure::text AS signature,
                  pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
                  array_to_string(p.proconfig,',') AS settings,
                  has_function_privilege($2,p.oid,'EXECUTE') AS selector,
                  has_function_privilege($3,p.oid,'EXECUTE') AS api,
                  has_function_privilege($4,p.oid,'EXECUTE') AS scheduler,
                  has_function_privilege('public',p.oid,'EXECUTE') AS public
             FROM pg_proc p
            WHERE p.oid IN (to_regprocedure($1), to_regprocedure($5))
            ORDER BY p.proname`,
          [
            close,
            selectorServiceRole,
            apiRole,
            schedulerRole,
            `${leadSessionFunction}(text,text)`,
          ],
        )
      ).rows,
      [close, `${leadSessionFunction}(text,text)`].map((signature) => ({
        signature,
        owner: boundaryOwnerRole,
        definer: true,
        settings: "search_path=pg_catalog, public, pg_temp",
        selector: true,
        api: false,
        scheduler: false,
        public: false,
      })),
    );
  });
});

/** One overrides change as a principal's envelope stores it, with whatever a case changes. */
function parkedOverridesEnvelope(
  changed: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    version: 1,
    command: "ChangeTicketOverrides",
    ticket: 1,
    action: "action-43",
    authorizingSeq: 1,
    overrides: { worker: { setup: ["npm ci"] } },
    ...changed,
  });
}

test("043 settles a change that would move a definition under its own code, and knows the envelope that asks for one", async () => {
  await migrationDatabaseAt(
    migration043.version - 1,
    "parked_overrides",
    async (subject) => {
      await subject.query(deletionPartition);
      const valid = async (envelope: string) =>
        (
          await subject.query<{ valid: boolean }>(
            `SELECT public_ticket_command_is_valid($1::jsonb) AS valid`,
            [envelope],
          )
        ).rows[0]?.valid;
      assert.equal(await valid(parkedOverridesEnvelope()), false);
      assert.match(
        String(
          await commandsRefuse(subject, 1, "OverridesMoveDefinition", null),
        ),
        /decision_input_outcome_is_known/u,
      );
      assert.equal(
        await commandsRefuse(subject, 1, "TicketChanged", null),
        null,
      );
      assert.ok(
        (await postgresMigrate(subject)).includes(migration043.version),
      );
      assert.equal(
        await commandsRefuse(subject, 2, "OverridesMoveDefinition", null),
        null,
      );
      assert.equal(await valid(parkedOverridesEnvelope()), true);
      for (const changed of [
        { overrides: ["npm ci"] },
        { ticket: 0 },
        { action: "" },
        { resolution: "Resume" },
      ])
        assert.equal(
          await valid(parkedOverridesEnvelope(changed)),
          false,
          JSON.stringify(changed),
        );
    },
  );
});

/** A selector attempt left running by a process before 045, which kept no project revision. */
const attemptBeforeRevisionSeed = `
  ${tenantSeed("tenant-45")}
  INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-45','project-45','Active');
  INSERT INTO selector_attempt(attempt,tenant,project,state)
  VALUES('attempt-45','tenant-45','project-45','Running')`;

test("045 gives a selector attempt the project revision its decision is fenced on, which the selector writes and an older row lacks", async () => {
  await migrationDatabaseAt(
    migration045.version - 1,
    "selector_attempt_revision",
    async (subject) => {
      await subject.query(attemptBeforeRevisionSeed);
      assert.ok(
        (await postgresMigrate(subject)).includes(migration045.version),
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT attempt,project_revision FROM selector_attempt`,
          )
        ).rows,
        [{ attempt: "attempt-45", project_revision: null }],
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT has_column_privilege($1,'public.selector_attempt','project_revision','UPDATE') AS writes,
                  has_column_privilege($1,'public.selector_attempt','project_revision','SELECT') AS reads`,
            [selectorServiceRole],
          )
        ).rows,
        [{ writes: true, reads: true }],
      );
      await assert.rejects(
        subject.query(
          `UPDATE selector_attempt SET project_revision=-1 WHERE attempt='attempt-45'`,
        ),
        /selector_attempt_project_revision_check/u,
      );
    },
  );
});

/** A tenant's links as 046 kept them: one open, one used and one revoked. */
const tenantLinksBefore047 = `
  INSERT INTO invite_link(link,tenant,token_digest,role,projects,new_accounts,minted_by,expires_at)
  VALUES('open-47','tenant-47',repeat('a',64),'Member','[]',true,'minter',now()+interval '1 day'),
        ('used-47','tenant-47',repeat('b',64),'Admin','[{"project":"web","roles":["Viewer"]}]',false,'minter',now()+interval '1 day'),
        ('revoked-47','tenant-47',repeat('c',64),'Member','[]',false,'minter',now()+interval '1 day');
  UPDATE invite_link SET used_by='user',used_at=now() WHERE link='used-47';
  UPDATE invite_link SET revoked_at=now() WHERE link='revoked-47'`;

/** A workspace link's insert, `extra` the columns past the ones every row names. */
function workspaceLinkInsert047(
  link: string,
  digest: string,
  extra: { readonly columns: string; readonly values: string },
): string {
  return `INSERT INTO invite_link(link,token_digest,new_accounts,minted_by,expires_at,${extra.columns})
    VALUES('${link}',repeat('${digest}',64),false,'minter',now()+interval '1 day',${extra.values})`;
}

/** Asserts each row 047 refuses is refused under the one constraint holding a row to one kind. */
async function workspaceLinkKindsRefused047(subject: pg.Pool): Promise<void> {
  for (const refused of [
    workspaceLinkInsert047("roled-47", "e", {
      columns: "create_accounts,role,projects",
      values: "true,'Member','[]'",
    }),
    `INSERT INTO invite_link(tenant,token_digest,role,projects,new_accounts,create_accounts,minted_by,expires_at)
       VALUES('tenant-47',repeat('f',64),'Member','[]',false,true,'minter',now()+interval '1 day')`,
    workspaceLinkInsert047("unnamed-47", "1", {
      columns: "create_accounts,used_by,used_at",
      values: "true,'user',now()",
    }),
  ])
    await assert.rejects(subject.query(refused), /invite_link_is_one_kind/u);
}

/** Whether the plane's role may update each column 047 adds, and `tenant`. */
async function workspaceLinkUpdates047(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query<Record<string, boolean>>(
      `SELECT has_column_privilege($1,'public.invite_link','workspace','UPDATE') AS workspace,
              has_column_privilege($1,'public.invite_link','tenant','UPDATE') AS tenant,
              has_column_privilege($1,'public.invite_link','note','UPDATE') AS note,
              has_column_privilege($1,'public.invite_link','create_accounts','UPDATE') AS accounts`,
      [accessPlaneRole],
    )
  ).rows;
}

test("047 lets a link name no tenant, keeping every tenant link that stood, and grants the plane's role the workspace and nothing else new", async () => {
  await migrationDatabaseAt(
    migration047.version - 1,
    "workspace_links",
    async (subject) => {
      await subject.query(tenantLinksBefore047);
      const rows = async () =>
        (
          await subject.query<Record<string, unknown>>(
            `SELECT link,tenant,role,projects,new_accounts,used_by,revoked_at IS NOT NULL AS revoked
             FROM invite_link ORDER BY link`,
          )
        ).rows;
      const stood = await rows();
      assert.ok(
        (await postgresMigrate(subject)).includes(migration047.version),
      );
      assert.deepEqual(await rows(), stood);
      assert.deepEqual(await workspaceLinkUpdates047(subject), [
        { workspace: true, tenant: false, note: false, accounts: false },
      ]);
      const links = postgresInviteLinks(subject);
      assert.equal(
        (await links.spend("a".repeat(64), "redeemer"))?.tenant,
        "tenant-47",
      );
      await subject.query(
        workspaceLinkInsert047("site-47", "d", {
          columns: "create_accounts,note",
          values: "true,'for someone'",
        }),
      );
      assert.equal(await links.presented("d".repeat(64)), "Workspace");
      await workspaceLinkKindsRefused047(subject);
      assert.equal(
        (await links.workspaceSpend("d".repeat(64), "user", asTenantId("w-47")))
          ?.spent,
        "Spent",
      );
      await subject.query(
        workspaceLinkInsert047("twin-47", "2", {
          columns: "create_accounts",
          values: "false",
        }),
      );
      assert.deepEqual(
        await links.workspaceSpend("2".repeat(64), "other", asTenantId("w-47")),
        { spent: "Taken" },
      );
    },
  );
});

/** Every binding standing, as the rows 052 must leave as they were. */
async function bindingsStanding052(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT tenant,project,repository,bound_at,retired_at
         FROM project_repository ORDER BY tenant,project,repository`,
    )
  ).rows;
}

/** One bind into `project` through the door, answering its outcome. */
async function boundThrough052(
  subject: pg.Pool,
  project: string,
  repository: string,
): Promise<string | undefined> {
  return (
    await subject.query<{ outcome: string }>(
      `SELECT bind_project_repository('tenant-52',$1,$2,'epoch-52',$3,
         'Administrator','operator-52') AS outcome`,
      [project, repository, `operation-52-${project}-${repository}`],
    )
  ).rows[0]?.outcome;
}

test("052 keeps every binding that stood and releases a retired one's repository to another project", async () => {
  await migrationDatabaseAt(
    migration052.version - 1,
    "retirement_releases",
    async (subject) => {
      await subject.query(
        `INSERT INTO recovery_epoch(epoch) VALUES('epoch-52')`,
      );
      await subject.query(tenantSeed("tenant-52"));
      await subject.query(
        `INSERT INTO project(tenant,project,lifecycle,head,ingress_next)
       VALUES('tenant-52','project-52','Active',0,1),
             ('tenant-52','other-52','Active',0,1)`,
      );
      await subject.query(
        `INSERT INTO project_repository
         (tenant,project,repository,recovery_epoch,retired_at)
       VALUES('tenant-52','project-52','live-52','epoch-52',NULL),
             ('tenant-52','project-52','retired-52','epoch-52',now())`,
      );
      assert.equal(
        await boundThrough052(subject, "other-52", "retired-52"),
        "RepositoryBoundElsewhere",
      );
      const stood = await bindingsStanding052(subject);
      assert.ok(
        (await postgresMigrate(subject)).includes(migration052.version),
      );
      assert.deepEqual(await bindingsStanding052(subject), stood);
      assert.equal(
        await boundThrough052(subject, "other-52", "live-52"),
        "RepositoryBoundElsewhere",
      );
      assert.equal(
        await boundThrough052(subject, "other-52", "retired-52"),
        "Bound",
      );
    },
  );
});

/** The codes 053 admits, which 043's constraint refused. */
const pairingRefusals053: readonly string[] = [
  "BriefChecksUncommanded",
  "ConfigurationFromAnotherRepository",
];

test("053 settles a release under the pairing fault it was refused for, and keeps every code that stood", async () => {
  await migrationDatabaseAt(
    migration053.version - 1,
    "release_pairing_refusals",
    async (subject) => {
      await subject.query(deletionPartition);
      let ordinal = 0;
      for (const code of pairingRefusals053)
        assert.match(
          String(await commandsRefuse(subject, ordinal + 1, code, null)),
          /decision_input_outcome_is_known/u,
          code,
        );
      for (const [code, value] of commandsRefusalsBefore085)
        assert.equal(
          await commandsRefuse(
            subject,
            ++ordinal,
            code,
            commandsRefusal(code, value),
          ),
          null,
          code,
        );
      for (const code of [
        ...commandsBoundaryRefusals,
        "OverridesMoveDefinition",
      ])
        assert.equal(
          await commandsRefuse(subject, ++ordinal, code, null),
          null,
          code,
        );
      await installationAt(subject, migration053.version);
      for (const code of pairingRefusals053)
        assert.equal(
          await commandsRefuse(subject, ++ordinal, code, null),
          null,
          code,
        );
    },
  );
});

/** What each runtime role holds on the refusal 055 keeps, column by column where a grant is. */
async function leadRefusalGrants055(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT grantee,privilege_type,
              string_agg(column_name,',' ORDER BY column_name COLLATE "C") AS columns
         FROM information_schema.column_privileges
        WHERE table_name='selector_lead_refusal' AND grantee <> current_user
        GROUP BY grantee,privilege_type
        ORDER BY grantee,privilege_type`,
    )
  ).rows;
}

/** Whether the selector may delete the refusal 055 keeps, which is no column's privilege. */
async function leadRefusalDeletes055(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query<{ granted: boolean }>(
      `SELECT has_table_privilege($1,'selector_lead_refusal','DELETE') AS granted`,
      [selectorServiceRole],
    )
  ).rows[0]?.granted;
}

/** How 055 declares the refusal's read, and who may execute it. */
async function leadRefusalReadDeclared055(
  subject: pg.Pool,
  read: string,
): Promise<unknown> {
  return (
    await subject.query(
      `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
              array_to_string(p.proconfig,',') AS settings,
              has_function_privilege($2,p.oid,'EXECUTE') AS api,
              has_function_privilege($3,p.oid,'EXECUTE') AS selector,
              has_function_privilege('public',p.oid,'EXECUTE') AS public
         FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
      [read, apiRole, selectorServiceRole],
    )
  ).rows;
}

test("055 keeps no refusal for any project that stood, grants the selector its writes and the API its read alone", async () => {
  await migrationDatabase("lead_refusal", async (subject) => {
    const read = `${leadRefusalReadFunction}(text,text)`;
    await installationBefore(subject, migration055.version);
    await subject.query(deletionPartition);
    assert.equal(await migrationHasFunction(subject, read), false);
    assert.ok((await postgresMigrate(subject)).includes(migration055.version));
    assert.deepEqual(
      (await subject.query(`SELECT * FROM selector_lead_refusal`)).rows,
      [],
    );
    const every = "project,refusal,refused_since,tenant";
    assert.deepEqual(await leadRefusalGrants055(subject), [
      { grantee: boundaryOwnerRole, privilege_type: "SELECT", columns: every },
      {
        grantee: selectorServiceRole,
        privilege_type: "INSERT",
        columns: every,
      },
      {
        grantee: selectorServiceRole,
        privilege_type: "SELECT",
        columns: every,
      },
      {
        grantee: selectorServiceRole,
        privilege_type: "UPDATE",
        columns: "refusal,refused_since",
      },
    ]);
    assert.equal(await leadRefusalDeletes055(subject), true);
    await subject.query(
      `INSERT INTO selector_lead_refusal (tenant,project,refusal)
       VALUES ('tenant-5','project-5','RunnerOffline')`,
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT refusal FROM ${leadRefusalReadFunction}('tenant-5','project-5')`,
        )
      ).rows,
      [{ refusal: "RunnerOffline" }],
    );
    assert.deepEqual(await leadRefusalReadDeclared055(subject, read), [
      {
        owner: boundaryOwnerRole,
        definer: true,
        settings: "search_path=pg_catalog, public, pg_temp",
        api: true,
        selector: false,
        public: false,
      },
    ]);
  });
});

/** What one attempt 056 is run beside keeps of a pool's refusal. */
async function poolRefusalKept056(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT pool_refusal, to_jsonb(a) ? 'pool_refusal_fault' AS has_fault,
              to_jsonb(a)->>'pool_refusal_fault' AS fault
         FROM execution_attempt a WHERE tenant='tenant-5' AND attempt='attempt-1'`,
    )
  ).rows;
}

test("056 keeps every refusal that stood with no fault, admits the contract's image faults alone, and none beside no refusal", async () => {
  await migrationDatabaseAt(
    migration056.version - 1,
    "pool_refusal_fault",
    async (subject) => {
      await subject.query(
        `${deletionPartition}
       ${deletionJournalRow(1, journalledRevocation)};
       UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
       INSERT INTO configuration_revision
         (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
       VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
       INSERT INTO input_bundle(tenant,project,bundle,digest)
       VALUES('tenant-5','project-5','bundle-5',repeat('b',64));
       ${identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3", null)};
       UPDATE execution_attempt
          SET pool='pool-5',pool_principal='principal-5',assignment='assignment-5',
              pool_refusal='no node'
        WHERE tenant='tenant-5' AND attempt='attempt-1'`,
      );
      assert.deepEqual(await poolRefusalKept056(subject), [
        { pool_refusal: "no node", has_fault: false, fault: null },
      ]);
      assert.ok(
        (await postgresMigrate(subject)).includes(migration056.version),
      );
      assert.deepEqual(await poolRefusalKept056(subject), [
        { pool_refusal: "no node", has_fault: true, fault: null },
      ]);
      const known = (
        await subject.query<{ definition: string }>(
          `SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
          WHERE c.conrelid = 'execution_attempt'::regclass
            AND c.conname = 'execution_attempt_pool_refusal_fault_is_known'`,
        )
      ).rows[0]?.definition;
      assert.deepEqual(
        [...(known ?? "").matchAll(/'([^']+)'::text/gu)].map((each) => each[1]),
        [...workerImageFaults],
        "the installed faults are the contract's",
      );
      const faulted = (fault: string, refusal: string | null) =>
        subject
          .query(
            `UPDATE execution_attempt SET pool_refusal=$2,pool_refusal_fault=$1
            WHERE tenant='tenant-5' AND attempt='attempt-1'`,
            [fault, refusal],
          )
          .then(
            () => undefined,
            (failure: unknown) => String(failure),
          );
      assert.equal(await faulted("ImageLacksGit", "git: not found"), undefined);
      assert.match(
        String(await faulted("ImageLacksSed", "sed: not found")),
        /execution_attempt_pool_refusal_fault_is_known/u,
      );
      assert.match(
        String(await faulted("ImageLacksGit", null)),
        /execution_attempt_pool_refusal_fault_is_a_refusal_s/u,
      );
    },
  );
});

/** What one attempt 057 is run beside keeps of a runtime. */
async function attemptRuntimeKept057(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT to_jsonb(a) ? 'runtime' AS has_runtime,
              to_jsonb(a)->>'runtime' AS runtime
         FROM execution_attempt a WHERE tenant='tenant-5' AND attempt='attempt-1'`,
    )
  ).rows;
}

/** Every role but the owner that holds a privilege on the runtime 057 adds, by kind. */
async function attemptRuntimeGrants057(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT grantee,privilege_type FROM information_schema.column_privileges
        WHERE table_name='execution_attempt' AND column_name='runtime'
          AND grantee <> current_user
        ORDER BY grantee,privilege_type`,
    )
  ).rows;
}

test("057 keeps every attempt that stood with no runtime, bounds the one written, and lets the pool plane read it and no role change it", async () => {
  await migrationDatabaseAt(
    migration057.version - 1,
    "attempt_runtime",
    async (subject) => {
      await subject.query(
        `${deletionPartition}
       ${deletionJournalRow(1, journalledRevocation)};
       UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
       INSERT INTO configuration_revision
         (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
       VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
       INSERT INTO input_bundle(tenant,project,bundle,digest)
       VALUES('tenant-5','project-5','bundle-5',repeat('b',64));
       ${identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3", null)}`,
      );
      assert.deepEqual(await attemptRuntimeKept057(subject), [
        { has_runtime: false, runtime: null },
      ]);
      assert.ok(
        (await postgresMigrate(subject)).includes(migration057.version),
      );
      assert.deepEqual(await attemptRuntimeKept057(subject), [
        { has_runtime: true, runtime: null },
      ]);
      assert.deepEqual(await attemptRuntimeGrants057(subject), [
        { grantee: boundaryOwnerRole, privilege_type: "SELECT" },
        { grantee: poolPlaneRole, privilege_type: "SELECT" },
        { grantee: schedulerRole, privilege_type: "INSERT" },
        { grantee: schedulerRole, privilege_type: "SELECT" },
      ]);
      const written = (runtime: string) =>
        subject
          .query(
            `UPDATE execution_attempt SET runtime=$1
            WHERE tenant='tenant-5' AND attempt='attempt-1'`,
            [runtime],
          )
          .then(
            () => undefined,
            (failure: unknown) => String(failure),
          );
      assert.equal(await written("r".repeat(workerImageCharsMax)), undefined);
      for (const runtime of ["", "r".repeat(workerImageCharsMax + 1)])
        assert.match(
          String(await written(runtime)),
          /execution_attempt_runtime_is_bounded/u,
          String(runtime.length),
        );
    },
  );
});

/** Whether each role holds the door 058 moves, in the order it lists them. */
async function projectReadDoors058(subject: pg.Pool): Promise<unknown> {
  const held = async (role: string, door: string) =>
    (
      await subject.query<{ granted: boolean }>(
        "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
        [role, door],
      )
    ).rows[0]?.granted;
  return {
    schedulerLists: await held(
      schedulerRole,
      `${repositoryBindingListFunction}(text,text,bigint)`,
    ),
    planeReadsRetirement: await held(
      workerPlaneRole,
      `${repositoryLandingReadFunction}(text,text,text)`,
    ),
    planeReadsBinding: await held(
      workerPlaneRole,
      `${repositoryBindingReadFunction}(text,text,text)`,
    ),
  };
}

test("058 lets the scheduler list one project's bindings and the worker plane read a binding's retirement, and takes the plane's older door", async () => {
  await migrationDatabaseAt(
    migration058.version - 1,
    "project_reads",
    async (subject) => {
      assert.deepEqual(await projectReadDoors058(subject), {
        schedulerLists: false,
        planeReadsRetirement: false,
        planeReadsBinding: true,
      });
      assert.ok(
        (await postgresMigrate(subject)).includes(migration058.version),
      );
      assert.deepEqual(await projectReadDoors058(subject), {
        schedulerLists: true,
        planeReadsRetirement: true,
        planeReadsBinding: false,
      });
      await assertDoorsStandOwned(subject, [
        `${repositoryBindingListFunction}(text,text,bigint)`,
        `${repositoryLandingReadFunction}(text,text,text)`,
      ]);
    },
  );
});

/** What the one execution 059 is run beside keeps of a size. */
async function executionSizeKept059(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT to_jsonb(e) ? 'cpu_millis' AS has_size,
              to_jsonb(e)->'cpu_millis' AS cpu_millis,
              to_jsonb(e)->'memory_mib' AS memory_mib
         FROM execution e WHERE tenant='tenant-5' AND execution='execution-1'`,
    )
  ).rows;
}

/** Every role but the owner holding a privilege on a size column or on the refusal, by column and kind. */
async function executionSizeGrants059(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT column_name,grantee,privilege_type FROM information_schema.column_privileges
        WHERE ((table_name='execution' AND column_name IN ('cpu_millis','memory_mib'))
            OR (table_name='execution_attempt' AND column_name='pool_refusal'
                AND grantee=$1))
          AND grantee <> current_user
        ORDER BY column_name,grantee,privilege_type`,
      [apiRole],
    )
  ).rows;
}

test("059 keeps every execution that stood on the deployment's size, bounds a size to what a configuration may ask, and lets no role change one", async () => {
  await migrationDatabase("execution_size", async (subject) => {
    await installationBefore(subject, migration059.version);
    await subject.query(
      `${deletionPartition}
       ${deletionJournalRow(1, journalledRevocation)};
       UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
       INSERT INTO configuration_revision
         (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
       VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
       INSERT INTO input_bundle(tenant,project,bundle,digest)
       VALUES('tenant-5','project-5','bundle-5',repeat('b',64));
       ${identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3", null)}`,
    );
    assert.deepEqual(await executionSizeKept059(subject), [
      { has_size: false, cpu_millis: null, memory_mib: null },
    ]);
    assert.ok((await postgresMigrate(subject)).includes(migration059.version));
    assert.deepEqual(await executionSizeKept059(subject), [
      { has_size: true, cpu_millis: null, memory_mib: null },
    ]);
    const granted = (column: string) =>
      [
        { grantee: apiRole, privilege_type: "SELECT" },
        { grantee: boundaryOwnerRole, privilege_type: "SELECT" },
        { grantee: finalizerRole, privilege_type: "SELECT" },
        { grantee: poolPlaneRole, privilege_type: "SELECT" },
        { grantee: schedulerRole, privilege_type: "INSERT" },
        { grantee: schedulerRole, privilege_type: "SELECT" },
      ].map((grant) => ({ column_name: column, ...grant }));
    assert.deepEqual(await executionSizeGrants059(subject), [
      ...granted("cpu_millis"),
      ...granted("memory_mib"),
      {
        column_name: "pool_refusal",
        grantee: apiRole,
        privilege_type: "SELECT",
      },
    ]);
    const sized = (column: string, value: number) =>
      subject
        .query(
          `UPDATE execution SET ${column}=$1
            WHERE tenant='tenant-5' AND execution='execution-1'`,
          [value],
        )
        .then(
          () => undefined,
          (failure: unknown) => String(failure),
        );
    const cpuMillisPerCpu = 1_000;
    for (const [column, least, most] of [
      ["cpu_millis", cpuMillisPerCpu, configurationCpusMax * cpuMillisPerCpu],
      ["memory_mib", configurationMemoryMibMin, configurationMemoryMibMax],
    ] as const) {
      assert.equal(await sized(column, least), undefined, column);
      assert.equal(await sized(column, most), undefined, column);
      for (const value of [least - 1, most + 1])
        assert.match(
          String(await sized(column, value)),
          new RegExp(`execution_${column}_is_bounded`, "u"),
          `${column} ${String(value)}`,
        );
    }
  });
});

/** A proposal over request-5's prepared attempt and its permit as an installation before 060 left one, with `merged` written over it. */
function mergeWaitProposal060(merged: string): string {
  return `${deletionPartition}
  ${renamedFinalization(renamedAttemptPrepared)};
  INSERT INTO commit_permit
    (tenant,project,permit,attempt,recovery_epoch,lifecycle_generation)
  VALUES('tenant-5','project-5','permit-5','attempt-5','epoch-5',1);
  INSERT INTO finalization_change_proposal
    (tenant,project,request,permit,proposal_request,head_ref,head_commit,
     base_ref,base_commit,title,body,attempts,creation,creation_evidence)
  VALUES('tenant-5','project-5','request-5','permit-5',repeat('e',64),
         'refs/heads/chuggy/ticket',repeat('c',40),'refs/heads/main',
         repeat('a',40),'ticket: land it','land it',1,'Created',
         '{"status":"Open"}');
  ${merged}`;
}

/** Whether the proposal 060 found was given its opening as when the forge was last heard about its merge, or nothing. */
async function mergeHeardKept060(
  subject: pg.Pool,
): Promise<readonly { readonly unheard: boolean; readonly opened: boolean }[]> {
  return (
    await subject.query<{ unheard: boolean; opened: boolean }>(
      `SELECT merge_heard_at IS NULL AS unheard,
              merge_heard_at IS NOT DISTINCT FROM opened_at AS opened
         FROM finalization_change_proposal`,
    )
  ).rows;
}

test("060 ages every merge an installation had asked about from its proposal's opening, leaves one never asked unheard, and settles a refusal only on a conflict", async () => {
  for (const [merged, heard] of [
    [
      `UPDATE finalization_change_proposal
          SET merge_attempts=1, merge_reading='Unmerged', merge_readings=1,
              merge_reading_evidence='{"status":"Open","mergeability":"Blocked"}'`,
      { unheard: false, opened: true },
    ],
    [
      "UPDATE finalization_change_proposal SET merge_attempts=1, merge='HeadMoved'",
      { unheard: false, opened: true },
    ],
    ["", { unheard: true, opened: false }],
  ] as const)
    await migrationDatabaseAt(
      migration060.version - 1,
      "merge_waits",
      async (subject) => {
        await subject.query(mergeWaitProposal060(merged));
        assert.ok(
          (await postgresMigrate(subject)).includes(migration060.version),
        );
        assert.deepEqual(await mergeHeardKept060(subject), [heard], merged);
      },
    );

  await migrationDatabaseAt(
    migration060.version - 1,
    "merge_waits_reason",
    async (subject) => {
      await subject.query(
        mergeWaitProposal060(
          "UPDATE finalization_change_proposal SET merge_attempts=1",
        ),
      );
      await postgresMigrate(subject);
      const answered = (reason: string) =>
        subject
          .query(
            `UPDATE finalization_change_proposal
              SET merge='NotMergeable', merge_reason=$1`,
            [reason],
          )
          .then(
            () => undefined,
            (failure: unknown) => String(failure),
          );
      assert.match(
        String(await answered("Blocked")),
        /finalization_change_proposal_merge_is_whole/u,
        "the forge's own rules may lift, so no row settles on them",
      );
      assert.equal(await answered("Conflict"), undefined);
    },
  );
});

/** Every revision's tool allowlist, current first and then the history in order. */
async function toolAllowlists066(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT 'current' AS row, revision::text, controls::jsonb->'toolAllowlist' AS tools
         FROM selector_runtime_settings
       UNION ALL
       SELECT 'history', revision::text, controls::jsonb->'toolAllowlist'
         FROM selector_runtime_settings_history
       ORDER BY 1, 2`,
    )
  ).rows;
}

/** An owner's write of the installation's tool allowlist through the settings door, its controls rendered as `jsonb` renders them. */
async function ownerControls066(
  subject: pg.Pool,
  toolAllowlist: string,
): Promise<void> {
  await subject.query(
    `SELECT * FROM update_selector_runtime_settings(1, NULL, NULL, NULL,
       (SELECT jsonb_set(controls::jsonb, '{toolAllowlist}', $1::jsonb)::text
          FROM selector_runtime_settings),
       'User', 'owner')`,
    [toolAllowlist],
  );
}

/**
 * A migration naming one tool in the allowlist the migration before it left,
 * the label its databases are named by, and the lead's roster it must leave
 * that allowlist holding.
 */
interface ToolAllowlistWidening {
  readonly label: string;
  readonly version: number;
  readonly from: readonly string[];
  readonly tool: string;
  readonly lead: readonly string[];
  readonly seededText: string;
}

/** That `widening` names its tool at its roster place, in place and in its history, and leaves a list an owner wrote. */
async function toolAllowlistWidened(
  widening: ToolAllowlistWidening,
): Promise<void> {
  const held = new Set([
    ...sessionCapabilities.flatMap(
      (capability) => builtInToolCapabilities[capability],
    ),
    ...chuggyToolNames(sessionCapabilities),
  ]);
  await migrationDatabaseAt(
    widening.version - 1,
    widening.label,
    async (subject) => {
      await ownerControls066(subject, JSON.stringify(widening.from));
      await installationAt(subject, widening.version);
      const rows = (await toolAllowlists066(subject)) as readonly {
        readonly row: string;
        readonly revision: string;
        readonly tools: readonly string[];
      }[];
      assert.deepEqual(
        rows.map(({ row, revision }) => `${row} ${revision}`),
        ["current 2", "history 1", "history 2"],
      );
      for (const { tools } of rows) {
        assert.deepEqual(
          tools.filter((tool) => held.has(tool)),
          widening.lead,
        );
        assert.deepEqual(
          tools.filter((tool) => !widening.from.includes(tool)),
          [widening.tool],
        );
      }
      const seeded = await subject.query<{ controls: string }>(
        "SELECT controls FROM selector_runtime_settings_history WHERE revision = 1",
      );
      assert.ok(
        seeded.rows[0]?.controls.includes(widening.seededText),
        "the seed's own row keeps its text",
      );
    },
  );
  await migrationDatabase(`${widening.label}_owned`, async (subject) => {
    const owned = ["Read", "mcp__chuggy__list_tickets"];
    await installationBefore(subject, widening.version);
    await ownerControls066(subject, JSON.stringify(owned));
    await installationAt(subject, widening.version);
    const rows = (await toolAllowlists066(subject)) as readonly {
      readonly row: string;
      readonly tools: readonly string[];
    }[];
    assert.deepEqual(
      rows.map(({ row, tools }) => [
        row,
        tools.includes(widening.tool),
        tools.length,
      ]),
      [
        ["current", false, owned.length],
        ["history", true, widening.from.length + 1],
        ["history", false, owned.length],
      ],
    );
  });
}

test("066 names list_repositories in the seeded allowlist at its roster place, in place and in its history, and leaves a list an owner wrote", async () => {
  await toolAllowlistWidened({
    label: "lead_lists_repositories",
    version: migration066.version,
    from: baselineToolAllowlist,
    tool: "mcp__chuggy__list_repositories",
    lead: leadToolAllowlist.filter(
      (tool) =>
        tool !== "mcp__chuggy__fetch_image" &&
        tool !== "mcp__chuggy__read_run_error" &&
        tool !== "mcp__chuggy__read_ticket_landings",
    ),
    seededText:
      '"mcp__chuggy__read_thread_transcript","mcp__chuggy__list_repositories","mcp__chuggy__initialize_draft"',
  });
});

test("068 names fetch_image in the allowlist 066 left at its roster place, in place and in its history, and leaves a list an owner wrote", async () => {
  await toolAllowlistWidened({
    label: "lead_fetches_images",
    version: migration068.version,
    from: toolAllowlistAt066(),
    tool: "mcp__chuggy__fetch_image",
    lead: leadToolAllowlist.filter(
      (tool) =>
        tool !== "mcp__chuggy__read_run_error" &&
        tool !== "mcp__chuggy__read_ticket_landings",
    ),
    seededText:
      '"mcp__chuggy__list_repositories","mcp__chuggy__fetch_image","mcp__chuggy__initialize_draft"',
  });
});

test("072 names read_run_error in the allowlist 068 left at its roster place, in place and in its history, and leaves a list an owner wrote", async () => {
  await toolAllowlistWidened({
    label: "lead_reads_run_errors",
    version: migration072.version,
    from: toolAllowlistAt068(),
    tool: "mcp__chuggy__read_run_error",
    lead: leadToolAllowlist.filter(
      (tool) => tool !== "mcp__chuggy__read_ticket_landings",
    ),
    seededText:
      '"mcp__chuggy__read_run_transcript","mcp__chuggy__read_run_error","mcp__chuggy__read_operation"',
  });
});

test("079 names read_ticket_landings in the allowlist 072 left at its roster place, in place and in its history, and leaves a list an owner wrote", async () => {
  await toolAllowlistWidened({
    label: "lead_reads_ticket_landings",
    version: migration079.version,
    from: toolAllowlistAt072(),
    tool: "mcp__chuggy__read_ticket_landings",
    lead: leadToolAllowlist,
    seededText:
      '"mcp__chuggy__read_ticket_refusals","mcp__chuggy__read_ticket_landings","mcp__chuggy__read_projects"',
  });
});

/** What each role holds on the attempts 067 keeps, column by column where a grant is. */
async function importAttemptGrants067(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT grantee,privilege_type,
              string_agg(column_name,',' ORDER BY column_name COLLATE "C") AS columns
         FROM information_schema.column_privileges
        WHERE table_name='repository_configuration_import' AND grantee <> current_user
        GROUP BY grantee,privilege_type
        ORDER BY grantee,privilege_type`,
    )
  ).rows;
}

/** How 067 declares its door, and who may execute it. */
async function importAttemptDoorDeclared067(
  subject: pg.Pool,
  door: string,
): Promise<unknown> {
  return (
    await subject.query(
      `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
              array_to_string(p.proconfig,',') AS settings,
              has_function_privilege($2,p.oid,'EXECUTE') AS api,
              has_function_privilege($3,p.oid,'EXECUTE') AS importer,
              has_function_privilege($4,p.oid,'EXECUTE') AS selector,
              has_function_privilege('public',p.oid,'EXECUTE') AS public
         FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
      [door, apiRole, configurationImporterRole, selectorServiceRole],
    )
  ).rows;
}

/** One attempt written through 067's door, answering the refusal where it was refused. */
function importAttemptRecorded067(
  subject: pg.Pool | pg.PoolClient,
  attempt: readonly [string, string | null, string, string | null],
): Promise<string | undefined> {
  const [repository, commit, result, absent] = attempt;
  return subject
    .query(
      `SELECT ${repositoryConfigurationImportRecordFunction}
         ('tenant-5','project-5',$1,$2,$3,$4)`,
      [repository, commit, result, absent],
    )
    .then(
      () => undefined,
      (failure: unknown) => String(failure),
    );
}

/** The attempt 067 keeps of the bound repository, its time left out. */
async function importAttemptKept067(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT repository_commit,result,absent FROM repository_configuration_import
        WHERE tenant='tenant-5' AND project='project-5'`,
    )
  ).rows;
}

test("067 keeps no attempt for any binding that stood, and lets the API and the importer write one through its door alone", async () => {
  await migrationDatabase("configuration_import_attempt", async (subject) => {
    const door = `${repositoryConfigurationImportRecordFunction}(text,text,text,text,text,text)`;
    await installationBefore(subject, migration067.version);
    await subject.query(
      `${deletionPartition}
       INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
       VALUES('tenant-5','project-5','repository-5','epoch-5')`,
    );
    assert.equal(await migrationHasFunction(subject, door), false);
    assert.ok((await postgresMigrate(subject)).includes(migration067.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT version,name FROM schema_migration WHERE version=$1",
          [migration067.version],
        )
      ).rows,
      [{ version: migration067.version, name: migration067.name }],
    );
    assert.deepEqual(await importAttemptKept067(subject), []);
    const every =
      "absent,attempted_at,project,repository,repository_commit,result,tenant";
    assert.deepEqual(await importAttemptGrants067(subject), [
      { grantee: apiRole, privilege_type: "SELECT", columns: every },
      { grantee: boundaryOwnerRole, privilege_type: "INSERT", columns: every },
      { grantee: boundaryOwnerRole, privilege_type: "SELECT", columns: every },
      {
        grantee: boundaryOwnerRole,
        privilege_type: "UPDATE",
        columns: "absent,attempted_at,repository_commit,result",
      },
    ]);
    assert.deepEqual(await importAttemptDoorDeclared067(subject, door), [
      {
        owner: boundaryOwnerRole,
        definer: true,
        settings: "search_path=pg_catalog, public, pg_temp",
        api: true,
        importer: true,
        selector: false,
        public: false,
      },
    ]);
  });
});

/** One attempt 067's door is asked to keep, as repository, commit, result and absence. */
type ImportAttempt067 = readonly [string, string | null, string, string | null];

/** A commit an attempt read. */
const importAttemptCommit067 = "a".repeat(40);

/** Every kind of attempt 067 admits, each replacing the one before it. */
const importAttemptsAdmitted067: readonly ImportAttempt067[] = [
  ["repository-5", importAttemptCommit067, "Imported", null],
  [
    "repository-5",
    importAttemptCommit067,
    "SnapshotAbsent",
    "ConfigurationDirectory",
  ],
  ["repository-5", null, "SnapshotAbsent", "Commit"],
  ["repository-5", null, "Unavailable", null],
  ["repository-5", importAttemptCommit067, "DeclarationsRefused", null],
  ["repository-5", "b".repeat(64), "Imported", null],
];

/** Each attempt 067 refuses, and the constraint it is refused by. */
const importAttemptsRefused067: readonly (readonly [
  ImportAttempt067,
  RegExp,
])[] = [
  [
    ["repository-5", importAttemptCommit067, "Refused", null],
    /_result_is_known/u,
  ],
  [
    ["repository-5", importAttemptCommit067, "SnapshotAbsent", "Branch"],
    /_absent_is_known/u,
  ],
  [
    ["repository-5", importAttemptCommit067, "SnapshotAbsent", null],
    /_absent_is_a_snapshots/u,
  ],
  [
    ["repository-5", importAttemptCommit067, "Imported", "Commit"],
    /_absent_is_a_snapshots/u,
  ],
  [["repository-5", null, "Imported", null], /_commit_was_read/u],
  [
    ["repository-5", null, "SnapshotAbsent", "ConfigurationDirectory"],
    /_commit_was_read/u,
  ],
  [["repository-5", "main", "Imported", null], /_commit_is_git_object/u],
  [
    ["repository-5", "a".repeat(41), "Imported", null],
    /_commit_is_git_object/u,
  ],
  [
    ["repository-5", `x${importAttemptCommit067}`, "Imported", null],
    /_commit_is_git_object/u,
  ],
  [
    ["unbound-5", importAttemptCommit067, "Imported", null],
    /_repository_is_bound/u,
  ],
];

/** A database at 067 holding one bound repository and no attempt of it. */
async function importAttemptBound067(subject: pg.Pool): Promise<void> {
  await installationBefore(subject, migration067.version);
  await subject.query(
    `${deletionPartition}
     INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
     VALUES('tenant-5','project-5','repository-5','epoch-5')`,
  );
  await postgresMigrate(subject);
}

test("067 keeps one attempt a binding, each replacing the one before, and admits only what an attempt can be", async () => {
  await migrationDatabase(
    "configuration_import_attempt_rows",
    async (subject) => {
      await importAttemptBound067(subject);
      for (const attempt of importAttemptsAdmitted067) {
        assert.equal(
          await importAttemptRecorded067(subject, attempt),
          undefined,
        );
        assert.deepEqual(await importAttemptKept067(subject), [
          {
            repository_commit: attempt[1],
            result: attempt[2],
            absent: attempt[3],
          },
        ]);
      }
      for (const [attempt, refusal] of importAttemptsRefused067)
        assert.match(
          String(await importAttemptRecorded067(subject, attempt)),
          refusal,
          attempt.join(" "),
        );
    },
  );
});

/**
 * The door's clock is its transaction's, so of two recordings racing, the one
 * whose transaction began first is the earlier, and finds the later one kept.
 */
test("067 never replaces an attempt with one recorded before it", async () => {
  await migrationDatabase(
    "configuration_import_attempt_order",
    async (subject) => {
      await importAttemptBound067(subject);
      const earlier = await subject.connect();
      try {
        await earlier.query("BEGIN");
        await earlier.query("SELECT now()");
        assert.equal(
          await importAttemptRecorded067(subject, [
            "repository-5",
            importAttemptCommit067,
            "Imported",
            null,
          ]),
          undefined,
        );
        assert.equal(
          await importAttemptRecorded067(earlier, [
            "repository-5",
            "b".repeat(40),
            "StaleBinding",
            null,
          ]),
          undefined,
        );
        await earlier.query("COMMIT");
      } finally {
        earlier.release();
      }
      assert.deepEqual(await importAttemptKept067(subject), [
        {
          repository_commit: importAttemptCommit067,
          result: "Imported",
          absent: null,
        },
      ]);
    },
  );
});

test("069 leaves every pool and every member's runner naming no runner, and keeps one only whole and in the header's grammar", async () => {
  await migrationDatabaseAt(
    migration069.version - 1,
    "runner_versions",
    async (subject) => {
      await subject.query(
        `${deletionPartition}
       INSERT INTO worker_pool(tenant,project,pool,class,principal,client_id)
       VALUES('tenant-5','project-5','pool-69','Dedicated','pool-principal-69','pool-client-69');
       INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
       VALUES('tenant-5','owner-69','{}','runner-principal-69','runner-client-69')`,
      );
      assert.ok(
        (await postgresMigrate(subject)).includes(migration069.version),
      );
      for (const table of ["worker_pool", "personal_runner"]) {
        assert.deepEqual(
          (
            await subject.query(
              `SELECT runner_package,runner_version FROM ${table}`,
            )
          ).rows,
          [{ runner_package: null, runner_version: null }],
          table,
        );
        for (const [runnerPackage, version, refusal] of [
          ["chuggy_linux", "0.14.0", "runner_package_is_a_package"],
          ["chuggy-linux", "0.14.0-rc.1", "runner_version_is_a_release"],
          ["chuggy-linux", "0.014.0", "runner_version_is_a_release"],
          ["chuggy-linux", null, "runner_is_named_whole"],
          [null, "0.14.0", "runner_is_named_whole"],
        ] as const)
          await assert.rejects(
            subject.query(
              `UPDATE ${table} SET runner_package=$1,runner_version=$2`,
              [runnerPackage, version],
            ),
            new RegExp(`${table}_${refusal}`, "u"),
            `${table} ${String(runnerPackage)}/${String(version)}`,
          );
        assert.equal(
          (
            await subject.query(
              `UPDATE ${table} SET runner_package='chuggy-linux',runner_version='0.14.0'`,
            )
          ).rowCount,
          1,
          table,
        );
      }
    },
  );
});

test("070 keeps every member's runner and allowlist, keys a runner by its client beside its member, and lets the API write no column of one in place", async () => {
  await migrationDatabaseAt(
    migration070.version - 1,
    "many_personal_runners",
    async (subject) => {
      await subject.query(
        `${deletionPartition}
       INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
       VALUES('tenant-5','owner-70','{}','runner-principal-70','runner-client-70');
       INSERT INTO personal_runner_project(tenant,owner,project)
       VALUES('tenant-5','owner-70','project-5')`,
      );
      assert.ok(
        (await postgresMigrate(subject)).includes(migration070.version),
      );
      await subject.query(
        `INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
       VALUES('tenant-5','owner-70','{}','runner-principal-71','runner-client-71')`,
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT r.client_id,l.project FROM personal_runner r
             JOIN personal_runner_project l ON l.tenant=r.tenant AND l.owner=r.owner
            ORDER BY r.client_id`,
          )
        ).rows,
        [
          { client_id: "runner-client-70", project: "project-5" },
          { client_id: "runner-client-71", project: "project-5" },
        ],
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT pg_get_constraintdef(oid) AS keyed FROM pg_constraint
            WHERE conrelid='public.personal_runner'::regclass AND contype='p'`,
          )
        ).rows,
        [{ keyed: "PRIMARY KEY (tenant, owner, client_id)" }],
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT a.attname AS writable FROM pg_attribute a
            WHERE a.attrelid='public.personal_runner'::regclass AND a.attnum>0
              AND NOT a.attisdropped
              AND has_column_privilege($1,'public.personal_runner',a.attname,'UPDATE')`,
            [apiRole],
          )
        ).rows,
        [],
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT p.proname AS installed,p.proowner::regrole::text AS owner
             FROM pg_proc p
            WHERE p.proname = ANY($1::text[]) ORDER BY p.proname`,
            [[personalRunnerFenceFunction, personalSessionOpenFunction]],
          )
        ).rows,
        [personalRunnerFenceFunction, personalSessionOpenFunction]
          .toSorted()
          .map((installed) => ({ installed, owner: boundaryOwnerRole })),
      );
    },
  );
});

/** What the binding 076 is run beside answers of its pipeline definitions, through each door that answers a whole one. */
async function pipelinesWritableAnswered076(
  subject: pg.Pool,
): Promise<unknown> {
  return {
    listed: (
      await subject.query(
        `SELECT repository,pipelines_writable
           FROM ${repositoryBindingListFunction}('tenant-90','project-90',NULL)`,
      )
    ).rows,
    read: (
      await subject.query(
        `SELECT pipelines_writable
           FROM ${repositoryLandingReadFunction}('tenant-90','project-90','bound-90')`,
      )
    ).rows,
  };
}

/** Whether each role 076 grants a binding door to still holds it, and the finalizer the read. */
async function pipelinesWritableHolders076(subject: pg.Pool): Promise<unknown> {
  const held = async (role: string, door: string) =>
    (
      await subject.query<{ granted: boolean }>(
        "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
        [role, door],
      )
    ).rows[0]?.granted;
  const read = `${repositoryLandingReadFunction}(text,text,text)`;
  const list = `${repositoryBindingListFunction}(text,text,bigint)`;
  return {
    schedulerLists: await held(schedulerRole, list),
    planeReads: await held(workerPlaneRole, read),
    finalizerReads: await held(finalizerRole, read),
    finalizerLists: await held(finalizerRole, list),
    publicReads: await held("public", read),
  };
}

test("076 starts every binding that stood without the pipeline definitions, and lets the landing door alone allow them", async () => {
  await migrationDatabase("pipelines_writable", async (subject) => {
    await installationBefore(subject, migration076.version);
    await seedLandinglessBinding(subject);
    assert.ok((await postgresMigrate(subject)).includes(migration076.version));
    assert.deepEqual(await pipelinesWritableAnswered076(subject), {
      listed: [{ repository: "bound-90", pipelines_writable: false }],
      read: [{ pipelines_writable: false }],
    });
    assert.deepEqual(await pipelinesWritableHolders076(subject), {
      schedulerLists: true,
      planeReads: true,
      finalizerReads: true,
      finalizerLists: false,
      publicReads: false,
    });
    await assertDoorsStandOwned(subject, [
      `${repositoryRetirementWriteFunction}(text,text,text)`,
      `${repositoryBindingListFunction}(text,text,bigint)`,
      `${repositoryLandingReadFunction}(text,text,text)`,
      `${repositoryLandingWriteFunction}(text,text,text,text,text,boolean,boolean)`,
    ]);
    assert.equal(
      await migrationHasFunction(
        subject,
        `${repositoryLandingWriteFunction}(text,text,text,text,text)`,
      ),
      false,
      "the write that could not say the pipeline definitions is gone",
    );
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_column_privilege($1,'project_repository','pipelines_writable','UPDATE') AS granted",
          [boundaryOwnerRole],
        )
      ).rows[0]?.granted,
      true,
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT outcome,landing_mode,pipelines_writable
             FROM ${repositoryLandingWriteFunction}(
               'tenant-90','project-90','bound-90','PullRequest','PullRequest',false,true)`,
        )
      ).rows,
      [
        {
          outcome: "Written",
          landing_mode: "PullRequest",
          pipelines_writable: true,
        },
      ],
    );
    await assert.rejects(
      subject.query(
        `UPDATE project_repository SET recovery_epoch='epoch-90',bound_at=now()
          WHERE tenant='tenant-90' AND project='project-90'`,
      ),
      /repository bindings are immutable/u,
      "the trigger lets the setting move and nothing more",
    );
  });
});

/** The columns each registration token relation holds, by relation. */
async function tokenColumns077(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT table_name::text AS relation,
              array_agg(column_name::text ORDER BY column_name) AS columns
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name IN ('worker_pool_registration_token',
                             'personal_runner_registration_token')
        GROUP BY table_name ORDER BY table_name`,
    )
  ).rows;
}

test("077 drops the capabilities each registration token was minted with, and a token standing across it is still spent once", async () => {
  await migrationDatabase("tokens_carry_no_capabilities", async (subject) => {
    const pooled = "a".repeat(64);
    const personal = "b".repeat(64);
    const minter = "https://issuer.invalid#a-member";
    await installationBefore(subject, migration077.version);
    await subject.query(`
      ${tenantSeed("tenant-77")}
      INSERT INTO project(tenant,project,lifecycle)
      VALUES('tenant-77','project-77','Active');
      INSERT INTO worker_pool_registration_token
        (token_digest,tenant,project,capabilities,expires_at,minted_by)
      VALUES('${pooled}','tenant-77','project-77','{Platform:Linux:Amd64}',
             now()+interval '1 hour','${minter}');
      INSERT INTO personal_runner_registration_token
        (token_digest,tenant,minted_by,capabilities,expires_at)
      VALUES('${personal}','tenant-77','${minter}','{Agent:Claude}',
             now()+interval '1 hour');`);
    assert.ok((await postgresMigrate(subject)).includes(migration077.version));
    assert.deepEqual(await tokenColumns077(subject), [
      {
        relation: "personal_runner_registration_token",
        columns: [
          "expires_at",
          "minted_at",
          "minted_by",
          "redeemed_at",
          "tenant",
          "token_digest",
        ],
      },
      {
        relation: "worker_pool_registration_token",
        columns: [
          "expires_at",
          "minted_at",
          "minted_by",
          "project",
          "redeemed_at",
          "tenant",
          "token_digest",
        ],
      },
    ]);
    const pool = postgresWorkerPoolRegistrationTokens(subject);
    assert.deepEqual(await pool.consume(pooled), {
      partition: { tenant: "tenant-77", project: "project-77" },
      mintedBy: minter,
    });
    assert.equal(await pool.consume(pooled), undefined);
    const member = postgresPersonalRunnerRegistrationTokens(subject);
    assert.deepEqual(await member.consume(personal), {
      tenant: "tenant-77",
      mintedBy: minter,
    });
    assert.equal(await member.consume(personal), undefined);
  });
});

/** What request-5's reading and hold hold, as 081 is asked about them. */
async function declinedRows081(subject: pg.Pool): Promise<unknown> {
  return {
    readings: (
      await subject.query(
        "SELECT verdict,declined FROM finalization_reconciliation",
      )
    ).rows,
    holds: (await subject.query("SELECT hold_kind FROM finalization_request"))
      .rows,
  };
}

test("081 keeps every reading and hold that stood, and admits a decline beside not promoted and the two holds a decline waits at", async () => {
  await migrationDatabase("promotion_declined", async (subject) => {
    await installationBefore(subject, migration081.version);
    await subject.query(`${deletionPartition}
      ${renamedFinalization(renamedAttemptPrepared)};
      INSERT INTO commit_permit
        (tenant,project,permit,attempt,recovery_epoch,lifecycle_generation)
      VALUES('tenant-5','project-5','permit-5','attempt-5','epoch-5',1);
      INSERT INTO finalization_reconciliation
        (tenant,project,permit,candidate_commit,target_ref,verdict,observed_commit)
      VALUES('tenant-5','project-5','permit-5',repeat('c',40),'refs/heads/main',
             'Unreadable',NULL);
      UPDATE finalization_request
         SET hold_kind='PreparationRestartsExhausted',hold_passes=1,held_since=now()`);
    assert.ok((await postgresMigrate(subject)).includes(migration081.version));
    assert.deepEqual(await declinedRows081(subject), {
      readings: [{ verdict: "Unreadable", declined: null }],
      holds: [{ hold_kind: "PreparationRestartsExhausted" }],
    });
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_column_privilege($1,'finalization_reconciliation','declined','UPDATE') AS granted",
          [finalizerRole],
        )
      ).rows[0]?.granted,
      true,
    );
    await assert.rejects(
      subject.query(
        `UPDATE finalization_reconciliation
            SET verdict='Promoted',observed_commit=repeat('c',40),declined='RemoteDeclined'`,
      ),
      /finalization_reconciliation_decline_is_known/u,
    );
    await subject.query(
      `UPDATE finalization_reconciliation
          SET verdict='NotPromoted',observed_commit=repeat('a',40),declined='WorkflowsRefused';
       UPDATE finalization_request SET hold_kind='PromotionWorkflowsRefused'`,
    );
    assert.deepEqual(await declinedRows081(subject), {
      readings: [{ verdict: "NotPromoted", declined: "WorkflowsRefused" }],
      holds: [{ hold_kind: "PromotionWorkflowsRefused" }],
    });
  });
});

/** One reading request-5's permits hold, as 082 is asked about it. */
interface Reading082 {
  readonly permit: string;
  readonly verdict: string;
  readonly unobserved: boolean;
  readonly declined: string | null;
}

/** Every reading request-5's permits hold, in permit order. */
async function readings082(subject: pg.Pool): Promise<readonly Reading082[]> {
  return (
    await subject.query<Reading082>(
      `SELECT permit,verdict,observed_commit IS NULL AS unobserved,declined
         FROM finalization_reconciliation ORDER BY permit`,
    )
  ).rows;
}

/** A concluded permit whose reading kept a decline over a ref that held a commit, beside a granted one whose reading is held unread. */
const readingsBefore082 = `${deletionPartition}
  ${renamedFinalization(renamedAttemptPrepared)};
  INSERT INTO finalization_attempt
    (tenant,project,attempt,request,ticket,repository,input_bundle,input_bundle_digest,
     target_ref,target_commit,strategy,configuration_revision,configuration_digest,
     attempt_digest,approval_required,outcome,candidate_commit,failure_kind)
  VALUES('tenant-5','project-5','attempt-5a','request-5',1,'repository-5','bundle-5',
         repeat('b',64),'refs/heads/main',repeat('c',40),'Merge','revision-5','digest-5',
         repeat('e',64),true,'Prepared',repeat('a',40),NULL);
  INSERT INTO commit_permit
    (tenant,project,permit,attempt,recovery_epoch,lifecycle_generation)
  VALUES('tenant-5','project-5','permit-5a','attempt-5a','epoch-5',1);
  INSERT INTO finalization_reconciliation
    (tenant,project,permit,candidate_commit,target_ref,verdict,observed_commit,declined)
  VALUES('tenant-5','project-5','permit-5a',repeat('a',40),'refs/heads/main',
         'NotPromoted',repeat('c',40),'RemoteDeclined');
  UPDATE commit_permit SET state='Concluded',concluded_at=now() WHERE permit='permit-5a';
  INSERT INTO commit_permit
    (tenant,project,permit,attempt,recovery_epoch,lifecycle_generation)
  VALUES('tenant-5','project-5','permit-5','attempt-5','epoch-5',1);
  INSERT INTO finalization_reconciliation
    (tenant,project,permit,candidate_commit,target_ref,verdict,observed_commit)
  VALUES('tenant-5','project-5','permit-5',repeat('c',40),'refs/heads/main',
         'Unreadable',NULL)`;

/** The readings 082 still refuses, each an assignment to the held one and the constraint that refuses it. */
const refusedAfter082 = [
  ["verdict='Promoted',declined=NULL", "reading_is_whole"],
  ["verdict='Unreadable',observed_commit=repeat('c',40)", "reading_is_whole"],
  ["verdict='Promoted',observed_commit=repeat('c',40)", "decline_is_known"],
] as const;

test("082 keeps every reading that stood, and admits a decline beside an unread ref and a declined ref read absent", async () => {
  await migrationDatabase("decline_kept_unread", async (subject) => {
    await installationBefore(subject, migration082.version);
    await subject.query(readingsBefore082);
    assert.ok((await postgresMigrate(subject)).includes(migration082.version));
    assert.deepEqual(await readings082(subject), [
      {
        permit: "permit-5",
        verdict: "Unreadable",
        unobserved: true,
        declined: null,
      },
      {
        permit: "permit-5a",
        verdict: "NotPromoted",
        unobserved: false,
        declined: "RemoteDeclined",
      },
    ]);
    const store = postgresFinalizer(subject);
    const epoch = asRecoveryEpoch("epoch-5");
    assert.equal((await store.heldPermits(epoch, 8))[0]?.declined, undefined);
    await subject.query(
      "UPDATE finalization_reconciliation SET declined='WorkflowsRefused' WHERE permit='permit-5'",
    );
    assert.equal(
      (await store.heldPermits(epoch, 8))[0]?.declined,
      "WorkflowsRefused",
      "a held reading hands its decline to the re-read",
    );
    for (const [assignment, constraint] of refusedAfter082) {
      await assert.rejects(
        subject.query(
          `UPDATE finalization_reconciliation SET ${assignment} WHERE permit='permit-5'`,
        ),
        new RegExp(`finalization_reconciliation_${constraint}`, "u"),
        assignment,
      );
    }
    await subject.query(
      "UPDATE finalization_reconciliation SET verdict='NotPromoted' WHERE permit='permit-5'",
    );
    assert.deepEqual((await readings082(subject))[0], {
      permit: "permit-5",
      verdict: "NotPromoted",
      unobserved: true,
      declined: "WorkflowsRefused",
    });
  });
});

/** An attempt over a target the remote did not hold, its commit read from the binding's own branch. */
const unheldAttempt083 = `INSERT INTO finalization_attempt
    (tenant,project,attempt,request,ticket,repository,input_bundle,input_bundle_digest,
     target_ref,target_commit,target_base_ref,strategy,configuration_revision,
     configuration_digest,attempt_digest,approval_required,outcome,candidate_commit,
     failure_kind)
  VALUES('tenant-5','project-5','attempt-5b','request-5',1,'repository-5','bundle-5',
         repeat('b',64),'refs/heads/chuggy/unheld',repeat('c',40),$1,'Merge',
         'revision-5','digest-5',repeat('e',64),false,'Prepared',repeat('a',40),NULL)`;

/** The readings 083 still refuses, each an assignment to the held one and the constraint that refuses it. */
const refusedAfter083 = [
  ["verdict='Unreadable',observed_commit=repeat('c',40)", "reading_is_whole"],
  ["verdict='Promoted'", "reading_is_whole"],
] as const;

test("083 reads every attempt that stood as over a held target, keeps a bounded base ref, and admits a reading not promoted over an absent ref with no decline", async () => {
  await migrationDatabase("attempt_base_ref", async (subject) => {
    await installationBefore(subject, migration083.version);
    await subject.query(readingsBefore082);
    assert.ok((await postgresMigrate(subject)).includes(migration083.version));
    assert.deepEqual(
      (
        await subject.query(
          "SELECT attempt,target_base_ref FROM finalization_attempt ORDER BY attempt",
        )
      ).rows,
      [
        { attempt: "attempt-5", target_base_ref: null },
        { attempt: "attempt-5a", target_base_ref: null },
      ],
    );
    const held = await postgresFinalizer(subject).heldPermits(
      asRecoveryEpoch("epoch-5"),
      8,
    );
    assert.deepEqual(
      held.map((each) => [each.permit, each.baseRef]),
      [["permit-5", undefined]],
    );
    await assert.rejects(
      subject.query(unheldAttempt083, [""]),
      /finalization_attempt_target_base_ref_is_bounded/u,
    );
    await subject.query(unheldAttempt083, ["refs/heads/main"]);
    for (const [assignment, constraint] of refusedAfter083) {
      await assert.rejects(
        subject.query(
          `UPDATE finalization_reconciliation SET ${assignment} WHERE permit='permit-5'`,
        ),
        new RegExp(`finalization_reconciliation_${constraint}`, "u"),
        assignment,
      );
    }
    await subject.query(
      "UPDATE finalization_reconciliation SET verdict='NotPromoted' WHERE permit='permit-5'",
    );
    assert.deepEqual((await readings082(subject))[0], {
      permit: "permit-5",
      verdict: "NotPromoted",
      unobserved: true,
      declined: null,
    });
  });
});

/** The rosters of every thread, by principal. */
async function threadRosters084(subject: pg.Pool): Promise<readonly unknown[]> {
  return (
    await subject.query<{ principal: string; capabilities: string[] }>(
      `SELECT principal,capabilities FROM agent_session
        WHERE kind='Thread' ORDER BY principal`,
    )
  ).rows;
}

test("084 leaves an open thread's roster as it stood, and a thread opened after it may dispatch", async () => {
  await migrationDatabase("thread_dispatch", async (subject) => {
    await installationBefore(subject, migration084.version);
    await subject.query(`${tenantSeed("tenant-84")}
      INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-84','project-84','Active');
      SELECT * FROM open_member_thread('tenant-84','project-84','principal-a',
        'session-84-a','slot-84','objectives-84')`);
    await installationAt(subject, migration084.version);
    await subject.query(
      `SELECT * FROM open_member_thread('tenant-84','project-84','principal-b',
         'session-84-b','slot-84','objectives-84')`,
    );
    const opened = [
      "RepositoryRead",
      "RunCommands",
      "ProjectRead",
      "DraftAuthor",
      "DraftOriginate",
    ];
    assert.deepEqual(await threadRosters084(subject), [
      { principal: "principal-a", capabilities: opened },
      {
        principal: "principal-b",
        capabilities: [...opened, "TicketDispatch"],
      },
    ]);
    await assert.rejects(
      subject.query(
        `INSERT INTO agent_session
           (tenant,project,session,kind,principal,capabilities,credential_slot,
            account,cluster)
         SELECT tenant,project,'session-84-c','Lead','principal-c',
                ARRAY['Unknown']::text[],credential_slot,account,cluster
           FROM agent_session WHERE session='session-84-a'`,
      ),
      /agent_session_capabilities_are_known/u,
    );
  });
});

/** Each draft 086 found, and the origin it gave it. */
async function draftOrigins086(subject: pg.Pool): Promise<readonly unknown[]> {
  return (
    await subject.query<{ ticket: number; origin: string | null }>(
      `SELECT ticket::int AS ticket,origin_session AS origin FROM draft
        ORDER BY ticket`,
    )
  ).rows;
}

/** What `open_member_thread` answers a member opening under a key once 086 stands. */
async function opened086(
  subject: pg.Pool,
  session: string,
  key: string,
): Promise<unknown> {
  return (
    await subject.query<{ opened: string; session: string | null }>(
      `SELECT opened,session FROM open_member_thread('tenant-86','project-86',
         'principal-a',$1,$2,'slot-86','objectives-86')`,
      [session, key],
    )
  ).rows[0];
}

test("086 gives a draft that stood the thread its first author held open, and lets a member open several", async () => {
  await migrationDatabase("several_threads", async (subject) => {
    await installationBefore(subject, migration086.version);
    await subject.query(`${tenantSeed("tenant-86")}
      INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-86','project-86','Active');
      INSERT INTO configuration_revision
        (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
      VALUES('tenant-86','project-86','revision-86','{}','digest-86','Agent','subject-86');
      SELECT * FROM open_member_thread('tenant-86','project-86','principal-a',
        'session-86-a','slot-86','objectives-86');
      SELECT * FROM open_member_thread('tenant-86','project-86','principal-b',
        'session-86-b','slot-86','objectives-86');
      SELECT close_agent_session('tenant-86','project-86','session-86-b');
      INSERT INTO draft (tenant,project,ticket,authoring_version,state,configuration_revision)
      VALUES('tenant-86','project-86',1,2,'Draft','revision-86'),
            ('tenant-86','project-86',2,1,'Draft','revision-86'),
            ('tenant-86','project-86',3,1,'Draft','revision-86'),
            ('tenant-86','project-86',4,1,'Draft','revision-86');
      INSERT INTO draft_revision
        (tenant,project,ticket,authoring_version,configuration_revision,
         authoring,authority_kind,authority_subject)
      VALUES('tenant-86','project-86',1,1,'revision-86','{}','Member','principal-a'),
            ('tenant-86','project-86',1,2,'revision-86','{}','Member','principal-c'),
            ('tenant-86','project-86',2,1,'revision-86','{}','Member','principal-b'),
            ('tenant-86','project-86',3,1,'revision-86','{}','Test','principal-a'),
            ('tenant-86','project-86',4,1,'revision-86','{}','Member','principal-c')`);
    assert.ok((await postgresMigrate(subject)).includes(migration086.version));

    assert.deepEqual(await draftOrigins086(subject), [
      { ticket: 1, origin: "session-86-a" },
      { ticket: 2, origin: null },
      { ticket: 3, origin: null },
      { ticket: 4, origin: null },
    ]);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT indexname FROM pg_indexes
            WHERE indexname='agent_session_one_thread_per_member'`,
        )
      ).rows,
      [],
    );

    assert.deepEqual(await opened086(subject, "session-86-c", "key-c"), {
      opened: "Opened",
      session: "session-86-c",
    });
    assert.deepEqual(await opened086(subject, "session-86-d", "key-c"), {
      opened: "AlreadyOpen",
      session: "session-86-c",
    });
    await subject.query(
      `SELECT set_member_thread_limit('tenant-86','project-86','principal-a',2,
         'Test','migration suite')`,
    );
    assert.deepEqual(await opened086(subject, "session-86-e", "key-e"), {
      opened: "ThreadLimitReached",
      session: null,
    });
  });
});
