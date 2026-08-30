/**
 * The scheduler command's whole runtime configuration, parsed out of a plain
 * environment record into the values its process root and its adapters take.
 *
 * IT READS NO ENVIRONMENT OF ITS OWN. The record is an argument, so the shell
 * that owns `process.env` is one file and this one is a total function from
 * text to parsed data — which is what lets a suite drive every refusal without
 * a process to set variables on.
 *
 * EVERY SITE DECISION ARRIVES AS DATA AND NONE IS DECIDED HERE. Admitted worker
 * images, resource budgets, the namespace, the service account, the node
 * selector and both security contexts are read and handed on unread; what this
 * module decides is whether a deployment named them at all, and whether the
 * admitted-images list names one image, or one worker label, twice.
 *
 * A BOUND IS EITHER THE DEFAULT OR AN OVERRIDE OF ONE THAT EXISTS. The three
 * pass configurations are merged over the defaults their own modules publish,
 * and an override naming a bound those defaults do not carry is refused rather
 * than ignored — a misspelled bound that silently kept the default is the shape
 * a deployment cannot see.
 *
 * NO CREDENTIAL IS PARSED. The cluster credential is named by the file it is
 * read from per act, so no token reaches this configuration, the process
 * arguments or any diagnostic either raises.
 */

import { z } from "zod";

import {
  postgresLimitsDefault,
  type PostgresLimits,
} from "../adapters/postgres/pool.ts";
import type { KubernetesWorkerLaunchConfig } from "../adapters/kubernetes/workerPod.ts";
import type {
  SuppliedExecutionPolicyConfig,
  SuppliedExecutionProfile,
  SuppliedRuntime,
  SuppliedRuntimeFactsConfig,
} from "../adapters/supplied/schedulerPorts.ts";
import {
  asClusterId,
  asSchedulerOwnerId,
  executionCapacityDefaults,
  executionSchedulerDefaults,
  type ClusterId,
  type ExecutionSchedulerConfig,
  type ExecutionTaskKind,
  type SchedulerOwnerId,
} from "../interpreter/executionScheduler.ts";
import {
  finalizerDefaults,
  type FinalizerConfig,
} from "../interpreter/finalizer.ts";
import {
  asRecoveryEpoch,
  type RecoveryEpoch,
} from "../interpreter/projectStore.ts";
import type { ServiceRuntimeConfig } from "../interpreter/serviceRuntime.ts";
import { repositoryConfigurationNameCharsMax } from "../interpreter/repositoryConfigurationIdentity.ts";
import {
  admittedImagesMax,
  asWorkerName,
  asWorkerVersion,
  workerImageCharsMax,
  workerVersionCharsMax,
  type AdmittedWorker,
} from "../interpreter/workerCatalog.ts";
import type { FilesystemAccess } from "../interpreter/taskAuthority.ts";
import {
  ticketServiceDefaults,
  type TicketServiceConfig,
} from "../interpreter/ticketService.ts";
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
  readonly scheduler: ExecutionSchedulerConfig;
  readonly ticketService: TicketServiceConfig;
  readonly finalizer: FinalizerConfig;
  readonly workers: KubernetesWorkerLaunchConfig;
  readonly policy: SuppliedExecutionPolicyConfig;
  readonly workerCatalog: readonly AdmittedWorker[];
  readonly runtimeFacts: SuppliedRuntimeFactsConfig;
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
} as const;

/** A record of the environment as read, so a caller supplies one rather than a process. */
export type SchedulerEnvironment = Readonly<Record<string, string | undefined>>;

const schedulerTextSchema = z.string().min(1);

const schedulerBoundSchema = z.number().int().positive();

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

const schedulerProfileSchema = z.strictObject({
  profile: schedulerTextSchema,
  runtimeVersion: schedulerTextSchema,
  grant: schedulerGrantSchema,
});

const schedulerPolicyShape = {
  Work: schedulerProfileSchema.optional(),
  Evaluation: schedulerProfileSchema.optional(),
} satisfies Record<ExecutionTaskKind, z.ZodType>;

const schedulerPolicySchema = z.strictObject(schedulerPolicyShape);

/** Every task kind the policy above states a profile for, read off the shape that states them. */
const schedulerTaskKinds = Object.keys(
  schedulerPolicyShape,
) as readonly ExecutionTaskKind[];

