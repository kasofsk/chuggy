/**
 * What every pod this deployment places is made of, whatever the pod is for:
 * the cluster a site supplies, the object alphabet the API holds a name to, the
 * value types a pod document is built from, and the one digest an attempt's
 * objects are named by.
 *
 * IT IS SHARED BECAUSE THE CLUSTER IS SHARED, NOT TO SAVE LINES. A worker pod
 * and a session pod are placed in one namespace, under one service account,
 * against one API, with one set of security contexts and one set of credential
 * mounts; a second copy of those fields would be a second answer to what the
 * site is, and the first deployment to change one would leave the other placing
 * pods the site no longer describes.
 *
 * A POD IS NAMED FOR ITS ATTEMPT AND FOR NOTHING ELSE, by a digest over the
 * partition and the attempt because an attempt identity is opaque and may carry
 * text no object name accepts. The generation is not part of it: an attempt
 * identity is already unique to one attempt, so there is at most one pod to
 * name and a generation would distinguish nothing. That is what makes a
 * repeated placement idempotent — the second request names the object the first
 * created — and it is the same device for both kinds of pod because it is the
 * same property both need.
 *
 * NOTHING HERE IS A SITE DECISION. Every field arrives as plain data on a
 * configuration, so a site that changes one changes its deployment rather than
 * this module; what this module decides is whether what arrived can address a
 * cluster at all.
 */

import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import type { BlockedReason } from "../../interpreter/executionScheduler.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { PolicyAuthorityGrant } from "../../interpreter/taskAuthority.ts";

/** What one container may request and may not exceed. */
export interface KubernetesResourceBudget {
  readonly cpuRequest: string;
  readonly cpuLimit: string;
  readonly memoryRequest: string;
  readonly memoryLimit: string;
  readonly ephemeralStorageLimit: string;
}

/** One site-owned Secret key that may satisfy a policy's named credential. */
export interface KubernetesWorkerCredentialMount {
  readonly secretName: string;
  readonly key: string;
  readonly mountPath: string;
}

/**
 * Everything a deployment supplies about the cluster itself, which is what both
 * launchers need and neither owns.
 */
export interface KubernetesPodSite {
  readonly apiBaseUrl: string;
  readonly namespace: string;
  readonly tokenFile: string;
  readonly serviceAccountName: string;
  readonly nodeSelector: Readonly<Record<string, string>>;
  readonly podSecurityContext: Readonly<Record<string, unknown>>;
  readonly containerSecurityContext: Readonly<Record<string, unknown>>;
  readonly requestTimeoutSecsMax: number;
  readonly unavailableRetryAfterSecs: number;
  readonly workerPlaneUrl: string;
  readonly capabilityFile: string;
  readonly workspacePath: string;
  readonly credentialMounts: Readonly<
    Record<string, KubernetesWorkerCredentialMount>
  >;
}

/**
 * One variable a container is given, which is a value or a reference to one. A
 * site's secret is the second kind: the pod spec names the Secret and the
 * kubelet is what reads it, so the value is in no document this adapter writes
 * and in no request it sends.
 */
export type KubernetesContainerVariable =
  | { readonly name: string; readonly value: string }
  | {
      readonly name: string;
      readonly valueFrom: {
        readonly secretKeyRef: { readonly name: string; readonly key: string };
      };
    };

/** One container of a placed pod, as the cluster API is given it. */
export interface KubernetesContainer {
  readonly name: string;
  readonly image: string;
  readonly env: readonly KubernetesContainerVariable[];
  readonly resources: {
    readonly requests: Readonly<Record<string, string>>;
    readonly limits: Readonly<Record<string, string>>;
  };
  readonly securityContext: Readonly<Record<string, unknown>>;
  readonly volumeMounts: readonly {
    readonly name: string;
    readonly mountPath: string;
    readonly subPath?: string;
    readonly readOnly: boolean;
  }[];
}

/** The pod-owned immutable Secret one placement's bearer is projected from. */
export interface KubernetesSecret {
  readonly apiVersion: "v1";
  readonly kind: "Secret";
  readonly immutable: true;
  readonly metadata: {
    readonly name: string;
    readonly namespace: string;
    readonly ownerReferences: readonly {
      readonly apiVersion: "v1";
      readonly kind: "Pod";
      readonly name: string;
      readonly uid: string;
      readonly controller: true;
      readonly blockOwnerDeletion: true;
    }[];
  };
  readonly stringData: { readonly bearer: string };
}

