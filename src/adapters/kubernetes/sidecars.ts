/**
 * The containers a site runs beside a worker, as native sidecars of the pod
 * that runs it: a pushed worker's pod and a pool's workload alike, so the two
 * render one site's sidecars one way.
 *
 * NOTHING HERE KNOWS WHAT A SIDECAR RUNS. Its image, arguments, environment,
 * startup probe, budget and scratch space all arrive as the site's data, so a
 * site that runs a server beside its workers, or anything else, says so in its
 * deployment rather than in this module. The worker is told nothing of one: a
 * site whose worker must reach a sidecar names the address in the worker's own
 * environment.
 *
 * A SIDECAR STARTS BEFORE THE WORKER AND ENDS WITH IT. Each is an init
 * container that restarts, which the cluster starts ahead of the pod's own
 * containers and stops once they have exited; the worker container is not
 * started until a sidecar's startup probe, where it names one, has passed.
 */

import {
  kubernetesContainerResources,
  kubernetesDnsLabel,
  kubernetesPositive,
  type KubernetesContainer,
  type KubernetesPod,
  type KubernetesPodSite,
  type KubernetesResourceBudget,
  type KubernetesStartupProbe,
} from "./kubernetesSite.ts";

/** One container a site runs beside every worker it places. */
export interface KubernetesSidecar {
  readonly name: string;
  readonly image: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly startupProbe?: KubernetesStartupProbe;
  readonly resources: KubernetesResourceBudget;
  /** An empty directory only this sidecar mounts, bounded by its own storage budget and gone with the pod. */
  readonly scratch?: { readonly mountPath: string };
}

/**
 * The volume one sidecar's scratch space is, under a prefix no other volume of
 * either pod carries, so sidecars with distinct names cannot collide with
 * each other or with anything else.
 */
function kubernetesSidecarVolumeName(sidecar: KubernetesSidecar): string {
  return `sidecar-${sidecar.name}`;
}

/**
 * Refuses a sidecar the cluster would not place beside the worker, or whose
 * probe it would time by its own defaults: a zero period or threshold is read
 * as the cluster's default rather than refused.
 */
export function checkedKubernetesSidecars(
  sidecars: readonly KubernetesSidecar[],
  workerContainerName: string,
  what: string,
): readonly KubernetesSidecar[] {
  const names = new Set<string>();
  for (const sidecar of sidecars) {
    const named = `${what} sidecar ${sidecar.name}`;
    kubernetesDnsLabel(sidecar.name, named);
    if (sidecar.name === workerContainerName)
      throw new RangeError(`${named} is named like the worker's own container`);
    if (names.has(sidecar.name))
      throw new RangeError(`${named} is named twice`);
    names.add(sidecar.name);
    if (sidecar.image.length === 0)
      throw new RangeError(`${named} image is empty`);
    if (sidecar.startupProbe !== undefined) {
      kubernetesPositive(
        sidecar.startupProbe.periodSeconds,
        `${named} probe period`,
      );
      kubernetesPositive(
        sidecar.startupProbe.failureThreshold,
        `${named} probe failure threshold`,
      );
    }
    if (sidecar.scratch !== undefined)
      kubernetesDnsLabel(
        kubernetesSidecarVolumeName(sidecar),
        `${named} scratch volume`,
      );
  }
  return sidecars;
}

/** Each sidecar as the container that runs it, which a pod lists among its init containers. */
export function kubernetesSidecarContainers(
  site: KubernetesPodSite,
  sidecars: readonly KubernetesSidecar[],
): readonly KubernetesContainer[] {
  return sidecars.map((sidecar): KubernetesContainer => ({
    name: sidecar.name,
    image: sidecar.image,
    ...(sidecar.args.length === 0 ? {} : { args: sidecar.args }),
    restartPolicy: "Always",
    ...(sidecar.startupProbe === undefined
      ? {}
      : { startupProbe: sidecar.startupProbe }),
    env: Object.entries(sidecar.environment).map(([name, value]) => ({
      name,
      value,
    })),
    resources: kubernetesContainerResources(sidecar.resources),
    securityContext: site.containerSecurityContext,
    volumeMounts:
      sidecar.scratch === undefined
        ? []
        : [
            {
              name: kubernetesSidecarVolumeName(sidecar),
              mountPath: sidecar.scratch.mountPath,
              readOnly: false,
            },
          ],
  }));
}

/** Each sidecar's scratch space, bounded by the storage its own budget names. */
export function kubernetesSidecarVolumes(
  sidecars: readonly KubernetesSidecar[],
): KubernetesPod["spec"]["volumes"] {
  return sidecars.flatMap((sidecar) =>
    sidecar.scratch === undefined
      ? []
      : [
          {
            name: kubernetesSidecarVolumeName(sidecar),
            emptyDir: { sizeLimit: sidecar.resources.ephemeralStorageLimit },
          },
        ],
  );
}
