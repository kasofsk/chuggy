/**
 * Per-project thread settings against a real server: what a project that set
 * nothing reads, what it overrides, the revision fence the write stands on,
 * and the roles that may reach any of it.
 */

import assert from "node:assert/strict";
import type pg from "pg";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  apiRole,
  selectorServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresSelectorProjectSettings } from "../../src/adapters/postgres/selectorProjectSettings.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { selectorProjectOverridesSchema } from "../../src/contract/requests.ts";
import { threadStandingRulesDefault } from "../../src/contract/threadSeeding.ts";
import type {
  SelectorProjectOverrides,
  SelectorProjectSettingsRecord,
} from "../../src/interpreter/selectorProjectSettings.ts";
import {
  postgresHarnessDenial,
  postgresHarnessPartition,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  postgresHarnessStalled,
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

test("a project with no row of its own reads as revision zero under the default standing rules", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-inherits",
  );
  const pool = postgresHarnessRolePool(apiRole);
  try {
    const standing =
      await postgresSelectorProjectSettings(pool).read(partition);
    assert.deepEqual(standing, {
      settings: {
        partition,
        revision: 0,
        overrides: {},
        effective: { threadStandingRules: threadStandingRulesDefault },
      },
    });
  } finally {
    await pool.end();
  }
});

/**
 * The standing rules a project's threads act under are a column like every
 * other override, and the installation holds no row for them: a project that
 * clears the override runs its threads under the code default again.
 */
test("a project's thread standing rules survive the write, the history and a clearing", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-thread-standing-rules",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  const standingRules = "- You draft, and nothing else.";
  try {
    const written = writtenSettings(
      await store.write(
        partition,
        0,
        { threadStandingRules: standingRules },
        administrator,
      ),
    );
    assert.equal(written.overrides.threadStandingRules, standingRules);
    assert.equal(written.effective.threadStandingRules, standingRules);
    assert.equal(
      (await store.read(partition)).settings.overrides.threadStandingRules,
      standingRules,
    );
    assert.deepEqual(
      (await store.history(partition, undefined, 10)).map(
        (revision) => revision.overrides.threadStandingRules,
      ),
      [standingRules],
    );

    const cleared = writtenSettings(
      await store.write(partition, 1, {}, administrator),
    );
    assert.equal(cleared.overrides.threadStandingRules, undefined);
    assert.equal(
      cleared.effective.threadStandingRules,
      threadStandingRulesDefault,
    );
  } finally {
    await pool.end();
  }
});

test("a project's four thread settings survive the whole-value write", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-north-star",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  const overrides = {
    northStar:
      "Every ticket in this project moves the console to general availability.",
    threadStandingRules: "- You draft, and nothing else.",
    threadModel: "opus",
    threadEffort: "high",
  } as const;
  try {
    const settings = writtenSettings(
      await store.write(partition, 0, overrides, administrator),
    );
    assert.equal(settings.revision, 1);
    assert.deepEqual(settings.overrides, overrides);
    assert.deepEqual(settings.effective, {
      northStar: overrides.northStar,
      threadStandingRules: overrides.threadStandingRules,
    });
    assert.deepEqual((await store.read(partition)).settings, settings);
    const cleared = writtenSettings(
      await store.write(
        partition,
        1,
        { northStar: "Ship the console." },
        administrator,
      ),
    );
    assert.equal(cleared.revision, 2);
    assert.deepEqual(cleared.overrides, { northStar: "Ship the console." });
  } finally {
    await pool.end();
  }
});

/**
 * A caller that lost the fence is told the number it must write under and who
 * moved it there, so the read answers with the history row of the revision
 * standing rather than leaving the console a second round trip to make.
 */
test("the read names the administrator whose write the standing revision is", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-moved-by",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  const mover = {
    kind: asAuthorityKind("User"),
    subject: asAuthoritySubject("selector-mover"),
  };
  try {
    assert.equal((await store.read(partition)).movedBy, undefined);
    await store.write(partition, 0, { northStar: "First." }, administrator);
    await store.write(partition, 1, { northStar: "Moved." }, mover);
    const standing = await store.read(partition);
    assert.equal(standing.settings.revision, 2);
    assert.deepEqual(standing.movedBy?.administrator, mover);
    const [newest] = await store.history(partition, undefined, 10);
    assert.equal(newest?.revision, 2);
    assert.equal(standing.movedBy?.recordedAt, newest?.recordedAt);
  } finally {
    await pool.end();
  }
});

