import { pathToFileURL } from "node:url";

import {
  artifactStore,
  type ArtifactStore,
} from "../adapters/artifacts/artifactStore.ts";
import { githubRepositoryHost } from "../adapters/forge/githubAddress.ts";
import {
  githubInstallationTokens,
  githubInstallationTokensPrecondition,
  githubInstallationTokensSettings,
  type GithubInstallationTokensOptions,
} from "../adapters/forge/githubInstallationTokens.ts";
import { mintedRepositoryTokens } from "../adapters/forge/mintedCredentials.ts";
import {
  createWorkerPlaneApp,
  type SessionPlaneService,
} from "../adapters/http/workerPlaneServer.ts";
import { postgresForgeInstallations } from "../adapters/postgres/forgeInstallation.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import {
  planeEnvironmentPositive,
  planeEnvironmentRequired,
} from "./planeEnvironment.ts";
import { postgresProjectRepositoryBinding } from "../adapters/postgres/repositoryConfiguration.ts";
import { workerPlaneRole } from "../adapters/postgres/schema.ts";
import { postgresSessionPlane } from "../adapters/postgres/sessionPlane.ts";
import { postgresTicketExecutionTerminals } from "../adapters/postgres/ticketExecution.ts";
import { workerPlaneUploadBytesMax } from "../contract/http.ts";
import {
  githubForgeId,
  workerPodForgeApp,
} from "../interpreter/forgeInstallation.ts";
import { sessionSchedulerDefaults } from "../interpreter/sessionScheduler.ts";
import {
  workerPlaneCredentialMinting,
  type WorkerPlaneCredentialMinting,
} from "../interpreter/workerPlaneCredentials.ts";

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
    heartbeatLeaseSecs: planeEnvironmentPositive(
      "CHUG_WORKER_PLANE_SESSION_HEARTBEAT_LEASE_SECS",
      sessionSchedulerDefaults.attemptLeaseSecs,
    ),
    turnPollIntervalMs: planeEnvironmentPositive(
      "CHUG_WORKER_PLANE_SESSION_TURN_POLL_INTERVAL_MS",
      1_000,
    ),
    turnPollSecsMax: planeEnvironmentPositive(
      "CHUG_WORKER_PLANE_SESSION_TURN_POLL_SECS_MAX",
      25,
    ),
    pollsMax: planeEnvironmentPositive(
      "CHUG_WORKER_PLANE_SESSION_POLLS_MAX",
      64,
    ),
  };
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
    planeEnvironmentPositive,
  );
}

/**
 * The minting a pod's credential routes answer from, or nothing where this
 * deployment holds no app key and every pod resolves what its launcher mounted.
 * A key this process could not sign with refuses the start, leaving no pool
 * open behind it: minting that fails at every attempt is worse than not minting
 * at all, because the pods cannot tell the two apart.
 */
async function planeCredentials(
  pool: ReturnType<typeof postgresPool>,
): Promise<WorkerPlaneCredentialMinting | undefined> {
  const options = planeForgeOptions();
  if (options === undefined) return undefined;
  const verdict = await githubInstallationTokensPrecondition(options).check(
    new AbortController().signal,
  );
  if (verdict.met !== "Met") {
    await pool.end();
    throw new Error(`${forgeAppKeyFileVariable}: ${verdict.why}`);
  }
  return workerPlaneCredentialMinting({
    tokens: mintedRepositoryTokens({
      forge: githubForgeId,
      app: workerPodForgeApp,
      repositoryHost: githubRepositoryHost,
      installations: postgresForgeInstallations(pool),
      tokens: githubInstallationTokens(options),
    }),
    bindings: postgresProjectRepositoryBinding(pool),
  });
}

async function main(): Promise<void> {
  const pool = postgresPool(
    planeEnvironmentRequired("CHUG_WORKER_PLANE_DATABASE_URL"),
  );
  const uploadBytesMax = planeEnvironmentPositive(
    "CHUG_WORKER_PLANE_UPLOAD_BYTES_MAX",
    workerPlaneUploadBytesMax,
  );
  const artifacts = artifactStore({
    root: planeEnvironmentRequired("CHUG_WORKER_PLANE_ARTIFACT_ROOT"),
    writeBytesMax: uploadBytesMax,
  });
  const credentials = await planeCredentials(pool);
  const app = createWorkerPlaneApp({
    ticketExecutions: postgresTicketExecutionTerminals(pool),
    sessions: planeSessions(pool, artifacts),
    ...(credentials === undefined ? {} : { credentials }),
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
    port: planeEnvironmentPositive("CHUG_WORKER_PLANE_PORT", 3_001),
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
