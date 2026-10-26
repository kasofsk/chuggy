/**
 * What a job's pod says went wrong before the job's own worker could say
 * anything, read from the status its kubelet keeps: a fault of the image the
 * job named, a fault of the site's runtime copy, a deadline the cluster stopped
 * it at, or none of them.
 *
 * A POD STOPPED AT ITS DEADLINE IS READ AS THAT FIRST. A kubelet that finds a
 * pod past its `activeDeadlineSeconds` fails the pod with the reason
 * `kubernetesDeadlineExceeded` and then kills its containers, so what any of
 * them ended in, a copy cut short included, is the kill's and not a fault of
 * its own. Only the pod's phase and reason say it, so a container killed for
 * any other cause is never read as one.
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
 * the kubelet could not make, a start that failed finding the shell the job's
 * command names, and an exit with one of `workerImageFaultStatuses` are the
 * image's; every other state, from running to a crash, another kill or a start
 * that failed for another cause, is no fault here, and the attempt's lease is
 * still what collects it.
 *
 * A PULL IS THE IMAGE'S AT ONCE ONLY WHERE NO RETRY CAN CHANGE IT. A name that
 * is not one, and a registry that answered that the image is not there or not
 * this puller's to have, are settled. Every other failure — an outage, a rate
 * limit, a host that does not resolve or answer — can pass, so it is the
 * image's only once the pod has stood for `kubernetesPullFailureDwellSecs`,
 * which is why a reading is given the time it is made at. Age settles only a
 * failed pull and never a back-off, whose message names no cause, so the text
 * a person reads says why.
 *
 * A KUBELET'S MESSAGE IS KEPT FOR A PULL AND A START, AND BOUNDED. Each is a
 * fault whose label cannot say its cause: a missing tag and a refused
 * credential are both unpullable, and a shell that is absent and one without
 * the execute bit both fail the runtime's lookup of it. The message is the
 * kubelet's own words about the image, never anything a workload wrote.
 *
 * `test/fixtures/kubernetesPods/` holds the statuses this reads, each captured
 * from a kubelet running the worker's own pod document into one fault.
 */

import { z } from "zod";
import {
  workerImageFaults,
  workerImageFaultStatuses,
  workerJobCommand,
  type WorkerImageFault,
} from "../../contract/workerEnvironment.ts";

/** The two containers a job's pod is read by: the job's own, and the one that copies the runtime it starts from. */
export interface KubernetesJobContainers {
  readonly job: string;
  readonly runtime: string;
}

/**
 * What one job's pod says of its image, of the site's runtime copy and of its
 * deadline. A message is the kubelet's, kept where it says what a label cannot.
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
  | { readonly fault: "Deadline" }
  | { readonly fault: "None" };

const millisecondsPerSecond = 1_000;

/** The longest kubelet message a fault carries. */
export const kubernetesPodMessageCharsMax = 1_024;

/**
 * How long after its creation a pod's pull may go on failing for a cause that
 * can pass before the failure is read as the image's: long enough for the
 * kubelet to have retried the pull several times as its back-off grows, and
 * well inside the attempt lease the reaper would otherwise wait out.
 */
export const kubernetesPullFailureDwellSecs = 120;

/** The reason a kubelet fails a pod with once it has run past its `activeDeadlineSeconds`. */
export const kubernetesDeadlineExceeded = "DeadlineExceeded";

/** The waiting reasons a kubelet gives a container whose image it could not pull. */
export const kubernetesPullFailures: ReadonlySet<string> = new Set([
  "ErrImagePull",
  "ImagePullBackOff",
  "InvalidImageName",
]);

/** The waiting reason for an image name the kubelet could not parse, which no pull retries. */
export const kubernetesPullNameInvalid = "InvalidImageName";

/** The waiting reason for a pull that just failed, whose message says why, unlike the back-off after it. */
export const kubernetesPullFailed = "ErrImagePull";

/**
 * The words a pull's message carries when the registry refused the image for
 * good: it is not there, or it is not this puller's to have. They are read in
 * any case, since containerd passes each registry's own wording through.
 */
