import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import { createHash } from "node:crypto";

import type { BlobWritePort } from "../../interpreter/blobStore.ts";
import { blobHolderKinds } from "../../interpreter/blobStore.ts";
import {
  ticketExecutionRunConfigurationBytesMax,
  ticketExecutionRunTranscriptBatchesMax,
  ticketExecutionRunTranscriptBytesMax,
} from "../../contract/http.ts";
import type {
  TicketExecutionRunEvidenceStored,
  TicketExecutionRunPort,
  TicketExecutionRunStored,
  TicketExecutionRunTotals,
  TicketExecutionRunTurn,
} from "../../interpreter/ticketExecutionRun.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";

/**
 * Writes one attempt's measures, addressed by the bearer that attempt answers
 * under. The bearer resolves the row, so a harness names no tenant, no project
 * and no attempt of its own and cannot write to another's.
 */

interface RunAttemptRow {
  readonly tenant: string;
  readonly project: string;
  readonly task_key: string;
  readonly attempt: number;
}

/** The live attempt one bearer stands for, or nothing if it stands for none. */
async function runAttempt(
  pool: pg.Pool,
  capabilityDigest: string,
): Promise<RunAttemptRow | undefined> {
  const found =
    await pool.query<RunAttemptRow>(sql`SELECT tenant,project,task_key,attempt
    FROM ticket_execution
    WHERE capability_digest=${capabilityDigest}
      AND state='Running' AND claim_expires_at>now()
      AND recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`);
  return found.rows[0];
}

/** The partition one attempt stands in, which the store keys its bytes under. */
function runPartition(held: RunAttemptRow): Partition {
  return { tenant: held.tenant, project: held.project } as Partition;
}

/** The holder one attempt's own stream of bytes is stored under. */
function runHolder(held: RunAttemptRow, stream: string) {
  return {
    kind: blobHolderKinds.attempt,
    parts: [held.task_key, String(held.attempt), stream],
  };
}

/** The digest and the event count the plane measured, which are not what the harness said. */
function runMeasuredBytes(content: Uint8Array): {
  readonly digest: string;
  readonly bytes: number;
  readonly events: number;
} {
  let events = 0;
  for (const byte of content) if (byte === 0x0a) events += 1;
  return {
    digest: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
    events,
  };
}

export function postgresTicketExecutionRun(
  pool: pg.Pool,
  blobs: BlobWritePort,
): TicketExecutionRunPort {
  const digest = (secret: string): string =>
    createHash("sha256").update(secret).digest("hex");
  return {
    turns: async (secret, turns) => {
      const held = await runAttempt(pool, digest(secret));
      if (held === undefined) return "Fenced";
      return runTurnsStored(pool, held, turns);
    },
    totals: async (secret, totals) => {
      const held = await runAttempt(pool, digest(secret));
      if (held === undefined) return "Fenced";
      return runTotalsStored(pool, held, totals);
    },
    transcript: async (secret, batch, content) => {
      if (content.byteLength > ticketExecutionRunTranscriptBytesMax)
        return "TooLarge";
      if (batch < 1 || batch > ticketExecutionRunTranscriptBatchesMax)
        return "OutOfOrder";
      const held = await runAttempt(pool, digest(secret));
      if (held === undefined) return "Fenced";
      return runTranscriptStored(pool, blobs, held, batch, content);
    },
    configuration: async (secret, content) => {
      if (content.byteLength > ticketExecutionRunConfigurationBytesMax)
        return "TooLarge";
      const held = await runAttempt(pool, digest(secret));
      if (held === undefined) return "Fenced";
      return runConfigurationStored(pool, blobs, held, content);
    },
  };
}

/**
 * Stores one transcript batch, which must be the next one. The bytes land in
 * the blob store before the row that points at them, so a row a reader finds
 * always has something behind it.
 */
