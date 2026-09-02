/**
 * How this deployment reaches its cluster: one bounded request, the two object
 * collections it creates in, the placement flow a pod and its bearer Secret
 * share, and what each answer means for the attempt it was made for.
 *
 * EVERY REACH IS BOUNDED AND EVERY OUTCOME IS A VALUE. One request carries one
 * deadline, nothing retries in place — a withdrawn attempt is a durable row and
 * the pass above decides when to try again — and a cluster that refuses, that
 * cannot be reached, or that answers something this module does not recognise
 * is an arm of the placement outcome rather than a raised failure.
 *
 * THE TWO INABILITIES PART AT THE STATUS LINE, AND AN ANSWER THIS MODULE DOES
 * NOT RECOGNISE IS A HOLD. Only a refusal of the submitted document itself —
 * malformed, too large, a media type the API does not take, or one it validated
 * and rejected — is the site declining to run this contract. A forbidden answer
 * is not: one status line cannot tell an exhausted quota, a terminating
 * namespace or a service account short of the create verb apart from an
 * admission refusal, and every one of those but the last resolves without
 * anyone touching the durable row. So every other answer describes the
 * cluster's own state at this moment and holds.
 *
 * A CREDENTIAL IS READ PER ACT AND NEVER HELD. The token file is what the site
 * carries, so a rotated token is picked up without a restart and no credential
 * is ever an argument, a diagnostic or a stored value; a token that cannot be
 * read is a hold like an unreachable cluster.
 *
 * A POD IS CREATED BEFORE ITS SECRET BECAUSE THE SECRET IS OWNED BY THE POD.
 * The owner reference needs the pod's uid, which only the created pod has, so
 * the order is forced; a placement whose Secret could not be made deletes the
 * pod it created, because a pod with no bearer can reach nothing and would
 * otherwise sit until its deadline.
 *
 * NOTHING HERE IS THE CAPACITY LEDGER. A pod that exists under the name an
 * attempt derives is that attempt's placement, which makes a repeated request
 * idempotent, and what may run at all is the durable allocation this module
 * never reads.
 */

import { readFile } from "node:fs/promises";

import type { AttemptPlacementOutcome } from "../../interpreter/executionScheduler.ts";
import {
  asPlacementId,
  type PlacementId,
} from "../../interpreter/schedulerIdentity.ts";
import type {
  KubernetesPod,
  KubernetesPodSite,
  KubernetesSecret,
} from "./kubernetesSite.ts";

/** How many milliseconds a configured second is, so one deadline is spelled once. */
const millisecondsPerSecond = 1_000;

/** What one reach of the cluster API found, an outage never reading as an answer. */
export type KubernetesReached =
  | {
      readonly reached: "Status";
      readonly status: number;
      readonly body: string;
    }
  | { readonly reached: "Unreachable" };

