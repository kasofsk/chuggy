/**
 * The document one placed session attempt submits: what names it, what the pod
 * is told, and what it is refused.
 *
 * THE ENVIRONMENT IS ASSERTED AS A WHOLE rather than variable by variable,
 * because the claim being made is that a session is told what the placement and
 * the site supplied and nothing else — a claim a per-variable assertion cannot
 * make, since the variable nobody thought to assert is exactly the one that
 * leaks. The task document is asserted the same way, and that is what pins the
 * absence of a briefing, a requirement and a pinned configuration.
 *
 * IDEMPOTENCE IS ASSERTED AGAINST A SECOND GENERATION, not against a second
 * call with the same arguments. A pure function repeating itself proves
 * nothing; what a repeated placement needs is that the *fenced* identity moving
 * on still names the object the first request created, and the generation is
 * precisely what moves.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  kubernetesNameCharsMax,
  kubernetesSessionTaskVariable,
  kubernetesWorkerCredentialFilesVariable,
  kubernetesWorkerTaskVariable,
  kubernetesWorkerWorkspaceVariable,
} from "../../src/adapters/kubernetes/kubernetesSite.ts";
import {
  checkedKubernetesSessionLaunchConfig,
  kubernetesSessionConfigDirVariable,
  kubernetesSessionContainerName,
  kubernetesSessionModelVariable,
  kubernetesSessionPodName,
  kubernetesSessionBudgetUsdMin,
  kubernetesSessionPodRequest,
  kubernetesSessionReservedVariables,
  kubernetesSessionSecret,
  kubernetesSessionTask,
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
import type { PolicyAuthorityGrant } from "../../src/interpreter/taskAuthority.ts";
import { populated } from "../interpreter/roster.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const agentCredential = {
  secretName: "claude-code-credential",
  key: "token",
  mountPath: "/var/run/chuggy/claude-code/token",
} as const;

const forgeCredential = {
  secretName: "forge-credential",
  key: "token",
  mountPath: "/var/run/chuggy/forge/token",
} as const;

const config: KubernetesSessionLaunchConfig = {
  apiBaseUrl: "https://cluster.invalid:6443",
  namespace: "chuggy-work",
  tokenFile: "/var/run/secrets/cluster/token",
  serviceAccountName: "chuggy-session",
  podNamePrefix: "chuggy-session",
  workerPlaneUrl: "http://chuggy-worker-plane.invalid:3001",
  capabilityFile: "/var/run/chuggy/session-capability/bearer",
  workspacePath: "/workspace",
  credentialMounts: {
    "claude-code": agentCredential,
    forge: forgeCredential,
  },
  environment: { CHUG_SITE: "rig" },
  resources: {
    cpuRequest: "500m",
    cpuLimit: "1",
    memoryRequest: "1Gi",
    memoryLimit: "2Gi",
    ephemeralStorageLimit: "10Gi",
  },
  podLabels: { "chuggy.dev/session": "true" },
  podAnnotations: { "site.invalid/tier": "interactive" },
  nodeSelector: { "kubernetes.io/os": "linux" },
  podSecurityContext: { runAsNonRoot: true },
  containerSecurityContext: { allowPrivilegeEscalation: false },
  activeDeadlineSecs: 3_600,
  requestTimeoutSecsMax: 5,
  unavailableRetryAfterSecs: 15,
  bounds: {
    mailboxPollMs: 1_000,
    idleMs: 300_000,
    resultDrainMs: 2_000,
    loadTimeoutMs: 120_000,
    turnsMax: 200,
    budgetUsd: 5,
  },
  model: "claude-opus-4-5",
};

const grant: PolicyAuthorityGrant = {
  tools: [],
  credentials: ["claude-code"],
  network: true,
  filesystem: "WriteWorkspace",
  mayCompleteTask: false,
};

const placement: SessionPlacement = {
  partition,
  session: asSessionId("session-one"),
  attempt: asSessionAttemptId("session-attempt-one"),
  generation: 3,
  kind: "Lead",
  capabilities: ["RepositoryRead", "RunCommands"],
  credentialSlot: "claude-code",
  agentReference: "1a2b3c",
  profile: { profile: "standard", runtimeVersion: "1" },
  image: "registry.invalid/worker:1",
  authority: grant,
  bearer: {
    id: asSessionBearerId("bearer-one"),
    secret: asSessionBearerSecret(`chgs_${"a".repeat(64)}`),
  },
};

/** The pod one placement renders, or the failure of a case that assumed it renders one. */
function renderedPod(
  input: KubernetesSessionLaunchConfig = config,
  placed: SessionPlacement = placement,
) {
  const requested = kubernetesSessionPodRequest(input, placed);
  if (requested.requested !== "Pod")
    throw new Error(`the placement was denied: ${requested.reason}`);
  return requested.pod;
}

