import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresAuthoring } from "../../src/adapters/postgres/authoring.ts";
import { postgresDomainConfigurationPrecondition } from "../../src/adapters/postgres/domainConfiguration.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresProjectRepositoryRetirement } from "../../src/adapters/postgres/repositoryBinding.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { postgresTicketBrief } from "../../src/adapters/postgres/ticketBrief.ts";
import {
  briefChecksMax,
  briefLineCharsMax,
  briefLinksMax,
  briefTitleCharsMax,
} from "../../src/contract/brief.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  canonicalConfigurationOf,
  type ConfigurationRevisionId,
  type ReleaseAuthoring,
} from "../../src/interpreter/authoring.ts";
import {
  asGitObjectId,
  asRepositoryId,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asIdempotencyKey,
  asOperationId,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  projectWriterLoad,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import {
  repositoryConfigurationImportReadiness,
  type RepositoryConfigurationDeclaration,
} from "../../src/interpreter/repositoryConfiguration.ts";
import {
  asBriefIntent,
  asDraftBrief,
  briefFinalizationDefault,
  briefIntentLines,
  type DraftBrief,
} from "../../src/interpreter/ticketBrief.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import {
  postgresHarnessBinding,
  postgresHarnessBrief,
  postgresHarnessBriefIn,
  postgresHarnessConfiguration,
  postgresHarnessHeld,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessReleaseSubmission,
  postgresHarnessRolePool,
  postgresHarnessStalled,
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

async function repositoryBinding(partition: Partition, label = "sole") {
  const [row] = await harness.query(`SELECT epoch FROM recovery_epoch LIMIT 1`);
  const epoch = row?.["epoch"];
  if (typeof epoch !== "string") throw new Error("recovery epoch is absent");
  const recoveryEpoch = asRecoveryEpoch(epoch);
  const repository = asRepositoryId(
    `repository-${label}-${partition.tenant}-${partition.project}`,
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
    (
      await postgresDomainConfigurationPrecondition(
        pool,
        refinementInstance,
      ).check(new AbortController().signal)
    ).met,
    "Met",
  );
  assert.equal(
    (
      await postgresDomainConfigurationPrecondition(pool, {
        ...refinementInstance,
        nTasks: refinementInstance.nTasks + 1,
      }).check(new AbortController().signal)
    ).met,
    "Refused",
  );
});

/**
 * The row is compared as a configuration and not as text, so an installation
 * whose row says the same thing in another rendering starts rather than
 * refusing over key order.
 */
test("a policy row rendered another way is still the one this image carries", async () => {
  await harness.query("DELETE FROM deployment_authoring_policy");
  await harness.query(
    `INSERT INTO deployment_authoring_policy(singleton,domain_configuration)
     VALUES(true,$1)`,
    [
      JSON.stringify(
        Object.fromEntries(Object.entries(refinementInstance).reverse()),
      ),
    ],
  );
  assert.equal(
    (
      await postgresDomainConfigurationPrecondition(
        pool,
        refinementInstance,
      ).check(new AbortController().signal)
    ).met,
    "Met",
  );
});

/**
 * Two writers starting against an installation the policy is not installed in
 * yet, staged rather than hoped for: the winner holds its insert open, and the
 * loser is proved queued behind that row before the winner commits. The row is
 * emptied first because the harness installed it already, and the winner puts
 * it back.
 */
test("a writer that loses the policy install is admitted by the one that won", async () => {
  await harness.query("DELETE FROM deployment_authoring_policy");
  const winner = await harness.begin();
  await winner.query(
    `INSERT INTO deployment_authoring_policy(singleton,domain_configuration)
     VALUES(true,$1)`,
    [JSON.stringify(refinementInstance)],
  );
  const loser = postgresDomainConfigurationPrecondition(
    pool,
    refinementInstance,
  ).check(new AbortController().signal);
  await postgresHarnessStalled(harness.pool, 1);
  await winner.commit();
  assert.equal((await loser).met, "Met");
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

/**
 * One draft on a revision the project already holds, its brief naming the
 * repository given whatever else it says. A release refuses a brief naming no
 * repository, so a case about anything else reaches a releasable draft here,
 * and a case about a brief without one revises what this made.
 */
async function draftOnRevision(
  partition: Partition,
  revision: ConfigurationRevisionId,
  repository: RepositoryId,
  brief: DraftBrief = postgresHarnessBrief,
) {
  const store = postgresAuthoring(pool);
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
    brief: { ...brief, repository },
  });
  if (created.created !== "Created")
    throw new Error(`draft fixture was ${created.created}`);
  return { partition, store, revision, repository, draft: created.draft };
}

/** The same draft over a project and a configuration of its own. */
async function draftFixture(
  canonical = postgresHarnessConfiguration,
  brief: DraftBrief = postgresHarnessBrief,
) {
  const partition = await postgresHarnessProject(
    harness.store,
    "authoring-draft",
  );
  const repository = await postgresHarnessBinding(harness, partition);
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  await postgresAuthoring(pool).createConfiguration({
    partition,
    authority,
    revision,
    canonical,
  });
  return draftOnRevision(partition, revision, repository, brief);
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
  authoringVersion = fixture.draft.authoringVersion,
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
      authoringVersion,
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

test("one name declared by two repositories is one chronology of two revisions", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "repository-one-name-two-repositories",
  );
  const first = await repositoryBinding(partition, "named-first");
  const second = await repositoryBinding(partition, "named-second");
  const firstCommit = "a".repeat(40);
  const secondCommit = "b".repeat(40);
  assert.deepEqual(
    [
      await importedConfigurationVersion(
        partition,
        first,
        repositoryDeclarations(firstCommit, ["work"]),
      ),
      await importedConfigurationVersion(
        partition,
        second,
        repositoryDeclarations(secondCommit, ["work"], "worker:v2"),
      ),
    ],
    [
      { name: "work", number: 1 },
      { name: "work", number: 2 },
    ],
  );
  assert.deepEqual(
    await harness.query(
      `SELECT revision,repository,repository_commit,name
         FROM repository_configuration_provenance
        WHERE tenant=$1 AND project=$2 ORDER BY repository_commit`,
      [partition.tenant, partition.project],
    ),
    [
      {
        revision: `repository:${firstCommit}:work`,
        repository: first.repository,
        repository_commit: firstCommit,
        name: "work",
      },
      {
        revision: `repository:${secondCommit}:work`,
        repository: second.repository,
        repository_commit: secondCommit,
        name: "work",
      },
    ],
  );
});

test("either binding a project holds may import, and no other repository", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "repository-binding-peers",
  );
  const first = await repositoryBinding(partition, "peer-first");
  const second = await repositoryBinding(partition, "peer-second");
  for (const [binding, commit] of [
    [first, "7".repeat(40)],
    [second, "8".repeat(40)],
  ] as const)
    assert.deepEqual(
      await harness.authoring.importRepositoryConfigurations({
        partition,
        binding,
        authority,
        declarations: repositoryDeclarations(commit, ["work"]),
      }),
      { imported: "Imported" },
    );
  assert.deepEqual(
    await harness.query(
      `SELECT repository FROM repository_configuration_provenance
        WHERE tenant=$1 AND project=$2 ORDER BY repository`,
      [partition.tenant, partition.project],
    ),
    [{ repository: first.repository }, { repository: second.repository }],
  );
  assert.deepEqual(
    await harness.authoring.importRepositoryConfigurations({
      partition,
      binding: { ...first, repository: asRepositoryId(`un-${randomUUID()}`) },
      authority,
      declarations: repositoryDeclarations("9".repeat(40), ["work"]),
    }),
    { imported: "StaleBinding" },
  );
});

