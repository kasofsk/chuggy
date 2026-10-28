import { apiRole, selectorReviewRole } from "../adapters/postgres/schema.ts";
import { postgresApiReady } from "../adapters/postgres/apiReadiness.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresInstallationAuthority } from "../adapters/postgres/installationAuthority.ts";
import {
  ketoProjectAccess,
  ketoReadiness,
  ketoTenantClaims,
} from "../adapters/keto/projectAccess.ts";
import { postgresExecutionBacklogGuard } from "../adapters/postgres/schedulerContext.ts";
import {
  createNativeHttpApp,
  nativeHttpLimitsDefault,
  type PrincipalAuthentication,
} from "../adapters/http/server.ts";
import {
  projectResourceReader,
  threadLiveFramed,
} from "../adapters/http/eventStream.ts";
import {
  postgresProjectChangeDoorbell,
  postgresProjectChangeLog,
} from "../adapters/postgres/projectChangeLog.ts";
import { postgresSessionLiveLane } from "../adapters/postgres/sessionLive.ts";
import { systemStreamTimers } from "../adapters/runtime/systemStreamTimers.ts";
import {
  projectStreamHub,
  projectStreamLimitsDefault,
  type ProjectStreamHub,
  type ProjectStreamLimits,
  type ProjectStreamNote,
  type ProjectStreamReport,
} from "../interpreter/projectStream.ts";
import {
  threadLiveHub,
  threadLiveLimitsDefault,
  type ThreadLiveHub,
  type ThreadLiveLimits,
  type ThreadLiveNote,
  type ThreadLiveReport,
} from "../interpreter/threadLive.ts";
import { assertNever } from "../domain/assertNever.ts";
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
  composeExecutionPlacement,
  composeProjectOwnerFallback,
  composeThreadLimits,
  composeProjectCreation,
  composeRepositoryOnboarding,
  composeSelectorProjectSettings,
  composeSelectorProposalReviews,
  composeSessionPlacement,
  type RepositoryCredentialMinting,
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
import {
  projectArtifactUploadBytesMax,
  sessionStoreStreamsAnswered,
} from "../contract/http.ts";
import type { SessionStoreReadPort } from "../interpreter/sessionStore.ts";
import {
  runtimePreconditionAnswer,
  runtimePreconditionUndecided,
  type RuntimePreconditionVerdict,
} from "../interpreter/serviceRuntime.ts";
import {
  checkedProjectAccessSettings,
  projectAccessTimeoutMsDefault,
  type ProjectAccessSettings,
} from "../interpreter/projectAccess.ts";
import { postgresExecutionContextRead } from "../adapters/postgres/schedulerContext.ts";
import {
  postgresSelectorProposalReviews,
  postgresSelectorResolvedSettings,
} from "../adapters/postgres/selector.ts";
import { selectorOperationalContextRead } from "../interpreter/selectorOperationalContext.ts";
import { postgresSelectorContextReady } from "../adapters/postgres/selectorContextReadiness.ts";
import { pathToFileURL } from "node:url";
import { gitRepositoryConfiguration } from "../adapters/git/gitRepositoryConfiguration.ts";
import {
  finalizerGitEnvironmentNames,
  repositoryCredentialFilesOf,
} from "../interpreter/finalizerSettings.ts";
import {
  githubInstallationTokens,
  githubInstallationTokensOptions,
  githubInstallationTokensPrecondition,
} from "../adapters/forge/githubInstallationTokens.ts";
import { githubAccountOf } from "../adapters/forge/githubAddress.ts";
import {
  githubApps,
  githubInstallationDirectory,
} from "../adapters/forge/githubApp.ts";
import {
  githubInstallationRepositories,
  githubInstallationRepositoriesDefaults,
} from "../adapters/forge/githubInstallationRepositories.ts";
import {
  githubClientSecretPresence,
  githubUserAuthorization,
} from "../adapters/forge/githubUserAuthorization.ts";
import type {
  RepositoryOnboarding,
  RepositoryOnboardingAuthorization,
  RepositoryOnboardingForgeApp,
} from "../interpreter/repositoryOnboarding.ts";
import { forgeRepositoriesAnsweredMax } from "../contract/http.ts";
import {
  bootstrapImageFault,
  bootstrapPublicOriginFault,
} from "../interpreter/bootstrapConfiguration.ts";
import type { ForgeCredentialMinting } from "../interpreter/forgeCredentials.ts";
import type { RepositoryCredentialPort } from "../interpreter/finalizer.ts";
import {
  forgeAppKeyOf,
  githubForgeId,
  portalForgeApp,
  type ForgeApp,
  type ForgeAppKey,
} from "../interpreter/forgeInstallation.ts";
import type {
  RepositoryConfigurationSnapshotPort,
  RepositoryDefaultBranchPort,
} from "../interpreter/repositoryConfiguration.ts";
import type { ProjectAccess } from "../interpreter/projectAccess.ts";
import { oidcPrincipal, type Principal } from "../interpreter/principal.ts";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { hydraWorkerPoolClients } from "../adapters/hydra/oauthClients.ts";
import {
  postgresPersonalRunnerRegistrationTokens,
  postgresPersonalRunnerRegistry,
} from "../adapters/postgres/personalRunner.ts";
import {
  personalRunnerService,
  type PersonalRunnerService,
} from "../interpreter/personalRunnerRegistration.ts";
import type { WorkerPoolClients } from "../interpreter/workerPool.ts";
import { runnerReleasesPinned } from "./runnerReleases.ts";
import { ketoProjectGrants } from "../adapters/keto/projectGrants.ts";
import {
  checkedProjectGrantSettings,
  type ProjectGrantWriter,
} from "../interpreter/projectGrant.ts";
import {
  postgresWorkerPoolDirectory,
  postgresWorkerPoolRegistrationTokens,
  postgresWorkerPoolRegistry,
} from "../adapters/postgres/workerPool.ts";
import {
  workerPoolRegistrationService,
  type WorkerPoolRegistrationService,
  type WorkerPoolSite,
} from "../interpreter/workerPoolRegistrationToken.ts";
import {
  workerPoolEndpointSchema,
  workerPoolRegistryHostSchema,
} from "../contract/responses.ts";
import {
  actionReporterRoster,
  actionReports,
  rosterActionReporters,
  type ActionReporter,
  type ActionReports,
} from "../interpreter/actionReport.ts";
import { postgresActionObservations } from "../adapters/postgres/actionObservation.ts";
import { postgresTicketActionReach } from "../adapters/postgres/actionReach.ts";
import { postgresTicketLandings } from "../adapters/postgres/ticketLandings.ts";
import {
  ticketLandingReads,
  type TicketLandingReads,
} from "../interpreter/ticketLandings.ts";
import type { ProjectArtifactPort } from "../interpreter/finalizerPreparation.ts";
import { gitCommitAncestry } from "../adapters/git/gitCommitAncestry.ts";
import { systemPacing } from "../adapters/runtime/systemPacing.ts";
import { actionReachAncestry } from "../interpreter/actionReachAncestry.ts";
import type { CommitAncestryPort } from "../interpreter/commitAncestry.ts";
import {
  ticketActionReaches,
  type TicketActionReaches,
} from "../interpreter/ticketActionReach.ts";
import { bearerSecretReporters } from "../adapters/reporters/bearerSecret.ts";
import { fluxSignatureReporters } from "../adapters/reporters/fluxSignature.ts";

