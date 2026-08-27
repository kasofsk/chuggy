import assert from "node:assert/strict";
import test from "node:test";

import { canonicalConfigurationOf } from "../../src/interpreter/authoring.ts";
import { executionSourceObservation } from "../../src/interpreter/executionSourceObservation.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const configuredWorkSource = canonicalConfigurationOf({
  finalizationHandoff: {
    version: 1,
    mode: "DirectCommit",
    repositories: {
      work: {
        repository: "work-repository",
        targetRef: "refs/heads/work",
      },
      handoff: {
        repository: "handoff-repository",
        targetRef: "refs/heads/handoff",
      },
    },
    credentials: { work: "work-reader", handoff: "handoff-writer" },
    renderer: {
      identity: "ContainerBuildRequest",
      version: 1,
      parameters: {
        targetImageRepository: "registry.example/work",
        builderProfile: "rootless",
        platforms: ["linux/amd64"],
      },
    },
    destinationPath: "build/request.json",
    outputBytesMax: 4_096,
  },
});

/** An observation over the project's default binding, recording what was asked about. */
function observingBinding(
  observed: unknown[],
): ReturnType<typeof executionSourceObservation> {
  return executionSourceObservation(
    {
      binding: () =>
        Promise.resolve({
          partition,
          repository: asRepositoryId("project-default"),
          recoveryEpoch: asRecoveryEpoch("epoch"),
        }),
    },
    {
      observeTarget: (repository) => {
        observed.push(repository);
        return Promise.resolve({
          observed: "Target",
          target: {
            ref: asGitRefName(repository.targetRef ?? "refs/heads/work"),
            commit: asGitObjectId("a".repeat(40)),
          },
        });
      },
    },
    { workSource: () => Promise.resolve(undefined) },
  );
}

test("configured work source selects its own repository, ref and credential", async () => {
  const observed: unknown[] = [];
  const subject = observingBinding(observed);
  assert.equal(
    (
      await subject.observe({
        partition,
        ticket: 1,
        kind: "Work",
        configurationCanonical: configuredWorkSource,
      })
    ).observed,
    "Source",
  );
  assert.deepEqual(observed, [
    {
      partition,
      repository: "work-repository",
      recoveryEpoch: "epoch",
      targetRef: "refs/heads/work",
      credentialReference: "work-reader",
    },
  ]);
});

test("evaluation without retained work source never reads mutable Git", async () => {
  let bindingReads = 0;
  const subject = executionSourceObservation(
    {
      binding: () => {
        bindingReads += 1;
        return Promise.resolve(undefined);
      },
    },
    {
      observeTarget: () => {
        throw new Error("mutable Git must not be observed");
      },
    },
    { workSource: () => Promise.resolve(undefined) },
  );
  assert.deepEqual(
    await subject.observe({ partition, ticket: 1, kind: "Evaluation" }),
    { observed: "Unreadable", evidence: "RefUnreadable" },
  );
  assert.equal(bindingReads, 0);
});

test("the ticket's own branch is the last word on what work is observed against", async () => {
  const observed: unknown[] = [];
  const subject = observingBinding(observed);
  const source = await subject.observe({
    partition,
    ticket: 1,
    kind: "Work",
    configurationCanonical: configuredWorkSource,
    ref: asGitRefName("refs/heads/ticket"),
  });
  assert.deepEqual(observed, [
    {
      partition,
      repository: "work-repository",
      recoveryEpoch: "epoch",
      targetRef: "refs/heads/ticket",
      credentialReference: "work-reader",
    },
  ]);
  assert.equal(
    source.observed === "Source" ? source.source.target.ref : undefined,
    "refs/heads/ticket",
  );
});

const workBase = asGitObjectId("b".repeat(40));
const workCommit = asGitObjectId("c".repeat(40));

/** An observation whose history answers with one work spawn's declarations. */
function observingWork(
  declared: readonly ReturnType<typeof asGitObjectId>[],
): ReturnType<typeof executionSourceObservation> {
  return executionSourceObservation(
    {
      binding: () => {
        throw new Error("an evaluation must not read the project binding");
      },
    },
    {
      observeTarget: () => {
        throw new Error("mutable Git must not be observed");
      },
    },
    {
      workSource: () =>
        Promise.resolve({
          repository: asRepositoryId("work-repository"),
          base: workBase,
          declared,
          manifests: [asResultManifestId("manifest-one")],
        }),
    },
  );
}

test("evaluation is observed at the commit its work produced", async () => {
  const observed = await observingWork([workCommit]).observe({
    partition,
    ticket: 1,
    kind: "Evaluation",
  });
  assert.deepEqual(observed, {
    observed: "Source",
    source: {
      repository: "work-repository",
      target: { commit: workCommit },
      manifests: ["manifest-one"],
    },
  });
});

test("work that declared no commit leaves its evaluation the base it ran on", async () => {
  const observed = await observingWork([]).observe({
    partition,
    ticket: 1,
    kind: "Evaluation",
  });
  assert.equal(
    observed.observed === "Source" ? observed.source.target.commit : undefined,
    workBase,
  );
});

test("a fan-out that declared several commits is evaluated at the base they shared", async () => {
  const observed = await observingWork([
    workCommit,
    asGitObjectId("d".repeat(40)),
  ]).observe({ partition, ticket: 1, kind: "Evaluation" });
  assert.deepEqual(observed, {
    observed: "Source",
    source: {
      repository: "work-repository",
      target: { commit: workBase },
      manifests: ["manifest-one"],
    },
  });
});
