/**
 * The pod one placed session attempt becomes: the site data a deployment
 * supplies, the image and grant its site-level policy resolved, and the request
 * the cluster API is asked for.
 *
 * A SESSION CARRIES NO REQUIREMENT AND NO INVOCATION. It has no ticket, no
 * pinned configuration and no briefing, so nothing here reads a policy, a
 * revision or a catalog: the image, the profile and the grant arrive on the
 * placement, resolved once for the site, and the briefing machinery is never
 * entered. What is left is the fenced identity, what the session may do, and
 * where its mailbox is.
 *
 * THE MAILBOX ENDPOINT IS SITE DATA, NOT PLACEMENT DATA. The worker plane URL,
 * the capability file and the workspace path are on the launch configuration
 * exactly as they are for a worker; a placement carrying them would be a
 * placement carrying a cluster fact the port is not supposed to know.
 *
 * THE POD IS NAMED FOR ITS ATTEMPT ALONE, by the same digest a worker pod is
 * named by and for the same reason: a repeated placement of one attempt names
 * the object the first created, which is what makes placing idempotent. The
 * generation is not in the name — an attempt identity is already unique to one
 * attempt — and travels as an annotation, because an annotation value is
 * neither bounded nor constrained in its alphabet where a label value is both.
 *
 * NO DATABASE VARIABLES. A slice-1 session makes no scratch database, so the
 * shared server is not named to it at all; a session that later needs one gets
 * it the way a worker does rather than by this module inventing an address.
 */

import { join } from "node:path";

import type { SessionAttemptId } from "../../interpreter/agentSession.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { SessionPlacement } from "../../interpreter/sessionScheduler.ts";
import type { PolicyAuthorityGrant } from "../../interpreter/taskAuthority.ts";
import {
  checkedKubernetesPodSite,
  kubernetesAnnotationPrefix,
  kubernetesAttemptDigest,
  kubernetesContainerResources,
  kubernetesCredentials,
  kubernetesPodNamePrefix,
  kubernetesPositive,
  kubernetesPositiveNumber,
  kubernetesReservedVariables,
  kubernetesSessionTaskVariable,
  kubernetesWorkerCredentialFilesVariable,
  kubernetesWorkerTaskVariable,
  kubernetesWorkerWorkspaceVariable,
  type KubernetesCredentialSelection,
  type KubernetesPod,
  type KubernetesPodRequested,
  type KubernetesPodSite,
  type KubernetesResourceBudget,
  type KubernetesSecret,
} from "./kubernetesSite.ts";

/**
 * Every bound a session pod is given, each an operational choice and none a
 * default it invents. They are carried in the task document rather than read
 * from the image, so what a pod ran under is what this deployment named.
 */
export interface KubernetesSessionBounds {
  readonly mailboxPollMs: number;
  readonly idleMs: number;
  readonly resultDrainMs: number;
  readonly loadTimeoutMs: number;
  readonly turnsMax: number;
  readonly budgetUsd: number;
}

/** The bounds a deployment that names none of them gets. */
export const kubernetesSessionBoundsDefaults: KubernetesSessionBounds = {
  mailboxPollMs: 1_000,
  idleMs: 300_000,
  resultDrainMs: 2_000,
  loadTimeoutMs: 120_000,
  turnsMax: 200,
  budgetUsd: 5,
};

/**
 * The least a dollar cap may be, which is the smallest amount the currency is
 * denominated in. A cap below what a site can name in its own money is a cap
 * nobody can act on: whether it binds is a fact about the model of the day
 * rather than about the deployment, and a site that meant to spend nothing
 * closes the session instead of budgeting it to a rounding error.
 */
export const kubernetesSessionBudgetUsdMin = 0.01;

/** A dollar cap: a fraction the image can spend, and never one below the currency's own unit. */
function kubernetesSessionBudget(value: number, what: string): number {
  kubernetesPositiveNumber(value, what);
  if (value < kubernetesSessionBudgetUsdMin)
    throw new RangeError(
      `${what} must be at least ${String(kubernetesSessionBudgetUsdMin)}, the smallest cap a site can name`,
    );
  return value;
}

/**
 * How each bound is refused: milliseconds and counts are whole numbers, and a
 * dollar cap is not, because the image spends a fraction of one and a bound the
 * pod honours while the launcher refuses it is a bound with two readings.
 *
 * The record is keyed by the bounds themselves rather than listed beside them,
 * so a bound added to the interface has no check here and does not compile —
 * where a list of names only ever proves that what it holds are keys, never
 * that the keys are all held.
 */
const kubernetesSessionBoundChecks: {
  readonly [Bound in keyof KubernetesSessionBounds]: (
    value: number,
    what: string,
  ) => number;
} = {
  mailboxPollMs: kubernetesPositive,
  idleMs: kubernetesPositive,
  resultDrainMs: kubernetesPositive,
  loadTimeoutMs: kubernetesPositive,
  turnsMax: kubernetesPositive,
  budgetUsd: kubernetesSessionBudget,
};

