import { createHash } from "node:crypto";
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  asAttemptId,
  asExecutionId,
  type AttemptCapabilitySecret,
} from "../../interpreter/executionScheduler.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import { asResultManifestId } from "../../interpreter/resultManifest.ts";
import type {
  WorkerAttemptAuthority,
  WorkerInputReference,
  WorkerPlaneAuthority,
} from "../../interpreter/workerPlane.ts";
import { projectRowCounter } from "./rows.ts";

interface WorkerAuthorityRow {
  readonly tenant: string;
  readonly project: string;
  readonly execution: string;
  readonly attempt: string;
  readonly generation: string;
  readonly manifest: string;
  readonly input_bundle: string;
  readonly input_bundle_digest: string;
  readonly inputs: unknown;
}

function workerInput(row: Readonly<Record<string, unknown>>): WorkerInputReference {
  if (typeof row["ordinal"] !== "number" || typeof row["kind"] !== "string" || typeof row["reference"] !== "string")
    throw new Error("postgres worker plane: input reference has an invalid shape");
  return {
    ordinal: projectRowCounter(String(row["ordinal"]), "input reference ordinal"),
    kind: row["kind"],
    reference: row["reference"],
    ...(typeof row["digest"] === "string" ? { digest: row["digest"] } : {}),
  };
}

async function workerAuthenticate(
  pool: pg.Pool,
  secret: AttemptCapabilitySecret,
): Promise<WorkerAttemptAuthority | undefined> {
  const digest = createHash("sha256").update(secret, "utf8").digest("hex");
  const found = await pool.query<WorkerAuthorityRow>(
    sql`SELECT tenant,project,execution,attempt,generation::text AS generation,
               manifest,input_bundle,input_bundle_digest,inputs
          FROM read_worker_attempt(${digest})`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const inputs = row.inputs;
  if (!Array.isArray(inputs) || inputs.length > 512)
    throw new Error("postgres worker plane: input references exceed their bound");
  return {
    partition: { tenant: asTenantId(row.tenant), project: asProjectId(row.project) },
    execution: asExecutionId(row.execution),
    attempt: asAttemptId(row.attempt),
    generation: projectRowCounter(row.generation, "attempt generation"),
    manifest: asResultManifestId(row.manifest),
    inputBundle: row.input_bundle,
    inputBundleDigest: row.input_bundle_digest,
    inputs: inputs.map((input) => workerInput(input as Readonly<Record<string, unknown>>)),
  };
}

export function postgresWorkerPlaneAuthority(pool: pg.Pool): WorkerPlaneAuthority {
  return { authenticate: (secret) => workerAuthenticate(pool, secret) };
}
