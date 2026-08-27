/**
 * PostgreSQL reads over run evidence: what one attempt's run holds, what an
 * execution's runs sum to, what a ticket's runs sum to, and the pages the three
 * public run routes answer with.
 *
 * EVERY PAGED SORT NAMES ITS RELATION. A counter is carried to the wire as text
 * under its own name, and an unqualified `ORDER BY` resolves to that output
 * column rather than to the column beneath it — which sorts a page of counters
 * as words while its cursor compares them as numbers, so the walk repeats rows
 * and never reaches the ones between.
 *
 * EVERY ROLLUP IS A SUM IN THE READ AND NOT A STORED COLUMN. A ticket's total
 * must be whole over every attempt of every execution, including the ones past
 * a page bound, so only the server can promise it and only in SQL.
 *
 * A PER-MODEL BREAKDOWN IS RANKED BEFORE IT IS RETURNED. One execution may hold
 * more distinct models than one wire page carries, so the rank is taken in SQL
 * rather than by a slice that would silently drop the tail of one execution
 * into another's.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { TicketId } from "../../domain/ids.ts";
import {
  nativeHttpPageItemsMax,
  runTranscriptPageBatchesMax,
} from "../../contract/http.ts";
import { runCostBases, type RunCostBasis } from "../../contract/rosters.ts";
import { allAttemptStates } from "../../interpreter/executionScheduler.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { asPublicInstant } from "../../interpreter/publicResource.ts";
import {
  asArtifactDigest,
  asArtifactPath,
} from "../../interpreter/resultManifest.ts";
import {
  runIsComplete,
  type ExecutionRunResource,
  type RunConfigurationStored,
  type RunEvidenceReadStore,
  type RunModelUsage,
  type RunTotals,
  type RunTranscriptStored,
  type RunTurnsPage,
  type RunTurnsQuery,
} from "../../interpreter/runEvidence.ts";
import type {
  AttemptId,
  ExecutionId,
} from "../../interpreter/schedulerIdentity.ts";
import { projectRowCounter } from "./rows.ts";

/** The most attempts one execution read carries, which is the page bound it shares. */
const runAttemptsPageMax = nativeHttpPageItemsMax;

/** Token columns a sum may leave absent, which is what a rollup over no run is. */
interface RunTokenSumRow {
  readonly tokens_input: string | null;
  readonly tokens_output: string | null;
  readonly tokens_cache_creation: string | null;
  readonly tokens_cache_read: string | null;
}

/** The same columns read straight from a stored row, where none can be absent. */
interface RunTokenRow {
  readonly tokens_input: string;
  readonly tokens_output: string;
  readonly tokens_cache_creation: string;
  readonly tokens_cache_read: string;
}

interface RunTotalRow extends RunTokenSumRow {
  readonly turns: string | null;
  readonly duration_ms: string | null;
  readonly duration_api_ms: string | null;
  readonly cost_usd_micros: string | null;
  readonly cost_basis: string | null;
  readonly permission_denials: string | null;
}

interface RunModelRow extends RunTokenSumRow {
  readonly model: string;
  readonly cost_usd_micros: string | null;
}

/** One stored per-model row, which a read of one attempt's own usage returns. */
interface RunStoredModelRow extends RunTokenRow {
  readonly model: string;
  readonly cost_usd_micros: string;
}

function runCount(value: string | null, what: string): number {
  return value === null ? 0 : projectRowCounter(value, what);
}

function runTokens(row: RunTokenSumRow) {
  return {
    tokensInput: runCount(row.tokens_input, "run input tokens"),
    tokensOutput: runCount(row.tokens_output, "run output tokens"),
    tokensCacheCreation: runCount(
      row.tokens_cache_creation,
      "run cache creation tokens",
    ),
    tokensCacheRead: runCount(row.tokens_cache_read, "run cache read tokens"),
  };
}

function runCostBasis(value: string | null): RunCostBasis {
  const basis = runCostBases.find((known) => known === value);
  if (basis === undefined)
    throw new Error("run evidence read: unknown cost basis");
  return basis;
}

function runModelUsage(row: RunModelRow): RunModelUsage {
  return {
    ...runTokens(row),
    model: row.model,
    costUsdMicros: runCount(row.cost_usd_micros, "run model cost"),
  };
}

