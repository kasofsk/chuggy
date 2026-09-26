/**
 * The exact documents session placements submit to the cluster API, pinned
 * against a committed golden.
 *
 * `CHUG_SESSION_TASK` IS A CONTRACT WITH THE HARNESS. The task document a
 * session pod carries is read by `images/worker/`, which nothing type-checks
 * against this renderer, so a field renamed on the way through a refactor is a
 * pod the harness reads differently, and only the golden shows it.
 *
 * IT PINS THE ORDER AS WELL AS THE VALUES, for the same reason the worker
 * golden does: the wire body is `JSON.stringify(pod)`, so the golden is read
 * back through the same parser and serialized the same way.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { sessionPodDocuments } from "./sessionPodDocumentFixture.ts";

/** The golden this suite compares against, beside it so a diff shows the pod. */
const goldenPath = new URL(
  "./kubernetesSessionPodDocument.golden.json",
  import.meta.url,
);

test("every combination of a session's two optional fields renders the documents the golden pins, byte for byte", () => {
  assert.equal(
    JSON.stringify(sessionPodDocuments()),
    JSON.stringify(JSON.parse(readFileSync(goldenPath, "utf8"))),
  );
});