/**
 * One admitted image, either the bare reference a deployment has always written
 * or the same reference labelled. A bare entry is admitted and unnamed, so a
 * deployment adopts labels one image at a time.
 */
const schedulerAdmittedImageSchema = z.union([
  schedulerTextSchema,
  z.strictObject({
    image: schedulerTextSchema.max(workerImageCharsMax),
    name: z.string().refine((value) => asWorkerName(value) !== undefined, {
      message: `is not a worker name of at most ${String(repositoryConfigurationNameCharsMax)} characters`,
    }),
    version: z
      .string()
      .refine((value) => asWorkerVersion(value) !== undefined, {
        message: `is not a worker version of at most ${String(workerVersionCharsMax)} characters`,
      }),
    capabilities: z
      .array(z.enum(["Agent:Claude", "Agent:Codex"]))
      .max(2)
      .refine((values) => new Set(values).size === values.length, {
        message: "contains a duplicate capability",
      })
      .optional(),
  }),
]);

type SchedulerAdmittedImage = z.infer<typeof schedulerAdmittedImageSchema>;

/** The image one entry admits, whichever of the two shapes it was written in. */
function schedulerAdmittedImage(entry: SchedulerAdmittedImage): string {
  return typeof entry === "string" ? entry : entry.image;
}

function schedulerRuntime(
  entry: SchedulerAdmittedImage,
): string | SuppliedRuntime {
  if (typeof entry === "string" || entry.capabilities === undefined)
    return schedulerAdmittedImage(entry);
  return {
    image: entry.image,
    capabilities: entry.capabilities,
  };
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
  secretName: schedulerTextSchema,
  key: schedulerTextSchema,
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

/** A published set of bounds with this deployment's overrides applied, refusing an unknown one. */
function schedulerBounds<Bounds extends Record<keyof Bounds, number>>(
  environment: SchedulerEnvironment,
  name: string,
  defaults: Bounds,
): Bounds {
  const overrides = schedulerJsonOr(
    environment,
    name,
    z.record(schedulerTextSchema, schedulerBoundSchema),
    {},
  );
  const merged = { ...defaults };
  for (const [bound, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(merged, bound))
      throw new RangeError(
        `${schedulerVariablePrefix}${name} names an unknown bound ${bound}`,
      );
    Object.assign(merged, { [bound]: value });
  }
  return merged;
}

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

/** The execution policy this deployment states, one profile and grant per task kind. */
function schedulerPolicy(
  environment: SchedulerEnvironment,
  admitted: readonly SchedulerAdmittedImage[],
): SuppliedExecutionPolicyConfig {
  const parsed = schedulerJson(
    environment,
    "EXECUTION_POLICY",
    schedulerPolicySchema,
  );
  const profiles = new Map<ExecutionTaskKind, SuppliedExecutionProfile>();
  for (const kind of schedulerTaskKinds) {
    const supplied = parsed[kind];
    if (supplied === undefined) continue;
    profiles.set(kind, {
      profile: {
        profile: supplied.profile,
        runtimeVersion: supplied.runtimeVersion,
      },
      grant: supplied.grant,
    });
  }
  return { profiles, imagesAdmitted: admitted.map(schedulerRuntime) };
}

/** The site policy a placed pod carries, every value of it read and handed on unread. */
function schedulerWorkerSite(
  environment: SchedulerEnvironment,
): Pick<
  KubernetesWorkerLaunchConfig,
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
): KubernetesWorkerLaunchConfig {
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
  const workspace = schedulerOptional(environment, "WORKER_WORKSPACE");
  const admitted = schedulerJson(
    environment,
    "ADMITTED_IMAGES",
    schedulerImagesSchema,
  );
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
        schedulerOptional(environment, "CLUSTER") ??
          executionCapacityDefaults.cluster,
      ),
    },
    scheduler: schedulerBounds(
      environment,
      "PASS_BOUNDS",
      executionSchedulerDefaults,
    ),
    ticketService: schedulerBounds(
      environment,
      "TICKET_SERVICE_BOUNDS",
      ticketServiceDefaults,
    ),
    finalizer: schedulerBounds(
      environment,
      "FINALIZER_BOUNDS",
      finalizerDefaults,
    ),
    workers: schedulerWorkers(environment),
    policy: schedulerPolicy(environment, admitted),
    workerCatalog: schedulerWorkerCatalog(admitted),
    runtimeFacts: workspace === undefined ? {} : { workspace },
  };
}