/** One totals row and its per-model breakdown, as the wire carries them together. */
function runTotals(
  row: RunTotalRow,
  models: readonly RunModelUsage[],
  labels: {
    readonly resultSubtype?: string;
    readonly stopReason?: string;
  } = {},
): RunTotals {
  return {
    ...runTokens(row),
    turns: runCount(row.turns, "run turns"),
    durationMs: runCount(row.duration_ms, "run duration"),
    durationApiMs: runCount(row.duration_api_ms, "run api duration"),
    costUsdMicros: runCount(row.cost_usd_micros, "run cost"),
    costBasis: runCostBasis(row.cost_basis),
    models,
    permissionDenials: runCount(
      row.permission_denials,
      "run permission denials",
    ),
    ...labels,
  };
}

interface RunExecutionTotalRow extends RunTotalRow {
  readonly execution: string;
}

interface RunExecutionModelRow extends RunStoredModelRow {
  readonly execution: string;
}

async function runExecutionModels(
  pool: pg.Pool,
  partition: Partition,
  executions: readonly string[],
): Promise<ReadonlyMap<string, RunModelUsage[]>> {
  const found = await pool.query<RunExecutionModelRow>(
    sql`SELECT execution,model,tokens_input,tokens_output,
               tokens_cache_creation,tokens_cache_read,cost_usd_micros
          FROM (SELECT m.execution,m.model,
                       sum(m.tokens_input)::text AS tokens_input,
                       sum(m.tokens_output)::text AS tokens_output,
                       sum(m.tokens_cache_creation)::text AS tokens_cache_creation,
                       sum(m.tokens_cache_read)::text AS tokens_cache_read,
                       sum(m.cost_usd_micros)::text AS cost_usd_micros,
                       row_number() OVER (PARTITION BY m.execution ORDER BY m.model)
                         AS rank
                  FROM execution_run_model_usage m
                 WHERE m.tenant=${partition.tenant} AND m.project=${partition.project}
                   AND m.execution=ANY(${[...executions]}::text[])
                 GROUP BY m.execution,m.model) ranked
         WHERE rank<=${nativeHttpPageItemsMax}
         ORDER BY execution,model`,
  );
  const models = new Map<string, RunModelUsage[]>();
  for (const row of found.rows) {
    const listed = models.get(row.execution) ?? [];
    listed.push(runModelUsage(row));
    models.set(row.execution, listed);
  }
  return models;
}

/** What each named execution's attempts sum to, which is the run row's own figure. */
export async function postgresExecutionRunTotals(
  pool: pg.Pool,
  partition: Partition,
  executions: readonly string[],
): Promise<ReadonlyMap<string, RunTotals>> {
  if (executions.length === 0) return new Map();
  const found = await pool.query<RunExecutionTotalRow>(
    sql`SELECT t.execution,sum(t.turns)::text AS turns,
               sum(t.duration_ms)::text AS duration_ms,
               sum(t.duration_api_ms)::text AS duration_api_ms,
               sum(t.tokens_input)::text AS tokens_input,
               sum(t.tokens_output)::text AS tokens_output,
               sum(t.tokens_cache_creation)::text AS tokens_cache_creation,
               sum(t.tokens_cache_read)::text AS tokens_cache_read,
               sum(t.cost_usd_micros)::text AS cost_usd_micros,
               min(t.cost_basis) AS cost_basis,
               sum(t.permission_denials)::text AS permission_denials
          FROM execution_run_total t
         WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
           AND t.execution=ANY(${[...executions]}::text[])
         GROUP BY t.execution`,
  );
  const models = await runExecutionModels(pool, partition, executions);
  return new Map(
    found.rows.map((row) => [
      row.execution,
      runTotals(row, models.get(row.execution) ?? []),
    ]),
  );
}

