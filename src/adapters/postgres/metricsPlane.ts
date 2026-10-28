/**
 * The metrics plane's one read: every family's rows, aggregated by the server
 * in a single statement, so the pool's statement timeout bounds the whole
 * scrape and every family is read from one snapshot.
 *
 * EACH FAMILY IS GROUPED BY WHAT ITS LABELS ARE DERIVED FROM, never by a row's
 * identity, and each is cut at one row past the bound it is read under, so
 * what reaches this process is bounded before it is parsed. A family past it
 * is a refusal, never a truncation.
 *
 * WHAT RAN A TASK IS DERIVED, AS THE OPERATIONAL READS DERIVE IT, from the
 * revision its execution pinned and its ticket's selection and overrides: the
 * runner, an evaluation stage's name, and a catalog task's workload. A version
 * 1 configuration names no stage and no workload, so its stage is its number
 * and its workload is empty; a revision no reader can read leaves the runner
 * empty too. Each revision is read once and each derivation made once per
 * distinct task shape, and the revisions are bounded on their own because one
 * holds a whole configuration.
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
  type MetricsPlaneRead,
  type MetricsPlaneReads,
  type MetricsPlaneRows,
  type MetricsPlaneTask,
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

const metricsPlaneShapeSchema = z.object({
  tenant: z.string(),
  project: z.string(),
  owner: z.string().nullable(),
  revision: z.string(),
  kind: z.enum(["Work", "Evaluation"]),
  stage: z.string().nullable(),
  evaluator: z.string().nullable(),
  selection: z.string().nullable(),
  overrides: z.string().nullable(),
  placement: z.enum(["Cluster", "Pool", "Personal"]),
});

type MetricsPlaneShape = z.output<typeof metricsPlaneShapeSchema>;

const metricsPlaneAttemptSchema = z.object({
  shape: metricsPlaneShapeSchema,
  state: z.string(),
  bucket: metricsPlaneFigure,
  ended: metricsPlaneFigure,
  secs: metricsPlaneFigure,
});

const metricsPlaneRunSchema = z.object({
  shape: metricsPlaneShapeSchema,
  turns: metricsPlaneFigure,
  duration_ms: metricsPlaneFigure,
  duration_api_ms: metricsPlaneFigure,
});

const metricsPlaneModelSchema = z.object({
  shape: metricsPlaneShapeSchema,
  model: z.string(),
  tokens_input: metricsPlaneFigure,
  tokens_output: metricsPlaneFigure,
  tokens_cache_creation: metricsPlaneFigure,
  tokens_cache_read: metricsPlaneFigure,
  cost_usd_micros: metricsPlaneFigure,
});

const metricsPlaneRevisionSchema = z.object({
  tenant: z.string(),
  project: z.string(),
  revision: z.string(),
  canonical: z.string(),
});

const metricsPlaneTurnSchema = z.object({
  tenant: z.string(),
  project: z.string(),
  principal: z.string(),
  kind: z.enum(["Lead", "Thread", "Inquiry"]),
  state: z.string(),
  model: z.string().nullable(),
  bucket: metricsPlaneFigure.nullable(),
  ended: metricsPlaneFigure,
  tokens: metricsPlaneFigure,
  cost_micros: metricsPlaneFigure,
  duration_ms: metricsPlaneFigure,
});

const metricsPlaneTicketSchema = z.object({
  tenant: z.string(),
  project: z.string(),
  phase: z.string(),
  tickets: metricsPlaneFigure,
});

/** Every family's rows, each within the bound it was read under. */
interface MetricsPlaneFamilies {
  readonly attempts: readonly z.output<typeof metricsPlaneAttemptSchema>[];
  readonly runs: readonly z.output<typeof metricsPlaneRunSchema>[];
  readonly models: readonly z.output<typeof metricsPlaneModelSchema>[];
  readonly turns: readonly z.output<typeof metricsPlaneTurnSchema>[];
  readonly tickets: readonly z.output<typeof metricsPlaneTicketSchema>[];
}

interface MetricsPlaneRow {
  readonly attempts: string | null;
  readonly runs: string | null;
  readonly models: string | null;
  readonly revisions: string | null;
  readonly turns: string | null;
  readonly tickets: string | null;
}

/** One family's aggregated rows, or none where it has more than `rowsMax`. */
function metricsPlaneFamilyRows<Schema extends z.ZodType>(
  text: string | null,
  schema: Schema,
  rowsMax: number,
): readonly z.output<Schema>[] | undefined {
  const rows = z
    .array(schema)
    .parse(text === null ? [] : (JSON.parse(text) as unknown));
  return rows.length > rowsMax ? undefined : rows;
}

