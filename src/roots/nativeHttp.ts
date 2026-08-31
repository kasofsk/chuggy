import { apiRole } from "../adapters/postgres/schema.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresInstallationAuthority } from "../adapters/postgres/installationAuthority.ts";
import { postgresProjectAccess } from "../adapters/postgres/projectAccess.ts";
import { postgresExecutionBacklogGuard } from "../adapters/postgres/schedulerContext.ts";
import {
  createNativeHttpApp,
  nativeHttpLimitsDefault,
} from "../adapters/http/server.ts";
import { projectResourceReader } from "../adapters/http/eventStream.ts";
import {
  postgresProjectChangeDoorbell,
  postgresProjectChangeLog,
} from "../adapters/postgres/projectChangeLog.ts";
import { systemStreamTimers } from "../adapters/runtime/systemStreamTimers.ts";
import {
  projectStreamHub,
  projectStreamLimitsDefault,
  type ProjectStreamHub,
  type ProjectStreamLimits,
  type ProjectStreamNote,
  type ProjectStreamReport,
} from "../interpreter/projectStream.ts";
import { assertNever } from "../domain/assertNever.ts";
import {
  oidcAuthentication,
  type OidcAuthenticationConfig,
} from "../adapters/http/oidc.ts";
import { composeNativeWeb } from "../compose.ts";
import type { IdempotencyKeying } from "../adapters/postgres/keying.ts";
import { artifactStore } from "../adapters/artifacts/artifactStore.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "../adapters/postgres/runtimeSchema.ts";
import { schemaCompatibilityPrecondition } from "../interpreter/serviceRuntime.ts";
import { postgresExecutionContextRead } from "../adapters/postgres/schedulerContext.ts";
import { postgresSelectorProposalReviews } from "../adapters/postgres/selector.ts";
import { selectorOperationalContextRead } from "../interpreter/selectorOperationalContext.ts";
import { selectorReviewRole } from "../adapters/postgres/schema.ts";
import { postgresSelectorContextReady } from "../adapters/postgres/selectorContextReadiness.ts";
import { pathToFileURL } from "node:url";
import { credentialFiles } from "../adapters/credentials/credentialFiles.ts";
import { gitRepositoryConfiguration } from "../adapters/git/gitRepositoryConfiguration.ts";
import {
  finalizerGitEnvironmentNames,
  repositoryCredentialFilesOf,
} from "../interpreter/finalizerSettings.ts";

const databaseUrlVariable = "CHUG_API_DATABASE_URL";
const idempotencyKeyingVariable = "CHUG_API_IDEMPOTENCY_KEYING";
const oidcIssuerVariable = "CHUG_API_OIDC_ISSUER";
const oidcAudienceVariable = "CHUG_API_OIDC_AUDIENCE";
const oidcAlgorithmsVariable = "CHUG_API_OIDC_ALGORITHMS";
const artifactRootVariable = "CHUG_API_ARTIFACT_ROOT";
const selectorReviewDatabaseUrlVariable =
  "CHUG_API_SELECTOR_REVIEW_DATABASE_URL";
const gitScratchRootVariable = "CHUG_API_GIT_SCRATCH_ROOT";
const repositoryCredentialSourcesVariable =
  "CHUG_API_REPOSITORY_CREDENTIAL_SOURCES";

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
    algorithms: requiredEnvironment(oidcAlgorithmsVariable)
      .split(",")
      .map((algorithm) => algorithm.trim()),
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
  try {
    const found = await pool.query<{
      current_role: string;
      authorized: boolean;
    }>(
      `SELECT current_user AS current_role,
         has_function_privilege(
           current_user,'authorize_project_access(text,text,text,text)','EXECUTE') AS authorized`,
    );
    const row = found.rows[0];
    if (row?.current_role !== apiRole || !row.authorized) return false;
    return schemaCompatibilityPrecondition(
      postgresRuntimeSchema(pool),
      currentRuntimeSchemaContract,
    ).check(new AbortController().signal);
  } catch {
    return false;
  }
}

