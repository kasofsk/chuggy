/**
 * The pod one scheduled attempt becomes: the site data a deployment supplies,
 * the image an execution profile is admitted to run under, and the request the
 * cluster API is asked for.
 *
 * NOTHING HERE IS A SITE DECISION. The namespace, the service account, the node
 * selector, the two security contexts, the resource budget and the admitted
 * images all arrive as plain data on the configuration, so a site that changes
 * one of them changes its deployment rather than this adapter. What is decided
 * here is the translation: which supplied image an execution profile resolves
 * to, and which definitive inability the cluster is told about when it resolves
 * to none.
 *
 * A POD IS NAMED FOR ITS ATTEMPT AND FOR NOTHING ELSE. `AttemptPlacementPort`
 * places and cancels the same fenced attempt, so the name has to be derivable
 * from what both of those carry; it is a digest over the partition and the
 * attempt because an attempt identity is opaque and may carry text no object
 * name accepts. The generation is not part of it: a cancellation names the
 * generation it is fencing, and a name that varied with it would leave the
 * earlier pod behind. The same derivation makes a repeated placement of one
 * attempt idempotent, because the second request names the object the first
 * created.
 *
 * THE FENCE TRAVELS AS ANNOTATIONS. A label value is bounded and constrained in
 * its alphabet where an annotation value is neither, so the generation an
 * attempt is fenced by, and every opaque identity beside it, are annotations.
 * Nothing reads them back — the durable row is the authority — and they are
 * what makes a placed pod answerable to the attempt it was placed for.
 *
 * A WORKER IS TOLD ONLY WHAT THE PORT SUPPLIED. The container's environment
 * carries the composed briefing, the resolved authority grant and the pinned
 * configuration identity, every one of them taken from the placement; no
 * credential, no cluster fact and no value this module reached for itself.
 */

import { createHash } from "node:crypto";

import type {
  AttemptPlacement,
  BlockedReason,
  ExecutionProfile,
} from "../../interpreter/executionScheduler.ts";
import type { AttemptId } from "../../interpreter/schedulerIdentity.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { taskAuthorityGrant } from "../../interpreter/taskAuthority.ts";
import type { PolicyAuthorityGrant } from "../../interpreter/taskAuthority.ts";

/** One image a site admits, named by the execution profile and runtime version it runs. */
export interface KubernetesWorkerImage {
  readonly profile: string;
  readonly runtimeVersion: string;
  readonly image: string;
}

/** What one worker container may request and may not exceed. */
export interface KubernetesResourceBudget {
  readonly cpuRequest: string;
  readonly cpuLimit: string;
  readonly memoryRequest: string;
  readonly memoryLimit: string;
}

/** Everything a deployment supplies the worker-launch adapter, and the bounds it works within. */
export interface KubernetesWorkerLaunchConfig {
  readonly apiBaseUrl: string;
  readonly namespace: string;
  readonly tokenFile: string;
  readonly serviceAccountName: string;
  readonly podNamePrefix: string;
  readonly imagesAdmitted: readonly KubernetesWorkerImage[];
  readonly resources: KubernetesResourceBudget;
  readonly podLabels: Readonly<Record<string, string>>;
  readonly podAnnotations: Readonly<Record<string, string>>;
  readonly nodeSelector: Readonly<Record<string, string>>;
  readonly podSecurityContext: Readonly<Record<string, unknown>>;
  readonly containerSecurityContext: Readonly<Record<string, unknown>>;
  readonly activeDeadlineSecs: number;
  readonly requestTimeoutSecsMax: number;
  readonly unavailableRetryAfterSecs: number;
}

/** The one container name a placed pod carries, so a reader of the cluster needs no lookup. */
export const kubernetesWorkerContainerName = "worker";

/** The environment variable a placed worker reads its whole task from. */
export const kubernetesWorkerTaskVariable = "CHUG_WORKER_TASK";

/** The annotation namespace every identity this adapter writes is qualified by. */
const kubernetesWorkerAnnotationPrefix = "chuggy.internal/";

/** The object-name alphabet a namespace, a service account and a name prefix are held to. */
const kubernetesNamePattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/u;

/** The longest name the cluster API accepts for an object. */
export const kubernetesNameCharsMax = 253;

