/**
 * Per-project selector settings against a real server: what a project inherits,
 * what it overrides, the revision fence the write stands on, and the roles that
 * may reach any of it.
 */

import assert from "node:assert/strict";
import type pg from "pg";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

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
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { selectorProjectOverridesSchema } from "../../src/contract/requests.ts";
import { dispatchesPerDecisionUnstated } from "../../src/interpreter/selector.ts";
import { leadDispatchesPerDecision } from "../../src/adapters/postgres/schema/migrations/064-multi-dispatch-delivery.ts";
import type { SelectorProjectSettingsRecord } from "../../src/interpreter/selectorProjectSettings.ts";
import {
  postgresHarnessDenial,
  postgresHarnessPartition,
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
    changes: [],
    operationalContext: postgresHarnessSelectorContext,
    handoffNote: {},
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
      { written: "Refused", refusal: "AutomaticDispatchUnavailable" },
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
            handoffNote: {},
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
          handoffNote: {},
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

/** One held client dressed as a pool, so a case can keep a write uncommitted. */
function clientPool(client: pg.PoolClient): pg.Pool {
  return {
    query: (...parameters: readonly unknown[]) =>
      (
        client.query as unknown as (
          ...args: readonly unknown[]
        ) => Promise<unknown>
      )(...parameters),
  } as unknown as pg.Pool;
}

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

test("a stale fence is answered as one whatever the policy host is doing", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-stale-fence-refusal",
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
      await store.write(
        partition,
        0,
        { dispatchMode: "Automatic" },
        administrator,
      ),
      { written: "FenceMoved" },
    );
    assert.equal((await store.read(partition)).overrides.northStar, "First.");
    assert.deepEqual(
      await store.write(
        partition,
        1,
        { dispatchMode: "Automatic" },
        administrator,
      ),
      { written: "Refused", refusal: "AutomaticDispatchUnavailable" },
    );
  } finally {
    await pool.end();
  }
});

test("a fence lost to an uncommitted write is still answered as a fence", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-uncommitted-fence",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    assert.equal(
      writtenSettings(
        await postgresSelectorProjectSettings(clientPool(holder)).write(
          partition,
          0,
          { northStar: "First, and not yet committed." },
          administrator,
        ),
      ).revision,
      1,
    );
    const raced = store.write(
      partition,
      0,
      { dispatchMode: "Automatic" },
      administrator,
    );
    assert.equal(
      await Promise.race([
        raced.then(() => "answered"),
        delay(500).then(() => "waiting"),
      ]),
      "waiting",
    );
    await holder.query("COMMIT");
    assert.deepEqual(await raced, { written: "FenceMoved" });
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
    await pool.end();
  }
});

test("a ready policy host changes what a write may set and not what a fence says", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-ready-host",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const servicePool = postgresHarnessRolePool(selectorServiceRole);
  const store = postgresSelectorProjectSettings(pool);
  try {
    assert.equal(
      writtenSettings(
        await store.write(partition, 0, { northStar: "First." }, administrator),
      ).revision,
      1,
    );
    await postgresSelectorState(servicePool).setAutomaticReadiness(true);
    assert.deepEqual(
      await store.write(
        partition,
        0,
        { dispatchMode: "Automatic" },
        administrator,
      ),
      { written: "FenceMoved" },
    );
    assert.equal(
      writtenSettings(
        await store.write(
          partition,
          1,
          { dispatchMode: "Automatic" },
          administrator,
        ),
      ).effective.dispatchMode,
      "Automatic",
    );
  } finally {
    await postgresSelectorState(servicePool)
      .setAutomaticReadiness(false)
      .catch(() => undefined);
    await servicePool.end();
    await pool.end();
  }
});