/** What every run of every execution of one ticket sums to, past any page bound. */
export async function postgresTicketRunTotals(
  pool: pg.Pool,
  partition: Partition,
  ticket: TicketId,
): Promise<RunTotals | undefined> {
  const found = await pool.query<RunTotalRow>(
    sql`SELECT sum(t.turns)::text AS turns,
               sum(t.duration_ms)::text AS duration_ms,
               sum(t.duration_api_ms)::text AS duration_api_ms,
               sum(t.tokens_input)::text AS tokens_input,
               sum(t.tokens_output)::text AS tokens_output,
               sum(t.tokens_cache_creation)::text AS tokens_cache_creation,
               sum(t.tokens_cache_read)::text AS tokens_cache_read,
               sum(t.cost_usd_micros)::text AS cost_usd_micros,
               min(t.cost_basis) AS cost_basis,
               sum(t.permission_denials)::text AS permission_denials
          FROM execution_run_total t
          JOIN execution e ON e.tenant=t.tenant AND e.project=t.project
                          AND e.execution=t.execution
         WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
           AND e.ticket=${ticket}`,
  );
  const row = found.rows[0];
  if (row === undefined || row.cost_basis === null) return undefined;
  const models = await pool.query<RunModelRow>(
    sql`SELECT m.model,sum(m.tokens_input)::text AS tokens_input,
               sum(m.tokens_output)::text AS tokens_output,
               sum(m.tokens_cache_creation)::text AS tokens_cache_creation,
               sum(m.tokens_cache_read)::text AS tokens_cache_read,
               sum(m.cost_usd_micros)::text AS cost_usd_micros
          FROM execution_run_model_usage m
          JOIN execution e ON e.tenant=m.tenant AND e.project=m.project
                          AND e.execution=m.execution
         WHERE m.tenant=${partition.tenant} AND m.project=${partition.project}
           AND e.ticket=${ticket}
         GROUP BY m.model ORDER BY m.model LIMIT ${nativeHttpPageItemsMax}`,
  );
  return runTotals(row, models.rows.map(runModelUsage));
}

interface RunAttemptRow extends RunTotalRow {
  readonly attempt: string;
  readonly started_at: string;
  readonly turns: string;
  readonly configuration_digest: string | null;
  readonly configuration_bytes: string | null;
  readonly configuration_recorded_at: string | null;
  readonly transcript_batches: string;
  readonly transcript_bytes: string;
  readonly transcript_high_water: string;
  readonly transcript_observed_at: string | null;
  readonly turns_recorded: string;
  readonly result_subtype: string | null;
  readonly stop_reason: string | null;
}

/** The optional label pair a single run's totals carry and a rollup does not. */
function runLabels(row: RunAttemptRow) {
  return {
    ...(row.result_subtype === null
      ? {}
      : { resultSubtype: row.result_subtype }),
    ...(row.stop_reason === null ? {} : { stopReason: row.stop_reason }),
  };
}

function runResource(
  row: RunAttemptRow,
  models: readonly RunModelUsage[],
): ExecutionRunResource {
  const batches = runCount(row.transcript_batches, "run transcript batches");
  return {
    startedAt: asPublicInstant(row.started_at),
    ...(row.configuration_digest === null ||
    row.configuration_bytes === null ||
    row.configuration_recorded_at === null
      ? {}
      : {
          configuration: {
            digest: asArtifactDigest(row.configuration_digest),
            bytes: runCount(row.configuration_bytes, "run snapshot bytes"),
            recordedAt: asPublicInstant(row.configuration_recorded_at),
          },
        }),
    ...(batches === 0 || row.transcript_observed_at === null
      ? {}
      : {
          transcript: {
            batches,
            bytes: runCount(row.transcript_bytes, "run transcript bytes"),
            highWaterBatch: runCount(
              row.transcript_high_water,
              "run transcript high-water batch",
            ),
            observedAt: asPublicInstant(row.transcript_observed_at),
          },
        }),
    turnsRecorded: runCount(row.turns_recorded, "run turns recorded"),
    ...(row.cost_basis === null
      ? {}
      : { totals: runTotals(row, models, runLabels(row)) }),
  };
}

async function runAttemptModels(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
): Promise<ReadonlyMap<string, RunModelUsage[]>> {
  const found = await pool.query<RunStoredModelRow & { attempt: string }>(
    sql`SELECT attempt,model,tokens_input::text AS tokens_input,
               tokens_output::text AS tokens_output,
               tokens_cache_creation::text AS tokens_cache_creation,
               tokens_cache_read::text AS tokens_cache_read,
               cost_usd_micros::text AS cost_usd_micros
          FROM execution_run_model_usage
         WHERE tenant=${partition.tenant} AND project=${partition.project}
           AND execution=${execution}
         ORDER BY attempt,model
         LIMIT ${runAttemptsPageMax * nativeHttpPageItemsMax}`,
  );
  const models = new Map<string, RunModelUsage[]>();
  for (const row of found.rows) {
    const listed = models.get(row.attempt) ?? [];
    if (listed.length < nativeHttpPageItemsMax) listed.push(runModelUsage(row));
    models.set(row.attempt, listed);
  }
  return models;
}

