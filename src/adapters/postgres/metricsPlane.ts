/**
 * The metrics plane's read: every family aggregated by the server, under one
 * snapshot and one bound on the whole scrape.
 *
 * EVERY FAMILY IS GROUPED BY ITS LABELS, so a row read is a series served and
 * the cap on a page's series is applied to what the server returns, before it
 * is parsed. A family past it is a refusal, never a truncation.
 *
 * WHAT RAN A TASK IS DERIVED, AS THE OPERATIONAL READS DERIVE IT, from the
 * revision its execution pinned and its ticket's selection and overrides: the
 * runner, an evaluation stage's name, and a catalog task's workload. No query
 * can make that derivation, so the scrape is several statements in one
 * snapshot. The first reads each distinct task shape, the revisions they
 * pinned and the distinct principals; each shape is labelled once and each
 * principal named once; the rest group every family by those labels. A
 * version 1 configuration names no stage and no workload, so its stage is its
 * number and its workload is empty; a revision no reader can read leaves the
 * runner empty too.
 *
 * THE BOUND IS ON THE WHOLE SCRAPE, NOT ON THE HISTORY IT READS. Each
 * statement runs under what is left of it, and the labelling between them
 * stops once it has passed, so a scrape refused for time is one whose reads
 * did not finish within the bound and never one whose history grew past a
 * count.
 *
 * EACH COUNTER'S AND HISTOGRAM'S SERIES BEGAN WHEN ITS FIRST ROW'S ATTEMPT OR
 * TURN ENDED, an aggregate in the statement that sums it. A run's totals carry
 * no time a reader is granted, so a run is counted once its attempt has ended
 * and its series began when the first such attempt did.
 *
 * A PERSONAL RUNNER'S ATTEMPT IS `Personal`, A POOL'S `Pool`, AN IN-CLUSTER ONE
 * `Cluster`. The execution's placement says pool or cluster and the attempt's
 * `personal` tells a member's runner from a pool.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import { z } from "zod";

import { taskPurposeForKind } from "../../interpreter/executionScheduler.ts";
import {
  metricsPlaneDurationBoundsSecs,
  type MetricsPlaneBounds,
  type MetricsPlaneAttemptRow,
  type MetricsPlaneModelRow,
  type MetricsPlaneRead,
  type MetricsPlaneReads,
  type MetricsPlaneRunRow,
  type MetricsPlaneRows,
  type MetricsPlaneTask,
  type MetricsPlaneTurnRow,
} from "../../interpreter/metricsPlane.ts";
import {
  authoredTaskConfigurationReadiness,
  briefingStageCarrier,
} from "../../interpreter/taskBriefing.ts";
import { declaredConfigurationVersion } from "../../interpreter/workloadConfiguration.ts";
import {
  catalogNamedWorkloadTask,
  workloadTaskPositionOf,
} from "../../interpreter/workloadTask.ts";
import { storedOverridesOf, storedSelectionOf } from "./ticketBrief.ts";

const metricsPlaneFigure = z.string().transform((value, context) => {
  const figure = Number(value);
  if (!Number.isFinite(figure)) {
    context.addIssue({ code: "custom", message: "not a finite figure" });
    return z.NEVER;
  }
  return figure;
});

/** A bucket's index into the bounds, or one past them, and how many fell in it. */
const metricsPlaneBucketsSchema = z
  .record(z.string(), z.number().int().nonnegative())
  .transform((counts, context) => {
    const buckets = [...metricsPlaneDurationBoundsSecs, Infinity].map(() => 0);
    for (const [index, count] of Object.entries(counts)) {
      const at = Number(index);
      if (!Number.isSafeInteger(at) || at < 0 || at >= buckets.length) {
        context.addIssue({ code: "custom", message: `no bucket ${index}` });
        return z.NEVER;
      }
      buckets[at] = count;
    }
    return buckets;
  });