const databaseUrlVariable = "CHUG_API_DATABASE_URL";
const idempotencyKeyingVariable = "CHUG_API_IDEMPOTENCY_KEYING";
const oidcIssuerVariable = "CHUG_API_OIDC_ISSUER";
const oidcAudienceVariable = "CHUG_API_OIDC_AUDIENCE";
const oidcAlgorithmsVariable = "CHUG_API_OIDC_ALGORITHMS";
const artifactRootVariable = "CHUG_API_ARTIFACT_ROOT";
const ketoReadUrlVariable = "CHUG_API_KETO_READ_URL";
/**
 * The only two addresses this process names that write rather than read. The
 * authority's write port alone is what creating a project needs, and a pool's
 * registration needs both, so naming the issuer's admin port without it refuses
 * the start rather than minting a client the authority is never told about.
 */
const ketoWriteUrlVariable = "CHUG_API_KETO_WRITE_URL";
const hydraAdminUrlVariable = "CHUG_API_HYDRA_ADMIN_URL";
const ketoTimeoutVariable = "CHUG_API_KETO_TIMEOUT_MS";
/**
 * Where a registered runner, a pool or a member's personal one, reaches this
 * deployment, which a redemption answers so a runner's file is written whole:
 * required wherever runners are registered, the registry host only where the
 * deployment names one of its own.
 */
const poolTokenUrlVariable = "CHUG_API_POOL_TOKEN_URL";
const poolPlaneUrlVariable = "CHUG_API_POOL_PLANE_URL";
const poolRegistryHostVariable = "CHUG_API_POOL_REGISTRY_HOST";
/**
 * The named credential mount a member's thread speaks through. It is REQUIRED
 * rather than defaulted: the slot is what a per-user Anthropic credential
 * arrives as, and a default would open every member's thread on whatever the
 * lead happens to use while reading as though somebody had chosen it.
 */
const threadCredentialSlotVariable = "CHUG_API_THREAD_CREDENTIAL_SLOT";
const selectorReviewDatabaseUrlVariable =
  "CHUG_API_SELECTOR_REVIEW_DATABASE_URL";
/**
 * The subject the site's selector authenticates as under this API's issuer.
 * Naming one grants the selector each project created here; naming none leaves
 * granting it to an operator.
 */
const selectorSubjectVariable = "CHUG_API_SELECTOR_SUBJECT";
const gitScratchRootVariable = "CHUG_API_GIT_SCRATCH_ROOT";
const repositoryCredentialSourcesVariable =
  "CHUG_API_REPOSITORY_CREDENTIAL_SOURCES";