/** One placed pod, as the cluster API is given it. */
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
    readonly volumes: readonly {
      readonly name: string;
      readonly secret?: {
        readonly secretName: string;
        readonly defaultMode: number;
        readonly items: readonly {
          readonly key: string;
          readonly path: string;
        }[];
      };
      readonly emptyDir?: { readonly sizeLimit?: string };
      readonly projected?: {
        readonly defaultMode: number;
        readonly sources: readonly {
          readonly secret: {
            readonly name: string;
            readonly items: readonly {
              readonly key: string;
              readonly path: string;
            }[];
          };
        }[];
      };
    }[];
  };
}

/** What translating one placement found, a refusal being a value like every other here. */
export type KubernetesPodRequested =
  | { readonly requested: "Pod"; readonly pod: KubernetesPod }
  | { readonly requested: "Denied"; readonly reason: BlockedReason };

/**
 * The two variables the image selects its mode by. Exactly one must be set, so
 * each launcher writes its own and reserves both: a site environment naming the
 * other would place a pod that refuses before it runs anything.
 */
export const kubernetesWorkerTaskVariable = "CHUG_WORKER_TASK";
export const kubernetesSessionTaskVariable = "CHUG_SESSION_TASK";

/** Where each credential the grant named was mounted, which both pods read alike. */
export const kubernetesWorkerCredentialFilesVariable =
  "CHUG_WORKER_CREDENTIAL_FILES";

/** The writable directory a pod does its work in. */
export const kubernetesWorkerWorkspaceVariable = "CHUG_WORKER_WORKSPACE";

/** The annotation namespace every identity a launcher writes is qualified by. */
export const kubernetesAnnotationPrefix = "chuggy.internal/";

/** The object-name alphabet a namespace, a service account and a name prefix are held to. */
export const kubernetesNamePattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/u;

/** The longest name the cluster API accepts for an object. */
export const kubernetesNameCharsMax = 253;

/** How much of an object name an attempt digest takes, measured from the digest itself. */
export const kubernetesDigestChars = createHash("sha256").digest("hex").length;

export function kubernetesName(value: string, what: string): string {
  if (!kubernetesNamePattern.test(value))
    throw new RangeError(`${what} is not a Kubernetes object name`);
  return value;
}

