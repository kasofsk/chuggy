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
import {
  createNativeHttpApp,
  nativeHttpLimitsDefault,
  type NativeTicketApplication,
  type PrincipalAuthentication,
} from "../adapters/http/server.ts";
import {
  oidcAuthentication,
  type OidcAuthenticationConfig,
} from "../adapters/http/oidc.ts";
import { twoBearerAuthentication } from "../adapters/http/sessionBearer.ts";
import { postgresSessionBearerAuthority } from "../adapters/postgres/sessionPlane.ts";
import {
  composeApiRepositoryCredentials,
  composeForgeCredentialMinting,
  composeForgeRepositoryMinting,
  composeNativeWeb,
  composeRepositoryOnboarding,
  type RepositoryCredentialMinting,
} from "../compose.ts";
import {
  idempotencyKeyDigestCurrent,
  type IdempotencyKeying,
} from "../adapters/postgres/keying.ts";
import { asIdempotencyKey } from "../interpreter/operationInbox.ts";
import { artifactStore } from "../adapters/artifacts/artifactStore.ts";
import { postgresLeadReads } from "../adapters/postgres/leadReads.ts";
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
import { pathToFileURL } from "node:url";
import { gitTicketCatalog } from "../adapters/git/gitTicketCatalog.ts";
import { pinnedTicketCatalogs } from "../adapters/catalog/pinnedTicketCatalog.ts";
import { ticketApplication } from "../interpreter/ticketApplication.ts";
import { postgresTicketMachineInbox } from "../adapters/postgres/ticketMachineInbox.ts";
import { postgresTicketMachine } from "../adapters/postgres/ticketMachine.ts";
import { postgresTicketContent } from "../adapters/postgres/ticketContent.ts";
import { postgresProjectRepositoryBinding } from "../adapters/postgres/repositoryConfiguration.ts";
import { memberAuthorityKind } from "../interpreter/projectAccess.ts";
import {
  finalizerGitEnvironmentNames,
  repositoryCredentialFilesOf,
} from "../interpreter/finalizerSettings.ts";
import {
  githubInstallationTokens,
  githubInstallationTokensOptions,
  githubInstallationTokensPrecondition,
  type GithubInstallationTokensOptions,
} from "../adapters/forge/githubInstallationTokens.ts";
import {
  githubApps,
  githubInstallationDirectory,
} from "../adapters/forge/githubApp.ts";
import {
  githubInstallationRepositories,
  githubInstallationRepositoriesDefaults,
} from "../adapters/forge/githubInstallationRepositories.ts";
import type {
  RepositoryOnboarding,
  RepositoryOnboardingForgeApp,
} from "../interpreter/repositoryOnboarding.ts";
import { forgeRepositoriesAnsweredMax } from "../contract/http.ts";
import type { ForgeCredentialMinting } from "../interpreter/forgeCredentials.ts";
import type { RepositoryCredentialPort } from "../interpreter/finalizer.ts";
import {
  asForgeAccount,
  asForgeRepositoryName,
  forgeAppKeyOf,
  githubForgeId,
  portalForgeApp,
  type ForgeApp,
  type ForgeAppKey,
  type ForgeInstallationTokens,
} from "../interpreter/forgeInstallation.ts";
import type { ForgeTemplateRepository } from "../interpreter/forgeRepositoryCreation.ts";
import { githubRepositoryCreation } from "../adapters/forge/githubRepositoryCreation.ts";
import { postgresProjectChangeRetention } from "../adapters/postgres/projectChangeRetention.ts";
import { systemPacing } from "../adapters/runtime/systemPacing.ts";
import {
  projectChangeRetentionDefaults,
  projectChangeRetentionMaintenance,
} from "../interpreter/projectChangeRetention.ts";

import type { RepositoryCreationPorts } from "../interpreter/repositoryOnboarding.ts";
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
const gitScratchRootVariable = "CHUG_API_GIT_SCRATCH_ROOT";
const repositoryCredentialSourcesVariable =
  "CHUG_API_REPOSITORY_CREDENTIAL_SOURCES";
/**
 * The portal app this process acts under and the key it signs with, and the
 * worker app it verifies a claim for and enumerates an installation of. Each
 * pair is named together or not at all: one alone is a deployment that meant to
 * hold an app and cannot, which is a refusal to start rather than an outage per
 * request.
 */
