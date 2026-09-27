/**
 * The containers a site runs beside a worker: what each is rendered as, and
 * which lists are refused before a pod is placed.
 *
 * THE RIG'S OWN SIDECAR IS PINNED WHOLE. The site document the rig writes is
 * rendered into a worker pod and compared with the server container and scratch
 * volume the database adapter it replaces rendered for the same site, written
 * out in full. The volume's name is the one thing the comparison leaves out,
 * since nothing reads it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  kubernetesDnsLabelCharsMax,
  type KubernetesContainer,
  type KubernetesPod,
} from "../../src/adapters/kubernetes/kubernetesSite.ts";
import {
  checkedKubernetesSidecars,
  kubernetesSidecarContainers,
  kubernetesSidecarVolumes,
  type KubernetesSidecar,
} from "../../src/adapters/kubernetes/sidecars.ts";
import {
  kubernetesWorkerContainerName,
  kubernetesWorkerPodRequest,
} from "../../src/adapters/kubernetes/workerPod.ts";
import {
  goldenConfig,
  goldenPlacement,
  rigSidecars,
} from "./workerPodDocumentFixture.ts";

/** A sidecar that names nothing optional. */
const bare: KubernetesSidecar = {
  name: "cache",
  image: "registry.invalid/cache:7",
  args: [],
  environment: {},
  resources: {
    cpuRequest: "100m",
    cpuLimit: "1",
    memoryRequest: "128Mi",
    memoryLimit: "512Mi",
    ephemeralStorageLimit: "1Gi",
  },
};

/** A container with each mount naming its volume by what the volume is rather than by its name. */
function mountedVolumes(
  container: KubernetesContainer,
  volumes: KubernetesPod["spec"]["volumes"],
): unknown {
  return {
    ...container,
    volumeMounts: container.volumeMounts.map((mount) => ({
      ...mount,
      name: volumes.find(({ name }) => name === mount.name)?.emptyDir,
    })),
  };
}

test("the rig's sidecar renders the server container and scratch volume its worker pods run", () => {
  const requested = kubernetesWorkerPodRequest(
    { ...goldenConfig, sidecars: rigSidecars },
    goldenPlacement,
  );
  assert.ok(requested.requested === "Pod");
  const [rendered, ...others] = requested.pod.spec.initContainers ?? [];
  assert.ok(rendered !== undefined);
  assert.deepEqual(others, []);
  const expected: KubernetesContainer = {
    name: "postgres",
    image:
      "docker.io/library/postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2",
    args: ["-c", "listen_addresses=127.0.0.1"],
    restartPolicy: "Always",
    startupProbe: {
      exec: { command: ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"] },
      periodSeconds: 1,
      failureThreshold: 120,
    },
    env: [{ name: "POSTGRES_HOST_AUTH_METHOD", value: "trust" }],
    resources: {
      requests: { cpu: "250m", memory: "256Mi", "ephemeral-storage": "4Gi" },
      limits: { cpu: "1", memory: "1Gi", "ephemeral-storage": "4Gi" },
    },
    securityContext: {
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
    },
    volumeMounts: [
      {
        name: "worker-database",
        mountPath: "/var/lib/postgresql",
        readOnly: false,
      },
    ],
  };
  assert.deepEqual(
    mountedVolumes(rendered, requested.pod.spec.volumes),
    mountedVolumes(expected, [
      { name: "worker-database", emptyDir: { sizeLimit: "4Gi" } },
    ]),
  );
});

test("a startup probe is rendered in either shape as the site wrote it", () => {
  for (const startupProbe of [
    {
      exec: { command: ["ready", "--now"] },
      periodSeconds: 3,
      failureThreshold: 7,
    },
    { tcpSocket: { port: 6379 }, periodSeconds: 2, failureThreshold: 30 },
  ]) {
    const [container] = kubernetesSidecarContainers(goldenConfig, [
      { ...bare, startupProbe },
    ]);
    assert.deepEqual(container?.startupProbe, startupProbe);
  }
});

test("a sidecar that names no probe, scratch, arguments or environment renders none of them", () => {
  assert.deepEqual(kubernetesSidecarContainers(goldenConfig, [bare]), [
    {
      name: "cache",
      image: "registry.invalid/cache:7",
      restartPolicy: "Always",
      env: [],
      resources: {
        requests: { cpu: "100m", memory: "128Mi", "ephemeral-storage": "1Gi" },
        limits: { cpu: "1", memory: "512Mi", "ephemeral-storage": "1Gi" },
      },
      securityContext: goldenConfig.containerSecurityContext,
      volumeMounts: [],
    },
  ]);
  assert.deepEqual(kubernetesSidecarVolumes([bare]), []);
});

test("a site that names no sidecar renders no container and no volume", () => {
  assert.deepEqual(kubernetesSidecarContainers(goldenConfig, []), []);
  assert.deepEqual(kubernetesSidecarVolumes([]), []);
});

/** The longest name a container may take, which leaves no room for its scratch volume's prefix. */
const longest = "c".repeat(kubernetesDnsLabelCharsMax);

/** Each list the cluster would refuse or time by its own defaults, and the refusal that names why. */
const sidecarRefusals: readonly (readonly [
  readonly KubernetesSidecar[],
  RegExp,
])[] = [
  [[{ ...bare, image: "" }], /worker sidecar cache image is empty/u],
  [[{ ...bare, name: "Cache" }], /worker sidecar Cache is not a Kubernetes/u],
  [[{ ...bare, name: `${longest}c` }], /is not a Kubernetes name of at most/u],
  [[bare, { ...bare }], /worker sidecar cache is named twice/u],
  [
    [{ ...bare, name: kubernetesWorkerContainerName }],
    /worker sidecar worker is named like the worker's own container/u,
  ],
  [
    [{ ...bare, name: longest, scratch: { mountPath: "/data" } }],
    /scratch volume is not a Kubernetes name/u,
  ],
  [
    [
      {
        ...bare,
        startupProbe: {
          tcpSocket: { port: 6379 },
          periodSeconds: 0,
          failureThreshold: 30,
        },
      },
    ],
    /worker sidecar cache probe period must be a positive integer/u,
  ],
  [
    [
      {
        ...bare,
        startupProbe: {
          exec: { command: ["ready"] },
          periodSeconds: 1,
          failureThreshold: 0,
        },
      },
    ],
    /worker sidecar cache probe failure threshold must be a positive integer/u,
  ],
];

test("a sidecar list the cluster would refuse, or would time by its own defaults, is refused by name", () => {
  for (const [sidecars, refusal] of sidecarRefusals)
    assert.throws(
      () =>
        checkedKubernetesSidecars(
          sidecars,
          kubernetesWorkerContainerName,
          "worker",
        ),
      refusal,
      JSON.stringify(sidecars),
    );
});

test("a sidecar list the cluster would place as written is taken as it is", () => {
  for (const sidecars of [
    [],
    rigSidecars,
    [bare, { ...bare, name: "other" }],
    [{ ...bare, name: longest }],
  ])
    assert.equal(
      checkedKubernetesSidecars(
        sidecars,
        kubernetesWorkerContainerName,
        "worker",
      ),
      sidecars,
    );
});
