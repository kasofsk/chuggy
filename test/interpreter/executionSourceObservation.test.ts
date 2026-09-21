import assert from "node:assert/strict";
import test from "node:test";

import { executionSourceObservation } from "../../src/interpreter/executionSourceObservation.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type TargetObserved,
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

/** An observation whose binding read is counted and whose Git port refuses every call. */
function observingUncalled(): {
  subject: ReturnType<typeof executionSourceObservation>;
  bindingReads: () => number;
} {
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
  return { subject, bindingReads: () => bindingReads };
}

test("evaluation without retained work source never reads mutable Git", async () => {
  const { subject, bindingReads } = observingUncalled();
  assert.deepEqual(
    await subject.observe({ partition, ticket: 1, kind: "Evaluation" }),
    { observed: "Unreadable", evidence: "RefUnreadable" },
  );
  assert.equal(bindingReads(), 0);
});

test("the ticket's own branch is the last word on what work is observed against", async () => {
  const observed: unknown[] = [];
  const subject = observingBinding(observed);
  const source = await subject.observe({
    partition,
    ticket: 1,
    kind: "Work",
    repository: asRepositoryId("project-default"),
    ref: asGitRefName("refs/heads/ticket"),
  });
  assert.deepEqual(observed, [
    {
      partition,
      repository: "project-default",
      recoveryEpoch: "epoch",
      targetRef: "refs/heads/ticket",
    },
  ]);
  assert.equal(
    source.observed === "Source" ? source.source.target.ref : undefined,
    "refs/heads/ticket",
  );
});

/** The branch the absent-branch cases name, which no fixture remote holds. */
const ticketBranch = "refs/heads/ticket";

/** What the work ref holds, which is the commit an absent branch is based on. */
const workRefCommit = asGitObjectId("e".repeat(40));

/**
 * An observation whose remote holds every ref but one, each at a commit of its
 * own, so a source's commit says which ref it was read from.
 */
function observingWithout(
  absent: string,
  observed: (string | undefined)[],
  evidence: Extract<TargetObserved, { observed: "Unreadable" }>["evidence"],
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
        observed.push(repository.targetRef);
        const answer: TargetObserved =
          repository.targetRef === absent
            ? { observed: "Unreadable", evidence }
            : {
                observed: "Target",
                target: {
                  ref: asGitRefName(repository.targetRef ?? "refs/heads/head"),
                  commit: workRefCommit,
                },
              };
        return Promise.resolve(answer);
      },
    },
    { workSource: () => Promise.resolve(undefined) },
  );
}

test("a brief branch the remote does not hold is based on the binding's own target", async () => {
  const observed: (string | undefined)[] = [];
  const source = await observingWithout(
    ticketBranch,
    observed,
    "RefUnreadable",
  ).observe({
    partition,
    ticket: 1,
    kind: "Work",
    repository: asRepositoryId("project-default"),
    ref: asGitRefName(ticketBranch),
  });
  assert.deepEqual(observed, [ticketBranch, undefined]);
  assert.deepEqual(source, {
    observed: "Source",
    source: {
      repository: "project-default",
      target: { ref: ticketBranch, commit: workRefCommit },
      manifests: [],
    },
  });
});

test("a branch nobody can read is unreadable still, and is asked about once", async () => {
  const observed: (string | undefined)[] = [];
  const source = await observingWithout(
    ticketBranch,
    observed,
    "RemoteUnreachable",
  ).observe({
    partition,
    ticket: 1,
    kind: "Work",
    repository: asRepositoryId("project-default"),
    ref: asGitRefName(ticketBranch),
  });
  assert.deepEqual(source, {
    observed: "Unreadable",
    evidence: "RemoteUnreachable",
  });
  assert.deepEqual(observed, [ticketBranch]);
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

test("work that declared several commits is evaluated at the base they shared", async () => {
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

/**
 * A project binding two repositories, answering each by name and its oldest to
 * a caller naming none, which is what the durable read does. The observation is
 * recorded so a case can say which repository was asked about.
 */
function observingBound(
  observed: unknown[],
): ReturnType<typeof executionSourceObservation> {
  return executionSourceObservation(
    {
      binding: (asked, repository) =>
        Promise.resolve({
          partition: asked,
          repository: repository ?? asRepositoryId("repository-oldest"),
          recoveryEpoch: asRecoveryEpoch("epoch"),
        }),
    },
    {
      observeTarget: (repository) => {
        observed.push(repository.repository);
        return Promise.resolve({
          observed: "Target",
          target: {
            ref: asGitRefName(repository.targetRef ?? "refs/heads/main"),
            commit: asGitObjectId("f".repeat(40)),
          },
        });
      },
    },
    { workSource: () => Promise.resolve(undefined) },
  );
}

test("two tickets of one project are each observed in the repository their brief names", async () => {
  const observed: unknown[] = [];
  const subject = observingBound(observed);
  const sources = [];
  for (const [ticket, repository] of [
    [1, "repository-oldest"],
    [2, "repository-sibling"],
  ] as const) {
    const source = await subject.observe({
      partition,
      ticket,
      kind: "Work",
      repository: asRepositoryId(repository),
    });
    sources.push(
      source.observed === "Source" ? source.source.repository : undefined,
    );
  }
  assert.deepEqual(observed, ["repository-oldest", "repository-sibling"]);
  assert.deepEqual(sources, ["repository-oldest", "repository-sibling"]);
});

test("a request naming no repository is unreadable, and the binding is never read for it", async () => {
  const { subject, bindingReads } = observingUncalled();
  assert.deepEqual(
    await subject.observe({ partition, ticket: 3, kind: "Work" }),
    { observed: "Unreadable", evidence: "RefUnreadable" },
  );
  assert.equal(bindingReads(), 0);
});
