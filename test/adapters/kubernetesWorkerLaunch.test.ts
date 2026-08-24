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
 * THE NEGATIVE SPACE IS HALF THE POINT. A profile no site image is admitted
 * for, a runtime version none carries, a refused create, an unreachable
 * cluster and an unreadable credential must each be the arm 006 gives it: a
 * definitive inability retires the execution, and a temporary one holds it.
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
  asAttemptId,
  asExecutionId,
  type AttemptPlacement,
} from "../../src/interpreter/executionScheduler.ts";
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

/**
 * The one image this suite's site admits and its placement requires. They are
 * written as the same value so that no case here turns on which of the two a
 * container ends up running; that divergence is issue #250's, and the case
 * that pins it belongs with the fix.
 */
const workerImage = "registry.invalid/worker:1";

const config: KubernetesWorkerLaunchConfig = {
  apiBaseUrl: "https://cluster.invalid:6443",
  namespace: "chuggy-workers",
  tokenFile,
  serviceAccountName: "chuggy-worker",
  podNamePrefix: "chuggy-worker",
  imagesAdmitted: [
    {
      profile: "standard",
      runtimeVersion: "1",
      image: workerImage,
    },
  ],
  resources: {
    cpuRequest: "500m",
    cpuLimit: "1",
    memoryRequest: "1Gi",
    memoryLimit: "2Gi",
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
  answer: () => Response,
): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    reached.push({
      url:
        input instanceof URL
          ? input.href
          : typeof input === "string"
            ? input
            : input.url,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? undefined,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return Promise.resolve(answer());
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
    configurationRevision: "revision",
    configurationDigest: "digest",
    profile: { profile: "standard", runtimeVersion: "1" },
    briefing: {
      templateVersion: placement.invocation.briefing.templateVersion,
      purpose: "Work",
      text: placement.invocation.briefing.text,
    },
    authority: { ...grant, mayCompleteTask: false },
  });
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
        "chuggy.internal/configuration-revision": "revision",
        "chuggy.internal/configuration-digest": "digest",
        "chuggy.internal/profile": "standard",
        "chuggy.internal/runtime-version": "1",
      },
    },
    spec: {
      restartPolicy: "Never",
      serviceAccountName: "chuggy-worker",
      automountServiceAccountToken: false,
      activeDeadlineSeconds: 3_600,
      nodeSelector: { "kubernetes.io/os": "linux" },
      securityContext: { runAsNonRoot: true },
      containers: [
        {
          name: kubernetesWorkerContainerName,
          image: workerImage,
          env: [{ name: kubernetesWorkerTaskVariable, value: expectedTask() }],
          resources: {
            requests: { cpu: "500m", memory: "1Gi" },
            limits: { cpu: "1", memory: "2Gi" },
          },
          securityContext: { allowPrivilegeEscalation: false },
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
  const request = reached[0];
  assert.equal(request?.method, "POST");
  assert.equal(
    request.url,
    "https://cluster.invalid:6443/api/v1/namespaces/chuggy-workers/pods",
  );
  assert.equal(request.authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(request.body ?? ""), expectedPod(name));
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
  await workers.cancel(placement);
  const name = kubernetesWorkerPodName(config, partition, placement.attempt);
  assert.deepEqual(
    reached.map((request) => `${request.method} ${request.url}`),
    [
      `DELETE https://cluster.invalid:6443/api/v1/namespaces/chuggy-workers/pods/${name}`,
    ],
  );
});

test("a profile no admitted image runs is a definitive inability", async () => {
  const workers = kubernetesWorkerLaunch(
    config,
    recordingCluster([], answering(201)),
  );
  assert.deepEqual(
    await workers.place({
      ...placement,
      profile: { profile: "elevated", runtimeVersion: "1" },
    }),
    { placed: "Denied", reason: "ExecutionProfileUnavailable" },
  );
  assert.deepEqual(
    await workers.place({
      ...placement,
      profile: { profile: "standard", runtimeVersion: "2" },
    }),
    { placed: "Denied", reason: "RuntimeVersionUnsupported" },
  );
});

test("an unadmitted placement never reaches the cluster", async () => {
  const reached: ClusterReached[] = [];
  const workers = kubernetesWorkerLaunch(
    config,
    recordingCluster(reached, answering(201)),
  );
  await workers.place({
    ...placement,
    profile: { profile: "elevated", runtimeVersion: "1" },
  });
  assert.deepEqual(reached, []);
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
    [409, placed],
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
    { imagesAdmitted: [] },
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
