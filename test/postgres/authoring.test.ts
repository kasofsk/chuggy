import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresAuthoring } from "../../src/adapters/postgres/authoring.ts";
import { postgresDomainConfigurationPrecondition } from "../../src/adapters/postgres/domainConfiguration.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { migration048 } from "../../src/adapters/postgres/schema/migrations/048-repository-configuration-version.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  repositoryConfigurationImportReadiness,
  type RepositoryConfigurationDeclaration,
} from "../../src/interpreter/repositoryConfiguration.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asIdempotencyKey,
  asOperationId,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import {
  projectWriterDecide,
  projectWriterLoad,
} from "../../src/interpreter/projectWriter.ts";
import {
  asRecoveryEpoch,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import { briefLinksMax } from "../../src/contract/brief.ts";
import { asDraftBrief } from "../../src/interpreter/ticketBrief.ts";
import { postgresTicketBrief } from "../../src/adapters/postgres/ticketBrief.ts";
import {
  postgresHarnessBrief,
  postgresHarnessHeld,
  postgresHarnessConfiguration,
  postgresHarnessReleaseSubmission,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessUrl,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let pool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  pool = postgresPool(postgresHarnessUrl());
});
after(async () => {
  await pool.end();
  await harness.close();
});

const authority = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("author"),
};

/** The migration's own backfill, so a case proves that statement and not a copy. */
function configurationVersionBackfill(): string {
  const statement = migration048.statements.find((value) =>
    value.startsWith("INSERT INTO repository_configuration_version"),
  );
  if (statement === undefined)
    throw new Error("the configuration version backfill is absent");
  return statement;
}

async function repositoryBinding(partition: Partition) {
  const [row] = await harness.query(`SELECT epoch FROM recovery_epoch LIMIT 1`);
  const epoch = row?.["epoch"];
  if (typeof epoch !== "string") throw new Error("recovery epoch is absent");
  const recoveryEpoch = asRecoveryEpoch(epoch);
  const repository = asRepositoryId(
    `repository-${partition.tenant}-${partition.project}`,
  );
  await harness.query(
    `INSERT INTO project_repository (tenant,project,repository,recovery_epoch)
       VALUES ($1,$2,$3,$4)`,
    [partition.tenant, partition.project, repository, recoveryEpoch],
  );
  return {
    partition,
    repository,
    recoveryEpoch,
  };
}

test("the ticket service refuses policy drift from the installed authority", async () => {
  assert.equal(
    await postgresDomainConfigurationPrecondition(
      pool,
      refinementInstance,
    ).check(new AbortController().signal),
    true,
  );
  assert.equal(
    await postgresDomainConfigurationPrecondition(pool, {
      ...refinementInstance,
      nTasks: refinementInstance.nTasks + 1,
    }).check(new AbortController().signal),
    false,
  );
});

function repositoryDeclarations(
  commitValue: string,
  names: readonly string[],
  image = "worker:v1",
): readonly RepositoryConfigurationDeclaration[] {
  const ready = repositoryConfigurationImportReadiness({
    repository: asRepositoryId("repository"),
    commit: asGitObjectId(commitValue),
    files: names.map((name) => ({
      path: `.chug/configurations/${name}.json`,
      kind: "File" as const,
      content: JSON.stringify({
        version: 1,
        name,
        configuration: {
          version: 1,
          image,
          practices: [],
          brief: {
            motivation: ["The ticket should be completed."],
            acceptanceCriteria: ["The ticket is complete."],
            constraints: [],
          },
          work: { instructions: [] },
          review: { instructions: [] },
        },
      }),
    })),
  });
  if (ready.readiness === "Refused")
    throw new Error("repository configuration fixture was refused");
  return ready.declarations;
}

