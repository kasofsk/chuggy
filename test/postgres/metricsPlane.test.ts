/**
 * The metrics plane's page against a real server, read as the plane's own
 * role: what each family totals to across two projects and their owners, the
 * owner as the bare subject, a scrape past its bounds refused whole, and
 * readiness only under that role.
 *
 * THE ROWS ARE WRITTEN DIRECTLY, AS THE OWNER, WITH REFERENTIAL CHECKS SET
 * ASIDE FOR THE SEEDING TRANSACTION. They are the rows a scheduler, a worker
 * plane and a session plane leave behind, and what is under test is what the
 * plane reads from them, not how they came to be written; every row still
 * meets its relation's own checks.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { createMetricsPlaneApp } from "../../src/adapters/http/metricsPlaneServer.ts";
import {
  postgresMetricsPlaneReads,
  postgresMetricsPlaneReady,
} from "../../src/adapters/postgres/metricsPlane.ts";
import {
  postgresLimitsDefault,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";
import {
  apiRole,
  metricsPlaneRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import { metricsPlane } from "../../src/interpreter/metricsPlane.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessOpen,
  postgresHarnessRolePool,
  postgresHarnessRoleUrl,
  type PostgresHarness,
} from "./harness.ts";

const issuer = "https://issuer.metrics.test";
const alice = oidcPrincipal(issuer, "alice-id");
const bob = oidcPrincipal(issuer, "bob-id");
const selector = oidcPrincipal(issuer, "selector-service");
const foreign = oidcPrincipal("https://another.issuer.test", "carol-id");

/** A catalog whose work runs an agent and whose plan runs commands, then a review. */
const catalog = {
  version: 2,
  image: "worker:v2",
  workloads: {
    build: {
      runner: "Agent",
      prompt: { text: "Build what the ticket asks." },
      worker: {
        mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
        setup: [],
        files: [],
      },
    },
    review: {
      runner: "Agent",
      purpose: "Review",
      prompt: { text: "Review the change." },
      worker: {
        mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
        setup: [],
        files: [],
      },
    },
    tests: { runner: "Commands", commands: ["npm test"] },
  },
  plans: {
    standard: [
      { name: "checks", evaluators: ["tests"] },
      { name: "review", evaluators: ["review"] },
    ],
  },
  defaults: { work: "build", evaluation: "standard" },
};

const one = { tenant: "metrics-one", project: "web" };
const two = { tenant: "metrics-two", project: "api" };

let harness: PostgresHarness;
let plane: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  plane = postgresHarnessRolePool(metricsPlaneRole);
  await metricsSeeded();
});
after(async () => {
  await plane.end();
  await harness.close();
});

interface MetricsExecution {
  readonly partition: { readonly tenant: string; readonly project: string };
  readonly execution: string;
  readonly owner: string | null;
  readonly revision: string;
  readonly task: number;
  readonly stage: number | null;
  readonly placement: "InCluster" | "Pool";
}

/** One execution and the request task it ran. */
async function metricsExecution(
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>,
  seeded: MetricsExecution,
): Promise<void> {
  const { tenant, project } = seeded.partition;
  await query(
    `INSERT INTO execution_request_task (tenant,project,request,task,kind,stage,cycle,generation,evaluator)
     VALUES ($1,$2,'request',$3,$4,$5,1,$6,$6)`,
    [
      tenant,
      project,
      seeded.task,
      seeded.stage === null ? "Work" : "Evaluation",
      seeded.stage,
      seeded.stage === null ? null : 1,
    ],
  );
  await query(
    `INSERT INTO execution (tenant,project,execution,ticket,task,source_request,account,cluster,
       configuration_revision,configuration_digest,requirement_identity,requirement_value,
       requirement_digest,requirement_source,platform_default_version,owner,placement)
     VALUES ($1,$2,$3,1,$4,'request','account','cluster',$5,'digest','requirement-' || $3,'{}',
       'digest','TicketDefault',1,$6,$7)`,
    [
      tenant,
      project,
      seeded.execution,
      seeded.task,
      seeded.revision,
      seeded.owner,
      seeded.placement,
    ],
  );
}