test("two projects whose identities spell the same thing do not share a lock", async () => {
  const tenant = postgresHarnessPartition("selector-lock-key").tenant;
  const left = { tenant: asTenantId(`${tenant}/a`), project: asProjectId("b") };
  const right = { tenant: asTenantId(tenant), project: asProjectId("a/b") };
  for (const scope of [left, right]) await harness.store.createProject(scope);
  const pool = postgresHarnessRolePool(apiRole);
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    assert.equal(
      writtenSettings(
        await postgresSelectorProjectSettings(clientPool(holder)).write(
          left,
          0,
          { northStar: "Holding the lock." },
          administrator,
        ),
      ).revision,
      1,
    );
    const other = postgresSelectorProjectSettings(pool).write(
      right,
      0,
      { northStar: "Not the same project." },
      administrator,
    );
    assert.equal(
      await Promise.race([
        other.then(() => "answered"),
        delay(500).then(() => "waiting"),
      ]),
      "answered",
    );
    assert.equal(writtenSettings(await other).revision, 1);
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
    await pool.end();
  }
});

test("a write that gives up waiting says so rather than reading as a fault", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-contended-write",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const holder = await pool.connect();
  const impatient = await pool.connect();
  try {
    await holder.query("BEGIN");
    await postgresSelectorProjectSettings(clientPool(holder)).write(
      partition,
      0,
      { northStar: "Holding the lock." },
      administrator,
    );
    await impatient.query("SET statement_timeout='200ms'");
    assert.deepEqual(
      await postgresSelectorProjectSettings(clientPool(impatient)).write(
        partition,
        0,
        { northStar: "Waiting behind it." },
        administrator,
      ),
      { written: "Refused", refusal: "SettingsWriteContended" },
    );
  } finally {
    await impatient
      .query("SET statement_timeout=DEFAULT")
      .catch(() => undefined);
    impatient.release();
    await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
    await pool.end();
  }
});

/**
 * Two writes that each hold what the other is waiting for. The server breaks
 * the cycle by refusing one of them, and which one it picks is its own choice.
 */
test("a deadlock between two projects' writes is a contention the caller is told about", async () => {
  const left = await postgresHarnessProject(
    harness.store,
    "selector-deadlock-l",
  );
  const right = await postgresHarnessProject(
    harness.store,
    "selector-deadlock-r",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const holder = await pool.connect();
  const other = await pool.connect();
  try {
    const mine = postgresSelectorProjectSettings(clientPool(holder));
    const theirs = postgresSelectorProjectSettings(clientPool(other));
    await holder.query("BEGIN");
    await other.query("BEGIN");
    await mine.write(left, 0, { northStar: "Mine." }, administrator);
    await theirs.write(right, 0, { northStar: "Theirs." }, administrator);
    const reaching = mine.write(
      right,
      0,
      { northStar: "Reaching across." },
      administrator,
    );
    const reachingBack = theirs.write(
      left,
      0,
      { northStar: "Reaching back." },
      administrator,
    );
    const victim = await Promise.race([
      reaching.then((outcome) => ({ held: holder, outcome })),
      reachingBack.then((outcome) => ({ held: other, outcome })),
    ]);
    assert.deepEqual(victim.outcome, {
      written: "Refused",
      refusal: "SettingsWriteContended",
    });
    await victim.held.query("ROLLBACK");
    await Promise.allSettled([reaching, reachingBack]);
  } finally {
    for (const held of [holder, other]) {
      await held.query("ROLLBACK").catch(() => undefined);
      held.release();
    }
    await pool.end();
  }
});

/**
 * The override door and the columns behind it, held to each other: a key the
 * door accepts and no column stores is an override a caller was told was
 * written and no decision ever runs under. The roster is read from the schema
 * rather than listed here, so a key added to the door without a column reds
 * this.
 */
test("every limit the override door accepts is a column that reads back", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-limit-roster",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  const accepted = Object.keys(
    (
      selectorProjectOverridesSchema.shape.limits.unwrap() as never as {
        readonly shape: Readonly<Record<string, unknown>>;
      }
    ).shape,
  );
  try {
    let revision = 0;
    for (const limit of accepted) {
      /** The one limit whose only legal value is one until multi-page tools land. */
      const value = limit === "candidatePagesPerDecision" ? 1 : 7;
      const written = writtenSettings(
        await store.write(
          partition,
          revision,
          { limits: { [limit]: value } },
          administrator,
        ),
      );
      revision = written.revision;
      assert.deepEqual(written.overrides.limits, { [limit]: value }, limit);
      assert.equal(
        (await store.read(partition)).overrides.limits?.[
          limit as keyof NonNullable<
            Awaited<ReturnType<typeof store.read>>["overrides"]["limits"]
          >
        ],
        value,
        limit,
      );
    }
    assert.ok(accepted.length > 0, "the door accepts no limit at all");
  } finally {
    await pool.end();
  }
});

