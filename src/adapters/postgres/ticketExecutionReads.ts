import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  blobHolderKinds,
  type BlobRead,
  type BlobReadPort,
} from "../../interpreter/blobStore.ts";
import type { TicketId } from "../../domain/chuggernaut/task.js";
import type { Partition } from "../../interpreter/projectStore.ts";
import { ticketMachineTaskKeyPrefixes } from "../../interpreter/ticketMachine.ts";
import type {
  TicketExecutionConfiguration,
  TicketExecutionReadStore,
  TicketExecutionSummary,
  TicketExecutionTranscriptBatch,
  TicketExecutionTranscriptPage,
  TicketExecutionTurnPage,
  TicketOperationEntry,
} from "../../interpreter/ticketExecutionRead.ts";
import type {
  TicketExecutionRunModelUsage,
  TicketExecutionRunTotals,
} from "../../interpreter/ticketExecutionRun.ts";

/**
 * The rows behind an attempt's reads, drawn by the API role and authorized by
 * nothing here. Every query names its project, so a caller that reached this
 * far has already been told it may.
 */

interface ExecutionSummaryRow {
  readonly task_key: string;
  readonly state: string;
  readonly attempt: number;
  readonly attempts_unreported: number;
  readonly queued_at: Date;
  readonly last_reported_at: Date | null;
  readonly pool: string | null;
}

interface TotalRow {
  readonly turns: string;
  readonly duration_ms: string;
  readonly duration_api_ms: string;
  readonly tokens_input: string;
  readonly tokens_output: string;
  readonly tokens_cache_creation: string;
  readonly tokens_cache_read: string;
  readonly cost_usd_micros: string;
  readonly permission_denials: string;
  readonly result_subtype: string | null;
  readonly stop_reason: string | null;
}

/** A bigint arrives as text, because a count past the safe range must not read as one. */
function counted(value: string | null): number {
  const held = Number(value ?? 0);
  return Number.isSafeInteger(held) && held >= 0 ? held : 0;
}

function summaryOf(
  row: ExecutionSummaryRow,
  totals?: TicketExecutionRunTotals,
): TicketExecutionSummary {
  return {
    taskKey: row.task_key,
    state: row.state as TicketExecutionSummary["state"],
    attempt: row.attempt,
    attemptsUnreported: row.attempts_unreported,
    queuedAt: row.queued_at.toISOString(),
    ...(row.last_reported_at === null
      ? {}
      : { lastReportedAt: row.last_reported_at.toISOString() }),
    ...(row.pool === null ? {} : { pool: row.pool }),
    ...(totals === undefined ? {} : { totals }),
  };
}

function totalsOf(
  row: TotalRow,
  models: readonly TicketExecutionRunModelUsage[],
): TicketExecutionRunTotals {
  return {
    turns: counted(row.turns),
    durationMs: counted(row.duration_ms),
    durationApiMs: counted(row.duration_api_ms),
    tokensInput: counted(row.tokens_input),
    tokensOutput: counted(row.tokens_output),
    tokensCacheCreation: counted(row.tokens_cache_creation),
    tokensCacheRead: counted(row.tokens_cache_read),
    costUsdMicros: counted(row.cost_usd_micros),
    costBasis: "List",
    permissionDenials: counted(row.permission_denials),
    models,
    ...(row.result_subtype === null
      ? {}
      : { resultSubtype: row.result_subtype }),
    ...(row.stop_reason === null ? {} : { stopReason: row.stop_reason }),
  };
}

/** The per-model breakdown one attempt recorded beside its totals. */
async function readModels(
  pool: pg.Pool,
  partition: Partition,
  taskKey: string,
  attempt: number,
): Promise<readonly TicketExecutionRunModelUsage[]> {
  const found = await pool.query<{
    model: string;
    tokens_input: string;
    tokens_output: string;
    tokens_cache_creation: string;
    tokens_cache_read: string;
    cost_usd_micros: string;
  }>(sql`SELECT model,tokens_input,tokens_output,tokens_cache_creation,
      tokens_cache_read,cost_usd_micros
    FROM ticket_execution_run_model_usage
    WHERE tenant=${partition.tenant} AND project=${partition.project}
      AND task_key=${taskKey} AND attempt=${attempt}
    ORDER BY model`);
  return found.rows.map((row) => ({
    model: row.model,
    tokensInput: counted(row.tokens_input),
    tokensOutput: counted(row.tokens_output),
    tokensCacheCreation: counted(row.tokens_cache_creation),
    tokensCacheRead: counted(row.tokens_cache_read),
    costUsdMicros: counted(row.cost_usd_micros),
  }));
}

