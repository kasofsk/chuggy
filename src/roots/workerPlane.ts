import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  artifactStore,
  type ArtifactStore,
} from "../adapters/artifacts/artifactStore.ts";
import {
  createWorkerPlaneApp,
  type SessionPlaneService,
} from "../adapters/http/workerPlaneServer.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { workerPlaneRole } from "../adapters/postgres/schema.ts";
import { postgresSessionPlane } from "../adapters/postgres/sessionPlane.ts";
import {
  postgresWorkerPlaneAuthority,
  postgresWorkerAttemptHeartbeats,
  postgresWorkerArtifactReservations,
  postgresWorkerReportStore,
  postgresWorkerRunConfiguration,
  postgresWorkerRunEnded,
  postgresWorkerRunTotal,
  postgresWorkerRunTranscript,
  postgresWorkerRunTurns,
} from "../adapters/postgres/workerPlane.ts";
import { workerPlaneUploadBytesMax } from "../contract/http.ts";
import { silentSchedulerTelemetry } from "../interpreter/executionScheduler.ts";
import { executionSchedulerIngest } from "../interpreter/executionSchedulerReport.ts";
import { sessionSchedulerDefaults } from "../interpreter/sessionScheduler.ts";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function positive(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(parsed))
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

/**
 * The session half of this plane, over the same pool and the same artifact
 * store the run half already holds. The ports are one adapter because they are
 * one bearer: a plane holding some of them and not others could only answer a
 * session wrongly, so the composition is whole or the field is absent.
 *
 * THE LEASE DEFAULTS TO WHAT OPENS IT. The scheduler opens a session attempt's
 * lease under `sessionSchedulerDefaults.attemptLeaseSecs` and this plane renews
 * it, so taking that same value is the two tiers agreeing by construction; a
 * deployment that moves one moves both, by naming each.
 */
function planeSessions(
  pool: ReturnType<typeof postgresPool>,
  artifacts: ArtifactStore,
): SessionPlaneService {
  const sessions = postgresSessionPlane(pool);
  return {
    authority: sessions,
    heartbeats: sessions,
    references: sessions,
    turns: sessions,
    settlements: sessions,
    holds: sessions,
    records: sessions,
    queries: sessions,
    store: artifacts,
    heartbeatLeaseSecs: positive(
      "CHUG_WORKER_PLANE_SESSION_HEARTBEAT_LEASE_SECS",
      sessionSchedulerDefaults.attemptLeaseSecs,
    ),
    turnPollIntervalMs: positive(
      "CHUG_WORKER_PLANE_SESSION_TURN_POLL_INTERVAL_MS",
      1_000,
    ),
    turnPollSecsMax: positive(
      "CHUG_WORKER_PLANE_SESSION_TURN_POLL_SECS_MAX",
      25,
    ),
    pollsMax: positive("CHUG_WORKER_PLANE_SESSION_POLLS_MAX", 64),
  };
}

async function main(): Promise<void> {
  const pool = postgresPool(required("CHUG_WORKER_PLANE_DATABASE_URL"));
  const uploadBytesMax = positive(
    "CHUG_WORKER_PLANE_UPLOAD_BYTES_MAX",
    workerPlaneUploadBytesMax,
  );
  const artifacts = artifactStore({
    root: required("CHUG_WORKER_PLANE_ARTIFACT_ROOT"),
    writeBytesMax: uploadBytesMax,
  });
  const app = createWorkerPlaneApp({
    authority: postgresWorkerPlaneAuthority(pool),
    heartbeats: postgresWorkerAttemptHeartbeats(pool),
    heartbeatLeaseSecs: positive("CHUG_WORKER_PLANE_HEARTBEAT_LEASE_SECS", 300),
    reservations: postgresWorkerArtifactReservations(pool),
    artifacts,
    runEvidence: {
      configurations: postgresWorkerRunConfiguration(pool),
      transcripts: postgresWorkerRunTranscript(pool),
      turns: postgresWorkerRunTurns(pool),
      totals: postgresWorkerRunTotal(pool),
      endings: postgresWorkerRunEnded(pool),
    },
    reports: {
      report: (secret, submission) =>
        executionSchedulerIngest(
          {
            store: postgresWorkerReportStore(pool, secret),
            artifacts,
            digestOf: (canonical) =>
              createHash("sha256").update(canonical, "utf8").digest("hex"),
            metrics: silentSchedulerTelemetry,
          },
          submission,
        ),
    },
    sessions: planeSessions(pool, artifacts),
    uploadBytesMax,
    ready: async () => {
      try {
        const found = await pool.query<{ current_role: string }>(
          "SELECT current_user AS current_role",
        );
        return found.rows[0]?.current_role === workerPlaneRole;
      } catch {
        return false;
      }
    },
  });
  app.addHook("onClose", () => pool.end());
  await app.listen({
    host: process.env["CHUG_WORKER_PLANE_HOST"] ?? "127.0.0.1",
    port: positive("CHUG_WORKER_PLANE_PORT", 3_001),
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main().catch((failure: unknown) => {
    process.stderr.write(
      `worker plane: ${failure instanceof Error ? failure.message : "startup failed"}\n`,
    );
    process.exitCode = 1;
  });