/**
 * A controls row written before `dispatchesPerDecision` existed — a history
 * revision, or the row an installation held before its migration. It resolves
 * to the number the installation that wrote it could deliver, rather than
 * refusing the row and stopping the selector, and the seeded row states the
 * budget its own migration wrote.
 */
test("an installation whose controls never stated a dispatch budget reads the unstated one", async () => {
  const pool = postgresHarnessRolePool(selectorControlRole);
  const control = postgresSelectorRuntimeControl(pool);
  const stated = async (value: number) => {
    await harness.query(
      `UPDATE selector_runtime_settings SET controls=jsonb_set(
         controls::jsonb,'{limits,dispatchesPerDecision}',to_jsonb($1::bigint))::text
       WHERE singleton=1`,
      [value],
    );
  };
  try {
    assert.equal(
      (await control.settings()).limits.dispatchesPerDecision,
      leadDispatchesPerDecision,
    );
    await harness.query(
      `UPDATE selector_runtime_settings
          SET controls=(controls::jsonb #- '{limits,dispatchesPerDecision}')::text
        WHERE singleton=1`,
    );
    assert.equal(
      (await control.settings()).limits.dispatchesPerDecision,
      dispatchesPerDecisionUnstated,
    );
    await stated(dispatchesPerDecisionUnstated + 1);
    assert.equal(
      (await control.settings()).limits.dispatchesPerDecision,
      dispatchesPerDecisionUnstated + 1,
    );
  } finally {
    /** Every other suite in this database reads what its migration seeded. */
    await stated(leadDispatchesPerDecision);
    await pool.end();
  }
});

/**
 * The project's own dispatch budget: a column like every other override, so a
 * value no decision could run under is refused by the column rather than only
 * by the check in front of it, and clearing it puts the project back on the
 * installation default.
 */
test("a project's dispatch budget is a column, and a budget of none is not one", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-dispatch-budget",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  const write = (revision: number, dispatches: number | null) =>
    harness.query(
      `SELECT revision::text FROM update_selector_project_settings(
         $1,$2,$3,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$4,
         NULL,NULL,NULL,'User','selector-admin')`,
      [partition.tenant, partition.project, revision, dispatches],
    );
  try {
    await assert.rejects(
      () => write(0, 0),
      /selector_project_dispatches_are_positive/,
    );
    assert.deepEqual(await write(0, 5), [{ revision: "1" }]);
    const held = await store.read(partition);
    assert.equal(held.overrides.limits?.dispatchesPerDecision, 5);
    assert.equal(held.effective.limits.dispatchesPerDecision, 5);
    assert.deepEqual(
      await harness.query(
        `SELECT dispatches_per_decision::text AS budget
           FROM selector_project_settings_history
          WHERE tenant=$1 AND project=$2 ORDER BY revision`,
        [partition.tenant, partition.project],
      ),
      [{ budget: "5" }],
    );
    const cleared = writtenSettings(
      await store.write(partition, 1, {}, administrator),
    );
    assert.equal(cleared.overrides.limits, undefined);
    assert.equal(
      cleared.effective.limits.dispatchesPerDecision,
      leadDispatchesPerDecision,
    );
  } finally {
    await pool.end();
  }
});