/** What one attempt said it spent, with the models it spent it on. */
async function readTotals(
  pool: pg.Pool,
  partition: Partition,
  taskKey: string,
  attempt: number,
): Promise<TicketExecutionRunTotals | undefined> {
  const found =
    await pool.query<TotalRow>(sql`SELECT turns,duration_ms,duration_api_ms,
      tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,
      cost_usd_micros,permission_denials,result_subtype,stop_reason
    FROM ticket_execution_run_total
    WHERE tenant=${partition.tenant} AND project=${partition.project}
      AND task_key=${taskKey} AND attempt=${attempt}`);
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : totalsOf(row, await readModels(pool, partition, taskKey, attempt));
}

/**
 * The project's executions, or one ticket's. A ticket is matched by the key
 * prefixes the machine renders for it, which keeps the page a page of that
 * ticket's rows rather than a project page a caller filters afterwards and
 * finds short.
 */
async function readExecutions(
  pool: pg.Pool,
  partition: Partition,
  limit: number,
  ticket: TicketId | undefined,
): Promise<readonly TicketExecutionSummary[]> {
  const patterns =
    ticket === undefined
      ? null
      : ticketMachineTaskKeyPrefixes(ticket).map((prefix) => `${prefix}%`);
  const found =
    await pool.query<ExecutionSummaryRow>(sql`SELECT task_key,state,attempt,
      attempts_unreported,queued_at,last_reported_at,pool
    FROM ticket_execution
    WHERE tenant=${partition.tenant} AND project=${partition.project}
      AND (${patterns}::text[] IS NULL OR task_key LIKE ANY(${patterns}::text[]))
    ORDER BY queued_at DESC, task_key LIMIT ${limit}`);
  return found.rows.map((row) => summaryOf(row));
}

async function readExecution(
  pool: pg.Pool,
  partition: Partition,
  taskKey: string,
): Promise<TicketExecutionSummary | undefined> {
  const found =
    await pool.query<ExecutionSummaryRow>(sql`SELECT task_key,state,attempt,
      attempts_unreported,queued_at,last_reported_at,pool
    FROM ticket_execution
    WHERE tenant=${partition.tenant} AND project=${partition.project}
      AND task_key=${taskKey}`);
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : summaryOf(row, await readTotals(pool, partition, taskKey, row.attempt));
}

async function readTurns(
  pool: pg.Pool,
  partition: Partition,
  taskKey: string,
  attempt: number,
  after: number,
  limit: number,
): Promise<TicketExecutionTurnPage> {
  const found = await pool.query<{
    ordinal: number;
    model: string;
    tokens_input: string;
    tokens_output: string;
    tokens_cache_creation: string;
    tokens_cache_read: string;
    recorded_at: Date;
  }>(sql`SELECT ordinal,model,tokens_input,tokens_output,
      tokens_cache_creation,tokens_cache_read,recorded_at
    FROM ticket_execution_run_turn
    WHERE tenant=${partition.tenant} AND project=${partition.project}
      AND task_key=${taskKey} AND attempt=${attempt} AND ordinal>${after}
    ORDER BY ordinal LIMIT ${limit + 1}`);
  const page = found.rows.slice(0, limit);
  return {
    turns: page.map((row) => ({
      ordinal: row.ordinal,
      model: row.model,
      tokensInput: counted(row.tokens_input),
      tokensOutput: counted(row.tokens_output),
      tokensCacheCreation: counted(row.tokens_cache_creation),
      tokensCacheRead: counted(row.tokens_cache_read),
      recordedAt: row.recorded_at.toISOString(),
    })),
    ...(found.rows.length > limit
      ? { nextAfter: page[page.length - 1]?.ordinal ?? after }
      : {}),
  };
}

/** How a stored batch reads, a store that lost it and one that cannot speak for it differing. */
function blobRead(read: BlobRead): TicketExecutionTranscriptBatch["read"] {
  if (read.read === "Content") return "Content";
  return read.read === "Corrupt" ? "Corrupt" : "Missing";
}

