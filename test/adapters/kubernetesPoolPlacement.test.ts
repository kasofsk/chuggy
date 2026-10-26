import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test, type TestContext } from "node:test";

import {
  mintedCredentialDirectory,
  workerImageFaults,
  workerJobCommand,
  workerRuntimeDirectory,
  workerTaskVariable,
  workerWorkspaceDirectory,
  workerWorkspaceVariable,
} from "../../src/contract/workerEnvironment.ts";
import { workerErrorPath } from "../../src/contract/http.ts";
import {
  workerPoolEvidenceCharsMax,
  type WorkerPoolAssignment,
} from "../../src/contract/workerPool.ts";
import {
  workerContractHeader,
  workerContractRelease,
} from "../../src/contract/workerContract.ts";
import { workerPlaneRoutes } from "../../src/contract/workerPlane.ts";
import { poolEnvelopeSchema } from "../../src/contract/workerTask.ts";
import {
  workerPoolClientPass,
  type WorkerPoolBackend,
  type WorkerPoolClient,
  type WorkerPoolPlacement,
  type WorkerPoolSettled,
} from "../../src/interpreter/workerPoolClient.ts";
import { poolJobPlaneClient } from "../../src/adapters/http/poolJobPlaneClient.ts";
import type { KubernetesPod } from "../../src/adapters/kubernetes/kubernetesSite.ts";
import {
  checkedKubernetesPoolPlacementConfig,
  kubernetesPoolAssignmentAnnotation,
  kubernetesPoolBackend,
  kubernetesPoolContainerName,
  kubernetesPoolPodName,
  type KubernetesPoolPlacementConfig,
} from "../../src/adapters/kubernetes/poolPlacement.ts";
import {
  kubernetesPodMessageCharsMax,
  kubernetesPullFailureDwellSecs,
} from "../../src/adapters/kubernetes/podFaults.ts";
import type { KubernetesSidecar } from "../../src/adapters/kubernetes/sidecars.ts";
import {
  kubernetesDeadlineText,
  kubernetesImageFaultText,
} from "../../src/adapters/kubernetes/workerFaults.ts";
import { kubernetesWorkerContainerName } from "../../src/adapters/kubernetes/workerPod.ts";

