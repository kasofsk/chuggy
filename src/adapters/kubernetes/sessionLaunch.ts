/**
 * The Kubernetes adapter behind `SessionPlacementPort`: the request that asks a
 * cluster for a placed session's pod, the one that asks it to go away, and the
 * one that asks whether it has finished. The port is backend-neutral, so a
 * cluster fact reaches no caller: what leaves here is an opaque placement
 * identity, the three placement arms, and whether a pod ended.
 *
 * IT IS THE WORKER LAUNCHER'S SHAPE BECAUSE IT IS THE SAME CLUSTER. Reaching
 * the API, bounding the request, telling a refused document apart from an
 * unreachable one, creating a pod beside its bearer Secret and deleting the pod
 * whose Secret could not be made are all `./clusterReach.ts`'s, so the only
 * thing that differs between placing a worker and placing a session is the
 * document each renders — which is the whole claim this module makes.
 */

import type {
  SessionPlacementOutcome,
  SessionPlacementPort,
  SessionPodObserved,
} from "../../interpreter/sessionScheduler.ts";
import {
  kubernetesCancelPod,
  kubernetesPlacePod,
  kubernetesPodEnd,
  kubernetesReadPod,
} from "./clusterReach.ts";
import {
  checkedKubernetesSessionLaunchConfig,
  kubernetesSessionPodName,
  kubernetesSessionPodRequest,
  kubernetesSessionSecret,
  type KubernetesSessionLaunchConfig,
} from "./sessionPod.ts";

/** Places and cancels one bounded pod per session attempt against the supplied cluster. */
export function kubernetesSessionLaunch(
  input: KubernetesSessionLaunchConfig,
  fetcher: typeof fetch = fetch,
): SessionPlacementPort {
  const config = checkedKubernetesSessionLaunchConfig(input);
  return {
    place: async (placement): Promise<SessionPlacementOutcome> => {
      const requested = kubernetesSessionPodRequest(config, placement);
      if (requested.requested === "Denied")
        return { placed: "Denied", reason: requested.reason };
      return kubernetesPlacePod(config, fetcher, requested.pod, (podUid) =>
        kubernetesSessionSecret(config, placement, podUid),
      );
    },
    cancel: async (attempt) =>
      kubernetesCancelPod(
        config,
        fetcher,
        kubernetesSessionPodName(config, attempt.partition, attempt.attempt),
      ),

    observe: async (attempt): Promise<SessionPodObserved> => {
      const phase = kubernetesPodEnd(
        await kubernetesReadPod(
          config,
          fetcher,
          kubernetesSessionPodName(config, attempt.partition, attempt.attempt),
        ),
      );
      return phase === "Unended"
        ? { observed: "Unended" }
        : { observed: "Ended", phase };
    },
  };
}
