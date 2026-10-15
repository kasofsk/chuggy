/**
 * How a job's pod runs chuggy's runtime whatever image the job names: the
 * runtime image's tree is copied into a volume of the pod's own, the job's
 * container mounts it read-only at `workerRuntimeDirectory`, and starts
 * through `workerJobCommand` in place of its image's entrypoint. A pushed
 * worker's pod and a pool's workload are both jobs, so the two inject one
 * runtime one way.
 *
 * THE COPY RUNS FIRST AND TO COMPLETION. It is a plain init container, listed
 * ahead of a site's sidecars, so the cluster starts nothing else until the
 * tree is whole, and a copy that fails fails the pod before its job starts.
 *
 * IT COPIES THE TREE AS A DIRECTORY, NOT ITS CONTENTS. The volume's root is
 * the cluster's, and a copy running as the site's unprivileged user can write
 * into it but cannot set its times; `cp -a` copying the tree's contents onto
 * that root fails on exactly that, where copying the directory itself makes a
 * directory the copy owns. The job mounts that directory alone, as a sub-path.
 *
 * THE JOB CANNOT WRITE WHAT RUNS IT. Its mount is read-only, so no file of the
 * runtime changes under it, whatever the job's image, checks or agent do.
 *
 * NOTHING HERE CHOOSES A RUNTIME. Which image the tree is copied from is the
 * caller's: the site's own for a pushed worker, and the assignment's for a
 * pool. The copy runs under the site's container security context, as every
 * container of the pod does, and asks for a budget of its own small enough
 * that the pod's request, which is the larger of it and what follows it, does
 * not grow.
 */

import { basename } from "node:path";

import {
  workerJobCommand,
  workerRuntimeDirectory,
} from "../../contract/workerEnvironment.ts";
import {
  kubernetesContainerResources,
  type KubernetesContainer,
  type KubernetesPod,
  type KubernetesPodSite,
  type KubernetesResourceBudget,
} from "./kubernetesSite.ts";

/** The init container that copies the runtime, which no site's sidecar may also be named. */
export const kubernetesRuntimeContainerName = "chuggy-runtime";

/** The volume the runtime is copied into, under a name no other volume of a job's pod carries. */
const kubernetesRuntimeVolumeName = "chuggy-runtime";

/** Where the copying container mounts that volume, apart from the tree it copies from. */
const kubernetesRuntimeCopyDirectory = "/var/run/chuggy/runtime";

/** The directory the copy makes inside the volume, which is the tree's own name. */
const kubernetesRuntimeTree = basename(workerRuntimeDirectory);

/** What copying the tree is held to: one process writing into the pod's volume rather than its own layer. */
const kubernetesRuntimeCopyResources: KubernetesResourceBudget = {
  cpuRequest: "100m",
  cpuLimit: "1",
  memoryRequest: "64Mi",
  memoryLimit: "512Mi",
  ephemeralStorageLimit: "64Mi",
};

/** One job's pod as its launcher renders it: the sidecars it starts first, its one container and every volume. */
export interface KubernetesJobPod {
  readonly initContainers: readonly KubernetesContainer[];
  readonly container: KubernetesContainer;
  readonly volumes: KubernetesPod["spec"]["volumes"];
}

/**
 * Refuses a site that mounts anything of its own at or under the runtime's
 * directory. Two mounts at one path are a pod the cluster refuses, and one
 * inside the read-only runtime is a container that cannot start.
 */
export function checkedKubernetesRuntimeSite(
  site: KubernetesPodSite,
  what: string,
): void {
  for (const path of [
    site.capabilityFile,
    site.workspacePath,
    ...Object.values(site.credentialMounts).map(({ mountPath }) => mountPath),
  ])
    if (
      path === workerRuntimeDirectory ||
      path.startsWith(`${workerRuntimeDirectory}/`)
    )
      throw new RangeError(
        `${what} mount path ${path} is inside ${workerRuntimeDirectory}, where the runtime is mounted`,
      );
}

/** The plain init container that copies the runtime image's tree into the pod's volume. */
function kubernetesJobRuntimeCopy(
  site: KubernetesPodSite,
  image: string,
): KubernetesContainer {
  return {
    name: kubernetesRuntimeContainerName,
    image,
    command: [
      "cp",
      "-a",
      workerRuntimeDirectory,
      `${kubernetesRuntimeCopyDirectory}/`,
    ],
    env: [],
    resources: kubernetesContainerResources(kubernetesRuntimeCopyResources),
    securityContext: site.containerSecurityContext,
    volumeMounts: [
      {
        name: kubernetesRuntimeVolumeName,
        mountPath: kubernetesRuntimeCopyDirectory,
        readOnly: false,
      },
    ],
  };
}

/**
 * `job` started from the runtime `image` carries: the copy ahead of its
 * sidecars, its container running the contract's command over the read-only
 * tree, and the volume between them bounded by `storageLimit`. A container
 * naming a command or arguments of its own is refused rather than overridden.
 */
export function kubernetesJobRuntime(
  site: KubernetesPodSite,
  image: string,
  storageLimit: string,
  job: KubernetesJobPod,
): KubernetesJobPod {
  const { name, image: jobImage, ...started } = job.container;
  if (started.command !== undefined || started.args !== undefined)
    throw new RangeError(
      `job container ${name} names its own command, which the runtime's would replace`,
    );
  return {
    initContainers: [
      kubernetesJobRuntimeCopy(site, image),
      ...job.initContainers,
    ],
    container: {
      name,
      image: jobImage,
      command: workerJobCommand,
      ...started,
      volumeMounts: [
        ...started.volumeMounts,
        {
          name: kubernetesRuntimeVolumeName,
          mountPath: workerRuntimeDirectory,
          subPath: kubernetesRuntimeTree,
          readOnly: true,
        },
      ],
    },
    volumes: [
      ...job.volumes,
      {
        name: kubernetesRuntimeVolumeName,
        emptyDir: { sizeLimit: storageLimit },
      },
    ],
  };
}
