/**
 * Per-project selector settings against a real server: what a project inherits,
 * what it overrides, the revision fence the write stands on, and the roles that
 * may reach any of it.
 */

import assert from "node:assert/strict";
import type pg from "pg";
import { after, before, test } from "node:test";

import {
  apiRole,
  projectAuthorizationFunction,
  selectorControlRole,
  selectorServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  allProjectAccessKinds,
  oidcPrincipal,
} from "../../src/interpreter/nativeWeb.ts";
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
import type { SelectorProjectSettingsRecord } from "../../src/interpreter/selectorProjectSettings.ts";
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

/** The written row, refusing the outcomes a case did not expect. */
function writtenSettings(
  outcome: Awaited<
    ReturnType<ReturnType<typeof postgresSelectorProjectSettings>["write"]>
  >,
): SelectorProjectSettingsRecord {
  assert.equal(outcome.written, "Settings");
  if (outcome.written !== "Settings")
    throw new Error("selector settings write did not answer with a row");
  return outcome.settings;
}

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
    const settings = writtenSettings(written);
    assert.equal(settings.revision, 1);
    assert.equal(
      settings.effective.northStar,
      "Every ticket in this project moves the console to general availability.",
    );
    assert.equal(
      settings.effective.basePrompt,
      "Prefer tickets that unblock the largest closure.",
    );
    assert.equal(
      settings.effective.limits.tokensPerDecision,
      installation.limits.tokensPerDecision * 2,
    );
    assert.equal(
      settings.effective.limits.concurrentDecisions,
      installation.limits.concurrentDecisions,
    );
    assert.equal(settings.effective.dispatchMode, installation.dispatchMode);
    const cleared = writtenSettings(
      await store.write(
        partition,
        1,
        { northStar: "Ship the console." },
        administrator,
      ),
    );
    assert.equal(cleared.revision, 2);
    assert.equal(cleared.overrides.basePrompt, undefined);
    assert.equal(cleared.effective.basePrompt, installation.basePrompt);
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
      writtenSettings(
        await store.write(partition, 0, { northStar: "First." }, administrator),
      ).revision,
      1,
    );
    assert.deepEqual(
      await store.write(partition, 0, { northStar: "Raced." }, administrator),
      { written: "FenceMoved" },
    );
    assert.equal((await store.read(partition)).overrides.northStar, "First.");
    assert.equal(
      writtenSettings(
        await store.write(
          partition,
          1,
          { northStar: "Second." },
          administrator,
        ),
      ).revision,
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
    const restored = writtenSettings(
      await store.write(
        partition,
        2,
        retained[0]?.overrides ?? {},
        administrator,
      ),
    );
    assert.equal(restored.overrides.northStar, "First.");
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

test("automatic dispatch with no production host is a refusal, not a fault", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-automatic-readiness",
  );
  const pool = postgresHarnessRolePool(apiRole);
  try {
    assert.deepEqual(
      await postgresSelectorProjectSettings(pool).write(
        partition,
        0,
        { dispatchMode: "Automatic" },
        administrator,
      ),
      { written: "AutomaticDispatchUnavailable" },
    );
    assert.equal(
      (await postgresSelectorProjectSettings(pool).read(partition)).revision,
      0,
    );
  } finally {
    await pool.end();
  }
});

/**
 * A pool that lets one competing write land the moment the subject's first
 * statement has answered. A write that reports its own row is unmoved by it; a
 * write that reads the row back afterwards reports the competitor's.
 */
function racingPool(pool: pg.Pool, race: () => Promise<void>): pg.Pool {
  let raced = false;
  const doubled = {
    query: async (...parameters: readonly unknown[]): Promise<unknown> => {
      const answered = await (
        pool.query as unknown as (
          ...args: readonly unknown[]
        ) => Promise<unknown>
      )(...parameters);
      if (!raced) {
        raced = true;
        await race();
      }
      return answered;
    },
  };
  return doubled as unknown as pg.Pool;
}

test("a write reports the row it wrote and not a racing administrator's", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-write-reports-itself",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const competitor = postgresHarnessRolePool(apiRole);
  try {
    const store = postgresSelectorProjectSettings(pool);
    assert.equal(
      writtenSettings(
        await store.write(partition, 0, { northStar: "First." }, administrator),
      ).revision,
      1,
    );
    const raced = postgresSelectorProjectSettings(
      racingPool(pool, async () => {
        await postgresSelectorProjectSettings(competitor).write(
          partition,
          2,
          { northStar: "Third, by somebody else." },
          administrator,
        );
      }),
    );
    const mine = writtenSettings(
      await raced.write(partition, 1, { northStar: "Second." }, administrator),
    );
    assert.equal(mine.revision, 2);
    assert.equal(mine.overrides.northStar, "Second.");
    assert.equal(mine.effective.northStar, "Second.");
    assert.equal((await store.read(partition)).revision, 3);
  } finally {
    await pool.end();
    await competitor.end();
  }
});

test("every access kind the roster names is one the server answers for", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-access-kinds",
  );
  const principal = oidcPrincipal("https://issuer.test", "settings-admin");
  await harness.membership.grant({
    principal,
    partition,
    authority: administrator,
    access: new Set(allProjectAccessKinds),
  });
  for (const kind of allProjectAccessKinds)
    assert.deepEqual(
      await harness.access.authorize(principal, partition, kind),
      administrator,
      kind,
    );
  await assert.rejects(
    () =>
      harness.query(
        `SELECT * FROM ${projectAuthorizationFunction}($1,$2,$3,'ManageSelector')`,
        [principal, partition.tenant, partition.project],
      ),
    /unknown project access kind/u,
  );
});