/**
 * The portal app this process acts under and the key it signs with, and the
 * worker app it finds on a proven account and enumerates an installation of.
 * Each pair is named together or not at all: one alone is a deployment that
 * meant to hold an app and cannot, which is a refusal to start rather than an
 * outage per request.
 */
const forgeAppIdVariable = "CHUG_API_FORGE_APP_ID";
const forgeAppKeyFileVariable = "CHUG_API_FORGE_APP_KEY_FILE";
const forgeWorkerAppIdVariable = "CHUG_API_FORGE_WORKER_APP_ID";
const forgeWorkerAppKeyFileVariable = "CHUG_API_FORGE_WORKER_APP_KEY_FILE";
const forgeApiUrlVariable = "CHUG_API_FORGE_API_URL";
const forgeTimeoutVariable = "CHUG_API_FORGE_TIMEOUT_MS";
const forgeRepositoriesMaxVariable = "CHUG_API_FORGE_REPOSITORIES_MAX";
/**
 * The portal app's client secret, which redeems a person's authorization of the
 * app. It is optional and withholds only that: a deployment naming none, or
 * naming a file that is absent or empty as it starts, answers an authorization
 * `NotConfigured`, and one naming a secret without a portal key, or a file it
 * cannot read, refuses to start.
 */
const forgeClientSecretFileVariable = "CHUG_API_FORGE_APP_CLIENT_SECRET_FILE";
/**
 * The worker image a bootstrap configuration commands. It is optional and a
 * deployment naming none authors no bootstrap, and it is held only to the
 * reference grammar here, so an image chuggy's runtime cannot run in fails
 * where every other such image does, when its job starts.
 */
const bootstrapWorkerImageVariable = "CHUG_API_BOOTSTRAP_WORKER_IMAGE";
/**
 * The origin this API is publicly reached at, which a bootstrap configuration
 * names the configuration schema under because a job is told no origin of its
 * own. Optional: a deployment naming none tells its bootstrap ticket the
 * route alone.
 */
const publicOriginVariable = "CHUG_API_PUBLIC_ORIGIN";
/**
 * Who may report what a declared action did: a JSON roster of reporters, each
 * a scheme, the file its secret is in, a project and the actions it may report
 * there. A deployment naming none answers every report as not found.
 */
const actionReportersVariable = "CHUG_API_ACTION_REPORTERS";
/**
 * The largest body a project-owned artifact upload carries, the same
 * deployment-overridable precedent as the worker plane's own upload bound.
 * The artifact store's own write ceiling is set to this same value, so what
 * the wire admits and what the store would refuse never diverge.
 */
const projectArtifactUploadBytesMaxVariable =
  "CHUG_API_PROJECT_ARTIFACT_UPLOAD_BYTES_MAX";

/** One pool address, refused at start where a runner would refuse it in the pool file. */
function poolEndpointSetting(variable: string): string {
  const text = requiredEnvironment(variable);
  if (!workerPoolEndpointSchema.safeParse(text).success)
    throw new Error(
      `${variable} must be an https URL, or an http URL on the loopback, carrying no credentials`,
    );
  return new URL(text).toString();
}

/**
 * Where a registered pool reaches this deployment, refused at start where a
 * runner would refuse the pool file: a redemption spends its token and
 * registers the pool before the runner reads the file.
 */
export function workerPoolSite(): WorkerPoolSite {
  const registryHost = process.env[poolRegistryHostVariable];
  const named = registryHost !== undefined && registryHost.length > 0;
  if (named && !workerPoolRegistryHostSchema.safeParse(registryHost).success)
    throw new Error(
      `${poolRegistryHostVariable} must be a lowercase host, and a port where it names one`,
    );
  return {
    issuer: requiredEnvironment(oidcIssuerVariable),
    tokenUrl: poolEndpointSetting(poolTokenUrlVariable),
    audience: requiredEnvironment(oidcAudienceVariable),
    planeUrl: poolEndpointSetting(poolPlaneUrlVariable),
    ...(named ? { registryHost } : {}),
  };
}

/**
 * The registration half of worker pools, composed only where an installation
 * named both addresses it needs. It is the one place in this tree that holds
 * the issuer's admin privilege beside an owner's command, which is what keeps
 * it off the plane a pool polls.
 */
function nativeWorkerPools(
  pool: pg.Pool,
  access: ProjectAccess,
  grants: ProjectGrantWriter | undefined,
): WorkerPoolRegistrationService | undefined {
  if (process.env[hydraAdminUrlVariable] === undefined) return undefined;
  if (grants === undefined)
    throw new Error(`${ketoWriteUrlVariable} is required`);
  return workerPoolRegistrationService({
    access,
    site: workerPoolSite(),
    directory: postgresWorkerPoolDirectory(pool),
    releases: runnerReleasesPinned(),
    minting: {
      tokens: postgresWorkerPoolRegistrationTokens(pool),
      ...nativeRegistrationTokenDrawing,
    },
    ports: {
      registry: postgresWorkerPoolRegistry(pool),
      clients: nativeRunnerClients(),
      grants,
      clientId: () => `chuggy-pool-${randomUUID()}`,
    },
  });
}