/** The one container of the rendered pod, which is where everything a session reads is. */
function renderedContainer(
  input: KubernetesSessionLaunchConfig = config,
  placed: SessionPlacement = placement,
) {
  const container = renderedPod(input, placed).spec.containers[0];
  if (container === undefined) throw new Error("the pod has no container");
  return container;
}

test("a session pod is named for its attempt, and its name fits the API's bound", () => {
  const name = kubernetesSessionPodName(config, partition, placement.attempt);
  assert.match(name, /^chuggy-session-[0-9a-f]{64}$/u);
  assert.ok(name.length <= kubernetesNameCharsMax);
});

test("a later generation of one attempt names the pod the first placement created", () => {
  assert.equal(
    renderedPod().metadata.name,
    renderedPod(config, { ...placement, generation: placement.generation + 1 })
      .metadata.name,
  );
  assert.notEqual(
    renderedPod().metadata.annotations["chuggy.internal/generation"],
    renderedPod(config, { ...placement, generation: placement.generation + 1 })
      .metadata.annotations["chuggy.internal/generation"],
  );
});

test("a different attempt of one session names a different pod", () => {
  assert.notEqual(
    kubernetesSessionPodName(config, partition, placement.attempt),
    kubernetesSessionPodName(
      config,
      partition,
      asSessionAttemptId("session-attempt-two"),
    ),
  );
});