async function draftFixture(canonical = postgresHarnessConfiguration) {
  const partition = await postgresHarnessProject(
    harness.store,
    "authoring-draft",
  );
  const store = postgresAuthoring(pool);
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  await store.createConfiguration({
    partition,
    authority,
    revision,
    canonical,
  });
  const initialized = await store.initializeDraft(partition, revision, 100);
  if (initialized === undefined || initialized === "PolicyUnavailable")
    throw new Error("draft fixture was not initialized");
  const created = await store.createDraft({
    partition,
    authority,
    configurationRevision: revision,
    configurationDigest: initialized.configuration.digest,
    expectedProjectSequence: initialized.projectSequence,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  if (created.created !== "Created")
    throw new Error("draft fixture was not created");
  return { partition, store, revision, draft: created.draft };
}

test("draft creation rejects a stale initialization fence", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "draft-initialization-stale",
  );
  const store = postgresAuthoring(pool);
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  await store.createConfiguration({
    partition,
    authority,
    revision,
    canonical: postgresHarnessConfiguration,
  });
  const initialized = await store.initializeDraft(partition, revision, 100);
  if (initialized === undefined || initialized === "PolicyUnavailable")
    throw new Error("draft was not initialized");
  await harness.query(
    "UPDATE project SET head=head+1 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  assert.deepEqual(
    await store.createDraft({
      partition,
      authority,
      configurationRevision: revision,
      configurationDigest: initialized.configuration.digest,
      expectedProjectSequence: initialized.projectSequence,
      authoring: plainAuthoring,
      brief: postgresHarnessBrief,
    }),
    { created: "Stale" },
  );
});

function releaseSubmission(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
): Submission {
  const unique = randomUUID();
  return {
    partition: fixture.partition,
    operation: asOperationId(`release-${unique}`),
    authority,
    key: asIdempotencyKey(`release-${unique}`),
    command: {
      version: 1,
      command: "ReleaseDraft",
      ticket: fixture.draft.ticket,
      authoringVersion: fixture.draft.authoringVersion,
      configurationRevision: fixture.revision,
    },
  };
}

async function assertReleaseConfigurationPinned(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
): Promise<void> {
  assert.deepEqual(
    await harness.query(
      `SELECT configuration_revision,configuration_digest
         FROM journal_entry WHERE tenant=$1 AND project=$2 AND seq=1`,
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [
      {
        configuration_revision: fixture.revision,
        configuration_digest: createHash("sha256")
          .update(postgresHarnessConfiguration)
          .digest("hex"),
      },
    ],
  );
}

test("configuration revisions are immutable and parented inside one project", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "authoring-config",
  );
  const store = postgresAuthoring(pool);
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  const canonical = asCanonicalConfiguration('{"image":"worker:v1"}');
  assert.equal(
    (
      await store.createConfiguration({
        partition,
        authority,
        revision,
        canonical,
      })
    ).created,
    "Created",
  );
  assert.equal(
    (
      await store.createConfiguration({
        partition,
        authority,
        revision,
        canonical,
      })
    ).created,
    "AlreadyExists",
  );
  assert.deepEqual(
    await store.createConfiguration({
      partition,
      authority,
      revision,
      canonical: asCanonicalConfiguration('{"image":"worker:v2"}'),
    }),
    { created: "IdentityConflict" },
  );
  assert.deepEqual(
    await store.createConfiguration({
      partition,
      authority,
      revision,
      parent: asConfigurationRevisionId(`missing-${randomUUID()}`),
      canonical,
    }),
    { created: "IdentityConflict" },
  );
});

