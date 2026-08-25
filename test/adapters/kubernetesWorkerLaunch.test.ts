/**
 * The Kubernetes worker-launch adapter: what one scheduled attempt is
 * translated into, what each answer of the cluster API means for it, and what
 * the namespace probe says before any of it is attempted.
 *
 * THE REQUEST IS ASSERTED AS A WHOLE rather than field by field, because the
 * claim being made is that a worker is told what the port supplied and nothing
 * else — a claim a per-field assertion cannot make, since the field nobody
 * thought to assert is exactly the one that leaks.
 *
 * THE NEGATIVE SPACE IS HALF THE POINT. A native requirement no container
 * backend can serve, a refused create, an unreachable cluster and an unreadable
 * credential must each be the arm 006 gives it: a definitive inability retires
 * the execution, and a temporary one holds it.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  kubernetesNamespacePrecondition,
  kubernetesWorkerLaunch,
} from "../../src/adapters/kubernetes/workerLaunch.ts";
import {
  checkedKubernetesWorkerLaunchConfig,
  kubernetesNameCharsMax,
  kubernetesWorkerContainerName,
  kubernetesWorkerPodName,
  kubernetesWorkerTaskVariable,
  type KubernetesWorkerLaunchConfig,
  type KubernetesWorkerTask,
} from "../../src/adapters/kubernetes/workerPod.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import {
  asAttemptCapabilityId,
  asAttemptCapabilitySecret,
  asAttemptId,
  asExecutionId,
  type AttemptPlacement,
} from "../../src/interpreter/executionScheduler.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type { PolicyAuthorityGrant } from "../../src/interpreter/taskAuthority.ts";
import {
  blessedPracticeCatalog,
  composeTaskInvocation,
  type PinnedTaskConfiguration,
} from "../../src/interpreter/taskBriefing.ts";

const root = mkdtempSync(join(tmpdir(), "chuggy-cluster-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

const token = "cluster-token-value";
const tokenFile = join(root, "token");
writeFileSync(tokenFile, `${token}\n`);

/** The image this suite's placement requires, which is the one a container runs. */
const workerImage = "registry.invalid/worker:1";

const config: KubernetesWorkerLaunchConfig = {
  apiBaseUrl: "https://cluster.invalid:6443",
  namespace: "chuggy-workers",
  tokenFile,
  workerPlaneUrl: "http://chuggy-worker-plane:8080",
  capabilityFile: "/run/chuggy/capability",
  workspacePath: "/workspace",
  credentialMounts: {
    workspace: {
      secretName: "workspace-credential",
      key: "token",
      mountPath: "/run/chuggy/credentials/workspace",
    },
  },
  environment: { CHUG_WORKER_REPOSITORIES: '{"repository":"url"}' },
  serviceAccountName: "chuggy-worker",
  podNamePrefix: "chuggy-worker",
  resources: {
    cpuRequest: "500m",
    cpuLimit: "1",
    memoryRequest: "1Gi",
    memoryLimit: "2Gi",
    ephemeralStorageLimit: "10Gi",
  },
  podLabels: { "app.kubernetes.io/name": "chuggy-worker" },
  podAnnotations: { "site.invalid/tier": "batch" },
  nodeSelector: { "kubernetes.io/os": "linux" },
  podSecurityContext: { runAsNonRoot: true },
  containerSecurityContext: { allowPrivilegeEscalation: false },
  activeDeadlineSecs: 3_600,
  requestTimeoutSecsMax: 5,
  unavailableRetryAfterSecs: 15,
};

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const grant: PolicyAuthorityGrant = {
  tools: ["editor"],
  credentials: ["workspace"],
  network: false,
  filesystem: "WriteWorkspace",
  mayCompleteTask: true,
};

