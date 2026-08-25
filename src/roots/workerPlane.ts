import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { artifactStore } from "../adapters/artifacts/artifactStore.ts";
import { createWorkerPlaneApp } from "../adapters/http/workerPlaneServer.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { workerPlaneRole } from "../adapters/postgres/schema.ts";
import {
  postgresWorkerPlaneAuthority,
  postgresWorkerReportStore,
} from "../adapters/postgres/workerPlane.ts";
import { silentSchedulerTelemetry } from "../interpreter/executionScheduler.ts";
import { executionSchedulerIngest } from "../interpreter/executionSchedulerReport.ts";

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

async function main(): Promise<void> {
  const pool = postgresPool(required("CHUG_WORKER_PLANE_DATABASE_URL"));
  const uploadBytesMax = positive(
    "CHUG_WORKER_PLANE_UPLOAD_BYTES_MAX",
    4_194_304,
  );
  const artifacts = artifactStore({
    root: required("CHUG_WORKER_PLANE_ARTIFACT_ROOT"),
    writeBytesMax: uploadBytesMax,
  });
  const app = createWorkerPlaneApp({
    authority: postgresWorkerPlaneAuthority(pool),
    artifacts,
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