/** How a runner's registration token is drawn and digested, and the clock it expires by, the same for a pool's and a member's. */
const nativeRegistrationTokenDrawing = {
  draw: () => randomBytes(32).toString("base64url"),
  digest: (token: string) => createHash("sha256").update(token).digest("hex"),
  nowMs: () => Date.now(),
};

/** The issuer's client registration every runner's client, a pool's or a member's, is made through. */
function nativeRunnerClients(): WorkerPoolClients {
  return hydraWorkerPoolClients({
    adminUrl: requiredEnvironment(hydraAdminUrlVariable),
    audience: requiredEnvironment(oidcAudienceVariable),
    requestTimeoutMs: positiveEnvironment(
      ketoTimeoutVariable,
      projectAccessTimeoutMsDefault,
    ),
  });
}

/**
 * A member's own runner, composed where the issuer's admin port is named, as a
 * pool's registration is. It writes no relation, so it needs no write address
 * at the authority; its client ids are prefixed apart from a pool's.
 */
function nativePersonalRunners(
  pool: pg.Pool,
  access: ProjectAccess,
): PersonalRunnerService | undefined {
  if (process.env[hydraAdminUrlVariable] === undefined) return undefined;
  return personalRunnerService({
    access,
    site: workerPoolSite(),
    releases: runnerReleasesPinned(),
    minting: {
      tokens: postgresPersonalRunnerRegistrationTokens(pool),
      ...nativeRegistrationTokenDrawing,
    },
    ports: {
      registry: postgresPersonalRunnerRegistry(pool),
      clients: nativeRunnerClients(),
      clientId: () => `chuggy-personal-${randomUUID()}`,
    },
  });
}

/**
 * The reporters this deployment names, none where it names no roster, and a
 * refusal to start where the roster cannot be read. No secret's file is read
 * here: one that is absent or empty is a reporter no request verifies as.
 */
export function nativeActionReporters(): readonly ActionReporter[] {
  const encoded = process.env[actionReportersVariable];
  if (encoded === undefined || encoded.length === 0) return [];
  const roster = actionReporterRoster(encoded);
  if (roster.read === "Refused")
    throw new Error(`${actionReportersVariable} ${roster.why}`);
  return roster.reporters;
}

/**
 * The report route's service over the reporters named, recording over the API
 * pool and verifying by each scheme a roster may name, a signed event's
 * timestamp weighed against this process's clock. It is composed whoever is
 * named, because a path nothing serves is answered by the authentication hook
 * and not as a resource that is not there.
 */
export function nativeActionReports(
  pools: Pick<NativePools, "pool">,
  reporters: readonly ActionReporter[],
): ActionReports {
  return actionReports({
    reporters: rosterActionReporters(reporters, {
      BearerSecret: bearerSecretReporters(),
      FluxSignature: fluxSignatureReporters(() => Date.now()),
    }),
    observations: postgresActionObservations(pools.pool),
  });
}

/** The site's selector as the authority knows it, or nothing where this deployment names none. */
function nativeSelectorPrincipal(issuer: string): Principal | undefined {
  const subject = process.env[selectorSubjectVariable];
  if (subject === undefined || subject.length === 0) return undefined;
  return oidcPrincipal(issuer, subject);
}

/** What writes the authority's tuples, or nothing where this deployment names no write port. */
function nativeProjectGrants(): ProjectGrantWriter | undefined {
  const writeUrl = process.env[ketoWriteUrlVariable];
  if (writeUrl === undefined) return undefined;
  return ketoProjectGrants(checkedProjectGrantSettings({ writeUrl }));
}

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

/**
 * What one pool's check answered: refused under `refused` where its database
 * answered no, and undecided under the failure's own message where it could
 * not be reached or queried.
 */
function nativeDatabaseVerdict(
  answered: Promise<boolean>,
  refused: string,
): Promise<RuntimePreconditionVerdict> {
  return answered.then(
    (met) => runtimePreconditionAnswer(met, refused),
    runtimePreconditionUndecided,
  );
}

function apiDatabaseReady(
  pool: ReturnType<typeof postgresPool>,
): Promise<RuntimePreconditionVerdict> {
  return nativeDatabaseVerdict(
    postgresApiReady(pool),
    `must be migrated and connect as ${apiRole}`,
  );
}

function selectorReviewDatabaseReady(
  selectorReviewPool: ReturnType<typeof postgresPool>,
): Promise<RuntimePreconditionVerdict> {
  return nativeDatabaseVerdict(
    postgresSelectorContextReady(selectorReviewPool),
    `must connect as ${selectorReviewRole}`,
  );
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
      (await apiDatabaseReady(pool)).met === "Met" &&
      (await selectorReviewDatabaseReady(selectorReviewPool)).met === "Met" &&
      (await ketoReadiness(access).ready()),
  };
}

/**
 * The project-owned artifact store, and the upload bound its own route is
 * served at, both set from the same value so the two never diverge.
 */