export const kubernetesPullRefusalWords: readonly string[] = [
  "not found",
  "manifest unknown",
  "unauthorized",
  "denied",
  "forbidden",
];

/**
 * A refusal word standing as a word of the message, between spaces or the
 * message's ends with at most a punctuation mark after it. An image reference
 * never holds a space, so a repository, host or tag spelling one is never read
 * as the registry's answer.
 */
const kubernetesPullRefusal = new RegExp(
  `(?:^|\\s)(?:${kubernetesPullRefusalWords.join("|")})[,.;:]?(?:\\s|$)`,
  "iu",
);

/** The terminated reason a container gets when the container runtime could not start its command. */
export const kubernetesStartFailure = "StartError";

/**
 * How runc's start failure opens the error of its lookup of the job command's
 * shell, which a shell that is absent, one without the execute bit, a directory
 * and one in a directory the job's user cannot search all give.
 */
export const kubernetesShellLookupFailure = `exec: ${JSON.stringify(workerJobCommand[0])}: `;

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
  metadata: z.object({ creationTimestamp: z.string().optional() }).optional(),
  status: z
    .object({
      phase: z.string().optional(),
      reason: z.string().optional(),
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

/** Whether a failed pull is settled: a name that is not one, or a registry that refused the image. */
function kubernetesJobPullSettled(
  reason: string,
  message: string | undefined,
): boolean {
  return (
    reason === kubernetesPullNameInvalid ||
    kubernetesPullRefusal.test(message ?? "")
  );
}

/** The image's fault in the job container's state, or nothing where the state names none yet. */
function kubernetesJobFault(
  state: KubernetesContainerState,
  pulledSecs: number | undefined,
): KubernetesPodFault | undefined {
  const waiting = state?.waiting;
  if (
    waiting?.reason !== undefined &&
    kubernetesPullFailures.has(waiting.reason)
  )
    return kubernetesJobPullSettled(waiting.reason, waiting.message) ||
      (waiting.reason === kubernetesPullFailed &&
        pulledSecs !== undefined &&
        pulledSecs >= kubernetesPullFailureDwellSecs)
      ? {
          fault: "Image",
          image: "ImageUnpullable",
          ...kubernetesPodMessage(waiting.message),
        }
      : undefined;
  const terminated = state?.terminated;
  if (terminated === undefined) return undefined;
  if (terminated.reason === kubernetesStartFailure)
    return terminated.message?.includes(kubernetesShellLookupFailure) === true
      ? {
          fault: "Image",
          image: "ImageLacksShell",
          ...kubernetesPodMessage(terminated.message),
        }
      : undefined;
  const image = kubernetesStatusFault(terminated.exitCode);
  return image === undefined ? undefined : { fault: "Image", image };
}

/** How long the pod has stood at `nowEpochMs`, or nothing where its document gives no creation time. */
function kubernetesPodAgeSecs(
  creationTimestamp: string | undefined,
  nowEpochMs: number,
): number | undefined {
  const created =
    creationTimestamp === undefined
      ? Number.NaN
      : Date.parse(creationTimestamp);
  return Number.isNaN(created)
    ? undefined
    : (nowEpochMs - created) / millisecondsPerSecond;
}

/**
 * What one pod document says at `nowEpochMs` of its deadline, its job's image
 * and its runtime copy: the deadline first, because the kill it orders ends
 * every container, and the copy before the job, because the job waits on it.
 */
export function kubernetesPodFault(
  pod: unknown,
  containers: KubernetesJobContainers,
  nowEpochMs: number,
): KubernetesPodFault {
  const parsed = kubernetesPodStatusSchema.safeParse(pod);
  if (!parsed.success) return { fault: "None" };
  const status = parsed.data.status;
  if (
    status?.phase === "Failed" &&
    status.reason === kubernetesDeadlineExceeded
  )
    return { fault: "Deadline" };
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
      kubernetesPodAgeSecs(parsed.data.metadata?.creationTimestamp, nowEpochMs),
    ) ?? { fault: "None" }
  );
}