/** One request this adapter makes, the caller's signal beside the deadline it always has. */
export interface KubernetesReach {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

/** The collection every pod of this deployment is created in and deleted from. */
export function kubernetesPodsPath(site: KubernetesPodSite): string {
  return `/api/v1/namespaces/${site.namespace}/pods`;
}

export function kubernetesSecretsPath(site: KubernetesPodSite): string {
  return `/api/v1/namespaces/${site.namespace}/secrets`;
}

/** Reaches the cluster API once, under the caller's signal and this deployment's deadline. */
export async function kubernetesReach(
  site: KubernetesPodSite,
  fetcher: typeof fetch,
  reach: KubernetesReach,
): Promise<KubernetesReached> {
  const deadline = AbortSignal.timeout(
    site.requestTimeoutSecsMax * millisecondsPerSecond,
  );
  const signal =
    reach.signal === undefined
      ? deadline
      : AbortSignal.any([reach.signal, deadline]);
  try {
    const token = (await readFile(site.tokenFile, "utf8")).trim();
    const response = await fetcher(new URL(reach.path, site.apiBaseUrl), {
      method: reach.method,
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(reach.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(reach.body === undefined ? {} : { body: reach.body }),
    });
    return {
      reached: "Status",
      status: response.status,
      body: await response.text(),
    };
  } catch {
    return { reached: "Unreachable" };
  }
}

export function kubernetesSecretMatches(
  reached: KubernetesReached,
  expected: KubernetesSecret,
): boolean {
  if (reached.reached !== "Status" || reached.status !== 200) return false;
  try {
    const document = JSON.parse(reached.body) as {
      readonly apiVersion?: unknown;
      readonly kind?: unknown;
      readonly immutable?: unknown;
      readonly metadata?: {
        readonly name?: unknown;
        readonly namespace?: unknown;
        readonly ownerReferences?: unknown;
      };
      readonly data?: { readonly bearer?: unknown };
    };
    return (
      document.apiVersion === expected.apiVersion &&
      document.kind === expected.kind &&
      document.immutable === true &&
      document.metadata?.name === expected.metadata.name &&
      document.metadata.namespace === expected.metadata.namespace &&
      JSON.stringify(document.metadata.ownerReferences) ===
        JSON.stringify(expected.metadata.ownerReferences) &&
      document.data !== undefined &&
      Object.keys(document.data).length === 1 &&
      document.data.bearer ===
        Buffer.from(expected.stringData.bearer).toString("base64")
    );
  } catch {
    return false;
  }
}

export async function kubernetesEnsureSecret(
  site: KubernetesPodSite,
  fetcher: typeof fetch,
  secret: KubernetesSecret,
): Promise<KubernetesReached> {
  const created = await kubernetesReach(site, fetcher, {
    method: "POST",
    path: kubernetesSecretsPath(site),
    body: JSON.stringify(secret),
  });
  if (created.reached !== "Status" || created.status !== 409) return created;
  const existing = await kubernetesReach(site, fetcher, {
    method: "GET",
    path: `${kubernetesSecretsPath(site)}/${encodeURIComponent(secret.metadata.name)}`,
  });
  return kubernetesSecretMatches(existing, secret)
    ? { reached: "Status", status: 200, body: "" }
    : { reached: "Unreachable" };
}

export function kubernetesPodUid(
  reached: KubernetesReached,
  expected: {
    readonly metadata: {
      readonly name: string;
      readonly namespace: string;
      readonly annotations: Readonly<Record<string, string>>;
    };
  },
): string | undefined {
  if (
    reached.reached !== "Status" ||
    (reached.status !== 200 && reached.status !== 201)
  )
    return undefined;
  try {
    const document = JSON.parse(reached.body) as {
      readonly metadata?: {
        readonly uid?: unknown;
        readonly name?: unknown;
        readonly namespace?: unknown;
        readonly annotations?: Readonly<Record<string, unknown>>;
      };
    };
    const metadata = document.metadata;
    if (
      typeof metadata?.uid !== "string" ||
      metadata.uid.length === 0 ||
      metadata.name !== expected.metadata.name ||
      metadata.namespace !== expected.metadata.namespace ||
      Object.entries(expected.metadata.annotations).some(
        ([name, value]) => metadata.annotations?.[name] !== value,
      )
    )
      return undefined;
    return metadata.uid;
  } catch {
    return undefined;
  }
}

export async function kubernetesCreatePod(
  site: KubernetesPodSite,
  fetcher: typeof fetch,
  pod: KubernetesPod,
): Promise<KubernetesReached> {
  const created = await kubernetesReach(site, fetcher, {
    method: "POST",
    path: kubernetesPodsPath(site),
    body: JSON.stringify(pod),
  });
  if (created.reached !== "Status" || created.status !== 409) return created;
  return kubernetesReach(site, fetcher, {
    method: "GET",
    path: `${kubernetesPodsPath(site)}/${encodeURIComponent(pod.metadata.name)}`,
  });
}

/** Deletes one named pod, which is what both cancellation and a failed placement do. */
export async function kubernetesDeletePod(
  site: KubernetesPodSite,
  fetcher: typeof fetch,
  name: string,
): Promise<KubernetesReached> {
  return kubernetesReach(site, fetcher, {
    method: "DELETE",
    path: `${kubernetesPodsPath(site)}/${encodeURIComponent(name)}`,
  });
}

/** The answers that refuse the submitted document itself rather than describe the cluster. */
export const kubernetesManifestRefusals: ReadonlySet<number> = new Set([
  400, 413, 415, 422,
]);

/** What one create answer means for the attempt it was made for. */
export function kubernetesPlaced(
  site: KubernetesPodSite,
  reached: KubernetesReached,
  placement: PlacementId,
): AttemptPlacementOutcome {
  const held: AttemptPlacementOutcome = {
    placed: "Unavailable",
    retryAfterSeconds: site.unavailableRetryAfterSecs,
  };
  if (reached.reached === "Unreachable") return held;
  if (
    reached.status === 200 ||
    reached.status === 201 ||
    reached.status === 409
  )
    return { placed: "Placed", placement };
  return kubernetesManifestRefusals.has(reached.status)
    ? { placed: "Denied", reason: "ExecutionPolicyDenied" }
    : held;
}

/**
 * Creates one pod and the pod-owned Secret its bearer is projected from, and
 * deletes the pod where the Secret could not be made — the whole of what
 * placing anything against this cluster is, whichever kind of pod it is.
 */
export async function kubernetesPlacePod(
  site: KubernetesPodSite,
  fetcher: typeof fetch,
  pod: KubernetesPod,
  secretFor: (podUid: string) => KubernetesSecret,
): Promise<AttemptPlacementOutcome> {
  const placement = asPlacementId(pod.metadata.name);
  const reached = await kubernetesCreatePod(site, fetcher, pod);
  const outcome = kubernetesPlaced(site, reached, placement);
  if (outcome.placed !== "Placed") return outcome;
  const podUid = kubernetesPodUid(reached, pod);
  let failed: AttemptPlacementOutcome = {
    placed: "Unavailable",
    retryAfterSeconds: site.unavailableRetryAfterSecs,
  };
  if (podUid !== undefined) {
    const secret = await kubernetesEnsureSecret(
      site,
      fetcher,
      secretFor(podUid),
    );
    const secretOutcome = kubernetesPlaced(site, secret, placement);
    if (secretOutcome.placed === "Placed") return secretOutcome;
    failed = secretOutcome;
  }
  await kubernetesDeletePod(site, fetcher, pod.metadata.name);
  return failed;
}

/**
 * Cancels one named pod. A pod that is gone and a pod that has just been asked
 * to go are the same answer, because the caller's question is whether the
 * cluster still holds one.
 */
export async function kubernetesCancelPod(
  site: KubernetesPodSite,
  fetcher: typeof fetch,
  name: string,
): Promise<
  { readonly cancelled: "Accepted" } | { readonly cancelled: "Unavailable" }
> {
  const deleted = await kubernetesDeletePod(site, fetcher, name);
  return deleted.reached === "Status" &&
    (deleted.status === 404 || (deleted.status >= 200 && deleted.status < 300))
    ? { cancelled: "Accepted" }
    : { cancelled: "Unavailable" };
}
