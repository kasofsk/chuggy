/** Parses the scheduler deployment configuration without reading ambient state. */

import { z } from "zod";

import {
  postgresLimitsDefault,
  type PostgresLimits,
} from "../adapters/postgres/pool.ts";
import type { KubernetesPodSite } from "../adapters/kubernetes/kubernetesSite.ts";
import {
  kubernetesSessionBoundsDefaults,
  kubernetesSessionBudgetUsdMin,
  type KubernetesSessionBounds,
  type KubernetesSessionLaunchConfig,
} from "../adapters/kubernetes/sessionPod.ts";
import type { KubernetesWorkloadSiteConfig } from "../adapters/kubernetes/kubernetesSite.ts";
import {
  asClusterId,
  asSchedulerOwnerId,
  type ClusterId,
  type SchedulerOwnerId,
} from "../interpreter/schedulerIdentity.ts";
import {
  asRepositoryId,
  finalizerIdentityCharsMax,
} from "../interpreter/finalizer.ts";
import {
  sessionSchedulerDefaults,
  type RepositoryMirrors,
  type SessionPolicy,
  type SessionSchedulerConfig,
} from "../interpreter/sessionScheduler.ts";
import {
  asRecoveryEpoch,
  type RecoveryEpoch,
} from "../interpreter/projectStore.ts";
import type { ServiceRuntimeConfig } from "../interpreter/serviceRuntime.ts";
import {
  admittedImagesMax,
  asWorkerName,
  workerNameCharsMax,
  asWorkerVersion,
  workerImageCharsMax,
  workerVersionCharsMax,
  type AdmittedWorker,
} from "../interpreter/workerCatalog.ts";
import type { FilesystemAccess } from "../interpreter/taskAuthority.ts";
import type { ProcessDatabaseConfig } from "./controlPlane.ts";

/** Everything the scheduler command composes itself from, as parsed plain data. */
export interface SchedulerCommandConfig {
  readonly database: ProcessDatabaseConfig;
  readonly runtime: ServiceRuntimeConfig;
  readonly identity: {
    readonly owner: SchedulerOwnerId;
    readonly recoveryEpoch: RecoveryEpoch;
    readonly cluster: ClusterId;
  };
  readonly workers: KubernetesWorkloadSiteConfig;
  readonly workerCatalog: readonly AdmittedWorker[];
  readonly sessions: KubernetesSessionLaunchConfig;
  readonly sessionScheduler: SessionSchedulerConfig;
  readonly sessionPolicy: SessionPolicy;
  readonly tickets: SchedulerTicketExecutionConfig;
}

export interface SchedulerTicketExecutionConfig {
  readonly image: string;
  readonly capabilities: readonly string[];
  readonly credentialSources: readonly {
    readonly repository: string;
    readonly permissions: "read" | "write";
    readonly credentialReference?: string;
    readonly path: string;
  }[];
  readonly forge?: {
    readonly appId: string;
    readonly keyFile: string;
    readonly apiUrl?: string;
    readonly requestTimeoutMs?: number;
  };
  readonly credentialUsername: string;
  readonly leaseSecs: number;
  readonly attemptsMax: number;
  readonly outputBytesMax: number;
  readonly outcomePollMs: number;
  readonly claimsPerPassMax: number;
  readonly unclaimedWindowSecs: number;
}

/** The one prefix every variable this command reads is spelled with. */
const schedulerVariablePrefix = "CHUG_SCHEDULER_";

/** The operational values a deployment gets when it names none of them. */
const schedulerCommandDefaults = {
  idleIntervalMilliseconds: 1_000,
  shutdownDrainMilliseconds: 15_000,
  clusterTimeoutSecsMax: 30,
  clusterRetryAfterSecs: 15,
  workerDeadlineSecs: 3_600,
  workerPodNamePrefix: "chuggy-worker",
  sessionDeadlineSecs: 86_400,
  sessionPodNamePrefix: "chuggy-session",
} as const;

/** A record of the environment as read, so a caller supplies one rather than a process. */
export type SchedulerEnvironment = Readonly<Record<string, string | undefined>>;

const schedulerTextSchema = z.string().min(1);

const schedulerBoundSchema = z.number().int().positive();

const schedulerSafePositiveSchema = z.number().int().positive().safe();

const schedulerCountSchema = schedulerSafePositiveSchema.max(1_000);

