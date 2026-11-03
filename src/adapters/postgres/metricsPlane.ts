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
 * runner empty too. An evaluation event's stage is named the same way, from
 * the revision its own journal entry was decided under.
 *
 * A TICKET'S HISTORY IS ITS JOURNAL, read whole on each scrape, and its owner
 * is the member its first draft revision was written under, as an execution's
 * is. A rework is an event that sent the ticket back to work for a result:
 * evaluation's rework, landing's, and the resume of an escalated evaluation
 * failure, which a landed ticket's every such escalation was followed by and
 * so is counted at the escalation.
 *
 * AN ENDED TICKET'S COST IS SETTLED BEFORE IT IS OBSERVED. It counts only the
 * attempts that ended by its ending entry, and is observed only once that
 * entry is `metricsPlaneTicketSettleSecs` old, so an attempt whose ending
 * commits after the ticket's cannot change an observation already served.
 *
 * THE BOUND IS ON THE WHOLE SCRAPE, NOT ON THE HISTORY IT READS. Each
 * statement runs under what is left of it, and the labelling between them
 * stops once it has passed, so a scrape refused for time is one whose reads
 * did not finish within the bound and never one whose history grew past a
 * count.
 *
 * EACH COUNTER'S AND HISTOGRAM'S SERIES BEGAN WHEN ITS FIRST ROW'S ATTEMPT OR
 * TURN ENDED, OR ITS FIRST ROW'S JOURNAL ENTRY WAS COMMITTED, an aggregate in
 * the statement that sums it. A run's totals carry
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

import { ticketEventTags } from "../../domain/generated/modelTypes.ts";
import { taskPurposeForKind } from "../../interpreter/executionScheduler.ts";
import {
  metricsPlaneDurationBoundsSecs,
  metricsPlaneEscalatingEvents,
  metricsPlaneEscalationBoundsSecs,
  metricsPlaneAgentPauseTriggers,
  metricsPlaneMemberProject,
  metricsPlaneTicketCostBoundsUsd,
  metricsPlaneTicketEscalations,
  metricsPlaneTicketReworkBounds,
  metricsPlaneTicketTimeBoundsSecs,
  type MetricsPlaneAgentPausedRow,
  type MetricsPlaneBounds,
  type MetricsPlaneAttemptRow,
  type MetricsPlaneModelRow,
  type MetricsPlaneRead,
  type MetricsPlaneReads,
  type MetricsPlaneRunRow,
  type MetricsPlaneRows,
  type MetricsPlaneTask,
  type MetricsPlaneEscalationRow,
  type MetricsPlaneTicketCostRow,
  type MetricsPlaneTicketObservedRow,
  type MetricsPlaneTurnRow,
} from "../../interpreter/metricsPlane.ts";
import { memberAuthorityKind } from "../../interpreter/projectAccess.ts";
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

/** How long after a ticket's ending entry its cost is observed, every attempt-end decided before it having committed by then. */
export const metricsPlaneTicketSettleSecs = 600;

/** The events that name their ticket as their whole value, as `eventTicket` reads them. */
const metricsPlaneTicketValueEvents = [
  "TicketRevoked",
  "TicketWorkResumed",
  "TicketEvaluationResumed",
  "TicketFinalizationResumed",
];

/** The events that send a landed ticket back to work for a result, an escalated evaluation failure counted for the resume that followed it. */
const metricsPlaneReworkEvents = [
  "TicketEvaluationReworkStarted",
  "TicketFinalizationNeedsWork",
  "TicketEvaluationFailureEscalated",
];

