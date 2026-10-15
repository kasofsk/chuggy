/**
 * What the cluster backend says of a worker whose pod met a fault the worker
 * itself could not report: the observation the scheduler acts on, and the
 * error text the backend stores in the worker's place.
 *
 * THE TEXT IS THE BACKEND'S, ONE FIXED TEXT PER FAULT. A person reading why
 * their job never ran is told what the image lacks in this backend's words,
 * and for a pull or a start the kubelet's own message after it, because only
 * the kubelet knows which of the fault's causes it was. Nothing the workload
 * wrote is ever relayed.
 *
 * IT IS STORED WHERE THE WORKER WOULD HAVE STORED IT, UNDER THE WORKER'S OWN
 * BEARER. A worker that never started wrote nothing, so the backend that placed
 * it reads the bearer back from the Secret it made for the pod and uploads the
 * text through the worker plane's own artifact route, as a pool does for a job
 * of its own; the plane is what reserves and stores it, and this side holds no
 * store. The Secret goes with its pod, so the text is written before the pod is
 * cancelled, and a text that could not be written is an answer rather than a
 * raised failure, because the block it explains does not wait on it.
 */

import { workerErrorPath } from "../../contract/http.ts";
import {
  workerContractHeader,
  workerContractRelease,
} from "../../contract/workerContract.ts";
import type { WorkerImageFault } from "../../contract/workerEnvironment.ts";
import {
  workerPlaneBytesMediaType,
  workerPlaneRoutes,
} from "../../contract/workerPlane.ts";
import type {
  AttemptErrorWritten,
  AttemptWorkloadObserved,
} from "../../interpreter/executionScheduler.ts";
import {
  kubernetesDeadline,
  kubernetesObjectRead,
  kubernetesSecretValue,
  type KubernetesReached,
} from "./clusterReach.ts";
import type { KubernetesPodSite } from "./kubernetesSite.ts";
import {
  kubernetesPodFault,
  type KubernetesJobContainers,
} from "./podFaults.ts";

/** What the cluster tells the person whose job's image it could not run, one text per fault. */
export const kubernetesImageFaultTexts = {
  ImageUnpullable: "The cluster could not pull the image this job names.",
  ImageLacksShell:
    "The image this job names has no executable /bin/sh, so the cluster could not start chuggy's check of the image.",
  ImageLibcUnsupported:
    "The image this job names cannot load chuggy's runtime, which needs the image's glibc and libstdc++.",
  ImageLacksGit: "The image this job names has no git on its PATH.",
  ImageHomeUnwritable:
    "The image this job names gives the job's user no HOME it can write.",
  ImageWorkspaceUnwritable:
    "The image this job names leaves the job's user unable to write its workspace.",
  ImageTmpUnwritable:
    "The image this job names gives the job's user no temporary directory it can write.",
} as const satisfies Readonly<Record<WorkerImageFault, string>>;

/** The text one fault is told by, the kubelet's message after it where the fault carried one. */
export function kubernetesImageFaultText(
  fault: WorkerImageFault,
  message: string | undefined,
): string {
  const text = kubernetesImageFaultTexts[fault];
  return message === undefined ? text : `${text}\nThe cluster said: ${message}`;
}

/** What one read of a job's pod, made at `nowEpochMs`, means for its attempt, a site's fault named by the pod it failed. */
export function kubernetesWorkloadObserved(
  pod: string,
  reached: KubernetesReached,
  containers: KubernetesJobContainers,
  nowEpochMs: number,
): AttemptWorkloadObserved {
  const found = kubernetesPodFault(
    kubernetesObjectRead(reached),
    containers,
    nowEpochMs,
  );
  switch (found.fault) {
    case "None":
      return { observed: "Unfaulted" };
    case "Image":
      return {
        observed: "ImageFault",
        fault: found.image,
        text: kubernetesImageFaultText(found.image, found.message),
      };
    case "Runtime": {
      const exit =
        found.exitCode === undefined
          ? ""
          : ` with status ${String(found.exitCode)}`;
      const said = found.message === undefined ? "" : `: ${found.message}`;
      return {
        observed: "SiteFault",
        why: `pod ${pod}: the runtime copy ${containers.runtime} ended ${found.reason}${exit}${said}`,
      };
    }
  }
}

/**
 * Uploads one attempt's error text to the worker plane under the bearer its
 * pod was given, read back from the Secret named `secret` under `key`.
 */
export async function kubernetesWorkerErrorWritten(
  site: KubernetesPodSite,
  fetcher: typeof fetch,
  bearer: { readonly secret: string; readonly key: string },
  text: string,
): Promise<AttemptErrorWritten> {
  const token = await kubernetesSecretValue(
    site,
    fetcher,
    bearer.secret,
    bearer.key,
  );
  if (token === undefined || token.length === 0)
    return {
      written: "Unwritten",
      why: `the bearer Secret ${bearer.secret} could not be read`,
    };
  try {
    const response = await fetcher(
      new URL(
        workerPlaneRoutes.artifact.path.replace("*", workerErrorPath),
        site.workerPlaneUrl,
      ),
      {
        method: workerPlaneRoutes.artifact.method,
        signal: kubernetesDeadline(site),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": workerPlaneBytesMediaType,
          [workerContractHeader]: workerContractRelease,
        },
        body: new TextEncoder().encode(text),
      },
    );
    await response.arrayBuffer();
    return response.status === 204
      ? { written: "Written" }
      : {
          written: "Unwritten",
          why: `the worker plane answered ${String(response.status)}`,
        };
  } catch {
    return {
      written: "Unwritten",
      why: "the worker plane could not be reached",
    };
  }
}
