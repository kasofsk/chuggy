/**
 * The adapter behind `WorkerLaunchPort`: the one request that asks a cluster
 * for a scheduled attempt's pod, the one that asks it to go away, and the
 * readiness probe that says whether either could be attempted at all.
 *
 * EVERY REACH IS BOUNDED AND EVERY OUTCOME IS A VALUE. One request carries one
 * deadline, nothing retries in place — a withdrawn attempt is a durable row and
 * the pass above decides when to try again — and a cluster that refuses, that
 * cannot be reached, or that answers something this adapter does not recognise
 * is an arm of `WorkerPlaced` rather than a raised failure.
 *
 * THE TWO INABILITIES PART AT THE STATUS LINE. An unauthenticated answer, a
 * throttled one and a server failure are holds, because each of them describes
 * the cluster's own state at this moment; every other refusal is the site
 * declining to run this contract — an admission webhook, a quota, a rejected
 * manifest — and is definitive, so it retires the execution where an operator
 * can see it rather than holding a ticket silently forever.
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
  WorkerLaunchPort,
  WorkerPlaced,
} from "../../interpreter/executionScheduler.ts";
import { asWorkloadId } from "../../interpreter/schedulerIdentity.ts";
import type { WorkloadId } from "../../interpreter/schedulerIdentity.ts";
import type { RuntimePrecondition } from "../../interpreter/serviceRuntime.ts";
import {
  checkedKubernetesWorkerLaunchConfig,
  kubernetesWorkerPodName,
  kubernetesWorkerPodRequest,
  type KubernetesWorkerLaunchConfig,
} from "./workerPod.ts";

/** How many milliseconds a configured second is, so one deadline is spelled once. */
const millisecondsPerSecond = 1_000;

/** What one reach of the cluster API found, an outage never reading as an answer. */
type KubernetesReached =
  | { readonly reached: "Status"; readonly status: number }
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
    return { reached: "Status", status: response.status };
  } catch {
    return { reached: "Unreachable" };
  }
}

/** The unauthenticated, throttled and failing answers, which are the cluster's own state. */
function kubernetesHeld(status: number): boolean {
  return status === 401 || status === 429 || status >= 500;
}

/** What one create answer means for the attempt it was made for. */
function kubernetesPlaced(
  config: KubernetesWorkerLaunchConfig,
  reached: KubernetesReached,
  workload: WorkloadId,
): WorkerPlaced {
  if (reached.reached === "Unreachable" || kubernetesHeld(reached.status))
    return {
      placed: "Unavailable",
      retryAfterSeconds: config.unavailableRetryAfterSecs,
    };
  if (
    reached.status === 200 ||
    reached.status === 201 ||
    reached.status === 409
  )
    return { placed: "Placed", workload };
  return { placed: "Denied", reason: "ExecutionPolicyDenied" };
}

/** Places and deletes one bounded pod per attempt against the supplied cluster. */
export function kubernetesWorkerLaunch(
  input: KubernetesWorkerLaunchConfig,
  fetcher: typeof fetch = fetch,
): WorkerLaunchPort {
  const config = checkedKubernetesWorkerLaunchConfig(input);
  return {
    place: async (placement) => {
      const requested = kubernetesWorkerPodRequest(config, placement);
      if (requested.requested === "Denied")
        return { placed: "Denied", reason: requested.reason };
      const reached = await kubernetesReach(config, fetcher, {
        method: "POST",
        path: kubernetesPodsPath(config),
        body: JSON.stringify(requested.pod),
      });
      return kubernetesPlaced(
        config,
        reached,
        asWorkloadId(requested.pod.metadata.name),
      );
    },
    delete: async (partition, attempt) => {
      const name = kubernetesWorkerPodName(config, partition, attempt);
      await kubernetesReach(config, fetcher, {
        method: "DELETE",
        path: `${kubernetesPodsPath(config)}/${encodeURIComponent(name)}`,
      });
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
      return reached.reached === "Status" && reached.status === 200;
    },
  };
}
