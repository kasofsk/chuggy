/**
 * The exact document one pool placement submits to the cluster API, pinned
 * against a committed golden.
 *
 * IT PINS BOTH ARMS OF THE DATABASE. A site that names one places the sidecar,
 * its volume and the address its worker reads; a site that names none places
 * none of the three. Either arm drifting is a different pod, and nothing but
 * the bytes shows it.
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

import { poolPodDocuments } from "./poolPodDocumentFixture.ts";

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

test("one pool placement, with a database and without, renders the documents the golden pins, byte for byte", async () => {
  assert.equal(
    JSON.stringify(await poolPodDocuments(tokenFile)),
    JSON.stringify(JSON.parse(readFileSync(goldenPath, "utf8"))),
  );
});
