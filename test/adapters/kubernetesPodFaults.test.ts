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
 * still running and a copy that failed must each be no image fault at all, the
 * copy's own failure must never be read as the job's, and a pull that failed
 * for a cause that can pass must be nothing until the pod has pulled for the
 * dwell.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  kubernetesPodFault,
  kubernetesPodMessageCharsMax,
  kubernetesPullFailureDwellSecs,
  kubernetesPullFailures,
  type KubernetesPodFault,
} from "../../src/adapters/kubernetes/podFaults.ts";
import { kubernetesWorkerContainerName } from "../../src/adapters/kubernetes/workerPod.ts";
import { kubernetesRuntimeContainerName } from "../../src/adapters/kubernetes/workerRuntime.ts";
import {
  workerImageFaults,
  workerImageFaultStatuses,
} from "../../src/contract/workerEnvironment.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";

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

/** When one captured pod was created, which is what a pull's dwell is counted from. */
function createdEpochMs(name: string): number {
  const pod = captured(name) as {
    readonly metadata: { readonly creationTimestamp: string };
  };
  return Date.parse(pod.metadata.creationTimestamp);
}

/** What one captured pod reads as `afterSecs` past its creation. */
function capturedFault(name: string, afterSecs = 0): KubernetesPodFault {
  return kubernetesPodFault(
    captured(name),
    containers,
    createdEpochMs(name) + afterSecs * 1_000,
  );
}

