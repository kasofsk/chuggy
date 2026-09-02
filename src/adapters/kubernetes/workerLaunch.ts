/**
 * The Kubernetes adapter behind `AttemptPlacementPort`: the one request that
 * asks a cluster for a scheduled attempt's pod, the one that asks it to go
 * away, and the readiness probe that says whether either could be attempted at
 * all. The port is backend-neutral, so a cluster fact reaches no caller: what
 * leaves here is an opaque placement identity and the three placement arms.
 *
 * WHAT IS LEFT HERE IS WHAT MAKES A WORKER A WORKER. Reaching the cluster,
 * bounding the request, telling a refused document apart from an unreachable
 * API and creating a pod beside its bearer Secret are `./clusterReach.ts`'s,
 * because a session pod needs every one of them and needs them to behave the
 * same way. This module renders the worker's own document and hands it over.
 */

import type {
  AttemptPlacementOutcome,
  AttemptPlacementPort,
} from "../../interpreter/executionScheduler.ts";
import {
  runtimePreconditionAnswer,
  type RuntimePrecondition,
} from "../../interpreter/serviceRuntime.ts";
import {
  kubernetesCancelPod,
  kubernetesPlacePod,
  kubernetesReach,
} from "./clusterReach.ts";
import {
  checkedKubernetesWorkerLaunchConfig,
  kubernetesWorkerPodName,
  kubernetesWorkerPodRequest,
  kubernetesWorkerSecret,
  type KubernetesWorkerLaunchConfig,
} from "./workerPod.ts";

/** Places and cancels one bounded pod per attempt against the supplied cluster. */
export function kubernetesWorkerLaunch(
  input: KubernetesWorkerLaunchConfig,
  fetcher: typeof fetch = fetch,
): AttemptPlacementPort {
  const config = checkedKubernetesWorkerLaunchConfig(input);
  return {
    place: async (placement): Promise<AttemptPlacementOutcome> => {
      const requested = kubernetesWorkerPodRequest(config, placement);
      if (requested.requested === "Denied")
        return { placed: "Denied", reason: requested.reason };
      return kubernetesPlacePod(config, fetcher, requested.pod, (podUid) =>
        kubernetesWorkerSecret(config, placement, podUid),
      );
    },
    cancel: async (attempt) =>
      kubernetesCancelPod(
        config,
        fetcher,
        kubernetesWorkerPodName(config, attempt.partition, attempt.attempt),
      ),
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
      if (reached.reached === "Unreachable") {
        return {
          met: "Undecided",
          why: `the cluster did not answer for ${config.namespace}, so whether it admits this deployment is unknown`,
        };
      }
      return runtimePreconditionAnswer(
        reached.status === 200,
        `the namespace ${config.namespace} answered ${String(reached.status)} to this deployment's credential`,
      );
    },
  };
}