/** The revisions the shapes pinned, by the key `metricsPlaneRevisionKey` names them with. */
function metricsPlaneRevisions(
  rows: readonly z.output<typeof metricsPlaneRevisionSchema>[],
): ReadonlyMap<string, string> {
  return new Map(
    rows.map((row) => [metricsPlaneRevisionKey(row), row.canonical]),
  );
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
  canonical: string | undefined,
  shape: MetricsPlaneShape,
): Pick<MetricsPlaneTask, "runner" | "stage" | "workload"> {
  const numbered = { stage: shape.stage ?? "", workload: "" };
  if (canonical === undefined) return { ...numbered, runner: "" };
  const configuration = JSON.parse(canonical) as unknown;
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

/** Labels each shape once, however many rows of however many families carry it. */
function metricsPlaneTasks(revisions: ReadonlyMap<string, string>) {
  const derived = new Map<string, MetricsPlaneTask>();
  return (shape: MetricsPlaneShape): MetricsPlaneTask => {
    const key = JSON.stringify(shape);
    const known = derived.get(key);
    if (known !== undefined) return known;
    const task: MetricsPlaneTask = {
      tenant: shape.tenant,
      project: shape.project,
      owner: shape.owner ?? undefined,
      phase: shape.kind,
      placement: shape.placement,
      ...metricsPlaneTaskOf(
        revisions.get(metricsPlaneRevisionKey(shape)),
        shape,
      ),
    };
    derived.set(key, task);
    return task;
  };
}

/** The statement every scrape is answered from. */
async function metricsPlaneQuery(
  pool: pg.Pool,
  rowsMax: number,
  revisionsMax: number,
): Promise<MetricsPlaneRow | undefined> {
  const found = await pool.query<MetricsPlaneRow>(
    sql`WITH bounds AS (SELECT ${metricsPlaneDurationBoundsSecs}::float8[] AS secs),
        attempt AS (
          SELECT a.tenant,a.project,a.execution,a.attempt,a.state,a.ended_at,
                 jsonb_build_object('tenant',e.tenant,'project',e.project,'owner',e.owner,
                   'revision',e.configuration_revision,'kind',t.kind,'stage',t.stage::text,
                   'evaluator',t.evaluator::text,'selection',d.selection::text,'overrides',d.overrides::text,
                   'placement',CASE WHEN e.placement='InCluster' THEN 'Cluster'
                                    WHEN a.personal THEN 'Personal' ELSE 'Pool' END) AS shape,
                 extract(epoch FROM a.ended_at-a.opened_at)::float8 AS secs
            FROM execution_attempt a
            JOIN execution e
              ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
            JOIN execution_request_task t
              ON t.tenant=e.tenant AND t.project=e.project AND t.request=e.source_request AND t.task=e.task
            LEFT JOIN ticket_definition d
              ON d.tenant=e.tenant AND d.project=e.project AND d.ticket=e.ticket),
        ended AS (
          SELECT x.shape,x.state,x.secs,
                 (SELECT count(*) FROM unnest(b.secs) AS le WHERE le<x.secs) AS bucket
            FROM attempt x CROSS JOIN bounds b WHERE x.ended_at IS NOT NULL),
        turn AS (
          SELECT s.tenant,s.project,s.principal,s.kind,u.state,u.model,u.tokens,u.cost_micros,u.duration_ms,
                 CASE WHEN u.model IS NOT NULL THEN (SELECT count(*) FROM unnest(b.secs) AS le
                                                      WHERE le*1000<u.duration_ms) END AS bucket
            FROM session_turn u
            JOIN agent_session s
              ON s.tenant=u.tenant AND s.project=u.project AND s.session=u.session
           CROSS JOIN bounds b WHERE u.ended_at IS NOT NULL)
        SELECT
          (SELECT json_agg(f)::text FROM (
             SELECT shape,state,bucket::text AS bucket,count(*)::text AS ended,sum(secs)::text AS secs
               FROM ended GROUP BY shape,state,bucket LIMIT ${rowsMax + 1}) f) AS attempts,
          (SELECT json_agg(f)::text FROM (
             SELECT x.shape,sum(r.turns)::text AS turns,sum(r.duration_ms)::text AS duration_ms,
                    sum(r.duration_api_ms)::text AS duration_api_ms
               FROM execution_run_total r JOIN attempt x USING (tenant,project,execution,attempt)
              GROUP BY x.shape LIMIT ${rowsMax + 1}) f) AS runs,
          (SELECT json_agg(f)::text FROM (
             SELECT x.shape,m.model,sum(m.tokens_input)::text AS tokens_input,
                    sum(m.tokens_output)::text AS tokens_output,
                    sum(m.tokens_cache_creation)::text AS tokens_cache_creation,
                    sum(m.tokens_cache_read)::text AS tokens_cache_read,
                    sum(m.cost_usd_micros)::text AS cost_usd_micros
               FROM execution_run_model_usage m JOIN attempt x USING (tenant,project,execution,attempt)
              GROUP BY x.shape,m.model LIMIT ${rowsMax + 1}) f) AS models,
          (SELECT json_agg(f)::text FROM (
             SELECT c.tenant,c.project,c.revision,c.canonical FROM configuration_revision c
              WHERE (c.tenant,c.project,c.revision) IN
                    (SELECT x.tenant,x.project,x.shape->>'revision' FROM attempt x)
              LIMIT ${revisionsMax + 1}) f) AS revisions,
          (SELECT json_agg(f)::text FROM (
             SELECT tenant,project,principal,kind,state,model,bucket::text AS bucket,
                    count(*)::text AS ended,coalesce(sum(tokens),0)::text AS tokens,
                    coalesce(sum(cost_micros),0)::text AS cost_micros,
                    coalesce(sum(duration_ms),0)::text AS duration_ms
               FROM turn GROUP BY tenant,project,principal,kind,state,model,bucket
              LIMIT ${rowsMax + 1}) f) AS turns,
          (SELECT json_agg(f)::text FROM (
             SELECT tenant,project,phase,count(*)::text AS tickets FROM ticket_projection
              GROUP BY tenant,project,phase LIMIT ${rowsMax + 1}) f) AS tickets`,
  );
  return found.rows[0];
}

/** Every family's rows as the interpreter reads them, each task shape labelled by what ran it. */
function metricsPlaneRows(
  families: MetricsPlaneFamilies,
  taskOf: (shape: MetricsPlaneShape) => MetricsPlaneTask,
): MetricsPlaneRows {
  return {
    attempts: families.attempts.map((row) => ({
      task: taskOf(row.shape),
      state: row.state,
      bucket: row.bucket,
      ended: row.ended,
      durationSecs: row.secs,
    })),
    runs: families.runs.map((row) => ({
      task: taskOf(row.shape),
      turns: row.turns,
      durationMs: row.duration_ms,
      durationApiMs: row.duration_api_ms,
    })),
    models: families.models.map((row) => ({
      task: taskOf(row.shape),
      model: row.model,
      tokensInput: row.tokens_input,
      tokensOutput: row.tokens_output,
      tokensCacheCreation: row.tokens_cache_creation,
      tokensCacheRead: row.tokens_cache_read,
      costUsdMicros: row.cost_usd_micros,
    })),
    turns: families.turns.map((row) => ({
      tenant: row.tenant,
      project: row.project,
      owner: row.principal,
      session: row.kind,
      state: row.state,
      model: row.model ?? undefined,
      bucket: row.bucket ?? undefined,
      ended: row.ended,
      tokens: row.tokens,
      costMicros: row.cost_micros,
      durationMs: row.duration_ms,
    })),
    tickets: families.tickets,
  };
}

/**
 * The plane's read over `pool`, whose statement timeout is the bound one scrape
 * is read within, refusing a scrape whose runs pinned more than `revisionsMax`
 * configuration revisions.
 */
export function postgresMetricsPlaneReads(
  pool: pg.Pool,
  revisionsMax: number,
): MetricsPlaneReads {
  return {
    read: async (rowsMax): Promise<MetricsPlaneRead> => {
      const found = await metricsPlaneQuery(pool, rowsMax, revisionsMax);
      if (found === undefined)
        throw new Error("metrics plane: the read returned no row");
      const attempts = metricsPlaneFamilyRows(
        found.attempts,
        metricsPlaneAttemptSchema,
        rowsMax,
      );
      const runs = metricsPlaneFamilyRows(
        found.runs,
        metricsPlaneRunSchema,
        rowsMax,
      );
      const models = metricsPlaneFamilyRows(
        found.models,
        metricsPlaneModelSchema,
        rowsMax,
      );
      const turns = metricsPlaneFamilyRows(
        found.turns,
        metricsPlaneTurnSchema,
        rowsMax,
      );
      const tickets = metricsPlaneFamilyRows(
        found.tickets,
        metricsPlaneTicketSchema,
        rowsMax,
      );
      const revisions = metricsPlaneFamilyRows(
        found.revisions,
        metricsPlaneRevisionSchema,
        revisionsMax,
      );
      if (
        attempts === undefined ||
        runs === undefined ||
        models === undefined ||
        turns === undefined ||
        tickets === undefined
      )
        return {
          read: "Refused",
          why: `a family read more than ${String(rowsMax)} rows, the cap on the series one page carries`,
        };
      if (revisions === undefined)
        return {
          read: "Refused",
          why: `the runs pinned more than ${String(revisionsMax)} configuration revisions, the cap on the revisions one scrape reads`,
        };
      return {
        read: "Read",
        rows: metricsPlaneRows(
          { attempts, runs, models, turns, tickets },
          metricsPlaneTasks(metricsPlaneRevisions(revisions)),
        ),
      };
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