async function runTranscriptStored(
  pool: pg.Pool,
  blobs: BlobWritePort,
  held: RunAttemptRow,
  batch: number,
  content: Uint8Array,
): Promise<TicketExecutionRunEvidenceStored> {
  const measured = runMeasuredBytes(content);
  const highest = await pool.query<{
    highest: string | null;
  }>(sql`SELECT max(batch)::text AS highest
    FROM ticket_execution_run_transcript_batch
    WHERE tenant=${held.tenant} AND project=${held.project}
      AND task_key=${held.task_key} AND attempt=${held.attempt}`);
  const next = Number(highest.rows[0]?.highest ?? 0) + 1;
  if (batch > next) return "OutOfOrder";
  const stored = await blobs.storeBlob({
    partition: runPartition(held),
    holder: runHolder(held, "transcript"),
    batch,
    content,
  });
  if (stored.stored === "Refused") return "TooLarge";
  if (stored.stored === "Unavailable") return "Unavailable";
  if (stored.stored === "Conflict") return "Conflict";
  const written =
    await pool.query(sql`INSERT INTO ticket_execution_run_transcript_batch
    (tenant,project,task_key,attempt,batch,digest,bytes,events)
    VALUES (${held.tenant},${held.project},${held.task_key},${held.attempt},
      ${batch},${measured.digest},${measured.bytes},${measured.events})
    ON CONFLICT (tenant,project,task_key,attempt,batch) DO NOTHING`);
  if ((written.rowCount ?? 0) === 1) return "Stored";
  const prior = await pool.query<{ digest: string }>(sql`SELECT digest
    FROM ticket_execution_run_transcript_batch
    WHERE tenant=${held.tenant} AND project=${held.project}
      AND task_key=${held.task_key} AND attempt=${held.attempt} AND batch=${batch}`);
  return prior.rows[0]?.digest === measured.digest
    ? "AlreadyStored"
    : "Conflict";
}

/** Stores the configuration one attempt ran under, once. */
async function runConfigurationStored(
  pool: pg.Pool,
  blobs: BlobWritePort,
  held: RunAttemptRow,
  content: Uint8Array,
): Promise<TicketExecutionRunEvidenceStored> {
  const measured = runMeasuredBytes(content);
  const stored = await blobs.storeBlob({
    partition: runPartition(held),
    holder: runHolder(held, "configuration"),
    batch: 1,
    content,
  });
  if (stored.stored === "Refused") return "TooLarge";
  if (stored.stored === "Unavailable") return "Unavailable";
  if (stored.stored === "Conflict") return "Conflict";
  const written =
    await pool.query(sql`INSERT INTO ticket_execution_run_configuration
    (tenant,project,task_key,attempt,digest,bytes)
    VALUES (${held.tenant},${held.project},${held.task_key},${held.attempt},
      ${measured.digest},${measured.bytes})
    ON CONFLICT (tenant,project,task_key,attempt) DO NOTHING`);
  if ((written.rowCount ?? 0) === 1) return "Stored";
  const prior = await pool.query<{ digest: string }>(sql`SELECT digest
    FROM ticket_execution_run_configuration
    WHERE tenant=${held.tenant} AND project=${held.project}
      AND task_key=${held.task_key} AND attempt=${held.attempt}`);
  return prior.rows[0]?.digest === measured.digest
    ? "AlreadyStored"
    : "Conflict";
}

/**
 * Stores a page of turns, each once. A turn already stored with the same counts
 * is the same fact; one stored with different counts is a conflict, because an
 * ordinal is what a reader pages by and two answers for it cannot both be read.
 */
async function runTurnsStored(
  pool: pg.Pool,
  held: RunAttemptRow,
  turns: readonly TicketExecutionRunTurn[],
): Promise<TicketExecutionRunStored> {
  if (turns.length === 0) return "AlreadyStored";
  return postgresTransaction(pool, async (client) => {
    let stored = 0;
    for (const turn of turns) {
      const written =
        await client.query(sql`INSERT INTO ticket_execution_run_turn
        (tenant,project,task_key,attempt,ordinal,model,
         tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read)
        VALUES (${held.tenant},${held.project},${held.task_key},${held.attempt},
          ${turn.ordinal},${turn.model},${turn.tokensInput},${turn.tokensOutput},
          ${turn.tokensCacheCreation},${turn.tokensCacheRead})
        ON CONFLICT (tenant,project,task_key,attempt,ordinal) DO NOTHING`);
      stored += written.rowCount ?? 0;
    }
    if (stored === turns.length) return "Stored";
    return (await runTurnsAgree(client, held, turns))
      ? "AlreadyStored"
      : "Conflict";
  });
}