function nativeArtifacts(): {
  readonly artifacts: ReturnType<typeof artifactStore>;
  readonly uploadBytesMax: number;
} {
  const uploadBytesMax = positiveEnvironment(
    projectArtifactUploadBytesMaxVariable,
    projectArtifactUploadBytesMax,
  );
  return {
    artifacts: artifactStore({
      root: requiredEnvironment(artifactRootVariable),
      writeBytesMax: uploadBytesMax,
    }),
    uploadBytesMax,
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
 * The scratch this process's git adapters open, or nothing where the
 * deployment names no root. A git child is given the variables the finalizer's
 * settings name and never this process's own, which is where its database URL
 * is and where a shallow file or a graft, once named, would be believed.
 */
function nativeGitScratch() {
  const scratchDirectory = process.env[gitScratchRootVariable];
  if (scratchDirectory === undefined || scratchDirectory.length === 0)
    return undefined;
  return {
    scratchDirectory,
    identity: {
      name: "Chuggy configuration importer",
      email: "configuration-importer@chuggy.invalid",
    },
    environment: Object.fromEntries(
      finalizerGitEnvironmentNames
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    ),
  };
}

function repositoryConfigurationSnapshots(
  credentials: RepositoryCredentialPort,
) {
  const scratch = nativeGitScratch();
  return scratch === undefined
    ? undefined
    : gitRepositoryConfiguration({ ...scratch, credentials });
}

/**
 * The reach route's service: where a ticket landed and what was reported are
 * read over the API pool, and ancestry is asked of one adapter for the whole
 * process, over the scratch root the configuration reader is given and behind
 * what the reads keep of its answers. A deployment naming no scratch root can
 * ask nothing, so every commit is `Unknown` there; the route is composed
 * either way, because a path nothing serves is answered by the authentication
 * hook and not as a resource that is not there.
 */
export function nativeActionReach(
  pools: Pick<NativePools, "pool">,
  access: ProjectAccess,
  credentials: RepositoryCredentialPort,
): TicketActionReaches {
  const scratch = nativeGitScratch();
  const port: CommitAncestryPort =
    scratch === undefined
      ? { ancestry: () => Promise.resolve("Unknown") }
      : gitCommitAncestry({ ...scratch, credentials });
  return ticketActionReaches({
    access,
    store: postgresTicketActionReach(pools.pool),
    ancestry: actionReachAncestry({
      port,
      monotonicNowMs: () => performance.now(),
    }),
    pacing: systemPacing,
  });
}

/**
 * The landings route's service: the finalizer's rows are read through their
 * door over the API pool, and a conflict's manifest from the project-owned
 * store the finalizer wrote it to.
 */
export function nativeTicketLandings(
  pools: Pick<NativePools, "pool">,
  access: ProjectAccess,
  artifacts: Pick<ProjectArtifactPort, "readArtifact">,
): TicketLandingReads {
  return ticketLandingReads({
    access,
    store: postgresTicketLandings(pools.pool),
    artifacts,
  });
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
 * an app no deployment could ever claim.
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
 * is held so a tenant's authorization can claim the plane's installation and
 * read what it grants, which is the only thing it mints for; naming no worker
 * pair claims the portal app alone.
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

/**
 * The onboarding half for one app, which reads as that app and mints only to
 * enumerate. A listing mints for itself every time, so its token is answered at
 * once rather than every listing waiting out a settling.
 */
function forgeAppHalf(pair: ForgeAppPair): RepositoryOnboardingForgeApp {
  const options = githubInstallationTokensOptions(pair.key);
  return {
    forge: githubForgeId,
    app: pair.app,
    accountOf: githubAccountOf,
    apps: githubApps(options),
    directory: githubInstallationDirectory(options),
    installationRepositories: githubInstallationRepositories({
      ...options,
      tokens: githubInstallationTokens(options),
      repositoriesMax: forgeRepositoriesMax(),
    }),
  };
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
  await closePools(pools.pool, pools.selectorReviewPool);
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
 * The image a bootstrap configuration commands, or nothing where this
 * deployment names none; one its briefing cannot name, or no configuration
 * could, is refused here.
 */
function bootstrapWorkerImage(): string | undefined {
  const image = process.env[bootstrapWorkerImageVariable];
  if (image === undefined || image.length === 0) return undefined;
  const fault = bootstrapImageFault(image);
  if (fault !== undefined)
    throw new Error(
      `${bootstrapWorkerImageVariable} cannot be named by a bootstrap configuration: ${fault}`,
    );
  return image;
}

/**
 * The origin a bootstrap configuration names the configuration schema under,
 * or nothing where this deployment names none; one that is no origin as a URL
 * writes it, or that its briefing line cannot carry, is refused here.
 */
export function nativePublicOrigin(): string | undefined {
  const publicOrigin = process.env[publicOriginVariable];
  if (publicOrigin === undefined || publicOrigin.length === 0) return undefined;
  const fault = bootstrapPublicOriginFault(publicOrigin);
  if (fault !== undefined)
    throw new Error(
      `${publicOriginVariable} must be an http or https origin with nothing after it, such as https://chuggy.example, that a bootstrap configuration can name: ${fault}`,
    );
  return publicOrigin;
}

/**
 * The forge this process talks to: the credential source its own reads take,
 * the minting route's service, onboarding's, and the one adapter that reads a
 * repository — composed once because it opens one scratch, and handed to the
 * import route as well as to the bind's configuration step.
 */
export interface NativeForge {
  readonly credentials: RepositoryCredentialPort;
  readonly minting: ForgeCredentialMinting | undefined;
  readonly onboarding: RepositoryOnboarding;
  readonly repositories:
    | (RepositoryConfigurationSnapshotPort & RepositoryDefaultBranchPort)
    | undefined;
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
  const others = pairs
    .filter((pair) => pair.app !== portalForgeApp)
    .map(forgeAppHalf);
  const image = bootstrapWorkerImage();
  const publicOrigin = nativePublicOrigin();
  const minting = composeForgeRepositoryMinting(
    pools.pool,
    portal?.key,
    "Settled",
  );
  const credentials = nativeRepositoryCredentials(minting);
  const repositories = repositoryConfigurationSnapshots(credentials);
  const half = portal === undefined ? undefined : forgeAppHalf(portal);
  const authorization = await nativeForgeAuthorization(portal, half, pools);
  return {
    credentials,
    minting:
      minting === undefined
        ? undefined
        : composeForgeCredentialMinting(pools.pool, access, minting.tokens),
    repositories,
    onboarding: composeRepositoryOnboarding({
      apiPool: pools.pool,
      access,
      credentials,
      forgeApps: half === undefined ? others : [half, ...others],
      ...(repositories === undefined ? {} : { repositories }),
      ...(image === undefined ? {} : { bootstrapImage: image }),
      ...(publicOrigin === undefined ? {} : { publicOrigin }),
      ...(authorization === undefined ? {} : { authorization }),
    }),
  };
}

/** Refuses to start, leaving no pool open behind it. */
async function nativeForgeRefused(
  pools: NativePools,
  why: string,
): Promise<never> {
  await closePools(pools.pool, pools.selectorReviewPool);
  throw new Error(why);
}

/** What the client secret setting comes to at start, `portal` being what it redeems with where it is named. */
export type ForgeClientSecretSetting<T> =
  | { readonly setting: "Named"; readonly path: string; readonly portal: T }
  | { readonly setting: "Absent" }
  | { readonly setting: "Refused"; readonly why: string };

/** Whether the file is there is decided here; its contents are read per authorization. */
export async function forgeClientSecretSetting<T>(
  portal: T | undefined,
): Promise<ForgeClientSecretSetting<T>> {
  const path = process.env[forgeClientSecretFileVariable];
  if (path === undefined || path.length === 0) return { setting: "Absent" };
  const presence = await githubClientSecretPresence({
    clientSecretPath: path,
  });
  if (presence === "Absent") return { setting: "Absent" };
  if (presence === "Unreadable")
    return {
      setting: "Refused",
      why: `${forgeClientSecretFileVariable}: the file it names cannot be read`,
    };
  if (portal === undefined)
    return {
      setting: "Refused",
      why: `${forgeClientSecretFileVariable} is named without ${forgeAppIdVariable}`,
    };
  return { setting: "Named", path, portal };
}

/** The redemption of a person's authorization of the portal app, where this deployment names its client secret. */
async function nativeForgeAuthorization(
  portal: ForgeAppPair | undefined,
  half: RepositoryOnboardingForgeApp | undefined,
  pools: NativePools,
): Promise<RepositoryOnboardingAuthorization | undefined> {
  const secret = await forgeClientSecretSetting(
    portal === undefined || half === undefined
      ? undefined
      : { key: portal.key, half },
  );
  switch (secret.setting) {
    case "Absent":
      return undefined;
    case "Refused":
      return nativeForgeRefused(pools, secret.why);
    case "Named":
      return {
        forge: githubForgeId,
        app: portalForgeApp,
        user: githubUserAuthorization({
          ...githubInstallationTokensOptions(secret.portal.key),
          app: secret.portal.half.apps,
          clientSecretPath: secret.path,
        }),
      };
    default:
      return assertNever(secret);
  }
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

type HubNote = ProjectStreamNote | ThreadLiveNote;

/** The notes a client causes as often as it asks: a stream it is refused, and a stream closed for what its reader did or left undone. */
const clientNotes: ReadonlySet<HubNote["note"]> = new Set([
  "Refused",
  "SlowClientClosed",
  "PendingClosed",
  "SentClosed",
] as const);

/** How long a kind of note must go unheard before its run begins again, and how long after its last line a kind still arriving is written again. */
export const nativeNoteQuietMs = 60_000;

/** One kind of note: how many there have been, how many in the run it is in, the place in that run of the next one to double it, when the last came, and when one was last written. */
interface NoteRun {
  readonly total: number;
  readonly run: number;
  readonly next: number;
  readonly atMs: number;
  readonly writtenAtMs: number;
}

/**
 * Where a hub's notes are written: this process's own error stream, a line
 * each, where the rest of this root reports. A note of a kind a client causes
 * is written at the first of a run, at each that doubles the run, and at the
 * first after the quiet span has passed since its kind was last written, with
 * how many of its kind there have been in all, so that no client decides how
 * much this process writes and a kind still arriving says its count each
 * span; every other kind is paced by this process and written every time.
 */
function nativeNotes<Note extends HubNote>(
  name: string,
  text: (note: Note) => string,
): { noted(note: Note): void } {
  const runs = new Map<string, NoteRun>();
  return {
    noted: (note) => {
      if (!clientNotes.has(note.note)) {
        process.stderr.write(`${name}: ${text(note)}\n`);
        return;
      }
      const atMs = Date.now();
      const before = runs.get(note.note);
      const began =
        before === undefined || atMs - before.atMs >= nativeNoteQuietMs;
      const run = began ? 1 : before.run + 1;
      const next = began ? 1 : before.next;
      const total = (before?.total ?? 0) + 1;
      const overdue =
        before === undefined || atMs - before.writtenAtMs >= nativeNoteQuietMs;
      const written = run === next || overdue;
      runs.set(note.note, {
        total,
        run,
        next: run === next ? 2 * next : next,
        atMs,
        writtenAtMs: written ? atMs : before.writtenAtMs,
      });
      if (written)
        process.stderr.write(`${name}: ${text(note)} times=${String(total)}\n`);
    },
  };
}

export function nativeStreamReport(): ProjectStreamReport {
  return nativeNotes("project stream", streamNoteText);
}

export function nativeThreadLiveReport(): ThreadLiveReport {
  return nativeNotes("thread live", threadLiveNoteText);
}

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

export function nativeStreamHub(
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
    report: nativeStreamReport(),
    limits: nativeStreamLimits(),
  });
}

function threadLiveNoteText(note: ThreadLiveNote): string {
  const totals = `connections=${String(note.connectionsOpen)} sessions=${String(note.sessionsHeld)} heldBytes=${String(note.heldBytes)} pendingBytes=${String(note.pendingBytes)} sentBytes=${String(note.sentBytes)} events=${String(note.eventsHeard)} unread=${String(note.payloadsUnread)} shed=${String(note.payloadsShed)}`;
  switch (note.note) {
    case "Sourced":
      return `the lane is ${note.source}, ${totals}`;
    case "Refused":
      return `refused a connection at capacity, ${totals}`;
    case "SlowClientClosed":
      return `cut a connection that stopped reading, ${totals}`;
    case "PendingClosed":
      return `cut a connection behind past what the connections behind may hold unwritten, ${totals}`;
    case "SentClosed":
      return `cut the connection written the most, past what the open connections may have been written, ${totals}`;
    case "Unread":
      return `dropped payloads that were not live events, ${totals}`;
    case "Shed":
      return `left payloads unread past what one window reads, and dropped what was held, ${totals}`;
    default:
      return assertNever(note);
  }
}

/** Each bound of the thread live hub, from its own variable or the hub's default. */
export function nativeThreadLiveLimits(): ThreadLiveLimits {
  const defaults = threadLiveLimitsDefault;
  return {
    connectionsMax: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_CONNECTIONS_MAX",
      defaults.connectionsMax,
    ),
    sessionReadersMax: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_SESSION_READERS_MAX",
      defaults.sessionReadersMax,
    ),
    maxAgeMs: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_MAX_AGE_MS",
      defaults.maxAgeMs,
    ),
    heartbeatMs: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_HEARTBEAT_MS",
      defaults.heartbeatMs,
    ),
    slowClientWaitMs: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_SLOW_CLIENT_WAIT_MS",
      defaults.slowClientWaitMs,
    ),
    pendingBytesMax: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_PENDING_BYTES_MAX",
      defaults.pendingBytesMax,
    ),
    sentBytesMax: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_SENT_BYTES_MAX",
      defaults.sentBytesMax,
    ),
    sessionsHeldMax: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_SESSIONS_HELD_MAX",
      defaults.sessionsHeldMax,
    ),
    heldBytesMax: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_HELD_BYTES_MAX",
      defaults.heldBytesMax,
    ),
    sessionTextBytesMax: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_SESSION_TEXT_BYTES_MAX",
      defaults.sessionTextBytesMax,
    ),
    sessionIdleMs: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_SESSION_IDLE_MS",
      defaults.sessionIdleMs,
    ),
    windowMs: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_WINDOW_MS",
      defaults.windowMs,
    ),
    windowEventsMax: positiveEnvironment(
      "CHUG_API_THREAD_LIVE_WINDOW_EVENTS_MAX",
      defaults.windowEventsMax,
    ),
  };
}

