/**
 * The documents a pod is launched with, held against what the launchers build
 * and against the interpreter's grant and worker configuration they restate.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  sessionTaskVariable,
  workerTaskVariable,
} from "../../src/contract/workerEnvironment.ts";
import {
  filesystemAccesses,
  sessionTaskDocumentSchema,
  workTaskDocumentSchema,
  type WorkTaskDocument,
} from "../../src/contract/workerTask.ts";
import {
  filesystemAccessOrder,
  type PolicyAuthorityGrant,
} from "../../src/interpreter/taskAuthority.ts";
import type { WorkerConfiguration } from "../../src/interpreter/taskConfiguration.ts";
import { sessionPodDocuments } from "../adapters/sessionPodDocumentFixture.ts";
import { workerPodDocuments } from "../adapters/workerPodDocumentFixture.ts";

interface RenderedPod {
  readonly spec: {
    readonly containers: readonly {
      readonly env?: readonly {
        readonly name: string;
        readonly value: string;
      }[];
    }[];
  };
}

/** The one document a pod carries under its variable, as the image parses it. */
function carried(pod: RenderedPod, variable: string): object {
  const values = pod.spec.containers.flatMap(({ env }) =>
    (env ?? []).filter(({ name }) => name === variable),
  );
  assert.equal(values.length, 1);
  return JSON.parse(values[0]?.value ?? "") as object;
}

test("each golden work pod carries a document the contract names in full", () => {
  const pods = Object.values(
    workerPodDocuments() as Record<string, { readonly pod: RenderedPod }>,
  );
  assert.ok(pods.length > 0);
  for (const { pod } of pods) {
    const document = carried(pod, workerTaskVariable);
    assert.deepEqual(workTaskDocumentSchema.strict().parse(document), document);
  }
});

test("each golden session pod carries a document the contract names in full", () => {
  const pods = Object.values(
    sessionPodDocuments() as Record<string, RenderedPod>,
  );
  assert.ok(pods.length > 0);
  for (const pod of pods) {
    const document = carried(pod, sessionTaskVariable);
    assert.deepEqual(
      sessionTaskDocumentSchema.strict().parse(document),
      document,
    );
  }
});

test("the grant the wire names is the interpreter's", () => {
  assert.deepEqual([...filesystemAccesses], [...filesystemAccessOrder]);
  const asTheInterpreters = (
    grant: WorkTaskDocument["authority"],
  ): PolicyAuthorityGrant => grant;
  const asTheWires = (
    grant: PolicyAuthorityGrant,
  ): WorkTaskDocument["authority"] => grant;
  const grant: PolicyAuthorityGrant = {
    tools: ["editor"],
    credentials: ["workspace"],
    network: false,
    filesystem: "ReadWorkspace",
    mayCompleteTask: false,
  };
  assert.deepEqual(
    asTheInterpreters(workTaskDocumentSchema.shape.authority.parse(grant)),
    asTheWires(grant),
  );
});

test("the worker configuration the wire names is the interpreter's", () => {
  const asTheInterpreters = (
    worker: NonNullable<WorkTaskDocument["worker"]>,
  ): WorkerConfiguration => worker;
  const asTheWires = (
    worker: WorkerConfiguration,
  ): NonNullable<WorkTaskDocument["worker"]> => worker;
  const worker: WorkerConfiguration = {
    mode: { type: "Commands", commands: ["just check"] },
    setup: ["npm ci"],
    files: [{ path: ".npmrc", content: "fund=false" }],
  };
  assert.deepEqual(
    asTheInterpreters(
      workTaskDocumentSchema.shape.worker.unwrap().parse(worker),
    ),
    asTheWires(worker),
  );
});