/** One attempt of an execution, ended `secs` after it opened where it has ended, and held by a pool where its execution is. */
async function metricsAttempt(
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>,
  seeded: MetricsExecution,
  attempt: string,
  state: string,
  secs: number | null,
  personal = false,
): Promise<void> {
  const pooled = seeded.placement === "Pool";
  await query(
    `INSERT INTO execution_attempt (tenant,project,execution,attempt,attempt_number,recovery_epoch,
       state,opened_at,ended_at,capability,manifest,pool,pool_principal,assignment,personal)
     VALUES ($1,$2,$3,$4,
       (SELECT count(*)+1 FROM execution_attempt WHERE tenant=$1 AND project=$2 AND execution=$3),
       'epoch',$5,'2026-01-01T00:00:00Z',
       '2026-01-01T00:00:00Z'::timestamptz + make_interval(secs => $6::float8),
       'capability-' || $4,'manifest-' || $4,$7,$7,$8,$9)`,
    [
      seeded.partition.tenant,
      seeded.partition.project,
      seeded.execution,
      attempt,
      state,
      secs,
      pooled ? (personal ? alice : "pool") : null,
      pooled ? `assignment-${attempt}` : null,
      personal,
    ],
  );
}

async function metricsRun(
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>,
  seeded: MetricsExecution,
  attempt: string,
  turns: number,
  durationMs: number,
  durationApiMs: number,
): Promise<void> {
  await query(
    `INSERT INTO execution_run_total (tenant,project,execution,attempt,turns,duration_ms,
       duration_api_ms,tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,
       cost_usd_micros,cost_basis,permission_denials)
     VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,0,0,0,'List',0)`,
    [
      seeded.partition.tenant,
      seeded.partition.project,
      seeded.execution,
      attempt,
      turns,
      durationMs,
      durationApiMs,
    ],
  );
}

