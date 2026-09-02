/**
 * The Kubernetes session-launch adapter: what one placed session attempt is
 * asked of a cluster, and what each answer means for it.
 *
 * THE NEGATIVE SPACE IS HALF THE POINT, and it is 006's two inabilities once
 * more: a refusal of the submitted document is the site declining to run this
 * pod, and every other answer describes the cluster at this moment and holds.
 * A placement the renderer itself denies must reach no cluster at all.
 *
 * A POD WITH NO BEARER IS WORSE THAN NO POD. The Secret is owned by the pod, so
 * it can only be made after the pod exists; a Secret that could not be made
 * therefore has to take the pod with it, or a container that can reach nothing
 * sits until its deadline holding the session's only live attempt.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { kubernetesSessionLaunch } from "../../src/adapters/kubernetes/sessionLaunch.ts";
import {
  kubernetesSessionPodName,
  type KubernetesSessionLaunchConfig,
} from "../../src/adapters/kubernetes/sessionPod.ts";
import {
  asSessionAttemptId,
  asSessionBearerId,
  asSessionBearerSecret,
  asSessionId,
} from "../../src/interpreter/agentSession.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type { SessionPlacement } from "../../src/interpreter/sessionScheduler.ts";

const root = mkdtempSync(join(tmpdir(), "chuggy-session-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

const tokenFile = join(root, "token");
writeFileSync(tokenFile, "cluster-token-value\n");

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const config: KubernetesSessionLaunchConfig = {
  apiBaseUrl: "https://cluster.invalid:6443",
  namespace: "chuggy-work",
  tokenFile,
  serviceAccountName: "chuggy-session",
  podNamePrefix: "chuggy-session",
  workerPlaneUrl: "http://chuggy-worker-plane.invalid:3001",
  capabilityFile: "/var/run/chuggy/session-capability/bearer",
  workspacePath: "/workspace",
  credentialMounts: {
    "claude-code": {
      secretName: "claude-code-credential",
      key: "token",
      mountPath: "/var/run/chuggy/claude-code/token",
    },
  },
  environment: {},
  resources: {
    cpuRequest: "500m",
    cpuLimit: "1",
    memoryRequest: "1Gi",
    memoryLimit: "2Gi",
    ephemeralStorageLimit: "10Gi",
  },
  podLabels: {},
  podAnnotations: {},
  nodeSelector: {},
  podSecurityContext: {},
  containerSecurityContext: {},
  activeDeadlineSecs: 3_600,
  requestTimeoutSecsMax: 5,
  unavailableRetryAfterSecs: 17,
  bounds: {
    mailboxPollMs: 1_000,
    idleMs: 300_000,
    resultDrainMs: 2_000,
    loadTimeoutMs: 120_000,
    turnsMax: 200,
    budgetUsd: 5,
  },
  model: "claude-opus-4-5",
  apiUrl: "https://api.invalid",
};

const placement: SessionPlacement = {
  partition,
  session: asSessionId("session-one"),
  attempt: asSessionAttemptId("session-attempt-one"),
  generation: 2,
  kind: "Lead",
  capabilities: ["RepositoryRead"],
  credentialSlot: "claude-code",
  profile: { profile: "standard", runtimeVersion: "1" },
  image: "registry.invalid/worker:1",
  authority: {
    tools: [],
    credentials: ["claude-code"],
    network: true,
    filesystem: "WriteWorkspace",
    mayCompleteTask: false,
  },
  bearer: {
    id: asSessionBearerId("bearer-one"),
    secret: asSessionBearerSecret(`chgs_${"a".repeat(64)}`),
  },
};

const podName = kubernetesSessionPodName(config, partition, placement.attempt);

/** One act against the cluster, kept as `METHOD path` so a whole exchange is one array. */
type ClusterAct = string;

/** What kind of object one path names, which is all a case has to answer by. */
function objectOf(url: string): "pod" | "secret" {
  return new URL(url).pathname.includes("/secrets") ? "secret" : "pod";
}

/**
 * A cluster answering one status per object kind, recording the exchange. A pod
 * the cluster holds answers with the document it was given and a uid, because a
 * uid is what the adapter needs before a Secret may be owned by it, and the
 * adapter reads the document back to be sure the pod is the one it asked for.
 */