/** How much of a pod name the attempt digest takes, measured from the digest itself. */
const kubernetesWorkerDigestChars = createHash("sha256").digest("hex").length;

/** What a worker is handed: its fenced identity, its pinned inputs and what it may do. */
export interface KubernetesWorkerTask {
  readonly tenant: string;
  readonly project: string;
  readonly execution: string;
  readonly attempt: string;
  readonly generation: number;
  readonly ticket: number;
  readonly task: number;
  readonly taskKind: string;
  readonly stage?: number;
  readonly sourceRequest: string;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly profile: ExecutionProfile;
  readonly briefing: {
    readonly templateVersion: number;
    readonly purpose: string;
    readonly text: string;
  };
  readonly authority: PolicyAuthorityGrant;
}

/** One container of a worker pod, as the cluster API is given it. */
interface KubernetesContainer {
  readonly name: string;
  readonly image: string;
  readonly env: readonly { readonly name: string; readonly value: string }[];
  readonly resources: {
    readonly requests: Readonly<Record<string, string>>;
    readonly limits: Readonly<Record<string, string>>;
  };
  readonly securityContext: Readonly<Record<string, unknown>>;
}

/** One worker pod, as the cluster API is given it. */
export interface KubernetesPod {
  readonly apiVersion: "v1";
  readonly kind: "Pod";
  readonly metadata: {
    readonly name: string;
    readonly namespace: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly annotations: Readonly<Record<string, string>>;
  };
  readonly spec: {
    readonly restartPolicy: "Never";
    readonly serviceAccountName: string;
    readonly automountServiceAccountToken: false;
    readonly activeDeadlineSeconds: number;
    readonly nodeSelector: Readonly<Record<string, string>>;
    readonly securityContext: Readonly<Record<string, unknown>>;
    readonly containers: readonly KubernetesContainer[];
  };
}

/** What translating one placement found, a refusal being a value like every other here. */
export type KubernetesPodRequested =
  | { readonly requested: "Pod"; readonly pod: KubernetesPod }
  | { readonly requested: "Denied"; readonly reason: BlockedReason };

function kubernetesName(value: string, what: string): string {
  if (!kubernetesNamePattern.test(value))
    throw new RangeError(`${what} is not a Kubernetes object name`);
  return value;
}