/** The thread live hub over a listening connection of its own, reporting where the project stream's hub does. */
export function nativeThreadLiveHub(): ThreadLiveHub {
  return threadLiveHub({
    lane: postgresSessionLiveLane(requiredEnvironment(databaseUrlVariable)),
    timers: systemStreamTimers,
    report: nativeThreadLiveReport(),
    framed: threadLiveFramed,
    limits: nativeThreadLiveLimits(),
  });
}

/**
 * Ends every stream before the drain begins, because a stream is a response
 * that never finishes and a drain that waited for one would wait out its
 * deadline.
 */
function nativeShutdown(
  app: ReturnType<typeof createNativeHttpApp>,
  streamsClosed: () => Promise<void>,
  drainMs: number,
): () => Promise<void> {
  let started = false;
  return async () => {
    if (started) return;
    started = true;
    await streamsClosed();
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

/** Closes the hubs and then the pools as the app closes, and drains on either signal a supervisor stops it with. */
export function nativeStopping(
  app: ReturnType<typeof createNativeHttpApp>,
  pools: NativePools,
  hubs: readonly Pick<ProjectStreamHub, "close">[],
): void {
  const streamsClosed = async (): Promise<void> => {
    for (const hub of hubs) await hub.close();
  };
  app.addHook("onClose", async () => {
    await streamsClosed();
    await closePools(pools.pool, pools.selectorReviewPool);
  });
  nativeShutdownSignals(
    nativeShutdown(
      app,
      streamsClosed,
      positiveEnvironment("CHUG_API_SHUTDOWN_DRAIN_MS", 15_000),
    ),
  );
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

/** The bearers this API accepts, leaving neither pool open where the issuer cannot be reached at start. */
async function nativeAuthenticationStarted(
  config: OidcAuthenticationConfig,
  pools: NativePools,
): Promise<PrincipalAuthentication> {
  const oidc = await oidcAuthentication(config).catch(
    async (failure: unknown) => {
      await closePools(pools.pool, pools.selectorReviewPool);
      throw failure;
    },
  );
  return nativeAuthentication(oidc, pools);
}

/** What a start refuses one database's verdict with, or nothing where it was met. */
function nativeDatabaseRefusal(
  database: string,
  verdict: RuntimePreconditionVerdict,
): string | undefined {
  switch (verdict.met) {
    case "Met":
      return undefined;
    case "Refused":
      return `${database} ${verdict.why}`;
    case "Undecided":
      return `${database} could not be reached or queried — ${verdict.why}`;
    default:
      return assertNever(verdict);
  }
}

/**
 * Refuses to start on either pool this process must have, naming which one and
 * whether its database answered, and leaves neither open behind the refusal.
 */
export async function nativeDatabasesReady(
  pool: ReturnType<typeof postgresPool>,
  selectorReviewPool: ReturnType<typeof postgresPool>,
): Promise<void> {
  const refusal =
    nativeDatabaseRefusal(
      "the native HTTP database",
      await apiDatabaseReady(pool),
    ) ??
    nativeDatabaseRefusal(
      "the selector review database",
      await selectorReviewDatabaseReady(selectorReviewPool),
    );
  if (refusal === undefined) return;
  await closePools(pool, selectorReviewPool);
  throw new Error(refusal);
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
    settings: postgresSelectorResolvedSettings(pools.pool),
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
  const reporters = nativeActionReporters();
  const pools = nativePools();
  const { pool, selectorReviewPool } = pools;
  await nativeDatabasesReady(pool, selectorReviewPool);
  const authentication = await nativeAuthenticationStarted(
    authenticationConfig,
    pools,
  );
  const accessSettings = ketoConfig();
  const access = ketoProjectAccess(accessSettings);
  const grants = nativeProjectGrants();
  const { artifacts, uploadBytesMax } = nativeArtifacts();
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
    forge.repositories,
    nativeLeadPorts(pools, artifacts),
    nativeThreadPorts(pools, artifacts),
  );
  const hub = nativeStreamHub(pool, web);
  const threadLive = nativeThreadLiveHub();
  const app = createNativeHttpApp(
    web,
    authentication,
    nativeReadiness(pool, selectorReviewPool, accessSettings),
    postgresInstallationAuthority(pool),
    {
      ...nativeHttpLimitsDefault,
      projectArtifactUploadBytesMax: uploadBytesMax,
    },
    hub,
    composeSelectorProjectSettings(pool, access),
    forge.minting,
    forge.onboarding,
    nativeWorkerPools(pool, access, grants),
    composeProjectCreation(
      pool,
      access,
      ketoTenantClaims(accessSettings),
      grants,
      nativeSelectorPrincipal(authenticationConfig.issuer),
    ),
    composeExecutionPlacement(pool, access),
    composeSessionPlacement(pool, access),
    composeSelectorProposalReviews(selectorReviewPool, access),
    threadLive,
    nativeActionReports(pools, reporters),
    nativeActionReach(pools, access, forge.credentials),
    nativeTicketLandings(pools, access, artifacts),
    nativePersonalRunners(pool, access),
    composeProjectOwnerFallback(pool, access),
    composeThreadLimits(pool, access, authenticationConfig.issuer),
  );
  nativeStopping(app, pools, [hub, threadLive]);
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