const configuration: PinnedTaskConfiguration = {
  configurationRevision: "revision",
  configurationDigest: "digest",
  brief: {
    motivation: ["The importer drops rows and reports a success."],
    acceptanceCriteria: ["A dropped row is reported as a failure."],
    constraints: [],
  },
  practices: ["AcceptanceCriteria"],
  work: { instructions: ["Change the importer and nothing beside it."] },
  review: { instructions: ["Walk the call paths the change reaches."] },
};

function taskInvocation(): AttemptPlacement["invocation"] {
  const composed = composeTaskInvocation(blessedPracticeCatalog, {
    purpose: "Work",
    pin: configuration,
    configuration,
    runtime: { changedFiles: [], handoff: [] },
    grant,
  });
  if (composed.composed !== "Composed")
    throw new Error("the fixture configuration does not compose");
  return composed.invocation;
}

const placement: AttemptPlacement = {
  partition,
  execution: asExecutionId("execution-one"),
  attempt: asAttemptId("attempt-one"),
  generation: 3,
  ticket: asTicketId(7),
  task: asTaskId(2),
  taskKind: "Work",
  sourceRequest: "1:0:SpawnWork",
  inputBundle: "1:0:InputBundle",
  inputBundleDigest: "b".repeat(64),
  configurationRevision: "revision",
  configurationDigest: "digest",
  requirementIdentity: "requirement-one",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: workerImage,
  },
  requirementDigest: "requirement-digest",
  profile: { profile: "standard", runtimeVersion: "1" },
  invocation: taskInvocation(),
  capability: {
    id: asAttemptCapabilityId("capability-one"),
    secret: asAttemptCapabilitySecret("secret-one"),
    manifest: asResultManifestId("manifest-one"),
  },
};

/** One request this adapter made, kept as text so the whole body can be asserted. */
interface ClusterReached {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | undefined;
  readonly body: string | undefined;
}

/** A cluster that records what it was asked and answers what a case is about. */
function recordingCluster(
  reached: ClusterReached[],
  answer: (request: ClusterReached) => Response,
): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    const request = {
      url:
        input instanceof URL
          ? input.href
          : typeof input === "string"
            ? input
            : input.url,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? undefined,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    reached.push(request);
    const response = answer(request);
    const submitted = JSON.parse(request.body ?? "{}") as {
      readonly metadata?: Readonly<Record<string, unknown>>;
    };
    return Promise.resolve(
      (init?.method ?? "GET") === "POST" &&
        request.url.endsWith("/pods") &&
        (response.status === 200 || response.status === 201)
        ? Response.json(
            {
              metadata: {
                ...submitted.metadata,
                uid: "pod-uid-one",
              },
            },
            { status: response.status },
          )
        : response,
    );
  };
}

function answering(status: number): () => Response {
  return () => new Response(null, { status });
}

/** The whole task this placement hands its worker, which is the container's one variable. */
function expectedTask(): string {
  return JSON.stringify({
    tenant: "tenant",
    project: "project",
    execution: "execution-one",
    attempt: "attempt-one",
    generation: 3,
    ticket: 7,
    task: 2,
    taskKind: "Work",
    sourceRequest: "1:0:SpawnWork",
    inputBundle: "1:0:InputBundle",
    inputBundleDigest: "b".repeat(64),
    configurationRevision: "revision",
    configurationDigest: "digest",
    profile: { profile: "standard", runtimeVersion: "1" },
    requirementIdentity: "requirement-one",
    requirementDigest: "requirement-digest",
    briefing: {
      templateVersion: placement.invocation.briefing.templateVersion,
      purpose: "Work",
      text: placement.invocation.briefing.text,
    },
    authority: { ...grant, mayCompleteTask: false },
    workerPlane: {
      url: config.workerPlaneUrl,
      capabilityFile: config.capabilityFile,
      capability: "capability-one",
      manifest: "manifest-one",
    },
  });
}

