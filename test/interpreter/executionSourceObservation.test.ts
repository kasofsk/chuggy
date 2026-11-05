import assert from "node:assert/strict";
import test from "node:test";

import {
  changeBaseStepsMax,
  executionSourceObservation,
} from "../../src/interpreter/executionSourceObservation.ts";
import type {
  ExecutionSourceHistoryPort,
  TicketSourceRow,
} from "../../src/interpreter/executionSourceObservation.ts";
import { unsourcedTicketReference } from "../../src/interpreter/executionSource.ts";
import type {
  CommitAncestry,
  CommitAncestryQuestion,
  CommitAncestryPort,
} from "../../src/interpreter/commitAncestry.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type GitObjectId,
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
  workResultBases: () => {
    throw new Error("an observation reads no history");
  },
  failedLandingBase: () => {
    throw new Error("an observation reads no history");
  },
};

/** An ancestry port nothing in a case asks. */
const noAncestry: CommitAncestryPort = {
  ancestry: () => {
    throw new Error("nothing here asks about ancestry");
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
    noAncestry,
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
    noAncestry,
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
    noAncestry,
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
    noAncestry,
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

/** The commit the ticket was dispatched at, which the work that produced the accepted one started from. */
const dispatchedCommit = asGitObjectId("d".repeat(40));

/** The commits the ticket's work results producing one commit started from. */
type WorkResultBases = (commit: string) => readonly GitObjectId[];

/** A history whose work results produced each commit `produced` names, from the commits it names. */
function producing(
  produced: ReadonlyMap<string, readonly GitObjectId[]>,
): WorkResultBases {
  return (commit) => produced.get(commit) ?? [];
}

/** The history of a ticket whose one work result turned its dispatched commit into the accepted one. */
const acceptedOnce = producing(new Map([[acceptedCommit, [dispatchedCommit]]]));

/**
 * A spawn whose history answers the ticket's own source, its latest work
 * manifests and `bases`, recording each commit the walk asked about, and
 * naming no failed landing's base unless `landed` names one, whose ancestry
 * question rejects where its answer is an error.
 */
function spawningFrom(
  row: TicketSourceRow | undefined,
  bases: WorkResultBases = acceptedOnce,
  asked: string[] = [],
  landed?: {
    readonly base: GitObjectId;
    readonly answer: CommitAncestry | Error;
    readonly questions: CommitAncestryQuestion[];
  },
): ReturnType<typeof executionSourceObservation> {
  return executionSourceObservation(
    {
      binding: (asking, repository) => {
        if (landed === undefined)
          throw new Error("a spawn must not read the project binding");
        return Promise.resolve({
          partition: asking,
          repository: repository ?? asRepositoryId("project-default"),
          recoveryEpoch: asRecoveryEpoch("epoch"),
        });
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
      workResultBases: (_partition, ticket, commit, limit) => {
        assert.equal(ticket, 1, "the walk left the ticket's own results");
        asked.push(commit);
        return Promise.resolve(bases(commit).slice(0, limit));
      },
      failedLandingBase: (_partition, ticket) => {
        assert.equal(ticket, 1, "the landing read left the ticket");
        return Promise.resolve(landed?.base);
      },
    },
    landed === undefined
      ? noAncestry
      : {
          ancestry: (question) => {
            landed.questions.push(question);
            return landed.answer instanceof Error
              ? Promise.reject(landed.answer)
              : Promise.resolve(landed.answer);
          },
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
      changeBase: dispatchedCommit,
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
      changeBase: dispatchedCommit,
    },
  );
});

/** A spawn of the accepted source's ticket, over `bases`, and the commits its walk asked about. */
async function changeBaseOver(
  bases: WorkResultBases,
): Promise<{ changeBase: string | undefined; asked: readonly string[] }> {
  const asked: string[] = [];
  const sourced = await spawningFrom(
    { repository: asRepositoryId("work-repository"), commit: acceptedCommit },
    bases,
    asked,
  ).spawnSource({
    partition,
    ticket: 1,
    source: acceptedReference,
    kind: "Evaluation",
  });
  return { changeBase: sourced?.changeBase, asked };
}

/**
 * A rework starts at the result an evaluation failed, so the result it then
 * produces started from that one. Catches a base read off the latest work
 * alone, under which an evaluation of the rework would narrow to the rework's
 * own diff and skip what the first attempt changed.
 */
test("the change's base is walked back through every work result of the ticket", async () => {
  const reworked = asGitObjectId("b".repeat(40));
  const { changeBase, asked } = await changeBaseOver(
    producing(
      new Map([
        [acceptedCommit, [reworked]],
        [reworked, [dispatchedCommit]],
      ]),
    ),
  );
  assert.equal(changeBase, dispatchedCommit);
  assert.deepEqual(asked, [acceptedCommit, reworked, dispatchedCommit]);
});

test("a source no work of the ticket produced is where its change started", async () => {
  assert.equal(
    (await changeBaseOver(producing(new Map()))).changeBase,
    acceptedCommit,
  );
});

/** Catches either of two claimed bases taken, which is a guess a check would narrow to. */
test("a commit two of the ticket's results claim names no base", async () => {
  const { changeBase } = await changeBaseOver(
    producing(
      new Map([
        [acceptedCommit, [dispatchedCommit, asGitObjectId("e".repeat(40))]],
      ]),
    ),
  );
  assert.equal(changeBase, undefined);
});

/** Catches a walk with no bound, which a history whose bases never end would hold forever. */
test("a walk that does not end within its bound names no base", async () => {
  let produced = 0;
  const { changeBase, asked } = await changeBaseOver(() => {
    produced += 1;
    return [asGitObjectId(produced.toString(16).padStart(40, "0"))];
  });
  assert.equal(changeBase, undefined);
  assert.equal(asked.length, changeBaseStepsMax + 1);
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

/** The base a failed landing's proposal failed on, which the rework brought in. */
const landedBase = asGitObjectId("9".repeat(40));

/** A spawn of the accepted source after a failed landing naming `landedBase`, with ancestry answering `answer`, or rejecting with it. */
async function landedChangeBase(
  kind: "Work" | "Evaluation",
  answer: CommitAncestry | Error,
): Promise<{
  changeBase: string | undefined;
  questions: readonly CommitAncestryQuestion[];
}> {
  const questions: CommitAncestryQuestion[] = [];
  const sourced = await spawningFrom(
    { repository: asRepositoryId("work-repository"), commit: acceptedCommit },
    acceptedOnce,
    [],
    { base: landedBase, answer, questions },
  ).spawnSource({ partition, ticket: 1, source: acceptedReference, kind });
  return { changeBase: sourced?.changeBase, questions };
}

/**
 * A rework that brought in the base its proposal failed on holds that base's
 * commits. Catches the walked-back base kept, under which a check or a reviewer
 * reads the base's own commits as the ticket's change.
 */
test("an evaluation of a commit holding the failed landing's base starts its change there", async () => {
  const { changeBase, questions } = await landedChangeBase(
    "Evaluation",
    "Ancestor",
  );
  assert.equal(changeBase, landedBase);
  assert.deepEqual(
    questions.map((question) => [
      question.repository.repository,
      question.candidate,
      question.tip,
    ]),
    [["work-repository", landedBase, acceptedCommit]],
  );
});

/** Catches a work cycle after an evaluation's NeedsWork falling back to the walked-back base. */
test("a later work cycle at a commit holding the failed landing's base starts its change there", async () => {
  assert.equal(
    (await landedChangeBase("Work", "Ancestor")).changeBase,
    landedBase,
  );
});

/** Catches the landing's base taken on its word, where the commit run at does not hold it. */
test("a commit not holding the failed landing's base keeps the walked-back base", async () => {
  assert.equal(
    (await landedChangeBase("Evaluation", "NotAncestor")).changeBase,
    dispatchedCommit,
  );
});

/** Catches an unanswered question read as a yes. */
test("a commit whose ancestry is unknown keeps the walked-back base", async () => {
  assert.equal(
    (await landedChangeBase("Evaluation", "Unknown")).changeBase,
    dispatchedCommit,
  );
});

/** The tree the accepted commit records. */
const acceptedTree = asGitObjectId("e".repeat(40));

/** A spawn of the accepted source over a tree port answering `answer`, rejecting where it is an error, and the commits it was asked the tree of. */
async function treedSpawn(
  kind: "Work" | "Evaluation",
  answer: GitObjectId | undefined | Error,
  bound = true,
): Promise<{
  expectedTree: string | undefined;
  asked: readonly string[];
}> {
  const asked: string[] = [];
  const sourced = await executionSourceObservation(
    {
      binding: (asking, repository) =>
        Promise.resolve(
          bound
            ? {
                partition: asking,
                repository: repository ?? asRepositoryId("project-default"),
                recoveryEpoch: asRecoveryEpoch("epoch"),
              }
            : undefined,
        ),
    },
    {
      observeTarget: () => {
        throw new Error("mutable Git must not be observed");
      },
    },
    {
      workSource: () =>
        Promise.resolve({ manifests: [asResultManifestId("manifest-one")] }),
      ticketSource: () =>
        Promise.resolve({
          repository: asRepositoryId("work-repository"),
          commit: acceptedCommit,
        }),
      workResultBases: (_partition, _ticket, commit) =>
        Promise.resolve(acceptedOnce(commit)),
      failedLandingBase: () => Promise.resolve(undefined),
    },
    {
      ...noAncestry,
      tree: (question) => {
        asked.push(question.commit);
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
      },
    },
  ).spawnSource({ partition, ticket: 1, source: acceptedReference, kind });
  return { expectedTree: sourced?.expectedTree, asked };
}

/** Catches an evaluation spawned without the tree its work's accepted commit records. */
test("an evaluation is bound to the tree of the commit it judges", async () => {
  assert.deepEqual(await treedSpawn("Evaluation", acceptedTree), {
    expectedTree: acceptedTree,
    asked: [acceptedCommit],
  });
});

/** Catches a work cycle bound to a tree, which would refuse the work it is to produce. */
test("a work cycle is bound to no tree and asks for none", async () => {
  assert.deepEqual(await treedSpawn("Work", acceptedTree), {
    expectedTree: undefined,
    asked: [],
  });
});

/** Catches a tree nobody could read refusing every verdict of an evaluation that could not be bound. */
test("an evaluation whose commit's tree cannot be read, or whose binding is gone, is bound to none", async () => {
  for (const unreadable of [undefined, new Error("the scratch is full")])
    assert.equal(
      (await treedSpawn("Evaluation", unreadable)).expectedTree,
      undefined,
    );
  assert.deepEqual(await treedSpawn("Evaluation", acceptedTree, false), {
    expectedTree: undefined,
    asked: [],
  });
});

/** Catches an ancestry port that cannot work failing the spawn rather than keeping the walked-back base. */
test("a commit whose ancestry question rejects keeps the walked-back base", async () => {
  assert.equal(
    (
      await landedChangeBase(
        "Evaluation",
        new Error("the credential source raised"),
      )
    ).changeBase,
    dispatchedCommit,
  );
});