/** What each attempt of one execution recorded about its own run. */
export async function postgresAttemptRuns(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
): Promise<ReadonlyMap<string, ExecutionRunResource>> {
  const found = await pool.query<RunAttemptRow>(
    sql`SELECT r.attempt,r.started_at::text AS started_at,
               r.configuration_digest,
               r.configuration_bytes::text AS configuration_bytes,
               r.configuration_recorded_at::text AS configuration_recorded_at,
               b.batches::text AS transcript_batches,
               b.bytes::text AS transcript_bytes,
               b.high_water::text AS transcript_high_water,
               b.observed_at::text AS transcript_observed_at,
               n.turns::text AS turns_recorded,
               t.turns::text AS turns,t.duration_ms::text AS duration_ms,
               t.duration_api_ms::text AS duration_api_ms,
               t.tokens_input::text AS tokens_input,
               t.tokens_output::text AS tokens_output,
               t.tokens_cache_creation::text AS tokens_cache_creation,
               t.tokens_cache_read::text AS tokens_cache_read,
               t.cost_usd_micros::text AS cost_usd_micros,
               t.cost_basis,t.permission_denials::text AS permission_denials,
               t.result_subtype,t.stop_reason
          FROM execution_run r
          CROSS JOIN LATERAL (
            SELECT count(*) AS batches,coalesce(sum(x.bytes),0) AS bytes,
                   coalesce(max(x.batch),0) AS high_water,
                   max(x.recorded_at) AS observed_at
              FROM execution_run_transcript_batch x
             WHERE x.tenant=r.tenant AND x.project=r.project
               AND x.execution=r.execution AND x.attempt=r.attempt) b
          CROSS JOIN LATERAL (
            SELECT count(*) AS turns FROM execution_run_turn y
             WHERE y.tenant=r.tenant AND y.project=r.project
               AND y.execution=r.execution AND y.attempt=r.attempt) n
          LEFT JOIN execution_run_total t
            ON t.tenant=r.tenant AND t.project=r.project
           AND t.execution=r.execution AND t.attempt=r.attempt
         WHERE r.tenant=${partition.tenant} AND r.project=${partition.project}
           AND r.execution=${execution}
         ORDER BY r.attempt LIMIT ${runAttemptsPageMax}`,
  );
  const models = await runAttemptModels(pool, partition, execution);
  return new Map(
    found.rows.map((row) => [
      row.attempt,
      runResource(row, models.get(row.attempt) ?? []),
    ]),
  );
}

interface RunAttemptStandingRow {
  readonly state: string;
  readonly opened_at: string;
  readonly observed_at: string | null;
}

/** The attempt an evidence read is about: whether it may still write, and its "as of". */
async function runAttemptStanding(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
  attempt: AttemptId,
): Promise<RunAttemptStandingRow | undefined> {
  const found = await pool.query<RunAttemptStandingRow>(
    sql`SELECT a.state,a.opened_at::text AS opened_at,
               (SELECT max(x.recorded_at)::text
                  FROM execution_run_transcript_batch x
                 WHERE x.tenant=a.tenant AND x.project=a.project
                   AND x.execution=a.execution AND x.attempt=a.attempt) AS observed_at
          FROM execution_attempt a
         WHERE a.tenant=${partition.tenant} AND a.project=${partition.project}
           AND a.execution=${execution} AND a.attempt=${attempt}`,
  );
  return found.rows[0];
}

interface RunTurnRow extends RunTokenRow {
  readonly ordinal: string;
  readonly model: string;
  readonly recorded_at: string;
}

interface RunBatchRow {
  readonly batch: string;
  readonly path: string;
  readonly digest: string;
  readonly bytes: string;
  readonly recorded_at: string;
}