const schedulerTextMapSchema = z.record(schedulerTextSchema, z.string());

const schedulerRecordSchema = z.record(schedulerTextSchema, z.unknown());

const schedulerFilesystemSchema = z.enum([
  "None",
  "ReadWorkspace",
  "WriteWorkspace",
] as const satisfies readonly FilesystemAccess[]);

const schedulerGrantSchema = z.strictObject({
  tools: z.array(schedulerTextSchema),
  credentials: z.array(schedulerTextSchema),
  network: z.boolean(),
  filesystem: schedulerFilesystemSchema,
  mayCompleteTask: z.boolean(),
});

/**
 * A repository identity as this document may write one, bounded where
 * `asRepositoryId` is bounded so an over-long entry is a configuration refusal
 * naming the key rather than a raise from inside a placement.
 */
const schedulerRepositorySchema = schedulerTextSchema.max(
  finalizerIdentityCharsMax,
);

/**
 * Which read a session takes of a bound repository, keyed by the binding. It is
 * optional and empty by default: an installation whose sessions can reach the
 * remote its projects bind owes no mirror, and writing an empty object would be
 * a second way to say nothing.
 */
const schedulerMirrorsSchema = z.record(
  schedulerRepositorySchema,
  schedulerRepositorySchema,
);

const schedulerSessionPolicySchema = z.strictObject({
  image: schedulerTextSchema.max(workerImageCharsMax),
  profile: schedulerTextSchema,
  runtimeVersion: schedulerTextSchema,
  grant: schedulerGrantSchema,
  mirrors: schedulerMirrorsSchema.optional(),
});

const schedulerTicketExecutionSchema = z.strictObject({
  image: schedulerTextSchema.regex(
    /^.+@sha256:[0-9a-f]{64}$/u,
    "must be pinned by a sha256 digest",
  ),
  capabilities: z.array(schedulerTextSchema).default([]),
  credentialSources: z
    .array(
      z.strictObject({
        repository: schedulerTextSchema,
        permissions: z.enum(["read", "write"]),
        credentialReference: schedulerTextSchema.optional(),
        path: schedulerTextSchema,
      }),
    )
    .default([]),
  forge: z
    .strictObject({
      appId: schedulerTextSchema,
      keyFile: schedulerTextSchema,
      apiUrl: schedulerTextSchema.optional(),
      requestTimeoutMs: schedulerSafePositiveSchema.optional(),
    })
    .optional(),
  credentialUsername: schedulerTextSchema.default("x-access-token"),
  leaseSecs: schedulerSafePositiveSchema.default(300),
  attemptsMax: schedulerCountSchema.default(3),
  outputBytesMax: schedulerSafePositiveSchema.default(1_048_576),
  outcomePollMs: schedulerSafePositiveSchema.default(1_000),
  claimsPerPassMax: schedulerCountSchema.default(1),
  unclaimedWindowSecs: schedulerSafePositiveSchema.default(300),
});

/**
 * One admitted image, either the bare reference a deployment has always written
 * or the same reference labelled. A bare entry is admitted and unnamed, so a
 * deployment adopts labels one image at a time.
 */
const schedulerAdmittedImageSchema = z.union([
  schedulerTextSchema,
  z
    .strictObject({
      image: schedulerTextSchema.max(workerImageCharsMax),
      name: z.string().refine((value) => asWorkerName(value) !== undefined, {
        message: `is not a worker name of at most ${String(workerNameCharsMax)} characters`,
      }),
      version: z
        .string()
        .refine((value) => asWorkerVersion(value) !== undefined, {
          message: `is not a worker version of at most ${String(workerVersionCharsMax)} characters`,
        }),
      operatingSystem: z.enum(["Linux", "MacOS"]).optional(),
      architecture: z.enum(["Amd64", "Arm64"]).optional(),
      capabilities: z
        .array(z.enum(["Agent:Claude", "Agent:Codex"]))
        .max(2)
        .refine((values) => new Set(values).size === values.length, {
          message: "contains a duplicate capability",
        })
        .optional(),
    })
    .refine(
      (entry) =>
        entry.capabilities !== undefined ||
        (entry.operatingSystem === undefined &&
          entry.architecture === undefined),
      { message: "names a platform without publishing capabilities" },
    )
    .refine(
      (entry) =>
        (entry.operatingSystem === undefined) ===
        (entry.architecture === undefined),
      { message: "must name both operating system and architecture" },
    ),
]);

