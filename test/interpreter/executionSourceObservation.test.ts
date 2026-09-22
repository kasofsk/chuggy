import assert from "node:assert/strict";
import test from "node:test";

import { executionSourceObservation } from "../../src/interpreter/executionSourceObservation.ts";
import type {
  ExecutionSourceHistoryPort,
  TicketSourceRow,
} from "../../src/interpreter/executionSourceObservation.ts";
import { unsourcedTicketReference } from "../../src/interpreter/executionSource.ts";
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
import {
  asResultManifestId,
  digestFold,
} from "../../src/interpreter/resultManifest.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

/** A history nothing in an observation case reaches. */
const noHistory: ExecutionSourceHistoryPort = {
  workSource: () => {
    throw new Error("an observation reads no history");
  },
  ticketSource: () => {
    throw new Error("an observation reads no history");
  },
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
    noHistory,
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
    noHistory,
  );
  return { subject, bindingReads: () => bindingReads };
}

test("a brief naming no repository is dispatched at the reserved reference", async () => {
  const { subject, bindingReads } = observingUncalled();
  assert.deepEqual(await subject.observe({ partition, ticket: 3 }), {
    observed: "Source",
    source: { reference: unsourcedTicketReference },
  });
  assert.equal(bindingReads(), 0);
});

test("a repository the project has not bound is unreadable", async () => {
  const { subject, bindingReads } = observingUncalled();
  assert.deepEqual(
    await subject.observe({
      partition,
      ticket: 1,
      repository: asRepositoryId("unbound"),
    }),
    { observed: "Unreadable", evidence: "RefUnreadable" },
  );
  assert.equal(bindingReads(), 1);
});

test("the ticket's own branch is the last word on what work is observed against", async () => {
  const observed: unknown[] = [];
  const subject = observingBinding(observed);
  const source = await subject.observe({
    partition,
    ticket: 1,
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
  assert.deepEqual(source, {
    observed: "Source",
    source: {
      reference: digestFold("a".repeat(40)),
      repository: "project-default",
      commit: "a".repeat(40),
      ref: "refs/heads/ticket",
    },
  });
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
    noHistory,
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
    repository: asRepositoryId("project-default"),
    ref: asGitRefName(ticketBranch),
  });
  assert.deepEqual(observed, [ticketBranch, undefined]);
  assert.deepEqual(source, {
    observed: "Source",
    source: {
      reference: digestFold(workRefCommit),
      repository: "project-default",
      commit: workRefCommit,
      ref: ticketBranch,
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
    repository: asRepositoryId("project-default"),
    ref: asGitRefName(ticketBranch),
  });
  assert.deepEqual(source, {
    observed: "Unreadable",
    evidence: "RemoteUnreachable",
  });
  assert.deepEqual(observed, [ticketBranch]);
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
    noHistory,
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
      repository: asRepositoryId(repository),
    });
    sources.push(
      source.observed === "Source" ? source.source.repository : undefined,
    );
  }
  assert.deepEqual(observed, ["repository-oldest", "repository-sibling"]);
  assert.deepEqual(sources, ["repository-oldest", "repository-sibling"]);
});

const acceptedCommit = asGitObjectId("c".repeat(40));
const acceptedReference = digestFold(acceptedCommit);

/** A spawn whose history answers the ticket's own source and its latest work manifests. */
function spawningFrom(
  row: TicketSourceRow | undefined,
): ReturnType<typeof executionSourceObservation> {
  return executionSourceObservation(
    {
      binding: () => {
        throw new Error("a spawn must not read the project binding");
      },
    },
    {
      observeTarget: () => {
        throw new Error("mutable Git must not be observed");
      },
    },
    {
      workSource: () =>
        Promise.resolve({ manifests: [asResultManifestId("manifest-one")] }),
      ticketSource: () => Promise.resolve(row),
    },
  );
}

test("a rework runs at the source the ticket carries and judges nothing", async () => {
  assert.deepEqual(
    await spawningFrom({
      repository: asRepositoryId("work-repository"),
      commit: acceptedCommit,
      ref: asGitRefName(ticketBranch),
    }).spawnSource({
      partition,
      ticket: 1,
      source: acceptedReference,
      kind: "Work",
    }),
    {
      repository: "work-repository",
      target: { commit: acceptedCommit, ref: ticketBranch },
      manifests: [],
    },
  );
});

test("an evaluation runs at that same source, over the manifests its work produced", async () => {
  assert.deepEqual(
    await spawningFrom({
      repository: asRepositoryId("work-repository"),
      commit: acceptedCommit,
    }).spawnSource({
      partition,
      ticket: 1,
      source: acceptedReference,
      kind: "Evaluation",
    }),
    {
      repository: "work-repository",
      target: { commit: acceptedCommit },
      manifests: ["manifest-one"],
    },
  );
});

test("a ticket whose source names no repository has nothing for a bundle to name", async () => {
  assert.equal(
    await spawningFrom({}).spawnSource({
      partition,
      ticket: 1,
      source: unsourcedTicketReference,
      kind: "Work",
    }),
    undefined,
  );
});

test("a reference no row carries answers the same nothing", async () => {
  assert.equal(
    await spawningFrom(undefined).spawnSource({
      partition,
      ticket: 1,
      source: acceptedReference,
      kind: "Evaluation",
    }),
    undefined,
  );
});