const metricsPlaneShapeSchema = z.object({
  key: z.string(),
  tenant: z.string(),
  project: z.string(),
  revision: z.string(),
  kind: z.enum(["Work", "Evaluation"]),
  stage: z.string().nullable(),
  evaluator: z.string().nullable(),
  selection: z.string().nullable(),
  overrides: z.string().nullable(),
});

type MetricsPlaneShape = z.output<typeof metricsPlaneShapeSchema>;

const metricsPlaneRevisionSchema = z.object({
  tenant: z.string(),
  project: z.string(),
  revision: z.string(),
  canonical: z.string(),
});

const metricsPlaneTaskLabelsSchema = {
  tenant: z.string(),
  project: z.string(),
  owner: z.string(),
  phase: z.enum(["Work", "Evaluation"]),
  stage: z.string(),
  runner: z.enum(["Agent", "Commands", ""]),
  workload: z.string(),
  placement: z.enum(["Cluster", "Pool", "Personal"]),
};

const metricsPlaneAttemptSchema = z
  .object({
    ...metricsPlaneTaskLabelsSchema,
    state: z.string(),
    buckets: metricsPlaneBucketsSchema,
    ended: metricsPlaneFigure,
    secs: metricsPlaneFigure,
    created: metricsPlaneFigure,
  })
  .transform(
    ({
      state,
      buckets,
      ended,
      secs,
      created,
      ...task
    }): MetricsPlaneAttemptRow => ({
      task,
      state,
      buckets,
      ended,
      durationSecs: secs,
      createdSecs: created,
    }),
  );

const metricsPlaneRunSchema = z
  .object({
    ...metricsPlaneTaskLabelsSchema,
    turns: metricsPlaneFigure,
    duration_ms: metricsPlaneFigure,
    duration_api_ms: metricsPlaneFigure,
    created: metricsPlaneFigure,
  })
  .transform(
    ({
      turns,
      duration_ms,
      duration_api_ms,
      created,
      ...task
    }): MetricsPlaneRunRow => ({
      task,
      turns,
      durationMs: duration_ms,
      durationApiMs: duration_api_ms,
      createdSecs: created,
    }),
  );

const metricsPlaneModelSchema = z
  .object({
    ...metricsPlaneTaskLabelsSchema,
    model: z.string(),
    tokens_input: metricsPlaneFigure,
    tokens_output: metricsPlaneFigure,
    tokens_cache_creation: metricsPlaneFigure,
    tokens_cache_read: metricsPlaneFigure,
    cost_usd_micros: metricsPlaneFigure,
    created: metricsPlaneFigure,
  })
  .transform(
    ({
      model,
      tokens_input,
      tokens_output,
      tokens_cache_creation,
      tokens_cache_read,
      cost_usd_micros,
      created,
      ...task
    }): MetricsPlaneModelRow => ({
      task,
      model,
      tokensInput: tokens_input,
      tokensOutput: tokens_output,
      tokensCacheCreation: tokens_cache_creation,
      tokensCacheRead: tokens_cache_read,
      costUsdMicros: cost_usd_micros,
      createdSecs: created,
    }),
  );

const metricsPlaneTurnSchema = z
  .object({
    tenant: z.string(),
    project: z.string(),
    owner: z.string(),
    kind: z.enum(["Lead", "Thread", "Inquiry"]),
    state: z.string(),
    model: z.string().nullable(),
    buckets: metricsPlaneBucketsSchema.nullable(),
    ended: metricsPlaneFigure,
    tokens: metricsPlaneFigure,
    cost_micros: metricsPlaneFigure,
    duration_ms: metricsPlaneFigure,
    created: metricsPlaneFigure,
  })
  .transform(
    ({
      kind,
      model,
      buckets,
      cost_micros,
      duration_ms,
      created,
      ...row
    }): MetricsPlaneTurnRow => ({
      ...row,
      session: kind,
      model: model ?? undefined,
      buckets: buckets ?? undefined,
      costMicros: cost_micros,
      durationMs: duration_ms,
      createdSecs: created,
    }),
  );