type SchedulerAdmittedImage = z.infer<typeof schedulerAdmittedImageSchema>;

/** The image one entry admits, whichever of the two shapes it was written in. */
function schedulerAdmittedImage(entry: SchedulerAdmittedImage): string {
  return typeof entry === "string" ? entry : entry.image;
}

/**
 * Refuses a list that admits one image twice or spells one label twice. Both
 * are settled here rather than at the catalog, because a deployment that means
 * two things by one image has no reading a later boot could recover.
 */
function schedulerImagesAreDistinct(
  entries: readonly SchedulerAdmittedImage[],
  ctx: z.RefinementCtx,
): void {
  const images = new Set<string>();
  const labels = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const image = schedulerAdmittedImage(entry);
    if (images.has(image))
      ctx.addIssue({
        code: "custom",
        path: [index],
        message: `admits the image ${image} twice`,
      });
    images.add(image);
    if (typeof entry === "string") continue;
    const label = JSON.stringify([entry.name, entry.version]);
    if (labels.has(label))
      ctx.addIssue({
        code: "custom",
        path: [index],
        message: `names the worker ${entry.name} version ${entry.version} twice`,
      });
    labels.add(label);
  }
}

const schedulerImagesSchema = z
  .array(schedulerAdmittedImageSchema)
  .min(1)
  .max(admittedImagesMax)
  .superRefine(schedulerImagesAreDistinct);

const schedulerResourcesSchema = z.strictObject({
  cpuRequest: schedulerTextSchema,
  cpuLimit: schedulerTextSchema,
  memoryRequest: schedulerTextSchema,
  memoryLimit: schedulerTextSchema,
  ephemeralStorageLimit: schedulerTextSchema,
});

const schedulerWorkerDatabaseSchema = z.strictObject({
  image: schedulerTextSchema,
  resources: schedulerResourcesSchema,
});

const schedulerCredentialMountsSchema = z.record(
  schedulerTextSchema,
  z.strictObject({
    secretName: schedulerTextSchema,
    key: schedulerTextSchema,
    mountPath: schedulerTextSchema,
  }),
);

/** The value of one variable, refusing an absent or empty one by name. */
function schedulerRequired(
  environment: SchedulerEnvironment,
  name: string,
): string {
  const value = environment[`${schedulerVariablePrefix}${name}`];
  if (value === undefined || value.length === 0)
    throw new RangeError(`${schedulerVariablePrefix}${name} is required`);
  return value;
}

/** The value of one variable, or nothing where a deployment named none. */
function schedulerOptional(
  environment: SchedulerEnvironment,
  name: string,
): string | undefined {
  const value = environment[`${schedulerVariablePrefix}${name}`];
  return value === undefined || value.length === 0 ? undefined : value;
}

/** One variable as a positive integer, falling back to the operational default. */
function schedulerPositive(
  environment: SchedulerEnvironment,
  name: string,
  fallback: number,
): number {
  const value = schedulerOptional(environment, name);
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(value))
    throw new RangeError(
      `${schedulerVariablePrefix}${name} must be a positive integer`,
    );
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new RangeError(`${schedulerVariablePrefix}${name} is too large`);
  return parsed;
}

