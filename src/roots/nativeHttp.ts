import { apiRole } from "../adapters/postgres/schema.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresProjectAccess } from "../adapters/postgres/projectAccess.ts";
import { postgresExecutionBacklogGuard } from "../adapters/postgres/schedulerContext.ts";
import { createNativeHttpApp } from "../adapters/http/server.ts";
import {
  oidcAuthentication,
  type OidcAuthenticationConfig,
} from "../adapters/http/oidc.ts";
import { composeNativeWeb } from "../compose.ts";
import type { IdempotencyKeying } from "../adapters/postgres/keying.ts";

const databaseUrlVariable = "CHUG_API_DATABASE_URL";
const idempotencyKeyingVariable = "CHUG_API_IDEMPOTENCY_KEYING";
const oidcIssuerVariable = "CHUG_API_OIDC_ISSUER";
const oidcAudienceVariable = "CHUG_API_OIDC_AUDIENCE";
const oidcAlgorithmsVariable = "CHUG_API_OIDC_ALGORITHMS";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function positiveEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(value))
    throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is too large`);
  return parsed;
}

function idempotencyKeying(): IdempotencyKeying {
  const parsed: unknown = JSON.parse(
    requiredEnvironment(idempotencyKeyingVariable),
  );
  if (typeof parsed !== "object" || parsed === null)
    throw new Error(`${idempotencyKeyingVariable} must be an object`);
  const value = parsed as Readonly<Record<string, unknown>>;
  if (typeof value["current"] !== "string" || !Array.isArray(value["versions"]))
    throw new Error(`${idempotencyKeyingVariable} has an invalid shape`);
  const versions = value["versions"].map((entry) => {
    if (typeof entry !== "object" || entry === null)
      throw new Error(`${idempotencyKeyingVariable} has an invalid version`);
    const fields = entry as Readonly<Record<string, unknown>>;
    if (
      typeof fields["version"] !== "string" ||
      typeof fields["secret"] !== "string"
    )
      throw new Error(`${idempotencyKeyingVariable} has an invalid version`);
    return { version: fields["version"], secret: fields["secret"] };
  });
  if (!versions.some((entry) => entry.version === value["current"]))
    throw new Error(`${idempotencyKeyingVariable} omits its current version`);
  return { current: value["current"], versions };
}

function oidcConfig(): OidcAuthenticationConfig {
  return {
    issuer: requiredEnvironment(oidcIssuerVariable),
    audience: requiredEnvironment(oidcAudienceVariable),
    algorithms: requiredEnvironment(oidcAlgorithmsVariable).split(","),
    discoveryTimeoutMs: positiveEnvironment(
      "CHUG_API_OIDC_DISCOVERY_TIMEOUT_MS",
      5_000,
    ),
    jwksTimeoutMs: positiveEnvironment("CHUG_API_OIDC_JWKS_TIMEOUT_MS", 5_000),
  };
}

async function apiDatabaseReady(
  pool: ReturnType<typeof postgresPool>,
): Promise<boolean> {
  const found = await pool.query<{ current_role: string; authorized: boolean }>(
    `SELECT current_user AS current_role,
       has_function_privilege(
         current_user,'authorize_project_access(text,text,text,text)','EXECUTE') AS authorized`,
  );
  const row = found.rows[0];
  return row?.current_role === apiRole && row.authorized;
}

async function main(): Promise<void> {
  const keying = idempotencyKeying();
  const authenticationConfig = oidcConfig();
  const pool = postgresPool(requiredEnvironment(databaseUrlVariable));
  if (!(await apiDatabaseReady(pool))) {
    await pool.end();
    throw new Error(
      `the native HTTP database must be migrated and connect as ${apiRole}`,
    );
  }
  const authentication = await oidcAuthentication(authenticationConfig).catch(
    async (failure: unknown) => {
      await pool.end();
      throw failure;
    },
  );
  const access = postgresProjectAccess(pool);
  const web = composeNativeWeb(
    pool,
    keying,
    access,
    postgresExecutionBacklogGuard(pool),
  );
  const app = createNativeHttpApp(web, authentication, {
    ready: () => apiDatabaseReady(pool),
  });
  app.addHook("onClose", () => pool.end());
  const drainMs = positiveEnvironment("CHUG_API_SHUTDOWN_DRAIN_MS", 15_000);
  let shutdownStarted = false;
  const shutdown = async (): Promise<void> => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    const force = setTimeout(() => {
      app.server.closeAllConnections();
    }, drainMs);
    try {
      await app.close();
    } finally {
      clearTimeout(force);
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown().catch((failure: unknown) => {
        const message =
          failure instanceof Error ? failure.message : "unknown failure";
        process.stderr.write(`native HTTP shutdown: ${message}\n`);
        process.exitCode = 1;
      });
    });
  }
  await app.listen({
    host: process.env["CHUG_API_HOST"] ?? "127.0.0.1",
    port: positiveEnvironment("CHUG_API_PORT", 3_000),
  });
}

await main().catch((failure: unknown) => {
  const message =
    failure instanceof Error ? failure.message : "unknown startup failure";
  process.stderr.write(`native HTTP server: ${message}\n`);
  process.exitCode = 1;
});