const metricsPlaneTicketSchema = z.object({
  tenant: z.string(),
  project: z.string(),
  phase: z.string(),
  tickets: metricsPlaneFigure,
});

/** What the first statement reads: what every family's labels are derived from. */
interface MetricsPlaneSourcesRow {
  readonly shapes: string | null;
  readonly revisions: string | null;
  readonly principals: string | null;
}

/** What the second statement reads: the families of runs and their attempts. */
interface MetricsPlaneExecutionRow {
  readonly attempts: string | null;
  readonly runs: string | null;
  readonly models: string | null;
}

/** What the third statement reads: the families of session turns and tickets. */
interface MetricsPlaneSessionRow {
  readonly turns: string | null;
  readonly tickets: string | null;
}

/** Each task shape's labels, and each principal's owner, as the later statements join them back in. */
interface MetricsPlaneLabelling {
  readonly keys: readonly string[];
  readonly runners: readonly string[];
  readonly stages: readonly string[];
  readonly workloads: readonly string[];
  readonly principals: readonly string[];
  readonly owners: readonly string[];
}

function metricsPlaneParsed<Schema extends z.ZodType>(
  text: string | null,
  schema: Schema,
): readonly z.output<Schema>[] {
  return z
    .array(schema)
    .parse(text === null ? [] : (JSON.parse(text) as unknown));
}

/** One family's series, or none where it has more than `seriesMax`. */
function metricsPlaneFamilyRows<Schema extends z.ZodType>(
  text: string | null,
  schema: Schema,
  seriesMax: number,
): readonly z.output<Schema>[] | undefined {
  const rows = metricsPlaneParsed(text, schema);
  return rows.length > seriesMax ? undefined : rows;
}

function metricsPlaneRevisionKey(row: {
  readonly tenant: string;
  readonly project: string;
  readonly revision: string;
}): string {
  return JSON.stringify([row.tenant, row.project, row.revision]);
}

function metricsPlaneCounter(value: string | null): number | undefined {
  return value === null ? undefined : Number(value);
}

/** The runner, stage name and workload a version 2 task resolves to, or none where the catalog names none. */
function metricsPlaneCatalogTask(
  configuration: unknown,
  shape: MetricsPlaneShape,
): Pick<MetricsPlaneTask, "runner" | "stage" | "workload"> | undefined {
  const stage = metricsPlaneCounter(shape.stage);
  const position = workloadTaskPositionOf(
    shape.kind,
    stage === undefined ? undefined : stage - 1,
    metricsPlaneCounter(shape.evaluator),
  );
  const task =
    position === undefined
      ? undefined
      : catalogNamedWorkloadTask(
          configuration,
          storedOverridesOf(shape.overrides),
          storedSelectionOf(shape.selection),
          position,
        );
  if (task === undefined) return undefined;
  return {
    runner: task.workload.runner === "Commands" ? "Commands" : "Agent",
    stage: task.stage ?? "",
    workload: task.name,
  };
}

/** What ran one task shape, read from the revision it pinned where that revision was read. */
function metricsPlaneTaskOf(
  configuration: unknown,
  shape: MetricsPlaneShape,
): Pick<MetricsPlaneTask, "runner" | "stage" | "workload"> {
  const numbered = { stage: shape.stage ?? "", workload: "" };
  if (configuration === undefined) return { ...numbered, runner: "" };
  if (declaredConfigurationVersion(configuration) === 2)
    return (
      metricsPlaneCatalogTask(configuration, shape) ?? {
        ...numbered,
        runner: "",
      }
    );
  const parsed = authoredTaskConfigurationReadiness(configuration);
  if (parsed.readiness !== "Ready") return { ...numbered, runner: "" };
  const stage = metricsPlaneCounter(shape.stage);
  return {
    ...numbered,
    runner: briefingStageCarrier(
      parsed.configuration,
      taskPurposeForKind(shape.kind),
      stage === undefined ? undefined : stage - 1,
    ),
  };
}

