/**
 * Everything a worker pool client is told, read from one environment and
 * refused before a single poll is made.
 *
 * IT IS A TOTAL FUNCTION FROM TEXT TO PARSED DATA, the environment arriving as
 * an argument, which is what lets a suite drive every refusal without a process
 * to set variables on. The same argument `src/roots/schedulerConfig.ts` makes
 * for its own larger parser.
 *
 * THE CLUSTER ARRIVES AS ONE DOCUMENT AND THE REST AS SCALARS. A site is a
 * nested thing — security contexts, credential mounts, the nodes a capability
 * lives on — and a variable per leaf is a deployment nobody can review; a bound
 * is a number and is named on its own, so a change to one is a change to one.
 *
 * THE POOL'S CREDENTIAL IS A VARIABLE AND NEVER A FILE THIS SIDE NAMES. A pool
 * is registered by an owner who hands over a client id and a secret once, and
 * the process that spends them is the only thing that should ever hold them.
 */

import { z } from "zod";

import type { KubernetesPoolPlacementConfig } from "../adapters/kubernetes/poolPlacement.ts";
import type { ClientCredentialsSettings } from "../adapters/http/clientCredentials.ts";
import type { PoolPlaneClientSettings } from "../adapters/http/poolPlaneClient.ts";
import type { WorkerPoolClientSettings } from "../interpreter/workerPoolClient.ts";

/** The one prefix every variable this process reads carries. */
export const poolClientVariablePrefix = "CHUG_POOL_CLIENT_";

export type PoolClientEnvironment = Readonly<
  Record<string, string | undefined>
>;

/** What one run of the client is composed of, which is four settings objects and nothing else. */
export interface PoolClientConfig {
  readonly tokens: ClientCredentialsSettings;
  readonly plane: PoolPlaneClientSettings;
  readonly site: KubernetesPoolPlacementConfig;
  readonly client: WorkerPoolClientSettings;
}

const poolClientTextSchema = z.string().min(1);

const poolClientBoundSchema = z.number().int().positive().safe();

const poolClientResourcesSchema = z.strictObject({
  cpuRequest: poolClientTextSchema,
  cpuLimit: poolClientTextSchema,
  memoryRequest: poolClientTextSchema,
  memoryLimit: poolClientTextSchema,
  ephemeralStorageLimit: poolClientTextSchema,
});

const poolClientTolerationSchema = z.strictObject({
  key: poolClientTextSchema,
  operator: z.enum(["Equal", "Exists"]),
  value: z.string().optional(),
  effect: z.enum(["NoSchedule", "PreferNoSchedule", "NoExecute"]),
});

/** Where one capability token's work belongs, which is a site's answer and not a pool's. */
const poolClientCapabilitySchema = z.strictObject({
  nodeSelector: z.record(poolClientTextSchema, z.string()),
  tolerations: z.array(poolClientTolerationSchema),
});

const poolClientSiteSchema = z.strictObject({
  apiBaseUrl: poolClientTextSchema,
  namespace: poolClientTextSchema,
  tokenFile: poolClientTextSchema,
  serviceAccountName: poolClientTextSchema,
  workspacePath: poolClientTextSchema,
  capabilityFile: poolClientTextSchema,
  workerPlaneUrl: poolClientTextSchema,
  podNamePrefix: poolClientTextSchema,
  image: poolClientTextSchema,
  poolLabel: z.strictObject({
    name: poolClientTextSchema,
    value: poolClientTextSchema,
  }),
  podLabels: z.record(poolClientTextSchema, z.string()).default({}),
  podAnnotations: z.record(poolClientTextSchema, z.string()).default({}),
  nodeSelector: z.record(poolClientTextSchema, z.string()).default({}),
  podSecurityContext: z.record(poolClientTextSchema, z.unknown()).default({}),
  containerSecurityContext: z
    .record(poolClientTextSchema, z.unknown())
    .default({}),
  environment: z.record(poolClientTextSchema, z.string()).default({}),
  credentialMounts: z
    .record(
      poolClientTextSchema,
      z.strictObject({
        secretName: poolClientTextSchema,
        key: poolClientTextSchema,
        mountPath: poolClientTextSchema,
      }),
    )
    .default({}),
  capabilities: z
    .record(poolClientTextSchema, poolClientCapabilitySchema)
    .default({}),
  providerCredential: poolClientTextSchema.optional(),
  resources: poolClientResourcesSchema,
  timeoutSecsMax: poolClientBoundSchema,
  outputBytesMax: poolClientBoundSchema,
  requestTimeoutSecsMax: poolClientBoundSchema,
  unavailableRetryAfterSecs: poolClientBoundSchema,
});

/** The value this process cannot start without, named in its own refusal. */
function poolClientRequired(
  environment: PoolClientEnvironment,
  name: string,
): string {
  const value = environment[`${poolClientVariablePrefix}${name}`];
  if (value === undefined || value.length === 0)
    throw new RangeError(`${poolClientVariablePrefix}${name} is required`);
  return value;
}

/** One bound as the environment states it, or the fallback this composition names. */
function poolClientPositive(
  environment: PoolClientEnvironment,
  name: string,
  fallback: number,
): number {
  const value = environment[`${poolClientVariablePrefix}${name}`];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(parsed))
    throw new RangeError(
      `${poolClientVariablePrefix}${name} must be a positive integer`,
    );
  return parsed;
}

/** The site document, refused with the path of whatever member is wrong. */
function poolClientSite(
  environment: PoolClientEnvironment,
): KubernetesPoolPlacementConfig {
  const value = poolClientRequired(environment, "SITE");
  let document: unknown;
  try {
    document = JSON.parse(value);
  } catch {
    throw new RangeError(`${poolClientVariablePrefix}SITE is not JSON`);
  }
  const parsed = poolClientSiteSchema.safeParse(document);
  if (!parsed.success)
    throw new RangeError(
      `${poolClientVariablePrefix}SITE: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  return parsed.data;
}

export function poolClientConfig(
  environment: PoolClientEnvironment,
): PoolClientConfig {
  return {
    tokens: {
      tokenUrl: poolClientRequired(environment, "TOKEN_URL"),
      clientId: poolClientRequired(environment, "ID"),
      clientSecret: poolClientRequired(environment, "SECRET"),
      audience: poolClientRequired(environment, "AUDIENCE"),
      requestTimeoutMs: poolClientPositive(
        environment,
        "TOKEN_TIMEOUT_MS",
        10_000,
      ),
    },
    plane: {
      baseUrl: poolClientRequired(environment, "PLANE_URL"),
      pollTimeoutMs: poolClientPositive(
        environment,
        "POLL_TIMEOUT_MS",
        120_000,
      ),
      settleTimeoutMs: poolClientPositive(
        environment,
        "SETTLE_TIMEOUT_MS",
        10_000,
      ),
    },
    site: poolClientSite(environment),
    client: {
      concurrencyMax: poolClientPositive(environment, "CONCURRENCY_MAX", 4),
      retryAfterSecs: poolClientPositive(environment, "RETRY_AFTER_SECS", 30),
      tokenRefreshBeforeSecs: poolClientPositive(
        environment,
        "TOKEN_REFRESH_BEFORE_SECS",
        60,
      ),
      outageBackoffMs: poolClientPositive(
        environment,
        "OUTAGE_BACKOFF_MS",
        5_000,
      ),
      passesMax: poolClientPositive(environment, "PASSES_MAX", 1_000),
    },
  };
}