test("the bearer Secret is immutable and owned by the pod it is projected into", () => {
  const secret = kubernetesSessionSecret(config, placement, "pod-uid-one");
  assert.deepEqual(secret, {
    apiVersion: "v1",
    kind: "Secret",
    immutable: true,
    metadata: {
      name: renderedPod().metadata.name,
      namespace: config.namespace,
      ownerReferences: [
        {
          apiVersion: "v1",
          kind: "Pod",
          name: renderedPod().metadata.name,
          uid: "pod-uid-one",
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    stringData: { bearer: placement.bearer.secret },
  });
});

test("a session is handed its fence, what it may do and where its mailbox is, and nothing else", () => {
  assert.deepEqual(kubernetesSessionTask(config, placement), {
    tenant: "tenant",
    project: "project",
    session: "session-one",
    kind: "Lead",
    attempt: "session-attempt-one",
    generation: 3,
    capabilities: ["RepositoryRead", "RunCommands"],
    credentialSlot: "claude-code",
    agentReference: "1a2b3c",
    authority: grant,
    workerPlane: {
      url: config.workerPlaneUrl,
      capabilityFile: config.capabilityFile,
    },
    bounds: config.bounds,
  });
});

test("a session that has never run is handed no runtime reference to resume", () => {
  const unrun: SessionPlacement = {
    partition,
    session: placement.session,
    attempt: placement.attempt,
    generation: placement.generation,
    kind: placement.kind,
    capabilities: placement.capabilities,
    credentialSlot: placement.credentialSlot,
    profile: placement.profile,
    image: placement.image,
    authority: placement.authority,
    bearer: placement.bearer,
  };
  assert.ok(
    !Object.hasOwn(kubernetesSessionTask(config, unrun), "agentReference"),
  );
});

test("the container's whole environment is the contract, in the order it is written", () => {
  assert.deepEqual(renderedContainer().env, [
    {
      name: "CHUG_SESSION_TASK",
      value: JSON.stringify(kubernetesSessionTask(config, placement)),
    },
    {
      name: kubernetesWorkerCredentialFilesVariable,
      value: JSON.stringify({ "claude-code": agentCredential.mountPath }),
    },
    { name: kubernetesWorkerWorkspaceVariable, value: "/workspace" },
    { name: kubernetesSessionConfigDirVariable, value: "/workspace/.claude" },
    { name: kubernetesSessionModelVariable, value: "claude-opus-4-5" },
    { name: "CHUG_SITE", value: "rig" },
  ]);
});

test("the session container runs the placement's image under the site's budget", () => {
  const container = renderedContainer();
  assert.equal(container.name, kubernetesSessionContainerName);
  assert.equal(container.image, placement.image);
  assert.deepEqual(container.resources, {
    requests: { cpu: "500m", memory: "1Gi", "ephemeral-storage": "10Gi" },
    limits: { cpu: "1", memory: "2Gi", "ephemeral-storage": "10Gi" },
  });
  assert.deepEqual(container.securityContext, config.containerSecurityContext);
});

test("only the credentials the grant names are mounted, and the workspace is ephemeral", () => {
  const pod = renderedPod();
  assert.deepEqual(pod.spec.volumes, [
    {
      name: "session-capability",
      secret: {
        secretName: pod.metadata.name,
        defaultMode: 0o400,
        items: [{ key: "bearer", path: "bearer" }],
      },
    },
    { name: "session-workspace", emptyDir: { sizeLimit: "10Gi" } },
    {
      name: "session-credential-0",
      projected: {
        defaultMode: 0o400,
        sources: [
          {
            secret: {
              name: agentCredential.secretName,
              items: [{ key: agentCredential.key, path: "token" }],
            },
          },
        ],
      },
    },
  ]);
  assert.deepEqual(renderedContainer().volumeMounts, [
    {
      name: "session-capability",
      mountPath: config.capabilityFile,
      subPath: "bearer",
      readOnly: true,
    },
    { name: "session-workspace", mountPath: "/workspace", readOnly: false },
    {
      name: "session-credential-0",
      mountPath: "/var/run/chuggy/claude-code",
      readOnly: true,
    },
  ]);
});

test("a grant naming a credential this site does not mount is denied", () => {
  assert.deepEqual(
    kubernetesSessionPodRequest(config, {
      ...placement,
      authority: { ...grant, credentials: ["claude-code", "unmounted"] },
    }),
    { requested: "Denied", reason: "RequiredCapabilityUnavailable" },
  );
});

test("a credential slot the grant does not name is denied rather than placed", () => {
  assert.deepEqual(
    kubernetesSessionPodRequest(config, {
      ...placement,
      credentialSlot: "forge",
    }),
    { requested: "Denied", reason: "RequiredCapabilityUnavailable" },
  );
});

test("a site environment cannot replace any variable the launcher writes itself", () => {
  assert.deepEqual(kubernetesSessionReservedVariables, [
    kubernetesSessionTaskVariable,
    kubernetesWorkerTaskVariable,
    kubernetesWorkerCredentialFilesVariable,
    kubernetesWorkerWorkspaceVariable,
    kubernetesSessionConfigDirVariable,
    kubernetesSessionModelVariable,
  ]);
  for (const variable of populated(
    kubernetesSessionReservedVariables,
    "the session's reserved variables",
  )) {
    assert.throws(
      () =>
        checkedKubernetesSessionLaunchConfig({
          ...config,
          environment: { [variable]: "site" },
        }),
      RangeError,
      variable,
    );
  }
});

test("the pod carries this deployment's own labels and no other pod kind's", () => {
  const pod = renderedPod();
  assert.deepEqual(pod.metadata.labels, config.podLabels);
  assert.deepEqual(pod.metadata.labels, { "chuggy.dev/session": "true" });
  assert.deepEqual(
    renderedPod({ ...config, podLabels: {} }).metadata.labels,
    {},
  );
});

test("the pod carries the wall clock this deployment gave it", () => {
  assert.equal(
    renderedPod().spec.activeDeadlineSeconds,
    config.activeDeadlineSecs,
  );
  assert.equal(
    renderedPod({ ...config, activeDeadlineSecs: 60 }).spec
      .activeDeadlineSeconds,
    60,
  );
});

test("a dollar cap the image can spend a fraction of is a bound and not an error", () => {
  const halved = {
    ...config,
    bounds: { ...config.bounds, budgetUsd: 0.5 },
  };
  assert.deepEqual(checkedKubernetesSessionLaunchConfig(halved), halved);
  const least = {
    ...config,
    bounds: { ...config.bounds, budgetUsd: kubernetesSessionBudgetUsdMin },
  };
  assert.deepEqual(checkedKubernetesSessionLaunchConfig(least), least);
  assert.equal(kubernetesSessionTask(halved, placement).bounds.budgetUsd, 0.5);
  for (const refused of [
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    kubernetesSessionBudgetUsdMin / 10,
  ]) {
    assert.throws(
      () =>
        checkedKubernetesSessionLaunchConfig({
          ...config,
          bounds: { ...config.bounds, budgetUsd: refused },
        }),
      RangeError,
      String(refused),
    );
  }
});

test("a configuration that cannot address a cluster or bound a pod is refused", () => {
  const refusals: readonly Partial<KubernetesSessionLaunchConfig>[] = [
    { apiBaseUrl: "https://user:secret@cluster.invalid:6443" },
    { namespace: "Chuggy_Work" },
    { serviceAccountName: "" },
    { podNamePrefix: "s".repeat(kubernetesNameCharsMax) },
    { tokenFile: "" },
    { workerPlaneUrl: "http://user:secret@plane.invalid:3001" },
    { capabilityFile: "run/chuggy/bearer" },
    { workspacePath: "workspace" },
    { model: "" },
    { activeDeadlineSecs: 0 },
    { requestTimeoutSecsMax: 0 },
    { unavailableRetryAfterSecs: 0 },
    { bounds: { ...config.bounds, idleMs: 0 } },
    { bounds: { ...config.bounds, turnsMax: 1.5 } },
    { bounds: { ...config.bounds, budgetUsd: 0 } },
  ];
  for (const refused of refusals) {
    assert.throws(
      () => checkedKubernetesSessionLaunchConfig({ ...config, ...refused }),
      RangeError,
      JSON.stringify(refused),
    );
  }
  assert.deepEqual(checkedKubernetesSessionLaunchConfig(config), config);
});