/** Every bound, read off the checks so the two can never name different sets. */
const kubernetesSessionBoundNames = Object.keys(
  kubernetesSessionBoundChecks,
) as readonly (keyof KubernetesSessionBounds)[];

/** Everything a deployment supplies the session-launch adapter beyond the shared site. */
export interface KubernetesSessionLaunchConfig extends KubernetesPodSite {
  readonly podNamePrefix: string;
  readonly podLabels: Readonly<Record<string, string>>;
  readonly podAnnotations: Readonly<Record<string, string>>;
  readonly resources: KubernetesResourceBudget;
  readonly activeDeadlineSecs: number;
  readonly environment: Readonly<Record<string, string>>;
  readonly bounds: KubernetesSessionBounds;
  /** Which model every session of this site speaks to, which is a site choice and not a session's. */
  readonly model: string;
}

/** The one container name a placed session carries, so a reader of the cluster needs no lookup. */
export const kubernetesSessionContainerName = "session";

/** The environment variable naming the model the runtime is opened against. */
export const kubernetesSessionModelVariable = "CHUG_SESSION_MODEL";

/**
 * Where the agent runtime's subprocess mirrors its local copy. The store is the
 * durable one, but the runtime cannot be told to skip the local write, so it is
 * given somewhere writable on the pod's own ephemeral disk.
 */
export const kubernetesSessionConfigDirVariable = "CLAUDE_CONFIG_DIR";

/** The directory under the workspace that local copy is written to. */
const kubernetesSessionConfigDirectory = ".claude";

/** The names this adapter writes itself, which a site's own environment may not take. */
export const kubernetesSessionReservedVariables = [
  kubernetesSessionTaskVariable,
  kubernetesWorkerTaskVariable,
  kubernetesWorkerCredentialFilesVariable,
  kubernetesWorkerWorkspaceVariable,
  kubernetesSessionConfigDirVariable,
  kubernetesSessionModelVariable,
] as const;

/** The volume a session's bearer is projected from, and the one it works in. */
const kubernetesSessionCapabilityVolume = "session-capability";
const kubernetesSessionWorkspaceVolume = "session-workspace";

/** What a session is handed: its fenced identity, what it may do, and where its mailbox is. */
export interface KubernetesSessionTask {
  readonly tenant: string;
  readonly project: string;
  readonly session: string;
  readonly kind: string;
  readonly attempt: string;
  readonly generation: number;
  readonly capabilities: readonly string[];
  readonly credentialSlot: string;
  readonly agentReference?: string;
  readonly authority: PolicyAuthorityGrant;
  readonly workerPlane: {
    readonly url: string;
    readonly capabilityFile: string;
  };
  readonly bounds: KubernetesSessionBounds;
}

/** Refuses a deployment whose supplied cluster data cannot address a cluster. */
export function checkedKubernetesSessionLaunchConfig(
  config: KubernetesSessionLaunchConfig,
): KubernetesSessionLaunchConfig {
  checkedKubernetesPodSite(config, "session");
  kubernetesPodNamePrefix(config.podNamePrefix, "session pod name prefix");
  kubernetesReservedVariables(
    config.environment,
    kubernetesSessionReservedVariables,
    "session environment",
  );
  if (config.model.length === 0) throw new RangeError("session model is empty");
  kubernetesPositive(config.activeDeadlineSecs, "session active deadline");
  for (const bound of kubernetesSessionBoundNames)
    kubernetesSessionBoundChecks[bound](
      config.bounds[bound],
      `session ${bound}`,
    );
  return config;
}

/** The object name one session attempt's pod has, derivable from what a cancellation carries. */
export function kubernetesSessionPodName(
  config: KubernetesSessionLaunchConfig,
  partition: Partition,
  attempt: SessionAttemptId,
): string {
  return `${config.podNamePrefix}-${kubernetesAttemptDigest(partition, attempt)}`;
}

/** The Secret a session's bearer is projected from, named for the pod that owns it. */
export const kubernetesSessionSecretName = kubernetesSessionPodName;