async function metricsModel(
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>,
  seeded: MetricsExecution,
  attempt: string,
  model: string,
  tokens: readonly [number, number, number, number],
  costMicros: number,
): Promise<void> {
  await query(
    `INSERT INTO execution_run_model_usage (tenant,project,execution,attempt,model,tokens_input,
       tokens_output,tokens_cache_creation,tokens_cache_read,cost_usd_micros)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      seeded.partition.tenant,
      seeded.partition.project,
      seeded.execution,
      attempt,
      model,
      ...tokens,
      costMicros,
    ],
  );
}

/** One session and its turns, each `[state, model, tokens, cost, duration]` with the model absent on an unmeasured one. */
async function metricsSession(
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>,
  partition: { readonly tenant: string; readonly project: string },
  session: string,
  kind: string,
  principal: string,
  turns: readonly (readonly [string, string | null, number, number, number])[],
): Promise<void> {
  await query(
    `INSERT INTO agent_session (tenant,project,session,kind,principal,capabilities,credential_slot,account,cluster)
     VALUES ($1,$2,$3,$4,$5,'{}','slot','account','cluster')`,
    [partition.tenant, partition.project, session, kind, principal],
  );
  for (const [
    ordinal,
    [state, model, tokens, cost, duration],
  ] of turns.entries())
    await query(
      `INSERT INTO session_turn (tenant,project,session,turn,ordinal,input_kind,input,route,
         state,result,failure,ended_at,model,tokens,cost_micros,duration_ms,tools)
       VALUES ($1,$2,$3,$4,$5,'UserMessage','hello','InCluster',$6,
         CASE WHEN $6='Answered' THEN 'done' END,
         CASE WHEN $6 IN ('Failed','Abandoned') THEN 'AgentFailed' END,
         CASE WHEN $6 IN ('Answered','Failed','Abandoned') THEN now() END,
         $7,$8,$9,$10,CASE WHEN $7::text IS NULL THEN NULL ELSE '{}'::text[] END)`,
      [
        partition.tenant,
        partition.project,
        session,
        `${session}-turn-${String(ordinal + 1)}`,
        ordinal + 1,
        state,
        model,
        model === null ? null : tokens,
        model === null ? null : cost,
        model === null ? null : duration,
      ],
    );
}

const workOne: MetricsExecution = {
  partition: one,
  execution: "execution-work-one",
  owner: alice,
  revision: "revision-catalog",
  task: 1,
  stage: null,
  placement: "InCluster",
};
const checksOne: MetricsExecution = {
  partition: one,
  execution: "execution-checks-one",
  owner: alice,
  revision: "revision-catalog",
  task: 2,
  stage: 1,
  placement: "Pool",
};
const reviewOne: MetricsExecution = {
  partition: one,
  execution: "execution-review-one",
  owner: bob,
  revision: "revision-catalog",
  task: 3,
  stage: 2,
  placement: "InCluster",
};
const runningOne: MetricsExecution = {
  partition: one,
  execution: "execution-running-one",
  owner: null,
  revision: "revision-catalog",
  task: 4,
  stage: null,
  placement: "Pool",
};
const workTwo: MetricsExecution = {
  partition: two,
  execution: "execution-work-two",
  owner: foreign,
  revision: "revision-authored",
  task: 1,
  stage: null,
  placement: "InCluster",
};
const reviewTwo: MetricsExecution = {
  partition: two,
  execution: "execution-review-two",
  owner: null,
  revision: "revision-authored",
  task: 2,
  stage: 1,
  placement: "InCluster",
};

async function metricsSeeded(): Promise<void> {
  const seeding = await harness.begin();
  try {
    await metricsSeededIn(seeding.query);
  } catch (failure) {
    await seeding.rollback();
    throw failure;
  }
  await seeding.commit();
}

async function metricsSeededIn(
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>,
): Promise<void> {
  await query("SET LOCAL session_replication_role = replica");
  await query(
    `INSERT INTO configuration_revision (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
     VALUES ($1,$2,'revision-catalog',$3,'digest','Member','author'),
            ($4,$5,'revision-authored',$6,'digest','Member','author')`,
    [
      one.tenant,
      one.project,
      JSON.stringify(catalog),
      two.tenant,
      two.project,
      postgresHarnessConfiguration,
    ],
  );
  for (const seeded of [
    workOne,
    checksOne,
    reviewOne,
    runningOne,
    workTwo,
    reviewTwo,
  ])
    await metricsExecution(query, seeded);
  await metricsRunsSeeded(query);
  await metricsSessionsSeeded(query);
}

/** Each execution's attempts, and the runs and model usage of those that recorded one. */
async function metricsRunsSeeded(
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>,
): Promise<void> {
  await metricsAttempt(query, workOne, "attempt-work-one-a", "Lost", 10);
  await metricsAttempt(query, workOne, "attempt-work-one-b", "Reported", 45);
  await metricsRun(query, workOne, "attempt-work-one-b", 7, 40_000, 30_000);
  await metricsModel(
    query,
    workOne,
    "attempt-work-one-b",
    "model-large",
    [100, 50, 10, 5],
    250_000,
  );
  await metricsAttempt(
    query,
    checksOne,
    "attempt-checks-one",
    "Reported",
    200,
    true,
  );
  await metricsRun(query, checksOne, "attempt-checks-one", 0, 0, 0);
  await metricsAttempt(query, reviewOne, "attempt-review-one", "Reported", 100);
  await metricsRun(query, reviewOne, "attempt-review-one", 3, 9_000, 6_000);
  await metricsModel(
    query,
    reviewOne,
    "attempt-review-one",
    "model-large",
    [20, 10, 0, 0],
    40_000,
  );
  await metricsModel(
    query,
    reviewOne,
    "attempt-review-one",
    "model-small",
    [5, 5, 0, 0],
    1_000,
  );
  await metricsAttempt(
    query,
    runningOne,
    "attempt-running-one",
    "Running",
    null,
  );
  await metricsAttempt(query, workTwo, "attempt-work-two", "Reported", 3_000);
  await metricsRun(query, workTwo, "attempt-work-two", 1, 5_000, 4_000);
  await metricsModel(
    query,
    workTwo,
    "attempt-work-two",
    "model-small",
    [1, 2, 3, 4],
    500,
  );
  await metricsAttempt(
    query,
    reviewTwo,
    "attempt-review-two",
    "Withdrawn",
    8_000,
  );
}

/** The sessions' turns and the tickets, beside the runs. */
async function metricsSessionsSeeded(
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>,
): Promise<void> {
  await metricsSession(query, one, "session-lead", "Lead", selector, [
    ["Answered", "model-large", 1_000, 20_000, 45_000],
    ["Failed", null, 0, 0, 0],
    ["Queued", null, 0, 0, 0],
  ]);
  await metricsSession(query, two, "session-thread", "Thread", alice, [
    ["Answered", "model-small", 300, 3_000, 10_000],
  ]);
  await query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
     VALUES ($1,$2,1,'Work',1),($1,$2,2,'Work',2),($1,$2,3,'Done',3),($3,$4,1,'Pending',1)`,
    [one.tenant, one.project, two.tenant, two.project],
  );
}

/** The page the plane serves over `pool`, with its status. */
async function metricsPage(
  pool: pg.Pool,
  seriesMax = 10_000,
): Promise<{ readonly status: number; readonly body: string }> {
  const app = createMetricsPlaneApp({
    scrape: metricsPlane(postgresMetricsPlaneReads(pool), { issuer, seriesMax })
      .scrape,
    ready: () => postgresMetricsPlaneReady(pool, metricsPlaneRole),
  });
  try {
    const answered = await app.inject({ method: "GET", url: "/metrics" });
    return { status: answered.statusCode, body: answered.body };
  } finally {
    await app.close();
  }
}

/** Every sample line of a page, comments left out. */
function metricsSamples(body: string): readonly string[] {
  return body
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"));
}

const workLabels = `tenant="metrics-one",project="web",owner="alice-id",phase="Work",stage="",runner="Agent",placement="Cluster",workload="build"`;
const checksLabels = `tenant="metrics-one",project="web",owner="alice-id",phase="Evaluation",stage="checks",runner="Commands",placement="Personal",workload="tests"`;
const reviewLabels = `tenant="metrics-one",project="web",owner="bob-id",phase="Evaluation",stage="review",runner="Agent",placement="Cluster",workload="review"`;
const authoredLabels = `tenant="metrics-two",project="api",owner="",phase="Work",stage="",runner="Agent",placement="Cluster",workload=""`;
const authoredReviewLabels = `tenant="metrics-two",project="api",owner="",phase="Evaluation",stage="1",runner="Agent",placement="Cluster",workload=""`;

test("every ended attempt is counted under what ran it and whose ticket it was, the owner its bare subject", async () => {
  const page = await metricsPage(plane);
  assert.equal(page.status, 200);
  const samples = metricsSamples(page.body);
  for (const expected of [
    `chuggy_attempts_ended_total{${workLabels},state="Lost"} 1`,
    `chuggy_attempts_ended_total{${workLabels},state="Reported"} 1`,
    `chuggy_attempts_ended_total{${checksLabels},state="Reported"} 1`,
    `chuggy_attempts_ended_total{${reviewLabels},state="Reported"} 1`,
    `chuggy_attempts_ended_total{${authoredLabels},state="Reported"} 1`,
    `chuggy_attempts_ended_total{${authoredReviewLabels},state="Withdrawn"} 1`,
  ])
    assert.ok(samples.includes(expected), expected);
  assert.equal(
    samples.filter((line) => line.startsWith("chuggy_attempts_ended_total"))
      .length,
    6,
    "a running attempt has not ended",
  );
  assert.doesNotMatch(page.body, /execution-|attempt-|session-|\bpool\b/u);
});

test("an attempt's duration is a histogram whose buckets count everything at or below them", async () => {
  const samples = metricsSamples((await metricsPage(plane)).body);
  for (const expected of [
    `chuggy_attempt_duration_seconds_bucket{${workLabels},le="30"} 1`,
    `chuggy_attempt_duration_seconds_bucket{${workLabels},le="60"} 2`,
    `chuggy_attempt_duration_seconds_bucket{${workLabels},le="7200"} 2`,
    `chuggy_attempt_duration_seconds_bucket{${workLabels},le="+Inf"} 2`,
    `chuggy_attempt_duration_seconds_sum{${workLabels}} 55`,
    `chuggy_attempt_duration_seconds_count{${workLabels}} 2`,
    `chuggy_attempt_duration_seconds_bucket{${authoredLabels},le="2700"} 0`,
    `chuggy_attempt_duration_seconds_bucket{${authoredLabels},le="3600"} 1`,
    `chuggy_attempt_duration_seconds_bucket{${authoredReviewLabels},le="7200"} 0`,
    `chuggy_attempt_duration_seconds_bucket{${authoredReviewLabels},le="+Inf"} 1`,
  ])
    assert.ok(samples.includes(expected), expected);
});

test("runs total their turns, durations, tokens and cost per model", async () => {
  const samples = metricsSamples((await metricsPage(plane)).body);
  for (const expected of [
    `chuggy_run_turns_total{${workLabels}} 7`,
    `chuggy_run_turns_total{${checksLabels}} 0`,
    `chuggy_run_turns_total{${reviewLabels}} 3`,
    `chuggy_run_duration_seconds_total{${workLabels}} 40`,
    `chuggy_run_api_duration_seconds_total{${workLabels}} 30`,
    `chuggy_run_duration_seconds_total{${authoredLabels}} 5`,
    `chuggy_run_tokens_total{${workLabels},model="model-large",type="input"} 100`,
    `chuggy_run_tokens_total{${workLabels},model="model-large",type="output"} 50`,
    `chuggy_run_tokens_total{${workLabels},model="model-large",type="cache_creation"} 10`,
    `chuggy_run_tokens_total{${workLabels},model="model-large",type="cache_read"} 5`,
    `chuggy_run_tokens_total{${reviewLabels},model="model-small",type="input"} 5`,
    `chuggy_run_cost_usd_total{${workLabels},model="model-large"} 0.25`,
    `chuggy_run_cost_usd_total{${reviewLabels},model="model-large"} 0.04`,
    `chuggy_run_cost_usd_total{${reviewLabels},model="model-small"} 0.001`,
    `chuggy_run_cost_usd_total{${authoredLabels},model="model-small"} 0.0005`,
  ])
    assert.ok(samples.includes(expected), expected);
});

test("session turns are counted by session kind and state, and measured ones spend per model", async () => {
  const samples = metricsSamples((await metricsPage(plane)).body);
  const lead = `tenant="metrics-one",project="web",owner="selector-service",session="Lead"`;
  const thread = `tenant="metrics-two",project="api",owner="alice-id",session="Thread"`;
  for (const expected of [
    `chuggy_session_turns_ended_total{${lead},state="Answered"} 1`,
    `chuggy_session_turns_ended_total{${lead},state="Failed"} 1`,
    `chuggy_session_turns_ended_total{${thread},state="Answered"} 1`,
    `chuggy_session_turn_tokens_total{${lead},model="model-large"} 1000`,
    `chuggy_session_turn_cost_usd_total{${lead},model="model-large"} 0.02`,
    `chuggy_session_turn_cost_usd_total{${thread},model="model-small"} 0.003`,
    `chuggy_session_turn_duration_seconds_bucket{${lead},le="30"} 0`,
    `chuggy_session_turn_duration_seconds_bucket{${lead},le="60"} 1`,
    `chuggy_session_turn_duration_seconds_count{${lead}} 1`,
    `chuggy_session_turn_duration_seconds_sum{${thread}} 10`,
  ])
    assert.ok(samples.includes(expected), expected);
  assert.ok(!samples.some((line) => line.includes('state="Queued"')));
});

test("each project's tickets are a gauge per phase", async () => {
  const samples = metricsSamples((await metricsPage(plane)).body);
  for (const expected of [
    `chuggy_tickets{tenant="metrics-one",project="web",phase="Work"} 2`,
    `chuggy_tickets{tenant="metrics-one",project="web",phase="Done"} 1`,
    `chuggy_tickets{tenant="metrics-two",project="api",phase="Pending"} 1`,
  ])
    assert.ok(samples.includes(expected), expected);
});

test("a page past the series it may carry is refused whole, and so is a family past its rows", async () => {
  const whole = metricsSamples((await metricsPage(plane)).body).length;
  const refused = await metricsPage(plane, 20);
  assert.equal(refused.status, 503);
  assert.doesNotMatch(refused.body, /chuggy_/u);
  assert.deepEqual(
    await metricsPlane(postgresMetricsPlaneReads(plane), {
      issuer,
      seriesMax: 20,
    }).scrape(),
    {
      scraped: "Refused",
      why: `the page would carry ${String(whole)} series, past the cap of 20`,
    },
  );
  assert.deepEqual(await postgresMetricsPlaneReads(plane).read(1), {
    read: "Refused",
    why: "a family read more than 1 rows, the cap on the series one page carries",
  });
});

test("a scrape whose read does not finish within the statement timeout is refused whole", async () => {
  const bounded = postgresPool(
    postgresHarnessRoleUrl(metricsPlaneRole).toString(),
    { ...postgresLimitsDefault, statementTimeoutMs: 200 },
  );
  const holding = await harness.begin();
  try {
    await holding.query(
      "LOCK TABLE ticket_projection IN ACCESS EXCLUSIVE MODE",
    );
    const page = await metricsPage(bounded);
    assert.equal(page.status, 503);
    assert.doesNotMatch(page.body, /chuggy_/u);
  } finally {
    await holding.rollback();
    await bounded.end();
  }
});

test("the plane is ready under its own role and under no other", async () => {
  assert.equal(await postgresMetricsPlaneReady(plane, metricsPlaneRole), true);
  const api = postgresHarnessRolePool(apiRole);
  try {
    assert.equal(await postgresMetricsPlaneReady(api, metricsPlaneRole), false);
    const app = createMetricsPlaneApp({
      scrape: metricsPlane(postgresMetricsPlaneReads(api), {
        issuer,
        seriesMax: 10_000,
      }).scrape,
      ready: () => postgresMetricsPlaneReady(api, metricsPlaneRole),
    });
    try {
      assert.equal(
        (await app.inject({ method: "GET", url: "/health/ready" })).statusCode,
        503,
      );
    } finally {
      await app.close();
    }
  } finally {
    await api.end();
  }
});
