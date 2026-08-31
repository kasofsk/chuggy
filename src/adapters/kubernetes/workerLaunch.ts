/**
 * The Kubernetes adapter behind `AttemptPlacementPort`: the one request that
 * asks a cluster for a scheduled attempt's pod, the one that asks it to go
 * away, and the readiness probe that says whether either could be attempted at
 * all. The port is backend-neutral, so a cluster fact reaches no caller: what
 * leaves here is an opaque placement identity and the three placement arms.
 *
 * EVERY REACH IS BOUNDED AND EVERY OUTCOME IS A VALUE. One request carries one
 * deadline, nothing retries in place — a withdrawn attempt is a durable row and
 * the pass above decides when to try again — and a cluster that refuses, that
 * cannot be reached, or that answers something this adapter does not recognise
 * is an arm of `AttemptPlacementOutcome` rather than a raised failure.
 *
 * THE TWO INABILITIES PART AT THE STATUS LINE, AND AN ANSWER THIS ADAPTER DOES
 * NOT RECOGNISE IS A HOLD. Only a refusal of the submitted document itself —
 * malformed, too large, a media type the API does not take, or one it
 * validated and rejected — is the site declining to run this contract. A
 * forbidden answer is not: one status line cannot tell an exhausted quota, a
 * terminating namespace or a service account short of the create verb apart
 * from an admission refusal, and every one of those but the last resolves
 * without anyone touching the ticket. So every other answer describes the
 * cluster's own state at this moment and holds, and an execution is retired to
 * an operator only where no later attempt could place it either.
 *
 * A CREDENTIAL IS READ PER ACT AND NEVER HELD. The token file is what the
 * configuration carries, so a rotated token is picked up without a restart and
 * no credential is ever an argument, a diagnostic or a stored value; a token
 * that cannot be read is a hold like an unreachable cluster.
 *
 * NOTHING HERE IS THE CAPACITY LEDGER. A pod that exists under the name an
 * attempt derives is that attempt's placement, which makes a repeated request
 * idempotent, and what may run at all is the durable allocation this adapter
 * never reads.
 */

import { readFile } from "node:fs/promises";

import type {
  AttemptPlacementOutcome,
  AttemptPlacementPort,
} from "../../interpreter/executionScheduler.ts";
import { asPlacementId } from "../../interpreter/schedulerIdentity.ts";
import type { PlacementId } from "../../interpreter/schedulerIdentity.ts";
import {
  runtimePreconditionAnswer,
  type RuntimePrecondition,
} from "../../interpreter/serviceRuntime.ts";
import {
  checkedKubernetesWorkerLaunchConfig,
  kubernetesWorkerPodName,
  kubernetesWorkerPodRequest,
  kubernetesWorkerSecret,
  type KubernetesWorkerLaunchConfig,
} from "./workerPod.ts";

/** How many milliseconds a configured second is, so one deadline is spelled once. */
const millisecondsPerSecond = 1_000;

/** What one reach of the cluster API found, an outage never reading as an answer. */
type KubernetesReached =
  | {
      readonly reached: "Status";
      readonly status: number;
      readonly body: string;
    }
  | { readonly reached: "Unreachable" };

