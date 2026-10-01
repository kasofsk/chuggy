/**
 * The documents a pod is launched with, held against what the launchers build
 * and against the interpreter's grant, worker configuration and execution
 * profile they restate, and read by each older release a plane still serves.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  sessionTaskVariable,
  workerTaskVariable,
} from "../../src/contract/workerEnvironment.ts";
import { sessionBearerPattern } from "../../src/contract/sessionPlane.ts";
import {
  filesystemAccesses,
  poolEnvelopeSchema,
  sessionTaskDocumentSchema,
  workerTaskAnswerSchema,
  workTaskDocumentSchema,
  type WorkTaskDocument,
} from "../../src/contract/workerTask.ts";
import {
  filesystemAccessOrder,
  type PolicyAuthorityGrant,
} from "../../src/interpreter/taskAuthority.ts";
import type { ExecutionProfile } from "../../src/interpreter/executionScheduler.ts";
import type {
  WorkerConfiguration,
  WorkerMode,
} from "../../src/interpreter/taskConfiguration.ts";
import { sessionPodDocuments } from "../adapters/sessionPodDocumentFixture.ts";
import { workerPodDocuments } from "../adapters/workerPodDocumentFixture.ts";
import {
  workerContractReleaseExport,
  workerContractReleaseSchema,
  workerContractReplayed,
} from "./workerContractReleases.ts";

/** Every key any member of a union names, the optional ones included. */
type KeysOf<Value> = Value extends unknown ? keyof Value : never;

/** Whether both sides name the same keys, which assignability misses for a key one side adds as optional. */
type SameKeys<Wire, Interpreter> = [KeysOf<Wire>] extends [KeysOf<Interpreter>]
  ? [KeysOf<Interpreter>] extends [KeysOf<Wire>]
    ? true
    : false
  : false;

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

/** Every golden work pod, of which there is at least one. */
function workPods(): readonly RenderedPod[] {
  const pods = Object.values(
    workerPodDocuments() as Record<string, { readonly pod: RenderedPod }>,
  ).map(({ pod }) => pod);
  assert.ok(pods.length > 0);
  return pods;
}

/** Every golden session pod, of which there is at least one. */
function sessionPods(): readonly RenderedPod[] {
  const pods = Object.values(
    sessionPodDocuments() as Record<string, RenderedPod>,
  );
  assert.ok(pods.length > 0);
  return pods;
}

test("each golden work pod carries a document the contract names in full", () => {
  for (const pod of workPods()) {
    const document = carried(pod, workerTaskVariable);
    assert.deepEqual(workTaskDocumentSchema.strict().parse(document), document);
  }
});

test("each golden session pod carries a document the contract names in full", () => {
  for (const pod of sessionPods()) {
    const document = carried(pod, sessionTaskVariable);
    assert.deepEqual(
      sessionTaskDocumentSchema.strict().parse(document),
      document,
    );
  }
});

for (const [plane, kind, pods, variable, schema] of [
  ["job", "work", workPods, "workerTaskVariable", "workTaskDocumentSchema"],
  [
    "session",
    "session",
    sessionPods,
    "sessionTaskVariable",
    "sessionTaskDocumentSchema",
  ],
] as const)
  for (const release of workerContractReplayed(plane))
    test(`each golden ${kind} pod carries a document a ${release} image reads, under the variable it reads it from`, async () => {
      const read = await workerContractReleaseExport(
        release,
        "workerEnvironment",
        variable,
        z.string(),
      );
      const document = await workerContractReleaseExport(
        release,
        "workerTask",
        schema,
        workerContractReleaseSchema,
      );
      for (const pod of pods()) document.parse(carried(pod, read));
    });

/** `document` less the fields `keys` names. */
function without(document: object, keys: readonly string[]): object {
  return Object.fromEntries(
    Object.entries(document).filter(([key]) => !keys.includes(key)),
  );
}

/** What each golden session pod's attempt fetches when a pod holds it, and when a pool does and the fetch is all its harness is told. */
function sessionAnswers(): readonly {
  readonly podPlaced: object;
  readonly poolHeld: object;
}[] {
  return sessionPods().map((pod) => {
    const document = sessionTaskDocumentSchema
      .strict()
      .parse(carried(pod, sessionTaskVariable));
    const podPlaced = without(document, ["workerPlane", "api", "bounds"]);
    return {
      podPlaced,
      poolHeld: {
        ...podPlaced,
        api: document.api,
        bounds: document.bounds,
        model: "m",
      },
    };
  });
}

