import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { postgresPinnedConfigurations } from "../../src/adapters/postgres/pinnedConfigurations.ts";
import { configurationRevisionDigest } from "../../src/adapters/postgres/digest.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessOpen,
  postgresHarnessProject,
} from "./harness.ts";
import { schedulerRolePool } from "./schedulerHarness.ts";

const authority = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("author"),
};

function configurationNamed(name: string) {
  return asCanonicalConfiguration(
    postgresHarnessConfiguration.replace(
      "The ticket should be completed.",
      name,
    ),
  );
}

test("the scheduler role reads an authored pinned task configuration", async () => {
  const harness = await postgresHarnessOpen();
  const pool = schedulerRolePool();
  try {
    const partition = await postgresHarnessProject(
      harness.store,
      "pinned-configuration",
    );
    const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
    const created = await harness.authoring.createConfiguration({
      partition,
      authority: {
        kind: asAuthorityKind("User"),
        subject: asAuthoritySubject("author"),
      },
      revision,
      canonical: postgresHarnessConfiguration,
    });
    assert.equal(created.created, "Created");
    if (created.created !== "Created") return;
    const configurations = postgresPinnedConfigurations(pool);
    assert.deepEqual(
      await configurations.configuration(partition, {
        configurationRevision: revision,
        configurationDigest: created.revision.digest,
      }),
      {
        read: "Configuration",
        configuration: {
          configurationRevision: revision,
          configurationDigest: created.revision.digest,
          brief: {
            motivation: ["The ticket should be completed."],
            acceptanceCriteria: ["The ticket is complete."],
            constraints: [],
          },
          practices: [],
          work: { instructions: [] },
          review: { instructions: [] },
        },
      },
    );
  } finally {
    await pool.end();
    await harness.close();
  }
});

test("the pinned read is exact across revisions, tenants, and projects", async () => {
  const harness = await postgresHarnessOpen();
  const pool = schedulerRolePool();
  try {
    const suffix = randomUUID();
    const target = {
      tenant: asTenantId(`tenant-target-${suffix}`),
      project: asProjectId(`project-target-${suffix}`),
    };
    const foreignTenant = {
      tenant: asTenantId(`tenant-foreign-${suffix}`),
      project: target.project,
    };
    const foreignProject = {
      tenant: target.tenant,
      project: asProjectId(`project-foreign-${suffix}`),
    };
    for (const partition of [target, foreignTenant, foreignProject]) {
      await harness.store.createProject(partition);
    }
    const revision = asConfigurationRevisionId(`shared-${suffix}`);
    for (const [partition, name] of [
      [foreignTenant, "foreign tenant"],
      [foreignProject, "foreign project"],
      [target, "target revision"],
    ] as const) {
      await harness.authoring.createConfiguration({
        partition,
        authority,
        revision,
        canonical: configurationNamed(name),
      });
    }
    const targetCreated = await harness.authoring.createConfiguration({
      partition: target,
      authority,
      revision: asConfigurationRevisionId(`later-${suffix}`),
      canonical: configurationNamed("later revision"),
    });
    assert.equal(targetCreated.created, "Created");
    const pinned = await harness.authoring.configuration(target, revision);
    assert.ok(pinned !== undefined);
    const read = await postgresPinnedConfigurations(pool).configuration(
      target,
      {
        configurationRevision: revision,
        configurationDigest: pinned.digest,
      },
    );
    assert.equal(read.read, "Configuration");
    if (read.read === "Configuration")
      assert.deepEqual(read.configuration.brief.motivation, [
        "target revision",
      ]);
  } finally {
    await pool.end();
    await harness.close();
  }
});

test("an absent revision is Missing and an unreachable authority is Unavailable", async () => {
  const harness = await postgresHarnessOpen();
  const pool = schedulerRolePool();
  try {
    const partition = await postgresHarnessProject(
      harness.store,
      "pinned-read",
    );
    const configurations = postgresPinnedConfigurations(pool);
    assert.deepEqual(
      await configurations.configuration(partition, {
        configurationRevision: "absent",
        configurationDigest: "digest",
      }),
      { read: "Missing" },
    );
    await pool.end();
    assert.deepEqual(
      await configurations.configuration(partition, {
        configurationRevision: "absent",
        configurationDigest: "digest",
      }),
      { read: "Unavailable" },
    );
  } finally {
    await pool.end().catch(() => undefined);
    await harness.close();
  }
});

test("a pre-contract revision without authored briefing content holds for replacement", async () => {
  const harness = await postgresHarnessOpen();
  const pool = schedulerRolePool();
  try {
    const partition = await postgresHarnessProject(
      harness.store,
      "incompatible-pinned-configuration",
    );
    const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
    const created = await harness.authoring.createConfiguration({
      partition,
      authority: {
        kind: asAuthorityKind("User"),
        subject: asAuthoritySubject("author"),
      },
      revision,
      canonical: asCanonicalConfiguration("{}"),
    });
    assert.equal(created.created, "Created");
    if (created.created !== "Created") return;
    assert.deepEqual(
      await postgresPinnedConfigurations(pool).configuration(partition, {
        configurationRevision: revision,
        configurationDigest: created.revision.digest,
      }),
      { read: "Unavailable" },
    );
  } finally {
    await pool.end();
    await harness.close();
  }
});

test("configuration bytes that contradict their stored digest are incompatible", async () => {
  const harness = await postgresHarnessOpen();
  const pool = schedulerRolePool();
  try {
    const partition = await postgresHarnessProject(
      harness.store,
      "corrupt-pinned",
    );
    const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
    const created = await harness.authoring.createConfiguration({
      partition,
      authority: {
        kind: asAuthorityKind("User"),
        subject: asAuthoritySubject("author"),
      },
      revision,
      canonical: postgresHarnessConfiguration,
    });
    assert.equal(created.created, "Created");
    if (created.created !== "Created") return;
    await harness.query(
      `UPDATE configuration_revision SET canonical='{}'
        WHERE tenant=$1 AND project=$2 AND revision=$3`,
      [partition.tenant, partition.project, revision],
    );
    assert.deepEqual(
      await postgresPinnedConfigurations(pool).configuration(partition, {
        configurationRevision: revision,
        configurationDigest: created.revision.digest,
      }),
      { read: "Incompatible", fault: "DigestMismatch" },
    );
    const unreadable = "not-json";
    await harness.query(
      `UPDATE configuration_revision SET canonical=$4,digest=$5
        WHERE tenant=$1 AND project=$2 AND revision=$3`,
      [
        partition.tenant,
        partition.project,
        revision,
        unreadable,
        configurationRevisionDigest(unreadable),
      ],
    );
    assert.deepEqual(
      await postgresPinnedConfigurations(pool).configuration(partition, {
        configurationRevision: revision,
        configurationDigest: configurationRevisionDigest(unreadable),
      }),
      { read: "Incompatible", fault: "ConfigurationUnreadable" },
    );
  } finally {
    await pool.end();
    await harness.close();
  }
});