test("a history cursor answers only the revisions older than it, newest first", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-settings-history-cursor",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  try {
    for (const [revision, northStar] of ["1", "2", "3", "4"].entries())
      await store.write(partition, revision, { northStar }, administrator);
    const revisionsOf = async (before: number | undefined, limit: number) =>
      (await store.history(partition, before, limit)).map(
        (revision) => revision.revision,
      );
    assert.deepEqual(await revisionsOf(undefined, 2), [4, 3]);
    assert.deepEqual(await revisionsOf(3, 10), [2, 1]);
    assert.deepEqual(await revisionsOf(4, 1), [3]);
    assert.deepEqual(await revisionsOf(1, 10), []);
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
    assert.equal(
      (await store.read(partition)).settings.overrides.northStar,
      "First.",
    );
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
    const retained = await store.history(partition, undefined, 10);
    assert.deepEqual(
      retained.map((revision) => revision.revision),
      [2, 1],
    );
    assert.deepEqual(retained[1]?.overrides, { northStar: "First." });
    assert.deepEqual(retained[0]?.administrator, administrator);
    assert.equal(
      Number.isFinite(Date.parse(retained[0]?.recordedAt ?? "")),
      true,
    );
    const restored = writtenSettings(
      await store.write(
        partition,
        2,
        retained[1]?.overrides ?? {},
        administrator,
      ),
    );
    assert.equal(restored.overrides.northStar, "First.");
  } finally {
    await pool.end();
  }
});

test("the selector service never writes a project's settings nor reads who wrote them", async () => {
  assert.match(
    (await harness.attemptAs(
      selectorServiceRole,
      "UPDATE selector_project_settings SET north_star='forged'",
    )) ?? "",
    postgresHarnessDenial("selector_project_settings"),
  );
  assert.match(
    (await harness.attemptAs(
      selectorServiceRole,
      "SELECT administrator_kind FROM selector_project_settings_history",
    )) ?? "",
    postgresHarnessDenial("selector_project_settings_history"),
  );
  assert.match(
    (await harness.attemptAs(
      selectorServiceRole,
      "SELECT update_selector_project_thread_settings('t','p',0,NULL,NULL,NULL,NULL,'User','forged')",
    )) ?? "",
    /permission denied for function update_selector_project_thread_settings/u,
  );
});

