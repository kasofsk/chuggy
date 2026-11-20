import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  artifactStore,
  type ArtifactStore,
} from "../adapters/artifacts/artifactStore.ts";
import { jobIdentitySigner } from "../adapters/crypto/jobIdentitySigner.ts";
import { githubRepositoryHost } from "../adapters/forge/githubAddress.ts";
import {
  githubInstallationTokens,
  githubInstallationTokensPrecondition,
  githubInstallationTokensSettings,
  githubInstallationTokensSettled,
  type GithubInstallationTokensOptions,
} from "../adapters/forge/githubInstallationTokens.ts";
import { mintedRepositoryTokens } from "../adapters/forge/mintedCredentials.ts";
import {
  createWorkerPlaneApp,
  type SessionPlaneService,
} from "../adapters/http/workerPlaneServer.ts";
import { ketoProjectAccess } from "../adapters/keto/projectAccess.ts";
import { postgresForgeInstallations } from "../adapters/postgres/forgeInstallation.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresProjectConnectors } from "../adapters/postgres/projectConnectors.ts";
import { postgresProjectRepositoryLanding } from "../adapters/postgres/repositoryBinding.ts";
import { workerPlaneRole } from "../adapters/postgres/schema.ts";
import {
  reporterSecretBytes,
  reporterSecretBytesMax,
} from "../adapters/reporters/secretFile.ts";
import { postgresSessionLivePublisher } from "../adapters/postgres/sessionLive.ts";
import { postgresSessionPlane } from "../adapters/postgres/sessionPlane.ts";
import { postgresThreadJobWakes } from "../adapters/postgres/thread.ts";
import {
  postgresWorkerPlaneAuthority,
  postgresWorkerAttemptHeartbeats,
  postgresWorkerArtifactReservations,
  postgresWorkerReportStore,
  postgresWorkerRunConfiguration,
  postgresWorkerRunContext,
  postgresWorkerRunEnded,
  postgresWorkerRunTotal,
  postgresWorkerRunTranscript,
  postgresWorkerRunTurns,
  postgresWorkerTasks,
} from "../adapters/postgres/workerPlane.ts";
import { workerPlaneUploadBytesMax } from "../contract/http.ts";
import {
  credentialResolver,
  type CredentialIssuer,
} from "../interpreter/credentialIssuers.ts";
import {
  jobIdentityIssuerSettings,
  type JobIdentityIssuing,
} from "../interpreter/jobIdentityIssuerSettings.ts";
import {
  checkedProjectAccessSettings,
  projectAccessTimeoutMsDefault,
} from "../interpreter/projectAccess.ts";
import { silentSchedulerTelemetry } from "../interpreter/executionScheduler.ts";
import { executionSchedulerIngest } from "../interpreter/executionSchedulerReport.ts";
import {
  githubForgeId,
  workerPodForgeApp,
} from "../interpreter/forgeInstallation.ts";
import {
  sessionLiveAllowanceLimitsDefault,
  sessionLivePublishAllowed,
  type SessionLiveAllowanceLimits,
} from "../interpreter/sessionLiveAllowance.ts";
import type { SessionLivePublishPort } from "../interpreter/sessionPlane.ts";
import { sessionSchedulerDefaults } from "../interpreter/sessionScheduler.ts";
import type { ThreadJobWakeService } from "../interpreter/threadWake.ts";
import {
  workerPlaneCredentialMinting,
  type WorkerPlaneCredentialMinting,
} from "../interpreter/workerPlaneCredentials.ts";
import { workflowRunsCredentialIssuer } from "../interpreter/workflowRunsCredential.ts";
import {
  heldCredentialIssuer,
  heldCredentialRoster,
  heldCredentialSecret,
} from "../interpreter/workerPlaneHeldCredentials.ts";
import {
  planeEnvironmentPositive as positive,
  planeEnvironmentRequired as required,
} from "./planeEnvironment.ts";
import { planeStopping } from "./planeStopping.ts";