test("configuration pages are newest-first, bounded, and project-local", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "authoring-configuration-page",
  );
  const other = await postgresHarnessProject(
    harness.store,
    "authoring-configuration-page-other",
  );
  const revisions = ["revision-a", "revision-b", "revision-c"].map(
    asConfigurationRevisionId,
  );
  for (const revision of revisions) {
    await harness.authoring.createConfiguration({
      partition,
      authority,
      revision,
      canonical: postgresHarnessConfiguration,
    });
  }
  await harness.authoring.createConfiguration({
    partition: other,
    authority,
    revision: asConfigurationRevisionId("revision-other"),
    canonical: postgresHarnessConfiguration,
  });
  await harness.query(
    `UPDATE configuration_revision SET created_at=CASE revision
       WHEN 'revision-a' THEN '2026-08-22T00:00:00Z'::timestamptz
       ELSE '2026-08-23T00:00:00Z'::timestamptz END
     WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  const first = await harness.authoring.configurations(partition, { limit: 2 });
  assert.deepEqual(
    first.configurations.map((configuration) => configuration.revision),
    ["revision-c", "revision-b"],
  );
  assert.equal(first.configurations[0]?.readiness, "Ready");
  assert.equal("canonical" in (first.configurations[0] ?? {}), false);
  assert.ok(first.nextAfter !== undefined);
  const second = await harness.authoring.configurations(partition, {
    after: first.nextAfter,
    limit: 2,
  });
  assert.deepEqual(
    second.configurations.map((configuration) => configuration.revision),
    ["revision-a"],
  );
  assert.equal(second.nextAfter, undefined);
});

test("repository configuration imports are idempotent and expose provenance", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "repository-configuration-import",
  );
  const declarations = repositoryDeclarations("a".repeat(40), ["work"]);
  const binding = await repositoryBinding(partition);
  for (const expected of ["Imported", "Imported"]) {
    assert.equal(
      (
        await harness.authoring.importRepositoryConfigurations({
          partition,
          binding,
          authority,
          declarations,
        })
      ).imported,
      expected,
    );
  }
  const page = await harness.authoring.configurations(partition, { limit: 10 });
  assert.deepEqual(
    page.configurations.map(({ provenance }) => provenance),
    [
      {
        source: "Repository",
        repository: binding.repository,
        commit: "a".repeat(40),
        path: [".chug", "configurations", "work.json"].join("/"),
        name: "work",
      },
    ],
  );
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::integer AS count FROM repository_configuration_provenance
        WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [{ count: 1 }],
  );
});

/** One single-name snapshot imported, and the version its revision came back with. */
async function importedConfigurationVersion(
  partition: Partition,
  binding: Awaited<ReturnType<typeof repositoryBinding>>,
  declarations: readonly RepositoryConfigurationDeclaration[],
) {
  assert.equal(
    (
      await harness.authoring.importRepositoryConfigurations({
        partition,
        binding,
        authority,
        declarations,
      })
    ).imported,
    "Imported",
  );
  const declaration = declarations[0];
  if (declaration === undefined)
    throw new Error("configuration version fixture is absent");
  const configuration = await harness.authoring.configuration(
    partition,
    declaration.revision,
  );
  return configuration?.version;
}

/** The numbers one partition's name carries, in the order they were assigned. */
async function configurationVersionNumbers(partition: Partition) {
  return await harness.query(
    `SELECT number::text AS number FROM repository_configuration_version
      WHERE tenant=$1 AND project=$2 ORDER BY number`,
    [partition.tenant, partition.project],
  );
}

test("a configuration version is per name and per distinct declaration", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "configuration-version",
  );
  const binding = await repositoryBinding(partition);
  const first = repositoryDeclarations("1".repeat(40), ["work"]);
  const unchanged = repositoryDeclarations("2".repeat(40), ["work"]);
  const changed = repositoryDeclarations("3".repeat(40), ["work"], "worker:v2");
  assert.deepEqual(
    [
      await importedConfigurationVersion(partition, binding, first),
      await importedConfigurationVersion(partition, binding, unchanged),
      await importedConfigurationVersion(partition, binding, changed),
      await importedConfigurationVersion(partition, binding, first),
    ],
    [
      { name: "work", number: 1 },
      { name: "work", number: 1 },
      { name: "work", number: 2 },
      { name: "work", number: 1 },
    ],
  );
  assert.deepEqual(await configurationVersionNumbers(partition), [
    { number: "1" },
    { number: "2" },
  ]);
});

test("the version backfill reproduces the numbers the import assigned", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "configuration-version-backfill",
  );
  const binding = await repositoryBinding(partition);
  for (const declarations of [
    repositoryDeclarations("4".repeat(40), ["work"]),
    repositoryDeclarations("5".repeat(40), ["work"], "worker:v2"),
    repositoryDeclarations("6".repeat(40), ["work"]),
  ])
    await importedConfigurationVersion(partition, binding, declarations);
  const assigned = await harness.query(
    `SELECT digest,number::text AS number FROM repository_configuration_version
      WHERE tenant=$1 AND project=$2 ORDER BY number`,
    [partition.tenant, partition.project],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM repository_configuration_version");
    await client.query(configurationVersionBackfill());
    const backfilled = await client.query(
      `SELECT digest,number::text AS number FROM repository_configuration_version
        WHERE tenant=$1 AND project=$2 ORDER BY number`,
      [partition.tenant, partition.project],
    );
    assert.deepEqual(backfilled.rows, assigned);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("repository imports retain changed commits and partition their identity", async () => {
  const first = await postgresHarnessProject(harness.store, "repository-first");
  const second = await postgresHarnessProject(
    harness.store,
    "repository-second",
  );
  const oldDeclarations = repositoryDeclarations("b".repeat(40), ["work"]);
  const newDeclarations = repositoryDeclarations("c".repeat(40), ["work"]);
  const bindings = new Map([
    [first, await repositoryBinding(first)],
    [second, await repositoryBinding(second)],
  ]);
  for (const partition of [first, second]) {
    const binding = bindings.get(partition);
    if (binding === undefined) throw new Error("repository binding is absent");
    assert.equal(
      (
        await harness.authoring.importRepositoryConfigurations({
          partition,
          binding,
          authority,
          declarations: oldDeclarations,
        })
      ).imported,
      "Imported",
    );
  }
  const firstBinding = bindings.get(first);
  if (firstBinding === undefined)
    throw new Error("repository binding is absent");
  assert.equal(
    (
      await harness.authoring.importRepositoryConfigurations({
        partition: first,
        binding: firstBinding,
        authority,
        declarations: newDeclarations,
      })
    ).imported,
    "Imported",
  );
  assert.equal(
    (await harness.authoring.configurations(first, { limit: 10 }))
      .configurations.length,
    2,
  );
  assert.equal(
    (await harness.authoring.configurations(second, { limit: 10 }))
      .configurations.length,
    1,
  );
});

test("a repository import conflict rolls back the entire snapshot", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "repository-rollback",
  );
  const declarations = repositoryDeclarations("d".repeat(40), [
    "first",
    "second",
  ]);
  const binding = await repositoryBinding(partition);
  const conflict = declarations[1];
  if (conflict === undefined) throw new Error("conflict fixture is absent");
  await harness.authoring.createConfiguration({
    partition,
    authority,
    revision: conflict.revision,
    canonical: asCanonicalConfiguration("{}"),
  });
  assert.deepEqual(
    await harness.authoring.importRepositoryConfigurations({
      partition,
      binding,
      authority,
      declarations,
    }),
    { imported: "IdentityConflict" },
  );
  const first = declarations[0];
  if (first === undefined) throw new Error("rollback fixture is absent");
  assert.equal(
    await harness.authoring.configuration(partition, first.revision),
    undefined,
  );
  assert.deepEqual(
    await harness.query(
      `SELECT revision FROM repository_configuration_provenance
        WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [],
  );
});

