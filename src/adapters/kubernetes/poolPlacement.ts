/**
 * `WorkerPoolBackend` over one Kubernetes namespace: a pod per assignment, and
 * nothing that knows what the assignment is for.
 *
 * IT IS THE SAME PLACEMENT THE IN-CLUSTER BACKEND MAKES, WITH LESS TO GO ON. A
 * pod named for its identity, an `activeDeadlineSeconds`, a resource budget and
 * an envelope projected through a pod-owned Secret are `kubernetesSite.ts`'s
 * and are shared with `ticketExecution.ts`; what differs is that a pool is
 * handed six fields rather than a materialised view, so nothing here reads a
 * workload, a runner or a profile.
 *
 * WHAT IS RUNNING IS READ FROM THE CLUSTER. `held` lists this pool's own pods
 * by its label and reads each assignment off an annotation, so a restarted
 * client recovers its workloads instead of orphaning them; a listing that could
 * not be made raises rather than answering an empty cluster, because the
 * emptier answer is the one that loses work.
 *
 * A CAPABILITY IS A PLACEMENT CONSTRAINT AND NOTHING ELSE. A token the site
 * maps contributes a node selector and the tolerations that let a node kept for
 * it be tainted against everything else; a token it does not map contributes
 * nothing, because a pool declared its capabilities at registration and a
 * token like a mounted provider credential is satisfied by the pool itself
 * rather than by a node.
 */

import type { WorkerPoolAssignment } from "../../contract/workerPool.ts";
import type {
  WorkerPoolBackend,
  WorkerPoolPlacement,
} from "../../interpreter/workerPoolClient.ts";
import {
  kubernetesCancelPod,
  kubernetesListedPodAnnotations,
  kubernetesPlacePod,
} from "./clusterReach.ts";
import {
  checkedKubernetesPodSite,
  kubernetesAnnotationPrefix,
  kubernetesContainerResources,
  kubernetesCredentials,
  kubernetesIdentityDigest,
  kubernetesPodNamePrefix,
  kubernetesPodSecret,
  kubernetesPositive,
  kubernetesReservedVariables,
  kubernetesWorkloadPod,
  type KubernetesPod,
  type KubernetesPodSite,
  type KubernetesResourceBudget,
  type KubernetesToleration,
} from "./kubernetesSite.ts";

/** The variable the harness reads its envelope from, which both backends write alike. */
export const kubernetesPoolTaskVariable = "CHUG_TICKET_WORKER_TASK";

/** The annotation one pod carries its assignment in, which is what `held` reads back. */
export const kubernetesPoolAssignmentAnnotation = `${kubernetesAnnotationPrefix}assignment`;

/** The container one assignment's harness runs as. */
export const kubernetesPoolContainerName = "pool-worker";

/** Where one capability token puts a workload, for a site that keeps nodes for it. */
export interface KubernetesCapabilityPlacement {
  readonly nodeSelector: Readonly<Record<string, string>>;
  readonly tolerations: readonly KubernetesToleration[];
}

export interface KubernetesPoolPlacementConfig extends KubernetesPodSite {
  readonly podNamePrefix: string;
  readonly image: string;
  readonly poolLabel: { readonly name: string; readonly value: string };
  readonly podLabels: Readonly<Record<string, string>>;
  readonly podAnnotations: Readonly<Record<string, string>>;
  readonly resources: KubernetesResourceBudget;
  readonly timeoutSecsMax: number;
  readonly outputBytesMax: number;
  readonly environment: Readonly<Record<string, string>>;
  readonly capabilities: Readonly<
    Record<string, KubernetesCapabilityPlacement>
  >;
  /** The pool's own provider credential, named among the site's mounts and mounted into every workload. */
  readonly providerCredential?: string | undefined;
}

