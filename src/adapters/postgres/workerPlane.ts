import { createHash, randomUUID } from "node:crypto";
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  asAttemptId,
  asExecutionId,
  type AttemptCapabilitySecret,
  type AttemptEvidence,
  type AttemptLoss,
  type AttemptReport,
  type ExecutionSchedulerStore,
  type Terminalized,
} from "../../interpreter/executionScheduler.ts";
import { inputBundleReferencesMax } from "../../interpreter/finalizer.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import { asResultManifestId } from "../../interpreter/resultManifest.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import type {
  WorkerAttemptAuthority,
  WorkerArtifactReservationPort,
  WorkerInputReference,
  WorkerPlaneAuthority,
} from "../../interpreter/workerPlane.ts";
import { projectRowCounter } from "./rows.ts";

interface WorkerAuthorityRow {
  readonly tenant: string | null;
  readonly project: string | null;
  readonly execution: string | null;
  readonly attempt: string | null;
  readonly generation: string | null;
  readonly manifest: string | null;
  readonly input_bundle: string | null;
  readonly input_bundle_digest: string | null;
  readonly live: boolean | null;
  readonly inputs: unknown;
}

function workerInput(
  row: Readonly<Record<string, unknown>>,
): WorkerInputReference {
  if (
    typeof row["ordinal"] !== "number" ||
    typeof row["kind"] !== "string" ||
    typeof row["reference"] !== "string"
  )
    throw new Error(
      "postgres worker plane: input reference has an invalid shape",
    );
  return {
    ordinal: projectRowCounter(
      String(row["ordinal"]),
      "input reference ordinal",
    ),
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
               manifest,input_bundle,input_bundle_digest,live,inputs
          FROM read_worker_attempt(${digest})`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  if (
    row.tenant === null ||
    row.project === null ||
    row.execution === null ||
    row.attempt === null ||
    row.generation === null ||
    row.manifest === null ||
    row.input_bundle === null ||
    row.input_bundle_digest === null ||
    row.live === null
  )
    throw new Error("postgres worker plane: authority has an invalid shape");
  const inputs = row.inputs;
  if (!Array.isArray(inputs) || inputs.length > inputBundleReferencesMax)
    throw new Error(
      "postgres worker plane: input references exceed their bound",
    );
  return {
    partition: {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    },
    execution: asExecutionId(row.execution),
    attempt: asAttemptId(row.attempt),
    generation: projectRowCounter(row.generation, "attempt generation"),
    live: row.live,
    manifest: asResultManifestId(row.manifest),
    inputBundle: row.input_bundle,
    inputBundleDigest: row.input_bundle_digest,
    inputs: inputs.map((input) =>
      workerInput(input as Readonly<Record<string, unknown>>),
    ),
  };
}

export function postgresWorkerPlaneAuthority(
  pool: pg.Pool,
): WorkerPlaneAuthority {
  return { authenticate: (secret) => workerAuthenticate(pool, secret) };
}

export function postgresWorkerArtifactReservations(
  pool: pg.Pool,
): WorkerArtifactReservationPort {
  return {
    reserve: async (input) => {
      const secretDigest = createHash("sha256")
        .update(input.secret, "utf8")
        .digest("hex");
      const reserved = await pool.query<{ reserved: string | null }>(
        sql`SELECT reserve_worker_artifact(
          ${secretDigest},${input.path},${input.digest},${input.bytes})::text AS reserved`,
      );
      const verdict = reserved.rows[0]?.reserved;
      switch (verdict) {
        case "Reserved":
          return { reserved: "Reserved" };
        case "Conflict":
          return { reserved: "Conflict" };
        case "Fenced":
          return { reserved: "Fenced" };
        case "QuotaExceeded":
          return { reserved: "QuotaExceeded" };
        case undefined:
          throw new Error(
            "postgres worker plane: artifact reservation returned no verdict",
          );
        case null:
          throw new Error(
            "postgres worker plane: artifact reservation returned a null verdict",
          );
        default:
          throw new Error(
            `postgres worker plane: unknown artifact reservation ${String(verdict)}`,
          );
      }
    },
  };
}

interface WorkerResultRow {
  readonly terminalized: string | null;
  readonly outcome: string | null;
  readonly operation: string | null;
  readonly incident: string | null;
}

function workerTerminalized(row: WorkerResultRow): Terminalized {
  switch (row.terminalized) {
    case "Terminalized":
    case "AlreadyTerminal":
      if (
        (row.outcome !== "Passed" &&
          row.outcome !== "Failed" &&
          row.outcome !== "Blocked") ||
        row.operation === null
      )
        throw new Error(
          "postgres worker plane: terminal result omitted its settlement",
        );
      return {
        terminalized: row.terminalized,
        outcome: row.outcome,
        operation: asOperationId(row.operation),
      };
    case "Fenced":
    case "Cancelled":
    case "NotAdmitted":
      return { terminalized: row.terminalized };
    case "Conflicting":
      if (row.incident === null)
        throw new Error("postgres worker plane: conflict omitted its incident");
      return { terminalized: "Conflicting", incident: row.incident };
    case null:
      throw new Error(
        "postgres worker plane: terminal result omitted its verdict",
      );
    default:
      throw new Error(
        `postgres worker plane: unknown terminal result ${row.terminalized}`,
      );
  }
}

export function postgresWorkerReportStore(
  pool: pg.Pool,
  secret: AttemptCapabilitySecret,
): Pick<ExecutionSchedulerStore, "attemptEnded" | "terminalize"> {
  const secretDigest = createHash("sha256")
    .update(secret, "utf8")
    .digest("hex");
  return {
    attemptEnded: async (
      _attempt,
      loss: AttemptLoss,
      evidence: AttemptEvidence,
    ) => {
      if (loss !== "Lost")
        throw new Error(
          "postgres worker plane: ingress may only lose a reporting attempt",
        );
      const ended = await pool.query<{ ended: boolean | null }>(
        sql`SELECT lose_worker_attempt(${secretDigest},${_attempt.generation},${evidence})::boolean AS ended`,
      );
      return ended.rows[0]?.ended === true;
    },
    terminalize: async (report: AttemptReport) => {
      const artifacts = [
        ...report.manifest.handoffs.map((artifact, index) => ({
          ordinal: index + 1,
          role: "Handoff",
          path: artifact.path,
          digest: artifact.digest,
          bytes: artifact.bytes,
        })),
        ...report.manifest.diagnostics.map((artifact, index) => ({
          ordinal: report.manifest.handoffs.length + index + 1,
          role: "Diagnostic",
          path: artifact.path,
          digest: artifact.digest,
          bytes: artifact.bytes,
        })),
      ];
      const operation = `completion-${randomUUID()}`;
      const result = await pool.query<WorkerResultRow>(
        sql`SELECT terminalized,outcome,operation,incident FROM submit_worker_result(
          ${secretDigest},${report.generation},${report.manifest.manifest},
          ${report.manifest.schemaVersion},${report.manifest.digest},${report.manifest.verdict},
          ${JSON.stringify(artifacts)}::jsonb,
          ${report.manifest.source === undefined ? null : JSON.stringify(report.manifest.source)}::jsonb,
          ${operation})`,
      );
      const row = result.rows[0];
      if (row === undefined)
        throw new Error(
          "postgres worker plane: result boundary returned no outcome",
        );
      return workerTerminalized(row);
    },
  };
}