export function kubernetesPositive(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${what} must be a positive integer`);
  return value;
}

/** The one attempt a pod and every object beside it are named for, as a digest of it. */
export function kubernetesAttemptDigest(
  partition: Partition,
  attempt: string,
): string {
  const identity = [partition.tenant, partition.project, attempt]
    .map((part) => `${String(part.length)}:${part}`)
    .join("/");
  return createHash("sha256").update(identity).digest("hex");
}

/** Refuses a prefix that leaves no room for the digest every object name carries. */
export function kubernetesPodNamePrefix(prefix: string, what: string): string {
  kubernetesName(prefix, what);
  if (
    prefix.length + "-".length + kubernetesDigestChars >
    kubernetesNameCharsMax
  )
    throw new RangeError(`${what} leaves no room for its attempt digest`);
  return prefix;
}

/**
 * Refuses an environment that names a variable the launcher writes itself. A
 * site value silently replacing the task document, the credential map or the
 * config directory is a pod told something other than what it was placed for.
 */
export function kubernetesReservedVariables(
  environment: Readonly<Record<string, string>>,
  reserved: readonly string[],
  what: string,
): void {
  for (const name of reserved)
    if (Object.hasOwn(environment, name))
      throw new RangeError(`${what} may not replace ${name}`);
}

/**
 * Refuses a deployment whose supplied cluster data cannot address a cluster, and
 * whose credential mounts would collide with each other or with the two paths
 * every pod already occupies.
 *
 * A credential gets a directory of its own because a projected volume mounts a
 * directory, so two credentials sharing one would be two volumes at one path and
 * a mount the kubelet resolves by order rather than by the configuration.
 */
export function checkedKubernetesPodSite<Site extends KubernetesPodSite>(
  site: Site,
  what: string,
): Site {
  const api = new URL(site.apiBaseUrl);
  if (api.username !== "" || api.password !== "")
    throw new RangeError("cluster API URL must carry no credentials");
  kubernetesName(site.namespace, `${what} namespace`);
  kubernetesName(site.serviceAccountName, `${what} service account`);
  if (site.tokenFile.length === 0)
    throw new RangeError("cluster token file is empty");
  const workerPlane = new URL(site.workerPlaneUrl);
  if (workerPlane.username !== "" || workerPlane.password !== "")
    throw new RangeError("worker plane URL must carry no credentials");
  if (!site.capabilityFile.startsWith("/"))
    throw new RangeError(`${what} capability file must be absolute`);
  if (!site.workspacePath.startsWith("/"))
    throw new RangeError(`${what} workspace path must be absolute`);
  const mountPaths = new Set([site.capabilityFile, site.workspacePath]);
  const credentialPaths = new Set<string>();
  for (const [credential, mount] of Object.entries(site.credentialMounts)) {
    if (credential.length === 0)
      throw new RangeError(`${what} credential name is empty`);
    kubernetesName(mount.secretName, `${what} credential ${credential} Secret`);
    if (mount.key.length === 0)
      throw new RangeError(`${what} credential ${credential} key is empty`);
    if (!isAbsolute(mount.mountPath))
      throw new RangeError(
        `${what} credential ${credential} mount path must be absolute`,
      );
    if (resolve(mount.mountPath) !== mount.mountPath)
      throw new RangeError(
        `${what} credential ${credential} mount path must be canonical`,
      );
    const directory = dirname(mount.mountPath);
    if (directory === "/")
      throw new RangeError(
        `${what} credential ${credential} mount path must have a dedicated directory`,
      );
    if (mountPaths.has(directory))
      throw new RangeError(`${what} mount path ${directory} is repeated`);
    if (credentialPaths.has(mount.mountPath))
      throw new RangeError(`${what} mount path ${mount.mountPath} is repeated`);
    credentialPaths.add(mount.mountPath);
  }
  kubernetesPositive(site.requestTimeoutSecsMax, "cluster request timeout");
  kubernetesPositive(site.unavailableRetryAfterSecs, "cluster retry interval");
  return site;
}

/** The requests and limits one container is held to, which both pods spell alike. */
export function kubernetesContainerResources(
  resources: KubernetesResourceBudget,
): KubernetesContainer["resources"] {
  return {
    requests: {
      cpu: resources.cpuRequest,
      memory: resources.memoryRequest,
      "ephemeral-storage": resources.ephemeralStorageLimit,
    },
    limits: {
      cpu: resources.cpuLimit,
      memory: resources.memoryLimit,
      "ephemeral-storage": resources.ephemeralStorageLimit,
    },
  };
}

/** What resolving a grant's named credentials against a site's mounts produced. */
export interface KubernetesCredentialSelection {
  readonly volumes: KubernetesPod["spec"]["volumes"];
  readonly mounts: KubernetesContainer["volumeMounts"];
  readonly files: Readonly<Record<string, string>>;
}

/**
 * Resolves only credentials the authority granted, refusing an unserved name.
 * Credentials sharing a directory share one projected volume, because a volume
 * mounts a directory and two volumes at one path is a mount the kubelet
 * resolves by order rather than by the configuration.
 */
export function kubernetesCredentials(
  site: KubernetesPodSite,
  authority: PolicyAuthorityGrant,
  namePrefix: string,
): KubernetesCredentialSelection | undefined {
  const directories = new Map<
    string,
    {
      readonly name: string;
      readonly sources: {
        readonly secret: {
          readonly name: string;
          readonly items: readonly {
            readonly key: string;
            readonly path: string;
          }[];
        };
      }[];
    }
  >();
  const files: Record<string, string> = {};
  for (const credential of authority.credentials) {
    const supplied = site.credentialMounts[credential];
    if (supplied === undefined) return undefined;
    const directory = dirname(supplied.mountPath);
    const selected = directories.get(directory) ?? {
      name: `${namePrefix}-credential-${String(directories.size)}`,
      sources: [],
    };
    selected.sources.push({
      secret: {
        name: supplied.secretName,
        items: [{ key: supplied.key, path: basename(supplied.mountPath) }],
      },
    });
    directories.set(directory, selected);
    files[credential] = supplied.mountPath;
  }
  return {
    volumes: [...directories.values()].map(({ name, sources }) => ({
      name,
      projected: { defaultMode: 0o400, sources },
    })),
    mounts: [...directories.entries()].map(([mountPath, { name }]) => ({
      name,
      mountPath,
      readOnly: true,
    })),
    files,
  };
}