function kubernetesPositive(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${what} must be a positive integer`);
  return value;
}

/** Refuses a deployment whose supplied cluster data cannot address a cluster. */
export function checkedKubernetesWorkerLaunchConfig(
  config: KubernetesWorkerLaunchConfig,
): KubernetesWorkerLaunchConfig {
  const api = new URL(config.apiBaseUrl);
  if (api.username !== "" || api.password !== "")
    throw new RangeError("cluster API URL must carry no credentials");
  kubernetesName(config.namespace, "worker namespace");
  kubernetesName(config.serviceAccountName, "worker service account");
  kubernetesName(config.podNamePrefix, "worker pod name prefix");
  if (
    config.podNamePrefix.length + "-".length + kubernetesWorkerDigestChars >
    kubernetesNameCharsMax
  )
    throw new RangeError(
      "worker pod name prefix leaves no room for its attempt digest",
    );
  if (config.tokenFile.length === 0)
    throw new RangeError("cluster token file is empty");
  if (config.imagesAdmitted.length === 0)
    throw new RangeError("no worker image is admitted");
  kubernetesPositive(config.activeDeadlineSecs, "worker active deadline");
  kubernetesPositive(config.requestTimeoutSecsMax, "cluster request timeout");
  kubernetesPositive(
    config.unavailableRetryAfterSecs,
    "cluster retry interval",
  );
  return config;
}

/**
 * The object name one attempt's pod has, which the delete path derives from the
 * same two values without holding anything.
 */
export function kubernetesWorkerPodName(
  config: KubernetesWorkerLaunchConfig,
  partition: Partition,
  attempt: AttemptId,
): string {
  const identity = [partition.tenant, partition.project, attempt]
    .map((part) => `${String(part.length)}:${part}`)
    .join("/");
  const digest = createHash("sha256").update(identity).digest("hex");
  return `${config.podNamePrefix}-${digest}`;
}

/** The image this profile is admitted to run, or which inability the site's list states. */
function kubernetesWorkerImage(
  config: KubernetesWorkerLaunchConfig,
  profile: ExecutionProfile,
): { readonly image: string } | { readonly reason: BlockedReason } {
  const named = config.imagesAdmitted.filter(
    (each) => each.profile === profile.profile,
  );
  if (named.length === 0) return { reason: "ExecutionProfileUnavailable" };
  const found = named.find(
    (each) => each.runtimeVersion === profile.runtimeVersion,
  );
  if (found === undefined) return { reason: "RuntimeVersionUnsupported" };
  return { image: found.image };
}

/** The fenced identity and the pinned inputs, as the annotations a placed pod carries. */
function kubernetesWorkerAnnotations(
  config: KubernetesWorkerLaunchConfig,
  placement: AttemptPlacement,
): Readonly<Record<string, string>> {
  const identity: Readonly<Record<string, string>> = {
    tenant: placement.partition.tenant,
    project: placement.partition.project,
    execution: placement.execution,
    attempt: placement.attempt,
    generation: String(placement.generation),
    ticket: String(placement.ticket),
    task: String(placement.task),
    "task-kind": placement.taskKind,
    "source-request": placement.sourceRequest,
    "configuration-revision": placement.configurationRevision,
    "configuration-digest": placement.configurationDigest,
    profile: placement.profile.profile,
    "runtime-version": placement.profile.runtimeVersion,
    ...(placement.stage === undefined
      ? {}
      : { stage: String(placement.stage) }),
  };
  return {
    ...config.podAnnotations,
    ...Object.fromEntries(
      Object.entries(identity).map(([name, value]) => [
        `${kubernetesWorkerAnnotationPrefix}${name}`,
        value,
      ]),
    ),
  };
}

/** Everything the placement supplied, as the one document a worker is handed. */
export function kubernetesWorkerTask(
  placement: AttemptPlacement,
): KubernetesWorkerTask {
  const briefing = placement.invocation.briefing;
  return {
    tenant: placement.partition.tenant,
    project: placement.partition.project,
    execution: placement.execution,
    attempt: placement.attempt,
    generation: placement.generation,
    ticket: placement.ticket,
    task: placement.task,
    taskKind: placement.taskKind,
    ...(placement.stage === undefined ? {} : { stage: placement.stage }),
    sourceRequest: placement.sourceRequest,
    configurationRevision: placement.configurationRevision,
    configurationDigest: placement.configurationDigest,
    profile: placement.profile,
    briefing: {
      templateVersion: briefing.templateVersion,
      purpose: briefing.purpose,
      text: briefing.text,
    },
    authority: taskAuthorityGrant(placement.invocation.authority),
  };
}

/** The one bounded pod a scheduled attempt becomes, or the inability that stops it. */
export function kubernetesWorkerPodRequest(
  config: KubernetesWorkerLaunchConfig,
  placement: AttemptPlacement,
): KubernetesPodRequested {
  const admitted = kubernetesWorkerImage(config, placement.profile);
  if ("reason" in admitted)
    return { requested: "Denied", reason: admitted.reason };
  return {
    requested: "Pod",
    pod: {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: kubernetesWorkerPodName(
          config,
          placement.partition,
          placement.attempt,
        ),
        namespace: config.namespace,
        labels: config.podLabels,
        annotations: kubernetesWorkerAnnotations(config, placement),
      },
      spec: {
        restartPolicy: "Never",
        serviceAccountName: config.serviceAccountName,
        automountServiceAccountToken: false,
        activeDeadlineSeconds: config.activeDeadlineSecs,
        nodeSelector: config.nodeSelector,
        securityContext: config.podSecurityContext,
        containers: [
          {
            name: kubernetesWorkerContainerName,
            image: admitted.image,
            env: [
              {
                name: kubernetesWorkerTaskVariable,
                value: JSON.stringify(kubernetesWorkerTask(placement)),
              },
            ],
            resources: {
              requests: {
                cpu: config.resources.cpuRequest,
                memory: config.resources.memoryRequest,
              },
              limits: {
                cpu: config.resources.cpuLimit,
                memory: config.resources.memoryLimit,
              },
            },
            securityContext: config.containerSecurityContext,
          },
        ],
      },
    },
  };
}
