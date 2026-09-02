/**
 * The one worker placement the golden pins, kept beside the suite rather than
 * inside it so the same fixture can be rendered by whichever tree is being
 * captured. It is deliberately unlike the launch suite's fixture: two
 * credentials in two directories, a stage, both security contexts populated,
 * so the document exercises every part of the renderer a lift could disturb.
 */

import {
  kubernetesWorkerPodRequest,
  type KubernetesWorkerLaunchConfig,
} from "../../src/adapters/kubernetes/workerPod.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import {
  asAttemptCapabilityId,
  asAttemptCapabilitySecret,
  asAttemptId,
  asExecutionId,
  type AttemptPlacement,
} from "../../src/interpreter/executionScheduler.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
import {
  blessedPracticeCatalog,
  composeTaskInvocation,
  type PinnedTaskConfiguration,
} from "../../src/interpreter/taskBriefing.ts";

const pinnedConfiguration: PinnedTaskConfiguration = {
  configurationRevision: "revision-of-record",
  configurationDigest: "configuration-digest",
  brief: {
    motivation: ["A placed pod is the only thing a worker ever reads."],
    acceptanceCriteria: ["The submitted document is the one asserted here."],
    constraints: [],
  },
  practices: ["AcceptanceCriteria"],
  work: { instructions: ["Render the document and submit nothing beside it."] },
  review: { instructions: ["Read the document, not the renderer."] },
};

function goldenInvocation(): AttemptPlacement["invocation"] {
  const composed = composeTaskInvocation(blessedPracticeCatalog, {
    purpose: "Work",
    pin: pinnedConfiguration,
    configuration: pinnedConfiguration,
    runtime: { changedFiles: [], handoff: [] },
    priorWorkReports: { reports: [] },
    grant: {
      tools: ["editor"],
      credentials: ["forge", "workspace"],
      network: true,
      filesystem: "WriteWorkspace",
      mayCompleteTask: true,
    },
  });
  if (composed.composed !== "Composed")
    throw new Error("the golden configuration does not compose");
  return composed.invocation;
}

const goldenConfig: KubernetesWorkerLaunchConfig = {
  apiBaseUrl: "https://golden-cluster.invalid:6443",
  namespace: "golden-work",
  tokenFile: "/var/run/secrets/golden/token",
  serviceAccountName: "golden-worker",
  podNamePrefix: "golden-worker",
  workerPlaneUrl: "http://golden-plane.invalid:3001",
  capabilityFile: "/var/run/golden/capability/bearer",
  workspacePath: "/workspace",
  credentialMounts: {
    forge: {
      secretName: "golden-forge",
      key: "token",
      mountPath: "/var/run/golden/forge/token",
    },
    workspace: {
      secretName: "golden-workspace",
      key: "token",
      mountPath: "/var/run/golden/workspace/token",
    },
  },
  environment: { CHUG_WORKER_REPOSITORIES: '{"repository":{}}' },
  resources: {
    cpuRequest: "250m",
    cpuLimit: "2",
    memoryRequest: "512Mi",
    memoryLimit: "4Gi",
    ephemeralStorageLimit: "20Gi",
  },
  podLabels: { "app.kubernetes.io/name": "golden-worker" },
  podAnnotations: { "site.invalid/tier": "golden" },
  nodeSelector: { "kubernetes.io/arch": "amd64" },
  podSecurityContext: { runAsNonRoot: true, fsGroup: 2000 },
  containerSecurityContext: {
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
  },
  activeDeadlineSecs: 7_200,
  requestTimeoutSecsMax: 30,
  unavailableRetryAfterSecs: 15,
};

const goldenPlacement: AttemptPlacement = {
  partition: {
    tenant: asTenantId("golden-tenant"),
    project: asProjectId("golden-project"),
  },
  execution: asExecutionId("golden-execution"),
  attempt: asAttemptId("golden-attempt"),
  generation: 4,
  ticket: asTicketId(11),
  task: asTaskId(3),
  taskKind: "Work",
  stage: 2,
  sourceRequest: "11:0:SpawnWork",
  inputBundle: "11:0:InputBundle",
  inputBundleDigest: "c".repeat(64),
  configurationRevision: "revision-of-record",
  configurationDigest: "configuration-digest",
  requirementIdentity: "golden-requirement",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: "registry.invalid/golden-worker:1",
  },
  requirementDigest: "requirement-digest",
  profile: { profile: "standard", runtimeVersion: "1" },
  invocation: goldenInvocation(),
  capability: {
    id: asAttemptCapabilityId("golden-capability"),
    secret: asAttemptCapabilitySecret("golden-capability-secret"),
    manifest: asResultManifestId("golden-manifest"),
  },
};

/** Both database arms, since a site that runs no shared server renders a shorter container. */
export function workerPodDocuments(): unknown {
  return {
    withDatabase: kubernetesWorkerPodRequest(
      {
        ...goldenConfig,
        database: { secretName: "golden-database", key: "url" },
      },
      goldenPlacement,
    ),
    withoutDatabase: kubernetesWorkerPodRequest(goldenConfig, goldenPlacement),
  };
}
