/**
 * The exact document one pool placement submits to the cluster API, pinned
 * against a committed golden.
 *
 * IT PINS BOTH ARMS OF THE SIDECARS. A site that names them places each one
 * and its scratch volume; a site that names none places neither. Either arm
 * drifting is a different pod, and nothing but the bytes shows it. The pool's
 * sidecars are the worker golden's own, so the two pods are also compared.
 *
 * IT PINS THE ORDER AS WELL AS THE VALUES, for the same reason the worker
 * golden does: the wire body is `JSON.stringify(pod)`, so the golden is read
 * back through the same parser and serialized the same way.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { KubernetesPod } from "../../src/adapters/kubernetes/kubernetesSite.ts";
import { poolPodDocuments } from "./poolPodDocumentFixture.ts";
import { workerPodDocuments } from "./workerPodDocumentFixture.ts";

/** The golden this suite compares against, beside it so a diff shows the pod. */
const goldenPath = new URL(
  "./kubernetesPoolPodDocument.golden.json",
  import.meta.url,
);

const root = mkdtempSync(join(tmpdir(), "chuggy-pool-golden-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});
const tokenFile = join(root, "token");
writeFileSync(tokenFile, "cluster-token\n");

test("one pool placement, with sidecars and without, renders the documents the golden pins, byte for byte", async () => {
  assert.equal(
    JSON.stringify(await poolPodDocuments(tokenFile)),
    JSON.stringify(JSON.parse(readFileSync(goldenPath, "utf8"))),
  );
});

/** What a pod runs beside its worker: its init containers and the volumes they mount. */
function podSidecars(pod: KubernetesPod): unknown {
  const containers = pod.spec.initContainers ?? [];
  assert.ok(containers.length > 0);
  const mounted = new Set(
    containers.flatMap(({ volumeMounts }) =>
      volumeMounts.map(({ name }) => name),
    ),
  );
  return {
    containers,
    volumes: pod.spec.volumes.filter(({ name }) => mounted.has(name)),
  };
}

test("a pool's workload runs one site's sidecars exactly as a pushed worker's pod does", async () => {
  const pool = (await poolPodDocuments(tokenFile)) as {
    readonly withSidecars: KubernetesPod;
  };
  const worker = workerPodDocuments() as {
    readonly withSidecars: { readonly pod: KubernetesPod };
  };
  assert.equal(
    JSON.stringify(podSidecars(pool.withSidecars)),
    JSON.stringify(podSidecars(worker.withSidecars.pod)),
  );
});