/**
 * Each shape labelled and each principal named, or none where the scrape's
 * deadline passes first. Every revision is parsed once, however many shapes
 * pinned it.
 */
function metricsPlaneLabelled(
  found: MetricsPlaneSourcesRow,
  owner: (principal: string) => string,
  deadlineMs: number,
): MetricsPlaneLabelling | undefined {
  const canonicals = new Map(
    metricsPlaneParsed(found.revisions, metricsPlaneRevisionSchema).map(
      (row) => [metricsPlaneRevisionKey(row), row.canonical],
    ),
  );
  const configurations = new Map<string, unknown>();
  const labelling = {
    keys: [] as string[],
    runners: [] as string[],
    stages: [] as string[],
    workloads: [] as string[],
  };
  for (const shape of metricsPlaneParsed(
    found.shapes,
    metricsPlaneShapeSchema,
  )) {
    if (Date.now() > deadlineMs) return undefined;
    const revision = metricsPlaneRevisionKey(shape);
    const canonical = canonicals.get(revision);
    if (!configurations.has(revision) && canonical !== undefined)
      configurations.set(revision, JSON.parse(canonical) as unknown);
    const task = metricsPlaneTaskOf(configurations.get(revision), shape);
    labelling.keys.push(shape.key);
    labelling.runners.push(task.runner);
    labelling.stages.push(task.stage);
    labelling.workloads.push(task.workload);
  }
  const principals = metricsPlaneParsed(found.principals, z.string());
  return {
    ...labelling,
    principals,
    owners: principals.map(owner),
  };
}

/** What every family's labels are derived from: the distinct task shapes, the revisions they pinned, and the principals. */
async function metricsPlaneSources(
  client: pg.PoolClient,
): Promise<MetricsPlaneSourcesRow | undefined> {
  const found = await client.query<MetricsPlaneSourcesRow>(
    sql`WITH shape AS (
          SELECT DISTINCT
                 jsonb_build_array(e.tenant,e.project,e.configuration_revision,t.kind,t.stage,
                   t.evaluator,d.selection,d.overrides)::text AS key,
                 e.tenant,e.project,e.configuration_revision AS revision,t.kind,t.stage::text AS stage,
                 t.evaluator::text AS evaluator,d.selection::text AS selection,d.overrides::text AS overrides
            FROM execution e
            JOIN execution_request_task t
              ON t.tenant=e.tenant AND t.project=e.project AND t.request=e.source_request AND t.task=e.task
            LEFT JOIN ticket_definition d
              ON d.tenant=e.tenant AND d.project=e.project AND d.ticket=e.ticket
           WHERE EXISTS (SELECT 1 FROM execution_attempt a
                          WHERE a.tenant=e.tenant AND a.project=e.project AND a.execution=e.execution))
        SELECT
          (SELECT json_agg(shape)::text FROM shape) AS shapes,
          (SELECT json_agg(f)::text FROM (
             SELECT c.tenant,c.project,c.revision,c.canonical FROM configuration_revision c
              WHERE (c.tenant,c.project,c.revision) IN (SELECT tenant,project,revision FROM shape)) f)
            AS revisions,
          (SELECT json_agg(principal)::text FROM (
             SELECT e.owner AS principal FROM execution e
              WHERE e.owner IS NOT NULL
                AND EXISTS (SELECT 1 FROM execution_attempt a
                             WHERE a.tenant=e.tenant AND a.project=e.project AND a.execution=e.execution)
             UNION
             SELECT s.principal FROM agent_session s
              WHERE EXISTS (SELECT 1 FROM session_turn u
                             WHERE u.tenant=s.tenant AND u.project=s.project AND u.session=s.session
                               AND u.ended_at IS NOT NULL)) p) AS principals`,
  );
  return found.rows[0];
}

