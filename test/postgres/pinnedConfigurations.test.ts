import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { postgresPinnedConfigurations } from "../../src/adapters/postgres/pinnedConfigurations.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessOpen,
  postgresHarnessProject,
} from "./harness.ts";
import { schedulerRolePool } from "./schedulerHarness.ts";

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

test("an absent revision is Missing and an unreachable authority is Unavailable", async () => {
  const harness = await postgresHarnessOpen();
  const pool = schedulerRolePool();
  const partition = await postgresHarnessProject(harness.store, "pinned-read");
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
  await harness.close();
});

test("an existing revision without the authored briefing contract is Incompatible", async () => {
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
      { read: "Incompatible", fault: "BriefingShapeMissing" },
    );
  } finally {
    await pool.end();
    await harness.close();
  }
});