test("an import against another project's binding under the same tenant is fenced", async () => {
  const tenant = asTenantId(`tenant-stale-project-${randomUUID()}`);
  const holder: Partition = {
    tenant,
    project: asProjectId(`project-stale-holder-${randomUUID()}`),
  };
  const importer: Partition = {
    tenant,
    project: asProjectId(`project-stale-importer-${randomUUID()}`),
  };
  await harness.store.createProject(holder);
  await harness.store.createProject(importer);
  const binding = await repositoryBinding(holder, "stale-project");
  assert.deepEqual(
    await harness.authoring.importRepositoryConfigurations({
      partition: importer,
      binding,
      authority,
      declarations: repositoryDeclarations("a".repeat(40), ["work"]),
    }),
    { imported: "StaleBinding" },
  );
});

test("an import against a same-named project under another tenant is fenced", async () => {
  const project = asProjectId(`project-stale-tenant-${randomUUID()}`);
  const holder: Partition = {
    tenant: asTenantId(`tenant-stale-holder-${randomUUID()}`),
    project,
  };
  const importer: Partition = {
    tenant: asTenantId(`tenant-stale-importer-${randomUUID()}`),
    project,
  };
  await harness.store.createProject(holder);
  await harness.store.createProject(importer);
  const binding = await repositoryBinding(holder, "stale-tenant");
  assert.deepEqual(
    await harness.authoring.importRepositoryConfigurations({
      partition: importer,
      binding,
      authority,
      declarations: repositoryDeclarations("b".repeat(40), ["work"]),
    }),
    { imported: "StaleBinding" },
  );
});