export function checkedKubernetesPoolPlacementConfig(
  config: KubernetesPoolPlacementConfig,
): KubernetesPoolPlacementConfig {
  checkedKubernetesPodSite(config, "pool placement");
  kubernetesPodNamePrefix(config.podNamePrefix, "pool placement pod prefix");
  kubernetesPositive(config.timeoutSecsMax, "pool workload timeout");
  kubernetesPositive(config.outputBytesMax, "pool workload output bound");
  if (config.image.length === 0)
    throw new RangeError("pool worker image is empty");
  if (config.poolLabel.name.length === 0 || config.poolLabel.value.length === 0)
    throw new RangeError("pool placement label is empty");
  kubernetesReservedVariables(
    config.environment,
    [kubernetesPoolTaskVariable],
    "pool worker environment",
  );
  if (
    config.providerCredential !== undefined &&
    config.credentialMounts[config.providerCredential] === undefined
  )
    throw new RangeError("pool provider credential is served by no mount");
  return config;
}

/** The one pod an assignment is placed as, named so a repeated placement names it again. */
export function kubernetesPoolPodName(
  config: KubernetesPoolPlacementConfig,
  assignment: string,
): string {
  return `${config.podNamePrefix}-${kubernetesIdentityDigest([assignment])}`;
}

/**
 * The selector and tolerations one assignment's capabilities add to the site's
 * own. A capability the site does not map adds neither, which is how a pool
 * runs work whose capability it satisfies by being itself.
 */
function poolPlacementConstraints(
  config: KubernetesPoolPlacementConfig,
  capabilities: readonly string[],
): {
  readonly nodeSelector: Readonly<Record<string, string>>;
  readonly tolerations: readonly KubernetesToleration[];
} {
  const nodeSelector: Record<string, string> = { ...config.nodeSelector };
  const tolerations: KubernetesToleration[] = [];
  for (const capability of capabilities) {
    const placement = config.capabilities[capability];
    if (placement === undefined) continue;
    Object.assign(nodeSelector, placement.nodeSelector);
    tolerations.push(...placement.tolerations);
  }
  return { nodeSelector, tolerations };
}

/**
 * What the pod is launched with, which is what no callback can hand it. It is
 * the same payload the in-cluster launcher writes, because every byte of
 * material the run needs is fetched from the callback under the bearer here and
 * a pool holds no identity to add to it.
 */
function poolPlacementEnvelope(
  config: KubernetesPoolPlacementConfig,
  assignment: WorkerPoolAssignment,
  providerCredentialFile: string | undefined,
): string {
  return JSON.stringify({
    callbackUrl: assignment.callbackUrl,
    bearer: assignment.bearer,
    workspace: config.workspacePath,
    timeoutSecsMax: config.timeoutSecsMax,
    outputBytesMax: config.outputBytesMax,
    ...(providerCredentialFile === undefined ? {} : { providerCredentialFile }),
  });
}

/** The box the assignment asked for, the site deciding only what it said nothing about. */
function poolPlacementResources(
  config: KubernetesPoolPlacementConfig,
  assignment: WorkerPoolAssignment,
): ReturnType<typeof kubernetesContainerResources> {
  return kubernetesContainerResources({
    ...config.resources,
    cpuRequest: `${String(assignment.cpuMillis)}m`,
    cpuLimit: `${String(assignment.cpuMillis)}m`,
    memoryRequest: `${String(assignment.memoryMib)}Mi`,
    memoryLimit: `${String(assignment.memoryMib)}Mi`,
  });
}

