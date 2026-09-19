import {
  runtimePreconditionAnswer,
  type RuntimePrecondition,
} from "../../interpreter/serviceRuntime.ts";
import { kubernetesReach } from "./clusterReach.ts";
import {
  checkedKubernetesPodSite,
  type KubernetesPodSite,
} from "./kubernetesSite.ts";

/** Requires the configured namespace to answer this deployment's credential. */
export function kubernetesNamespacePrecondition(
  input: KubernetesPodSite,
  fetcher: typeof fetch = fetch,
): RuntimePrecondition {
  const config = checkedKubernetesPodSite(input, "worker site");
  return {
    name: "cluster-namespace-reachable",
    check: async (signal) => {
      const reached = await kubernetesReach(config, fetcher, {
        method: "GET",
        path: `/api/v1/namespaces/${config.namespace}`,
        signal,
      });
      if (reached.reached === "Unreachable")
        return {
          met: "Undecided",
          why: `the cluster did not answer for ${config.namespace}, so whether it admits this deployment is unknown`,
        };
      return runtimePreconditionAnswer(
        reached.status === 200,
        `the namespace ${config.namespace} answered ${String(reached.status)} to this deployment's credential`,
      );
    },
  };
}
