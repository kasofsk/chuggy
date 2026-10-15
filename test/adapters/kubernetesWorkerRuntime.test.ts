/**
 * How a job's pod is started from a runtime: the copy that precedes every
 * sidecar, the read-only tree the job's container mounts, and the command the
 * contract names in place of its image's entrypoint.
 *
 * THE JOB IS WRITTEN AS EITHER LAUNCHER HANDS IT OVER, so what is asserted is
 * what injecting a runtime adds and what it leaves alone: the job's image, its
 * environment, its mounts and its volumes, each still there and still first.
 */

import assert from "node:assert/strict";
import { basename } from "node:path";
import { test } from "node:test";

import {
  workerJobCommand,
  workerRuntimeDirectory,
  workerWorkspaceVariable,
} from "../../src/contract/workerEnvironment.ts";
import type {
  KubernetesContainer,
  KubernetesPodSite,
} from "../../src/adapters/kubernetes/kubernetesSite.ts";
import {
  checkedKubernetesRuntimeSite,
  kubernetesJobRuntime,
  kubernetesRuntimeContainerName,
  type KubernetesJobPod,
} from "../../src/adapters/kubernetes/workerRuntime.ts";

const site: KubernetesPodSite = {
  apiBaseUrl: "https://cluster.invalid:6443",
  namespace: "work",
  tokenFile: "/var/run/secrets/token",
  serviceAccountName: "worker",
  nodeSelector: {},
  podSecurityContext: { runAsNonRoot: true },
  containerSecurityContext: {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
  },
  requestTimeoutSecsMax: 5,
  workerPlaneUrl: "http://plane.invalid:3001",
  capabilityFile: "/run/chuggy/capability",
  workspacePath: "/srv/workspace",
  credentialMounts: {
    forge: {
      secretName: "forge",
      key: "token",
      mountPath: "/run/chuggy/forge/token",
    },
  },
};

const runtime = `registry.invalid/runtime@sha256:${"a".repeat(64)}`;

const resources = {
  requests: { cpu: "1", memory: "1Gi" },
  limits: { cpu: "1", memory: "1Gi" },
};

/** A sidecar as `sidecars.ts` renders one, which is all a launcher hands over. */
const sidecar: KubernetesContainer = {
  name: "postgres",
  image: "registry.invalid/postgres:18",
  restartPolicy: "Always",
  env: [],
  resources,
  securityContext: site.containerSecurityContext,
  volumeMounts: [
    {
      name: "sidecar-postgres",
      mountPath: "/var/lib/postgresql",
      readOnly: false,
    },
  ],
};

const job: KubernetesJobPod = {
  initContainers: [sidecar, { ...sidecar, name: "cache" }],
  container: {
    name: "worker",
    image: "registry.invalid/project-image:3",
    env: [{ name: "PROJECT", value: "kept" }],
    resources,
    securityContext: site.containerSecurityContext,
    volumeMounts: [
      { name: "workspace", mountPath: "/workspace", readOnly: false },
    ],
  },
  volumes: [
    { name: "workspace", emptyDir: { sizeLimit: "8Gi" } },
    { name: "sidecar-postgres", emptyDir: { sizeLimit: "1Gi" } },
  ],
};

const started = kubernetesJobRuntime(site, runtime, "8Gi", job);

test("the copy is a plain init container that runs ahead of every sidecar", () => {
  const [copy, ...sidecars] = started.initContainers;
  assert.equal(copy?.name, kubernetesRuntimeContainerName);
  assert.equal(copy.image, runtime);
  assert.equal("restartPolicy" in copy, false);
  assert.deepEqual(sidecars, job.initContainers);
  assert.deepEqual(copy.securityContext, site.containerSecurityContext);
});