/** The whole worker container, including every site value and mounted capability. */
function expectedContainer(): unknown {
  return {
    name: kubernetesWorkerContainerName,
    image: workerImage,
    env: [
      { name: kubernetesWorkerTaskVariable, value: expectedTask() },
      {
        name: "CHUG_WORKER_REPOSITORIES",
        value: '{"repository":"url"}',
      },
    ],
    resources: {
      requests: {
        cpu: "500m",
        memory: "1Gi",
        "ephemeral-storage": "10Gi",
      },
      limits: {
        cpu: "1",
        memory: "2Gi",
        "ephemeral-storage": "10Gi",
      },
    },
    securityContext: { allowPrivilegeEscalation: false },
    volumeMounts: [
      {
        name: "worker-capability",
        mountPath: "/run/chuggy/capability",
        subPath: "bearer",
        readOnly: true,
      },
      { name: "worker-workspace", mountPath: "/workspace", readOnly: false },
      {
        name: "worker-credential-0",
        mountPath: "/run/chuggy/credentials/workspace",
        subPath: "credential",
        readOnly: true,
      },
    ],
  };
}

/** The whole pod this placement is, so the assertion is the document and not a sample of it. */
function expectedPod(name: string): unknown {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      namespace: "chuggy-workers",
      labels: { "app.kubernetes.io/name": "chuggy-worker" },
      annotations: {
        "site.invalid/tier": "batch",
        "chuggy.internal/tenant": "tenant",
        "chuggy.internal/project": "project",
        "chuggy.internal/execution": "execution-one",
        "chuggy.internal/attempt": "attempt-one",
        "chuggy.internal/generation": "3",
        "chuggy.internal/ticket": "7",
        "chuggy.internal/task": "2",
        "chuggy.internal/task-kind": "Work",
        "chuggy.internal/source-request": "1:0:SpawnWork",
        "chuggy.internal/input-bundle": "1:0:InputBundle",
        "chuggy.internal/input-bundle-digest": "b".repeat(64),
        "chuggy.internal/configuration-revision": "revision",
        "chuggy.internal/configuration-digest": "digest",
        "chuggy.internal/profile": "standard",
        "chuggy.internal/runtime-version": "1",
        "chuggy.internal/requirement": "requirement-one",
        "chuggy.internal/requirement-digest": "requirement-digest",
      },
    },
    spec: {
      restartPolicy: "Never",
      serviceAccountName: "chuggy-worker",
      automountServiceAccountToken: false,
      activeDeadlineSeconds: 3_600,
      nodeSelector: { "kubernetes.io/os": "linux" },
      securityContext: { runAsNonRoot: true },
      containers: [expectedContainer()],
      volumes: [
        {
          name: "worker-capability",
          secret: {
            secretName: name,
            defaultMode: 0o400,
            items: [{ key: "bearer", path: "bearer" }],
          },
        },
        { name: "worker-workspace", emptyDir: { sizeLimit: "10Gi" } },
        {
          name: "worker-credential-0",
          secret: {
            secretName: "workspace-credential",
            defaultMode: 0o400,
            items: [{ key: "token", path: "credential" }],
          },
        },
      ],
    },
  };
}

