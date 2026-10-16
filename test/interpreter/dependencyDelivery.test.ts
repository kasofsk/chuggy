/**
 * What a ticket's dependencies delivered: where a change is, read from the
 * landing that finished its ticket; what a dispatch pins and the one question
 * it asks; and what a briefing derives from the pins.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import type { CommitAncestryQuestion } from "../../src/interpreter/commitAncestry.ts";
import {
  dependencyChange,
  dependencyChangeCommit,
  dependencyDeliveriesMax,
  dependencyDeliveriesRead,
  dependencyPinning,
  type DependencyDeliveriesPorts,
  type DependencyPinned,
  type DependencyPinningPorts,
  type DependencyResult,
} from "../../src/interpreter/dependencyDelivery.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import { asDraftBrief } from "../../src/interpreter/ticketBrief.ts";
import type { TicketLandingRecord } from "../../src/interpreter/ticketLandings.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const own = asRepositoryId("https://github.com/mimage/argus.git");
const sibling = asRepositoryId("https://github.com/mimage/rust-libs.git");
const workCommit = asGitObjectId("1".repeat(40));
const landedCommit = asGitObjectId("2".repeat(40));
const headCommit = asGitObjectId("3".repeat(40));
const dispatched = asGitObjectId("9".repeat(40));
const execution = asExecutionId("execution");

/** A dependency's passing work result, produced in `repository`. */
function resultIn(
  repository: RepositoryId,
  manifest = "manifest",
): DependencyResult {
  return {
    manifest: asResultManifestId(manifest),
    repository,
    commit: workCommit,
    ref: asGitRefName("refs/heads/chuggy/12"),
  };
}

/** A landing's request and its one prepared attempt, before it concluded. */
const landingOpen: TicketLandingRecord = {
  cycle: 1,
  generation: 1,
  request: "Fulfilled",
  attempts: 1,
  approvalOpen: false,
  attempt: {
    outcome: "Prepared",
    targetRef: "refs/heads/main",
    targetCommit: asGitObjectId("4".repeat(40)),
    candidateCommit: landedCommit,
    preparedAt: asPublicInstant("2026-10-16T00:00:00.000000Z"),
  },
};

/** A landing that succeeded, with whatever else a case gives it. */
function landingOf(
  parts: Partial<TicketLandingRecord> = {},
): TicketLandingRecord {
  return { ...landingOpen, concluded: "Succeeded", ...parts };
}

/** A landing whose request was invalidated before it concluded. */
function landingUnconcluded(): TicketLandingRecord {
  return { ...landingOpen, request: "Invalidated" };
}

const proposal = {
  url: "https://github.com/mimage/argus/pull/41",
  headRef: "chuggy/12",
  headCommit,
  baseRef: "main",
};

test("a landing that pushed a commit is where it landed, on the ref its attempt targeted", () => {
  assert.deepEqual(
    dependencyChange(resultIn(own), landingOf({ landedCommit })),
    { change: "Landed", commit: landedCommit, ref: "refs/heads/main" },
  );
});

test("a landing that merged its pull request is where the merge landed, on the pull request's base", () => {
  const mergedHead = asGitObjectId("5".repeat(40));
  assert.deepEqual(
    dependencyChange(
      resultIn(own),
      landingOf({
        landedCommit,
        proposal: { ...proposal, status: "Merged", mergedHead },
      }),
    ),
    {
      change: "Landed",
      commit: landedCommit,
      ref: "main",
      proposal: { ...proposal, status: "Merged", mergedHead },
    },
  );
});

test("a landing that only opened a pull request is that pull request, at its head", () => {
  const change = dependencyChange(
    resultIn(own),
    landingOf({ proposal: { ...proposal, status: "Open" } }),
  );
  assert.deepEqual(change, {
    change: "Proposed",
    proposal: { ...proposal, status: "Open" },
  });
  assert.equal(dependencyChangeCommit(change), headCommit);
});

test("a pull request's link is named only where a report could carry it", () => {
  const change = dependencyChange(
    resultIn(own),
    landingOf({ proposal: { ...proposal, url: "javascript:alert(1)" } }),
  );
  assert.equal(change.change, "Proposed");
  if (change.change === "Proposed")
    assert.equal(change.proposal.url, undefined);
});