function cluster(
  acts: ClusterAct[],
  answers: { readonly pod: number; readonly secret?: number },
): typeof fetch {
  let submitted: unknown = {};
  return (input, init) => {
    const url = input instanceof URL ? input.href : (input as string);
    const method = init?.method ?? "GET";
    acts.push(`${method} ${new URL(url).pathname}`);
    const kind = objectOf(url);
    if (kind === "pod" && method === "POST" && typeof init?.body === "string")
      submitted = (JSON.parse(init.body) as { readonly metadata: unknown })
        .metadata;
    const status = kind === "secret" ? (answers.secret ?? 201) : answers.pod;
    const held = status === 409 && method === "GET" ? 200 : status;
    if (kind === "pod" && (held === 200 || held === 201))
      return Promise.resolve(
        Response.json(
          { metadata: { ...(submitted as object), uid: "session-pod-uid" } },
          { status: held },
        ),
      );
    return Promise.resolve(new Response(null, { status }));
  };
}

test("a placed session is one pod and one pod-owned Secret", async () => {
  const acts: ClusterAct[] = [];
  const placed = await kubernetesSessionLaunch(
    config,
    cluster(acts, { pod: 201 }),
  ).place(placement);
  assert.deepEqual(placed, { placed: "Placed", placement: podName });
  assert.deepEqual(acts, [
    "POST /api/v1/namespaces/chuggy-work/pods",
    "POST /api/v1/namespaces/chuggy-work/secrets",
  ]);
});

test("a pod the cluster already holds is this attempt's placement, not a second one", async () => {
  const acts: ClusterAct[] = [];
  const placed = await kubernetesSessionLaunch(
    config,
    cluster(acts, { pod: 409 }),
  ).place(placement);
  assert.deepEqual(placed, { placed: "Placed", placement: podName });
  assert.deepEqual(acts, [
    "POST /api/v1/namespaces/chuggy-work/pods",
    `GET /api/v1/namespaces/chuggy-work/pods/${podName}`,
    "POST /api/v1/namespaces/chuggy-work/secrets",
  ]);
});

test("a refused document is the site declining, and every other answer holds", async () => {
  for (const status of [400, 413, 415, 422]) {
    assert.deepEqual(
      await kubernetesSessionLaunch(config, cluster([], { pod: status })).place(
        placement,
      ),
      { placed: "Denied", reason: "ExecutionPolicyDenied" },
    );
  }
  for (const status of [403, 429, 500, 503]) {
    assert.deepEqual(
      await kubernetesSessionLaunch(config, cluster([], { pod: status })).place(
        placement,
      ),
      { placed: "Unavailable", retryAfterSeconds: 17 },
    );
  }
});

test("a cluster that does not answer holds rather than denies", async () => {
  const placed = await kubernetesSessionLaunch(config, () =>
    Promise.reject(new Error("no route to host")),
  ).place(placement);
  assert.deepEqual(placed, { placed: "Unavailable", retryAfterSeconds: 17 });
});

test("a pod whose bearer Secret could not be made is deleted rather than left running", async () => {
  const acts: ClusterAct[] = [];
  const placed = await kubernetesSessionLaunch(
    config,
    cluster(acts, { pod: 201, secret: 500 }),
  ).place(placement);
  assert.deepEqual(placed, { placed: "Unavailable", retryAfterSeconds: 17 });
  assert.deepEqual(acts, [
    "POST /api/v1/namespaces/chuggy-work/pods",
    "POST /api/v1/namespaces/chuggy-work/secrets",
    `DELETE /api/v1/namespaces/chuggy-work/pods/${podName}`,
  ]);
});

test("a placement the document refuses reaches no cluster at all", async () => {
  const acts: ClusterAct[] = [];
  const placed = await kubernetesSessionLaunch(
    config,
    cluster(acts, { pod: 201 }),
  ).place({ ...placement, credentialSlot: "unmounted" });
  assert.deepEqual(placed, {
    placed: "Denied",
    reason: "RequiredCapabilityUnavailable",
  });
  assert.deepEqual(acts, []);
});

test("cancelling deletes the pod this attempt derives, and a pod already gone is accepted", async () => {
  for (const [status, cancelled] of [
    [200, "Accepted"],
    [202, "Accepted"],
    [404, "Accepted"],
    [500, "Unavailable"],
  ] as const) {
    const acts: ClusterAct[] = [];
    assert.deepEqual(
      await kubernetesSessionLaunch(
        config,
        cluster(acts, { pod: status }),
      ).cancel(placement),
      { cancelled },
    );
    assert.deepEqual(acts, [
      `DELETE /api/v1/namespaces/chuggy-work/pods/${podName}`,
    ]);
  }
});
