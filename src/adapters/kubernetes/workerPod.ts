/**
 * The pod one scheduled attempt becomes: the site data a deployment supplies,
 * the image its pinned requirement names, and the request the cluster API is
 * asked for.
 *
 * NOTHING HERE IS A SITE DECISION, AND NOW NOT AN IMAGE ONE EITHER. The
 * namespace, the service account, the node selector, the two security contexts
 * and the resource budget all arrive as plain data on the configuration, so a
 * site that changes one of them changes its deployment rather than this
 * adapter. Which image an attempt runs is its requirement's where that pins
 * one and its placement's where policy resolved a capability, and whether this
 * site runs that image was `ExecutionPolicy`'s answer before the attempt was
 * placed; what is left here is what a container backend cannot serve whatever
 * policy said, which is a native requirement or a capability policy resolved
 * no image for.
 *
 * A POD IS NAMED FOR ITS ATTEMPT AND FOR NOTHING ELSE. `AttemptPlacementPort`
 * places and cancels the same fenced attempt, so the name has to be derivable
 * from what both of those carry; it is a digest over the partition and the
 * attempt because an attempt identity is opaque and may carry text no object
 * name accepts. The generation is not part of it: an attempt identity is
 * already unique to one attempt, so there is at most one pod to name and a
 * generation would distinguish nothing. That is what makes a repeated
 * placement of one attempt idempotent, because the second request names the
 * object the first created.
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
 *
 * A WORKER'S POSTGRESQL IS A SIDECAR, AND THE WORKER IS ITS SUPERUSER. The
 * gates a repository runs against a server migrate it, and a migration makes
 * and alters cluster-wide roles: run on a server the attempt shares with
 * anything else, it needs an authority over that server's roles that nothing
 * agent-authored can be given. So the server is the attempt's alone — a
 * container beside the worker's, listening on the pod's own loopback, holding
 * nothing before the attempt and nothing after it — and what would have been a
 * credential is a fixed address. It is a sidecar rather than a second
 * container so that the pod ends when the worker does.
 */

import type {
  AttemptPlacement,
  BlockedReason,
  ExecutionProfile,
} from "../../interpreter/executionScheduler.ts";
import type { AttemptId } from "../../interpreter/schedulerIdentity.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { taskAuthorityGrant } from "../../interpreter/taskAuthority.ts";
import type { PolicyAuthorityGrant } from "../../interpreter/taskAuthority.ts";
import {
  checkedKubernetesPodSite,
  kubernetesAnnotationPrefix,
  kubernetesAttemptDigest,
  kubernetesContainerResources,
  kubernetesCredentials,
  kubernetesPodNamePrefix,
  kubernetesPositive,
  kubernetesReservedVariables,
  kubernetesSessionTaskVariable,
  kubernetesWorkerCredentialFilesVariable,
  kubernetesWorkerTaskVariable,
  type KubernetesContainer,
  type KubernetesContainerVariable,
  type KubernetesCredentialSelection,
  type KubernetesPod,
  type KubernetesPodRequested,
  type KubernetesPodSite,
  type KubernetesResourceBudget,
  type KubernetesSecret,
} from "./kubernetesSite.ts";

/** The PostgreSQL image an attempt's sidecar runs, and what that container may use. */
export interface KubernetesWorkerDatabase {
  readonly image: string;
  readonly resources: KubernetesResourceBudget;
}

/**
 * Everything a deployment supplies the worker-launch adapter beyond the site
 * every pod of it shares, and the bounds it works within.
 */
export interface KubernetesWorkerLaunchConfig extends KubernetesPodSite {
  readonly podNamePrefix: string;
  readonly resources: KubernetesResourceBudget;
  readonly podLabels: Readonly<Record<string, string>>;
  readonly podAnnotations: Readonly<Record<string, string>>;
  readonly activeDeadlineSecs: number;
  readonly environment: Readonly<Record<string, string>>;
  readonly database?: KubernetesWorkerDatabase;
}

/** The one container name a placed pod carries, so a reader of the cluster needs no lookup. */
export const kubernetesWorkerContainerName = "worker";

/** The environment variable a placed worker reaches its own PostgreSQL by. */
export const kubernetesWorkerDatabaseUrlVariable = "CHUG_WORKER_DATABASE_URL";

/** The container name the attempt's PostgreSQL runs under, beside the worker's. */
export const kubernetesWorkerDatabaseContainerName = "postgres";

/**
 * Where the sidecar answers and what it answers as: the pod's loopback, which
 * only this pod's containers reach, and the server's own superuser with no
 * password, because there is nothing in the pod the worker is not.
 */
export const kubernetesWorkerDatabaseUrl =
  "postgres://postgres@127.0.0.1:5432/postgres";