const root = mkdtempSync(join(tmpdir(), "chuggy-pool-kube-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});
const tokenFile = join(root, "token");
writeFileSync(tokenFile, "cluster-token\n");

const config: KubernetesPoolPlacementConfig = {
  apiBaseUrl: "https://cluster.invalid:6443",
  namespace: "pool",
  tokenFile,
  serviceAccountName: "pool-worker",
  nodeSelector: { "kubernetes.io/os": "linux" },
  podSecurityContext: { runAsNonRoot: true },
  containerSecurityContext: { allowPrivilegeEscalation: false },
  requestTimeoutSecsMax: 2,
  workerPlaneUrl: "https://worker-plane.invalid",
  capabilityFile: "/run/chuggy/capability",
  credentialMounts: {
    "codex-auth": {
      secretName: "codex-auth",
      key: "auth.json",
      mountPath: "/var/run/chuggy/codex/auth.json",
    },
  },
  podNamePrefix: "pool",
  image: "registry.invalid/ticket-worker:1",
  poolLabel: { name: "chuggy.internal/pool", value: "pool-one" },
  podLabels: { "app.kubernetes.io/name": "pool-worker" },
  podAnnotations: {},
  resources: {
    cpuRequest: "100m",
    cpuLimit: "1",
    memoryRequest: "128Mi",
    memoryLimit: "512Mi",
    ephemeralStorageLimit: "4Gi",
  },
  timeoutSecsMax: 1_800,
  outputBytesMax: 4_096,
  environment: { POOL_SITE: "configured" },
  capabilities: {
    "native-macos": {
      nodeSelector: { "kubernetes.io/os": "darwin" },
      tolerations: [
        { key: "chuggy/macos", operator: "Exists", effect: "NoSchedule" },
      ],
    },
  },
  providerCredential: "codex-auth",
  sidecars: [],
};

const sidecar: KubernetesSidecar = {
  name: "cache",
  image: "registry.invalid/cache:7",
  args: [],
  environment: {},
  resources: {
    cpuRequest: "100m",
    cpuLimit: "1",
    memoryRequest: "128Mi",
    memoryLimit: "512Mi",
    ephemeralStorageLimit: "1Gi",
  },
};

const assignment: WorkerPoolAssignment = {
  assignment: "assignment-one",
  capabilities: ["native-macos", "unmapped"],
  cpuMillis: 1_500,
  memoryMib: 2_048,
  deadlineSecs: 900,
  callbackUrl: "https://worker-plane.invalid/v1/ticket-execution",
  bearer: "attempt-bearer",
};

/** The address one recorded request was made to, whichever way the caller spelled it. */
function reachedUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** One request the cluster is sent, recorded rather than made. */
interface Reached {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function cluster(answers: (reached: Reached) => Response): {
  readonly reached: Reached[];
  readonly fetcher: typeof fetch;
} {
  const reached: Reached[] = [];
  return {
    reached,
    fetcher: (input, init) => {
      const url = new URL(reachedUrl(input));
      const made: Reached = {
        method: init?.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
      };
      reached.push(made);
      return Promise.resolve(answers(made));
    },
  };
}

/** The created-pod answer the placement flow needs before it writes the Secret. */
function created(name: string): Response {
  return new Response(
    JSON.stringify({
      metadata: {
        uid: "pod-uid",
        name,
        namespace: config.namespace,
        annotations: { [kubernetesPoolAssignmentAnnotation]: "assignment-one" },
      },
    }),
    { status: 201 },
  );
}

/** Places `placed` as a job on a cluster that creates every pod it is sent, answering what the backend said and what the cluster was sent. */
async function jobPlaced(
  site: KubernetesPoolPlacementConfig,
  placed: WorkerPoolAssignment = assignment,
): Promise<{
  readonly placement: WorkerPoolPlacement;
  readonly reached: readonly Reached[];
}> {
  const name = kubernetesPoolPodName(site, placed.assignment);
  const { reached, fetcher } = cluster((made) =>
    made.path.startsWith("/api/v1/namespaces/pool/pods")
      ? created(name)
      : new Response("{}", { status: 201 }),
  );
  const placement = await kubernetesPoolBackend(site, fetcher).place({
    kind: "Job",
    assignment: placed,
  });
  return { placement, reached };
}

test("a placed pod is named for its assignment and asks for the box it was offered", async () => {
  const { placement, reached } = await jobPlaced(config);
  assert.deepEqual(placement, { placed: "Placed" });
  const name = kubernetesPoolPodName(config, assignment.assignment);
  const pod = reached[0]?.body as {
    metadata: {
      name: string;
      labels: Record<string, string>;
      annotations: Record<string, string>;
    };
    spec: {
      activeDeadlineSeconds: number;
      nodeSelector: Record<string, string>;
      tolerations?: readonly unknown[];
      containers: readonly {
        resources: { requests: Record<string, string> };
        env: readonly { name: string }[];
      }[];
    };
  };
  assert.equal(pod.metadata.name, name);
  assert.equal(pod.metadata.labels["chuggy.internal/pool"], "pool-one");
  assert.equal(
    pod.metadata.annotations[kubernetesPoolAssignmentAnnotation],
    "assignment-one",
  );
  assert.equal(pod.spec.activeDeadlineSeconds, 900);
  assert.equal(pod.spec.containers[0]?.resources.requests["cpu"], "1500m");
  assert.equal(pod.spec.containers[0]?.resources.requests["memory"], "2048Mi");
  assert.equal(pod.spec.containers[0]?.env[0]?.name, workerTaskVariable);
});

/** The pod one site places for an assignment, as the cluster was asked to create it. */
async function placedPod(
  site: KubernetesPoolPlacementConfig,
  placed: WorkerPoolAssignment = assignment,
): Promise<{
  spec: {
    activeDeadlineSeconds: number;
    containers: readonly {
      image: string;
      volumeMounts: readonly {
        name: string;
        mountPath: string;
        readOnly: boolean;
      }[];
    }[];
    volumes: readonly { name: string; emptyDir?: unknown }[];
  };
}> {
  const { reached } = await jobPlaced(site, placed);
  return reached[0]?.body as Awaited<ReturnType<typeof placedPod>>;
}

test("a pod runs the image its assignment names, and the site's own where it names none", async () => {
  const image = `registry.invalid/pinned-worker@sha256:${"c".repeat(64)}`;
  assert.equal(
    (await placedPod(config, { ...assignment, image })).spec.containers[0]
      ?.image,
    image,
  );
  assert.equal(
    (await placedPod(config)).spec.containers[0]?.image,
    config.image,
  );
});

/** Catches a pool whose own bound on its workloads is enforced nowhere. */
test("a pod runs no longer than the pool's own bound where the plane would let it run longer", async () => {
  assert.equal(
    (await placedPod({ ...config, timeoutSecsMax: 30 })).spec
      .activeDeadlineSeconds,
    30,
  );
  assert.equal(
    (await placedPod(config)).spec.activeDeadlineSeconds,
    assignment.deadlineSecs,
  );
});

/**
 * A pool-placed attempt asks the plane for its forge credential as a pushed one
 * does, and the image writes what it is minted to a path only this mount makes
 * writable, and only a memory volume keeps off the node's disk.
 */
test("a pool pod mounts memory where the image writes a minted credential", async () => {
  const pod = await placedPod(config);
  const mount = pod.spec.containers[0]?.volumeMounts.find(
    ({ mountPath }) => mountPath === mintedCredentialDirectory,
  );
  assert.equal(mount?.readOnly, false);
  assert.deepEqual(
    pod.spec.volumes.find(({ name }) => name === mount?.name)?.emptyDir,
    { medium: "Memory", sizeLimit: "1Mi" },
  );
});

test("a mapped capability moves the pod and an unmapped one does not", async () => {
  const { reached } = await jobPlaced(config);
  const pod = reached[0]?.body as {
    spec: {
      nodeSelector: Record<string, string>;
      tolerations?: readonly { key: string }[];
    };
  };
  assert.deepEqual(pod.spec.nodeSelector, { "kubernetes.io/os": "darwin" });
  assert.deepEqual(
    pod.spec.tolerations?.map((held) => held.key),
    ["chuggy/macos"],
  );
});

test("the envelope carries the callback and the bearer and no material at all", async () => {
  const { reached } = await jobPlaced(config);
  const secret = reached.find((made) => made.path.includes("/secrets"))
    ?.body as {
    stringData: { task: string };
  };
  assert.deepEqual(JSON.parse(secret.stringData.task), {
    callbackUrl: assignment.callbackUrl,
    bearer: assignment.bearer,
    workspace: "/workspace",
    timeoutSecsMax: 1_800,
    outputBytesMax: 4_096,
    providerCredentialFile: "/var/run/chuggy/codex/auth.json",
  });
});

/** Catches the launcher writing a field the contract's envelope does not name. */
test("the envelope, with a provider credential and without, is one the contract names in full", async () => {
  for (const site of [config, { ...config, providerCredential: undefined }]) {
    const { reached } = await jobPlaced(site);
    const secret = reached.find((made) => made.path.includes("/secrets"))
      ?.body as { stringData: { task: string } };
    const envelope = JSON.parse(secret.stringData.task) as object;
    assert.deepEqual(poolEnvelopeSchema.strict().parse(envelope), envelope);
    assert.equal(
      Object.hasOwn(envelope, "providerCredentialFile"),
      site.providerCredential !== undefined,
    );
  }
});

test("a cluster that refused the document itself is a settled no", async () => {
  const { fetcher } = cluster(() => new Response("{}", { status: 422 }));
  const placement = await kubernetesPoolBackend(config, fetcher).place({
    kind: "Job",
    assignment: assignment,
  });
  assert.equal(placement.placed, "Refused");
});

test("a cluster that could not be reached is unavailable", async () => {
  const placement = await kubernetesPoolBackend(config, () =>
    Promise.reject(new Error("connection refused")),
  ).place({ kind: "Job", assignment: assignment });
  assert.deepEqual(placement, { placed: "Unavailable" });
});

test("what the pool holds is its own labelled pods, read off their annotation", async () => {
  const { reached, fetcher } = cluster(
    () =>
      new Response(
        JSON.stringify({
          items: [
            {
              metadata: {
                name: "pool-one",
                annotations: { [kubernetesPoolAssignmentAnnotation]: "one" },
              },
              status: { phase: "Running" },
            },
            { metadata: { name: "pool-other", annotations: {} } },
            {
              metadata: {
                name: "pool-two",
                annotations: { [kubernetesPoolAssignmentAnnotation]: "two" },
              },
              status: { phase: "Pending" },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  assert.deepEqual(await kubernetesPoolBackend(config, fetcher).held(), [
    { assignment: "one", kind: "Job" },
    { assignment: "two", kind: "Job" },
  ]);
  assert.match(
    reached[0]?.path ?? "",
    /labelSelector=chuggy.internal%2Fpool%3Dpool-one/u,
  );
});

test("a pod that has ended is not held, and is deleted so its lease lapses", async () => {
  const { reached, fetcher } = cluster((made) =>
    made.method === "GET"
      ? new Response(
          JSON.stringify({
            items: [
              {
                metadata: {
                  name: "pool-failed",
                  annotations: { [kubernetesPoolAssignmentAnnotation]: "one" },
                },
                status: { phase: "Failed" },
              },
              {
                metadata: {
                  name: "pool-succeeded",
                  annotations: { [kubernetesPoolAssignmentAnnotation]: "two" },
                },
                status: { phase: "Succeeded" },
              },
              {
                metadata: {
                  name: "pool-running",
                  annotations: {
                    [kubernetesPoolAssignmentAnnotation]: "three",
                  },
                },
                status: { phase: "Running" },
              },
            ],
          }),
          { status: 200 },
        )
      : new Response("{}", { status: 200 }),
  );
  assert.deepEqual(await kubernetesPoolBackend(config, fetcher).held(), [
    { assignment: "three", kind: "Job" },
  ]);
  assert.deepEqual(
    reached.filter((made) => made.method === "DELETE").map((made) => made.path),
    [
      "/api/v1/namespaces/pool/pods/pool-failed",
      "/api/v1/namespaces/pool/pods/pool-succeeded",
    ],
  );
});

test("a session offered is refused without the cluster being reached", async () => {
  const { reached, fetcher } = cluster(
    () => new Response("{}", { status: 201 }),
  );
  const backend = kubernetesPoolBackend(config, fetcher);
  assert.deepEqual(
    await backend.place({
      kind: "Session",
      assignment: { ...assignment, image: "registry.invalid/session:1" },
    }),
    { placed: "Refused", evidence: "this pool runs no session" },
  );
  assert.deepEqual(reached, []);
});

/**
 * One pod document a kubelet wrote, captured under `test/fixtures/kubernetesPods/`
 * for a pushed worker's pod and read here as this pool's pod carrying
 * `carried`: the job's container is the pool's, and the statuses are the
 * kubelet's as captured.
 */
function poolCaptured(name: string, carried: string): Record<string, unknown> {
  const pod = JSON.parse(
    readFileSync(
      new URL(`../fixtures/kubernetesPods/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as {
    metadata: Record<string, unknown>;
    status: { containerStatuses: { name: string }[] };
  };
  for (const container of pod.status.containerStatuses)
    if (container.name === kubernetesWorkerContainerName)
      container.name = kubernetesPoolContainerName;
  pod.metadata = {
    ...pod.metadata,
    name: `pool-${carried}`,
    annotations: { [kubernetesPoolAssignmentAnnotation]: carried },
  };
  return pod;
}

/** When one captured pod was created, which is what a pull's dwell is counted from. */
function poolCapturedAt(name: string): number {
  return Date.parse(
    String(
      (poolCaptured(name, "any") as { metadata: { creationTimestamp: string } })
        .metadata.creationTimestamp,
    ),
  );
}

/** Each assignment a backend's `ended` answered, with the fault it refused under or how it was killed. */
function poolEndedOf(
  ended: Awaited<ReturnType<WorkerPoolBackend["ended"]>>,
): readonly (readonly [string, string])[] {
  return ended.map((end) => {
    if (end.kind === "Session") return [end.session.assignment, "Session"];
    return "killed" in end
      ? [end.job.assignment, end.killed]
      : [end.assignment, end.fault];
  });
}

/** One request a refusal makes, of the cluster or of the worker plane, as it was sent. */
interface PoolReached {
  readonly method: string;
  readonly url: string;
  readonly authorization?: string;
  readonly body?: string;
}

/**
 * A cluster listing `pods` and answering each pod's Secret by `secrets`, the
 * envelope of a bearer named for the pod where it is not given, and a worker
 * plane answering every upload with `uploaded`; each request recorded.
 */
function poolFaulted(
  pods: readonly unknown[],
  secrets: ((pod: string) => Response) | undefined = undefined,
  uploaded = 204,
): { readonly reached: PoolReached[]; readonly fetcher: typeof fetch } {
  const reached: PoolReached[] = [];
  const held = secrets ?? poolEnvelopeSecret;
  return {
    reached,
    fetcher: async (input, init) => {
      const url = new URL(reachedUrl(input));
      const headers = new Headers(init?.headers);
      const authorization = headers.get("authorization") ?? undefined;
      reached.push({
        method: init?.method ?? "GET",
        url: `${url.origin}${url.pathname}`,
        ...(url.origin === "https://cluster.invalid:6443"
          ? {}
          : {
              ...(authorization === undefined ? {} : { authorization }),
              body: await new Response(init?.body).text(),
            }),
      });
      if (
        url.pathname === "/api/v1/namespaces/pool/pods" &&
        init?.method !== "DELETE"
      )
        return new Response(JSON.stringify({ items: pods }), { status: 200 });
      const secret = /\/secrets\/(?<pod>[^/]+)$/u.exec(url.pathname)?.groups?.[
        "pod"
      ];
      if (secret !== undefined) return held(secret);
      return new Response(null, {
        status: url.origin === "https://cluster.invalid:6443" ? 200 : uploaded,
      });
    },
  };
}

/** The Secret a pod's envelope is projected from, carrying a bearer named for the pod. */
function poolEnvelopeSecret(pod: string): Response {
  return new Response(
    JSON.stringify({
      data: {
        task: Buffer.from(
          JSON.stringify({
            callbackUrl: "https://callback.invalid/v1/ticket-execution",
            bearer: `bearer-${pod}`,
            workspace: "/workspace",
            timeoutSecsMax: 60,
            outputBytesMax: 4_096,
          }),
        ).toString("base64"),
      },
    }),
    { status: 200 },
  );
}

test("a pod naming a fault of its image is not held, and is refused under the fault once its text is stored, its pod kept until it is cleared", async () => {
  const lacking = poolCaptured("lacks-git", "lacking");
  const running = poolCaptured("running", "running");
  const { reached, fetcher } = poolFaulted([lacking, running]);
  const backend = kubernetesPoolBackend(config, fetcher, () =>
    poolCapturedAt("lacks-git"),
  );
  assert.deepEqual(await backend.held(), [
    { assignment: "running", kind: "Job" },
  ]);
  assert.deepEqual(
    reached.filter((made) => made.method === "DELETE"),
    [],
    "a faulted pod is ended's to refuse, not held's to delete",
  );
  reached.length = 0;
  const text = kubernetesImageFaultText("ImageLacksGit", undefined);
  assert.deepEqual(await backend.ended(), [
    {
      kind: "Job",
      assignment: "lacking",
      evidence: text,
      fault: "ImageLacksGit",
    },
  ]);
  assert.deepEqual(reached, [
    {
      method: "GET",
      url: "https://cluster.invalid:6443/api/v1/namespaces/pool/pods",
    },
    {
      method: "GET",
      url: "https://cluster.invalid:6443/api/v1/namespaces/pool/secrets/pool-lacking",
    },
    {
      method: workerPlaneRoutes.artifact.method,
      url: `https://callback.invalid${workerPlaneRoutes.artifact.path.replace("*", workerErrorPath)}`,
      authorization: "Bearer bearer-pool-lacking",
      body: text,
    },
  ]);
  reached.length = 0;
  await backend.clear("lacking");
  assert.deepEqual(reached, [
    {
      method: "DELETE",
      url: `https://cluster.invalid:6443/api/v1/namespaces/pool/pods/${kubernetesPoolPodName(config, "lacking")}`,
    },
  ]);
});

test("every fault's text, with the longest message a kubelet's is kept to, is evidence a refusal may carry", () => {
  for (const fault of workerImageFaults)
    assert.ok(
      kubernetesImageFaultText(fault, "m".repeat(kubernetesPodMessageCharsMax))
        .length <= workerPoolEvidenceCharsMax,
      fault,
    );
});

test("a pull that can still succeed is held until its pod has stood for the dwell, and refused as unpullable after", async () => {
  const pulling = poolCaptured("pull-unavailable", "pulling");
  const created = poolCapturedAt("pull-unavailable");
  const early = poolFaulted([pulling]);
  const before = kubernetesPoolBackend(config, early.fetcher, () => created);
  assert.deepEqual(await before.held(), [
    { assignment: "pulling", kind: "Job" },
  ]);
  assert.deepEqual(await before.ended(), []);
  const late = poolFaulted([pulling]);
  const after = kubernetesPoolBackend(
    config,
    late.fetcher,
    () => created + kubernetesPullFailureDwellSecs * 1_000,
  );
  assert.deepEqual(await after.held(), []);
  assert.deepEqual(poolEndedOf(await after.ended()), [
    ["pulling", "ImageUnpullable"],
  ]);
});

test("a fault of the runtime copy is no refusal, and its pod is deleted as any ended pod is", async () => {
  const { reached, fetcher } = poolFaulted([
    poolCaptured("runtime-copy-failed", "copy"),
  ]);
  const backend = kubernetesPoolBackend(config, fetcher, () =>
    poolCapturedAt("runtime-copy-failed"),
  );
  assert.deepEqual(await backend.held(), []);
  assert.deepEqual(await backend.ended(), []);
  assert.deepEqual(
    reached.filter((made) => made.method === "DELETE").map((made) => made.url),
    ["https://cluster.invalid:6443/api/v1/namespaces/pool/pods/pool-copy"],
  );
});

test("a pod the cluster stopped at its deadline is not held, and is ended as killed under the attempt its envelope names, its pod kept until it is cleared", async () => {
  for (const name of ["deadline-exceeded", "deadline-exceeded-copying"]) {
    const stopped = poolCaptured(name, "stopped");
    const running = poolCaptured("running", "running");
    const { reached, fetcher } = poolFaulted([stopped, running]);
    const backend = kubernetesPoolBackend(config, fetcher, () =>
      poolCapturedAt(name),
    );
    assert.deepEqual(
      await backend.held(),
      [{ assignment: "running", kind: "Job" }],
      name,
    );
    assert.deepEqual(
      reached.filter((made) => made.method === "DELETE"),
      [],
      `${name}: a pod stopped at its deadline is ended's, not held's to delete`,
    );
    reached.length = 0;
    assert.deepEqual(
      await backend.ended(),
      [
        {
          kind: "Job",
          job: {
            assignment: "stopped",
            callbackUrl: "https://callback.invalid/v1/ticket-execution",
            bearer: "bearer-pool-stopped",
          },
          text: kubernetesDeadlineText,
          killed: "Deadline",
        },
      ],
      name,
    );
    assert.deepEqual(
      reached,
      [
        {
          method: "GET",
          url: "https://cluster.invalid:6443/api/v1/namespaces/pool/pods",
        },
        {
          method: "GET",
          url: "https://cluster.invalid:6443/api/v1/namespaces/pool/secrets/pool-stopped",
        },
      ],
      name,
    );
    reached.length = 0;
    await backend.clear("stopped");
    assert.deepEqual(
      reached,
      [
        {
          method: "DELETE",
          url: `https://cluster.invalid:6443/api/v1/namespaces/pool/pods/${kubernetesPoolPodName(config, "stopped")}`,
        },
      ],
      name,
    );
  }
});

test("a pod that failed for any other cause is never ended as killed at its deadline", async () => {
  for (const name of ["oom-killed", "runtime-copy-failed", "succeeded"]) {
    const { fetcher } = poolFaulted([poolCaptured(name, "other")]);
    const backend = kubernetesPoolBackend(config, fetcher, () =>
      poolCapturedAt(name),
    );
    assert.deepEqual(await backend.ended(), [], name);
  }
});

/** A Secret the cluster holds under the envelope's key, carrying `text` as it was written. */
function poolSecretHolding(key: string, text: string): Response {
  return new Response(
    JSON.stringify({ data: { [key]: Buffer.from(text).toString("base64") } }),
    { status: 200 },
  );
}

/** Reads `ended` of a backend over one pod stopped at its deadline whose Secret is answered by `secret`, with what it sent and told. */
async function poolDeadlineUnread(
  t: TestContext,
  secret: () => Response,
): Promise<{
  readonly ended: Awaited<ReturnType<WorkerPoolBackend["ended"]>>;
  readonly sent: readonly string[];
  readonly lines: readonly string[];
}> {
  const { reached, fetcher } = poolFaulted(
    [poolCaptured("deadline-exceeded", "unread")],
    secret,
  );
  const backend = kubernetesPoolBackend(config, fetcher, () =>
    poolCapturedAt("deadline-exceeded"),
  );
  const written = t.mock.method(process.stderr, "write", () => true);
  const ended = await backend.ended();
  const lines = written.mock.calls.map((call) => String(call.arguments[0]));
  written.mock.restore();
  return {
    ended,
    sent: reached.map((made) => `${made.method} ${made.url}`),
    lines,
  };
}

test("a pod stopped at its deadline whose Secret holds no envelope is deleted, its attempt left to its lease, and why told", async (t) => {
  for (const [what, secret] of [
    ["no Secret", () => new Response("{}", { status: 404 })],
    ["no envelope key", () => poolSecretHolding("other", "{}")],
    ["no envelope", () => poolSecretHolding("task", "not json")],
  ] as const) {
    const { ended, sent, lines } = await poolDeadlineUnread(t, secret);
    assert.deepEqual(ended, [], what);
    assert.deepEqual(
      sent,
      [
        "GET https://cluster.invalid:6443/api/v1/namespaces/pool/pods",
        "GET https://cluster.invalid:6443/api/v1/namespaces/pool/secrets/pool-unread",
        "DELETE https://cluster.invalid:6443/api/v1/namespaces/pool/pods/pool-unread",
      ],
      what,
    );
    assert.equal(lines.length, 1, what);
    assert.match(
      lines[0] ?? "",
      /pod pool-unread passed its deadline and its Secret holds no envelope, so the pod is deleted and its attempt left to its lease/u,
      what,
    );
  }
});

test("a pod stopped at its deadline whose envelope Secret could not be read is kept for the next pass, and why told", async (t) => {
  for (const [what, secret] of [
    ["a cluster that answered 500", () => new Response("{}", { status: 500 })],
    ["a forbidden read", () => new Response("{}", { status: 403 })],
    ["a cluster that answered no document", () => new Response("null")],
    [
      "a cluster that could not be reached",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ] as const) {
    const { ended, sent, lines } = await poolDeadlineUnread(t, secret);
    assert.deepEqual(ended, [], what);
    assert.deepEqual(
      sent,
      [
        "GET https://cluster.invalid:6443/api/v1/namespaces/pool/pods",
        "GET https://cluster.invalid:6443/api/v1/namespaces/pool/secrets/pool-unread",
      ],
      what,
    );
    assert.equal(lines.length, 1, what);
    assert.match(
      lines[0] ?? "",
      /pod pool-unread passed its deadline and its envelope Secret could not be read, so the pod is kept for the next pass/u,
      what,
    );
  }
});

test("a refusal whose text could not be stored is refused all the same, its pod kept until it is cleared, and why told", async (t) => {
  const unparsed = new Response(
    JSON.stringify({
      data: { task: Buffer.from("not json").toString("base64") },
    }),
    { status: 200 },
  );
  for (const [what, secret, answered, sent, why] of [
    [
      "no Secret",
      () => new Response("{}", { status: 404 }),
      204,
      ["GET", "GET"],
      /envelope Secret pool-unwritable could not be read/u,
    ],
    [
      "no envelope",
      () => unparsed,
      204,
      ["GET", "GET"],
      /envelope Secret pool-unwritable could not be read/u,
    ],
    [
      "a Secret that could not be read",
      () => new Response("{}", { status: 500 }),
      204,
      ["GET", "GET"],
      /envelope Secret pool-unwritable could not be read/u,
    ],
    [
      "a plane that refused it",
      undefined,
      500,
      ["GET", "GET", workerPlaneRoutes.artifact.method],
      /worker plane answered 500/u,
    ],
  ] as const) {
    const { reached, fetcher } = poolFaulted(
      [poolCaptured("workspace-unwritable", "unwritable")],
      secret,
      answered,
    );
    const backend = kubernetesPoolBackend(config, fetcher, () =>
      poolCapturedAt("workspace-unwritable"),
    );
    const written = t.mock.method(process.stderr, "write", () => true);
    const ended = await backend.ended();
    const lines = written.mock.calls.map((call) => String(call.arguments[0]));
    written.mock.restore();
    assert.deepEqual(
      poolEndedOf(ended),
      [["unwritable", "ImageWorkspaceUnwritable"]],
      what,
    );
    assert.deepEqual(
      reached.map((made) => made.method),
      sent,
      what,
    );
    assert.equal(lines.length, 1, what);
    assert.match(lines[0] ?? "", why, what);
  }
});

/** What a cluster and its worker plane answer while a kept pod waits, each changed between passes by the case. */
interface PoolKeptAnswers {
  secret: () => Response;
  ended: () => Response;
  settled: WorkerPoolSettled;
}

/** An end's answer as the worker plane gives one, naming its release. */
const poolPlaneSaid = (status: number) => () =>
  new Response(null, {
    status,
    headers: { [workerContractHeader]: workerContractRelease },
  });

/** What the edge in front of a worker plane with no process ready answers, naming no release. */
const poolEdgeNotFound = () =>
  new Response("404 page not found\n", {
    status: 404,
    headers: { "content-type": "text/plain" },
  });

/**
 * A cluster holding `pods` until each is deleted, and the worker plane their
 * envelopes name, each answered from `answers` as it stands when asked and each
 * request recorded in `sent` as its method and address.
 */
function poolKeptCluster(
  pods: Map<string, unknown>,
  answers: PoolKeptAnswers,
  sent: string[],
): typeof fetch {
  return (input, init) => {
    const url = new URL(reachedUrl(input));
    sent.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    if (url.origin !== "https://cluster.invalid:6443")
      return Promise.resolve(
        url.pathname === workerPlaneRoutes.runEnded.path
          ? answers.ended()
          : new Response(null, { status: 204 }),
      );
    if (url.pathname === "/api/v1/namespaces/pool/pods")
      return Promise.resolve(
        new Response(JSON.stringify({ items: [...pods.values()] }), {
          status: 200,
        }),
      );
    if (url.pathname.includes("/secrets/"))
      return Promise.resolve().then(answers.secret);
    const deleted = pods.delete(
      decodeURIComponent(url.pathname.split("/").pop() ?? ""),
    );
    return Promise.resolve(new Response("{}", { status: deleted ? 200 : 404 }));
  };
}

/**
 * A client of this pool over a cluster holding one captured pod, named for its
 * assignment as this pool names it, with a plane offering nothing and settling
 * every refusal as `answers` says.
 */
function poolKept(
  captured: string,
  carried: string,
  answers: PoolKeptAnswers,
): {
  readonly sent: string[];
  readonly pods: Map<string, unknown>;
  readonly client: WorkerPoolClient;
} {
  const name = kubernetesPoolPodName(config, carried);
  const pod = poolCaptured(captured, carried);
  pod["metadata"] = { ...(pod["metadata"] as object), name };
  const pods = new Map<string, unknown>([[name, pod]]);
  const sent: string[] = [];
  const fetcher = poolKeptCluster(pods, answers, sent);
  return {
    sent,
    pods,
    client: {
      tokens: {
        acquire: () =>
          Promise.resolve({ acquired: "Token", token: "pool-token" }),
        invalidate: () => undefined,
      },
      plane: {
        poll: () =>
          Promise.resolve({
            polled: "Reconciled",
            assignments: [],
            sessions: [],
            stop: [],
          }),
        settle: (_token, settled) => {
          sent.push(`SETTLE ${settled}`);
          return Promise.resolve(answers.settled);
        },
      },
      jobs: poolJobPlaneClient({ timeoutMs: 1_000 }, fetcher),
      backend: kubernetesPoolBackend(config, fetcher, () =>
        poolCapturedAt(captured),
      ),
      settings: { concurrencyMax: 1, outageBackoffMs: 1, passesMax: 1 },
    },
  };
}

/** One pass of a client over a kept pod, answering how many ends the plane took and what the pass sent. */
async function poolKeptPass(kept: ReturnType<typeof poolKept>): Promise<{
  readonly ended: number;
  readonly sent: readonly string[];
}> {
  kept.sent.length = 0;
  const passed = await workerPoolClientPass(kept.client);
  assert.equal(passed.passed, "Reconciled");
  return {
    ended: passed.passed === "Reconciled" ? passed.ended : -1,
    sent: [...kept.sent],
  };
}

const poolKeptListed =
  "GET https://cluster.invalid:6443/api/v1/namespaces/pool/pods";
const poolKeptEnded = `POST https://callback.invalid${workerPlaneRoutes.runEnded.path}`;
const poolKeptUploaded = `${workerPlaneRoutes.artifact.method} https://callback.invalid${workerPlaneRoutes.artifact.path.replace("*", workerErrorPath)}`;

test("a pod stopped at its deadline whose end the plane did not answer is kept, and the next pass ends it again and only then deletes it", async () => {
  for (const [what, unanswered, answered, taken] of [
    [
      "a plane answering 503, then an end taken now",
      poolPlaneSaid(503),
      204,
      1,
    ],
    ["an edge's own 404, then an end taken now", poolEdgeNotFound, 204, 1],
    [
      "a plane answering 503, then an end it took before, answered as no longer live",
      poolPlaneSaid(503),
      401,
      0,
    ],
    [
      "an edge's own 404, then an end the plane took before, answered as no longer live",
      poolEdgeNotFound,
      401,
      0,
    ],
  ] as const) {
    const answers: PoolKeptAnswers = {
      secret: () => poolEnvelopeSecret("stopped"),
      ended: unanswered,
      settled: "Settled",
    };
    const kept = poolKept("deadline-exceeded", "stopped", answers);
    const name = kubernetesPoolPodName(config, "stopped");
    const secret = `GET https://cluster.invalid:6443/api/v1/namespaces/pool/secrets/${name}`;
    const deleted = `DELETE https://cluster.invalid:6443/api/v1/namespaces/pool/pods/${name}`;
    assert.deepEqual(
      await poolKeptPass(kept),
      {
        ended: 0,
        sent: [
          poolKeptListed,
          poolKeptListed,
          secret,
          poolKeptUploaded,
          poolKeptEnded,
        ],
      },
      `${what}: unanswered`,
    );
    assert.deepEqual([...kept.pods.keys()], [name], what);
    answers.ended = poolPlaneSaid(answered);
    assert.deepEqual(
      await poolKeptPass(kept),
      {
        ended: taken,
        sent: [
          poolKeptListed,
          poolKeptListed,
          secret,
          poolKeptUploaded,
          poolKeptEnded,
          deleted,
        ],
      },
      what,
    );
    assert.deepEqual([...kept.pods.keys()], [], what);
    assert.deepEqual(
      await poolKeptPass(kept),
      { ended: 0, sent: [poolKeptListed, poolKeptListed] },
      `${what}: a pass after the delete names nothing`,
    );
  }
});

test("a pod stopped at its deadline whose envelope could not be read is kept, and the pass that reads it ends it and then deletes it", async (t) => {
  const answers: PoolKeptAnswers = {
    secret: () => new Response("{}", { status: 503 }),
    ended: poolPlaneSaid(204),
    settled: "Settled",
  };
  const kept = poolKept("deadline-exceeded", "stopped", answers);
  const name = kubernetesPoolPodName(config, "stopped");
  const secret = `GET https://cluster.invalid:6443/api/v1/namespaces/pool/secrets/${name}`;
  t.mock.method(process.stderr, "write", () => true);
  assert.deepEqual(await poolKeptPass(kept), {
    ended: 0,
    sent: [poolKeptListed, poolKeptListed, secret],
  });
  assert.deepEqual([...kept.pods.keys()], [name]);
  answers.secret = () => poolEnvelopeSecret("stopped");
  assert.deepEqual(await poolKeptPass(kept), {
    ended: 1,
    sent: [
      poolKeptListed,
      poolKeptListed,
      secret,
      poolKeptUploaded,
      poolKeptEnded,
      `DELETE https://cluster.invalid:6443/api/v1/namespaces/pool/pods/${name}`,
    ],
  });
  assert.deepEqual([...kept.pods.keys()], []);
});

test("a pod naming a fault of its image whose refusal the plane did not answer is kept, and the next pass refuses it again and only then deletes it", async () => {
  for (const [what, unanswered, answered, taken] of [
    [
      "a plane that could not be reached, then took it",
      "Unavailable",
      "Settled",
      1,
    ],
    ["a rejected token, then a refusal taken before", "Stale", "Lost", 0],
  ] as const) {
    const answers: PoolKeptAnswers = {
      secret: () => poolEnvelopeSecret("lacking"),
      ended: poolPlaneSaid(204),
      settled: unanswered,
    };
    const kept = poolKept("lacks-git", "lacking", answers);
    const name = kubernetesPoolPodName(config, "lacking");
    const secret = `GET https://cluster.invalid:6443/api/v1/namespaces/pool/secrets/${name}`;
    assert.deepEqual(
      await poolKeptPass(kept),
      {
        ended: 0,
        sent: [
          poolKeptListed,
          poolKeptListed,
          secret,
          poolKeptUploaded,
          "SETTLE lacking",
        ],
      },
      what,
    );
    assert.deepEqual([...kept.pods.keys()], [name], what);
    answers.settled = answered;
    assert.deepEqual(
      await poolKeptPass(kept),
      {
        ended: taken,
        sent: [
          poolKeptListed,
          poolKeptListed,
          secret,
          poolKeptUploaded,
          "SETTLE lacking",
          `DELETE https://cluster.invalid:6443/api/v1/namespaces/pool/pods/${name}`,
        ],
      },
      what,
    );
    assert.deepEqual([...kept.pods.keys()], [], what);
  }
});

test("a cluster that could not be listed raises rather than answering an empty pool", async () => {
  await assert.rejects(
    () =>
      kubernetesPoolBackend(config, () =>
        Promise.resolve(new Response("{}", { status: 503 })),
      ).held(),
    Error,
  );
});

test("a stop is the one delete, and gone and asked-to-go are one answer", async () => {
  for (const status of [200, 202, 404]) {
    const { reached, fetcher } = cluster(() => new Response("{}", { status }));
    assert.deepEqual(
      await kubernetesPoolBackend(config, fetcher).stop("assignment-one"),
      { stopped: "Stopped" },
    );
    assert.equal(reached[0]?.method, "DELETE");
    assert.equal(
      reached[0]?.path,
      `/api/v1/namespaces/pool/pods/${kubernetesPoolPodName(config, "assignment-one")}`,
    );
  }
});

test("a cluster that could not take a stop is an outage rather than a refusal", async () => {
  const stopped = await kubernetesPoolBackend(config, () =>
    Promise.resolve(new Response("{}", { status: 503 })),
  ).stop("assignment-one");
  assert.equal(stopped.stopped, "Unavailable");
});

test("a cluster that did not take the stop is an outage rather than an answer", async () => {
  for (const status of [422, 500, 503]) {
    const stopped = await kubernetesPoolBackend(config, () =>
      Promise.resolve(new Response("{}", { status })),
    ).stop("assignment-one");
    assert.equal(stopped.stopped, "Unavailable", `status ${String(status)}`);
  }
});

test("a pod the cluster no longer holds is stopped, which is the caller's question", async () => {
  for (const status of [200, 202, 404]) {
    const stopped = await kubernetesPoolBackend(config, () =>
      Promise.resolve(new Response("{}", { status })),
    ).stop("assignment-one");
    assert.equal(stopped.stopped, "Stopped", `status ${String(status)}`);
  }
});

test("a site is refused where its provider credential is served by no mount", () => {
  assert.throws(
    () =>
      checkedKubernetesPoolPlacementConfig({
        ...config,
        providerCredential: "claude-code",
      }),
    RangeError,
  );
});

test("a site is refused where it reserves the variable the envelope is read from, or the workspace the runtime is told", () => {
  for (const variable of [workerTaskVariable, workerWorkspaceVariable])
    assert.throws(
      () =>
        checkedKubernetesPoolPlacementConfig({
          ...config,
          environment: { [variable]: "hijacked" },
        }),
      new RegExp(`pool worker environment may not replace ${variable}`, "u"),
      variable,
    );
});

test("a site is refused where a sidecar names no image or takes the workload's own name", () => {
  assert.throws(
    () =>
      checkedKubernetesPoolPlacementConfig({
        ...config,
        sidecars: [{ ...sidecar, image: "" }],
      }),
    /pool worker sidecar cache image is empty/u,
  );
  assert.throws(
    () =>
      checkedKubernetesPoolPlacementConfig({
        ...config,
        sidecars: [{ ...sidecar, name: kubernetesPoolContainerName }],
      }),
    /named like the worker's own container/u,
  );
  assert.deepEqual(
    checkedKubernetesPoolPlacementConfig({ ...config, sidecars: [sidecar] })
      .sidecars,
    [sidecar],
  );
});

test("a site's sidecars run beside its workload, and the workload's container is the same either way", async () => {
  const within = (await placedPod({
    ...config,
    sidecars: [sidecar],
  })) as unknown as KubernetesPod;
  const without = (await placedPod(config)) as unknown as KubernetesPod;
  assert.deepEqual(
    within.spec.initContainers?.map(({ name }) => name),
    [sidecar.name],
  );
  assert.equal("initContainers" in without.spec, false);
  assert.deepEqual(within.spec.containers, without.spec.containers);
});

test("a pod name is a function of the assignment and of nothing else", () => {
  assert.equal(
    kubernetesPoolPodName(config, "assignment-one"),
    kubernetesPoolPodName(config, "assignment-one"),
  );
  assert.notEqual(
    kubernetesPoolPodName(config, "assignment-one"),
    kubernetesPoolPodName(config, "assignment-two"),
  );
});

/**
 * The runtime is the assignment's to name, and a plane that names none hands
 * out the work a pool ran before it named one: the image's own entrypoint and
 * nothing copied beside it.
 */
test("an assignment naming a runtime starts its workload from it, and one naming none runs its image's entrypoint", async () => {
  const runtime = `registry.invalid/runtime@sha256:${"f".repeat(64)}`;
  const started = (await placedPod(
    { ...config, sidecars: [sidecar] },
    { ...assignment, runtime },
  )) as unknown as KubernetesPod;
  const [container] = started.spec.containers;
  assert.equal(container?.image, config.image);
  assert.deepEqual(container.command, workerJobCommand);
  assert.deepEqual(
    container.volumeMounts
      .filter(({ mountPath }) => mountPath === workerRuntimeDirectory)
      .map(({ readOnly }) => readOnly),
    [true],
  );
  assert.deepEqual(
    started.spec.initContainers?.map(({ name, image }) => [name, image]),
    [
      ["chuggy-runtime", runtime],
      [sidecar.name, sidecar.image],
    ],
  );
  assert.deepEqual(
    container.env.filter(({ name }) => name === workerWorkspaceVariable),
    [{ name: workerWorkspaceVariable, value: workerWorkspaceDirectory }],
  );
  const unstarted = (await placedPod({
    ...config,
    sidecars: [sidecar],
  })) as unknown as KubernetesPod;
  assert.equal("command" in (unstarted.spec.containers[0] ?? {}), false);
  assert.deepEqual(
    unstarted.spec.containers[0]?.env.filter(
      ({ name }) => name === workerWorkspaceVariable,
    ),
    [],
  );
  assert.deepEqual(
    unstarted.spec.initContainers?.map(({ name }) => name),
    [sidecar.name],
  );
  assert.equal(
    unstarted.spec.volumes.some(({ name }) => name === "chuggy-runtime"),
    false,
  );
});

test("a site is refused where its own mounts would land inside the runtime", () => {
  assert.throws(
    () =>
      checkedKubernetesPoolPlacementConfig({
        ...config,
        capabilityFile: `${workerRuntimeDirectory}/capability`,
      }),
    /pool placement mount \/opt\/chuggy\/capability overlaps \/opt\/chuggy/u,
  );
});
