/**
 * The process a Prometheus scrapes for what every run cost and how long it
 * took, composed against its own PostgreSQL role.
 *
 * IT STARTS UNDER `chuggy_metrics_plane` OR IT IS NOT READY. That role reads
 * the columns the scrape names and nothing else, so the readiness probe asks
 * the server which role the plane connected as, as the pool plane's does.
 *
 * ONE SCRAPE IS ONE STATEMENT, so the pool's statement timeout is the bound a
 * scrape is read within, and a scrape past it is refused whole.
 */
import { pathToFileURL } from "node:url";

import { createMetricsPlaneApp } from "../adapters/http/metricsPlaneServer.ts";
import {
  postgresMetricsPlaneReads,
  postgresMetricsPlaneReady,
} from "../adapters/postgres/metricsPlane.ts";
import {
  postgresLimitsDefault,
  postgresPool,
} from "../adapters/postgres/pool.ts";
import { metricsPlaneRole } from "../adapters/postgres/schema/shared.ts";
import { metricsPlane } from "../interpreter/metricsPlane.ts";
import {
  planeEnvironmentPositive,
  planeEnvironmentRequired,
} from "./planeEnvironment.ts";
import { planeStopping } from "./planeStopping.ts";

async function main(): Promise<void> {
  const settings = {
    issuer: planeEnvironmentRequired("CHUG_METRICS_PLANE_OIDC_ISSUER"),
    seriesMax: planeEnvironmentPositive(
      "CHUG_METRICS_PLANE_SERIES_MAX",
      10_000,
    ),
  };
  const statementTimeoutMs = planeEnvironmentPositive(
    "CHUG_METRICS_PLANE_READ_TIMEOUT_MS",
    postgresLimitsDefault.statementTimeoutMs,
  );
  const host = process.env["CHUG_METRICS_PLANE_HOST"] ?? "127.0.0.1";
  const port = planeEnvironmentPositive("CHUG_METRICS_PLANE_PORT", 3_004);
  const pool = postgresPool(
    planeEnvironmentRequired("CHUG_METRICS_PLANE_DATABASE_URL"),
    { ...postgresLimitsDefault, statementTimeoutMs },
  );
  const app = createMetricsPlaneApp({
    scrape: metricsPlane(postgresMetricsPlaneReads(pool), settings).scrape,
    ready: () => postgresMetricsPlaneReady(pool, metricsPlaneRole),
  });
  planeStopping(app, "metrics plane", pool);
  await app.listen({ host, port });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main().catch((failure: unknown) => {
    process.stderr.write(
      `metrics plane: ${failure instanceof Error ? failure.message : "startup failed"}\n`,
    );
    process.exitCode = 1;
  });