/** The names this adapter writes itself, which a site's own environment may not take. */
export const kubernetesWorkerReservedVariables = [
  kubernetesWorkerTaskVariable,
  kubernetesSessionTaskVariable,
  kubernetesWorkerCredentialFilesVariable,
  kubernetesWorkerDatabaseUrlVariable,
] as const;

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
  readonly inputBundle: string;
  readonly inputBundleDigest: string;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly profile: ExecutionProfile;
  readonly requirementIdentity: string;
  readonly requirementDigest: string;
  readonly briefing: {
    readonly templateVersion: number;
    readonly purpose: string;
    readonly text: string;
  };
  readonly authority: PolicyAuthorityGrant;
  readonly worker?: NonNullable<AttemptPlacement["invocation"]["worker"]>;
  readonly workerPlane: {
    readonly url: string;
    readonly capabilityFile: string;
    readonly capability: string;
    readonly manifest: string;
  };
}

/**
 * Refuses a deployment whose supplied cluster data cannot address a cluster,
 * and whose own environment would replace a variable this adapter writes.
 */
export function checkedKubernetesWorkerLaunchConfig(
  config: KubernetesWorkerLaunchConfig,
): KubernetesWorkerLaunchConfig {
  checkedKubernetesPodSite(config, "worker");
  kubernetesPodNamePrefix(config.podNamePrefix, "worker pod name prefix");
  kubernetesReservedVariables(
    config.environment,
    kubernetesWorkerReservedVariables,
    "worker environment",
  );
  if (config.database !== undefined && config.database.image.length === 0)
    throw new RangeError("worker database image is empty");
  kubernetesPositive(config.activeDeadlineSecs, "worker active deadline");
  return config;
}

/**
 * The object name one attempt's pod has, which the cancellation path derives
 * from the same two values without holding anything.
 */
export function kubernetesWorkerPodName(
  config: KubernetesWorkerLaunchConfig,
  partition: Partition,
  attempt: AttemptId,
): string {
  return `${config.podNamePrefix}-${kubernetesAttemptDigest(partition, attempt)}`;
}

export const kubernetesWorkerSecretName = kubernetesWorkerPodName;

export function kubernetesWorkerSecret(
  config: KubernetesWorkerLaunchConfig,
  placement: AttemptPlacement,
  podUid: string,
): KubernetesSecret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    immutable: true,
    metadata: {
      name: kubernetesWorkerSecretName(
        config,
        placement.partition,
        placement.attempt,
      ),
      namespace: config.namespace,
      ownerReferences: [
        {
          apiVersion: "v1",
          kind: "Pod",
          name: kubernetesWorkerPodName(
            config,
            placement.partition,
            placement.attempt,
          ),
          uid: podUid,
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    stringData: { bearer: placement.capability.secret },
  };
}

/**
 * The image this attempt runs. Exact-image requirements carry it themselves;
 * capability requirements carry the image scheduler policy resolved.
 */
function kubernetesWorkerImage(
  placement: AttemptPlacement,
): { readonly image: string } | { readonly reason: BlockedReason } {
  if (placement.requirement.mode === "Container")
    return { image: placement.requirement.image };
  if (
    placement.requirement.mode === "ContainerCapability" &&
    placement.image !== undefined
  )
    return { image: placement.image };
  return { reason: "RequiredCapabilityUnavailable" };
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
    "input-bundle": placement.inputBundle,
    "input-bundle-digest": placement.inputBundleDigest,
    "configuration-revision": placement.configurationRevision,
    "configuration-digest": placement.configurationDigest,
    profile: placement.profile.profile,
    "runtime-version": placement.profile.runtimeVersion,
    requirement: placement.requirementIdentity,
    "requirement-digest": placement.requirementDigest,
    ...(placement.stage === undefined
      ? {}
      : { stage: String(placement.stage) }),
  };
  return {
    ...config.podAnnotations,
    ...Object.fromEntries(
      Object.entries(identity).map(([name, value]) => [
        `${kubernetesAnnotationPrefix}${name}`,
        value,
      ]),
    ),
  };
}

/** Everything the placement supplied, as the one document a worker is handed. */
export function kubernetesWorkerTask(
  config: KubernetesWorkerLaunchConfig,
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
    inputBundle: placement.inputBundle,
    inputBundleDigest: placement.inputBundleDigest,
    configurationRevision: placement.configurationRevision,
    configurationDigest: placement.configurationDigest,
    profile: placement.profile,
    requirementIdentity: placement.requirementIdentity,
    requirementDigest: placement.requirementDigest,
    briefing: {
      templateVersion: briefing.templateVersion,
      purpose: briefing.purpose,
      text: briefing.text,
    },
    authority: taskAuthorityGrant(placement.invocation.authority),
    ...(placement.invocation.worker === undefined
      ? {}
      : { worker: placement.invocation.worker }),
    workerPlane: {
      url: config.workerPlaneUrl,
      capabilityFile: config.capabilityFile,
      capability: placement.capability.id,
      manifest: placement.capability.manifest,
    },
  };
}