test("the job's container runs the contract's command and keeps its own image, environment and mounts", () => {
  assert.deepEqual(started.container.command, workerJobCommand);
  assert.equal("args" in started.container, false);
  const unchanged = {
    command: undefined,
    env: undefined,
    volumeMounts: undefined,
  };
  assert.deepEqual(
    { ...started.container, ...unchanged },
    { ...job.container, ...unchanged },
  );
  assert.deepEqual(
    started.container.env.slice(0, job.container.env.length),
    job.container.env,
  );
  assert.deepEqual(
    started.container.volumeMounts.slice(0, job.container.volumeMounts.length),
    job.container.volumeMounts,
  );
});

test("the job mounts the tree the copy wrote, read-only, where the contract says it is", () => {
  const mounted = started.container.volumeMounts.filter(
    ({ mountPath }) => mountPath === workerRuntimeDirectory,
  );
  assert.equal(mounted.length, 1);
  const [tree] = mounted;
  assert.equal(tree?.readOnly, true);
  const copy = started.initContainers[0];
  const target = copy?.volumeMounts.find(({ name }) => name === tree.name);
  assert.equal(target?.readOnly, false);
  assert.ok(target !== undefined && tree.subPath !== undefined);
  assert.deepEqual(copy?.command, [
    "cp",
    "-a",
    workerRuntimeDirectory,
    `${target.mountPath}/`,
  ]);
  assert.equal(tree.subPath, basename(workerRuntimeDirectory));
});

test("the job is told the site's workspace, which no image it names need know", () => {
  assert.deepEqual(started.container.env.slice(job.container.env.length), [
    { name: workerWorkspaceVariable, value: site.workspacePath },
  ]);
});

test("the volume between them is the pod's own, bounded by the storage it was given", () => {
  const added = started.volumes.slice(job.volumes.length);
  assert.deepEqual(started.volumes.slice(0, job.volumes.length), job.volumes);
  assert.deepEqual(added, [
    { name: "chuggy-runtime", emptyDir: { sizeLimit: "8Gi" } },
  ]);
});

test("a job container naming a command, arguments or the workspace of its own is refused rather than overridden", () => {
  for (const [named, refused] of [
    [{ command: ["node", "worker.mjs"] }, /names its own command/u],
    [{ args: ["--flag"] }, /names its own command/u],
    [
      { env: [{ name: workerWorkspaceVariable, value: "/elsewhere" }] },
      /names its own CHUG_WORKER_WORKSPACE/u,
    ],
  ] as const)
    assert.throws(
      () =>
        kubernetesJobRuntime(site, runtime, "8Gi", {
          ...job,
          container: { ...job.container, ...named },
        }),
      refused,
      JSON.stringify(named),
    );
});

/** A site whose one credential is mounted at `mountPath`, which is mounted as its directory. */
function siteCredentialAt(mountPath: string): Partial<KubernetesPodSite> {
  return {
    credentialMounts: {
      forge: { secretName: "forge", key: "token", mountPath },
    },
  };
}

test("a site mounting anything at, inside or around the runtime's directory is refused, and one beside it is not", () => {
  for (const refused of [
    { workspacePath: workerRuntimeDirectory },
    { workspacePath: `${workerRuntimeDirectory}/` },
    { capabilityFile: `${workerRuntimeDirectory}/capability` },
    siteCredentialAt(`${workerRuntimeDirectory}/token`),
    { workspacePath: "/opt" },
    { workspacePath: "/opt/" },
    { workspacePath: "/" },
    { capabilityFile: "/opt" },
    siteCredentialAt("/opt/token"),
  ])
    assert.throws(
      () => {
        checkedKubernetesRuntimeSite({ ...site, ...refused }, "worker");
      },
      /overlaps \/opt\/chuggy, where the runtime is mounted/u,
      JSON.stringify(refused),
    );
  for (const accepted of [
    site,
    { ...site, workspacePath: `${workerRuntimeDirectory}-workspace` },
    { ...site, workspacePath: "/opt/workspace" },
    { ...site, ...siteCredentialAt("/opt/credentials/token") },
  ])
    assert.doesNotThrow(() => {
      checkedKubernetesRuntimeSite(accepted, "worker");
    }, JSON.stringify(accepted));
});