/** A bucket's index into `bounds`, or one past them, and how many fell in it. */
function metricsPlaneBucketsSchema(bounds: readonly number[]) {
  return z
    .record(z.string(), z.number().int().nonnegative())
    .transform((counts, context) => {
      const buckets = [...bounds, Infinity].map(() => 0);
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
}

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
    buckets: metricsPlaneBucketsSchema(metricsPlaneDurationBoundsSecs),
    ended: metricsPlaneFigure,
    duration_ms: metricsPlaneFigure,
    created: metricsPlaneFigure,
  })
  .transform(
    ({
      state,
      buckets,
      ended,
      duration_ms,
      created,
      ...task
    }): MetricsPlaneAttemptRow => ({
      task,
      state,
      buckets,
      ended,
      durationMs: duration_ms,
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
    buckets: metricsPlaneBucketsSchema(
      metricsPlaneDurationBoundsSecs,
    ).nullable(),
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

const metricsPlaneTicketOwnerSchema = {
  tenant: z.string(),
  project: z.string(),
  owner: z.string(),
};

const metricsPlaneTicketSchema = z.object({
  ...metricsPlaneTicketOwnerSchema,
  phase: z.string(),
  escalation: z.enum(metricsPlaneTicketEscalations),
  tickets: metricsPlaneFigure,
});

const metricsPlaneTicketEventSchema = z
  .object({
    ...metricsPlaneTicketOwnerSchema,
    event: z.enum(ticketEventTags),
    stage: z.string(),
    entries: metricsPlaneFigure,
    created: metricsPlaneFigure,
  })
  .transform(({ created, ...row }) => ({ ...row, createdSecs: created }));

/** What every ticket histogram's series carries: its owner's labels, how many fell in each bucket of `bounds` and the one past them, their sum, and when the first was. */
function metricsPlaneObservedShape(bounds: readonly number[]) {
  return {
    ...metricsPlaneTicketOwnerSchema,
    buckets: metricsPlaneBucketsSchema(bounds),
    sum: metricsPlaneFigure,
    created: metricsPlaneFigure,
  };
}

function metricsPlaneObservedSchema(bounds: readonly number[]) {
  return z
    .object(metricsPlaneObservedShape(bounds))
    .transform(({ created, ...row }): MetricsPlaneTicketObservedRow => ({
      ...row,
      createdSecs: created,
    }));
}

const metricsPlaneTicketCostSchema = z
  .object({
    ...metricsPlaneObservedShape(metricsPlaneTicketCostBoundsUsd),
    ending: z.enum(["Done", "Revoked"]),
  })
  .transform(({ created, ending, ...row }): MetricsPlaneTicketCostRow => ({
    ...row,
    end: ending,
    createdSecs: created,
  }));

const metricsPlaneEscalationSchema = z
  .object({
    ...metricsPlaneObservedShape(metricsPlaneEscalationBoundsSecs),
    event: z.enum(metricsPlaneEscalatingEvents),
    ender: z.string(),
  })
  .transform(({ created, ender, ...row }): MetricsPlaneEscalationRow => ({
    ...row,
    by: ender,
    createdSecs: created,
  }));

/** Which ticket histogram one series the fifth statement reads is of. */
const metricsPlaneEndingSeriesSchema = z.looseObject({
  family: z.enum(["lead", "run", "reworks", "cost"]),
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

/** What the third statement reads: the family of session turns. */
interface MetricsPlaneSessionRow {
  readonly turns: string | null;
}

/** What the fourth statement reads: the tickets where they stand, and every journal entry. */
interface MetricsPlaneTicketRow {
  readonly tickets: string | null;
  readonly events: string | null;
}

/** What the fifth statement reads: every ended ticket's histograms but its escalations', each family cut at one past the cap. */
interface MetricsPlaneEndingRow {
  readonly observations: string | null;
}

/** What the sixth statement reads: every ended escalation's histogram. */
interface MetricsPlaneEscalatedRow {
  readonly escalations: string | null;
}

/** What the seventh statement reads: whether each account's agent is paused by each trigger. */
interface MetricsPlaneAgentPauseRow {
  readonly pauses: string | null;
}

const metricsPlaneAgentPauseSchema = z.object({
  principal: z.string(),
  agent: z.string(),
  trigger: z.enum(metricsPlaneAgentPauseTriggers),
  paused: z.boolean(),
});

/** The ticket families of a page, which the journal and the tickets where they stand are read for. */
type MetricsPlaneTicketed = Omit<
  MetricsPlaneRows,
  "attempts" | "runs" | "models" | "turns" | "agentPauses"
>;

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
    sql`WITH reported AS (
          SELECT j.tenant,j.project,j.configuration_revision AS revision,(v.e#>>'{value,ticket}')::bigint AS ticket,
                 (x.task#>>'{value,stage}')::bigint AS stage,(x.task#>>'{value,evaluator}')::bigint AS evaluator
            FROM journal_entry j
           CROSS JOIN LATERAL (SELECT j.entry::jsonb->'event' AS e) AS v
           CROSS JOIN LATERAL (SELECT coalesce(v.e#>'{value,report,value,result,obligation,task}',
                                 v.e#>'{value,report,value,failure,task}') AS task) AS x
           WHERE j.configuration_revision IS NOT NULL AND x.task->>'type'='EvaluationTask'),
        shape AS (
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
                          WHERE a.tenant=e.tenant AND a.project=e.project AND a.execution=e.execution)
          UNION
          SELECT jsonb_build_array(r.tenant,r.project,r.revision,'Evaluation'::text,r.stage,
                   r.evaluator,d.selection,d.overrides)::text,
                 r.tenant,r.project,r.revision,'Evaluation',r.stage::text,r.evaluator::text,
                 d.selection::text,d.overrides::text
            FROM reported r
            LEFT JOIN ticket_definition d
              ON d.tenant=r.tenant AND d.project=r.project AND d.ticket=r.ticket)
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
                               AND u.ended_at IS NOT NULL)
             UNION
             SELECT r.authority_subject FROM draft_revision r
              WHERE r.authoring_version=1 AND r.authority_kind=${memberAuthorityKind}
                AND EXISTS (SELECT 1 FROM ticket_projection p
                             WHERE p.tenant=r.tenant AND p.project=r.project AND p.ticket=r.ticket)) p)
            AS principals`,
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
                 round(extract(epoch FROM a.ended_at-coalesce(a.claimed_at,a.opened_at))*1000)::bigint AS ms
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
                 (SELECT count(*) FROM unnest(b.secs) AS le WHERE le*1000<x.ms) AS bucket,
                 count(*) AS ended,sum(x.ms) AS ms,min(x.ended_at) AS created_at
            FROM attempt x CROSS JOIN bounds b WHERE x.ended_at IS NOT NULL
           GROUP BY tenant,project,owner,phase,stage,runner,workload,placement,state,bucket)
        SELECT
          (SELECT json_agg(f)::text FROM (
             SELECT tenant,project,owner,phase,stage,runner,workload,placement,state,
                    json_object_agg(bucket,ended) AS buckets,sum(ended)::text AS ended,
                    sum(ms)::text AS duration_ms,extract(epoch FROM min(created_at))::text AS created
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

/** The family of session turns, owners named as `labelling` named them, cut at one past `seriesMax`. */
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
        session AS (
          SELECT tenant,project,session,kind,principal,
                 CASE WHEN scope='Member' THEN ${metricsPlaneMemberProject}::text ELSE project END AS label
            FROM agent_session),
        turn AS (
          SELECT s.tenant,s.label AS project,coalesce(o.owner,'') AS owner,s.kind,u.state,u.model,
                 CASE WHEN u.model IS NOT NULL THEN (SELECT count(*) FROM unnest(b.secs) AS le
                                                      WHERE le*1000<u.duration_ms) END AS bucket,
                 count(*) AS ended,coalesce(sum(u.tokens),0) AS tokens,
                 coalesce(sum(u.cost_micros),0) AS cost_micros,coalesce(sum(u.duration_ms),0) AS duration_ms,
                 min(u.ended_at) AS created_at
            FROM session_turn u
            JOIN session s
              ON s.tenant=u.tenant AND s.project=u.project AND s.session=u.session
            LEFT JOIN named o ON o.principal=s.principal
           CROSS JOIN bounds b WHERE u.ended_at IS NOT NULL
           GROUP BY s.tenant,s.label,coalesce(o.owner,''),s.kind,u.state,u.model,bucket)
        SELECT
          (SELECT json_agg(f)::text FROM (
             SELECT tenant,project,owner,kind,state,model,
                    json_object_agg(bucket,ended) FILTER (WHERE bucket IS NOT NULL) AS buckets,
                    sum(ended)::text AS ended,sum(tokens)::text AS tokens,
                    sum(cost_micros)::text AS cost_micros,sum(duration_ms)::text AS duration_ms,
                    extract(epoch FROM min(created_at))::text AS created
               FROM turn GROUP BY tenant,project,owner,kind,state,model
              LIMIT ${seriesMax + 1}) f) AS turns`,
  );
  return found.rows[0];
}

/** The tickets where they stand and the count of every journal entry, owners and stages labelled as `labelling` labelled them, each cut at one past `seriesMax`. */
async function metricsPlaneTicketQuery(
  client: pg.PoolClient,
  labelling: MetricsPlaneLabelling,
  seriesMax: number,
): Promise<MetricsPlaneTicketRow | undefined> {
  const found = await client.query<MetricsPlaneTicketRow>(
    sql`WITH named AS (
          SELECT * FROM unnest(${labelling.principals}::text[],${labelling.owners}::text[])
                   AS o(principal,owner)),
        task AS (SELECT * FROM unnest(${labelling.keys}::text[],${labelling.stages}::text[]) AS m(key,stage)),
        owned AS (
          SELECT r.tenant,r.project,r.ticket,o.owner FROM draft_revision r
            JOIN named o ON o.principal=r.authority_subject
           WHERE r.authoring_version=1 AND r.authority_kind=${memberAuthorityKind}),
        fact AS (
          SELECT j.tenant,j.project,j.committed_at,j.configuration_revision AS revision,v.e->>'type' AS event,
                 (CASE WHEN v.e->>'type'='TicketCreated' THEN v.e#>>'{value,id}'
                       WHEN v.e->>'type'=ANY(${metricsPlaneTicketValueEvents}::text[]) THEN v.e->>'value'
                       ELSE v.e#>>'{value,ticket}' END)::bigint AS ticket,
                 coalesce(v.e#>'{value,report,value,result,obligation,task}',
                          v.e#>'{value,report,value,failure,task}') AS task
            FROM journal_entry j CROSS JOIN LATERAL (SELECT j.entry::jsonb->'event' AS e) AS v),
        entry AS (
          SELECT f.tenant,f.project,coalesce(w.owner,'') AS owner,f.event,f.committed_at,
                 CASE WHEN f.task->>'type'='EvaluationTask'
                      THEN coalesce(m.stage,f.task#>>'{value,stage}') ELSE '' END AS stage
            FROM fact f
            LEFT JOIN owned w ON w.tenant=f.tenant AND w.project=f.project AND w.ticket=f.ticket
            LEFT JOIN ticket_definition d ON d.tenant=f.tenant AND d.project=f.project AND d.ticket=f.ticket
            LEFT JOIN task m
              ON m.key=jsonb_build_array(f.tenant,f.project,f.revision,'Evaluation'::text,
                         (f.task#>>'{value,stage}')::bigint,(f.task#>>'{value,evaluator}')::bigint,
                         d.selection,d.overrides)::text)
        SELECT
          (SELECT json_agg(f)::text FROM (
             SELECT p.tenant,p.project,coalesce(w.owner,'') AS owner,p.phase,p.escalation,
                    count(*)::text AS tickets
               FROM ticket_projection p
               LEFT JOIN owned w ON w.tenant=p.tenant AND w.project=p.project AND w.ticket=p.ticket
              GROUP BY p.tenant,p.project,coalesce(w.owner,''),p.phase,p.escalation
              LIMIT ${seriesMax + 1}) f) AS tickets,
          (SELECT json_agg(f)::text FROM (
             SELECT tenant,project,owner,event,stage,count(*)::text AS entries,
                    extract(epoch FROM min(committed_at))::text AS created
               FROM entry GROUP BY tenant,project,owner,event,stage
              LIMIT ${seriesMax + 1}) f) AS events`,
  );
  return found.rows[0];
}

/** Every ended ticket's histograms but its escalations', owners named as `labelling` named them, each family cut at one past `seriesMax`. */
async function metricsPlaneEndingQuery(
  client: pg.PoolClient,
  labelling: MetricsPlaneLabelling,
  seriesMax: number,
): Promise<MetricsPlaneEndingRow | undefined> {
  const found = await client.query<MetricsPlaneEndingRow>(
    sql`WITH named AS (
          SELECT * FROM unnest(${labelling.principals}::text[],${labelling.owners}::text[])
                   AS o(principal,owner)),
        bounds AS (
          SELECT * FROM (VALUES ('lead',${metricsPlaneTicketTimeBoundsSecs}::float8[],1000),
                   ('run',${metricsPlaneTicketTimeBoundsSecs}::float8[],1000),
                   ('reworks',${metricsPlaneTicketReworkBounds}::float8[],1),
                   ('cost',${metricsPlaneTicketCostBoundsUsd}::float8[],1000000)) AS b(family,bounds,scale)),
        entry AS (
          SELECT j.tenant,j.project,j.committed_at,v.event,v.ticket FROM journal_entry j
           CROSS JOIN LATERAL (
             SELECT e->>'type' AS event,(CASE WHEN e->>'type'='TicketCreated' THEN e#>>'{value,id}'
                      WHEN e->>'type'=ANY(${metricsPlaneTicketValueEvents}::text[]) THEN e->>'value'
                      ELSE e#>>'{value,ticket}' END)::bigint AS ticket
               FROM (SELECT j.entry::jsonb->'event' AS e) AS x) AS v),
        ticket AS (
          SELECT x.tenant,x.project,x.ticket,coalesce(o.owner,'') AS owner,
                 min(x.committed_at) FILTER (WHERE x.event='TicketFinalizationSucceeded') AS landed_at,
                 min(x.committed_at) FILTER (WHERE x.event='TicketCreated') AS created_at,
                 min(x.committed_at) FILTER (WHERE x.event='TicketDispatched') AS dispatched_at,
                 min(x.committed_at) FILTER (WHERE x.event IN ('TicketFinalizationSucceeded','TicketRevoked'))
                   AS ended_at,
                 CASE WHEN bool_or(x.event='TicketRevoked') THEN 'Revoked' ELSE 'Done' END AS ending,
                 count(*) FILTER (WHERE x.event=ANY(${metricsPlaneReworkEvents}::text[])) AS reworks
            FROM entry x
            LEFT JOIN draft_revision r
              ON r.tenant=x.tenant AND r.project=x.project AND r.ticket=x.ticket
             AND r.authoring_version=1 AND r.authority_kind=${memberAuthorityKind}
            LEFT JOIN named o ON o.principal=r.authority_subject
           GROUP BY x.tenant,x.project,x.ticket,coalesce(o.owner,'')),
        observation AS (
          SELECT t.family,n.tenant,n.project,n.owner,'' AS ending,n.landed_at AS observed_at,t.value
            FROM ticket n CROSS JOIN LATERAL (VALUES
                   ('lead',round(extract(epoch FROM n.landed_at-n.created_at)*1000)::bigint),
                   ('run',round(extract(epoch FROM n.landed_at-n.dispatched_at)*1000)::bigint),
                   ('reworks',n.reworks)) AS t(family,value)
           WHERE n.landed_at IS NOT NULL AND t.value IS NOT NULL
          UNION ALL
          SELECT 'cost',n.tenant,n.project,n.owner,n.ending,n.ended_at,
                 coalesce((SELECT sum(u.cost_usd_micros) FROM execution e
                             JOIN execution_attempt a USING (tenant,project,execution)
                             JOIN execution_run_model_usage u USING (tenant,project,execution,attempt)
                            WHERE e.tenant=n.tenant AND e.project=n.project AND e.ticket=n.ticket
                              AND a.ended_at<=n.ended_at),0)::bigint
            FROM ticket n
           WHERE n.ended_at<=now()-make_interval(secs => ${metricsPlaneTicketSettleSecs}::float8)),
        bucketed AS (
          SELECT family,tenant,project,owner,ending,
                 (SELECT count(*) FROM unnest(bounds) AS le WHERE le*scale<value) AS bucket,
                 count(*) AS observed,sum(value) AS total,min(observed_at) AS created_at
            FROM observation JOIN bounds USING (family) GROUP BY family,tenant,project,owner,ending,bucket),
        series AS (
          SELECT family,tenant,project,owner,ending,json_object_agg(bucket,observed) AS buckets,
                 sum(total)::text AS sum,extract(epoch FROM min(created_at))::text AS created,
                 row_number() OVER (PARTITION BY family) AS place
            FROM bucketed GROUP BY family,tenant,project,owner,ending)
        SELECT (SELECT json_agg(s)::text FROM series s WHERE s.place<=${seriesMax + 1}) AS observations`,
  );
  return found.rows[0];
}

/** Every ended escalation, timed to its ticket's next entry and labelled by the authority of the operation that decided it, owners named as `labelling` named them and cut at one past `seriesMax`. */
async function metricsPlaneEscalationQuery(
  client: pg.PoolClient,
  labelling: MetricsPlaneLabelling,
  seriesMax: number,
): Promise<MetricsPlaneEscalatedRow | undefined> {
  const found = await client.query<MetricsPlaneEscalatedRow>(
    sql`WITH named AS (
          SELECT * FROM unnest(${labelling.principals}::text[],${labelling.owners}::text[])
                   AS o(principal,owner)),
        entry AS (
          SELECT j.tenant,j.project,j.committed_at,v.event,v.ticket,lead(j.committed_at) OVER later AS next_at,
                 lead(j.cause_kind) OVER later AS next_kind,lead(j.cause_id) OVER later AS next_cause
            FROM journal_entry j
           CROSS JOIN LATERAL (
             SELECT e->>'type' AS event,(CASE WHEN e->>'type'='TicketCreated' THEN e#>>'{value,id}'
                      WHEN e->>'type'=ANY(${metricsPlaneTicketValueEvents}::text[]) THEN e->>'value'
                      ELSE e#>>'{value,ticket}' END)::bigint AS ticket
               FROM (SELECT j.entry::jsonb->'event' AS e) AS x) AS v
          WINDOW later AS (PARTITION BY j.tenant,j.project,v.ticket ORDER BY j.seq)),
        ended AS (
          SELECT h.tenant,h.project,coalesce(o.owner,'') AS owner,h.event,coalesce(p.authority_kind,'') AS ender,
                 h.next_at,round(extract(epoch FROM h.next_at-h.committed_at)*1000)::bigint AS ms
            FROM entry h
            LEFT JOIN operation p
              ON h.next_kind='Operation' AND p.tenant=h.tenant AND p.project=h.project AND p.operation=h.next_cause
            LEFT JOIN draft_revision r
              ON r.tenant=h.tenant AND r.project=h.project AND r.ticket=h.ticket
             AND r.authoring_version=1 AND r.authority_kind=${memberAuthorityKind}
            LEFT JOIN named o ON o.principal=r.authority_subject
           WHERE h.event=ANY(${metricsPlaneEscalatingEvents}::text[]) AND h.next_at IS NOT NULL),
        bucketed AS (
          SELECT tenant,project,owner,event,ender,
                 (SELECT count(*) FROM unnest(${metricsPlaneEscalationBoundsSecs}::float8[]) AS le
                   WHERE le*1000<ms) AS bucket,
                 count(*) AS observed,sum(ms) AS ms,min(next_at) AS created_at
            FROM ended GROUP BY tenant,project,owner,event,ender,bucket)
        SELECT (SELECT json_agg(f)::text FROM (
                 SELECT tenant,project,owner,event,ender,json_object_agg(bucket,observed) AS buckets,
                        sum(ms)::text AS sum,extract(epoch FROM min(created_at))::text AS created
                   FROM bucketed GROUP BY tenant,project,owner,event,ender
                  LIMIT ${seriesMax + 1}) f) AS escalations`,
  );
  return found.rows[0];
}

/** One ticket histogram's series of `series`, parsed by `schema`, or none where it has more than `seriesMax`. */
function metricsPlaneEndingFamily<Schema extends z.ZodType>(
  series: readonly z.output<typeof metricsPlaneEndingSeriesSchema>[],
  family: z.output<typeof metricsPlaneEndingSeriesSchema>["family"],
  schema: Schema,
  seriesMax: number,
): readonly z.output<Schema>[] | undefined {
  const rows = series
    .filter((row) => row.family === family)
    .map((row) => schema.parse(row));
  return rows.length > seriesMax ? undefined : rows;
}

/**
 * Whether each account's agent is paused by each trigger, as `agent_account_pause`
 * answers it at the snapshot's own time: soft where a window's reading holds it,
 * hard where a limit does. An account is one a reading or a limit names.
 */
async function metricsPlaneAgentPauseQuery(
  client: pg.PoolClient,
  seriesMax: number,
): Promise<MetricsPlaneAgentPauseRow | undefined> {
  const found = await client.query<MetricsPlaneAgentPauseRow>(
    sql`SELECT json_agg(f)::text AS pauses FROM (
          SELECT k.principal,k.agent,t.trigger,
                 CASE t.trigger WHEN 'soft' THEN h.reasons && ARRAY['five_hour','seven_day']
                                ELSE 'limit'=ANY(h.reasons) END AS paused
            FROM (SELECT u.principal,u.agent FROM agent_account_usage u
                  UNION SELECT l.principal,l.agent FROM agent_account_limit l) k
           CROSS JOIN (VALUES ('soft'),('hard')) t(trigger)
           CROSS JOIN LATERAL agent_account_pause(k.principal,k.agent) h
           ORDER BY k.principal,k.agent,t.trigger
           LIMIT ${seriesMax + 1}) f`,
  );
  return found.rows[0];
}

/** Each account's pauses labelled by its owner, or none where they are more than `seriesMax`. */
function metricsPlaneAgentPauses(
  read: MetricsPlaneAgentPauseRow,
  owner: (principal: string) => string,
  seriesMax: number,
): readonly MetricsPlaneAgentPausedRow[] | undefined {
  const rows = metricsPlaneParsed(read.pauses, metricsPlaneAgentPauseSchema);
  if (rows.length > seriesMax) return undefined;
  return rows.map((row) => ({
    owner: owner(row.principal),
    agent: row.agent,
    trigger: row.trigger,
    paused: row.paused ? 1 : 0,
  }));
}

/** The ticket families' series as the interpreter reads them, or none where one has more than `seriesMax`. */
function metricsPlaneTicketRows(
  tickets: MetricsPlaneTicketRow,
  ending: MetricsPlaneEndingRow,
  escalated: MetricsPlaneEscalatedRow,
  seriesMax: number,
): MetricsPlaneTicketed | undefined {
  const series = metricsPlaneParsed(
    ending.observations,
    metricsPlaneEndingSeriesSchema,
  );
  const timed = metricsPlaneObservedSchema(metricsPlaneTicketTimeBoundsSecs);
  const rows = {
    tickets: metricsPlaneFamilyRows(
      tickets.tickets,
      metricsPlaneTicketSchema,
      seriesMax,
    ),
    ticketEvents: metricsPlaneFamilyRows(
      tickets.events,
      metricsPlaneTicketEventSchema,
      seriesMax,
    ),
    leadTimes: metricsPlaneEndingFamily(series, "lead", timed, seriesMax),
    runTimes: metricsPlaneEndingFamily(series, "run", timed, seriesMax),
    reworks: metricsPlaneEndingFamily(
      series,
      "reworks",
      metricsPlaneObservedSchema(metricsPlaneTicketReworkBounds),
      seriesMax,
    ),
    costs: metricsPlaneEndingFamily(
      series,
      "cost",
      metricsPlaneTicketCostSchema,
      seriesMax,
    ),
    escalations: metricsPlaneFamilyRows(
      escalated.escalations,
      metricsPlaneEscalationSchema,
      seriesMax,
    ),
  };
  const {
    tickets: standing,
    ticketEvents,
    leadTimes,
    runTimes,
    reworks,
    costs,
    escalations,
  } = rows;
  return standing === undefined ||
    ticketEvents === undefined ||
    leadTimes === undefined ||
    runTimes === undefined ||
    reworks === undefined ||
    costs === undefined ||
    escalations === undefined
    ? undefined
    : {
        tickets: standing,
        ticketEvents,
        leadTimes,
        runTimes,
        reworks,
        costs,
        escalations,
      };
}

/** Every family's series as the interpreter reads them, or none where one has more than `seriesMax`. */
function metricsPlaneRows(
  executions: MetricsPlaneExecutionRow,
  sessions: MetricsPlaneSessionRow,
  ticketed: MetricsPlaneTicketed,
  agentPauses: readonly MetricsPlaneAgentPausedRow[],
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
  };
  const { attempts, runs, models, turns } = rows;
  return attempts === undefined ||
    runs === undefined ||
    models === undefined ||
    turns === undefined
    ? undefined
    : { attempts, runs, models, turns, ...ticketed, agentPauses };
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

/** The ticket families' statements, each under what is left before `deadlineMs`, read as the interpreter reads them or none where one has more than `seriesMax`. */
async function metricsPlaneTicketReads(
  client: pg.PoolClient,
  labelling: MetricsPlaneLabelling,
  seriesMax: number,
  deadlineMs: number,
): Promise<
  | { readonly read: "Late" }
  | { readonly read: "Read"; readonly rows: MetricsPlaneTicketed | undefined }
> {
  if (!(await metricsPlaneRemaining(client, deadlineMs)))
    return { read: "Late" };
  const tickets = await metricsPlaneTicketQuery(client, labelling, seriesMax);
  if (!(await metricsPlaneRemaining(client, deadlineMs)))
    return { read: "Late" };
  const ending = await metricsPlaneEndingQuery(client, labelling, seriesMax);
  if (!(await metricsPlaneRemaining(client, deadlineMs)))
    return { read: "Late" };
  const escalated = await metricsPlaneEscalationQuery(
    client,
    labelling,
    seriesMax,
  );
  if (tickets === undefined || ending === undefined || escalated === undefined)
    throw new Error("metrics plane: the read returned no row");
  return {
    read: "Read",
    rows: metricsPlaneTicketRows(tickets, ending, escalated, seriesMax),
  };
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
  const ticketed = await metricsPlaneTicketReads(
    client,
    labelling,
    bounds.seriesMax,
    deadlineMs,
  );
  if (ticketed.read === "Late") return late;
  if (!(await metricsPlaneRemaining(client, deadlineMs))) return late;
  const paused = await metricsPlaneAgentPauseQuery(client, bounds.seriesMax);
  if (
    executions === undefined ||
    sessions === undefined ||
    paused === undefined
  )
    throw new Error("metrics plane: the read returned no row");
  const agentPauses = metricsPlaneAgentPauses(
    paused,
    bounds.owner,
    bounds.seriesMax,
  );
  const rows =
    ticketed.rows === undefined || agentPauses === undefined
      ? undefined
      : metricsPlaneRows(
          executions,
          sessions,
          ticketed.rows,
          agentPauses,
          bounds.seriesMax,
        );
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