/** The families of runs and their attempts, grouped by the labels `labelling` derived, each cut at one past `seriesMax`. */
async function metricsPlaneExecutionQuery(
  client: pg.PoolClient,
  labelling: MetricsPlaneLabelling,
  seriesMax: number,
): Promise<MetricsPlaneExecutionRow | undefined> {
  const found = await client.query<MetricsPlaneExecutionRow>(
    sql`WITH bounds AS (SELECT ${metricsPlaneDurationBoundsSecs}::float8[] AS secs),
        task AS (
          SELECT * FROM unnest(${labelling.keys}::text[],${labelling.runners}::text[],
                               ${labelling.stages}::text[],${labelling.workloads}::text[])
                   AS m(key,runner,stage,workload)),
        named AS (
          SELECT * FROM unnest(${labelling.principals}::text[],${labelling.owners}::text[])
                   AS o(principal,owner)),
        attempt AS (
          SELECT a.tenant,a.project,a.execution,a.attempt,a.state,a.ended_at,
                 coalesce(o.owner,'') AS owner,t.kind AS phase,m.stage,m.runner,m.workload,
                 CASE WHEN e.placement='InCluster' THEN 'Cluster'
                      WHEN a.personal THEN 'Personal' ELSE 'Pool' END AS placement,
                 extract(epoch FROM a.ended_at-a.opened_at)::float8 AS secs
            FROM execution_attempt a
            JOIN execution e
              ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
            JOIN execution_request_task t
              ON t.tenant=e.tenant AND t.project=e.project AND t.request=e.source_request AND t.task=e.task
            LEFT JOIN ticket_definition d
              ON d.tenant=e.tenant AND d.project=e.project AND d.ticket=e.ticket
            JOIN task m
              ON m.key=jsonb_build_array(e.tenant,e.project,e.configuration_revision,t.kind,t.stage,
                         t.evaluator,d.selection,d.overrides)::text
            LEFT JOIN named o ON o.principal=e.owner),
        ended AS (
          SELECT tenant,project,owner,phase,stage,runner,workload,placement,state,
                 (SELECT count(*) FROM unnest(b.secs) AS le WHERE le<x.secs) AS bucket,
                 count(*) AS ended,sum(x.secs) AS secs,min(x.ended_at) AS created_at
            FROM attempt x CROSS JOIN bounds b WHERE x.ended_at IS NOT NULL
           GROUP BY tenant,project,owner,phase,stage,runner,workload,placement,state,bucket)
        SELECT
          (SELECT json_agg(f)::text FROM (
             SELECT tenant,project,owner,phase,stage,runner,workload,placement,state,
                    json_object_agg(bucket,ended) AS buckets,sum(ended)::text AS ended,
                    sum(secs)::text AS secs,extract(epoch FROM min(created_at))::text AS created
               FROM ended GROUP BY tenant,project,owner,phase,stage,runner,workload,placement,state
              LIMIT ${seriesMax + 1}) f) AS attempts,
          (SELECT json_agg(f)::text FROM (
             SELECT x.tenant,x.project,x.owner,x.phase,x.stage,x.runner,x.workload,x.placement,
                    sum(r.turns)::text AS turns,sum(r.duration_ms)::text AS duration_ms,
                    sum(r.duration_api_ms)::text AS duration_api_ms,
                    extract(epoch FROM min(x.ended_at))::text AS created
               FROM execution_run_total r JOIN attempt x USING (tenant,project,execution,attempt)
              WHERE x.ended_at IS NOT NULL
              GROUP BY x.tenant,x.project,x.owner,x.phase,x.stage,x.runner,x.workload,x.placement
              LIMIT ${seriesMax + 1}) f) AS runs,
          (SELECT json_agg(f)::text FROM (
             SELECT x.tenant,x.project,x.owner,x.phase,x.stage,x.runner,x.workload,x.placement,m.model,
                    sum(m.tokens_input)::text AS tokens_input,sum(m.tokens_output)::text AS tokens_output,
                    sum(m.tokens_cache_creation)::text AS tokens_cache_creation,
                    sum(m.tokens_cache_read)::text AS tokens_cache_read,
                    sum(m.cost_usd_micros)::text AS cost_usd_micros,
                    extract(epoch FROM min(x.ended_at))::text AS created
               FROM execution_run_model_usage m JOIN attempt x USING (tenant,project,execution,attempt)
              WHERE x.ended_at IS NOT NULL
              GROUP BY x.tenant,x.project,x.owner,x.phase,x.stage,x.runner,x.workload,x.placement,m.model
              LIMIT ${seriesMax + 1}) f) AS models`,
  );
  return found.rows[0];
}

