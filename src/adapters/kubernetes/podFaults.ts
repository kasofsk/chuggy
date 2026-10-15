/**
 * What a job's pod says went wrong before the job's own worker could say
 * anything, read from the status its kubelet keeps: a fault of the image the
 * job named, a fault of the site's runtime copy, or neither.
 *
 * ONLY THE JOB'S OWN CONTAINER SPEAKS FOR ITS IMAGE. The runtime is copied in
 * the site's image ahead of the job's container, and a job container that has
 * not started is waiting on that copy, so a copy that failed or could not be
 * pulled is the site's fault whatever the job named. The two are read from two
 * lists by name, the copy from the init containers and the job from the
 * containers, and the copy is read first, so no status of the copy can be read
 * as the job's.
 *
 * A STATUS NAMES AN IMAGE FAULT ONLY WHERE THE CONTRACT SAYS IT DOES. A pull
 * the kubelet could not make, a start the container runtime could not make,
 * and an exit with one of `workerImageFaultStatuses` are the image's; every
 * other state, from running to a crash or a kill, is no fault here, and the
 * attempt's lease is still what collects it.
 *
 * A KUBELET'S MESSAGE IS KEPT ONLY FOR A PULL, AND BOUNDED. A pull is the one
 * fault whose cause its label cannot say, since a missing tag, a refused
 * credential and a registry that does not answer all read alike, and the
 * message is the kubelet's own words about the image, never anything a
 * workload wrote.
 *
 * `test/fixtures/kubernetesPods/` holds the statuses this reads, each captured
 * from a kubelet running the worker's own pod document into one fault.
 */

import { z } from "zod";

import {
  workerImageFaults,
  workerImageFaultStatuses,
  type WorkerImageFault,
} from "../../contract/workerEnvironment.ts";

/** The two containers a job's pod is read by: the job's own, and the one that copies the runtime it starts from. */
export interface KubernetesJobContainers {
  readonly job: string;
  readonly runtime: string;
}

/**
 * What one job's pod says of its image and of the site's runtime copy. A
 * message is the kubelet's, kept where it says what a label cannot.
 */
export type KubernetesPodFault =
  | {
      readonly fault: "Image";
      readonly image: WorkerImageFault;
      readonly message?: string;
    }
  | {
      readonly fault: "Runtime";
      readonly reason: string;
      readonly exitCode?: number;
      readonly message?: string;
    }
  | { readonly fault: "None" };

/** The longest kubelet message a fault carries. */
export const kubernetesPodMessageCharsMax = 1_024;

/** The waiting reasons a kubelet gives a container whose image it could not pull. */
export const kubernetesPullFailures: ReadonlySet<string> = new Set([
  "ErrImagePull",
  "ImagePullBackOff",
  "InvalidImageName",
]);

/** The terminated reason a container gets when the container runtime could not start its command. */
export const kubernetesStartFailure = "StartError";

const kubernetesContainerStatusSchema = z.object({
  name: z.string(),
  state: z
    .object({
      waiting: z
        .object({
          reason: z.string().optional(),
          message: z.string().optional(),
        })
        .optional(),
      terminated: z
        .object({
          exitCode: z.number().int(),
          reason: z.string().optional(),
          message: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

type KubernetesContainerState = z.infer<
  typeof kubernetesContainerStatusSchema
>["state"];

/** The part of a pod document this reads, every other field left to the cluster. */
const kubernetesPodStatusSchema = z.object({
  status: z
    .object({
      initContainerStatuses: z
        .array(kubernetesContainerStatusSchema)
        .optional(),
      containerStatuses: z.array(kubernetesContainerStatusSchema).optional(),
    })
    .optional(),
});

/** A kubelet's message cut to the bound, or nothing where it gave none. */
function kubernetesPodMessage(message: string | undefined): {
  readonly message?: string;
} {
  if (message === undefined || message.length === 0) return {};
  return {
    message: Array.from(message)
      .slice(0, kubernetesPodMessageCharsMax)
      .join(""),
  };
}

/** The fault the runtime's check exits with this status for, read from the contract and never restated. */
function kubernetesStatusFault(exitCode: number): WorkerImageFault | undefined {
  const statuses: Readonly<Partial<Record<WorkerImageFault, number>>> =
    workerImageFaultStatuses;
  return workerImageFaults.find((fault) => statuses[fault] === exitCode);
}

/** The site's fault in the runtime copy's state, or nothing where the copy is still going or finished whole. */
function kubernetesRuntimeFault(
  state: KubernetesContainerState,
): KubernetesPodFault | undefined {
  const waiting = state?.waiting?.reason;
  if (waiting !== undefined && kubernetesPullFailures.has(waiting))
    return {
      fault: "Runtime",
      reason: waiting,
      ...kubernetesPodMessage(state?.waiting?.message),
    };
  const terminated = state?.terminated;
  if (terminated === undefined || terminated.exitCode === 0) return undefined;
  return {
    fault: "Runtime",
    reason: terminated.reason ?? "Terminated",
    exitCode: terminated.exitCode,
    ...kubernetesPodMessage(terminated.message),
  };
}

/** The image's fault in the job container's state, or nothing where the state names none. */
function kubernetesJobFault(
  state: KubernetesContainerState,
): KubernetesPodFault | undefined {
  const waiting = state?.waiting?.reason;
  if (waiting !== undefined && kubernetesPullFailures.has(waiting))
    return {
      fault: "Image",
      image: "ImageUnpullable",
      ...kubernetesPodMessage(state?.waiting?.message),
    };
  const terminated = state?.terminated;
  if (terminated === undefined) return undefined;
  if (terminated.reason === kubernetesStartFailure)
    return { fault: "Image", image: "ImageLacksShell" };
  const image = kubernetesStatusFault(terminated.exitCode);
  return image === undefined ? undefined : { fault: "Image", image };
}

/** What one pod document says of its job's image and of its runtime copy, the copy read first because the job waits on it. */
export function kubernetesPodFault(
  pod: unknown,
  containers: KubernetesJobContainers,
): KubernetesPodFault {
  const parsed = kubernetesPodStatusSchema.safeParse(pod);
  if (!parsed.success) return { fault: "None" };
  const status = parsed.data.status;
  const runtime = kubernetesRuntimeFault(
    status?.initContainerStatuses?.find(
      (container) => container.name === containers.runtime,
    )?.state,
  );
  if (runtime !== undefined) return runtime;
  return (
    kubernetesJobFault(
      status?.containerStatuses?.find(
        (container) => container.name === containers.job,
      )?.state,
    ) ?? { fault: "None" }
  );
}