function selectorContextSource(
  pool: ReturnType<typeof postgresPool>,
  selectorReviewPool: ReturnType<typeof postgresPool>,
) {
  return selectorOperationalContextRead(
    postgresExecutionContextRead(pool),
    postgresSelectorProposalReviews(selectorReviewPool),
    {
      now: () => {
        const instant = new Date();
        return {
          instant: instant.toISOString(),
          epochMilliseconds: instant.getTime(),
        };
      },
    },
    {
      reviewFeedbackMax: positiveEnvironment(
        "CHUG_API_SELECTOR_FEEDBACK_MAX",
        100,
      ),
      projectBacklogMax: positiveEnvironment(
        "CHUG_SCHEDULER_PROJECT_BACKLOG_MAX",
        200,
      ),
      installationBacklogMax: positiveEnvironment(
        "CHUG_SCHEDULER_INSTALLATION_BACKLOG_MAX",
        5_000,
      ),
    },
  );
}

function closePools(
  pool: ReturnType<typeof postgresPool>,
  selectorReviewPool: ReturnType<typeof postgresPool>,
): Promise<unknown[]> {
  return Promise.all([pool.end(), selectorReviewPool.end()]);
}

function nativeReadiness(
  pool: ReturnType<typeof postgresPool>,
  selectorReviewPool: ReturnType<typeof postgresPool>,
) {
  return {
    ready: async () =>
      (await apiDatabaseReady(pool)) &&
      (await postgresSelectorContextReady(selectorReviewPool)),
  };
}

function nativePools() {
  return {
    pool: postgresPool(requiredEnvironment(databaseUrlVariable)),
    selectorReviewPool: postgresPool(
      requiredEnvironment(selectorReviewDatabaseUrlVariable),
    ),
  };
}

