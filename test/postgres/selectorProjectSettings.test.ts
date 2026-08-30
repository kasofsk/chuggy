/**
 * Per-project selector settings against a real server: what a project inherits,
 * what it overrides, the revision fence the write stands on, and the roles that
 * may reach any of it.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  apiRole,
  selectorControlRole,
  selectorServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresSelectorProjectSettings,
  postgresSelectorRuntimeControl,
  postgresSelectorState,
} from "../../src/adapters/postgres/selector.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  postgresHarnessSelectorContext,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

const administrator = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("selector-admin"),
};

test("a project with no row of its own inherits every installation default", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-inherits",
  );
  const pool = postgresHarnessRolePool(apiRole);
  try {
    const installation = await postgresSelectorRuntimeControl(pool).settings();
    const settings =
      await postgresSelectorProjectSettings(pool).read(partition);
    assert.equal(settings.revision, 0);
    assert.deepEqual(settings.overrides, {});
    assert.equal(settings.effective.basePrompt, installation.basePrompt);
    assert.equal(settings.effective.revision, installation.revision);
    assert.equal(settings.effective.northStar, undefined);
    assert.deepEqual(settings.effective.limits, installation.limits);
  } finally {
    await pool.end();
  }
});

test("a project's North Star and overrides survive the whole-value write", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-north-star",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  try {
    const installation = await postgresSelectorRuntimeControl(pool).settings();
    const written = await store.write(
      partition,
      0,
      {
        northStar:
          "Every ticket in this project moves the console to general availability.",
        basePrompt: "Prefer tickets that unblock the largest closure.",
        limits: {
          tokensPerDecision: installation.limits.tokensPerDecision * 2,
        },
      },
      administrator,
    );
    assert.equal(written?.revision, 1);
    assert.equal(
      written?.effective.northStar,
      "Every ticket in this project moves the console to general availability.",
    );
    assert.equal(
      written?.effective.basePrompt,
      "Prefer tickets that unblock the largest closure.",
    );
    assert.equal(
      written?.effective.limits.tokensPerDecision,
      installation.limits.tokensPerDecision * 2,
    );
    assert.equal(
      written?.effective.limits.concurrentDecisions,
      installation.limits.concurrentDecisions,
    );
    assert.equal(written?.effective.dispatchMode, installation.dispatchMode);
    const cleared = await store.write(
      partition,
      1,
      { northStar: "Ship the console." },
      administrator,
    );
    assert.equal(cleared?.revision, 2);
    assert.equal(cleared?.overrides.basePrompt, undefined);
    assert.equal(cleared?.effective.basePrompt, installation.basePrompt);
  } finally {
    await pool.end();
  }
});

test("a write under a revision the row has left is refused rather than applied", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-fence",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  try {
    assert.equal(
      (await store.write(partition, 0, { northStar: "First." }, administrator))
        ?.revision,
      1,
    );
    assert.equal(
      await store.write(partition, 0, { northStar: "Raced." }, administrator),
      undefined,
    );
    assert.equal((await store.read(partition)).overrides.northStar, "First.");
    assert.equal(
      (await store.write(partition, 1, { northStar: "Second." }, administrator))
        ?.revision,
      2,
    );
  } finally {
    await pool.end();
  }
});

test("every write is retained with the administrator who made it", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-settings-history",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  try {
    await store.write(partition, 0, { northStar: "First." }, administrator);
    await store.write(partition, 1, { northStar: "Second." }, administrator);
    const retained = await store.history(partition, 0, 10);
    assert.deepEqual(
      retained.map((revision) => revision.revision),
      [1, 2],
    );
    assert.deepEqual(retained[0]?.overrides, { northStar: "First." });
    assert.deepEqual(retained[1]?.administrator, administrator);
    assert.equal(
      Number.isFinite(Date.parse(retained[1]?.recordedAt ?? "")),
      true,
    );
    const restored = await store.write(
      partition,
      2,
      retained[0]?.overrides ?? {},
      administrator,
    );
    assert.equal(restored?.overrides.northStar, "First.");
  } finally {
    await pool.end();
  }
});

test("the selector service reads a project's settings and never writes them", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-service-read",
  );
  const apiPool = postgresHarnessRolePool(apiRole);
  const servicePool = postgresHarnessRolePool(selectorServiceRole);
  try {
    await postgresSelectorProjectSettings(apiPool).write(
      partition,
      0,
      { northStar: "Ship the console." },
      administrator,
    );
    const resolved =
      await postgresSelectorRuntimeControl(servicePool).projectSettings(
        partition,
      );
    assert.equal(resolved.northStar, "Ship the console.");
    assert.equal(resolved.projectRevision, 1);
    assert.match(
      (await harness.attemptAs(
        selectorServiceRole,
        "UPDATE selector_project_settings SET north_star='forged'",
      )) ?? "",
      postgresHarnessDenial("selector_project_settings"),
    );
  } finally {
    await apiPool.end();
    await servicePool.end();
  }
});

test("the API administers a project's settings and not the installation's", async () => {
  const controlPool = postgresHarnessRolePool(selectorControlRole);
  try {
    const installation =
      await postgresSelectorRuntimeControl(controlPool).settings();
    assert.match(
      (await harness.attemptAs(
        apiRole,
        `SELECT update_selector_runtime_settings(${String(installation.revision)},'Paused',NULL,NULL,NULL,'User','forged')`,
      )) ?? "",
      /permission denied for function update_selector_runtime_settings/u,
    );
    assert.match(
      (await harness.attemptAs(
        apiRole,
        "UPDATE selector_runtime_settings SET mode='Paused' WHERE singleton=1",
      )) ?? "",
      postgresHarnessDenial("selector_runtime_settings"),
    );
  } finally {
    await controlPool.end();
  }
});

/** One project's observation, which is all a running attempt needs to be given. */
function fenceObservation(partition: Partition) {
  const token = {
    ...partition,
    recoveryEpoch: "epoch",
    schemaVersion: 1,
    watermark: 0,
    digest: "c".repeat(64),
  } as const;
  return {
    token,
    candidates: [],
    notificationCursor: 0,
    operationalContext: postgresHarnessSelectorContext,
    workingMemory: {},
    nextCandidateScan: { state: "Exhausted", token },
  } as const;
}

