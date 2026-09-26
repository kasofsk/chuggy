/**
 * The one session placement the golden pins, kept beside the suite the same
 * way the worker's is. It exercises both optional fields the task document
 * carries — the repository a project binds and the runtime reference a
 * resumed session carries — in every combination, so a builder that fills one
 * in only when the other is present would still be caught.
 */

import {
  kubernetesSessionPodRequest,
  type KubernetesSessionLaunchConfig,
} from "../../src/adapters/kubernetes/sessionPod.ts";
import {
  asSessionAttemptId,
  asSessionBearerId,
  asSessionBearerSecret,
  asSessionId,
} from "../../src/interpreter/agentSession.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type { SessionPlacement } from "../../src/interpreter/sessionScheduler.ts";
import type { PolicyAuthorityGrant } from "../../src/interpreter/taskAuthority.ts";

const goldenGrant: PolicyAuthorityGrant = {
  tools: ["editor"],
  credentials: ["claude-code", "forge"],
  network: true,
  filesystem: "WriteWorkspace",
  mayCompleteTask: false,
};

const goldenConfig: KubernetesSessionLaunchConfig = {
  apiBaseUrl: "https://golden-cluster.invalid:6443",
  namespace: "golden-session",
  tokenFile: "/var/run/secrets/golden/token",
  serviceAccountName: "golden-session",
  podNamePrefix: "golden-session",
  workerPlaneUrl: "http://golden-plane.invalid:3001",
  capabilityFile: "/var/run/golden/session-capability/bearer",
  workspacePath: "/workspace",
  credentialMounts: {
    "claude-code": {
      secretName: "golden-claude-code",
      key: "token",
      mountPath: "/var/run/golden/claude-code/token",
    },
    forge: {
      secretName: "golden-forge",
      key: "token",
      mountPath: "/var/run/golden/forge/token",
    },
  },
  environment: { CHUG_SITE: "golden" },
  resources: {
    cpuRequest: "500m",
    cpuLimit: "1",
    memoryRequest: "1Gi",
    memoryLimit: "2Gi",
    ephemeralStorageLimit: "10Gi",
  },
  podLabels: { "app.kubernetes.io/name": "golden-session" },
  podAnnotations: { "site.invalid/tier": "golden" },
  nodeSelector: { "kubernetes.io/arch": "amd64" },
  podSecurityContext: { runAsNonRoot: true, fsGroup: 2000 },
  containerSecurityContext: {
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
  },
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
  apiUrl: "https://api.invalid",
};

/** Every field a session placement always carries, with neither optional field present. */
const goldenPlacement: SessionPlacement = {
  partition: {
    tenant: asTenantId("golden-tenant"),
    project: asProjectId("golden-project"),
  },
  session: asSessionId("golden-session"),
  attempt: asSessionAttemptId("golden-attempt"),
  generation: 4,
  kind: "Lead",
  capabilities: ["RepositoryRead", "RunCommands"],
  credentialSlot: "claude-code",
  profile: { profile: "standard", runtimeVersion: "1" },
  image: "registry.invalid/golden-worker:1",
  authority: goldenGrant,
  bearer: {
    id: asSessionBearerId("golden-bearer"),
    secret: asSessionBearerSecret(`chgs_${"a".repeat(64)}`),
  },
};

/** The pod one placement renders, or the failure of a case that assumed it renders one. */
function renderedPod(placement: SessionPlacement) {
  const requested = kubernetesSessionPodRequest(goldenConfig, placement);
  if (requested.requested !== "Pod")
    throw new Error(`the golden placement was denied: ${requested.reason}`);
  return requested.pod;
}

/** Both optional fields of the task document, in every combination. */
export function sessionPodDocuments(): unknown {
  return {
    freshUnbound: renderedPod(goldenPlacement),
    freshBound: renderedPod({
      ...goldenPlacement,
      repository: asRepositoryId("golden-repository"),
    }),
    resumedUnbound: renderedPod({
      ...goldenPlacement,
      agentReference: "golden-agent-reference",
    }),
    resumedBound: renderedPod({
      ...goldenPlacement,
      agentReference: "golden-agent-reference",
      repository: asRepositoryId("golden-repository"),
    }),
  };
}