test("a ticket no landing succeeded for is the commit its work produced, and one that changed nothing is no commit", () => {
  for (const landing of [
    undefined,
    landingOf({ concluded: "NeedsWork" }),
    landingUnconcluded(),
  ]) {
    assert.deepEqual(dependencyChange(resultIn(own), landing), {
      change: "Committed",
      commit: workCommit,
      ref: "refs/heads/chuggy/12",
    });
  }
  const unsourced = dependencyChange(
    { manifest: asResultManifestId("manifest") },
    undefined,
  );
  assert.deepEqual(unsourced, { change: "Unsourced" });
  assert.equal(dependencyChangeCommit(unsourced), undefined);
});

/** The ports a pinning case reads, answering each dependency from `results` and recording each question. */
function pinningPorts(
  results: ReadonlyMap<number, DependencyResult>,
  asked: CommitAncestryQuestion[],
  answer: (
    question: CommitAncestryQuestion,
  ) => Promise<"Ancestor" | "NotAncestor" | "Unknown">,
  landings: ReadonlyMap<number, TicketLandingRecord> = new Map(),
): DependencyPinningPorts {
  return {
    results: {
      accepted: (_partition, dependency) =>
        Promise.resolve(results.get(dependency)),
    },
    landings: {
      landings: (_partition, ticket) => {
        const landing = landings.get(ticket);
        return Promise.resolve(landing === undefined ? [] : [landing]);
      },
    },
    bindings: {
      binding: (bound, repository) =>
        Promise.resolve(
          repository === undefined
            ? undefined
            : {
                partition: bound,
                repository,
                recoveryEpoch: asRecoveryEpoch("epoch"),
              },
        ),
    },
    ancestry: {
      ancestry: (question) => {
        asked.push(question);
        return answer(question);
      },
    },
  };
}

test("a dispatch pins every dependency's result and asks the ancestry only of changes in its own repository", async () => {
  const asked: CommitAncestryQuestion[] = [];
  const pins = await dependencyPinning(
    pinningPorts(
      new Map([
        [12, resultIn(own, "manifest-12")],
        [15, resultIn(sibling, "manifest-15")],
        [17, { manifest: asResultManifestId("manifest-17") }],
        [19, resultIn(own, "manifest-19")],
      ]),
      asked,
      (question) =>
        Promise.resolve(
          question.candidate === landedCommit ? "Ancestor" : "NotAncestor",
        ),
      new Map([
        [12, landingOf({ landedCommit })],
        [19, landingOf({ proposal })],
      ]),
    ),
  ).pins({
    partition,
    source: { reference: 1, repository: own, commit: dispatched },
    accepted: [12, 15, 17, 19].map((dependency) => ({
      dependency: asTicketId(dependency),
      result: dependency,
    })),
  });
  assert.deepEqual(pins, {
    results: ["manifest-12", "manifest-15", "manifest-17", "manifest-19"],
    ancestors: [landedCommit],
    nonAncestors: [headCommit],
  });
  assert.deepEqual(
    asked.map((question) => [
      question.repository.repository,
      question.candidate,
      question.tip,
    ]),
    [
      [own, landedCommit, dispatched],
      [own, headCommit, dispatched],
    ],
  );
});

test("a question the ancestry could not answer, or raised on, is pinned as neither", async () => {
  for (const answer of [
    () => Promise.resolve("Unknown" as const),
    () => Promise.reject(new Error("the remote is down")),
  ]) {
    const pins = await dependencyPinning(
      pinningPorts(new Map([[12, resultIn(own)]]), [], answer),
    ).pins({
      partition,
      source: { reference: 1, repository: own, commit: dispatched },
      accepted: [{ dependency: asTicketId(12), result: 12 }],
    });
    assert.deepEqual(pins, {
      results: ["manifest"],
      ancestors: [],
      nonAncestors: [],
    });
  }
});

