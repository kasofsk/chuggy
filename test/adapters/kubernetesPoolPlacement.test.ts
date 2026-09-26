import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  mintedCredentialDirectory,
  workerTaskVariable,
} from "../../src/contract/workerEnvironment.ts";
import {
  workerPoolRetryAfterSecsMax,
  type WorkerPoolAssignment,
} from "../../src/contract/workerPool.ts";
import { poolEnvelopeSchema } from "../../src/contract/workerTask.ts";
import {
  checkedKubernetesPoolPlacementConfig,
  kubernetesPoolAssignmentAnnotation,
  kubernetesPoolBackend,
  kubernetesPoolPodName,
  type KubernetesPoolPlacementConfig,
} from "../../src/adapters/kubernetes/poolPlacement.ts";

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
  unavailableRetryAfterSecs: 11,
  workerPlaneUrl: "https://worker-plane.invalid",
  capabilityFile: "/run/chuggy/capability",
  workspacePath: "/workspace",
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

test("a placed pod is named for its assignment and asks for the box it was offered", async () => {
  const name = kubernetesPoolPodName(config, assignment.assignment);
  const { reached, fetcher } = cluster((made) =>
    made.path.startsWith("/api/v1/namespaces/pool/pods")
      ? created(name)
      : new Response("{}", { status: 201 }),
  );
  assert.deepEqual(
    await kubernetesPoolBackend(config, fetcher).place(assignment),
    { placed: "Placed" },
  );
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

/** The pod one site places for `assignment`, as the cluster was asked to create it. */
async function placedPod(site: KubernetesPoolPlacementConfig): Promise<{
  spec: {
    activeDeadlineSeconds: number;
    containers: readonly {
      volumeMounts: readonly {
        name: string;
        mountPath: string;
        readOnly: boolean;
      }[];
    }[];
    volumes: readonly { name: string; emptyDir?: unknown }[];
  };
}> {
  const name = kubernetesPoolPodName(site, assignment.assignment);
  const { reached, fetcher } = cluster((made) =>
    made.path.startsWith("/api/v1/namespaces/pool/pods")
      ? created(name)
      : new Response("{}", { status: 201 }),
  );
  await kubernetesPoolBackend(site, fetcher).place(assignment);
  return reached[0]?.body as Awaited<ReturnType<typeof placedPod>>;
}

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
  const name = kubernetesPoolPodName(config, assignment.assignment);
  const { reached, fetcher } = cluster((made) =>
    made.path.startsWith("/api/v1/namespaces/pool/pods")
      ? created(name)
      : new Response("{}", { status: 201 }),
  );
  await kubernetesPoolBackend(config, fetcher).place(assignment);
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
  const name = kubernetesPoolPodName(config, assignment.assignment);
  const { reached, fetcher } = cluster((made) =>
    made.path.startsWith("/api/v1/namespaces/pool/pods")
      ? created(name)
      : new Response("{}", { status: 201 }),
  );
  await kubernetesPoolBackend(config, fetcher).place(assignment);
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
    const name = kubernetesPoolPodName(site, assignment.assignment);
    const { reached, fetcher } = cluster((made) =>
      made.path.startsWith("/api/v1/namespaces/pool/pods")
        ? created(name)
        : new Response("{}", { status: 201 }),
    );
    await kubernetesPoolBackend(site, fetcher).place(assignment);
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
  const placement = await kubernetesPoolBackend(config, fetcher).place(
    assignment,
  );
  assert.equal(placement.placed, "Refused");
});

test("a cluster that could not be reached is backpressure with the site's own interval", async () => {
  const placement = await kubernetesPoolBackend(config, () =>
    Promise.reject(new Error("connection refused")),
  ).place(assignment);
  assert.deepEqual(placement, { placed: "Unavailable", retryAfterSecs: 11 });
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
    "one",
    "two",
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
    "three",
  ]);
  assert.deepEqual(
    reached.filter((made) => made.method === "DELETE").map((made) => made.path),
    [
      "/api/v1/namespaces/pool/pods/pool-failed",
      "/api/v1/namespaces/pool/pods/pool-succeeded",
    ],
  );
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

test("a site is refused where its retry-after is more than the plane accepts", () => {
  assert.throws(
    () =>
      checkedKubernetesPoolPlacementConfig({
        ...config,
        unavailableRetryAfterSecs: workerPoolRetryAfterSecsMax + 1,
      }),
    RangeError,
  );
  assert.equal(
    checkedKubernetesPoolPlacementConfig({
      ...config,
      unavailableRetryAfterSecs: workerPoolRetryAfterSecsMax,
    }).unavailableRetryAfterSecs,
    workerPoolRetryAfterSecsMax,
  );
});

test("a site is refused where it reserves the variable the envelope is read from", () => {
  assert.throws(
    () =>
      checkedKubernetesPoolPlacementConfig({
        ...config,
        environment: { [workerTaskVariable]: "hijacked" },
      }),
    RangeError,
  );
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