test("a project administrator is the one a project's settings answer to", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-settings-membership",
  );
  const narrowed = oidcPrincipal("https://issuer.test", "reader-only");
  await harness.membership.grant({
    principal: narrowed,
    partition,
    authority: administrator,
    access: new Set(["Read"] as const),
  });
  assert.equal(
    await harness.access.authorize(
      narrowed,
      partition,
      "ManageProjectSelector",
    ),
    undefined,
  );
  const wide = oidcPrincipal("https://issuer.test", "settings-writer");
  await harness.membership.grant({
    principal: wide,
    partition,
    authority: administrator,
    access: new Set(["ManageProjectSelector"] as const),
  });
  assert.deepEqual(
    await harness.access.authorize(wide, partition, "ManageProjectSelector"),
    administrator,
  );
});

test("an interaction recorded without an attempt keeps both fence revisions", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-reconstructed-fence",
  );
  const servicePool = postgresHarnessRolePool(selectorServiceRole);
  const state = postgresSelectorState(servicePool);
  const decision = `reconstructed-${crypto.randomUUID()}`;
  try {
    assert.equal(
      await state.recordInteraction(
        {
          decision,
          partition,
          instructionsVersion: "12.1",
          instructions: "choose a dispatchable ticket",
          observedView: [],
          context: {
            workingMemory: {},
            operationalContext: postgresHarnessSelectorContext,
          },
          toolActivity: [],
          result: { waiting: true },
          implementationRevision: "implementation-1",
          modelRevision: "model-1",
          policyRevision: "policy-1",
          accounting: { tokens: 1, durationMs: 1 },
          startedAt: "2026-08-30T12:00:00.000Z",
          completedAt: "2026-08-30T12:00:01.000Z",
        },
        {
          partition,
          notificationCursor: 0,
          revision: 0,
          attention: "Monitoring",
          workingMemory: {},
        },
        { settingsRevision: 12, projectSettingsRevision: 1 },
      ),
      true,
    );
    assert.deepEqual(
      await harness.query(
        `SELECT settings_revision::text AS settings,
                project_settings_revision::text AS project
           FROM selector_attempt WHERE attempt=$1`,
        [decision],
      ),
      [{ settings: "12", project: "1" }],
    );
  } finally {
    await servicePool.end();
  }
});

/** A pool that answers one crafted row, for the shapes a server cannot produce. */
function stubbedPool(rows: readonly unknown[]): pg.Pool {
  return { query: () => Promise.resolve({ rows }) } as unknown as pg.Pool;
}

/** The row a write answers with, read out of the server so no case writes one. */
async function settingsWriteRow(
  pool: pg.Pool,
  partition: Partition,
): Promise<Record<string, unknown>> {
  const answered = await pool.query<Record<string, unknown>>(
    `SELECT p.revision::text, p.north_star, p.mode, p.dispatch_mode,
            p.base_prompt, p.model_allowlist, p.tool_allowlist,
            p.tokens_per_decision::text, p.milliseconds_per_decision::text,
            p.tool_calls_per_decision::text, p.input_bytes_per_decision::text,
            p.candidate_pages_per_decision::text,
            p.operational_context_max_age_ms::text,
            s.revision::text AS installation_revision,
            s.mode AS installation_mode,
            s.dispatch_mode AS installation_dispatch_mode,
            s.base_prompt AS installation_base_prompt,
            s.controls AS installation_controls
       FROM selector_project_settings p, selector_runtime_settings s
      WHERE p.tenant=$1 AND p.project=$2 AND s.singleton=1`,
    [partition.tenant, partition.project],
  );
  const row = answered.rows[0];
  if (row === undefined)
    throw new Error("the project has no settings row to answer with");
  return row;
}

test("a write answering without its installation half is refused, not resolved", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-write-half-answer",
  );
  const pool = postgresHarnessRolePool(apiRole);
  try {
    const whole = writtenSettings(
      await postgresSelectorProjectSettings(pool).write(
        partition,
        0,
        { northStar: "Ship the console." },
        administrator,
      ),
    );
    assert.equal(whole.revision, 1);
    const row = await settingsWriteRow(pool, partition);
    await assert.rejects(
      () =>
        postgresSelectorProjectSettings(
          stubbedPool([{ ...row, installation_base_prompt: null }]),
        ).write(partition, 1, {}, administrator),
      /selector settings write answered no installation_base_prompt/u,
    );
  } finally {
    await pool.end();
  }
});

test("a fence no attempt row could hold is refused before any of it is written", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-fence-bounds",
  );
  const servicePool = postgresHarnessRolePool(selectorServiceRole);
  const state = postgresSelectorState(servicePool);
  const attempt = `bounded-${crypto.randomUUID()}`;
  try {
    assert.equal(
      await state.allocateAttempt(attempt, partition, {
        concurrentDecisions: 100,
        selectionsPerMinute: 100_000,
        millisecondsPerDecision: 60_000,
      }),
      true,
    );
    await assert.rejects(
      () =>
        state.runningAttempt(attempt, fenceObservation(partition), {
          settingsRevision: 0,
          projectSettingsRevision: 0,
        }),
      RangeError,
    );
    await assert.rejects(
      () =>
        state.runningAttempt(attempt, fenceObservation(partition), {
          settingsRevision: 1,
          projectSettingsRevision: -1,
        }),
      RangeError,
    );
    assert.deepEqual(
      await harness.query(
        `SELECT settings_revision FROM selector_attempt WHERE attempt=$1`,
        [attempt],
      ),
      [{ settings_revision: null }],
    );
  } finally {
    await state
      .terminateAttempt(attempt, "test cleanup")
      .catch(() => undefined);
    await servicePool.end();
  }
});
