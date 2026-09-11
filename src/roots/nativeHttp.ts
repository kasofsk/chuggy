import {
  apiRole,
  projectThreadsReadFunction,
} from "../adapters/postgres/schema.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresInstallationAuthority } from "../adapters/postgres/installationAuthority.ts";
import {
  ketoProjectAccess,
  ketoReadiness,
} from "../adapters/keto/projectAccess.ts";
import { postgresExecutionBacklogGuard } from "../adapters/postgres/schedulerContext.ts";
import {
  createNativeHttpApp,
  nativeHttpLimitsDefault,
  type PrincipalAuthentication,
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
import { twoBearerAuthentication } from "../adapters/http/sessionBearer.ts";
import { postgresSessionBearerAuthority } from "../adapters/postgres/sessionPlane.ts";
import {
  composeForgeCredentialMinting,
  composeNativeWeb,
  composeRepositoryOnboarding,
  composeSelectorProjectSettings,
} from "../compose.ts";
import type { IdempotencyKeying } from "../adapters/postgres/keying.ts";
import { artifactStore } from "../adapters/artifacts/artifactStore.ts";
import { postgresLeadReads } from "../adapters/postgres/leadReads.ts";
import { postgresAgenticRefusalReads } from "../adapters/postgres/agenticRefusal.ts";
import type {
  NativeLeadPorts,
  NativeThreadPorts,
} from "../interpreter/nativeWeb.ts";
import { threadSessionMint } from "../adapters/crypto/threadSessionMint.ts";
import {
  postgresThreadSeeding,
  postgresThreads,
} from "../adapters/postgres/thread.ts";
import { postgresSessionStoreRows } from "../adapters/postgres/sessionStoreReads.ts";
import { sessionStoreStreamsAnswered } from "../contract/http.ts";
import type { SessionStoreReadPort } from "../interpreter/sessionStore.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "../adapters/postgres/runtimeSchema.ts";
import { schemaCompatibilityPrecondition } from "../interpreter/serviceRuntime.ts";
import {
  checkedProjectAccessSettings,
  projectAccessTimeoutMsDefault,
  type ProjectAccessSettings,
} from "../interpreter/projectAccess.ts";
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
import {
  githubInstallationTokens,
  githubInstallationTokensDefaults,
  githubInstallationTokensPrecondition,
  type GithubInstallationTokensOptions,
} from "../adapters/forge/githubInstallationTokens.ts";
import { githubRepositoryHost } from "../adapters/forge/githubAddress.ts";
import {
  githubApps,
  githubInstallationDirectory,
} from "../adapters/forge/githubApp.ts";
import {
  githubInstallationRepositories,
  githubInstallationRepositoriesDefaults,
} from "../adapters/forge/githubInstallationRepositories.ts";
import type { RepositoryOnboarding } from "../interpreter/repositoryOnboarding.ts";
import { forgeRepositoriesAnsweredMax } from "../contract/http.ts";
import {
  mintedRepositoryCredentials,
  mintedRepositoryTokens,
} from "../adapters/forge/mintedCredentials.ts";
import { postgresForgeInstallations } from "../adapters/postgres/forgeInstallation.ts";
import {
  repositoryCredentialsByHost,
  type ForgeCredentialMinting,
  type MintedCredentialHost,
} from "../interpreter/forgeCredentials.ts";
import type { RepositoryCredentialPort } from "../interpreter/finalizer.ts";
import { githubForgeId } from "../interpreter/forgeInstallation.ts";
import type { ProjectAccess } from "../interpreter/projectAccess.ts";

const databaseUrlVariable = "CHUG_API_DATABASE_URL";
const idempotencyKeyingVariable = "CHUG_API_IDEMPOTENCY_KEYING";
const oidcIssuerVariable = "CHUG_API_OIDC_ISSUER";
const oidcAudienceVariable = "CHUG_API_OIDC_AUDIENCE";
const oidcAlgorithmsVariable = "CHUG_API_OIDC_ALGORITHMS";
const artifactRootVariable = "CHUG_API_ARTIFACT_ROOT";
const ketoReadUrlVariable = "CHUG_API_KETO_READ_URL";
const ketoTimeoutVariable = "CHUG_API_KETO_TIMEOUT_MS";
/**
 * The named credential mount a member's thread speaks through. It is REQUIRED
 * rather than defaulted: the slot is what a per-user Anthropic credential
 * arrives as, and a default would open every member's thread on whatever the
 * lead happens to use while reading as though somebody had chosen it.
 */
const threadCredentialSlotVariable = "CHUG_API_THREAD_CREDENTIAL_SLOT";
const selectorReviewDatabaseUrlVariable =
  "CHUG_API_SELECTOR_REVIEW_DATABASE_URL";
const gitScratchRootVariable = "CHUG_API_GIT_SCRATCH_ROOT";
const repositoryCredentialSourcesVariable =
  "CHUG_API_REPOSITORY_CREDENTIAL_SOURCES";
/**
 * The app this process mints under and the key it signs with. They are named
 * together or not at all: one alone is a deployment that meant to mint and
 * cannot, which is a refusal to start rather than an outage at every mint.
 */
const forgeAppIdVariable = "CHUG_API_FORGE_APP_ID";
const forgeAppKeyFileVariable = "CHUG_API_FORGE_APP_KEY_FILE";
const forgeApiUrlVariable = "CHUG_API_FORGE_API_URL";
const forgeTimeoutVariable = "CHUG_API_FORGE_TIMEOUT_MS";
const forgeRepositoriesMaxVariable = "CHUG_API_FORGE_REPOSITORIES_MAX";

/** The app this process holds the key of, the other being the fabric's. */
const forgeApp = "portal";

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

/** Where the project authority is, and how long this server waits on one question. */
function ketoConfig(): ProjectAccessSettings {
  return checkedProjectAccessSettings({
    readUrl: requiredEnvironment(ketoReadUrlVariable),
    requestTimeoutMs: positiveEnvironment(
      ketoTimeoutVariable,
      projectAccessTimeoutMsDefault,
    ),
  });
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
           current_user,'${projectThreadsReadFunction}(text,text,bigint)','EXECUTE') AS authorized`,
    );
    const row = found.rows[0];
    if (row?.current_role !== apiRole || !row.authorized) return false;
    return (
      (
        await schemaCompatibilityPrecondition(
          postgresRuntimeSchema(pool),
          currentRuntimeSchemaContract,
        ).check(new AbortController().signal)
      ).met === "Met"
    );
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

/**
 * What this server must reach to answer at all. The project authority is one of
 * them, and it is a readiness rather than a start-up precondition: an authority
 * that goes down answers every request 503 and does not stop this process.
 */
function nativeReadiness(
  pool: ReturnType<typeof postgresPool>,
  selectorReviewPool: ReturnType<typeof postgresPool>,
  access: ProjectAccessSettings,
) {
  return {
    ready: async () =>
      (await apiDatabaseReady(pool)) &&
      (await postgresSelectorContextReady(selectorReviewPool)) &&
      (await ketoReadiness(access).ready()),
  };
}

/** The two pools this process owns, each proved to connect as a different role. */
export interface NativePools {
  readonly pool: ReturnType<typeof postgresPool>;
  readonly selectorReviewPool: ReturnType<typeof postgresPool>;
}

function nativePools(): NativePools {
  return {
    pool: postgresPool(requiredEnvironment(databaseUrlVariable)),
    selectorReviewPool: postgresPool(
      requiredEnvironment(selectorReviewDatabaseUrlVariable),
    ),
  };
}

/**
 * Where a repository's credential comes from in this process: the minting
 * source for a host that has one, and the mounted files for every other. The
 * onboarding routes prove a binding against it and the configuration importer
 * clones with it, so a repository one of them can reach is one the other can.
 */
function nativeRepositoryCredentials(
  minted: readonly MintedCredentialHost[],
): RepositoryCredentialPort {
  const encoded = process.env[repositoryCredentialSourcesVariable];
  const sources =
    encoded === undefined || encoded.length === 0
      ? []
      : repositoryCredentialFilesOf(
          encoded,
          repositoryCredentialSourcesVariable,
        );
  return repositoryCredentialsByHost(minted, credentialFiles({ sources }));
}

function repositoryConfigurationSnapshots(
  credentials: RepositoryCredentialPort,
) {
  const scratchDirectory = process.env[gitScratchRootVariable];
  if (scratchDirectory === undefined || scratchDirectory.length === 0)
    return undefined;
  const environment = Object.fromEntries(
    finalizerGitEnvironmentNames
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  return gitRepositoryConfiguration({
    scratchDirectory,
    identity: {
      name: "Chuggy configuration importer",
      email: "configuration-importer@chuggy.invalid",
    },
    environment,
    credentials,
  });
}

/** What this deployment mints with, or nothing at all where it holds no app key. */
export function forgeTokenOptions():
  GithubInstallationTokensOptions | undefined {
  const appId = process.env[forgeAppIdVariable] ?? "";
  const privateKeyPath = process.env[forgeAppKeyFileVariable] ?? "";
  if (appId.length === 0 && privateKeyPath.length === 0) return undefined;
  if (appId.length === 0 || privateKeyPath.length === 0)
    throw new Error(
      `${forgeAppIdVariable} and ${forgeAppKeyFileVariable} are named together or not at all`,
    );
  return {
    fetch,
    appId,
    privateKeyPath,
    apiUrl:
      process.env[forgeApiUrlVariable] ??
      githubInstallationTokensDefaults.apiUrl,
    requestTimeoutMs: positiveEnvironment(
      forgeTimeoutVariable,
      githubInstallationTokensDefaults.requestTimeoutMs,
    ),
  };
}

/** Refuses to start on a key this process could not sign with, leaving no pool open behind it. */
async function forgeKeyReady(
  options: GithubInstallationTokensOptions,
  pools: NativePools,
): Promise<void> {
  const verdict = await githubInstallationTokensPrecondition(options).check(
    new AbortController().signal,
  );
  if (verdict.met === "Met") return;
  await closePools(pools.pool, pools.selectorReviewPool);
  throw new Error(`${forgeAppKeyFileVariable}: ${verdict.why}`);
}

/**
 * How many repositories one installation listing pages for, refusing a bound
 * past what the wire's own schema answers: a deployment that asked for more
 * would send a body no reader's schema accepts.
 */
function forgeRepositoriesMax(): number {
  const asked = positiveEnvironment(
    forgeRepositoriesMaxVariable,
    githubInstallationRepositoriesDefaults.repositoriesMax,
  );
  if (asked > forgeRepositoriesAnsweredMax)
    throw new Error(
      `${forgeRepositoriesMaxVariable} must be at most ${String(forgeRepositoriesAnsweredMax)}`,
    );
  return asked;
}

/** The forge this process talks to: the credential source its own reads take, the minting route's service, and onboarding's. */
export interface NativeForge {
  readonly hosts: readonly MintedCredentialHost[];
  readonly credentials: RepositoryCredentialPort;
  readonly minting: ForgeCredentialMinting | undefined;
  readonly onboarding: RepositoryOnboarding;
}

/**
 * A deployment naming no app key mints nothing and reads every credential from
 * its files, which is the deployment this tree already had. It still onboards:
 * the routes that describe an app or an installation answer `ForgeNotConfigured`
 * and the two that bind go on working, because a binding is proved by whichever
 * source holds the repository's credential.
 */
async function nativeForge(
  pools: NativePools,
  access: ProjectAccess,
): Promise<NativeForge> {
  const options = forgeTokenOptions();
  if (options === undefined) {
    const credentials = nativeRepositoryCredentials([]);
    return {
      hosts: [],
      credentials,
      minting: undefined,
      onboarding: composeRepositoryOnboarding(
        pools.pool,
        access,
        credentials,
        undefined,
      ),
    };
  }
  await forgeKeyReady(options, pools);
  const installationTokens = githubInstallationTokens(options);
  const tokens = mintedRepositoryTokens({
    forge: githubForgeId,
    app: forgeApp,
    repositoryHost: githubRepositoryHost,
    installations: postgresForgeInstallations(pools.pool),
    tokens: installationTokens,
  });
  const hosts = [
    {
      repositoryHost: githubRepositoryHost,
      credentials: mintedRepositoryCredentials({
        tokens,
        permissions: "read",
      }),
    },
  ];
  const credentials = nativeRepositoryCredentials(hosts);
  return {
    hosts,
    credentials,
    minting: composeForgeCredentialMinting(pools.pool, access, tokens),
    onboarding: composeRepositoryOnboarding(pools.pool, access, credentials, {
      forge: githubForgeId,
      app: forgeApp,
      apps: githubApps(options),
      directory: githubInstallationDirectory(options),
      installationRepositories: githubInstallationRepositories({
        ...options,
        tokens: installationTokens,
        repositoriesMax: forgeRepositoriesMax(),
      }),
    }),
  };
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

/** Ends this process on either signal a supervisor stops it with, and reports a drain that failed. */
function nativeShutdownSignals(shutdown: () => Promise<void>): void {
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
}

/**
 * The two bearer kinds this API accepts: the issuer's, and the session bearers
 * the API pool is the authority on — the one pool holding `EXECUTE` on
 * `authenticate_session_bearer`, where the review pool would raise permission
 * denied and every session bearer would read on the wire as this server's
 * outage rather than as a deployment that bound the wrong credential. It takes
 * both pools and chooses, rather than being handed one, so a case can observe
 * which was reached.
 */
export function nativeAuthentication(
  oidc: PrincipalAuthentication,
  pools: NativePools,
): PrincipalAuthentication {
  return twoBearerAuthentication(
    oidc,
    postgresSessionBearerAuthority(pools.pool),
  );
}

/**
 * Refuses to start on either pool this process must have, naming which one, and
 * leaves neither open behind the refusal.
 */
async function nativeDatabasesReady(
  pool: ReturnType<typeof postgresPool>,
  selectorReviewPool: ReturnType<typeof postgresPool>,
): Promise<void> {
  if (!(await apiDatabaseReady(pool))) {
    await closePools(pool, selectorReviewPool);
    throw new Error(
      `the native HTTP database must be migrated and connect as ${apiRole}`,
    );
  }
  if (!(await postgresSelectorContextReady(selectorReviewPool))) {
    await closePools(pool, selectorReviewPool);
    throw new Error(
      `the selector review database must connect as ${selectorReviewRole}`,
    );
  }
}

/**
 * The lead's read side over the API pool and the artifact volume, taking both
 * pools and choosing for the reason `nativeAuthentication` does: only the API
 * role holds `EXECUTE` on 059's doors, and choosing here is what lets a case
 * observe which pool was reached.
 */
export function nativeLeadPorts(
  pools: NativePools,
  artifacts: SessionStoreReadPort,
): NativeLeadPorts {
  const leads = postgresLeadReads(pools.pool);
  return {
    leads,
    store: artifacts,
    refusals: postgresAgenticRefusalReads(pools.pool),
    history: leads,
  };
}

/**
 * The four ports one project's threads are reached through, beside the store
 * the lead's transcript is already read from. The rows read is the session-keyed
 * one, so a thread's transcript and the lead's are one walk over one function.
 */
export function nativeThreadPorts(
  pools: NativePools,
  artifacts: SessionStoreReadPort,
): NativeThreadPorts {
  return {
    threads: postgresThreads(pools.pool, {
      streamsMax: sessionStoreStreamsAnswered,
    }),
    sessions: threadSessionMint(),
    seeding: postgresThreadSeeding(pools.pool),
    rows: postgresSessionStoreRows(pools.pool),
    store: artifacts,
    credentialSlot: requiredEnvironment(threadCredentialSlotVariable),
  };
}

async function main(): Promise<void> {
  const keying = idempotencyKeying();
  const authenticationConfig = oidcConfig();
  const pools = nativePools();
  const { pool, selectorReviewPool } = pools;
  await nativeDatabasesReady(pool, selectorReviewPool);
  const authentication = nativeAuthentication(
    await oidcAuthentication(authenticationConfig).catch(
      async (failure: unknown) => {
        await closePools(pool, selectorReviewPool);
        throw failure;
      },
    ),
    pools,
  );
  const accessSettings = ketoConfig();
  const access = ketoProjectAccess(accessSettings);
  const artifacts = artifactStore({
    root: requiredEnvironment(artifactRootVariable),
  });
  const forge = await nativeForge(pools, access);
  const web = composeNativeWeb(
    pool,
    keying,
    access,
    postgresExecutionBacklogGuard(pool),
    undefined,
    undefined,
    undefined,
    artifacts,
    selectorContextSource(pool, selectorReviewPool),
    repositoryConfigurationSnapshots(forge.credentials),
    nativeLeadPorts(pools, artifacts),
    nativeThreadPorts(pools, artifacts),
  );
  const hub = nativeStreamHub(pool, web);
  const app = createNativeHttpApp(
    web,
    authentication,
    nativeReadiness(pool, selectorReviewPool, accessSettings),
    postgresInstallationAuthority(pool),
    nativeHttpLimitsDefault,
    hub,
    composeSelectorProjectSettings(pool, access),
    forge.minting,
    forge.onboarding,
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
  nativeShutdownSignals(shutdown);
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