/**
 * How a chat host's thread attempt wakes its own thread, composed only where
 * the plane is told the project access its checks ask, because a wake the
 * plane could not check is one it does not make.
 */
function planeSessionWakes(
  pool: ReturnType<typeof postgresPool>,
): ThreadJobWakeService | undefined {
  const readUrl = process.env["CHUG_WORKER_PLANE_KETO_READ_URL"];
  if (readUrl === undefined || readUrl.length === 0) return undefined;
  return {
    store: postgresThreadJobWakes(pool),
    access: ketoProjectAccess(
      checkedProjectAccessSettings({
        readUrl,
        requestTimeoutMs: positive(
          "CHUG_WORKER_PLANE_KETO_TIMEOUT_MS",
          projectAccessTimeoutMsDefault,
        ),
      }),
    ),
    clock: { nowIso: () => new Date().toISOString() },
  };
}

/**
 * The session half of this plane, over the run half's pool and artifact store,
 * composed whole or not at all because its ports are one bearer and a partial
 * one could only answer a session wrongly. Its lease defaults to
 * `sessionSchedulerDefaults.attemptLeaseSecs`, the value the scheduler opens a
 * session attempt's lease under, so a deployment that moves one moves both.
 */
function planeSessions(
  pool: ReturnType<typeof postgresPool>,
  artifacts: ArtifactStore,
): SessionPlaneService {
  const sessions = postgresSessionPlane(pool);
  const wakes = planeSessionWakes(pool);
  return {
    authority: sessions,
    heartbeats: sessions,
    references: sessions,
    standings: sessions,
    ticketWakes: sessions,
    ...(wakes === undefined ? {} : { wakes }),
    turns: sessions,
    settlements: sessions,
    watches: sessions,
    live: planeSessionLive(pool),
    holds: sessions,
    losses: sessions,
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

/** Each bound of a session's live allowance, from its own variable or the allowance's default. */
function planeSessionLiveAllowanceLimits(): SessionLiveAllowanceLimits {
  const defaults = sessionLiveAllowanceLimitsDefault;
  return {
    eventsPerSecondMax: positive(
      "CHUG_WORKER_PLANE_SESSION_LIVE_EVENTS_PER_SEC_MAX",
      defaults.eventsPerSecondMax,
    ),
    eventsBurstMax: positive(
      "CHUG_WORKER_PLANE_SESSION_LIVE_EVENTS_BURST_MAX",
      defaults.eventsBurstMax,
    ),
    sessionsTrackedMax: positive(
      "CHUG_WORKER_PLANE_SESSION_LIVE_SESSIONS_TRACKED_MAX",
      defaults.sessionsTrackedMax,
    ),
  };
}

/** The lane a session's live events are published on, behind each session's allowance, both reporting where this plane reports. */
function planeSessionLive(
  pool: ReturnType<typeof postgresPool>,
): SessionLivePublishPort {
  const told = (what: string, total: number): void => {
    process.stderr.write(`worker plane: ${what}: ${String(total)}\n`);
  };
  return sessionLivePublishAllowed(
    postgresSessionLivePublisher(pool, {
      dropped: (droppedTotal) => {
        told("live events too heavy to publish", droppedTotal);
      },
    }),
    () => Date.now(),
    {
      refused: (refusedTotal) => {
        told("live posts past their session's allowance", refusedTotal);
      },
    },
    planeSessionLiveAllowanceLimits(),
  );
}

/**
 * The key this plane signs with and the id of the app it belongs to, both the
 * deployment's to name and named together or not at all: one alone is a
 * deployment that meant to mint and cannot, which is a refusal to start rather
 * than a pod silently falling back to a credential its launcher may no longer
 * mount.
 *
 * WHICH app a claim is looked up under is the code's: `workerPodForgeApp`
 * selects the claim row, and nothing here checks that the id below is that
 * app's, so a deployment naming the portal App's id and key mints nothing at
 * all — the installation that row claims is the worker App's, and GitHub
 * refuses a token request another app signed for it.
 */
const forgeAppIdVariable = "CHUG_WORKER_PLANE_FORGE_APP_ID";
const forgeAppKeyFileVariable = "CHUG_WORKER_PLANE_FORGE_APP_KEY_FILE";
const forgeApiUrlVariable = "CHUG_WORKER_PLANE_FORGE_API_URL";
const forgeTimeoutVariable = "CHUG_WORKER_PLANE_FORGE_TIMEOUT_MS";

/** What this plane mints with, or nothing at all where it holds no app key. */
function planeForgeOptions(): GithubInstallationTokensOptions | undefined {
  return githubInstallationTokensSettings(
    {
      appId: forgeAppIdVariable,
      appKeyFile: forgeAppKeyFileVariable,
      apiUrl: forgeApiUrlVariable,
      timeoutMs: forgeTimeoutVariable,
    },
    process.env,
    positive,
  );
}

/** What this plane mints with its forge app: a pod's git credential, and the credential that runs its repository's workflows. */
interface PlaneForgeCredentials {
  readonly minting: WorkerPlaneCredentialMinting;
  readonly workflowRuns: CredentialIssuer;
}

/**
 * The minting a pod's credential routes answer from, and the issuer of the
 * workflow runs credential, or nothing where this deployment holds no app key:
 * a pod then resolves what its launcher mounted for the repository it works in,
 * and the workflow runs credential is served by no issuer.
 * A key this process could not sign with refuses the start, leaving no pool
 * open behind it: minting that fails at every attempt is worse than not minting
 * at all, because the pods cannot tell the two apart.
 */
async function planeCredentials(
  pool: ReturnType<typeof postgresPool>,
): Promise<PlaneForgeCredentials | undefined> {
  const options = planeForgeOptions();
  if (options === undefined) return undefined;
  const verdict = await githubInstallationTokensPrecondition(options).check(
    new AbortController().signal,
  );
  if (verdict.met !== "Met") {
    await pool.end();
    throw new Error(`${forgeAppKeyFileVariable}: ${verdict.why}`);
  }
  const bindings = postgresProjectRepositoryLanding(pool);
  const tokens = mintedRepositoryTokens({
    forge: githubForgeId,
    app: workerPodForgeApp,
    repositoryHost: githubRepositoryHost,
    installations: postgresForgeInstallations(pool),
    tokens: githubInstallationTokens(githubInstallationTokensSettled(options)),
    bindings,
  });
  return {
    minting: workerPlaneCredentialMinting({ tokens, bindings }),
    workflowRuns: workflowRunsCredentialIssuer({ tokens, bindings }),
  };
}

/**
 * The credentials this deployment holds as files, each named with the project
 * it is held for: a JSON list of `credential`, `tenant`, `project`, `variable`
 * and `file`. A deployment naming none holds nothing.
 */
const heldCredentialsVariable = "CHUG_WORKER_PLANE_HELD_CREDENTIALS";

/** The text a held credential's file holds, read as a reporter's secret file is. */
async function planeHeldCredentialText(
  file: string,
): Promise<string | undefined> {
  return (await reporterSecretBytes(file))?.toString("utf8");
}

/**
 * The file roster's issuer, or none where no roster is named. Every file the
 * roster names is read once before the plane starts, as the app key is, so a
 * deployment that mounted the wrong path
 * refuses to start rather than answering an outage at every request; it is
 * read again on every request after that.
 */
async function planeHeldCredentials(): Promise<readonly CredentialIssuer[]> {
  const encoded = process.env[heldCredentialsVariable];
  if (encoded === undefined || encoded.length === 0) return [];
  const roster = heldCredentialRoster(encoded);
  if (roster.read === "Refused")
    throw new Error(`${heldCredentialsVariable} ${roster.why}`);
  for (const entry of roster.held)
    if (
      heldCredentialSecret(await planeHeldCredentialText(entry.file)) ===
      undefined
    )
      throw new Error(
        `${heldCredentialsVariable} holds ${entry.credential} for ${entry.partition.tenant}/${entry.partition.project} in a file that is not a readable, non-empty regular file`,
      );
  return [heldCredentialIssuer(roster.held, planeHeldCredentialText)];
}

const identityIssuerVariable = "CHUG_WORKER_PLANE_IDENTITY_ISSUER";
const identityKeyFilesVariable = "CHUG_WORKER_PLANE_IDENTITY_KEY_FILES";

/**
 * The identity issuer this plane signs and publishes with, or none where the
 * deployment names neither its base URL nor its key files. Every key file is
 * read once, before the plane starts, and a key the signer refuses refuses the
 * start.
 */
async function planeIdentity(): Promise<JobIdentityIssuing | undefined> {
  const settings = jobIdentityIssuerSettings(
    {
      issuerBaseUrl: identityIssuerVariable,
      keyFiles: identityKeyFilesVariable,
    },
    process.env,
  );
  if (settings.read === "Absent") return undefined;
  if (settings.read === "Refused") throw new Error(settings.why);
  const pems: string[] = [];
  for (const file of settings.keyFiles) {
    const bytes = await reporterSecretBytes(file);
    if (bytes === undefined)
      throw new Error(
        `${identityKeyFilesVariable} names ${file}, which is not a readable regular file of at most ${String(reporterSecretBytesMax)} bytes`,
      );
    pems.push(bytes.toString("utf8"));
  }
  const built = await jobIdentitySigner(pems);
  if (built.result === "Refused") {
    const { refusal } = built;
    const file = "key" in refusal ? settings.keyFiles[refusal.key] : undefined;
    throw new Error(
      `${identityKeyFilesVariable} names ${file ?? "no key"}, which the signer refuses: ${refusal.reason}`,
    );
  }
  return { issuerBaseUrl: settings.issuerBaseUrl, signer: built.signer };
}

async function main(): Promise<void> {
  const held = await planeHeldCredentials();
  const identity = await planeIdentity();
  const pool = postgresPool(required("CHUG_WORKER_PLANE_DATABASE_URL"));
  const uploadBytesMax = positive(
    "CHUG_WORKER_PLANE_UPLOAD_BYTES_MAX",
    workerPlaneUploadBytesMax,
  );
  const artifacts = artifactStore({
    root: required("CHUG_WORKER_PLANE_ARTIFACT_ROOT"),
    writeBytesMax: uploadBytesMax,
  });
  const forge = await planeCredentials(pool);
  const app = createWorkerPlaneApp({
    authority: postgresWorkerPlaneAuthority(pool),
    tasks: postgresWorkerTasks(pool),
    heartbeats: postgresWorkerAttemptHeartbeats(pool),
    heartbeatLeaseSecs: positive("CHUG_WORKER_PLANE_HEARTBEAT_LEASE_SECS", 300),
    reservations: postgresWorkerArtifactReservations(pool),
    artifacts,
    projectArtifacts: artifacts,
    runEvidence: {
      configurations: postgresWorkerRunConfiguration(pool),
      transcripts: postgresWorkerRunTranscript(pool),
      turns: postgresWorkerRunTurns(pool),
      totals: postgresWorkerRunTotal(pool),
      context: postgresWorkerRunContext(pool),
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
    ...(forge === undefined ? {} : { credentials: forge.minting }),
    heldCredentials: credentialResolver(
      forge === undefined ? held : [...held, forge.workflowRuns],
      postgresProjectConnectors(pool),
    ),
    ...(identity === undefined ? {} : { identity }),
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
  planeStopping(app, "worker plane", pool);
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
