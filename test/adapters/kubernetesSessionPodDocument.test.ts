/**
 * The exact document one session placement submits to the cluster API, pinned
 * against a committed golden.
 *
 * THIS SUITE EXISTS FOR THE EXTRACTION AND OUTLIVES IT, the same claim as the
 * worker pod's: lifting the value types and the HTTP half out of `sessionPod.ts`
 * must change no session pod, and that claim is about bytes. The golden was
 * rendered before the lift and is compared after it, so the claim is checked
 * rather than inspected. It also proves the byte shape of `CHUG_SESSION_TASK`
 * before PR6 moves that document's schema into the contract.
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
