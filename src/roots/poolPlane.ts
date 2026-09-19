/**
 * The process a registered worker pool polls, composed against its own
 * PostgreSQL role.
 *
 * IT STARTS UNDER `chuggy_pool_plane` OR IT IS NOT READY. The whole argument
 * for a plane of its own is the grant set behind it — it claims and leases and
 * cannot write an outcome, where the plane a harness reaches can write an
 * outcome and cannot claim — so the readiness probe asks the server which role
 * it connected as, exactly as the worker plane's does.
 */
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

import { createPoolPlaneApp } from "../adapters/http/poolPlaneServer.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import {
  planeEnvironmentPositive,
  planeEnvironmentRequired,
} from "./planeEnvironment.ts";
import { poolPlaneRole } from "../adapters/postgres/schema.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
} from "../adapters/postgres/workerPool.ts";

/**
 * Where a pool's harness fetches what its assignment does not carry, which is
 * the worker plane and never this one. The two addresses are separate because
 * the two planes are: a pool that could reach this one as a harness would be
 * holding a door its credential was deliberately given no key to.
 */
const callbackUrlVariable = "CHUG_POOL_PLANE_CALLBACK_URL";

async function main(): Promise<void> {
  const pool = postgresPool(
    planeEnvironmentRequired("CHUG_POOL_PLANE_DATABASE_URL"),
  );
  const app = createPoolPlaneApp({
    registry: postgresWorkerPoolRegistry(pool),
    assignments: postgresWorkerPoolAssignments(pool),
    mint: () => randomBytes(32).toString("base64url"),
    settings: {
      leaseSecs: planeEnvironmentPositive("CHUG_POOL_PLANE_LEASE_SECS", 300),
      assignmentsPerPollMax: planeEnvironmentPositive(
        "CHUG_POOL_PLANE_ASSIGNMENTS_PER_POLL_MAX",
        8,
      ),
      heldMax: planeEnvironmentPositive("CHUG_POOL_PLANE_HELD_MAX", 64),
      deadlineSecs: planeEnvironmentPositive(
        "CHUG_POOL_PLANE_DEADLINE_SECS",
        3_600,
      ),
      callbackUrl: planeEnvironmentRequired(callbackUrlVariable),
      pollIntervalMs: planeEnvironmentPositive(
        "CHUG_POOL_PLANE_POLL_INTERVAL_MS",
        1_000,
      ),
      pollsMax: planeEnvironmentPositive("CHUG_POOL_PLANE_POLLS_MAX", 25),
    },
    ready: async () => {
      try {
        const found = await pool.query<{ current_role: string }>(
          "SELECT current_user AS current_role",
        );
        return found.rows[0]?.current_role === poolPlaneRole;
      } catch {
        return false;
      }
    },
  });
  app.addHook("onClose", () => pool.end());
  await app.listen({
    host: process.env["CHUG_POOL_PLANE_HOST"] ?? "127.0.0.1",
    port: planeEnvironmentPositive("CHUG_POOL_PLANE_PORT", 3_002),
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main().catch((failure: unknown) => {
    process.stderr.write(
      `pool plane: ${failure instanceof Error ? failure.message : "startup failed"}\n`,
    );
    process.exitCode = 1;
  });