test("a pool-held session's answer names its site's API, bounds and model together, and a pod-placed one names none", () => {
  for (const { podPlaced, poolHeld } of sessionAnswers()) {
    assert.deepEqual(workerTaskAnswerSchema.parse(podPlaced), podPlaced);
    assert.deepEqual(workerTaskAnswerSchema.parse(poolHeld), poolHeld);
    for (const missing of ["api", "bounds", "model"])
      assert.equal(
        workerTaskAnswerSchema.safeParse(without(poolHeld, [missing])).success,
        false,
        missing,
      );
  }
});

for (const release of workerContractReplayed("session"))
  test(`a ${release} harness reads a pod-placed session's answer as it did, and a pool-held one less what it does not name`, async () => {
    const answer = await workerContractReleaseExport(
      release,
      "workerTask",
      "workerTaskAnswerSchema",
      workerContractReleaseSchema,
    );
    for (const { podPlaced, poolHeld } of sessionAnswers()) {
      assert.deepEqual(answer.parse(podPlaced), podPlaced);
      assert.deepEqual(answer.parse(poolHeld), podPlaced);
    }
  });

test("a pool's envelope carries a session's bearer as it carries an attempt's", () => {
  const bearer = `chgs_${"a".repeat(240)}`;
  assert.match(bearer, sessionBearerPattern);
  const envelope = {
    callbackUrl: "https://plane.invalid",
    bearer,
    workspace: "/workspace",
    timeoutSecsMax: 1,
    outputBytesMax: 1,
  };
  assert.deepEqual(poolEnvelopeSchema.parse(envelope), envelope);
});

test("the grant the wire names is the interpreter's", () => {
  assert.deepEqual([...filesystemAccesses], [...filesystemAccessOrder]);
  const asTheInterpreters = (
    grant: WorkTaskDocument["authority"],
  ): PolicyAuthorityGrant => grant;
  const asTheWires = (
    grant: PolicyAuthorityGrant,
  ): WorkTaskDocument["authority"] => grant;
  const sameKeys: SameKeys<
    WorkTaskDocument["authority"],
    PolicyAuthorityGrant
  > = true;
  assert.ok(sameKeys);
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
  type WireWorker = NonNullable<WorkTaskDocument["worker"]>;
  type WireMode = Extract<WireWorker, { mode: unknown }>["mode"];
  /** Variant by variant, so a key one variant adds cannot hide behind another that names it. */
  const sameKeys: [
    SameKeys<
      Extract<WireWorker, { mode: unknown }>,
      Extract<WorkerConfiguration, { mode: unknown }>
    >,
    SameKeys<
      Extract<WireWorker, { arguments: unknown }>,
      Extract<WorkerConfiguration, { arguments: unknown }>
    >,
    SameKeys<
      Extract<WireMode, { agent: "Claude" }>,
      Extract<WorkerMode, { agent: "Claude" }>
    >,
    SameKeys<
      Extract<WireMode, { agent: "Codex" }>,
      Extract<WorkerMode, { agent: "Codex" }>
    >,
    SameKeys<
      Extract<WireMode, { type: "Commands" }>,
      Extract<WorkerMode, { type: "Commands" }>
    >,
    SameKeys<WireWorker["files"][number], WorkerConfiguration["files"][number]>,
  ] = [true, true, true, true, true, true];
  assert.ok(sameKeys.every(Boolean));
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

test("the execution profile the wire names is the interpreter's", () => {
  const sameKeys: SameKeys<WorkTaskDocument["profile"], ExecutionProfile> =
    true;
  assert.ok(sameKeys);
  const profile: ExecutionProfile = {
    profile: "standard",
    runtimeVersion: "1",
  };
  const asTheInterpreters = (
    wire: WorkTaskDocument["profile"],
  ): ExecutionProfile => wire;
  assert.deepEqual(
    asTheInterpreters(workTaskDocumentSchema.shape.profile.parse(profile)),
    profile,
  );
});