/** One request this adapter makes, the caller's signal beside the deadline it always has. */
interface KubernetesReach {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

/** The collection every worker pod of this deployment is created in and deleted from. */
function kubernetesPodsPath(config: KubernetesWorkerLaunchConfig): string {
  return `/api/v1/namespaces/${config.namespace}/pods`;
}

function kubernetesSecretsPath(config: KubernetesWorkerLaunchConfig): string {
  return `/api/v1/namespaces/${config.namespace}/secrets`;
}

/** Reaches the cluster API once, under the caller's signal and this deployment's deadline. */
async function kubernetesReach(
  config: KubernetesWorkerLaunchConfig,
  fetcher: typeof fetch,
  reach: KubernetesReach,
): Promise<KubernetesReached> {
  const deadline = AbortSignal.timeout(
    config.requestTimeoutSecsMax * millisecondsPerSecond,
  );
  const signal =
    reach.signal === undefined
      ? deadline
      : AbortSignal.any([reach.signal, deadline]);
  try {
    const token = (await readFile(config.tokenFile, "utf8")).trim();
    const response = await fetcher(new URL(reach.path, config.apiBaseUrl), {
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

function kubernetesSecretMatches(
  reached: KubernetesReached,
  expected: ReturnType<typeof kubernetesWorkerSecret>,
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

async function kubernetesEnsureSecret(
  config: KubernetesWorkerLaunchConfig,
  fetcher: typeof fetch,
  placement: Parameters<AttemptPlacementPort["place"]>[0],
  podUid: string,
): Promise<KubernetesReached> {
  const secret = kubernetesWorkerSecret(config, placement, podUid);
  const created = await kubernetesReach(config, fetcher, {
    method: "POST",
    path: kubernetesSecretsPath(config),
    body: JSON.stringify(secret),
  });
  if (created.reached !== "Status" || created.status !== 409) return created;
  const existing = await kubernetesReach(config, fetcher, {
    method: "GET",
    path: `${kubernetesSecretsPath(config)}/${encodeURIComponent(secret.metadata.name)}`,
  });
  return kubernetesSecretMatches(existing, secret)
    ? { reached: "Status", status: 200, body: "" }
    : { reached: "Unreachable" };
}

function kubernetesPodUid(
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

async function kubernetesCreatePod(
  config: KubernetesWorkerLaunchConfig,
  fetcher: typeof fetch,
  pod: ReturnType<typeof kubernetesWorkerPodRequest> & {
    readonly requested: "Pod";
  },
): Promise<KubernetesReached> {
  const created = await kubernetesReach(config, fetcher, {
    method: "POST",
    path: kubernetesPodsPath(config),
    body: JSON.stringify(pod.pod),
  });
  if (created.reached !== "Status" || created.status !== 409) return created;
  return kubernetesReach(config, fetcher, {
    method: "GET",
    path: `${kubernetesPodsPath(config)}/${encodeURIComponent(pod.pod.metadata.name)}`,
  });
}

/** The answers that refuse the submitted document itself rather than describe the cluster. */
const kubernetesManifestRefusals: ReadonlySet<number> = new Set([
  400, 413, 415, 422,
]);

/** What one create answer means for the attempt it was made for. */
function kubernetesPlaced(
  config: KubernetesWorkerLaunchConfig,
  reached: KubernetesReached,
  placement: PlacementId,
): AttemptPlacementOutcome {
  const held: AttemptPlacementOutcome = {
    placed: "Unavailable",
    retryAfterSeconds: config.unavailableRetryAfterSecs,
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

/** Places and cancels one bounded pod per attempt against the supplied cluster. */
export function kubernetesWorkerLaunch(
  input: KubernetesWorkerLaunchConfig,
  fetcher: typeof fetch = fetch,
): AttemptPlacementPort {
  const config = checkedKubernetesWorkerLaunchConfig(input);
  return {
    place: async (placement) => {
      const requested = kubernetesWorkerPodRequest(config, placement);
      if (requested.requested === "Denied")
        return { placed: "Denied", reason: requested.reason };
      const reached = await kubernetesCreatePod(config, fetcher, requested);
      const outcome = kubernetesPlaced(
        config,
        reached,
        asPlacementId(requested.pod.metadata.name),
      );
      if (outcome.placed !== "Placed") return outcome;
      const podUid = kubernetesPodUid(reached, requested.pod);
      let failed: AttemptPlacementOutcome = {
        placed: "Unavailable",
        retryAfterSeconds: config.unavailableRetryAfterSecs,
      };
      if (podUid !== undefined) {
        const secret = await kubernetesEnsureSecret(
          config,
          fetcher,
          placement,
          podUid,
        );
        const secretOutcome = kubernetesPlaced(
          config,
          secret,
          asPlacementId(requested.pod.metadata.name),
        );
        if (secretOutcome.placed === "Placed") return secretOutcome;
        failed = secretOutcome;
      }
      await kubernetesReach(config, fetcher, {
        method: "DELETE",
        path: `${kubernetesPodsPath(config)}/${encodeURIComponent(requested.pod.metadata.name)}`,
      });
      return failed;
    },
    cancel: async (attempt) => {
      const name = kubernetesWorkerPodName(
        config,
        attempt.partition,
        attempt.attempt,
      );
      const deleted = await kubernetesReach(config, fetcher, {
        method: "DELETE",
        path: `${kubernetesPodsPath(config)}/${encodeURIComponent(name)}`,
      });
      return deleted.reached === "Status" &&
        (deleted.status === 404 ||
          (deleted.status >= 200 && deleted.status < 300))
        ? { cancelled: "Accepted" }
        : { cancelled: "Unavailable" };
    },
  };
}

/** Requires the supplied namespace to answer this deployment's credential before readiness. */
export function kubernetesNamespacePrecondition(
  input: KubernetesWorkerLaunchConfig,
  fetcher: typeof fetch = fetch,
): RuntimePrecondition {
  const config = checkedKubernetesWorkerLaunchConfig(input);
  return {
    name: "cluster-namespace-reachable",
    check: async (signal) => {
      const reached = await kubernetesReach(config, fetcher, {
        method: "GET",
        path: `/api/v1/namespaces/${config.namespace}`,
        signal,
      });
      return runtimePreconditionAnswer(
        reached.reached === "Status" && reached.status === 200,
        `the namespace ${config.namespace} did not answer this deployment's credential: ${reached.reached}`,
      );
    },
  };
}