const forgeAppIdVariable = "CHUG_API_FORGE_APP_ID";
const forgeAppKeyFileVariable = "CHUG_API_FORGE_APP_KEY_FILE";
const forgeWorkerAppIdVariable = "CHUG_API_FORGE_WORKER_APP_ID";
const forgeWorkerAppKeyFileVariable = "CHUG_API_FORGE_WORKER_APP_KEY_FILE";
const forgeApiUrlVariable = "CHUG_API_FORGE_API_URL";
const forgeTimeoutVariable = "CHUG_API_FORGE_TIMEOUT_MS";
const forgeRepositoriesMaxVariable = "CHUG_API_FORGE_REPOSITORIES_MAX";
const forgeTemplateRepositoryVariable = "CHUG_API_FORGE_TEMPLATE_REPOSITORY";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function positiveOptionalEnvironment(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/u.test(value))
    throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is too large`);
  return parsed;
}

function positiveEnvironment(name: string, fallback: number): number {
  return positiveOptionalEnvironment(name) ?? fallback;
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

function closePool(pool: ReturnType<typeof postgresPool>): Promise<void> {
  return pool.end();
}

/**
 * What this server must reach to answer at all. The project authority is one of
 * them, and it is a readiness rather than a start-up precondition: an authority
 * that goes down answers every request 503 and does not stop this process.
 */
function nativeReadiness(
  pool: ReturnType<typeof postgresPool>,
  access: ProjectAccessSettings,
) {
  return {
    ready: async () =>
      (await apiDatabaseReady(pool)) && (await ketoReadiness(access).ready()),
  };
}

/** The API-role database pool owned by this process. */
export interface NativePools {
  readonly pool: ReturnType<typeof postgresPool>;
}

function nativePools(): NativePools {
  return {
    pool: postgresPool(requiredEnvironment(databaseUrlVariable)),
  };
}

/**
 * Where a repository's credential comes from in this process: the minting
 * source for a host that has one, and the mounted files for every other. The
 * onboarding and catalog readers use the same repository credentials.
 */
function nativeRepositoryCredentials(
  minting: RepositoryCredentialMinting | undefined,
): RepositoryCredentialPort {
  const encoded = process.env[repositoryCredentialSourcesVariable];
  const sources =
    encoded === undefined || encoded.length === 0
      ? []
      : repositoryCredentialFilesOf(
          encoded,
          repositoryCredentialSourcesVariable,
        );
  return composeApiRepositoryCredentials({ sources }, minting);
}

/**
 * One app's key as this deployment names it, or nothing at all where it names
 * neither half. The settings are read by the one reader every process holding
 * an app key reads through, so what an app id named without its key file means
 * is answered in a single place.
 */
function forgeAppKey(
  idVariable: string,
  keyFileVariable: string,
): ForgeAppKey | undefined {
  return forgeAppKeyOf(
    {
      appId: idVariable,
      appKeyFile: keyFileVariable,
      apiUrl: forgeApiUrlVariable,
      timeoutMs: forgeTimeoutVariable,
    },
    process.env,
    positiveOptionalEnvironment,
  );
}

/** What this deployment mints with, or nothing at all where it holds no portal key. */
export function forgePortalKey(): ForgeAppKey | undefined {
  return forgeAppKey(forgeAppIdVariable, forgeAppKeyFileVariable);
}

/**
 * Which file each app's key is named by. It is exhaustive over `ForgeApp`, so
 * an app added to the roster without a pair here is a compile error rather than
 * a claim route that silently answers `NotConfigured` forever.
 */
const forgeKeyFileVariables: Readonly<Record<ForgeApp, string>> = {
  portal: forgeAppKeyFileVariable,
  worker: forgeWorkerAppKeyFileVariable,
};

/** One app this deployment holds a key pair for. */
export interface ForgeAppPair {
  readonly app: ForgeApp;
  readonly key: ForgeAppKey;
}

/**
 * Every app this deployment names a key pair for, portal first. The worker pair
 * is held so a tenant can claim the plane's installation over the API and read
 * what it grants, which is the only thing it mints for; naming no worker pair
 * answers a worker claim `NotConfigured`.
 */
export function forgeAppPairs(): readonly ForgeAppPair[] {
  const portal = forgePortalKey();
  const worker = forgeAppKey(
    forgeWorkerAppIdVariable,
    forgeWorkerAppKeyFileVariable,
  );
  return [
    ...(portal === undefined ? [] : [{ app: portalForgeApp, key: portal }]),
    ...(worker === undefined ? [] : [{ app: "worker" as const, key: worker }]),
  ];
}

/** Refuses to start on a key this process could not sign with, leaving no pool open behind it. */
async function forgeKeyUnusable(
  keyFileVariable: string,
  key: ForgeAppKey,
): Promise<string | undefined> {
  const verdict = await githubInstallationTokensPrecondition(
    githubInstallationTokensOptions(key),
  ).check(new AbortController().signal);
  return verdict.met === "Met"
    ? undefined
    : `${keyFileVariable}: ${verdict.why}`;
}

/** The onboarding half for one app, which reads as that app and mints only to enumerate. */
function forgeAppHalf(
  app: ForgeApp,
  options: GithubInstallationTokensOptions,
  tokens: ForgeInstallationTokens,
): RepositoryOnboardingForgeApp {
  return {
    forge: githubForgeId,
    app,
    apps: githubApps(options),
    directory: githubInstallationDirectory(options),
    installationRepositories: githubInstallationRepositories({
      ...options,
      tokens,
      repositoriesMax: forgeRepositoriesMax(),
    }),
  };
}

/** The onboarding halves for every app but the portal's, each minting only to enumerate. */
function otherForgeAppHalves(
  pairs: readonly ForgeAppPair[],
): readonly RepositoryOnboardingForgeApp[] {
  return pairs.map((pair) => {
    const options = githubInstallationTokensOptions(pair.key);
    return forgeAppHalf(pair.app, options, githubInstallationTokens(options));
  });
}

/**
 * The first key pair this process could not sign with, naming the variable the
 * file was read from, and nothing at all where every key it holds is usable.
 */
export async function forgeKeysUnusable(
  pairs: readonly ForgeAppPair[],
): Promise<string | undefined> {
  for (const pair of pairs) {
    const unusable = await forgeKeyUnusable(
      forgeKeyFileVariables[pair.app],
      pair.key,
    );
    if (unusable !== undefined) return unusable;
  }
  return undefined;
}

/** Refuses to start on any key this process could not sign with, naming the file it read. */
async function forgeKeysReady(
  pairs: readonly ForgeAppPair[],
  pools: NativePools,
): Promise<void> {
  const unusable = await forgeKeysUnusable(pairs);
  if (unusable === undefined) return;
  await closePool(pools.pool);
  throw new Error(unusable);
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

/**
 * The repository a personal account's is copied from, named `owner/name`. A
 * setting this side cannot read as one repository is refused where it is read
 * rather than at the forge that would answer the request it composes.
 */
function forgeTemplateRepository(): ForgeTemplateRepository | undefined {
  const named = process.env[forgeTemplateRepositoryVariable];
  if (named === undefined || named.length === 0) return undefined;
  const parts = named.split("/");
  const [account, name] = parts;
  if (parts.length !== 2 || account === undefined || name === undefined)
    throw new Error(`${forgeTemplateRepositoryVariable} must be owner/name`);
  return {
    account: asForgeAccount(account),
    name: asForgeRepositoryName(name),
  };
}

/** The three acts creating a repository is, under the portal app this process signs as. */
function forgeRepositoryCreation(
  portal: GithubInstallationTokensOptions,
  tokens: ForgeInstallationTokens,
): RepositoryCreationPorts {
  const template = forgeTemplateRepository();
  return {
    forge: githubForgeId,
    repositories: githubRepositoryCreation({
      ...portal,
      tokens,
      appId: portal.appId,
    }),
    ...(template === undefined ? {} : { template }),
  };
}

/**
 * The forge this process talks to: the credential source its own reads take,
 * the minting route's service, onboarding's, and the one adapter that reads a
 * repository catalog from an immutable commit.
 */
export interface NativeForge {
  readonly credentials: RepositoryCredentialPort;
  readonly minting: ForgeCredentialMinting | undefined;
  readonly onboarding: RepositoryOnboarding;
}

/**
 * A deployment naming no portal key mints nothing and reads every credential
 * from its files, which is the deployment this tree already had. It still
 * onboards: the routes that describe an app or an installation answer
 * `ForgeNotConfigured` for an app it holds no key for, and the two that bind go
 * on working, because a binding is proved by whichever source holds the
 * repository's credential.
 */
async function nativeForge(
  pools: NativePools,
  access: ProjectAccess,
): Promise<NativeForge> {
  const pairs = forgeAppPairs();
  await forgeKeysReady(pairs, pools);
  const portal = pairs.find((pair) => pair.app === portalForgeApp);
  const others = otherForgeAppHalves(
    pairs.filter((pair) => pair.app !== portalForgeApp),
  );
  const minting = composeForgeRepositoryMinting(pools.pool, portal?.key);
  const credentials = nativeRepositoryCredentials(minting);
  const half = nativePortalHalf(portal, minting);
  return {
    credentials,
    minting:
      minting === undefined
        ? undefined
        : composeForgeCredentialMinting(pools.pool, access, minting.tokens),
    onboarding: composeRepositoryOnboarding({
      apiPool: pools.pool,
      access,
      credentials,
      forgeApps: half === undefined ? others : [half.onboarding, ...others],
      ...(half === undefined ? {} : { creation: half.creation }),
    }),
  };
}

/** What the portal app answers for, and nothing where this deployment holds no portal key. */
interface NativePortalHalf {
  readonly onboarding: RepositoryOnboardingForgeApp;
  readonly creation: RepositoryCreationPorts;
}

function nativePortalHalf(
  portal: ForgeAppPair | undefined,
  minting: RepositoryCredentialMinting | undefined,
): NativePortalHalf | undefined {
  if (portal === undefined || minting === undefined) return undefined;
  const options = githubInstallationTokensOptions(portal.key);
  return {
    onboarding: forgeAppHalf(
      portalForgeApp,
      options,
      minting.installationTokens,
    ),
    creation: forgeRepositoryCreation(options, minting.installationTokens),
  };
}

/** Closes the server within the configured drain bound. */
function nativeShutdown(
  app: ReturnType<typeof createNativeHttpApp>,
  drainMs: number,
): () => Promise<void> {
  let started = false;
  return async () => {
    if (started) return;
    started = true;
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

/** Authenticates issuer and session bearers through the API-role pool. */
export function nativeAuthentication(
  oidc: PrincipalAuthentication,
  pools: NativePools,
): PrincipalAuthentication {
  return twoBearerAuthentication(
    oidc,
    postgresSessionBearerAuthority(pools.pool),
  );
}

/** Refuses startup and closes the pool unless the API database is ready. */
async function nativeDatabasesReady(
  pool: ReturnType<typeof postgresPool>,
): Promise<void> {
  if (!(await apiDatabaseReady(pool))) {
    await closePool(pool);
    throw new Error(
      `the native HTTP database must be migrated and connect as ${apiRole}`,
    );
  }
}

/** Composes lead reads and transcript storage through the API-role pool. */
export function nativeLeadPorts(
  pools: NativePools,
  artifacts: SessionStoreReadPort,
): NativeLeadPorts {
  const leads = postgresLeadReads(pools.pool);
  return {
    leads,
    store: artifacts,
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

function nativeTicketApplication(
  pools: NativePools,
  access: ProjectAccess,
  forge: NativeForge,
  keying: IdempotencyKeying,
): NativeTicketApplication {
  const { pool } = pools;
  const catalogSnapshots = gitTicketCatalog({
    scratchDirectory: requiredEnvironment(gitScratchRootVariable),
    identity: {
      name: "Chuggy ticket authoring",
      email: "ticket-authoring@chuggy.invalid",
    },
    environment: Object.fromEntries(
      finalizerGitEnvironmentNames
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    ),
    credentials: forge.credentials,
    bindings: postgresProjectRepositoryBinding(pool),
  });
  const content = (partition: Parameters<typeof postgresTicketContent>[1]) =>
    postgresTicketContent(pool, partition);
  return {
    application: ticketApplication({
      access,
      inbox: postgresTicketMachineInbox(pool),
      graphs: postgresTicketMachine(pool),
      catalogs: pinnedTicketCatalogs(catalogSnapshots, content),
      content,
    }),
    identity: ({ principal, partition, key, operation }) =>
      idempotencyKeyDigestCurrent(
        keying,
        { partition, authorityKind: memberAuthorityKind },
        asIdempotencyKey(
          `${String(Buffer.byteLength(principal))}:${principal}${String(Buffer.byteLength(operation))}:${operation}${key}`,
        ),
      ),
  };
}

async function main(): Promise<void> {
  const keying = idempotencyKeying();
  const authenticationConfig = oidcConfig();
  const pools = nativePools();
  const { pool } = pools;
  await nativeDatabasesReady(pool);
  const authentication = nativeAuthentication(
    await oidcAuthentication(authenticationConfig).catch(
      async (failure: unknown) => {
        await closePool(pool);
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
    access,
    nativeLeadPorts(pools, artifacts),
    nativeThreadPorts(pools, artifacts),
  );
  const app = createNativeHttpApp(
    web,
    authentication,
    nativeReadiness(pool, accessSettings),
    postgresInstallationAuthority(pool),
    nativeHttpLimitsDefault,
    forge.minting,
    forge.onboarding,
    nativeTicketApplication(pools, access, forge, keying),
  );
  const retention = projectChangeRetentionMaintenance(
    postgresProjectChangeRetention(pool),
    systemPacing,
    projectChangeRetentionDefaults,
    (failure) => {
      const message =
        failure instanceof Error ? failure.message : "unknown failure";
      process.stderr.write(`project change retention: ${message}\n`);
    },
  );
  app.addHook("onClose", async () => {
    await retention.stop();
    await closePool(pool);
  });
  const shutdown = nativeShutdown(
    app,
    positiveEnvironment("CHUG_API_SHUTDOWN_DRAIN_MS", 15_000),
  );
  nativeShutdownSignals(shutdown);
  retention.start();
  try {
    await app.listen({
      host: process.env["CHUG_API_HOST"] ?? "127.0.0.1",
      port: positiveEnvironment("CHUG_API_PORT", 3_000),
    });
  } catch (failure: unknown) {
    await app.close();
    throw failure;
  }
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