test("the API administers a project's settings and not the installation's", async () => {
  assert.match(
    (await harness.attemptAs(
      apiRole,
      "SELECT update_selector_runtime_settings(0,'Paused',NULL,NULL,NULL,'User','forged')",
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
    assert.equal((await store.read(partition)).settings.revision, 3);
  } finally {
    await pool.end();
    await competitor.end();
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

/**
 * A write whose door answered a row with no revision is a server this code
 * does not know, and is refused rather than read as revision zero.
 */
test("a write answering no revision is refused, not resolved", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-write-half-answer",
  );
  await assert.rejects(
    () =>
      postgresSelectorProjectSettings(
        stubbedPool([
          {
            revision: null,
            north_star: "Ship the console.",
            thread_standing_rules: null,
            thread_model: null,
            thread_effort: null,
          },
        ]),
      ).write(partition, 0, {}, administrator),
    /selector settings write answered no revision/u,
  );
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
      { northStar: "Second, behind the uncommitted one." },
      administrator,
    );
    await postgresHarnessStalled(harness.pool, 1);
    await holder.query("COMMIT");
    assert.deepEqual(await raced, { written: "FenceMoved" });
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
    await pool.end();
  }
});

/** How long a case gives a write that must not wait on a lock to answer, and how often it asks whether the write is waiting on one. */
const unblockedWaitMsMax = 10_000;
const unblockedAskMs = 25;

/** Whether a write answered, or was found waiting on a lock the backend `holder` holds, whichever came first; neither by the bound is a failure of its own. */
async function answeredOrBlocked(
  write: Promise<unknown>,
  holder: number,
): Promise<"answered" | "waiting"> {
  let answered = false;
  void write.then(
    () => (answered = true),
    () => (answered = true),
  );
  const deadline = Date.now() + unblockedWaitMsMax;
  while (Date.now() < deadline) {
    if (answered) return "answered";
    const [found] = await harness.query(
      `SELECT count(*)::int AS blocked FROM pg_stat_activity
        WHERE $1 = ANY(pg_blocking_pids(pid))`,
      [holder],
    );
    if (Number(found?.["blocked"]) > 0) return "waiting";
    await delay(unblockedAskMs);
  }
  throw new Error(
    "the write neither answered nor was seen waiting on the holder's lock",
  );
}

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
    const [held] = (await holder.query("SELECT pg_backend_pid() AS pid"))
      .rows as { pid: number }[];
    const other = postgresSelectorProjectSettings(pool).write(
      right,
      0,
      { northStar: "Not the same project." },
      administrator,
    );
    assert.equal(await answeredOrBlocked(other, held?.pid ?? 0), "answered");
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
 * written and no thread ever runs under. The roster is read from the schema
 * rather than listed here, so a key added to the door without a column reds
 * this.
 */
test("every field the override door accepts is a column that reads back", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-field-roster",
  );
  const pool = postgresHarnessRolePool(apiRole);
  const store = postgresSelectorProjectSettings(pool);
  const values: Readonly<Record<string, string>> = {
    northStar: "Ship the console.",
    threadStandingRules: "- You draft, and nothing else.",
    threadModel: "opus",
    threadEffort: "high",
  };
  const accepted = Object.keys(selectorProjectOverridesSchema.shape);
  try {
    let revision = 0;
    for (const field of accepted) {
      const overrides = selectorProjectOverridesSchema.parse({
        [field]: values[field],
      }) as SelectorProjectOverrides;
      const written = writtenSettings(
        await store.write(partition, revision, overrides, administrator),
      );
      revision = written.revision;
      assert.deepEqual(written.overrides, overrides, field);
      assert.deepEqual(
        (await store.read(partition)).settings.overrides,
        overrides,
        field,
      );
    }
    assert.ok(accepted.length > 0, "the door accepts no field at all");
  } finally {
    await pool.end();
  }
});

/** The override columns the thread write does not name, as `update_selector_project_settings` could set them. */
const selectorUnnamedColumns = [
  "mode",
  "dispatch_mode",
  "base_prompt",
  "model_allowlist",
  "tool_allowlist",
  "tokens_per_decision",
  "milliseconds_per_decision",
  "tool_calls_per_decision",
  "dispatches_per_decision",
  "input_bytes_per_decision",
  "candidate_pages_per_decision",
  "auto_compact_window",
  "operational_context_max_age_ms",
  "lead_model",
  "lead_effort",
] as const;

/**
 * A row the old door wrote may hold overrides nothing reads any more. The
 * thread write replaces the whole override set, so it clears them in the row
 * and in the history revision it records, rather than carrying them forward
 * unseen.
 */
test("a thread settings write clears every override the old door could set", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "selector-clears-old-overrides",
  );
  await harness.query(
    `SELECT update_selector_project_settings($1,$2,0,'Old.',NULL,'Paused',
       'ApprovalRequired','Select one.','["*"]','["*"]',1,1,1,1,1,1,100000,1,
       'sonnet','low',NULL,NULL,'User','selector-admin')`,
    [partition.tenant, partition.project],
  );
  const pool = postgresHarnessRolePool(apiRole);
  try {
    const written = writtenSettings(
      await postgresSelectorProjectSettings(pool).write(
        partition,
        1,
        { northStar: "New." },
        administrator,
      ),
    );
    assert.equal(written.revision, 2);
    assert.deepEqual(written.overrides, { northStar: "New." });
    for (const table of [
      "selector_project_settings",
      "selector_project_settings_history",
    ]) {
      const [row] = await harness.query(
        `SELECT ${selectorUnnamedColumns.join(",")} FROM ${table}
          WHERE tenant=$1 AND project=$2 AND revision=2`,
        [partition.tenant, partition.project],
      );
      assert.ok(row !== undefined, table);
      for (const column of selectorUnnamedColumns)
        assert.equal(row[column], null, `${table}.${column}`);
    }
  } finally {
    await pool.end();
  }
});