function repositoryConfigurationSnapshots() {
  const scratchDirectory = process.env[gitScratchRootVariable];
  if (scratchDirectory === undefined || scratchDirectory.length === 0)
    return undefined;
  const environment = Object.fromEntries(
    finalizerGitEnvironmentNames
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  const encodedSources = process.env[repositoryCredentialSourcesVariable];
  const sources =
    encodedSources === undefined || encodedSources.length === 0
      ? []
      : repositoryCredentialFilesOf(
          encodedSources,
          repositoryCredentialSourcesVariable,
        );
  return gitRepositoryConfiguration({
    scratchDirectory,
    identity: {
      name: "Chuggy configuration importer",
      email: "configuration-importer@chuggy.invalid",
    },
    environment,
    credentials: credentialFiles({ sources }),
  });
}

function streamNoteText(note: ProjectStreamNote): string {
  const totals = `streams=${String(note.streamsOpen)} rows=${String(note.rowsRead)}`;
  switch (note.note) {
    case "Sourced":
      return `source is ${note.state}, ${totals}`;
    case "Refused":
      return `refused a stream at capacity, ${totals}`;
    case "SlowClientClosed":
      return `closed a stream that stopped reading, ${totals}`;
    case "Swept":
      return `swept ${String(note.removed)} change rows, ${totals}`;
    case "ReadFailed":
      return `the change log read failed: ${note.failure}, ${totals}`;
    default:
      return assertNever(note);
  }
}

/** The stream hub reports where the rest of this root does: the process's own error stream. */
const nativeStreamReport: ProjectStreamReport = {
  noted: (note) => {
    process.stderr.write(`project stream: ${streamNoteText(note)}\n`);
  },
};

function nativeStreamLimits(): ProjectStreamLimits {
  return {
    ...projectStreamLimitsDefault,
    connectionsMax: positiveEnvironment(
      "CHUG_API_STREAM_CONNECTIONS_MAX",
      projectStreamLimitsDefault.connectionsMax,
    ),
    maxAgeMs: positiveEnvironment(
      "CHUG_API_STREAM_MAX_AGE_MS",
      projectStreamLimitsDefault.maxAgeMs,
    ),
    heartbeatMs: positiveEnvironment(
      "CHUG_API_STREAM_HEARTBEAT_MS",
      projectStreamLimitsDefault.heartbeatMs,
    ),
    sweepMs: positiveEnvironment(
      "CHUG_API_STREAM_SWEEP_MS",
      projectStreamLimitsDefault.sweepMs,
    ),
    sweepRowsMax: positiveEnvironment(
      "CHUG_API_STREAM_SWEEP_ROWS_MAX",
      projectStreamLimitsDefault.sweepRowsMax,
    ),
  };
}

function nativeStreamHub(
  pool: ReturnType<typeof postgresPool>,
  web: Parameters<typeof projectResourceReader>[0],
): ProjectStreamHub {
  return projectStreamHub({
    log: postgresProjectChangeLog(pool),
    doorbell: postgresProjectChangeDoorbell(
      requiredEnvironment(databaseUrlVariable),
    ),
    reader: projectResourceReader(web),
    timers: systemStreamTimers,
    report: nativeStreamReport,
    limits: nativeStreamLimits(),
  });
}

/**
 * Ends every stream before the drain begins, because a stream is a response
 * that never finishes and a drain that waited for one would wait out its
 * deadline.
 */
function nativeShutdown(
  app: ReturnType<typeof createNativeHttpApp>,
  hub: ProjectStreamHub,
  drainMs: number,
): () => Promise<void> {
  let started = false;
  return async () => {
    if (started) return;
    started = true;
    await hub.close();
    const force = setTimeout(() => {
      app.server.closeAllConnections();
    }, drainMs);
    try {
      await app.close();
    } finally {
      clearTimeout(force);
    }
  };
}

async function main(): Promise<void> {
  const keying = idempotencyKeying();
  const authenticationConfig = oidcConfig();
  const { pool, selectorReviewPool } = nativePools();
  if (!(await apiDatabaseReady(pool))) {
    await Promise.all([pool.end(), selectorReviewPool.end()]);
    throw new Error(
      `the native HTTP database must be migrated and connect as ${apiRole}`,
    );
  }
  if (!(await postgresSelectorContextReady(selectorReviewPool))) {
    await Promise.all([pool.end(), selectorReviewPool.end()]);
    throw new Error(
      `the selector review database must connect as ${selectorReviewRole}`,
    );
  }
  const authentication = await oidcAuthentication(authenticationConfig).catch(
    async (failure: unknown) => {
      await Promise.all([pool.end(), selectorReviewPool.end()]);
      throw failure;
    },
  );
  const web = composeNativeWeb(
    pool,
    keying,
    postgresProjectAccess(pool),
    postgresExecutionBacklogGuard(pool),
    undefined,
    undefined,
    undefined,
    artifactStore({ root: requiredEnvironment(artifactRootVariable) }),
    selectorContextSource(pool, selectorReviewPool),
    repositoryConfigurationSnapshots(),
  );
  const hub = nativeStreamHub(pool, web);
  const app = createNativeHttpApp(
    web,
    authentication,
    nativeReadiness(pool, selectorReviewPool),
    postgresInstallationAuthority(pool),
    nativeHttpLimitsDefault,
    hub,
  );
  app.addHook("onClose", async () => {
    await hub.close();
    await closePools(pool, selectorReviewPool);
  });
  const shutdown = nativeShutdown(
    app,
    hub,
    positiveEnvironment("CHUG_API_SHUTDOWN_DRAIN_MS", 15_000),
  );
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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main().catch((failure: unknown) => {
    const message =
      failure instanceof Error ? failure.message : "unknown startup failure";
    process.stderr.write(`native HTTP server: ${message}\n`);
    process.exitCode = 1;
  });