/** The families of session turns and tickets, owners named as `labelling` named them, each cut at one past `seriesMax`. */
async function metricsPlaneSessionQuery(
  client: pg.PoolClient,
  labelling: MetricsPlaneLabelling,
  seriesMax: number,
): Promise<MetricsPlaneSessionRow | undefined> {
  const found = await client.query<MetricsPlaneSessionRow>(
    sql`WITH bounds AS (SELECT ${metricsPlaneDurationBoundsSecs}::float8[] AS secs),
        named AS (
          SELECT * FROM unnest(${labelling.principals}::text[],${labelling.owners}::text[])
                   AS o(principal,owner)),
        turn AS (
          SELECT s.tenant,s.project,coalesce(o.owner,'') AS owner,s.kind,u.state,u.model,
                 CASE WHEN u.model IS NOT NULL THEN (SELECT count(*) FROM unnest(b.secs) AS le
                                                      WHERE le*1000<u.duration_ms) END AS bucket,
                 count(*) AS ended,coalesce(sum(u.tokens),0) AS tokens,
                 coalesce(sum(u.cost_micros),0) AS cost_micros,coalesce(sum(u.duration_ms),0) AS duration_ms,
                 min(u.ended_at) AS created_at
            FROM session_turn u
            JOIN agent_session s
              ON s.tenant=u.tenant AND s.project=u.project AND s.session=u.session
            LEFT JOIN named o ON o.principal=s.principal
           CROSS JOIN bounds b WHERE u.ended_at IS NOT NULL
           GROUP BY s.tenant,s.project,coalesce(o.owner,''),s.kind,u.state,u.model,bucket)
        SELECT
          (SELECT json_agg(f)::text FROM (
             SELECT tenant,project,owner,kind,state,model,
                    json_object_agg(bucket,ended) FILTER (WHERE bucket IS NOT NULL) AS buckets,
                    sum(ended)::text AS ended,sum(tokens)::text AS tokens,
                    sum(cost_micros)::text AS cost_micros,sum(duration_ms)::text AS duration_ms,
                    extract(epoch FROM min(created_at))::text AS created
               FROM turn GROUP BY tenant,project,owner,kind,state,model
              LIMIT ${seriesMax + 1}) f) AS turns,
          (SELECT json_agg(f)::text FROM (
             SELECT tenant,project,phase,count(*)::text AS tickets FROM ticket_projection
              GROUP BY tenant,project,phase LIMIT ${seriesMax + 1}) f) AS tickets`,
  );
  return found.rows[0];
}