test("a placed attempt is one pod, named for its attempt and fenced by its annotations", async () => {
  const reached: ClusterReached[] = [];
  const workers = kubernetesWorkerLaunch(
    config,
    recordingCluster(reached, answering(201)),
  );
  const placed = await workers.place(placement);
  const name = kubernetesWorkerPodName(config, partition, placement.attempt);
  assert.deepEqual(placed, { placed: "Placed", placement: name });
  const podRequest = reached[0];
  const request = reached[1];
  assert.equal(request?.method, "POST");
  assert.equal(
    request.url,
    "https://cluster.invalid:6443/api/v1/namespaces/chuggy-workers/secrets",
  );
  assert.deepEqual(JSON.parse(request.body ?? ""), {
    apiVersion: "v1",
    kind: "Secret",
    immutable: true,
    metadata: {
      name,
      namespace: "chuggy-workers",
      ownerReferences: [
        {
          apiVersion: "v1",
          kind: "Pod",
          name,
          uid: "pod-uid-one",
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    stringData: { bearer: "secret-one" },
  });
  assert.equal(podRequest?.method, "POST");
  assert.equal(
    podRequest?.url,
    "https://cluster.invalid:6443/api/v1/namespaces/chuggy-workers/pods",
  );
  assert.equal(request.authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(podRequest?.body ?? ""), expectedPod(name));
  assert.equal(podRequest?.body?.includes("secret-one"), false);
});

test("an existing Secret is accepted only when its immutable identity and bearer match", async () => {
  const name = kubernetesWorkerPodName(config, partition, placement.attempt);
  for (const [existing, expected] of [
    [{}, "Placed"],
    [{ immutable: false }, "Unavailable"],
    [
      { metadata: { name: "another", namespace: config.namespace } },
      "Unavailable",
    ],
    [
      {
        metadata: {
          name,
          namespace: config.namespace,
          ownerReferences: [],
        },
      },
      "Unavailable",
    ],
    [{ bearer: "another-secret" }, "Unavailable"],
  ] as const) {
    const reached: ClusterReached[] = [];
    const workers = kubernetesWorkerLaunch(
      config,
      recordingCluster(reached, (request) => {
        if (request.url.endsWith("/pods"))
          return Response.json(
            { metadata: { uid: "pod-uid-one" } },
            { status: 201 },
          );
        if (request.url.endsWith("/secrets"))
          return new Response(null, { status: 409 });
        if (request.method === "GET")
          return Response.json(
            {
              apiVersion: "v1",
              kind: "Secret",
              immutable: true,
              metadata: {
                name,
                namespace: config.namespace,
                ownerReferences: [
                  {
                    apiVersion: "v1",
                    kind: "Pod",
                    name,
                    uid: "pod-uid-one",
                    controller: true,
                    blockOwnerDeletion: true,
                  },
                ],
              },
              data: {
                bearer: Buffer.from(
                  "bearer" in existing ? existing.bearer : "secret-one",
                ).toString("base64"),
              },
              ...existing,
            },
            { status: 200 },
          );
        return new Response(null, { status: 200 });
      }),
    );
    assert.equal((await workers.place(placement)).placed, expected);
    assert.equal(reached[2]?.body, undefined);
    assert.equal(reached.length, expected === "Placed" ? 3 : 4);
  }
});

test("a retried placement owns its Secret with the existing Pod UID", async () => {
  const name = kubernetesWorkerPodName(config, partition, placement.attempt);
  const metadata = (
    expectedPod(name) as {
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  ).metadata;
  const reached: ClusterReached[] = [];
  const workers = kubernetesWorkerLaunch(
    config,
    recordingCluster(reached, (request) => {
      if (request.method === "POST" && request.url.endsWith("/pods"))
        return new Response(null, { status: 409 });
      if (request.method === "GET" && request.url.includes("/pods/"))
        return Response.json({
          metadata: {
            ...metadata,
            uid: "existing-pod-uid",
          },
        });
      return new Response(null, { status: 201 });
    }),
  );
  assert.equal((await workers.place(placement)).placed, "Placed");
  const secret = JSON.parse(reached[2]?.body ?? "") as {
    readonly metadata: {
      readonly ownerReferences: readonly { readonly uid: string }[];
    };
  };
  assert.equal(secret.metadata.ownerReferences[0]?.uid, "existing-pod-uid");
});

test("a failed Secret create removes the attempt Pod", async () => {
  let answerNumber = 0;
  const reached: ClusterReached[] = [];
  const workers = kubernetesWorkerLaunch(
    config,
    recordingCluster(reached, () => {
      answerNumber += 1;
      return new Response(null, { status: answerNumber === 2 ? 422 : 201 });
    }),
  );
  assert.deepEqual(await workers.place(placement), {
    placed: "Denied",
    reason: "ExecutionPolicyDenied",
  });
  assert.deepEqual(
    reached.map((request) => request.method),
    ["POST", "POST", "DELETE"],
  );
});

test("a worker is handed the resolved authority and never the policy grant", async () => {
  const reached: ClusterReached[] = [];
  const workers = kubernetesWorkerLaunch(
    config,
    recordingCluster(reached, answering(201)),
  );
  await workers.place(placement);
  const pod = JSON.parse(reached[0]?.body ?? "") as {
    readonly spec: {
      readonly containers: readonly {
        readonly env: readonly { readonly value: string }[];
      }[];
    };
  };
  const task = JSON.parse(
    pod.spec.containers[0]?.env[0]?.value ?? "",
  ) as KubernetesWorkerTask;
  assert.equal(grant.mayCompleteTask, true);
  assert.equal(task.authority.mayCompleteTask, false);
});

test("a cancellation addresses the pod its attempt named", async () => {
  const reached: ClusterReached[] = [];
  const workers = kubernetesWorkerLaunch(
    config,
    recordingCluster(reached, answering(200)),
  );
  assert.deepEqual(await workers.cancel(placement), {
    cancelled: "Accepted",
  });
  const name = kubernetesWorkerPodName(config, partition, placement.attempt);
  assert.deepEqual(
    reached.map((request) => `${request.method} ${request.url}`),
    [
      `DELETE https://cluster.invalid:6443/api/v1/namespaces/chuggy-workers/pods/${name}`,
    ],
  );
});

test("idempotent absence is accepted but a refused deletion remains unavailable", async () => {
  for (const [status, cancelled] of [
    [404, "Accepted"],
    [403, "Unavailable"],
    [500, "Unavailable"],
  ] as const) {
    const workers = kubernetesWorkerLaunch(config, () =>
      Promise.resolve(new Response(null, { status })),
    );
    assert.deepEqual(await workers.cancel(placement), { cancelled });
  }
});

const nativeRequirement = {
  mode: "Native",
  architecture: "Arm64",
  driver: "XcodeBuild",
  xcodeVersionMin: 1,
  sdkVersionMin: 1,
} as const;

test("a native requirement is a definitive inability for a container backend", async () => {
  const workers = kubernetesWorkerLaunch(
    config,
    recordingCluster([], answering(201)),
  );
  assert.deepEqual(
    await workers.place({ ...placement, requirement: nativeRequirement }),
    { placed: "Denied", reason: "RequiredCapabilityUnavailable" },
  );
});

test("a placement this backend cannot serve never reaches the cluster", async () => {
  const reached: ClusterReached[] = [];
  const workers = kubernetesWorkerLaunch(
    config,
    recordingCluster(reached, answering(201)),
  );
  await workers.place({ ...placement, requirement: nativeRequirement });
  assert.deepEqual(reached, []);
});

test("an authority credential the site cannot mount is a definitive inability", async () => {
  const reached: ClusterReached[] = [];
  const workers = kubernetesWorkerLaunch(
    { ...config, credentialMounts: {} },
    recordingCluster(reached, answering(201)),
  );
  assert.deepEqual(await workers.place(placement), {
    placed: "Denied",
    reason: "RequiredCapabilityUnavailable",
  });
  assert.deepEqual(reached, []);
});

test("the image a pod runs is the requirement's own", async () => {
  const reached: ClusterReached[] = [];
  const workers = kubernetesWorkerLaunch(
    config,
    recordingCluster(reached, answering(201)),
  );
  await workers.place({
    ...placement,
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: "registry.invalid/other:v9",
    },
  });
  assert.equal(reached.length, 2);
  const pod = JSON.parse(reached[0]?.body ?? "") as {
    readonly spec: {
      readonly containers: readonly { readonly image: string }[];
    };
  };
  assert.equal(pod.spec.containers[0]?.image, "registry.invalid/other:v9");
});

test("only a refusal of the document is definitive and every other answer holds", async () => {
  const placed = {
    placed: "Placed",
    placement: kubernetesWorkerPodName(config, partition, placement.attempt),
  };
  const held = { placed: "Unavailable", retryAfterSeconds: 15 };
  const denied = { placed: "Denied", reason: "ExecutionPolicyDenied" };
  const outcomes: readonly (readonly [number, unknown])[] = [
    [200, placed],
    [201, placed],
    [409, held],
    [400, denied],
    [413, denied],
    [415, denied],
    [422, denied],
    [401, held],
    [403, held],
    [404, held],
    [405, held],
    [429, held],
    [500, held],
    [503, held],
  ];
  for (const [status, expected] of outcomes) {
    const workers = kubernetesWorkerLaunch(
      config,
      recordingCluster([], answering(status)),
    );
    assert.deepEqual(
      await workers.place(placement),
      expected,
      `status ${String(status)}`,
    );
  }
});

test("a cluster that cannot be reached is a hold and never a denial", async () => {
  const workers = kubernetesWorkerLaunch(config, () =>
    Promise.reject(new Error("connection refused")),
  );
  assert.deepEqual(await workers.place(placement), {
    placed: "Unavailable",
    retryAfterSeconds: 15,
  });
});

test("a credential that cannot be read is a hold like an unreachable cluster", async () => {
  const reached: ClusterReached[] = [];
  const workers = kubernetesWorkerLaunch(
    { ...config, tokenFile: join(root, "absent") },
    recordingCluster(reached, answering(201)),
  );
  assert.deepEqual(await workers.place(placement), {
    placed: "Unavailable",
    retryAfterSeconds: 15,
  });
  assert.deepEqual(reached, []);
});

test("the namespace is a precondition met only by a namespace that answers", async () => {
  const answers = new Map([
    [200, true],
    [403, false],
    [404, false],
  ]);
  for (const [status, met] of answers) {
    const precondition = kubernetesNamespacePrecondition(
      config,
      recordingCluster([], answering(status)),
    );
    assert.equal(precondition.name, "cluster-namespace-reachable");
    assert.equal(
      await precondition.check(new AbortController().signal),
      met,
      `status ${String(status)}`,
    );
  }
  const unreachable = kubernetesNamespacePrecondition(config, () =>
    Promise.reject(new Error("connection refused")),
  );
  assert.equal(await unreachable.check(new AbortController().signal), false);
});

test("the namespace probe reads the namespace and nothing under it", async () => {
  const reached: ClusterReached[] = [];
  const precondition = kubernetesNamespacePrecondition(
    config,
    recordingCluster(reached, answering(200)),
  );
  await precondition.check(new AbortController().signal);
  assert.deepEqual(
    reached.map((request) => `${request.method} ${request.url}`),
    ["GET https://cluster.invalid:6443/api/v1/namespaces/chuggy-workers"],
  );
});

test("a deployment that cannot address a cluster is refused where it is composed", () => {
  const refusals: readonly Partial<KubernetesWorkerLaunchConfig>[] = [
    { apiBaseUrl: "https://user:secret@cluster.invalid:6443" },
    { namespace: "Chuggy_Workers" },
    { serviceAccountName: "-worker" },
    { podNamePrefix: "worker-" },
    { podNamePrefix: "w".repeat(kubernetesNameCharsMax) },
    { tokenFile: "" },
    { activeDeadlineSecs: 0 },
    { requestTimeoutSecsMax: 0 },
    { unavailableRetryAfterSecs: 0 },
  ];
  for (const refused of refusals) {
    assert.throws(
      () => checkedKubernetesWorkerLaunchConfig({ ...config, ...refused }),
      Error,
      JSON.stringify(refused),
    );
  }
  assert.deepEqual(checkedKubernetesWorkerLaunchConfig(config), config);
  assert.ok(
    kubernetesWorkerPodName(config, partition, placement.attempt).length <=
      kubernetesNameCharsMax,
  );
});

test("site environment cannot replace the worker task document", () => {
  assert.throws(
    () =>
      checkedKubernetesWorkerLaunchConfig({
        ...config,
        environment: { [kubernetesWorkerTaskVariable]: "replacement" },
      }),
    /CHUG_WORKER_TASK/u,
  );
});