test("an import naming an epoch the binding was not made under is fenced", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "repository-binding-fence",
  );
  const binding = await repositoryBinding(partition);
  const changedRecoveryEpoch = await harness.store.establishRecoveryEpoch(
    asRecoveryEpoch(`changed-${randomUUID()}`),
  );
  assert.notEqual(changedRecoveryEpoch, binding.recoveryEpoch);
  assert.deepEqual(
    await harness.authoring.importRepositoryConfigurations({
      partition,
      binding: { ...binding, recoveryEpoch: changedRecoveryEpoch },
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

const commandedCheckConfiguration = canonicalConfigurationOf({
  ...(JSON.parse(postgresHarnessConfiguration) as Record<string, unknown>),
  evaluations: [{ purpose: "Check", checks: [".chug/tasks/ci.sh"] }],
});

/** Accepts one release and decides it, which is the whole of what a release case drives. */
async function releaseDecision(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  label: string,
) {
  const submission = releaseSubmission(fixture);
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  const input = await harness.discovery.next(fixture.partition);
  assert.ok(input !== undefined);
  const lease = await postgresHarnessHeld(
    harness.store,
    fixture.partition,
    label,
  );
  const writer = postgresHarnessWriter(harness);
  const result = await projectWriterDecide(
    writer,
    await projectWriterLoad(writer, lease),
    input,
  );
  return { submission, result };
}

/**
 * A project's writer, held once and answered to for release after release: a
 * project has one lease, so a case driving more than one release of the same
 * project takes it once rather than racing its own tenure.
 */
async function projectReleases(partition: Partition, label: string) {
  const writer = postgresHarnessWriter(harness);
  let memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, label),
  );
  return async function projectReleasesNext(
    fixture: Awaited<ReturnType<typeof draftFixture>>,
  ) {
    const submission = releaseSubmission(fixture);
    assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
    const input = await harness.discovery.next(partition);
    assert.ok(input !== undefined);
    const decision = await projectWriterDecide(writer, memory, input);
    memory = decision.memory;
    return { submission, decided: decision.decided.decided };
  };
}

/** What a refused release leaves behind: the reason it names and the draft, still editable. */
async function assertRefusalLeftBehind(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  submission: Submission,
  code = "ConfigurationInvalid",
): Promise<void> {
  assert.deepEqual(
    await harness.query(
      "SELECT state,outcome_code FROM decision_input WHERE input_id=$1",
      [submission.operation],
    ),
    [{ state: "Refused", outcome_code: code }],
  );
  assert.deepEqual(
    await harness.query(
      "SELECT state FROM draft WHERE tenant=$1 AND ticket=$2",
      [fixture.partition.tenant, fixture.draft.ticket],
    ),
    [{ state: "Draft" }],
    "the draft is still editable, which is the point of refusing here",
  );
}

/**
 * Drives one release the fence refuses, and holds the draft where a refusal
 * leaves it, which is editable.
 */
async function assertReleaseRefused(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  label: string,
): Promise<void> {
  const { submission, result } = await releaseDecision(fixture, label);
  assert.equal(result.decided.decided, "Refused");
  await assertRefusalLeftBehind(fixture, submission);
}

/** Appends one check line to a fixture's brief, as a ticket carrying one has. */
async function appendFixtureCheck(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
): Promise<void> {
  await harness.query(
    `INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
     VALUES ($1,$2,$3,1,'npm test')`,
    [fixture.partition.tenant, fixture.partition.project, fixture.draft.ticket],
  );
}

test("a brief that appends check lines refuses release against a configuration commanding none", async () => {
  const fixture = await draftFixture();
  await appendFixtureCheck(fixture);
  await assertReleaseRefused(fixture, "checks-uncommanded");
});

test("a configuration commanding a check stage releases a brief that appends to it", async () => {
  const fixture = await draftFixture(commandedCheckConfiguration);
  await appendFixtureCheck(fixture);

  const { result } = await releaseDecision(fixture, "checks-commanded");

  assert.equal(result.decided.decided, "Committed");
});

/**
 * A project binding two repositories, in the order it bound them. Neither is
 * privileged, so a case that reads one of them names it rather than taking the
 * first, and a case about both puts each through the same steps.
 */
async function twoBoundRepositories(label: string) {
  const partition = await postgresHarnessProject(harness.store, label);
  return {
    partition,
    first: await repositoryBinding(partition, "peer-first"),
    second: await repositoryBinding(partition, "peer-second"),
  };
}

/** One configuration imported from a binding, answering the revision it landed as. */
async function importedRevision(
  partition: Partition,
  binding: Awaited<ReturnType<typeof repositoryBinding>>,
  commit: string,
): Promise<ConfigurationRevisionId> {
  const declarations = repositoryDeclarations(commit, ["work"]);
  assert.deepEqual(
    await harness.authoring.importRepositoryConfigurations({
      partition,
      binding,
      authority,
      declarations,
    }),
    { imported: "Imported" },
  );
  const declaration = declarations[0];
  if (declaration === undefined)
    throw new Error("the import fixture declared nothing");
  return declaration.revision;
}

/**
 * Both authoring doors refusing a brief that names this repository, which is
 * the one answer a repository the project never bound and one it has retired
 * are each refused by.
 */
async function assertBriefRepositoryRefused(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  repository: RepositoryId,
): Promise<void> {
  const brief = { ...postgresHarnessBrief, repository };
  const initialized = await fixture.store.initializeDraft(
    fixture.partition,
    fixture.revision,
    100,
  );
  if (initialized === undefined || initialized === "PolicyUnavailable")
    throw new Error("the second draft was not initialized");
  assert.deepEqual(
    await fixture.store.createDraft({
      partition: fixture.partition,
      authority,
      configurationRevision: fixture.revision,
      configurationDigest: initialized.configuration.digest,
      expectedProjectSequence: initialized.projectSequence,
      authoring: plainAuthoring,
      brief,
    }),
    { created: "RepositoryNotBound" },
  );
  assert.deepEqual(
    await fixture.store.reviseDraft({
      partition: fixture.partition,
      authority,
      ticket: fixture.draft.ticket,
      expectedVersion: fixture.draft.authoringVersion,
      configurationRevision: fixture.revision,
      authoring: plainAuthoring,
      brief,
    }),
    { revised: "RepositoryNotBound" },
  );
}

test("a brief naming a repository the project does not bind is refused", async () => {
  const fixture = await draftFixture();
  await assertBriefRepositoryRefused(
    fixture,
    asRepositoryId(`unbound-${randomUUID()}`),
  );
  assert.deepEqual(
    (await fixture.store.draft(fixture.partition, fixture.draft.ticket))?.brief
      ?.repository,
    fixture.repository,
    "the refused revision left the repository the draft already named",
  );
});

/**
 * A retired binding is one the project has stopped reading, so a brief naming
 * it is asking for the same impossible thing as a brief naming a repository the
 * project never bound, and the two are refused by the one answer. The draft the
 * refusal left still names the repository it named before.
 */
test("a brief naming a repository the project has retired is refused the same way", async () => {
  const fixture = await draftFixture();
  assert.equal(
    (
      await postgresProjectRepositoryRetirement(pool).retire({
        partition: fixture.partition,
        repository: fixture.repository,
      })
    ).outcome,
    "Retired",
  );
  await assertBriefRepositoryRefused(fixture, fixture.repository);
});

test("a release is refused for a configuration imported from another repository", async () => {
  const { partition, first, second } = await twoBoundRepositories(
    "release-configuration-repository",
  );
  const revision = await importedRevision(partition, first, "7".repeat(40));
  const release = await projectReleases(partition, "configuration-provenance");

  const elsewhere = await draftOnRevision(
    partition,
    revision,
    second.repository,
  );
  const refused = await release(elsewhere);
  assert.equal(refused.decided, "Refused");
  await assertRefusalLeftBehind(elsewhere, refused.submission);

  assert.equal(
    (
      await release(
        await draftOnRevision(partition, revision, first.repository),
      )
    ).decided,
    "Committed",
    "the same revision releases from the repository it was imported from",
  );
});

test("a brief naming either binding releases, and neither of the two is privileged", async () => {
  const { partition, first, second } = await twoBoundRepositories(
    "release-either-binding",
  );
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  await harness.authoring.createConfiguration({
    partition,
    authority,
    revision,
    canonical: postgresHarnessConfiguration,
  });
  const release = await projectReleases(partition, "either-binding");
  for (const binding of [first, second]) {
    assert.equal(
      (
        await release(
          await draftOnRevision(partition, revision, binding.repository),
        )
      ).decided,
      "Committed",
      `an authored configuration releases in ${binding.repository}`,
    );
  }
});

test("a draft filed with no repository is revisable, refused at release, and then filled", async () => {
  const fixture = await draftFixture();
  const cleared = await fixture.store.reviseDraft({
    partition: fixture.partition,
    authority,
    ticket: fixture.draft.ticket,
    expectedVersion: fixture.draft.authoringVersion,
    configurationRevision: fixture.revision,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  assert.equal(
    cleared.revised === "Revised" ? cleared.draft.brief?.repository : "revised",
    undefined,
    "a draft that names no repository is still one a lead may revise",
  );
  if (cleared.revised !== "Revised")
    throw new Error("the draft was not revised");

  const release = await projectReleases(fixture.partition, "repository-filled");
  const unnamed = { ...fixture, draft: cleared.draft };
  const refused = await release(unnamed);
  assert.equal(refused.decided, "Refused");
  await assertRefusalLeftBehind(
    unnamed,
    refused.submission,
    "BriefNamesNoRepository",
  );

  const filled = await fixture.store.reviseDraft({
    partition: fixture.partition,
    authority,
    ticket: fixture.draft.ticket,
    expectedVersion: cleared.draft.authoringVersion,
    configurationRevision: fixture.revision,
    authoring: plainAuthoring,
    brief: postgresHarnessBriefIn(fixture.repository),
  });
  if (filled.revised !== "Revised") throw new Error("the draft was not filled");
  assert.equal(
    (await release({ ...fixture, draft: filled.draft })).decided,
    "Committed",
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

/**
 * What a brief reads back as. The door resolves the landing a brief left
 * unsaid — against the repository it names, and against the tree's own default
 * where it names none — and stores what it resolved, so a brief whose ticket
 * runs a finalizer carries one whether or not the caller wrote it.
 */
function briefAsStored(brief: DraftBrief): DraftBrief {
  return brief.finalization === undefined
    ? { ...brief, finalization: briefFinalizationDefault }
    : brief;
}

test("the brief is written with the draft, replaced with it, and read back beside it", async () => {
  const fixture = await draftFixture();
  const { partition, store, revision, repository, draft } = fixture;
  assert.deepEqual(
    draft.brief,
    briefAsStored(postgresHarnessBriefIn(repository)),
  );
  const later = briefAsStored({
    ...asDraftBrief({
      intent: "Serve it on the ticket too.\nAnd on the draft.",
      links: ["https://example.test/one", "https://example.test/two"],
    }),
    repository,
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
  assert.deepEqual(await briefReleasedAt(fixture, 2, "brief-replaced"), later);
});

test("a page of drafts answers each one's repository, undefined for a brief naming none", async () => {
  const fixture = await draftFixture();
  const initialized = await fixture.store.initializeDraft(
    fixture.partition,
    fixture.revision,
    100,
  );
  if (initialized === undefined || initialized === "PolicyUnavailable")
    throw new Error("the second draft was not initialized");
  const unrepositoried = await fixture.store.createDraft({
    partition: fixture.partition,
    authority,
    configurationRevision: fixture.revision,
    configurationDigest: initialized.configuration.digest,
    expectedProjectSequence: initialized.projectSequence,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  if (unrepositoried.created !== "Created")
    throw new Error(`the second draft was ${unrepositoried.created}`);
  const page = await fixture.store.drafts(fixture.partition, { limit: 10 });
  const repositoryOf = new Map(
    page.drafts.map((draft) => [draft.ticket, draft.brief?.repository]),
  );
  assert.equal(repositoryOf.get(fixture.draft.ticket), fixture.repository);
  assert.equal(repositoryOf.get(unrepositoried.draft.ticket), undefined);
});

test("where a brief lands is written, replaced and read back apart from where it works", async () => {
  const fixture = await draftFixture();
  const { partition, store, revision, repository, draft } = fixture;
  assert.deepEqual(
    draft.brief?.finalization,
    briefFinalizationDefault,
    "a brief naming no landing was stored with the one its repository is bound under",
  );
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

  const cleared = await store.reviseDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 2,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: postgresHarnessBriefIn(repository),
  });
  assert.deepEqual(
    cleared.revised === "Revised" ? cleared.draft.brief : undefined,
    briefAsStored(postgresHarnessBriefIn(repository)),
    "a revision naming no finalization lands the work where it happens again",
  );
  assert.deepEqual(
    await briefReleasedAt(fixture, 3, "brief-landing"),
    briefAsStored(postgresHarnessBriefIn(repository)),
  );
});

const appendingBrief = asDraftBrief({
  intent: "Hold this ticket to one more gate.",
  links: [],
  checks: ["npm run lint", "npm test"],
});

test("a draft is created with the check lines its brief appends", async () => {
  const fixture = await draftFixture(
    commandedCheckConfiguration,
    appendingBrief,
  );
  const appending = briefAsStored({
    ...appendingBrief,
    repository: fixture.repository,
  });
  assert.deepEqual(fixture.draft.brief, appending);
  assert.deepEqual(
    await briefReleasedAt(fixture, 1, "brief-checks-created"),
    appending,
    "the scheduler's own read carries the lines in the order they were created",
  );
});

test("the check lines a brief appends are written, ordered, replaced and read back", async () => {
  const fixture = await draftFixture(commandedCheckConfiguration);
  const { partition, store, revision, repository, draft } = fixture;
  assert.deepEqual(draft.brief?.checks, []);
  const appending = briefAsStored({ ...appendingBrief, repository });
  const revised = await store.reviseDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 1,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: appending,
  });
  assert.deepEqual(
    revised.revised === "Revised" ? revised.draft.brief : undefined,
    appending,
  );
  assert.deepEqual(
    (await store.draft(partition, draft.ticket))?.brief,
    appending,
  );
  assert.deepEqual(
    await briefReleasedAt(fixture, 2, "brief-checks"),
    appending,
    "the scheduler's own read carries the lines in the order they were written",
  );

  const cleared = await store.reviseDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 2,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: postgresHarnessBriefIn(repository),
  });
  assert.deepEqual(
    cleared.revised === "Revised" ? cleared.draft.brief?.checks : undefined,
    [],
    "a revision appending nothing removes the lines an earlier one appended",
  );
  assert.deepEqual(
    await postgresTicketBrief(pool).brief(partition, draft.ticket),
    appending,
    "the reopened draft's revision is not what the released ticket runs",
  );
});

test("the server refuses a check line that reached it around the interpreter's rules", async () => {
  const { partition, draft } = await draftFixture();
  const inserting = (ordinal: number, command: string) =>
    harness.query(
      `INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
       VALUES ($1,$2,$3,$4,$5)`,
      [partition.tenant, partition.project, draft.ticket, ordinal, command],
    );
  await assert.rejects(inserting(1, ""), "an empty command line");
  await assert.rejects(
    inserting(1, "npm test\nrm -rf /"),
    "a control character",
  );
  await assert.rejects(
    inserting(1, "a".repeat(briefLineCharsMax + 1)),
    "a line past the bound one briefing line has",
  );
  await assert.rejects(
    inserting(briefChecksMax + 1, "npm test"),
    "an ordinal past the bound one brief appends",
  );
});

test("a draft authored before a brief existed reads back without one", async () => {
  const { partition, store, draft } = await draftFixture();
  await harness.query(
    "DELETE FROM draft_brief_link WHERE tenant=$1 AND project=$2 AND ticket=$3",
    [partition.tenant, partition.project, draft.ticket],
  );
  await harness.query(
    "DELETE FROM draft_brief_check WHERE tenant=$1 AND project=$2 AND ticket=$3",
    [partition.tenant, partition.project, draft.ticket],
  );
  await harness.query(
    "DELETE FROM draft_brief WHERE tenant=$1 AND project=$2 AND ticket=$3",
    [partition.tenant, partition.project, draft.ticket],
  );
  assert.equal((await store.draft(partition, draft.ticket))?.brief, undefined);
});

test("the server refuses a brief that reached it around the interpreter's rules", async () => {
  const { partition, draft } = await draftFixture();
  for (const [column, value] of [
    ["intent", ""],
    ["intent", "Fix it.\u0007"],
    ["branch", "rt/ticket-brief"],
    ["finalization_mode", "Merge"],
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

/**
 * The fixture project's writer, held once: each submission handed to it is
 * accepted, decided, and answered with how it was decided.
 */
async function fixtureWriter(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  label: string,
) {
  const writer = postgresHarnessWriter(harness);
  let memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, fixture.partition, label),
  );
  return async function fixtureWriterDecide(
    submission: Submission,
  ): Promise<string> {
    assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
    const input = await harness.discovery.next(fixture.partition);
    assert.ok(input !== undefined);
    const decision = await projectWriterDecide(writer, memory, input);
    memory = decision.memory;
    return decision.decided.decided;
  };
}

/** Releases a fixture's draft through the writer, which is what freezes its brief. */
async function releaseFixtureDraft(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  label: string,
  authoringVersion = fixture.draft.authoringVersion,
): Promise<void> {
  const decide = await fixtureWriter(fixture, label);
  assert.equal(
    await decide(releaseSubmission(fixture, authoringVersion)),
    "Committed",
  );
}

/** Releases the fixture's draft at `authoringVersion` and answers the brief every dispatch then reads. */
async function briefReleasedAt(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  authoringVersion: number,
  label: string,
): Promise<DraftBrief | undefined> {
  await releaseFixtureDraft(fixture, label, authoringVersion);
  return postgresTicketBrief(pool).brief(
    fixture.partition,
    fixture.draft.ticket,
  );
}

/** An update of the fixture's ticket to the draft revision `authoringVersion`, against `expectedRevision`. */
function updateSubmission(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  expectedRevision: number,
  authoringVersion: number,
  configurationRevision: ConfigurationRevisionId = fixture.revision,
): Submission {
  const unique = randomUUID();
  return {
    partition: fixture.partition,
    operation: asOperationId(`update-${unique}`),
    authority,
    key: asIdempotencyKey(`update-${unique}`),
    command: {
      version: 1,
      command: "UpdateTicket",
      ticket: fixture.draft.ticket,
      expectedRevision,
      authoringVersion,
      configurationRevision,
    },
  };
}

/** A revision of the fixture's released draft, keeping its dependencies, to `brief`. */
function reviseReleased(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  expectedVersion: number,
  brief: DraftBrief,
  configurationRevision: ConfigurationRevisionId = fixture.revision,
  authoring: ReleaseAuthoring = plainAuthoring,
) {
  return fixture.store.reviseDraft({
    partition: fixture.partition,
    authority,
    ticket: fixture.draft.ticket,
    expectedVersion,
    configurationRevision,
    authoring,
    brief,
  });
}

/** What a dispatch or a retry of the fixture's ticket reads: its released definition, digest and brief. */
async function releasedMaterial(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
): Promise<unknown> {
  return harness.query(
    `SELECT definition,digest,brief FROM ticket_definition
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [fixture.partition.tenant, fixture.partition.project, fixture.draft.ticket],
  );
}

/** A brief no release has named, which is what a Pending ticket's author may revise to. */
function forgedBrief(repository: RepositoryId): DraftBrief {
  return briefAsStored({
    ...asDraftBrief({
      intent: "FORGED intent nobody has released.",
      links: ["https://example.test/forged"],
      branch: "refs/heads/forged",
    }),
    repository,
  });
}

test("an unreleased revision of a Pending ticket's draft moves nothing a dispatch or retry reads", async () => {
  const fixture = await draftFixture();
  await releaseFixtureDraft(fixture, "brief-freeze");
  const reader = postgresTicketBrief(pool);
  const released = await reader.brief(fixture.partition, fixture.draft.ticket);
  assert.deepEqual(
    released,
    briefAsStored(postgresHarnessBriefIn(fixture.repository)),
  );
  const material = await releasedMaterial(fixture);
  const revised = await reviseReleased(
    fixture,
    fixture.draft.authoringVersion,
    forgedBrief(fixture.repository),
  );
  assert.equal(revised.revised, "Revised");
  assert.deepEqual(
    await reader.brief(fixture.partition, fixture.draft.ticket),
    released,
  );
  assert.deepEqual(await releasedMaterial(fixture), material);
});

test("a released update moves what the next dispatch reads, and the revision it is read at", async () => {
  const fixture = await draftFixture();
  const decide = await fixtureWriter(fixture, "update-moves");
  assert.equal(await decide(releaseSubmission(fixture)), "Committed");
  const forged = forgedBrief(fixture.repository);
  assert.equal((await reviseReleased(fixture, 1, forged)).revised, "Revised");
  assert.equal(await decide(updateSubmission(fixture, 1, 2)), "Committed");
  assert.deepEqual(
    await postgresTicketBrief(pool).brief(
      fixture.partition,
      fixture.draft.ticket,
    ),
    forged,
  );
  assert.deepEqual(
    await harness.query(
      `SELECT revision FROM ticket_projection
        WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      [
        fixture.partition.tenant,
        fixture.partition.project,
        fixture.draft.ticket,
      ],
    ),
    [{ revision: "2" }],
  );
  const read = await fixture.store.draft(
    fixture.partition,
    fixture.draft.ticket,
  );
  assert.equal(read?.releasedAuthoringVersion, 2);
  assert.equal(read?.authoringVersion, 2);
});

/**
 * The harness's domain admits one evaluator in one stage, so a revision wider
 * than that is one the door takes and no update can release: the read must
 * keep the program the release ran from while the draft holds it.
 */
test("a ticket read carries the program it was released with, not one its draft was revised to", async (t) => {
  const fixture = await draftFixture();
  const decide = await fixtureWriter(fixture, "update-program");
  const asApi = postgresHarnessRolePool(apiRole);
  t.after(() => asApi.end());
  const program = async () =>
    (
      await postgresNativeReads(asApi).ticket(
        fixture.partition,
        fixture.draft.ticket,
      )
    )?.program;
  assert.equal(await decide(releaseSubmission(fixture)), "Committed");
  assert.deepEqual(await program(), plainAuthoring.prog);
  const widened: ReleaseAuthoring = {
    ...plainAuthoring,
    prog: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
  };
  const revised = await reviseReleased(
    fixture,
    1,
    postgresHarnessBriefIn(fixture.repository),
    fixture.revision,
    widened,
  );
  assert.equal(revised.revised, "Revised");
  assert.deepEqual(await program(), plainAuthoring.prog);
  assert.equal(await decide(updateSubmission(fixture, 1, 2)), "Refused");
  assert.deepEqual(await program(), plainAuthoring.prog);
});

/** The configuration each place a dispatch reads it from holds for the fixture's ticket. */
async function dispatchPins(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
): Promise<Record<string, unknown>> {
  const at = [
    fixture.partition.tenant,
    fixture.partition.project,
    fixture.draft.ticket,
  ];
  return {
    projection: await harness.query(
      `SELECT configuration_revision,configuration_digest FROM ticket_projection
        WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      at,
    ),
    candidate: await harness.query(
      `SELECT configuration_revision,configuration_digest FROM dispatch_candidate
        WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      at,
    ),
    spawn: await harness.query(
      `SELECT configuration_revision,configuration_digest FROM execution_request
        WHERE tenant=$1 AND project=$2 AND ticket=$3 AND kind='SpawnWork'`,
      at,
    ),
  };
}

/** Accepts a submission and has the writer holding `memory` decide it. */
async function decidedBy(
  memory: ProjectMemory,
  submission: Submission,
): Promise<Awaited<ReturnType<typeof projectWriterDecide>>> {
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  const input = await harness.discovery.next(submission.partition);
  assert.ok(input !== undefined);
  return projectWriterDecide(postgresHarnessWriter(harness), memory, input);
}

/**
 * A second configuration in the fixture's project, differing from the first in
 * its image, and the pin each place a dispatch reads it from holds once a
 * ticket runs under it.
 */
async function movedConfiguration(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
) {
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  const canonical = canonicalConfigurationOf({
    ...(JSON.parse(postgresHarnessConfiguration) as Record<string, unknown>),
    image: "worker:v2",
  });
  await fixture.store.createConfiguration({
    partition: fixture.partition,
    authority,
    revision,
    canonical,
  });
  const digest = createHash("sha256").update(canonical).digest("hex");
  return {
    revision,
    pin: [{ configuration_revision: revision, configuration_digest: digest }],
  };
}

/** A manual dispatch of the fixture's ticket at the version its writer holds. */
function manualDispatch(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
  memory: ProjectMemory,
): Submission {
  const version = memory.ticketVersions.get(fixture.draft.ticket);
  assert.ok(version !== undefined);
  const unique = randomUUID();
  return {
    partition: fixture.partition,
    operation: asOperationId(`dispatch-${unique}`),
    authority,
    key: asIdempotencyKey(`dispatch-${unique}`),
    command: {
      version: 1,
      command: "ManualDispatch",
      ticket: fixture.draft.ticket,
      expectedTicketVersion: version,
    },
  };
}

test("an update at another configuration revision re-pins what its dispatch runs under, across a restart", async (t) => {
  const fixture = await draftFixture();
  const moved = await movedConfiguration(fixture);
  const load = async (label: string) =>
    projectWriterLoad(
      postgresHarnessWriter(harness),
      await postgresHarnessHeld(harness.store, fixture.partition, label),
    );
  const asApi = postgresHarnessRolePool(apiRole);
  t.after(() => asApi.end());
  const releasedUnder = async () =>
    (
      await postgresNativeReads(asApi).ticket(
        fixture.partition,
        fixture.draft.ticket,
      )
    )?.configurationRevision;

  const released = await decidedBy(
    await load("update-repin"),
    releaseSubmission(fixture),
  );
  assert.equal(released.decided.decided, "Committed");
  assert.equal(await releasedUnder(), fixture.revision);
  const brief = postgresHarnessBriefIn(fixture.repository);
  assert.equal(
    (await reviseReleased(fixture, 1, brief, moved.revision)).revised,
    "Revised",
  );
  const updated = await decidedBy(
    released.memory,
    updateSubmission(fixture, 1, 2, moved.revision),
  );
  assert.equal(updated.decided.decided, "Committed");
  assert.equal(await releasedUnder(), moved.revision);
  await harness.store.release(updated.memory.lease);

  const restarted = await load("update-repin-restarted");
  assert.deepEqual(
    await dispatchPins(fixture),
    { projection: moved.pin, candidate: moved.pin, spawn: [] },
    "the rebuilt dispatch view offers the ticket under the revision its update pinned",
  );
  const dispatched = await decidedBy(
    restarted,
    manualDispatch(fixture, restarted),
  );
  assert.equal(dispatched.decided.decided, "Committed");
  assert.deepEqual(await dispatchPins(fixture), {
    projection: moved.pin,
    candidate: [],
    spawn: moved.pin,
  });
});

test("an update against a revision another update moved past is refused with both numbers", async () => {
  const fixture = await draftFixture();
  const decide = await fixtureWriter(fixture, "update-stale");
  assert.equal(await decide(releaseSubmission(fixture)), "Committed");
  assert.equal(
    (await reviseReleased(fixture, 1, forgedBrief(fixture.repository))).revised,
    "Revised",
  );
  assert.equal(await decide(updateSubmission(fixture, 1, 2)), "Committed");
  const stale = updateSubmission(fixture, 1, 2);
  assert.equal(await decide(stale), "Refused");
  assert.deepEqual(
    await harness.query(
      "SELECT outcome_code,refusal::jsonb->'value' AS refusal FROM decision_input WHERE input_id=$1",
      [stale.operation],
    ),
    [
      {
        outcome_code: "TicketRevisionStale",
        refusal: { ticket: fixture.draft.ticket, expected: 1, current: 2 },
      },
    ],
  );
  const read = await postgresNativeReads(pool).operation(
    fixture.partition,
    stale.operation,
  );
  assert.deepEqual(read?.state === "Refused" ? read.refusal : undefined, {
    type: "TicketRevisionStale",
    value: { ticket: fixture.draft.ticket, expected: 1, current: 2 },
  });
});

test("an update naming a draft revision its author has since moved past is refused as authoring that changed", async () => {
  const fixture = await draftFixture();
  const decide = await fixtureWriter(fixture, "update-authoring");
  assert.equal(await decide(releaseSubmission(fixture)), "Committed");
  const material = await releasedMaterial(fixture);
  const forged = forgedBrief(fixture.repository);
  assert.equal((await reviseReleased(fixture, 1, forged)).revised, "Revised");
  assert.equal((await reviseReleased(fixture, 2, forged)).revised, "Revised");
  const moved = updateSubmission(fixture, 1, 2);
  assert.equal(await decide(moved), "Refused");
  assert.deepEqual(
    await harness.query(
      "SELECT outcome_code FROM decision_input WHERE input_id=$1",
      [moved.operation],
    ),
    [{ outcome_code: "AuthoringChanged" }],
  );
  assert.deepEqual(await releasedMaterial(fixture), material);
  assert.equal(
    (await fixture.store.draft(fixture.partition, fixture.draft.ticket))
      ?.releasedAuthoringVersion,
    1,
  );
});

test("a released draft's dependencies are locked at the door", async () => {
  const fixture = await draftFixture();
  await releaseFixtureDraft(fixture, "dependencies-locked");
  assert.deepEqual(
    await fixture.store.reviseDraft({
      partition: fixture.partition,
      authority,
      ticket: fixture.draft.ticket,
      expectedVersion: 1,
      configurationRevision: fixture.revision,
      authoring: { ...plainAuthoring, deps: new Set([7]) },
      brief: postgresHarnessBriefIn(fixture.repository),
    }),
    { revised: "DependenciesLocked" },
  );
});

/** A brief that names itself, and an intent whose first line is not that name. */
const titledBrief = asDraftBrief({
  title: "Serve the reason on the ticket",
  intent: "Serve the escalation reason.\nAnd on the table beside it.",
  links: [],
});

/** What the listing calls the one ticket a released fixture's project carries. */
async function listedTitle(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
): Promise<string | undefined> {
  const found = await postgresNativeReads(pool).project(fixture.partition, {
    limit: 2,
  });
  assert.equal(found.result, "Found");
  return found.result === "Found" ? found.project.tickets[0]?.title : undefined;
}

test("a brief's title is what the listing and the ticket's own read call it", async () => {
  const fixture = await draftFixture(postgresHarnessConfiguration, titledBrief);
  await releaseFixtureDraft(fixture, "brief-title");
  assert.equal(await listedTitle(fixture), titledBrief.title);
  const read = await postgresNativeReads(pool).ticket(
    fixture.partition,
    fixture.draft.ticket,
  );
  assert.equal(read?.title, titledBrief.title);
  assert.deepEqual(
    read?.brief,
    briefAsStored({ ...titledBrief, repository: fixture.repository }),
  );
});

test("a brief that names no title is called by the first line of its intent", async () => {
  const fixture = await draftFixture(
    postgresHarnessConfiguration,
    asDraftBrief({
      intent: "Name it by this line.\nNot by this one.",
      links: [],
    }),
  );
  await releaseFixtureDraft(fixture, "brief-untitled");
  assert.equal(await listedTitle(fixture), "Name it by this line.");
});

test("an untitled brief is called by the first line of its intent that says anything", async () => {
  const intent = "\n   \nName it by this line.\nNot by this one.";
  const fixture = await draftFixture(
    postgresHarnessConfiguration,
    asDraftBrief({ intent, links: [] }),
  );
  await releaseFixtureDraft(fixture, "brief-blank-first");
  assert.equal(
    await listedTitle(fixture),
    briefIntentLines(asBriefIntent(intent))[0],
    "the listing calls a ticket what a briefing heads it with",
  );
});

test("a ticket's read shows the brief it runs, which an unreleased revision does not move and an update does", async () => {
  const fixture = await draftFixture();
  const decide = await fixtureWriter(fixture, "update-read");
  assert.equal(await decide(releaseSubmission(fixture)), "Committed");
  const reads = postgresNativeReads(pool);
  const released = await reads.ticket(fixture.partition, fixture.draft.ticket);
  assert.deepEqual(
    released?.brief,
    briefAsStored(postgresHarnessBriefIn(fixture.repository)),
  );
  const listed = await listedTitle(fixture);
  const forged = forgedBrief(fixture.repository);
  assert.equal((await reviseReleased(fixture, 1, forged)).revised, "Revised");
  assert.deepEqual(
    await reads.ticket(fixture.partition, fixture.draft.ticket),
    released,
  );
  assert.equal(await listedTitle(fixture), listed);
  assert.equal(await decide(updateSubmission(fixture, 1, 2)), "Committed");
  const updated = await reads.ticket(fixture.partition, fixture.draft.ticket);
  assert.deepEqual(updated?.brief, forged);
  assert.equal(updated?.title, forged.intent);
  assert.equal(await listedTitle(fixture), forged.intent);
});

test("the server refuses a title that reached it around the interpreter's rules", async () => {
  const { partition, draft } = await draftFixture();
  for (const value of [
    "",
    "Serve it.\nAnd more.",
    "a".repeat(briefTitleCharsMax + 1),
  ]) {
    assert.throws(
      () => asDraftBrief({ title: value, intent: "Fix it.", links: [] }),
      `the interpreter refuses ${JSON.stringify(value)}`,
    );
    await assert.rejects(
      harness.query(
        "UPDATE draft_brief SET title=$4 WHERE tenant=$1 AND project=$2 AND ticket=$3",
        [partition.tenant, partition.project, draft.ticket, value],
      ),
      `the server refuses ${JSON.stringify(value)}`,
    );
  }
});

/** Moves what a project's one binding lands by, which only the migration owner may do directly. */
async function landingSetTo(
  partition: Partition,
  repository: RepositoryId,
  mode: string,
): Promise<void> {
  await harness.query(
    `UPDATE project_repository SET landing_mode=$4
      WHERE tenant=$1 AND project=$2 AND repository=$3`,
    [partition.tenant, partition.project, repository, mode],
  );
}

test("a brief naming a landing keeps it over the one its repository is bound under", async () => {
  const { partition, store, revision, repository, draft } =
    await draftFixture();
  assert.deepEqual(
    draft.brief?.finalization,
    { mode: "Push" },
    "the binding this project was made with lands where the work happened",
  );
  await landingSetTo(partition, repository, "PullRequest");
  const revised = await store.reviseDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 1,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: {
      ...postgresHarnessBrief,
      repository,
      finalization: { mode: "Push" },
    },
  });
  assert.deepEqual(
    revised.revised === "Revised"
      ? revised.draft.brief?.finalization
      : undefined,
    { mode: "Push" },
    "the mode the brief named is the one stored, not the binding's",
  );
});

test("a brief naming no repository lands where the work happened", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "authoring-landing-unbound",
  );
  const bound = await postgresHarnessBinding(harness, partition);
  await landingSetTo(partition, bound, "PullRequest");
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
    throw new Error("the unbound draft was not initialized");
  const created = await store.createDraft({
    partition,
    authority,
    configurationRevision: revision,
    configurationDigest: initialized.configuration.digest,
    expectedProjectSequence: initialized.projectSequence,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  assert.deepEqual(
    created.created === "Created"
      ? created.draft.brief?.finalization
      : undefined,
    { mode: "Push" },
    "no repository names no landing to take, so the tree's own default stands",
  );
});

/** The same brief with no branch on it, which is a proposal with no head to open from. */
function briefWithoutBranch(brief: DraftBrief): DraftBrief {
  const { branch, ...branchless } = brief;
  return branch === undefined ? brief : branchless;
}

/** One project bound to land by proposal, and the door its briefs are written by. */
async function proposingFixture(label: string) {
  const partition = await postgresHarnessProject(harness.store, label);
  const repository = await postgresHarnessBinding(harness, partition);
  await landingSetTo(partition, repository, "PullRequest");
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
    throw new Error(`the ${label} draft was not initialized`);
  return {
    partition,
    repository,
    create: (brief: DraftBrief) =>
      store.createDraft({
        partition,
        authority,
        configurationRevision: revision,
        configurationDigest: initialized.configuration.digest,
        expectedProjectSequence: initialized.projectSequence,
        authoring: plainAuthoring,
        brief,
      }),
    revise: (ticket: TicketId, brief: DraftBrief) =>
      store.reviseDraft({
        partition,
        authority,
        ticket,
        expectedVersion: 1,
        configurationRevision: revision,
        authoring: plainAuthoring,
        brief,
      }),
  };
}

/**
 * A repository bound to propose and a brief naming nothing to propose into,
 * which is the repository's own default branch. It is also what proves the door
 * reads the binding at all: a resolution that skipped to the tree's own default
 * would store a push here and pass.
 */
test("a repository landing by proposal stores a brief that names no base", async () => {
  const proposing = await proposingFixture("authoring-landing-halved");
  const created = await proposing.create({
    ...postgresHarnessBrief,
    repository: proposing.repository,
  });
  if (created.created !== "Created")
    throw new Error(`the proposing draft was ${created.created}`);
  assert.deepEqual(created.draft.brief?.finalization, {
    mode: "PullRequest",
  });
  assert.deepEqual(
    await storedLanding(proposing.partition, created.draft.ticket),
    { finalization_mode: "PullRequest", finalization_target: null },
    "the row holds the resolved mode and no reference at all",
  );
});

/**
 * The head a proposal is opened from is the brief's own branch, and the landing
 * that needs one is the repository's rather than anything the caller wrote. So
 * the door answers a refusal the caller can act on, and writes nothing.
 */
test("a repository landing by proposal refuses a brief naming no branch", async () => {
  const proposing = await proposingFixture("authoring-landing-headless");
  const created = await proposing.create({
    ...briefWithoutBranch(postgresHarnessBrief),
    repository: proposing.repository,
  });
  assert.deepEqual(created, { created: "LandingUnbranched" });
  assert.deepEqual(
    await harness.query(
      `SELECT ticket FROM draft WHERE tenant=$1 AND project=$2`,
      [proposing.partition.tenant, proposing.partition.project],
    ),
    [],
    "a refused brief mints no ticket",
  );
});

/** The same refusal from the door beside it, which answers in columns of its own. */
test("a revision that leaves a proposing brief with no branch is refused too", async () => {
  const proposing = await proposingFixture("authoring-landing-unheaded");
  const created = await proposing.create({
    ...postgresHarnessBrief,
    repository: proposing.repository,
  });
  if (created.created !== "Created")
    throw new Error(`the proposing draft was ${created.created}`);
  assert.deepEqual(
    await proposing.revise(created.draft.ticket, {
      ...briefWithoutBranch(postgresHarnessBrief),
      repository: proposing.repository,
    }),
    { revised: "LandingUnbranched" },
  );
  assert.deepEqual(
    await storedLanding(proposing.partition, created.draft.ticket),
    { finalization_mode: "PullRequest", finalization_target: null },
    "the brief the refusal left standing is the one that was already whole",
  );
});

/** The pairing the relaxed check still refuses: a head that is its own base. */
test("a brief proposing from the branch it opens into is refused by the check", async () => {
  const proposing = await proposingFixture("authoring-landing-into-itself");
  const created = await proposing.create({
    ...postgresHarnessBrief,
    repository: proposing.repository,
  });
  if (created.created !== "Created")
    throw new Error(`the proposing draft was ${created.created}`);
  await assert.rejects(
    harness.query(
      `UPDATE draft_brief SET finalization_target=branch
        WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      [
        proposing.partition.tenant,
        proposing.partition.project,
        created.draft.ticket,
      ],
    ),
    /draft_brief_finalization_is_whole/u,
  );
});

/**
 * A repository bound to land nothing. Every draft resolves a landing, so the
 * one that lands nothing is a landing like the others: the door resolves it
 * from the brief or from the binding, and the row holds the mode it resolved.
 */
async function landlessFixture(label: string, landing = "None") {
  const partition = await postgresHarnessProject(harness.store, label);
  const repository = await postgresHarnessBinding(harness, partition);
  await landingSetTo(partition, repository, landing);
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
    throw new Error(`the ${label} draft was not initialized`);
  return {
    partition,
    store,
    revision,
    repository,
    create: (brief: DraftBrief) =>
      store.createDraft({
        partition,
        authority,
        configurationRevision: revision,
        configurationDigest: initialized.configuration.digest,
        expectedProjectSequence: initialized.projectSequence,
        authoring: plainAuthoring,
        brief,
      }),
  };
}

/** What a ticket's brief row holds for its landing, read past every mapper. */
async function storedLanding(partition: Partition, ticket: number) {
  return (
    await harness.query(
      `SELECT finalization_mode,finalization_target FROM draft_brief
        WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      [partition.tenant, partition.project, ticket],
    )
  )[0];
}

test("a repository that lands nothing lands its drafts nowhere", async () => {
  const landless = await landlessFixture("authoring-landless");
  const created = await landless.create({
    ...postgresHarnessBrief,
    repository: landless.repository,
  });
  if (created.created !== "Created")
    throw new Error(`the landless draft was ${created.created}`);
  assert.deepEqual(
    await storedLanding(landless.partition, created.draft.ticket),
    {
      finalization_mode: "None",
      finalization_target: null,
    },
  );
  assert.deepEqual(created.draft.brief?.finalization, { mode: "None" });
  assert.deepEqual(
    (await landless.store.draft(landless.partition, created.draft.ticket))
      ?.brief?.finalization,
    { mode: "None" },
  );
});

test("a ticket that lands nothing is revised with the brief it just read back", async () => {
  const landless = await landlessFixture("authoring-landless-revise");
  const created = await landless.create({
    ...postgresHarnessBrief,
    repository: landless.repository,
  });
  if (created.created !== "Created")
    throw new Error(`the landless draft was ${created.created}`);
  const read = (
    await landless.store.draft(landless.partition, created.draft.ticket)
  )?.brief;
  assert.ok(read !== undefined);
  const revised = await landless.store.reviseDraft({
    partition: landless.partition,
    authority,
    ticket: created.draft.ticket,
    expectedVersion: created.draft.authoringVersion,
    configurationRevision: landless.revision,
    authoring: plainAuthoring,
    brief: read,
  });
  assert.equal(revised.revised, "Revised");
  assert.deepEqual(
    revised.revised === "Revised" ? revised.draft.brief : undefined,
    read,
    "what the ticket reads back is what it may be revised with",
  );
});

test("a brief that lands nothing keeps it over a repository that proposes", async () => {
  const landless = await landlessFixture(
    "authoring-landless-proposing",
    "PullRequest",
  );
  const created = await landless.create({
    ...postgresHarnessBrief,
    repository: landless.repository,
    finalization: { mode: "None" },
  });
  assert.equal(created.created, "Created");
  if (created.created !== "Created") return;
  assert.deepEqual(
    await storedLanding(landless.partition, created.draft.ticket),
    {
      finalization_mode: "None",
      finalization_target: null,
    },
  );
});

test("a landing that lands nothing is refused a reference to land on", async () => {
  const landless = await landlessFixture("authoring-landless-halved");
  const created = await landless.create({
    ...postgresHarnessBrief,
    repository: landless.repository,
  });
  if (created.created !== "Created")
    throw new Error(`the landless draft was ${created.created}`);
  await assert.rejects(
    harness.query(
      `UPDATE draft_brief SET finalization_target='refs/heads/release'
        WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      [
        landless.partition.tenant,
        landless.partition.project,
        created.draft.ticket,
      ],
    ),
    /draft_brief_finalization_none_names_no_reference/u,
  );
});

test("a ticket that starts landing somewhere keeps the landing it names", async () => {
  const landless = await landlessFixture("authoring-landless-roundtrip");
  const brief = { ...postgresHarnessBrief, repository: landless.repository };
  const created = await landless.create(brief);
  if (created.created !== "Created")
    throw new Error(`the landless draft was ${created.created}`);
  assert.deepEqual(
    await storedLanding(landless.partition, created.draft.ticket),
    { finalization_mode: "None", finalization_target: null },
    "a brief that names no landing takes the one its repository is bound under",
  );
  const landing = await landless.store.reviseDraft({
    partition: landless.partition,
    authority,
    ticket: created.draft.ticket,
    expectedVersion: created.draft.authoringVersion,
    configurationRevision: landless.revision,
    authoring: plainAuthoring,
    brief: { ...brief, finalization: { mode: "Push" } },
  });
  assert.equal(landing.revised, "Revised");
  assert.deepEqual(
    await storedLanding(landless.partition, created.draft.ticket),
    { finalization_mode: "Push", finalization_target: null },
    "and the landing the revision names is kept over that one",
  );
  const dropped = await landless.store.reviseDraft({
    partition: landless.partition,
    authority,
    ticket: created.draft.ticket,
    expectedVersion:
      landing.revised === "Revised" ? landing.draft.authoringVersion : 0,
    configurationRevision: landless.revision,
    authoring: plainAuthoring,
    brief,
  });
  assert.equal(dropped.revised, "Revised");
  assert.deepEqual(
    await storedLanding(landless.partition, created.draft.ticket),
    { finalization_mode: "None", finalization_target: null },
    "until a revision naming none takes the binding's back",
  );
});

test("a released ticket that lands nothing still hands release a brief", async () => {
  const landless = await landlessFixture("authoring-landless-release");
  const created = await landless.create({
    ...postgresHarnessBrief,
    repository: landless.repository,
  });
  if (created.created !== "Created")
    throw new Error(`the landless draft was ${created.created}`);
  const unique = randomUUID();
  assert.equal(
    (
      await harness.inbox.accept({
        partition: landless.partition,
        operation: asOperationId(`release-${unique}`),
        authority,
        key: asIdempotencyKey(`release-${unique}`),
        command: {
          version: 1,
          command: "ReleaseDraft",
          ticket: created.draft.ticket,
          authoringVersion: created.draft.authoringVersion,
          configurationRevision: landless.revision,
        },
      })
    ).accepted,
    "Accepted",
  );
  const input = await harness.discovery.next(landless.partition);
  assert.ok(input !== undefined);
  assert.deepEqual(
    input.source.kind === "Operation"
      ? input.source.draftRelease?.brief
      : undefined,
    {
      ...postgresHarnessBrief,
      checks: [],
      repository: landless.repository,
      finalization: { mode: "None" },
    },
    "the brief release reads is the whole of one, landing and all",
  );
});