test("a dispatch at no commit asks nothing, and a result its rows do not hold is refused", async () => {
  const asked: CommitAncestryQuestion[] = [];
  const ports = pinningPorts(new Map([[12, resultIn(own)]]), asked, () =>
    Promise.resolve("Ancestor"),
  );
  const pins = await dependencyPinning(ports).pins({
    partition,
    source: { reference: 1 },
    accepted: [{ dependency: asTicketId(12), result: 12 }],
  });
  assert.deepEqual(pins.ancestors, []);
  assert.deepEqual(asked, []);
  await assert.rejects(
    dependencyPinning(ports).pins({
      partition,
      source: { reference: 1 },
      accepted: [{ dependency: asTicketId(13), result: 13 }],
    }),
    /accepted result is not one its rows hold/u,
  );
  await assert.rejects(
    dependencyPinning(ports).pins({
      partition,
      source: { reference: 1 },
      accepted: Array.from({ length: dependencyDeliveriesMax + 1 }, () => ({
        dependency: asTicketId(12),
        result: 12,
      })),
    }),
    RangeError,
  );
});

/** What a dispatch at `dispatched` in `own` pinned, starting this execution there or not. */
function pinnedAt(
  startsAtBegan: boolean,
  results: DependencyPinned["results"],
  ancestors: DependencyPinned["ancestors"] = [],
  nonAncestors: DependencyPinned["nonAncestors"] = [],
): DependencyPinned {
  return {
    repository: own,
    began: dispatched,
    startsAtBegan,
    results,
    ancestors,
    nonAncestors,
  };
}

/**
 * Three dependencies a dispatch at `dispatched` in `own` pinned, which this
 * execution does not start at: one landed and reporting, one in another
 * repository, and one committed whose ancestry was not found out.
 */
const derivingPorts: DependencyDeliveriesPorts = {
  pinned: {
    pinned: () =>
      Promise.resolve({
        read: "Pinned",
        pinned: pinnedAt(
          false,
          [
            { dependency: asTicketId(12), ...resultIn(own), report: "Done." },
            { dependency: asTicketId(15), ...resultIn(sibling) },
            { dependency: asTicketId(17), ...resultIn(own) },
          ],
          [landedCommit],
        ),
      }),
  },
  landings: {
    landings: (_partition, ticket) =>
      Promise.resolve(ticket === 12 ? [landingOf({ landedCommit })] : []),
  },
  briefs: {
    brief: (_partition, ticket) =>
      Promise.resolve(
        ticket === 12
          ? asDraftBrief({ title: "Count rows", intent: "Count.", links: [] })
          : undefined,
      ),
  },
};

test("a briefing derives each delivery from the pins, the dependency's landing and its title", async () => {
  const read = await dependencyDeliveriesRead(derivingPorts).deliveries(
    partition,
    execution,
  );
  assert.equal(read.read, "Deliveries");
  if (read.read !== "Deliveries") return;
  assert.deepEqual(read.deliveries, [
    {
      dependency: 12,
      title: "Count rows",
      repository: { repository: own, own: true },
      change: {
        change: "Landed",
        commit: landedCommit,
        ref: "refs/heads/main",
      },
      history: {
        commit: landedCommit,
        began: dispatched,
        startsAtBegan: false,
        ancestry: "Ancestor",
      },
      report: "Done.",
    },
    {
      dependency: 15,
      repository: { repository: sibling, own: false },
      change: {
        change: "Committed",
        commit: workCommit,
        ref: "refs/heads/chuggy/12",
      },
    },
    {
      dependency: 17,
      repository: { repository: own, own: true },
      change: {
        change: "Committed",
        commit: workCommit,
        ref: "refs/heads/chuggy/12",
      },
      history: {
        commit: workCommit,
        began: dispatched,
        startsAtBegan: false,
        ancestry: "Unknown",
      },
    },
  ]);
});

test("a briefing whose pins could not be read is unavailable, and a dependency's landing that raised raises", async () => {
  const briefs = { brief: () => Promise.resolve(undefined) };
  assert.deepEqual(
    await dependencyDeliveriesRead({
      pinned: {
        pinned: () => Promise.resolve({ read: "Unavailable" as const }),
      },
      landings: { landings: () => Promise.resolve([]) },
      briefs,
    }).deliveries(partition, execution),
    { read: "Unavailable" },
  );
  await assert.rejects(
    dependencyDeliveriesRead({
      pinned: {
        pinned: () =>
          Promise.resolve({
            read: "Pinned" as const,
            pinned: pinnedAt(true, [
              { dependency: asTicketId(12), ...resultIn(own) },
            ]),
          }),
      },
      landings: {
        landings: () => Promise.reject(new Error("the pool is down")),
      },
      briefs,
    }).deliveries(partition, execution),
    /the pool is down/,
  );
});