/** Whether every turn already stored says what this report says it says. */
async function runTurnsAgree(
  client: pg.PoolClient,
  held: RunAttemptRow,
  turns: readonly TicketExecutionRunTurn[],
): Promise<boolean> {
  for (const turn of turns) {
    const found = await client.query<{ agrees: boolean }>(sql`SELECT
      (model=${turn.model} AND tokens_input=${turn.tokensInput}
       AND tokens_output=${turn.tokensOutput}
       AND tokens_cache_creation=${turn.tokensCacheCreation}
       AND tokens_cache_read=${turn.tokensCacheRead}) AS agrees
      FROM ticket_execution_run_turn
      WHERE tenant=${held.tenant} AND project=${held.project}
        AND task_key=${held.task_key} AND attempt=${held.attempt}
        AND ordinal=${turn.ordinal}`);
    if (found.rows[0]?.agrees !== true) return false;
  }
  return true;
}

/** Stores one attempt's totals and their per-model breakdown, once. */
async function runTotalsStored(
  pool: pg.Pool,
  held: RunAttemptRow,
  totals: TicketExecutionRunTotals,
): Promise<TicketExecutionRunStored> {
  return postgresTransaction(pool, async (client) => {
    const written =
      await client.query(sql`INSERT INTO ticket_execution_run_total
      (tenant,project,task_key,attempt,turns,duration_ms,duration_api_ms,
       tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,
       cost_usd_micros,cost_basis,permission_denials,result_subtype,stop_reason)
      VALUES (${held.tenant},${held.project},${held.task_key},${held.attempt},
        ${totals.turns},${totals.durationMs},${totals.durationApiMs},
        ${totals.tokensInput},${totals.tokensOutput},${totals.tokensCacheCreation},
        ${totals.tokensCacheRead},${totals.costUsdMicros},${totals.costBasis},
        ${totals.permissionDenials},${totals.resultSubtype ?? null},
        ${totals.stopReason ?? null})
      ON CONFLICT (tenant,project,task_key,attempt) DO NOTHING`);
    if ((written.rowCount ?? 0) === 0)
      return (await runTotalsAgree(client, held, totals))
        ? "AlreadyStored"
        : "Conflict";
    for (const usage of totals.models)
      await client.query(sql`INSERT INTO ticket_execution_run_model_usage
        (tenant,project,task_key,attempt,model,
         tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,cost_usd_micros)
        VALUES (${held.tenant},${held.project},${held.task_key},${held.attempt},
          ${usage.model},${usage.tokensInput},${usage.tokensOutput},
          ${usage.tokensCacheCreation},${usage.tokensCacheRead},${usage.costUsdMicros})
        ON CONFLICT (tenant,project,task_key,attempt,model) DO NOTHING`);
    return "Stored";
  });
}

/** Whether the totals already stored say what this report says they say. */
async function runTotalsAgree(
  client: pg.PoolClient,
  held: RunAttemptRow,
  totals: TicketExecutionRunTotals,
): Promise<boolean> {
  const found = await client.query<{ agrees: boolean }>(sql`SELECT
    (turns=${totals.turns} AND duration_ms=${totals.durationMs}
     AND duration_api_ms=${totals.durationApiMs}
     AND tokens_input=${totals.tokensInput} AND tokens_output=${totals.tokensOutput}
     AND tokens_cache_creation=${totals.tokensCacheCreation}
     AND tokens_cache_read=${totals.tokensCacheRead}
     AND cost_usd_micros=${totals.costUsdMicros}
     AND permission_denials=${totals.permissionDenials}) AS agrees
    FROM ticket_execution_run_total
    WHERE tenant=${held.tenant} AND project=${held.project}
      AND task_key=${held.task_key} AND attempt=${held.attempt}`);
  return found.rows[0]?.agrees === true;
}