/** One variable as the document its schema accepts, naming the variable in every refusal. */
function schedulerDocument<Parsed>(
  name: string,
  schema: z.ZodType<Parsed>,
  value: string,
): Parsed {
  let document: unknown;
  try {
    document = JSON.parse(value);
  } catch {
    throw new RangeError(`${schedulerVariablePrefix}${name} is not JSON`);
  }
  const parsed = schema.safeParse(document);
  if (!parsed.success)
    throw new RangeError(
      `${schedulerVariablePrefix}${name}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  return parsed.data;
}

/** One required JSON variable, parsed and refused by name. */
function schedulerJson<Parsed>(
  environment: SchedulerEnvironment,
  name: string,
  schema: z.ZodType<Parsed>,
): Parsed {
  return schedulerDocument(name, schema, schedulerRequired(environment, name));
}

/** One optional JSON variable, or the value a deployment that named none gets. */
function schedulerJsonOr<Parsed>(
  environment: SchedulerEnvironment,
  name: string,
  schema: z.ZodType<Parsed>,
  fallback: Parsed,
): Parsed {
  const value = schedulerOptional(environment, name);
  return value === undefined
    ? fallback
    : schedulerDocument(name, schema, value);
}

/**
 * A published set of bounds with this deployment's overrides applied, refusing
 * an unknown one. A bound is a positive whole number unless `kinds` gives it
 * another schema, because a bound one tier accepts and another refuses is a
 * bound with two readings and a deployment meets the stricter one as a refusal
 * to boot.
 */
function schedulerBounds<Bounds extends Record<keyof Bounds, number>>(
  environment: SchedulerEnvironment,
  name: string,
  defaults: Bounds,
  kinds?: Readonly<Partial<Record<keyof Bounds, z.ZodType<number>>>>,
): Bounds {
  const overrides = schedulerJsonOr(
    environment,
    name,
    z.record(schedulerTextSchema, z.number()),
    {},
  );
  const merged = { ...defaults };
  for (const [bound, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(merged, bound))
      throw new RangeError(
        `${schedulerVariablePrefix}${name} names an unknown bound ${bound}`,
      );
    const parsed = (
      kinds?.[bound as keyof Bounds] ?? schedulerBoundSchema
    ).safeParse(value);
    if (!parsed.success)
      throw new RangeError(
        `${schedulerVariablePrefix}${name}: ${bound} ${parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    Object.assign(merged, { [bound]: parsed.data });
  }
  return merged;
}

/**
 * What each session bound is parsed as, keyed over the bounds themselves the
 * way the launcher's own checks are, so a bound added there and forgotten here
 * does not compile rather than falling quietly to the whole-number default.
 * The dollar cap reads its floor from the launcher's constant, so the two tiers
 * admit one set of values rather than agreeing by coincidence.
 */
const schedulerSessionBoundKinds: {
  readonly [Bound in keyof KubernetesSessionBounds]: z.ZodType<number>;
} = {
  mailboxPollMs: schedulerBoundSchema,
  idleMs: schedulerBoundSchema,
  resultDrainMs: schedulerBoundSchema,
  loadTimeoutMs: schedulerBoundSchema,
  turnsMax: schedulerBoundSchema,
  budgetUsd: z.number().finite().min(kubernetesSessionBudgetUsdMin),
};

/** Only the entries that named themselves, which are the ones a boot publishes. */
function schedulerWorkerCatalog(
  admitted: readonly SchedulerAdmittedImage[],
): readonly AdmittedWorker[] {
  return admitted
    .filter((entry) => typeof entry !== "string")
    .map((entry) => ({
      image: entry.image,
      name: entry.name,
      version: entry.version,
    }));
}

/** The site policy a placed pod carries, every value of it read and handed on unread. */
function schedulerWorkerSite(
  environment: SchedulerEnvironment,
): Pick<
  KubernetesWorkloadSiteConfig,
  | "podLabels"
  | "podAnnotations"
  | "nodeSelector"
  | "podSecurityContext"
  | "containerSecurityContext"
> {
  return {
    podLabels: schedulerJsonOr(
      environment,
      "WORKER_LABELS",
      schedulerTextMapSchema,
      {},
    ),
    podAnnotations: schedulerJsonOr(
      environment,
      "WORKER_ANNOTATIONS",
      schedulerTextMapSchema,
      {},
    ),
    nodeSelector: schedulerJsonOr(
      environment,
      "WORKER_NODE_SELECTOR",
      schedulerTextMapSchema,
      {},
    ),
    podSecurityContext: schedulerJsonOr(
      environment,
      "WORKER_POD_SECURITY",
      schedulerRecordSchema,
      {},
    ),
    containerSecurityContext: schedulerJsonOr(
      environment,
      "WORKER_CONTAINER_SECURITY",
      schedulerRecordSchema,
      {},
    ),
  };
}

/** The cluster this deployment places workers in, and the bounds each placement has. */
function schedulerWorkers(
  environment: SchedulerEnvironment,
): KubernetesWorkloadSiteConfig {
  const database = schedulerOptional(environment, "WORKER_DATABASE");
  return {
    ...schedulerWorkerSite(environment),
    ...(database === undefined
      ? {}
      : {
          database: schedulerDocument(
            "WORKER_DATABASE",
            schedulerWorkerDatabaseSchema,
            database,
          ),
        }),
    apiBaseUrl: schedulerRequired(environment, "CLUSTER_API_URL"),
    namespace: schedulerRequired(environment, "CLUSTER_NAMESPACE"),
    tokenFile: schedulerRequired(environment, "CLUSTER_TOKEN_FILE"),
    workerPlaneUrl: schedulerRequired(environment, "WORKER_PLANE_URL"),
    capabilityFile: schedulerRequired(environment, "WORKER_CAPABILITY_FILE"),
    workspacePath: schedulerRequired(environment, "WORKER_WORKSPACE_PATH"),
    credentialMounts: schedulerJson(
      environment,
      "WORKER_CREDENTIAL_MOUNTS",
      schedulerCredentialMountsSchema,
    ),
    environment: schedulerJsonOr(
      environment,
      "WORKER_ENVIRONMENT",
      schedulerTextMapSchema,
      {},
    ),
    serviceAccountName: schedulerRequired(
      environment,
      "WORKER_SERVICE_ACCOUNT",
    ),
    podNamePrefix:
      schedulerOptional(environment, "WORKER_POD_NAME_PREFIX") ??
      schedulerCommandDefaults.workerPodNamePrefix,
    resources: schedulerJson(
      environment,
      "WORKER_RESOURCES",
      schedulerResourcesSchema,
    ),
    activeDeadlineSecs: schedulerPositive(
      environment,
      "WORKER_DEADLINE_SECS",
      schedulerCommandDefaults.workerDeadlineSecs,
    ),
    requestTimeoutSecsMax: schedulerPositive(
      environment,
      "CLUSTER_TIMEOUT_SECS",
      schedulerCommandDefaults.clusterTimeoutSecsMax,
    ),
    unavailableRetryAfterSecs: schedulerPositive(
      environment,
      "CLUSTER_RETRY_AFTER_SECS",
      schedulerCommandDefaults.clusterRetryAfterSecs,
    ),
  };
}

/**
 * The session half of this deployment, which stands on the same site the worker
 * half does — same namespace, service account, API and credential mounts, since
 * a second set of variables for those would be a second answer to what the site
 * is and the first deployment to change one would leave the other placing pods
 * the site no longer describes. What a session names for itself is what makes
 * it a session: its own pod name, budget, deadline, labels, bounds, model, and
 * the origin its tools reach this installation's own API at.
 */
function schedulerSessions(
  environment: SchedulerEnvironment,
  site: KubernetesPodSite,
): KubernetesSessionLaunchConfig {
  return {
    ...site,
    podNamePrefix:
      schedulerOptional(environment, "SESSION_POD_NAME_PREFIX") ??
      schedulerCommandDefaults.sessionPodNamePrefix,
    podLabels: schedulerJsonOr(
      environment,
      "SESSION_LABELS",
      schedulerTextMapSchema,
      {},
    ),
    podAnnotations: schedulerJsonOr(
      environment,
      "SESSION_ANNOTATIONS",
      schedulerTextMapSchema,
      {},
    ),
    environment: schedulerJsonOr(
      environment,
      "SESSION_ENVIRONMENT",
      schedulerTextMapSchema,
      {},
    ),
    resources: schedulerJson(
      environment,
      "SESSION_RESOURCES",
      schedulerResourcesSchema,
    ),
    activeDeadlineSecs: schedulerPositive(
      environment,
      "SESSION_DEADLINE_SECS",
      schedulerCommandDefaults.sessionDeadlineSecs,
    ),
    bounds: schedulerBounds<KubernetesSessionBounds>(
      environment,
      "SESSION_BOUNDS",
      kubernetesSessionBoundsDefaults,
      schedulerSessionBoundKinds,
    ),
    model: schedulerRequired(environment, "SESSION_MODEL"),
    apiUrl: schedulerRequired(environment, "SESSION_API_URL"),
  };
}

/** Every mirror the document named, branded as the repository identities they are. */
function schedulerMirrors(
  named: Readonly<Record<string, string>> | undefined,
): RepositoryMirrors {
  return Object.fromEntries(
    Object.entries(named ?? {}).map(([bound, mirror]) => [
      asRepositoryId(bound),
      asRepositoryId(mirror),
    ]),
  );
}

/** The one image, profile, grant and set of mirrors every session of this site runs under. */
function schedulerSessionPolicy(
  environment: SchedulerEnvironment,
): SessionPolicy {
  const parsed = schedulerJson(
    environment,
    "SESSION_POLICY",
    schedulerSessionPolicySchema,
  );
  return {
    image: parsed.image,
    profile: { profile: parsed.profile, runtimeVersion: parsed.runtimeVersion },
    grant: parsed.grant,
    mirrors: schedulerMirrors(parsed.mirrors),
  };
}

function schedulerTicketExecution(
  environment: SchedulerEnvironment,
): SchedulerTicketExecutionConfig {
  const parsed = schedulerJson(
    environment,
    "TICKET_EXECUTION",
    schedulerTicketExecutionSchema,
  );
  const { credentialSources, forge, ...settings } = parsed;
  return {
    ...settings,
    credentialSources: credentialSources.map((source) => ({
      repository: source.repository,
      permissions: source.permissions,
      path: source.path,
      ...(source.credentialReference === undefined
        ? {}
        : { credentialReference: source.credentialReference }),
    })),
    ...(forge === undefined
      ? {}
      : {
          forge: {
            appId: forge.appId,
            keyFile: forge.keyFile,
            ...(forge.apiUrl === undefined ? {} : { apiUrl: forge.apiUrl }),
            ...(forge.requestTimeoutMs === undefined
              ? {}
              : { requestTimeoutMs: forge.requestTimeoutMs }),
          },
        }),
  };
}

/** Only the cluster half of a worker configuration, which is the site both halves share. */
function schedulerPodSite(
  workers: KubernetesWorkloadSiteConfig,
): KubernetesPodSite {
  return {
    apiBaseUrl: workers.apiBaseUrl,
    namespace: workers.namespace,
    tokenFile: workers.tokenFile,
    serviceAccountName: workers.serviceAccountName,
    nodeSelector: workers.nodeSelector,
    podSecurityContext: workers.podSecurityContext,
    containerSecurityContext: workers.containerSecurityContext,
    requestTimeoutSecsMax: workers.requestTimeoutSecsMax,
    unavailableRetryAfterSecs: workers.unavailableRetryAfterSecs,
    workerPlaneUrl: workers.workerPlaneUrl,
    capabilityFile: workers.capabilityFile,
    workspacePath: workers.workspacePath,
    credentialMounts: workers.credentialMounts,
  };
}

/** The database this process holds its scheduler credential against, and its pool bounds. */
function schedulerDatabase(
  environment: SchedulerEnvironment,
): ProcessDatabaseConfig {
  return {
    url: schedulerRequired(environment, "DATABASE_URL"),
    limits: schedulerBounds<PostgresLimits>(
      environment,
      "DATABASE_LIMITS",
      postgresLimitsDefault,
    ),
  };
}

/** The whole scheduler command configuration, parsed out of one environment record. */
export function schedulerCommandConfig(
  environment: SchedulerEnvironment,
): SchedulerCommandConfig {
  const admitted = schedulerJson(
    environment,
    "ADMITTED_IMAGES",
    schedulerImagesSchema,
  );
  const workers = schedulerWorkers(environment);
  return {
    database: schedulerDatabase(environment),
    runtime: {
      idleIntervalMilliseconds: schedulerPositive(
        environment,
        "IDLE_INTERVAL_MS",
        schedulerCommandDefaults.idleIntervalMilliseconds,
      ),
      shutdownDrainMilliseconds: schedulerPositive(
        environment,
        "SHUTDOWN_DRAIN_MS",
        schedulerCommandDefaults.shutdownDrainMilliseconds,
      ),
    },
    identity: {
      owner: asSchedulerOwnerId(schedulerRequired(environment, "OWNER")),
      recoveryEpoch: asRecoveryEpoch(
        schedulerRequired(environment, "RECOVERY_EPOCH"),
      ),
      cluster: asClusterId(
        schedulerOptional(environment, "CLUSTER") ?? "default",
      ),
    },
    workers,
    workerCatalog: schedulerWorkerCatalog(admitted),
    sessions: schedulerSessions(environment, schedulerPodSite(workers)),
    sessionScheduler: schedulerBounds(
      environment,
      "SESSION_PASS_BOUNDS",
      sessionSchedulerDefaults,
    ),
    sessionPolicy: schedulerSessionPolicy(environment),
    tickets: schedulerTicketExecution(environment),
  };
}