test("a running attempt records both halves of the fence it started under", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-attempt-fence",
  );
  const servicePool = postgresHarnessRolePool(selectorServiceRole);
  const state = postgresSelectorState(servicePool);
  const attempt = `fence-${crypto.randomUUID()}`;
  const observation = fenceObservation(partition);
  try {
    assert.equal(
      await state.allocateAttempt(attempt, partition, {
        concurrentDecisions: 100,
        selectionsPerMinute: 100_000,
        millisecondsPerDecision: 60_000,
      }),
      true,
    );
    await state.runningAttempt(attempt, observation, {
      settingsRevision: 1,
      projectSettingsRevision: 4,
    });
    assert.deepEqual(
      await harness.query(
        `SELECT settings_revision::text AS settings,
                project_settings_revision::text AS project
           FROM selector_attempt WHERE attempt=$1`,
        [attempt],
      ),
      [{ settings: "1", project: "4" }],
    );
    await assert.rejects(
      () =>
        state.runningAttempt(attempt, observation, {
          settingsRevision: 1,
          projectSettingsRevision: 5,
        }),
      /selector attempt cannot enter Running/u,
    );
  } finally {
    await state
      .terminateAttempt(attempt, "test cleanup")
      .catch(() => undefined);
    await servicePool.end();
  }
});

test("a project cannot dispatch automatically without a production policy host", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-automatic-readiness",
  );
  const pool = postgresHarnessRolePool(apiRole);
  try {
    await assert.rejects(
      () =>
        postgresSelectorProjectSettings(pool).write(
          partition,
          0,
          { dispatchMode: "Automatic" },
          administrator,
        ),
      /automatic selector requires a production capability host/u,
    );
  } finally {
    await pool.end();
  }
});