/** Every family's series as the interpreter reads them, or none where one has more than `seriesMax`. */
function metricsPlaneRows(
  executions: MetricsPlaneExecutionRow,
  sessions: MetricsPlaneSessionRow,
  seriesMax: number,
): MetricsPlaneRows | undefined {
  const rows = {
    attempts: metricsPlaneFamilyRows(
      executions.attempts,
      metricsPlaneAttemptSchema,
      seriesMax,
    ),
    runs: metricsPlaneFamilyRows(
      executions.runs,
      metricsPlaneRunSchema,
      seriesMax,
    ),
    models: metricsPlaneFamilyRows(
      executions.models,
      metricsPlaneModelSchema,
      seriesMax,
    ),
    turns: metricsPlaneFamilyRows(
      sessions.turns,
      metricsPlaneTurnSchema,
      seriesMax,
    ),
    tickets: metricsPlaneFamilyRows(
      sessions.tickets,
      metricsPlaneTicketSchema,
      seriesMax,
    ),
  };
  const { attempts, runs, models, turns, tickets } = rows;
  return attempts === undefined ||
    runs === undefined ||
    models === undefined ||
    turns === undefined ||
    tickets === undefined
    ? undefined
    : { attempts, runs, models, turns, tickets };
}

/** Bounds the statements still to run in this transaction to what is left before `deadlineMs`. */
async function metricsPlaneRemaining(
  client: pg.PoolClient,
  deadlineMs: number,
): Promise<boolean> {
  const remainingMs = Math.ceil(deadlineMs - Date.now());
  if (remainingMs <= 0) return false;
  await client.query<{ set_config: string | null }>(
    sql`SELECT set_config('statement_timeout',${String(remainingMs)},true)`,
  );
  return true;
}

/** One scrape's statements, in the snapshot and under the deadline `client` was opened with. */
async function metricsPlaneScrapeRead(
  client: pg.PoolClient,
  bounds: MetricsPlaneBounds,
  readTimeoutMs: number,
  deadlineMs: number,
): Promise<MetricsPlaneRead> {
  const late: MetricsPlaneRead = {
    read: "Refused",
    why: `the reads did not finish within ${String(readTimeoutMs)} ms, the bound on one scrape`,
  };
  if (!(await metricsPlaneRemaining(client, deadlineMs))) return late;
  const sources = await metricsPlaneSources(client);
  if (sources === undefined)
    throw new Error("metrics plane: the read returned no row");
  const labelling = metricsPlaneLabelled(sources, bounds.owner, deadlineMs);
  if (
    labelling === undefined ||
    !(await metricsPlaneRemaining(client, deadlineMs))
  )
    return late;
  const executions = await metricsPlaneExecutionQuery(
    client,
    labelling,
    bounds.seriesMax,
  );
  if (!(await metricsPlaneRemaining(client, deadlineMs))) return late;
  const sessions = await metricsPlaneSessionQuery(
    client,
    labelling,
    bounds.seriesMax,
  );
  if (executions === undefined || sessions === undefined)
    throw new Error("metrics plane: the read returned no row");
  const rows = metricsPlaneRows(executions, sessions, bounds.seriesMax);
  return rows === undefined
    ? {
        read: "Refused",
        why: `a family carries more than ${String(bounds.seriesMax)} series, the cap on the series one page carries`,
      }
    : { read: "Read", rows };
}

/**
 * The plane's read over `pool`, every scrape read in one snapshot and within
 * `readTimeoutMs` of its start; a statement past it fails, and labelling past
 * it is refused.
 */
export function postgresMetricsPlaneReads(
  pool: pg.Pool,
  readTimeoutMs: number,
): MetricsPlaneReads {
  return {
    read: async (bounds): Promise<MetricsPlaneRead> => {
      const deadlineMs = Date.now() + readTimeoutMs;
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const read = await metricsPlaneScrapeRead(
          client,
          bounds,
          readTimeoutMs,
          deadlineMs,
        );
        await client.query("COMMIT");
        return read;
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw cause;
      } finally {
        client.release();
      }
    },
  };
}

/** Whether `pool` connects as `role`, which a plane started under any other is not ready for. */
export async function postgresMetricsPlaneReady(
  pool: pg.Pool,
  role: string,
): Promise<boolean> {
  try {
    const found = await pool.query<{ current_role: string }>(
      sql`SELECT COALESCE(current_user::text,'') AS current_role`,
    );
    return found.rows[0]?.current_role === role;
  } catch {
    return false;
  }
}