async function runTurnsPage(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
  attempt: AttemptId,
  query: RunTurnsQuery,
): Promise<RunTurnsPage | undefined> {
  const standing = await runAttemptStanding(
    pool,
    partition,
    execution,
    attempt,
  );
  if (standing === undefined) return undefined;
  const found = await pool.query<RunTurnRow>(
    sql`SELECT ordinal::text AS ordinal,model,
               tokens_input::text AS tokens_input,
               tokens_output::text AS tokens_output,
               tokens_cache_creation::text AS tokens_cache_creation,
               tokens_cache_read::text AS tokens_cache_read,
               recorded_at::text AS recorded_at
          FROM execution_run_turn
         WHERE tenant=${partition.tenant} AND project=${partition.project}
           AND execution=${execution} AND attempt=${attempt}
           AND ordinal>${query.after ?? 0}
         ORDER BY execution_run_turn.ordinal LIMIT ${query.limit + 1}`,
  );
  const page = found.rows.slice(0, query.limit);
  const next = found.rows.length > query.limit ? page.at(-1) : undefined;
  return {
    turns: page.map((row) => ({
      ...runTokens(row),
      ordinal: projectRowCounter(row.ordinal, "run turn ordinal"),
      model: row.model,
      recordedAt: asPublicInstant(row.recorded_at),
    })),
    ...(next === undefined
      ? {}
      : { nextAfter: projectRowCounter(next.ordinal, "run turn cursor") }),
  };
}

async function runTranscriptStored(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
  attempt: AttemptId,
  after: number,
): Promise<RunTranscriptStored | undefined> {
  const standing = await runAttemptStanding(
    pool,
    partition,
    execution,
    attempt,
  );
  if (standing === undefined) return undefined;
  const state = allAttemptStates.find((known) => known === standing.state);
  if (state === undefined)
    throw new Error("run evidence read: unknown attempt state");
  const found = await pool.query<RunBatchRow>(
    sql`SELECT batch::text AS batch,path,digest,bytes::text AS bytes,
               recorded_at::text AS recorded_at
          FROM execution_run_transcript_batch
         WHERE tenant=${partition.tenant} AND project=${partition.project}
           AND execution=${execution} AND attempt=${attempt}
           AND batch>${after}
         ORDER BY execution_run_transcript_batch.batch
         LIMIT ${runTranscriptPageBatchesMax + 1}`,
  );
  const page = found.rows.slice(0, runTranscriptPageBatchesMax);
  const next =
    found.rows.length > runTranscriptPageBatchesMax ? page.at(-1) : undefined;
  return {
    objects: page.map((row) => ({
      partition,
      execution,
      attempt,
      path: asArtifactPath(row.path),
      digest: asArtifactDigest(row.digest),
      bytes: projectRowCounter(row.bytes, "run transcript batch bytes"),
      batch: projectRowCounter(row.batch, "run transcript batch"),
      recordedAt: asPublicInstant(row.recorded_at),
    })),
    observedAt: asPublicInstant(standing.observed_at ?? standing.opened_at),
    complete: runIsComplete(state),
    ...(next === undefined
      ? {}
      : { nextAfter: projectRowCounter(next.batch, "run transcript cursor") }),
  };
}

interface RunSnapshotRow {
  readonly configuration_path: string | null;
  readonly configuration_digest: string | null;
  readonly configuration_bytes: string | null;
}

async function runConfigurationStored(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
  attempt: AttemptId,
): Promise<RunConfigurationStored | undefined> {
  const found = await pool.query<RunSnapshotRow>(
    sql`SELECT configuration_path,configuration_digest,
               configuration_bytes::text AS configuration_bytes
          FROM execution_run
         WHERE tenant=${partition.tenant} AND project=${partition.project}
           AND execution=${execution} AND attempt=${attempt}`,
  );
  const row = found.rows[0];
  if (
    row === undefined ||
    row.configuration_path === null ||
    row.configuration_digest === null ||
    row.configuration_bytes === null
  )
    return undefined;
  return {
    object: {
      partition,
      execution,
      attempt,
      path: asArtifactPath(row.configuration_path),
      digest: asArtifactDigest(row.configuration_digest),
      bytes: projectRowCounter(row.configuration_bytes, "run snapshot bytes"),
    },
  };
}

/** Reads only API-safe run-evidence columns through a pool carrying the API credential. */
export function postgresRunEvidenceReads(pool: pg.Pool): RunEvidenceReadStore {
  return {
    turns: (partition, execution, attempt, query) =>
      runTurnsPage(pool, partition, execution, attempt, query),
    transcript: (partition, execution, attempt, after) =>
      runTranscriptStored(pool, partition, execution, attempt, after),
    configuration: (partition, execution, attempt) =>
      runConfigurationStored(pool, partition, execution, attempt),
  };
}