function poolPlacementPod(
  config: KubernetesPoolPlacementConfig,
  assignment: WorkerPoolAssignment,
  credentials: ReturnType<typeof kubernetesCredentials> & {},
): KubernetesPod {
  const name = kubernetesPoolPodName(config, assignment.assignment);
  const constraints = poolPlacementConstraints(config, assignment.capabilities);
  return kubernetesWorkloadPod({
    site: config,
    name,
    labels: {
      ...config.podLabels,
      [config.poolLabel.name]: config.poolLabel.value,
    },
    annotations: {
      ...config.podAnnotations,
      [kubernetesPoolAssignmentAnnotation]: assignment.assignment,
    },
    activeDeadlineSecs: assignment.deadlineSecs,
    nodeSelector: constraints.nodeSelector,
    tolerations: constraints.tolerations,
    initContainers: [],
    containers: [
      {
        name: kubernetesPoolContainerName,
        image: config.image,
        env: [
          {
            name: kubernetesPoolTaskVariable,
            valueFrom: { secretKeyRef: { name, key: "task" } },
          },
          ...Object.entries(config.environment).map(([variable, value]) => ({
            name: variable,
            value,
          })),
        ],
        resources: poolPlacementResources(config, assignment),
        securityContext: config.containerSecurityContext,
        volumeMounts: [
          {
            name: "workspace",
            mountPath: config.workspacePath,
            readOnly: false,
          },
          { name: "control", mountPath: "/tmp", readOnly: false },
          ...credentials.mounts,
        ],
      },
    ],
    volumes: [
      {
        name: "workspace",
        emptyDir: { sizeLimit: config.resources.ephemeralStorageLimit },
      },
      { name: "control", emptyDir: { sizeLimit: "16Mi" } },
      ...credentials.volumes,
    ],
  });
}

/**
 * The credentials every workload this pool places is given, which are the
 * pool's own and never the ticket's. A configured credential the site stopped
 * serving is a pool that cannot run its own work, so it is refused rather than
 * silently dropped.
 */
function poolPlacementCredentials(
  config: KubernetesPoolPlacementConfig,
): ReturnType<typeof kubernetesCredentials> {
  return kubernetesCredentials(
    config,
    {
      tools: [],
      credentials:
        config.providerCredential === undefined
          ? []
          : [config.providerCredential],
      network: true,
      filesystem: "WriteWorkspace",
      mayCompleteTask: true,
    },
    kubernetesPoolContainerName,
  );
}

async function poolPlacementPlaced(
  config: KubernetesPoolPlacementConfig,
  fetcher: typeof fetch,
  assignment: WorkerPoolAssignment,
): Promise<WorkerPoolPlacement> {
  const credentials = poolPlacementCredentials(config);
  if (credentials === undefined)
    return {
      placed: "Refused",
      evidence: "this pool serves no provider credential for its workloads",
    };
  const pod = poolPlacementPod(config, assignment, credentials);
  const outcome = await kubernetesPlacePod(config, fetcher, pod, (podUid) =>
    kubernetesPodSecret(pod, podUid, {
      task: poolPlacementEnvelope(
        config,
        assignment,
        config.providerCredential === undefined
          ? undefined
          : credentials.files[config.providerCredential],
      ),
    }),
  );
  switch (outcome.placed) {
    case "Placed":
      return { placed: "Placed" };
    case "Denied":
      return {
        placed: "Refused",
        evidence: `the cluster refused this workload: ${outcome.reason}`,
      };
    case "Unavailable":
      return {
        placed: "Unavailable",
        retryAfterSecs: outcome.retryAfterSeconds,
      };
  }
}

export function kubernetesPoolBackend(
  input: KubernetesPoolPlacementConfig,
  fetcher: typeof fetch = fetch,
): WorkerPoolBackend {
  const config = checkedKubernetesPoolPlacementConfig(input);
  return {
    place: (assignment) => poolPlacementPlaced(config, fetcher, assignment),
    stop: async (assignment) => {
      const cancelled = await kubernetesCancelPod(
        config,
        fetcher,
        kubernetesPoolPodName(config, assignment),
      );
      if (cancelled.cancelled !== "Accepted")
        throw new Error(
          "a workload this pool was told to stop is still placed",
        );
    },
    held: () =>
      kubernetesListedPodAnnotations(
        config,
        fetcher,
        `${config.poolLabel.name}=${config.poolLabel.value}`,
        kubernetesPoolAssignmentAnnotation,
      ),
  };
}
