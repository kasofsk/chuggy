/**
 * What a job's pod status says of its image and of the site's runtime copy, at
 * the lowest tier that can say it: one pure reading of one document.
 *
 * THE DOCUMENTS ARE A KUBELET'S. Each file under `test/fixtures/kubernetesPods/`
 * is a status a k3s kubelet, the version the rig runs, reported for the worker's
 * own pod document run into one fault, with the spec cut to its containers'
 * names and images; the status is kept whole, so a reading that holds here
 * holds against what a cluster actually says.
 *
 * THE NEGATIVE SPACE IS THE OTHER HALF. A crash, a kill, a clean exit, a job
 * still running and a copy that failed must each be no image fault at all, and
 * the copy's own failure must never be read as the job's.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  kubernetesPodFault,
  kubernetesPodMessageCharsMax,
  kubernetesPullFailures,
  type KubernetesPodFault,
} from "../../src/adapters/kubernetes/podFaults.ts";
import { kubernetesWorkerContainerName } from "../../src/adapters/kubernetes/workerPod.ts";
import { kubernetesRuntimeContainerName } from "../../src/adapters/kubernetes/workerRuntime.ts";
import {
  workerImageFaults,
  workerImageFaultStatuses,
} from "../../src/contract/workerEnvironment.ts";

const containers = {
  job: kubernetesWorkerContainerName,
  runtime: kubernetesRuntimeContainerName,
};

/** One captured pod document, by its fixture's name. */
function captured(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/kubernetesPods/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

/** What one captured pod reads as, with a kubelet's message reduced to whether it was kept. */
function readCaptured(name: string): unknown {
  const fault = kubernetesPodFault(captured(name), containers);
  return "message" in fault
    ? { ...fault, message: fault.message !== undefined }
    : fault;
}

test("each status a check exits with reads as the fault the contract gives it", () => {
  for (const [name, image] of [
    ["libc-unsupported", "ImageLibcUnsupported"],
    ["lacks-git", "ImageLacksGit"],
    ["home-unwritable", "ImageHomeUnwritable"],
    ["workspace-unwritable", "ImageWorkspaceUnwritable"],
    ["tmp-unwritable", "ImageTmpUnwritable"],
  ] as const) {
    assert.deepEqual(readCaptured(name), { fault: "Image", image }, name);
  }
});

test("a job that ended while a sidecar still runs is read by its own container, not the pod's phase", () => {
  const pod = captured("lacks-git-beside-sidecar") as {
    readonly status: { readonly phase: string };
  };
  assert.equal(pod.status.phase, "Running");
  assert.deepEqual(readCaptured("lacks-git-beside-sidecar"), {
    fault: "Image",
    image: "ImageLacksGit",
  });
});

test("an image with no shell reads as lacking one, from the start failure the runtime reports", () => {
  assert.deepEqual(readCaptured("lacks-shell"), {
    fault: "Image",
    image: "ImageLacksShell",
  });
});

test("every pull the kubelet could not make reads as unpullable, keeping its message", () => {
  for (const name of ["pull-failed", "pull-backoff", "invalid-image-name"]) {
    assert.deepEqual(
      readCaptured(name),
      { fault: "Image", image: "ImageUnpullable", message: true },
      name,
    );
  }
  const fault = kubernetesPodFault(captured("pull-failed"), containers);
  assert.ok(fault.fault === "Image" && fault.message?.includes("not found"));
});

test("a runtime copy that failed or could not be pulled is the site's, never the image's", () => {
  assert.deepEqual(readCaptured("runtime-copy-failed"), {
    fault: "Runtime",
    reason: "Error",
    exitCode: 1,
  });
  for (const name of ["runtime-pull-failed", "runtime-pull-backoff"]) {
    const fault = kubernetesPodFault(captured(name), containers);
    assert.equal(fault.fault, "Runtime", name);
    assert.ok(
      fault.fault === "Runtime" && kubernetesPullFailures.has(fault.reason),
      name,
    );
  }
});

test("a clean exit, a crash, a kill, a running job and a pending pod are no fault", () => {
  for (const name of [
    "succeeded",
    "runtime-incomplete",
    "oom-killed",
    "running",
    "pending",
  ]) {
    assert.deepEqual(readCaptured(name), { fault: "None" }, name);
  }
});

/** A pod whose two read containers are in the states a case names, everything else absent. */
function podWith(runtime: unknown, job: unknown): unknown {
  return {
    status: {
      initContainerStatuses: [
        { name: kubernetesRuntimeContainerName, state: runtime },
        { name: "postgres", state: { waiting: { reason: "PodInitializing" } } },
      ],
      containerStatuses: [{ name: kubernetesWorkerContainerName, state: job }],
    },
  };
}

const copied = { terminated: { exitCode: 0, reason: "Completed" } };

test("each contract status reads as its fault and no other status reads as any", () => {
  const statuses: Readonly<Partial<Record<string, number>>> =
    workerImageFaultStatuses;
  for (const image of workerImageFaults) {
    const status = statuses[image];
    if (status === undefined) continue;
    assert.deepEqual(
      kubernetesPodFault(
        podWith(copied, { terminated: { exitCode: status, reason: "Error" } }),
        containers,
      ),
      { fault: "Image", image },
    );
  }
  const named: ReadonlySet<number> = new Set(
    Object.values(workerImageFaultStatuses),
  );
  for (let status = 0; status < 256; status += 1) {
    if (named.has(status)) continue;
    assert.deepEqual(
      kubernetesPodFault(
        podWith(copied, { terminated: { exitCode: status, reason: "Error" } }),
        containers,
      ),
      { fault: "None" },
      String(status),
    );
  }
});

test("a copy that exits with an image fault's status is still the site's", () => {
  const fault = kubernetesPodFault(
    podWith(
      { terminated: { exitCode: workerImageFaultStatuses.ImageLacksGit } },
      { waiting: { reason: "PodInitializing" } },
    ),
    containers,
  );
  assert.equal(fault.fault, "Runtime");
});

test("a failed copy outranks whatever the job's container shows", () => {
  const fault = kubernetesPodFault(
    podWith(
      { waiting: { reason: "ImagePullBackOff", message: "Back-off" } },
      { waiting: { reason: "ErrImagePull", message: "not found" } },
    ),
    containers,
  );
  assert.deepEqual(fault, {
    fault: "Runtime",
    reason: "ImagePullBackOff",
    message: "Back-off",
  });
});

test("a job's statuses are read under its own name and a copy's under its own", () => {
  const swapped = {
    status: {
      initContainerStatuses: [
        {
          name: kubernetesWorkerContainerName,
          state: {
            terminated: { exitCode: workerImageFaultStatuses.ImageLacksGit },
          },
        },
      ],
      containerStatuses: [
        {
          name: kubernetesRuntimeContainerName,
          state: { waiting: { reason: "ErrImagePull" } },
        },
      ],
    },
  };
  assert.deepEqual(kubernetesPodFault(swapped, containers), { fault: "None" });
});

test("a kubelet's message is kept to its bound, counted in characters", () => {
  const long = "\u00e9".repeat(kubernetesPodMessageCharsMax + 7);
  const fault = kubernetesPodFault(
    podWith(copied, { waiting: { reason: "ErrImagePull", message: long } }),
    containers,
  );
  assert.ok(fault.fault === "Image");
  assert.equal(
    Array.from(fault.message ?? "").length,
    kubernetesPodMessageCharsMax,
  );
});

test("a document this cannot read is no fault rather than a guess", () => {
  for (const document of [
    undefined,
    null,
    "pod",
    { status: "Failed" },
    { status: { containerStatuses: "worker" } },
    { status: { containerStatuses: [{ name: 7 }] } },
  ]) {
    assert.deepEqual(kubernetesPodFault(document, containers), {
      fault: "None",
    } satisfies KubernetesPodFault);
  }
});