function kubernetesWorkerCapabilityVolumes(
  config: KubernetesWorkerLaunchConfig,
  placement: AttemptPlacement,
): KubernetesPod["spec"]["volumes"] {
  return [
    {
      name: "worker-capability",
      secret: {
        secretName: kubernetesWorkerSecretName(
          config,
          placement.partition,
          placement.attempt,
        ),
        defaultMode: 0o400,
        items: [{ key: "bearer", path: "bearer" }],
      },
    },
  ];
}

/**
 * The server a worker reaches, or nothing where the site runs none: work that
 * then asks for one fails in the container rather than being placed against a
 * server this module invented an address for.
 */
function kubernetesWorkerDatabaseVariables(
  config: KubernetesWorkerLaunchConfig,
): readonly KubernetesContainerVariable[] {
  if (config.database === undefined) return [];
  return [
    {
      name: kubernetesWorkerDatabaseUrlVariable,
      value: kubernetesWorkerDatabaseUrl,
    },
  ];
}

/**
 * The attempt's PostgreSQL, as the sidecar that runs it. The worker container
 * is not started until the startup probe has seen the server accept a
 * connection, so the worker never waits for it; and the server trusts every
 * loopback connection because it is bound to loopback alone.
 */
function kubernetesWorkerDatabaseContainer(
  config: KubernetesWorkerLaunchConfig,
  database: KubernetesWorkerDatabase,
): KubernetesContainer {
  return {
    name: kubernetesWorkerDatabaseContainerName,
    image: database.image,
    args: ["-c", "listen_addresses=127.0.0.1"],
    restartPolicy: "Always",
    startupProbe: {
      exec: { command: ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"] },
      periodSeconds: 1,
      failureThreshold: 120,
    },
    env: [{ name: "POSTGRES_HOST_AUTH_METHOD", value: "trust" }],
    resources: kubernetesContainerResources(database.resources),
    securityContext: config.containerSecurityContext,
    volumeMounts: [
      {
        name: "worker-database",
        mountPath: "/var/lib/postgresql",
        readOnly: false,
      },
    ],
  };
}

/** The one worker container, separated from its pod so both documents stay reviewable. */
function kubernetesWorkerContainer(
  config: KubernetesWorkerLaunchConfig,
  placement: AttemptPlacement,
  image: string,
  credentials: KubernetesCredentialSelection,
): KubernetesContainer {
  return {
    name: kubernetesWorkerContainerName,
    image,
    env: [
      {
        name: kubernetesWorkerTaskVariable,
        value: JSON.stringify(kubernetesWorkerTask(config, placement)),
      },
      {
        name: kubernetesWorkerCredentialFilesVariable,
        value: JSON.stringify(credentials.files),
      },
      ...kubernetesWorkerDatabaseVariables(config),
      ...Object.entries(config.environment).map(([name, value]) => ({
        name,
        value,
      })),
    ],
    resources: kubernetesContainerResources(config.resources),
    securityContext: config.containerSecurityContext,
    volumeMounts: [
      {
        name: "worker-capability",
        mountPath: config.capabilityFile,
        subPath: "bearer",
        readOnly: true,
      },
      {
        name: "worker-workspace",
        mountPath: config.workspacePath,
        readOnly: false,
      },
      ...credentials.mounts,
    ],
  };
}

/** Every volume the pod mounts: the bearer, the workspace, the sidecar's data and the credentials. */
function kubernetesWorkerVolumes(
  config: KubernetesWorkerLaunchConfig,
  placement: AttemptPlacement,
  credentials: KubernetesCredentialSelection,
): KubernetesPod["spec"]["volumes"] {
  return [
    ...kubernetesWorkerCapabilityVolumes(config, placement),
    {
      name: "worker-workspace",
      emptyDir: { sizeLimit: config.resources.ephemeralStorageLimit },
    },
    ...(config.database === undefined
      ? []
      : [
          {
            name: "worker-database",
            emptyDir: {
              sizeLimit: config.database.resources.ephemeralStorageLimit,
            },
          },
        ]),
    ...credentials.volumes,
  ];
}

/** The one bounded pod a scheduled attempt becomes, or the inability that stops it. */
export function kubernetesWorkerPodRequest(
  config: KubernetesWorkerLaunchConfig,
  placement: AttemptPlacement,
): KubernetesPodRequested {
  const admitted = kubernetesWorkerImage(placement);
  if ("reason" in admitted)
    return { requested: "Denied", reason: admitted.reason };
  const credentials = kubernetesCredentials(
    config,
    taskAuthorityGrant(placement.invocation.authority),
    kubernetesWorkerContainerName,
  );
  if (credentials === undefined)
    return { requested: "Denied", reason: "RequiredCapabilityUnavailable" };
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
        ...(config.database === undefined
          ? {}
          : {
              initContainers: [
                kubernetesWorkerDatabaseContainer(config, config.database),
              ],
            }),
        containers: [
          kubernetesWorkerContainer(
            config,
            placement,
            admitted.image,
            credentials,
          ),
        ],
        volumes: kubernetesWorkerVolumes(config, placement, credentials),
      },
    },
  };
}
