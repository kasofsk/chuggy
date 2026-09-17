import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import * as task from "../../src/domain/chuggernaut/task.js";
import {
  kubernetesTicketDatabaseContainerName,
  kubernetesTicketDatabaseUrl,
  kubernetesTicketDatabaseUrlVariable,
  kubernetesTicketDatabaseWorkersVariable,
  kubernetesTicketExecutionPodName,
  kubernetesTicketExecutionRunner,
  ticketExecutionVerdict,
  type KubernetesTicketExecutionConfig,
} from "../../src/adapters/kubernetes/ticketExecution.ts";
import {
  asRepositoryCredential,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asRecoveryEpoch,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import type {
  TicketExecutionClaim,
  TicketExecutionRunner,
  TicketExecutionView,
} from "../../src/interpreter/ticketExecution.ts";

const root = mkdtempSync(join(tmpdir(), "chuggy-ticket-kube-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});
const tokenFile = join(root, "token");
writeFileSync(tokenFile, "cluster-token\n");

const config: KubernetesTicketExecutionConfig = {
  apiBaseUrl: "https://cluster.invalid:6443",
  namespace: "tickets",
  tokenFile,
  serviceAccountName: "ticket-worker",
  nodeSelector: { "kubernetes.io/os": "linux" },
  podSecurityContext: { runAsNonRoot: true },
  containerSecurityContext: { allowPrivilegeEscalation: false },
  requestTimeoutSecsMax: 2,
  unavailableRetryAfterSecs: 3,
  workerPlaneUrl: "https://worker.invalid",
  capabilityFile: "/run/unused",
  workspacePath: "/workspace",
  credentialMounts: {
    "codex-auth": {
      secretName: "codex-auth",
      key: "auth.json",
      mountPath: "/var/run/chuggy/codex/auth.json",
    },
  },
  environment: { TICKET_SITE: "configured" },
  podNamePrefix: "ticket",
  image: "registry.invalid/ticket-worker:1",
  callbackUrl: "https://worker.invalid/v1/ticket-terminal",
  credentialUsername: "x-access-token",
  resources: {
    cpuRequest: "100m",
    cpuLimit: "1",
    memoryRequest: "128Mi",
    memoryLimit: "512Mi",
    ephemeralStorageLimit: "1Gi",
  },
  podLabels: { "app.kubernetes.io/name": "ticket-worker" },
  podAnnotations: {},
  activeDeadlineSecs: 60,
  timeoutSecsMax: 30,
  outputBytesMax: 4096,
  outcomePollMs: 1,
  outcomePollsMax: 2,
  leaseSecs: 30,
  retryAfterSecs: 5,
  capabilities: ["shell"],
};

const partition = { tenant: "tenant", project: "project" } as Partition;
const obligation = new task.TaskObligation(
  new task.WorkTaskId(task.TicketId(1), task.CycleNumber(1)),
  new task.TaskDefinition(
    task.ContentRef(1),
    task.ContentRef(2),
    new task.ExecutionRequirements(
      task.ContentRef(3),
      new task.ReadRepository(),
    ),
    task.ContentRef(4),
  ),
  new task.WorkspaceSource(task.ContentRef(3), task.Digest(5)),
  [],
);
const claim: TicketExecutionClaim = {
  partition,
  identity: "delivery",
  taskKey: "work:1:1",
  obligation,
  attempt: 2,
  recoveryEpoch: asRecoveryEpoch("epoch"),
};
const evaluationClaim: TicketExecutionClaim = {
  ...claim,
  taskKey: "evaluation:1:1:review:1:quality",
  obligation: new task.TaskObligation(
    new task.EvaluationTaskId(
      task.TicketId(1),
      task.CycleNumber(1),
      task.StageKey(1),
      task.Generation(1),
      task.EvaluatorKey(1),
    ),
    obligation.definition,
    obligation.source,
    [],
  ),
};
const view: TicketExecutionView = {
  workload: {
    runner: "codex",
    prompt: "do work",
    execution_profile: {
      name: "standard",
      required_capabilities: ["shell"],
      runner_command: ["node", "/usr/local/lib/chuggy/ticketWorker.ts"],
      cpu: 250,
      memory_mb: 384,
    },
  },
  inputs: {},
  resultContract: { type: "object" },
  repository: "https://git.invalid/owner/repository.git",
  commit: "0123456789012345678901234567890123456789",
  access: "ReadRepository",
  requiredCapabilities: ["shell"],
  context: [],
};

const duplicateFindingOutcome = {
  type: "result",
  manifest: {
    verdict: "fail",
    findings: [
      { id: 1, description: "first" },
      { id: 1, description: "second" },
    ],
  },
  outputs: [],
} as const;

interface ClusterRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: string;
}

function clusterFetch(requests: ClusterRequest[]): typeof fetch {
  return (input, init) => {
    const url = new URL(
      input instanceof URL
        ? input.href
        : typeof input === "string"
          ? input
          : input.url,
    );
    requests.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    if (init?.method === "DELETE")
      return Promise.resolve(new Response("", { status: 404 }));
    if (url.pathname.endsWith("/pods") && init?.method === "POST") {
      if (typeof init.body !== "string") throw new Error("pod body is absent");
      const pod = JSON.parse(init.body) as {
        readonly metadata: Record<string, unknown>;
      };
      return Promise.resolve(
        new Response(
          JSON.stringify({ metadata: { ...pod.metadata, uid: "pod-uid" } }),
          { status: 201 },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 201 }));
  };
}

function postedBody(
  requests: readonly ClusterRequest[],
  collection: string,
): string {
  const request = requests.find(
    (candidate) =>
      candidate.method === "POST" && candidate.path.endsWith(collection),
  );
  assert.ok(request?.body !== undefined);
  return request.body;
}

async function assertMalformedOutcomes(
  runner: TicketExecutionRunner,
  stored: readonly { readonly content: string }[],
): Promise<void> {
  assert.equal((await runner.run(claim, view)).result, "ProcessFailed");
  assert.match(
    stored.at(-1)?.content ?? "",
    /worker outcome must be an object/u,
  );
  assert.equal(
    (await runner.run(claim, { ...view, access: "PublishRepositoryResult" }))
      .result,
    "ProcessFailed",
  );
  assert.equal(
    stored.at(-1)?.content,
    "ticket execution output repository is invalid",
  );
  const uppercase = await runner.run(claim, {
    ...view,
    access: "PublishRepositoryResult",
  });
  assert.equal(uppercase.result, "Produced");
  assert.equal(
    stored.at(-1)?.content,
    "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
  );
}

function assertSecretEnvelope(requests: readonly ClusterRequest[]): void {
  assert.doesNotMatch(
    postedBody(requests, "/pods"),
    /attempt-secret|repository-token/u,
  );
  const secret = JSON.parse(postedBody(requests, "/secrets")) as {
    readonly stringData: { readonly task: string };
  };
  const envelope = JSON.parse(secret.stringData.task) as {
    readonly bearer: string;
    readonly transportUrl: string;
    readonly providerCredentialFile: string;
    readonly view: { readonly repository: string };
  };
  assert.equal(envelope.bearer, "attempt-secret");
  assert.equal(envelope.view.repository, view.repository);
  assert.equal(new URL(envelope.transportUrl).password, "repository-token");
  assert.equal(
    envelope.providerCredentialFile,
    "/var/run/chuggy/codex/auth.json",
  );
  const pod = JSON.parse(postedBody(requests, "/pods")) as {
    readonly spec: {
      readonly containers: readonly {
        readonly command: readonly string[];
        readonly resources: { readonly limits: Record<string, string> };
        readonly volumeMounts: readonly { readonly mountPath: string }[];
      }[];
    };
  };
  assert.deepEqual(pod.spec.containers[0]?.command, ["node"]);
  assert.equal(pod.spec.containers[0]?.resources.limits["cpu"], "250m");
  assert.equal(pod.spec.containers[0]?.resources.limits["memory"], "384Mi");
  assert.ok(
    pod.spec.containers[0]?.volumeMounts.some(
      ({ mountPath }) => mountPath === "/var/run/chuggy/codex",
    ),
  );
  assert.equal(requests.at(-1)?.method, "DELETE");
}

function ticketOutcome(state: { reads: number }): Promise<unknown> {
  state.reads += 1;
  if (state.reads === 1) return Promise.resolve(undefined);
  if (state.reads === 2) return Promise.resolve(duplicateFindingOutcome);
  if (state.reads === 3) return Promise.resolve(null);
  if (state.reads === 4)
    return Promise.resolve({
      type: "result",
      manifest: { verdict: "pass" },
      outputs: [{ repository: "wrong", commit: "not-a-commit" }],
    });
  return Promise.resolve({
    type: "result",
    manifest: {},
    outputs: [
      {
        repository: view.repository,
        commit: "ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD",
      },
    ],
  });
}

function runnerForOutcome(outcome: unknown): TicketExecutionRunner {
  return kubernetesTicketExecutionRunner(
    () => ({
      put: (_mediaType, content) =>
        Promise.resolve(task.ContentRef(content.length + 1)),
      read: () => Promise.resolve(undefined),
    }),
    {
      bind: () => Promise.resolve(true),
      outcome: () => Promise.resolve(outcome),
      renew: () => Promise.resolve(true),
    },
    {
      binding: () =>
        Promise.resolve({
          partition,
          repository: asRepositoryId(view.repository),
          recoveryEpoch: asRecoveryEpoch("epoch"),
        }),
    },
    {
      credential: () =>
        Promise.resolve({
          resolved: "Credential",
          credential: asRepositoryCredential("repository-token"),
        }),
    },
    config,
    clusterFetch([]),
    () => "attempt-secret",
  );
}

test("launches one isolated adopted worker and keeps its authority in the Secret", async () => {
  const requests: ClusterRequest[] = [];
  const credentialAccesses: string[] = [];
  const outcomes = { reads: 0 };
  const stored: { readonly mediaType: string; readonly content: string }[] = [];
  const runner = kubernetesTicketExecutionRunner(
    () => ({
      put: (mediaType, content) => {
        stored.push({ mediaType, content });
        return Promise.resolve(task.ContentRef(stored.length));
      },
      read: () => Promise.resolve(undefined),
    }),
    {
      bind: (_claim, secret) => {
        assert.equal(secret, "attempt-secret");
        return Promise.resolve(true);
      },
      outcome: () => ticketOutcome(outcomes),
      renew: () => Promise.resolve(true),
    },
    {
      binding: (askedPartition, repository) => {
        assert.deepEqual(askedPartition, partition);
        assert.equal(repository, asRepositoryId(view.repository));
        return Promise.resolve({
          partition,
          repository: asRepositoryId(view.repository),
          recoveryEpoch: asRecoveryEpoch("epoch"),
        });
      },
    },
    {
      credential: (_binding, access) => {
        credentialAccesses.push(access);
        return Promise.resolve({
          resolved: "Credential",
          credential: asRepositoryCredential("repository-token"),
        });
      },
    },
    config,
    clusterFetch(requests),
    () => "attempt-secret",
  );
  const result = await runner.run(claim, view);
  assert.equal(result.result, "Produced");
  if (result.result !== "Produced") throw new Error("result was not produced");
  assert.equal(result.terminal.result.value, 1);
  assert.deepEqual(result.terminal.result.findings, []);
  assert.equal(outcomes.reads, 2);
  assertSecretEnvelope(requests);
  await assertMalformedOutcomes(runner, stored);
  assert.deepEqual(credentialAccesses, [
    "ReadRepository",
    "ReadRepository",
    "PublishRepositoryResult",
    "PublishRepositoryResult",
  ]);
});

test("decodes evaluator verdicts and findings with upstream semantics", async () => {
  const stored: string[] = [];
  const content = {
    put: (_mediaType: string, value: string) => {
      stored.push(value);
      return Promise.resolve(task.ContentRef(stored.length));
    },
    read: () => Promise.resolve(undefined),
  };
  await assert.rejects(
    ticketExecutionVerdict(content, evaluationClaim, { verdict: "PASS" }),
    /verdict is invalid/u,
  );
  await assert.rejects(
    ticketExecutionVerdict(content, evaluationClaim, {
      verdict: "pass",
      findings: [{ description: "unexpected" }],
    }),
    /passing evaluator manifest/u,
  );
  const decoded = await ticketExecutionVerdict(content, evaluationClaim, {
    verdict: "failed",
    findings: [{ id: 1.5, description: "fractional falls back" }],
  });
  assert.equal(decoded.value, 0);
  assert.equal(decoded.findings[0]?.id, 1);
});

test("invalid evaluator verdicts become process failures", async () => {
  for (const manifest of [
    { verdict: "PASS" },
    { verdict: "pass", findings: [{ description: "unexpected" }] },
  ]) {
    const result = await runnerForOutcome({
      type: "result",
      manifest,
      outputs: [],
    }).run(evaluationClaim, view);
    assert.equal(result.result, "ProcessFailed");
  }
  const result = await runnerForOutcome({
    type: "result",
    manifest: {
      verdict: "failed",
      findings: [{ id: 1.5, description: "fractional falls back" }],
    },
    outputs: [],
  }).run(evaluationClaim, view);
  assert.equal(result.result, "Produced");
  if (result.result !== "Produced") throw new Error("result was not produced");
  assert.equal(result.terminal.result.findings[0]?.id, 1);
});

for (const [name, unavailableView] of [
  [
    "refuses an unavailable capability before resolving repository authority",
    { ...view, requiredCapabilities: ["gpu"] },
  ],
  [
    "refuses cloud identity before launching without credentials",
    {
      ...view,
      workload: {
        runner: "codex",
        cloud_identity: { workload: "build", identity: "deployer" },
      },
    },
  ],
] as const)
  test(name, async () => {
    let reached = false;
    const runner = kubernetesTicketExecutionRunner(
      () => ({
        put: () => Promise.resolve(task.ContentRef(9)),
        read: () => Promise.resolve(undefined),
      }),
      {
        bind: () => Promise.resolve(true),
        outcome: () => Promise.resolve(undefined),
        renew: () => Promise.resolve(true),
      },
      {
        binding: () => {
          reached = true;
          return Promise.resolve(undefined);
        },
      },
      { credential: () => Promise.resolve({ resolved: "Denied" }) },
      config,
    );
    const result = await runner.run(claim, unavailableView);
    assert.equal(result.result, "ExecutionUnavailable");
    assert.equal(reached, false);
  });

test("cancellation deletes the deterministic task pod", async () => {
  const paths: string[] = [];
  const runner = kubernetesTicketExecutionRunner(
    () => ({
      put: () => Promise.resolve(task.ContentRef(1)),
      read: () => Promise.resolve(undefined),
    }),
    {
      bind: () => Promise.resolve(true),
      outcome: () => Promise.resolve(undefined),
      renew: () => Promise.resolve(true),
    },
    { binding: () => Promise.resolve(undefined) },
    { credential: () => Promise.resolve({ resolved: "Denied" }) },
    config,
    (input, init) => {
      const url =
        input instanceof URL
          ? input
          : new URL(typeof input === "string" ? input : input.url);
      paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
      return Promise.resolve(new Response("", { status: 200 }));
    },
  );
  await runner.cancel(claim);
  const successor = { ...claim, attempt: claim.attempt + 1 };
  assert.notEqual(
    kubernetesTicketExecutionPodName(config, claim),
    kubernetesTicketExecutionPodName(config, successor),
  );
  assert.deepEqual(paths, [
    `DELETE /api/v1/namespaces/tickets/pods/${kubernetesTicketExecutionPodName(config, claim)}`,
  ]);
});

const ticketDatabase = {
  image: "registry.invalid/postgres:18",
  resources: {
    cpuRequest: "250m",
    cpuLimit: "1",
    memoryRequest: "256Mi",
    memoryLimit: "1Gi",
    ephemeralStorageLimit: "4Gi",
  },
} as const;

interface PlacedPod {
  readonly spec: {
    readonly initContainers?: readonly {
      readonly name: string;
      readonly image: string;
      readonly args: readonly string[];
      readonly restartPolicy: string;
      readonly startupProbe: {
        readonly exec: { readonly command: readonly string[] };
      };
      readonly env: readonly {
        readonly name: string;
        readonly value: string;
      }[];
      readonly resources: { readonly limits: Record<string, string> };
      readonly volumeMounts: readonly {
        readonly name: string;
        readonly mountPath: string;
        readonly readOnly: boolean;
      }[];
    }[];
    readonly containers: readonly {
      readonly env: readonly {
        readonly name: string;
        readonly value?: string;
      }[];
    }[];
    readonly volumes: readonly { readonly name: string }[];
  };
}

/** The pod one run against a given site placed, which is where a sidecar is visible at all. */
async function placedPod(
  site: KubernetesTicketExecutionConfig,
): Promise<PlacedPod> {
  const requests: ClusterRequest[] = [];
  const runner = kubernetesTicketExecutionRunner(
    () => ({
      put: (_mediaType, content) =>
        Promise.resolve(task.ContentRef(content.length + 1)),
      read: () => Promise.resolve(undefined),
    }),
    {
      bind: () => Promise.resolve(true),
      outcome: () =>
        Promise.resolve({ type: "result", manifest: {}, outputs: [] }),
      renew: () => Promise.resolve(true),
    },
    {
      binding: () =>
        Promise.resolve({
          partition,
          repository: asRepositoryId(view.repository),
          recoveryEpoch: asRecoveryEpoch("epoch"),
        }),
    },
    {
      credential: () =>
        Promise.resolve({
          resolved: "Credential",
          credential: asRepositoryCredential("repository-token"),
        }),
    },
    site,
    clusterFetch(requests),
    () => "attempt-secret",
  );
  await runner.run(claim, view);
  return JSON.parse(postedBody(requests, "/pods")) as PlacedPod;
}

test("an attempt's gates are given a PostgreSQL of the pod's own", async () => {
  const pod = await placedPod({ ...config, database: ticketDatabase });
  const sidecar = pod.spec.initContainers?.[0];
  assert.equal(sidecar?.name, kubernetesTicketDatabaseContainerName);
  assert.equal(sidecar?.image, ticketDatabase.image);
  assert.deepEqual(sidecar?.args, ["-c", "listen_addresses=127.0.0.1"]);
  assert.equal(sidecar?.restartPolicy, "Always");
  assert.deepEqual(sidecar?.startupProbe.exec.command, [
    "pg_isready",
    "-h",
    "127.0.0.1",
    "-U",
    "postgres",
  ]);
  assert.deepEqual(sidecar?.env, [
    { name: "POSTGRES_HOST_AUTH_METHOD", value: "trust" },
  ]);
  assert.equal(
    sidecar?.resources.limits["cpu"],
    ticketDatabase.resources.cpuLimit,
  );
  assert.deepEqual(sidecar?.volumeMounts, [
    { name: "database", mountPath: "/var/lib/postgresql", readOnly: false },
  ]);
  assert.ok(pod.spec.volumes.some(({ name }) => name === "database"));
});

test("the address the gates are handed reaches nothing outside the pod", async () => {
  const pod = await placedPod({ ...config, database: ticketDatabase });
  const supplied = new Map(
    pod.spec.containers[0]?.env.map(({ name, value }) => [name, value]),
  );
  assert.equal(
    supplied.get(kubernetesTicketDatabaseUrlVariable),
    kubernetesTicketDatabaseUrl,
  );
  assert.equal(new URL(kubernetesTicketDatabaseUrl).hostname, "127.0.0.1");
  assert.equal(supplied.get(kubernetesTicketDatabaseWorkersVariable), "1");
});

test("a site that runs no database places a pod with no sidecar and names none", async () => {
  const pod = await placedPod(config);
  assert.equal(pod.spec.initContainers, undefined);
  assert.deepEqual(
    pod.spec.containers[0]?.env.filter(({ name }) =>
      name.startsWith("CHUG_PG_"),
    ),
    [],
  );
  assert.deepEqual(
    pod.spec.volumes.filter(({ name }) => name === "database"),
    [],
  );
});

test("a deployment naming a database the adapter cannot place is refused", async () => {
  await assert.rejects(
    placedPod({ ...config, database: { ...ticketDatabase, image: "" } }),
    /ticket worker database image is empty/u,
  );
  await assert.rejects(
    placedPod({
      ...config,
      environment: { [kubernetesTicketDatabaseUrlVariable]: "replacement" },
    }),
    new RegExp(kubernetesTicketDatabaseUrlVariable, "u"),
  );
});