/** What one captured pod reads as, with a kubelet's message reduced to whether it was kept. */
function readCaptured(name: string, afterSecs = 0): unknown {
  const fault = capturedFault(name, afterSecs);
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

test("an image whose /bin/sh the runtime could not find or execute reads as lacking a shell, keeping the start failure's words", () => {
  for (const [name, said] of [
    ["lacks-shell", "no such file or directory"],
    ["shell-unexecutable", "permission denied"],
  ] as const) {
    const fault = capturedFault(name);
    assert.ok(
      fault.fault === "Image" && fault.image === "ImageLacksShell",
      name,
    );
    assert.ok(fault.message?.includes(said), name);
  }
});

/**
 * A /bin/sh that is not a program this node runs, from a text file to a build
 * for another architecture, starts and then exits with a status no contract
 * names, which nothing in the status tells apart from a workload's own exit.
 */
test("a /bin/sh this node cannot execute is an ordinary exit, and no fault", () => {
  for (const name of ["shell-unrunnable", "shell-other-architecture"]) {
    const pod = captured(name) as {
      readonly status: {
        readonly containerStatuses: readonly {
          readonly state: {
            readonly terminated?: { readonly reason: string };
          };
        }[];
      };
    };
    assert.equal(
      pod.status.containerStatuses[0]?.state.terminated?.reason,
      "Error",
      name,
    );
    assert.deepEqual(readCaptured(name), { fault: "None" }, name);
  }
});

/** Pulls a registry refused for good, each as a real registry worded it. */
const pullsRefused = [
  "invalid-image-name",
  "pull-missing-digest",
  "pull-missing-tag",
  "pull-missing-repository",
  "pull-missing-repository-ghcr",
  "pull-missing-repository-quay",
  "pull-private",
];

/** Pulls that failed for a cause that can pass. */
const pullsPassing = [
  "pull-unavailable",
  "pull-rate-limited",
  "pull-no-such-host",
  "pull-refused",
  "pull-timeout",
];

/** Back-offs after a failed pull, whose message names no cause, of a cause that can pass and of one that cannot. */
const pullsBackedOff = [
  "pull-unavailable-backoff",
  "pull-missing-digest-backoff",
];

test("a pull the registry refused, or a name that is not one, is unpullable the moment it is seen", () => {
  for (const name of pullsRefused) {
    assert.deepEqual(
      readCaptured(name),
      { fault: "Image", image: "ImageUnpullable", message: true },
      name,
    );
  }
  const fault = capturedFault("pull-missing-digest");
  assert.ok(fault.fault === "Image" && fault.message?.includes("not found"));
});

test("a pull that can still succeed is nothing until the pod is as old as the dwell, and unpullable from then", () => {
  for (const name of pullsPassing) {
    assert.deepEqual(
      readCaptured(name, kubernetesPullFailureDwellSecs - 1),
      { fault: "None" },
      name,
    );
    assert.deepEqual(
      readCaptured(name, kubernetesPullFailureDwellSecs),
      { fault: "Image", image: "ImageUnpullable", message: true },
      name,
    );
  }
});

/** The kubelet's first wait before it pulls an image again, doubled after each failure. */
const kubeletPullBackOffFirstSecs = 10;

test("a back-off is nothing however old its pod, so the text a person reads waits for a pull that says why", () => {
  for (const name of pullsBackedOff) {
    for (const afterSecs of [0, kubernetesPullFailureDwellSecs, 1_000_000]) {
      assert.deepEqual(
        readCaptured(name, afterSecs),
        { fault: "None" },
        `${name} at ${String(afterSecs)}`,
      );
    }
  }
});

test("the pull dwell outlasts the kubelet's first few retries of a pull", () => {
  let retried = 0;
  let next = kubeletPullBackOffFirstSecs;
  for (
    let wait = kubeletPullBackOffFirstSecs;
    next <= kubernetesPullFailureDwellSecs;
  ) {
    retried += 1;
    wait *= 2;
    next += wait;
  }
  assert.ok(retried >= 3, `the kubelet retries ${String(retried)} times`);
});

test("the pull dwell answers well inside the lease an unstarted attempt would otherwise wait out", () => {
  assert.ok(
    kubernetesPullFailureDwellSecs * 2 <=
      executionSchedulerDefaults.attemptLeaseSecs,
  );
});

test("a runtime copy that failed or could not be pulled is the site's, never the image's", () => {
  assert.deepEqual(readCaptured("runtime-copy-failed"), {
    fault: "Runtime",
    reason: "Error",
    exitCode: 1,
  });
  for (const name of ["runtime-pull-failed", "runtime-pull-backoff"]) {
    const fault = capturedFault(name);
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

/** A pod whose two read containers are in the states a case names, created when it says if it says. */
function podWith(
  runtime: unknown,
  job: unknown,
  creationTimestamp?: string,
): unknown {
  return {
    ...(creationTimestamp === undefined
      ? {}
      : { metadata: { creationTimestamp } }),
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
        0,
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
        0,
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
    0,
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
    0,
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
  assert.deepEqual(kubernetesPodFault(swapped, containers, 0), {
    fault: "None",
  });
});

test("a kubelet's message is kept to its bound, counted in characters", () => {
  const long = "\u00e9".repeat(kubernetesPodMessageCharsMax + 7);
  const fault = kubernetesPodFault(
    podWith(copied, {
      waiting: { reason: "ErrImagePull", message: `not found: ${long}` },
    }),
    containers,
    0,
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
    assert.deepEqual(kubernetesPodFault(document, containers, 0), {
      fault: "None",
    } satisfies KubernetesPodFault);
  }
});

/** What a job container failing its pull with `message` reads as, `afterSecs` past a pod creation that `created` names or the pod does not. */
function pullRead(
  message: string,
  afterSecs: number,
  created = true,
): KubernetesPodFault {
  const creationTimestamp = "2026-10-15T08:00:00Z";
  return kubernetesPodFault(
    podWith(
      copied,
      { waiting: { reason: "ErrImagePull", message } },
      created ? creationTimestamp : undefined,
    ),
    containers,
    Date.parse(creationTimestamp) + afterSecs * 1_000,
  );
}

test("a registry's refusal is read from its words in any case, and nothing else settles a pull", () => {
  for (const message of [
    "docker.io/library/alpine:gone: not found",
    "manifest unknown: manifest unknown",
    "unexpected status: 401 UNAUTHORIZED",
    "pull access denied, repository does not exist",
    "failed to fetch anonymous token: 403 Forbidden",
  ]) {
    assert.equal(pullRead(message, 0).fault, "Image", message);
  }
  for (const message of [
    "unexpected status: 503 Service Unavailable",
    "unexpected status: 429 Too Many Requests",
    "toomanyrequests: You have reached your unauthenticated pull rate limit.",
    "dial tcp: lookup registry.invalid: no such host",
    "dial tcp 10.0.0.1:443: connect: connection refused",
    "dial tcp 10.255.255.1:443: i/o timeout",
    "context deadline exceeded",
    "",
  ]) {
    assert.deepEqual(pullRead(message, 0), { fault: "None" }, message);
  }
});

test("a refusal word spelled inside an image reference is never read as the registry's answer", () => {
  for (const message of [
    'failed to pull and unpack image "ghcr.io/acme/forbidden-city:1": 503 Service Unavailable',
    'failed to resolve reference "denied:5000/app:1": denied:5000/app:1: connection refused',
    "docker.io/library/alpine:unauthorized: i/o timeout",
    'Back-off pulling image "registry.invalid/not/found:1"',
  ]) {
    assert.deepEqual(pullRead(message, 0), { fault: "None" }, message);
  }
});

test("a pod with no creation time never ages a passing pull into a fault, and a refusal still settles", () => {
  const ages = [kubernetesPullFailureDwellSecs, 1_000_000];
  for (const afterSecs of ages) {
    assert.deepEqual(pullRead("503 Service Unavailable", afterSecs, false), {
      fault: "None",
    });
  }
  assert.equal(pullRead("not found", 0, false).fault, "Image");
});

test("a start that failed for any cause but the shell's lookup is no fault", () => {
  for (const message of [
    'failed to create containerd task: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: error mounting "proc" to rootfs at "/proc": permission denied',
    "failed to create containerd task: failed to create shim task: OCI runtime create failed: runc create failed: unable to apply cgroup configuration: cannot enter cgroupv2",
    "failed to create containerd task: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error loading seccomp filter into kernel: invalid argument",
    "exec /bin/sh: operation not permitted",
    "",
  ]) {
    assert.deepEqual(
      kubernetesPodFault(
        podWith(copied, {
          terminated: { exitCode: 128, reason: "StartError", message },
        }),
        containers,
        0,
      ),
      { fault: "None" },
      message,
    );
  }
});
