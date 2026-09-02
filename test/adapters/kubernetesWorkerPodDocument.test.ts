/**
 * The exact document one worker placement submits to the cluster API, pinned
 * against a committed golden.
 *
 * THIS SUITE EXISTS FOR THE EXTRACTION AND OUTLIVES IT. Lifting the value
 * types and the HTTP half out of `workerPod.ts` and `workerLaunch.ts` is a
 * refactor whose whole claim is that no worker pod changes, and that claim is
 * about bytes: a field renamed, a key reordered, a default filled in on the way
 * through a new shared shape would each be invisible to a reader and would each
 * be a different pod. The golden was rendered before the lift and is compared
 * after it, so the claim is checked rather than inspected.
 *
 * IT PINS THE ORDER AS WELL AS THE VALUES. The wire body is
 * `JSON.stringify(pod)`, whose bytes are a function of key order and value, so
 * an indented serialization of the same object pins the same thing and is
 * reviewable in a diff.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { workerPodDocuments } from "./workerPodDocumentFixture.ts";

/** The golden this suite compares against, beside it so a diff shows the pod. */
const goldenPath = new URL(
  "./kubernetesWorkerPodDocument.golden.json",
  import.meta.url,
);

test("one worker placement renders the document the golden pins, byte for byte", () => {
  assert.equal(
    `${JSON.stringify(workerPodDocuments(), null, 2)}\n`,
    readFileSync(goldenPath, "utf8"),
  );
});
