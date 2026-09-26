/**
 * The one pool placement the golden pins, kept beside the suite so the same
 * fixture can be rendered by whichever tree is being captured. A pool's pod is
 * rendered nowhere but inside its backend's `place`, so it is captured the way
 * the cluster sees it: placed against an API that records what it was asked to
 * create and answers as a cluster that created it.
 *
 * It is deliberately unlike the placement suite's fixture: one capability the
 * site maps and one it does not, a provider credential, both security contexts
 * populated, and a site environment, so the document exercises every part of
 * the renderer a sidecar could disturb.
 */

import type { WorkerPoolAssignment } from "../../src/contract/workerPool.ts";
import {
  kubernetesPoolBackend,
  type KubernetesPoolPlacementConfig,
} from "../../src/adapters/kubernetes/poolPlacement.ts";

const goldenConfig: Omit<KubernetesPoolPlacementConfig, "tokenFile"> = {
  apiBaseUrl: "https://golden-cluster.invalid:6443",
  namespace: "golden-pool",
  serviceAccountName: "golden-pool-worker",
  nodeSelector: { "kubernetes.io/arch": "amd64" },
  podSecurityContext: { runAsNonRoot: true, fsGroup: 2000 },
  containerSecurityContext: {
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
  },
  requestTimeoutSecsMax: 30,
  unavailableRetryAfterSecs: 15,
  workerPlaneUrl: "http://golden-plane.invalid:3001",
  capabilityFile: "/var/run/golden/capability/bearer",
  workspacePath: "/workspace",
  credentialMounts: {
    "claude-code": {
      secretName: "golden-claude-code",
      key: "credentials.json",
      mountPath: "/var/run/golden/claude-code/credentials.json",
    },
  },
  podNamePrefix: "golden-pool",
  image: "registry.invalid/golden-worker:1",
  poolLabel: { name: "chuggy.internal/pool", value: "golden-pool" },
  podLabels: { "chuggy.dev/worker": "true" },
  podAnnotations: { "site.invalid/tier": "golden" },
  resources: {
    cpuRequest: "250m",
    cpuLimit: "2",
    memoryRequest: "512Mi",
    memoryLimit: "4Gi",
    ephemeralStorageLimit: "20Gi",
  },
  timeoutSecsMax: 7_200,
  outputBytesMax: 65_536,
  environment: { CHUG_WORKER_REPOSITORIES: '{"repository":{}}' },
  capabilities: {
    "Platform:Linux:Arm64": {
      nodeSelector: { "kubernetes.io/arch": "arm64" },
      tolerations: [
        {
          key: "golden.invalid/arm64",
          operator: "Equal",
          value: "reserved",
          effect: "NoSchedule",
        },
      ],
    },
  },
  providerCredential: "claude-code",
};

const goldenDatabase = {
  image: "registry.invalid/golden-postgres:18",
  resources: {
    cpuRequest: "250m",
    cpuLimit: "1",
    memoryRequest: "256Mi",
    memoryLimit: "1Gi",
    ephemeralStorageLimit: "4Gi",
  },
};

const goldenAssignment: WorkerPoolAssignment = {
  assignment: "golden-assignment",
  capabilities: ["Platform:Linux:Arm64", "claude-code"],
  cpuMillis: 1_500,
  memoryMib: 3_072,
  deadlineSecs: 3_600,
  callbackUrl: "http://golden-plane.invalid:3001/v1/task",
  bearer: "golden-attempt-bearer",
};

/** The pod one site's placement of the golden assignment asked the cluster to create. */
async function poolPodSubmitted(
  config: KubernetesPoolPlacementConfig,
): Promise<unknown> {
  const submitted: unknown[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    if (!path.endsWith("/pods") || typeof init?.body !== "string")
      return Promise.resolve(new Response("{}", { status: 201 }));
    const pod = JSON.parse(init.body) as {
      readonly metadata: Record<string, unknown>;
    };
    submitted.push(pod);
    return Promise.resolve(
      new Response(
        JSON.stringify({ metadata: { ...pod.metadata, uid: "golden-uid" } }),
        { status: 201 },
      ),
    );
  };
  const placed = await kubernetesPoolBackend(config, fetcher).place(
    goldenAssignment,
  );
  if (placed.placed !== "Placed" || submitted.length !== 1)
    throw new Error("the golden placement submitted no pod");
  return submitted[0];
}

/** Both database arms, since a site that runs no database renders a pod with no sidecar. */
export async function poolPodDocuments(tokenFile: string): Promise<unknown> {
  const config: KubernetesPoolPlacementConfig = { ...goldenConfig, tokenFile };
  return {
    withDatabase: await poolPodSubmitted({
      ...config,
      database: goldenDatabase,
    }),
    withoutDatabase: await poolPodSubmitted(config),
  };
}