test("a changed repository binding fences the entire import", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "repository-binding-fence",
  );
  const binding = await repositoryBinding(partition);
  const changedRecoveryEpoch = await harness.store.establishRecoveryEpoch(
    asRecoveryEpoch(`changed-${randomUUID()}`),
  );
  await harness.query(
    `SELECT activate_project_repository($1,$2,$3,$3,$4,$5,'Test','authoring')`,
    [
      partition.tenant,
      partition.project,
      binding.repository,
      changedRecoveryEpoch,
      `operation-${randomUUID()}`,
    ],
  );
  assert.deepEqual(
    await harness.authoring.importRepositoryConfigurations({
      partition,
      binding,
      authority,
      declarations: repositoryDeclarations("e".repeat(40), ["work"]),
    }),
    { imported: "StaleBinding" },
  );
  assert.deepEqual(
    await harness.query(
      `SELECT revision FROM repository_configuration_provenance
         WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [],
  );
});

test("configuration revision identity is project-local", async () => {
  const first = await postgresHarnessProject(harness.store, "config-local-a");
  const second = await postgresHarnessProject(harness.store, "config-local-b");
  const revision = asConfigurationRevisionId(`shared-${randomUUID()}`);
  const canonical = asCanonicalConfiguration("{}");
  const store = postgresAuthoring(pool);

  const results = await Promise.all(
    [first, second].map(async (partition) =>
      store.createConfiguration({
        partition,
        authority,
        revision,
        canonical,
      }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.created),
    ["Created", "Created"],
  );
});

test("configuration reads reject content that contradicts its digest", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "config-read-integrity",
  );
  const revision = asConfigurationRevisionId(`integrity-${randomUUID()}`);
  const store = postgresAuthoring(pool);
  await store.createConfiguration({
    partition,
    authority,
    revision,
    canonical: asCanonicalConfiguration('{"image":"worker:v1"}'),
  });
  await harness.query(
    `UPDATE configuration_revision SET canonical='{"image":"tampered"}'
      WHERE tenant=$1 AND project=$2 AND revision=$3`,
    [partition.tenant, partition.project, revision],
  );

  await assert.rejects(
    store.configuration(partition, revision),
    /content contradicts its digest/,
  );
});

test("concurrent identical configuration creation is idempotent", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "config-concurrent",
  );
  const revision = asConfigurationRevisionId(`concurrent-${randomUUID()}`);
  const input = {
    partition,
    authority,
    revision,
    canonical: asCanonicalConfiguration("{}"),
  };
  const store = postgresAuthoring(pool);
  const results = await Promise.all([
    store.createConfiguration(input),
    store.createConfiguration(input),
  ]);

  assert.deepEqual(results.map((result) => result.created).sort(), [
    "AlreadyExists",
    "Created",
  ]);
});

test("draft edits are versioned and deletion leaves an unreusable identity", async () => {
  const { partition, store, revision, draft } = await draftFixture();
  assert.deepEqual(
    await store.reviseDraft({
      partition,
      authority,
      ticket: draft.ticket,
      expectedVersion: 0,
      configurationRevision: revision,
      authoring: plainAuthoring,
      brief: postgresHarnessBrief,
    }),
    { revised: "Stale", currentVersion: 1 },
  );
  const revised = await store.reviseDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 1,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  assert.equal(revised.revised, "Revised");
  const deleted = await store.deleteDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 2,
  });
  assert.equal(deleted.deleted, "Deleted");
  assert.equal(
    deleted.deleted === "Deleted" ? deleted.draft.authoringVersion : 0,
    3,
  );
  assert.deepEqual(
    await store.reviseDraft({
      partition,
      authority,
      ticket: draft.ticket,
      expectedVersion: 3,
      configurationRevision: revision,
      authoring: plainAuthoring,
      brief: postgresHarnessBrief,
    }),
    { revised: "NotDraft", state: "Deleted" },
  );
  const initialized = await store.initializeDraft(partition, revision, 100);
  if (initialized === undefined || initialized === "PolicyUnavailable")
    throw new Error("next draft was not initialized");
  const next = await store.createDraft({
    partition,
    authority,
    configurationRevision: revision,
    configurationDigest: initialized.configuration.digest,
    expectedProjectSequence: initialized.projectSequence,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  assert.equal(
    next.created === "Created" ? next.draft.ticket : 0,
    draft.ticket + 1,
  );
});

test("a domain release advances the shared ticket identity allocator", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "authoring-existing-ticket",
  );
  const submission = await postgresHarnessReleaseSubmission(
    harness,
    partition,
    "existing-ticket",
  );
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  const input = await harness.discovery.next(partition);
  assert.ok(input !== undefined);
  const lease = await postgresHarnessHeld(
    harness.store,
    partition,
    "existing-ticket",
  );
  const writer = postgresHarnessWriter(harness);
  assert.equal(
    (
      await projectWriterDecide(
        writer,
        await projectWriterLoad(writer, lease),
        input,
      )
    ).decided.decided,
    "Committed",
  );

  const store = postgresAuthoring(pool);
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  await store.createConfiguration({
    partition,
    authority,
    revision,
    canonical: asCanonicalConfiguration("{}"),
  });
  const initialized = await store.initializeDraft(partition, revision, 100);
  if (initialized === undefined || initialized === "PolicyUnavailable")
    throw new Error("draft fixture was not initialized");
  const created = await store.createDraft({
    partition,
    authority,
    configurationRevision: revision,
    configurationDigest: initialized.configuration.digest,
    expectedProjectSequence: initialized.projectSequence,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  assert.equal(created.created === "Created" ? created.draft.ticket : 0, 2);
});

test("release journals the retained draft only while its revision is current", async () => {
  const fixture = await draftFixture();
  const submission = releaseSubmission(fixture);
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  const input = await harness.discovery.next(fixture.partition);
  assert.ok(input !== undefined);
  const lease = await postgresHarnessHeld(
    harness.store,
    fixture.partition,
    "draft-release",
  );
  const writer = postgresHarnessWriter(harness);
  const result = await projectWriterDecide(
    writer,
    await projectWriterLoad(writer, lease),
    input,
  );
  assert.equal(result.decided.decided, "Committed");
  assert.deepEqual(
    await harness.query(
      "SELECT state FROM draft WHERE tenant=$1 AND project=$2 AND ticket=$3",
      [
        fixture.partition.tenant,
        fixture.partition.project,
        fixture.draft.ticket,
      ],
    ),
    [{ state: "Released" }],
  );
  await assertReleaseConfigurationPinned(fixture);
  assert.deepEqual(
    await harness.query(
      `SELECT kind,resource,project_seq,authoring_version
         FROM project_notification WHERE tenant=$1 AND project=$2 AND ordinal>=3
        ORDER BY ordinal`,
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [
      {
        kind: "Draft",
        resource: String(fixture.draft.ticket),
        project_seq: null,
        authoring_version: "1",
      },
      {
        kind: "Operation",
        resource: submission.operation,
        project_seq: "1",
        authoring_version: null,
      },
      {
        kind: "Ticket",
        resource: String(fixture.draft.ticket),
        project_seq: "1",
        authoring_version: null,
      },
    ],
  );
});

test("semantic configuration failure durably refuses release without an entry", async () => {
  const fixture = await draftFixture(asCanonicalConfiguration("{}"));
  const submission = releaseSubmission(fixture);
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  const input = await harness.discovery.next(fixture.partition);
  assert.ok(input !== undefined);
  const lease = await postgresHarnessHeld(
    harness.store,
    fixture.partition,
    "invalid-configuration",
  );
  const writer = postgresHarnessWriter(harness);
  const result = await projectWriterDecide(
    writer,
    await projectWriterLoad(writer, lease),
    input,
  );
  assert.equal(result.decided.decided, "Refused");
  assert.deepEqual(
    await harness.query(
      "SELECT state,outcome_code FROM decision_input WHERE input_id=$1",
      [submission.operation],
    ),
    [{ state: "Refused", outcome_code: "ConfigurationInvalid" }],
  );
  assert.deepEqual(
    await harness.query(
      "SELECT head FROM project WHERE tenant=$1 AND project=$2",
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [{ head: "0" }],
  );
});

test("an edit after acceptance durably refuses release without an entry", async () => {
  const fixture = await draftFixture();
  const submission = releaseSubmission(fixture);
  const acceptance = await harness.inbox.accept(submission);
  assert.equal(acceptance.accepted, "Accepted");
  const input = await harness.discovery.next(fixture.partition);
  assert.ok(input !== undefined);
  await fixture.store.reviseDraft({
    partition: fixture.partition,
    authority,
    ticket: fixture.draft.ticket,
    expectedVersion: 1,
    configurationRevision: fixture.revision,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  const lease = await postgresHarnessHeld(
    harness.store,
    fixture.partition,
    "draft-race",
  );
  const writer = postgresHarnessWriter(harness);
  const result = await projectWriterDecide(
    writer,
    await projectWriterLoad(writer, lease),
    input,
  );
  assert.equal(result.decided.decided, "Refused");
  assert.deepEqual(
    await harness.query(
      "SELECT state,outcome_code FROM decision_input WHERE input_id=$1",
      [submission.operation],
    ),
    [{ state: "Refused", outcome_code: "AuthoringChanged" }],
  );
  assert.deepEqual(
    await harness.query(
      "SELECT head FROM project WHERE tenant=$1 AND project=$2",
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [{ head: "0" }],
  );
});

test("release acceptance rejects a revision that was never retained", async () => {
  const fixture = await draftFixture();
  const valid = releaseSubmission(fixture);
  const submission: Submission = {
    ...valid,
    command: {
      version: 1,
      command: "ReleaseDraft",
      ticket: fixture.draft.ticket,
      authoringVersion: fixture.draft.authoringVersion + 1,
      configurationRevision: fixture.revision,
    },
  };

  assert.equal(
    (await harness.inbox.accept(submission)).accepted,
    "InvalidCommand",
  );
  assert.equal(await harness.discovery.next(fixture.partition), undefined);
});

test("the brief is written with the draft, replaced with it, and read back beside it", async () => {
  const { partition, store, revision, draft } = await draftFixture();
  assert.deepEqual(draft.brief, postgresHarnessBrief);
  const later = asDraftBrief({
    intent: "Serve it on the ticket too.\nAnd on the draft.",
    links: ["https://example.test/one", "https://example.test/two"],
  });
  const revised = await store.reviseDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 1,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: later,
  });
  assert.deepEqual(
    revised.revised === "Revised" ? revised.draft.brief : undefined,
    later,
  );
  assert.deepEqual((await store.draft(partition, draft.ticket))?.brief, later);
  assert.deepEqual(
    await postgresTicketBrief(pool).brief(partition, draft.ticket),
    later,
  );
});

test("where a brief lands is written, replaced and read back apart from where it works", async () => {
  const { partition, store, revision, draft } = await draftFixture();
  assert.equal(draft.brief?.finalization, undefined);
  const landing = asDraftBrief({
    intent: "Land it on the release branch.",
    links: [],
    branch: "refs/heads/harness",
    finalization: { mode: "Push", target: "refs/heads/harness-landing" },
  });
  const revised = await store.reviseDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 1,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: landing,
  });
  assert.deepEqual(
    revised.revised === "Revised" ? revised.draft.brief : undefined,
    landing,
  );
  assert.deepEqual(
    (await store.draft(partition, draft.ticket))?.brief,
    landing,
  );
  assert.deepEqual(
    await postgresTicketBrief(pool).brief(partition, draft.ticket),
    landing,
  );

  const cleared = await store.reviseDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 2,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  assert.deepEqual(
    cleared.revised === "Revised" ? cleared.draft.brief : undefined,
    postgresHarnessBrief,
    "a revision naming no finalization lands the work where it happens again",
  );
  assert.deepEqual(
    await postgresTicketBrief(pool).brief(partition, draft.ticket),
    postgresHarnessBrief,
  );
});

test("a draft authored before a brief existed reads back without one", async () => {
  const { partition, store, draft } = await draftFixture();
  await harness.query(
    "DELETE FROM draft_brief_link WHERE tenant=$1 AND project=$2 AND ticket=$3",
    [partition.tenant, partition.project, draft.ticket],
  );
  await harness.query(
    "DELETE FROM draft_brief WHERE tenant=$1 AND project=$2 AND ticket=$3",
    [partition.tenant, partition.project, draft.ticket],
  );
  assert.equal((await store.draft(partition, draft.ticket))?.brief, undefined);
  assert.equal(
    await postgresTicketBrief(pool).brief(partition, draft.ticket),
    undefined,
  );
});

test("the server refuses a brief that reached it around the interpreter's rules", async () => {
  const { partition, draft } = await draftFixture();
  for (const [column, value] of [
    ["intent", ""],
    ["intent", "Fix it.\u0007"],
    ["branch", "rt/ticket-brief"],
    ["finalization_mode", "PullRequest"],
    ["finalization_target", "rt/ticket-brief"],
  ] as const)
    await assert.rejects(
      harness.query(
        `UPDATE draft_brief SET ${column}=$4 WHERE tenant=$1 AND project=$2 AND ticket=$3`,
        [partition.tenant, partition.project, draft.ticket, value],
      ),
      `the brief refuses ${column}=${JSON.stringify(value)}`,
    );
  await assert.rejects(
    harness.query(
      `INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
       VALUES ($1,$2,$3,2,'http://example.test/one')`,
      [partition.tenant, partition.project, draft.ticket],
    ),
  );
  await assert.rejects(
    harness.query(
      `INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
       VALUES ($1,$2,$3,$4,'https://example.test/one')`,
      [partition.tenant, partition.project, draft.ticket, briefLinksMax + 1],
    ),
  );
});

/** Releases a fixture's draft through the writer, which is what freezes its brief. */
async function releaseFixtureDraft(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  label: string,
): Promise<void> {
  const submission = releaseSubmission(fixture);
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  const input = await harness.discovery.next(fixture.partition);
  assert.ok(input !== undefined);
  const writer = postgresHarnessWriter(harness);
  const decided = await projectWriterDecide(
    writer,
    await projectWriterLoad(
      writer,
      await postgresHarnessHeld(harness.store, fixture.partition, label),
    ),
    input,
  );
  assert.equal(decided.decided.decided, "Committed");
}

test("a released ticket's brief no longer moves, which is what lets a retry read it", async () => {
  const fixture = await draftFixture();
  await releaseFixtureDraft(fixture, "brief-freeze");
  const reader = postgresTicketBrief(pool);
  const released = await reader.brief(fixture.partition, fixture.draft.ticket);
  assert.deepEqual(released, postgresHarnessBrief);
  assert.deepEqual(
    await fixture.store.reviseDraft({
      partition: fixture.partition,
      authority,
      ticket: fixture.draft.ticket,
      expectedVersion: fixture.draft.authoringVersion,
      configurationRevision: fixture.revision,
      authoring: plainAuthoring,
      brief: asDraftBrief({
        intent: "FORGED intent under a running execution.",
        links: ["https://example.test/forged"],
        branch: "refs/heads/forged",
      }),
    }),
    { revised: "NotDraft", state: "Released" },
  );
  assert.deepEqual(
    await reader.brief(fixture.partition, fixture.draft.ticket),
    released,
  );
});