async function readTranscript(
  pool: pg.Pool,
  blobs: BlobReadPort,
  partition: Partition,
  taskKey: string,
  attempt: number,
  after: number,
  batchesMax: number,
): Promise<TicketExecutionTranscriptPage> {
  const found = await pool.query<{
    batch: number;
    bytes: string;
    events: string;
    recorded_at: Date;
  }>(sql`SELECT batch,bytes,events,recorded_at
    FROM ticket_execution_run_transcript_batch
    WHERE tenant=${partition.tenant} AND project=${partition.project}
      AND task_key=${taskKey} AND attempt=${attempt} AND batch>${after}
    ORDER BY batch LIMIT ${batchesMax + 1}`);
  const page = found.rows.slice(0, batchesMax);
  const batches: TicketExecutionTranscriptBatch[] = [];
  for (const row of page) {
    const read = await blobs.readBlob({
      partition,
      holder: attemptHolder(taskKey, attempt, "transcript"),
      batch: row.batch,
    });
    batches.push({
      batch: row.batch,
      bytes: counted(row.bytes),
      events: counted(row.events),
      recordedAt: row.recorded_at.toISOString(),
      read: blobRead(read),
      ...(read.read === "Content" ? { content: read.content } : {}),
    });
  }
  return {
    batches,
    ...(found.rows.length > batchesMax
      ? { nextAfter: page[page.length - 1]?.batch ?? after }
      : {}),
  };
}

async function readConfiguration(
  pool: pg.Pool,
  blobs: BlobReadPort,
  partition: Partition,
  taskKey: string,
  attempt: number,
): Promise<TicketExecutionConfiguration | undefined> {
  const found = await pool.query<{
    digest: string;
    bytes: string;
    recorded_at: Date;
  }>(sql`SELECT digest,bytes,recorded_at
    FROM ticket_execution_run_configuration
    WHERE tenant=${partition.tenant} AND project=${partition.project}
      AND task_key=${taskKey} AND attempt=${attempt}`);
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const read = await blobs.readBlob({
    partition,
    holder: attemptHolder(taskKey, attempt, "configuration"),
    batch: 1,
  });
  return {
    digest: row.digest,
    bytes: counted(row.bytes),
    recordedAt: row.recorded_at.toISOString(),
    read: blobRead(read),
    ...(read.read === "Content" ? { content: read.content } : {}),
  };
}

async function readOperations(
  pool: pg.Pool,
  partition: Partition,
  limit: number,
): Promise<readonly TicketOperationEntry[]> {
  const found = await pool.query<{
    identity: string;
    sequence: string;
    origin: string;
    attribution: string;
    command: string;
  }>(sql`SELECT identity,sequence,origin,attribution,command
    FROM ticket_machine_input
    WHERE tenant=${partition.tenant} AND project=${partition.project}
    ORDER BY sequence DESC LIMIT ${limit}`);
  return found.rows.map((row): TicketOperationEntry => ({
    identity: row.identity,
    sequence: counted(row.sequence),
    origin: row.origin as TicketOperationEntry["origin"],
    attribution: row.attribution,
    command: row.command,
  }));
}

/** The holder one attempt's own stream of bytes was stored under. */
function attemptHolder(taskKey: string, attempt: number, stream: string) {
  return {
    kind: blobHolderKinds.attempt,
    parts: [taskKey, String(attempt), stream],
  };
}

export function postgresTicketExecutionReads(
  pool: pg.Pool,
  blobs: BlobReadPort,
  transcriptPageBatchesMax: number,
): TicketExecutionReadStore {
  return {
    models: (partition, taskKey, attempt) =>
      readModels(pool, partition, taskKey, attempt),
    executions: (partition, limit, ticket) =>
      readExecutions(pool, partition, limit, ticket),
    execution: (partition, taskKey) => readExecution(pool, partition, taskKey),
    turns: (partition, taskKey, attempt, after, limit) =>
      readTurns(pool, partition, taskKey, attempt, after, limit),
    transcript: (partition, taskKey, attempt, after) =>
      readTranscript(
        pool,
        blobs,
        partition,
        taskKey,
        attempt,
        after,
        transcriptPageBatchesMax,
      ),
    configuration: (partition, taskKey, attempt) =>
      readConfiguration(pool, blobs, partition, taskKey, attempt),
    operations: (partition, limit) => readOperations(pool, partition, limit),
  };
}