export function kubernetesSessionSecret(
  config: KubernetesSessionLaunchConfig,
  placement: SessionPlacement,
  podUid: string,
): KubernetesSecret {
  const podName = kubernetesSessionPodName(
    config,
    placement.partition,
    placement.attempt,
  );
  return {
    apiVersion: "v1",
    kind: "Secret",
    immutable: true,
    metadata: {
      name: kubernetesSessionSecretName(
        config,
        placement.partition,
        placement.attempt,
      ),
      namespace: config.namespace,
      ownerReferences: [
        {
          apiVersion: "v1",
          kind: "Pod",
          name: podName,
          uid: podUid,
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    stringData: { bearer: placement.bearer.secret },
  };
}

/** Everything the placement supplied, as the one document a session is handed. */
export function kubernetesSessionTask(
  config: KubernetesSessionLaunchConfig,
  placement: SessionPlacement,
): KubernetesSessionTask {
  return {
    tenant: placement.partition.tenant,
    project: placement.partition.project,
    session: placement.session,
    kind: placement.kind,
    attempt: placement.attempt,
    generation: placement.generation,
    capabilities: placement.capabilities,
    credentialSlot: placement.credentialSlot,
    ...(placement.agentReference === undefined
      ? {}
      : { agentReference: placement.agentReference }),
    authority: placement.authority,
    workerPlane: {
      url: config.workerPlaneUrl,
      capabilityFile: config.capabilityFile,
    },
    bounds: config.bounds,
  };
}

/** The fenced identity, as the annotations a placed session pod carries. */
function kubernetesSessionAnnotations(
  config: KubernetesSessionLaunchConfig,
  placement: SessionPlacement,
): Readonly<Record<string, string>> {
  const identity: Readonly<Record<string, string>> = {
    tenant: placement.partition.tenant,
    project: placement.partition.project,
    session: placement.session,
    attempt: placement.attempt,
    generation: String(placement.generation),
    kind: placement.kind,
    profile: placement.profile.profile,
    "runtime-version": placement.profile.runtimeVersion,
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

/** The one session container, separated from its pod so both documents stay reviewable. */
function kubernetesSessionContainer(
  config: KubernetesSessionLaunchConfig,
  placement: SessionPlacement,
  credentials: KubernetesCredentialSelection,
): KubernetesPod["spec"]["containers"][number] {
  return {
    name: kubernetesSessionContainerName,
    image: placement.image,
    env: [
      {
        name: kubernetesSessionTaskVariable,
        value: JSON.stringify(kubernetesSessionTask(config, placement)),
      },
      {
        name: kubernetesWorkerCredentialFilesVariable,
        value: JSON.stringify(credentials.files),
      },
      { name: kubernetesWorkerWorkspaceVariable, value: config.workspacePath },
      {
        name: kubernetesSessionConfigDirVariable,
        value: join(config.workspacePath, kubernetesSessionConfigDirectory),
      },
      { name: kubernetesSessionModelVariable, value: config.model },
      ...Object.entries(config.environment).map(([name, value]) => ({
        name,
        value,
      })),
    ],
    resources: kubernetesContainerResources(config.resources),
    securityContext: config.containerSecurityContext,
    volumeMounts: [
      {
        name: kubernetesSessionCapabilityVolume,
        mountPath: config.capabilityFile,
        subPath: "bearer",
        readOnly: true,
      },
      {
        name: kubernetesSessionWorkspaceVolume,
        mountPath: config.workspacePath,
        readOnly: false,
      },
      ...credentials.mounts,
    ],
  };
}

/**
 * The one bounded pod a placed session attempt becomes, or the inability that
 * stops it. A grant naming a credential this site does not mount, and a
 * credential slot the grant does not name, are both that inability: the pod
 * would start, find no file where it was told to look, and fail every turn it
 * was ever given.
 */
export function kubernetesSessionPodRequest(
  config: KubernetesSessionLaunchConfig,
  placement: SessionPlacement,
): KubernetesPodRequested {
  const credentials = kubernetesCredentials(
    config,
    placement.authority,
    kubernetesSessionContainerName,
  );
  if (
    credentials === undefined ||
    !Object.hasOwn(credentials.files, placement.credentialSlot)
  )
    return { requested: "Denied", reason: "RequiredCapabilityUnavailable" };
  return {
    requested: "Pod",
    pod: {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: kubernetesSessionPodName(
          config,
          placement.partition,
          placement.attempt,
        ),
        namespace: config.namespace,
        labels: config.podLabels,
        annotations: kubernetesSessionAnnotations(config, placement),
      },
      spec: {
        restartPolicy: "Never",
        serviceAccountName: config.serviceAccountName,
        automountServiceAccountToken: false,
        activeDeadlineSeconds: config.activeDeadlineSecs,
        nodeSelector: config.nodeSelector,
        securityContext: config.podSecurityContext,
        containers: [
          kubernetesSessionContainer(config, placement, credentials),
        ],
        volumes: [
          {
            name: kubernetesSessionCapabilityVolume,
            secret: {
              secretName: kubernetesSessionSecretName(
                config,
                placement.partition,
                placement.attempt,
              ),
              defaultMode: 0o400,
              items: [{ key: "bearer", path: "bearer" }],
            },
          },
          {
            name: kubernetesSessionWorkspaceVolume,
            emptyDir: { sizeLimit: config.resources.ephemeralStorageLimit },
          },
          ...credentials.volumes,
        ],
      },
    },
  };
}
