import assert from "node:assert/strict";
import test from "node:test";

import {
  allChangeProposalMergeAnswers,
  allChangeProposalMergeReconciliations,
  allChangeProposalMerges,
  asForgeBindingId,
  asForgeCredentialReference,
  asChangeProposalRequestIdentity,
  asProposalDisplayUrl,
  asProposalMarker,
  asProposalMergeState,
  asProposalNumber,
  asProposalRemoteIdentity,
  changeProposalAdoptionNext,
  changeProposalMergeNext,
  changeProposalMergeRequest,
  changeProposalPublicationNext,
  changeProposalUpdatingNone,
  changeProposalRequest,
  proposalBodyCharsMax,
  proposalEvidenceCharsMax,
  proposalMarkerCharsMax,
  proposalMarkerOf,
  proposalDisplayUrlCharsMax,
  proposalMergeRereadSecs,
  proposalTitleCharsMax,
  reconcileChangeProposal,
  reconcileChangeProposalMerge,
  type ChangeProposalAdapterSelector,
  type ChangeProposalEvidence,
  type ChangeProposalMergeGathered,
  type ChangeProposalMergeReconciliationStored,
  type ChangeProposalMerging,
  type ChangeProposalPort,
  type ChangeProposalPublication,
  type ChangeProposalReconciliationStored,
  type ProposalNumber,
} from "../../src/interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  allGitObjectIdChars,
  finalizerIdentityCharsMax,
  gitRefNameCharsMax,
} from "../../src/interpreter/finalizer.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { proposalMergeStateCharsMax } from "../../src/contract/http.ts";
import { populated } from "./roster.ts";
const requestIdentity = asChangeProposalRequestIdentity("a".repeat(64));
const requestPartition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const forge = asForgeBindingId("forge-alpha");
const requestHeadRef = asGitRefName("refs/heads/chuggy/footer-2026");
const request = changeProposalRequest({
  binding: {
    forge,
    credential: asForgeCredentialReference("forge-alpha-proposals"),
  },
  repository: asRepositoryId("platform-desires"),
  partition: requestPartition,
  request: requestIdentity,
  headRef: requestHeadRef,
  headCommit: asGitObjectId("b".repeat(40)),
  baseRef: asGitRefName("refs/heads/team-orange"),
  baseCommit: asGitObjectId("c".repeat(40)),
  title: "Build the accepted revision",
  body: "One deterministic request.",
});

function evidence(
  overrides: Partial<ChangeProposalEvidence> = {},
): ChangeProposalEvidence {
  return {
    identity: {
      forge,
      remote: asProposalRemoteIdentity("proposal-17"),
      number: asProposalNumber(17),
    },
    repository: request.repository,
    marker: request.marker,
    head: request.head,
    base: request.base,
    title: request.title,
    body: request.body,
    status: "Open",
    url: asProposalDisplayUrl("https://forge.invalid/proposals/proposal-17"),
    ...overrides,
  };
}

test("ambiguous creation is accepted only after the deterministic marker reconciles", () => {
  assert.deepEqual(
    reconcileChangeProposal(
      request,
      {
        read: "Found",
        evidence: evidence(),
      },
      "Contradictory",
    ),
    { reconciled: "Accepted", evidence: evidence() },
  );
  assert.deepEqual(
    reconcileChangeProposal(request, { read: "Absent" }, "Contradictory"),
    {
      reconciled: "Absent",
    },
  );
  assert.deepEqual(
    reconcileChangeProposal(request, { read: "Unavailable" }, "Contradictory"),
    {
      reconciled: "Unavailable",
    },
  );
});

test("a proposal already merged contradicts only the landing that was not going to merge it", () => {
  const merged = evidence({ status: "Merged" });
  const closed = evidence({ status: "Closed" });
  assert.deepEqual(
    reconcileChangeProposal(
      request,
      { read: "Found", evidence: merged },
      "Contradictory",
    ),
    { reconciled: "Contradictory", contradiction: "Merged", evidence: merged },
  );
  assert.deepEqual(
    reconcileChangeProposal(
      request,
      { read: "Found", evidence: merged },
      "Accepted",
    ),
    { reconciled: "Accepted", evidence: merged },
  );
  assert.deepEqual(
    reconcileChangeProposal(
      request,
      { read: "Found", evidence: closed },
      "Accepted",
    ),
    { reconciled: "Contradictory", contradiction: "Closed", evidence: closed },
    "a landing that merges accepts nothing else it did not ask for",
  );
});

/** The ceilings every publication case below is continued under. */
const bounds = { creationsMax: 2, reconciliationsMax: 2 };

/** One create in flight, with however many readings a case has already taken. */
function unanswered(
  creations: number,
  reconciliations: number,
  reading?: ChangeProposalReconciliationStored,
): ChangeProposalPublication {
  return { publication: "Unanswered", creations, reconciliations, reading };
}

test("a create nobody heard back from is read back within its bound and then released", () => {
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      unanswered(1, 0),
      bounds,
      "Contradictory",
    ),
    {
      next: "Reconcile",
    },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      unanswered(1, 1, { reconciled: "Absent" }),
      bounds,
      "Contradictory",
    ),
    { next: "Reconcile" },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      unanswered(1, 2, { reconciled: "Absent" }),
      bounds,
      "Contradictory",
    ),
    { next: "RefuseAttempt" },
    "readings that all found nothing prove the create was never taken",
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      unanswered(2, 3, { reconciled: "Absent" }),
      bounds,
      "Contradictory",
    ),
    { next: "Reconcile" },
    "the second attempt is read back under a budget of its own",
  );
});

test("only a state with nothing in flight creates, and only while the creations are unspent", () => {
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      { publication: "Unopened" },
      bounds,
      "Contradictory",
    ),
    { next: "Create" },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      { publication: "Idle", creations: 1 },
      bounds,
      "Contradictory",
    ),
    { next: "Create" },
    "a create that spent one of them leaves another one to make",
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      { publication: "Idle", creations: 2 },
      bounds,
      "Contradictory",
    ),
    { next: "Held", reason: "CreationsExhausted" },
  );
});

test("an answer whose evidence nothing could store is held rather than proposed again", () => {
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      { publication: "Answered", creation: { created: "Unstorable" } },
      bounds,
      "Contradictory",
    ),
    { next: "Held", reason: "EvidenceUnstorable" },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      unanswered(1, 1, { reconciled: "Unstorable" }),
      bounds,
      "Contradictory",
    ),
    { next: "Held", reason: "EvidenceUnstorable" },
  );
});

test("a bound that is not a count is refused rather than treated as none", () => {
  for (const bound of [0, -1, 1.5]) {
    for (const offered of [
      { creationsMax: bound, reconciliationsMax: 2 },
      { creationsMax: 2, reconciliationsMax: bound },
    ]) {
      assert.throws(
        () =>
          changeProposalPublicationNext(
            request,
            { publication: "Unopened" },
            offered,
            "Contradictory",
          ),
        RangeError,
        JSON.stringify(offered),
      );
    }
  }
});

test("no publication in flight and no answered one reaches a create", () => {
  const publications: readonly ChangeProposalPublication[] = [
    unanswered(1, 0),
    unanswered(1, 1, { reconciled: "Absent" }),
    unanswered(2, 4, { reconciled: "Absent" }),
    { publication: "Idle", creations: 2 },
    { publication: "Answered", creation: { created: "Unstorable" } },
    {
      publication: "Answered",
      creation: { created: "Created", evidence: evidence() },
    },
  ];
  for (const publication of publications) {
    assert.notEqual(
      changeProposalPublicationNext(
        request,
        publication,
        bounds,
        "Contradictory",
      ).next,
      "Create",
      JSON.stringify(publication).slice(0, 60),
    );
  }
});

/** One string of the character a JSON rendering spends the most on. */
function escaped(chars: number): string {
  return String.fromCodePoint(1).repeat(chars);
}

test("the largest evidence any bounded answer carries is stored under the evidence bound", () => {
  const widest = Math.max(...allGitObjectIdChars);
  const largest: ChangeProposalEvidence = {
    identity: {
      forge: asForgeBindingId(escaped(finalizerIdentityCharsMax)),
      remote: asProposalRemoteIdentity(escaped(finalizerIdentityCharsMax)),
      number: asProposalNumber(Number.MAX_SAFE_INTEGER),
    },
    repository: asRepositoryId(escaped(finalizerIdentityCharsMax)),
    marker: request.marker,
    head: {
      ref: asGitRefName(escaped(gitRefNameCharsMax)),
      commit: asGitObjectId("a".repeat(widest)),
    },
    base: {
      ref: asGitRefName(escaped(gitRefNameCharsMax)),
      commit: asGitObjectId("b".repeat(widest)),
    },
    title: escaped(proposalTitleCharsMax),
    body: escaped(proposalBodyCharsMax),
    status: "Superseded",
    mergeability: "Conflicting",
    mergeState: asProposalMergeState(escaped(proposalMergeStateCharsMax)),
    mergeCommit: asGitObjectId("c".repeat(widest)),
    url: asProposalDisplayUrl(escaped(proposalDisplayUrlCharsMax)),
  };
  assert.equal(largest.marker.length <= proposalMarkerCharsMax, true);
  assert.equal(JSON.stringify(largest).length < proposalEvidenceCharsMax, true);
});

test("closed, merged, retargeted, and mismatched proposals are explicit contradictions", () => {
  const cases: readonly [Partial<ChangeProposalEvidence>, string][] = [
    [{ status: "Closed" }, "Closed"],
    [{ status: "Merged" }, "Merged"],
    [{ status: "Superseded" }, "Superseded"],
    [
      {
        base: {
          ref: asGitRefName("refs/heads/another-target"),
          commit: request.base.commit,
        },
      },
      "BaseMismatch",
    ],
    [
      {
        head: {
          ref: asGitRefName("refs/heads/another-head"),
          commit: request.head.commit,
        },
      },
      "HeadMismatch",
    ],
    [{ repository: asRepositoryId("other-repository") }, "RepositoryMismatch"],
    [{ title: "Changed title" }, "MetadataMismatch"],
    [{ body: "Changed body" }, "MetadataMismatch"],
    [
      {
        identity: {
          forge: asForgeBindingId("forge-beta"),
          remote: asProposalRemoteIdentity("proposal-17"),
          number: asProposalNumber(17),
        },
      },
      "ForgeMismatch",
    ],
  ];
  for (const [overrides, contradiction] of cases) {
    const found = evidence(overrides);
    assert.deepEqual(
      reconcileChangeProposal(
        request,
        { read: "Found", evidence: found },
        "Contradictory",
      ),
      { reconciled: "Contradictory", contradiction, evidence: found },
    );
  }
});

test("a publication answered by a merged proposal settles on what the landing asked for", () => {
  const merged = evidence({ status: "Merged" });
  const answered: ChangeProposalPublication = {
    publication: "Answered",
    creation: { created: "Created", evidence: merged },
  };
  assert.deepEqual(
    changeProposalPublicationNext(request, answered, bounds, "Contradictory"),
    { next: "Refused", contradiction: "Merged", evidence: merged },
  );
  assert.deepEqual(
    changeProposalPublicationNext(request, answered, bounds, "Accepted"),
    { next: "Accepted", evidence: merged },
  );
});

test("a base branch that moved between the observation and the create is the same proposal", () => {
  const moved = evidence({
    base: {
      ref: request.base.ref,
      commit: asGitObjectId("e".repeat(40)),
    },
  });
  assert.deepEqual(
    reconcileChangeProposal(
      request,
      { read: "Found", evidence: moved },
      "Contradictory",
    ),
    { reconciled: "Accepted", evidence: moved },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      {
        publication: "Answered",
        creation: { created: "Created", evidence: moved },
      },
      bounds,
      "Contradictory",
    ),
    { next: "Accepted", evidence: moved },
  );
});

test("a head branch pushed to between the create and the reading is the same proposal", () => {
  const pushed = evidence({
    head: { ref: request.head.ref, commit: asGitObjectId("d".repeat(40)) },
  });
  assert.deepEqual(
    reconcileChangeProposal(
      request,
      { read: "Found", evidence: pushed },
      "Contradictory",
    ),
    { reconciled: "Accepted", evidence: pushed },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      unanswered(1, 0),
      bounds,
      "Contradictory",
    ),
    { next: "Reconcile" },
    "the reading that finds it is the one this recovers through",
  );
});

test("created and existing evidence from another forge is never accepted", () => {
  const wrongForge = evidence({
    identity: {
      forge: asForgeBindingId("forge-beta"),
      remote: asProposalRemoteIdentity("proposal-17"),
      number: asProposalNumber(17),
    },
  });
  for (const created of ["Created", "AlreadyExists"] as const) {
    assert.deepEqual(
      changeProposalPublicationNext(
        request,
        {
          publication: "Answered",
          creation: { created, evidence: wrongForge },
        },
        bounds,
        "Contradictory",
      ),
      {
        next: "Refused",
        contradiction: "ForgeMismatch",
        evidence: wrongForge,
      },
    );
  }
});

test("stored reconciliation results are rebound to the current request", () => {
  const stale = evidence({
    repository: asRepositoryId("stale-repository"),
  });
  for (const reading of [
    { reconciled: "Accepted", evidence: stale },
    {
      reconciled: "Contradictory",
      contradiction: "Closed",
      evidence: stale,
    },
  ] as const) {
    assert.deepEqual(
      changeProposalPublicationNext(
        request,
        unanswered(1, 1, reading),
        bounds,
        "Contradictory",
      ),
      {
        next: "Refused",
        contradiction: "RepositoryMismatch",
        evidence: stale,
      },
    );
  }
});

test("the same contract selects adapters with unrelated provider vocabularies", async () => {
  const calls: string[] = [];
  function adapter(vocabulary: string): ChangeProposalPort {
    return {
      create: () => {
        calls.push(`${vocabulary}:create`);
        return Promise.resolve({ created: "Created", evidence: evidence() });
      },
      readByMarker: () => {
        calls.push(`${vocabulary}:read`);
        return Promise.resolve({ read: "Found", evidence: evidence() });
      },
      readByNumber: () => {
        calls.push(`${vocabulary}:read-by-number`);
        return Promise.resolve({ read: "Found", evidence: evidence() });
      },
      merge: () => {
        calls.push(`${vocabulary}:merge`);
        return Promise.resolve({ merged: "Ambiguous" });
      },
      updateBranch: () => {
        calls.push(`${vocabulary}:update-branch`);
        return Promise.resolve({ updated: "Accepted" });
      },
    };
  }
  const adapters = new Map([
    ["forge-alpha", adapter("change-request")],
    ["forge-beta", adapter("merge-proposal")],
  ]);
  const selector: ChangeProposalAdapterSelector = {
    select: (binding) => adapters.get(binding),
  };
  await selector.select(asForgeBindingId("forge-alpha"))?.create(request);
  await selector.select(asForgeBindingId("forge-beta"))?.readByMarker(request);
  await selector
    .select(asForgeBindingId("forge-beta"))
    ?.readByNumber(mergeRequest);
  await selector.select(asForgeBindingId("forge-beta"))?.merge(mergeRequest);
  await selector
    .select(asForgeBindingId("forge-beta"))
    ?.updateBranch(mergeRequest);
  assert.deepEqual(calls, [
    "change-request:create",
    "merge-proposal:read",
    "merge-proposal:read-by-number",
    "merge-proposal:merge",
    "merge-proposal:update-branch",
  ]);
  assert.equal(selector.select(asForgeBindingId("unbound-forge")), undefined);
});

test("proposal metadata is bounded and the head is the branch the caller named", () => {
  for (const unbounded of [
    { title: "", body: request.body },
    { title: request.title, body: "x".repeat(proposalBodyCharsMax + 1) },
  ]) {
    assert.throws(
      () =>
        changeProposalRequest({
          binding: request.binding,
          repository: request.repository,
          partition: requestPartition,
          request: requestIdentity,
          headRef: requestHeadRef,
          headCommit: request.head.commit,
          baseRef: request.base.ref,
          baseCommit: request.base.commit,
          ...unbounded,
        }),
      RangeError,
    );
  }
  assert.equal(request.head.ref, requestHeadRef);
  assert.equal(asChangeProposalRequestIdentity("f".repeat(64)).length, 64);
  for (const malformed of [
    "f".repeat(63),
    "f".repeat(65),
    "F".repeat(64),
    `${"f".repeat(63)}g`,
  ]) {
    assert.throws(() => asChangeProposalRequestIdentity(malformed), RangeError);
  }
});

test("a marker read back out of a stored row is bounded rather than believed", () => {
  assert.equal(asProposalMarker(request.marker), request.marker);
  for (const unbounded of ["", "m".repeat(proposalMarkerCharsMax + 1)]) {
    assert.throws(() => asProposalMarker(unbounded), RangeError);
  }
});

/** The commit a merge of this request's proposal left. */
const mergeCommit = asGitObjectId("f".repeat(40));

const mergeRequest = changeProposalMergeRequest({
  binding: request.binding,
  partition: requestPartition,
  repository: request.repository,
  proposal: evidence().identity,
  marker: request.marker,
  headCommit: request.head.commit,
});

test("a merge addresses a numbered proposal on the forge its binding selects", () => {
  assert.deepEqual(mergeRequest.proposal, evidence().identity);
  assert.equal(mergeRequest.headCommit, request.head.commit);
  assert.throws(
    () =>
      changeProposalMergeRequest({
        ...mergeRequest,
        proposal: {
          ...mergeRequest.proposal,
          forge: asForgeBindingId("forge-beta"),
        },
      }),
    TypeError,
    "a proposal on another forge is not this binding's to merge",
  );
  for (const number of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () =>
        changeProposalMergeRequest({
          ...mergeRequest,
          proposal: {
            ...mergeRequest.proposal,
            number: number as ProposalNumber,
          },
        }),
      RangeError,
      String(number),
    );
  }
});

test("a reading settles a merge where it finds the proposal merged and names the commit", () => {
  const merged = evidence({ status: "Merged", mergeCommit });
  assert.deepEqual(
    reconcileChangeProposalMerge(request, { read: "Found", evidence: merged }),
    { reconciled: "Accepted", evidence: merged },
  );
  const open = evidence();
  assert.deepEqual(
    reconcileChangeProposalMerge(request, { read: "Found", evidence: open }),
    { reconciled: "Unmerged", evidence: open },
    "a proposal still open is one a later reading may find merged",
  );
  const unnamed = evidence({ status: "Merged" });
  assert.deepEqual(
    reconcileChangeProposalMerge(request, { read: "Found", evidence: unnamed }),
    { reconciled: "Unavailable" },
    "a merge nobody can name the commit of is not settled",
  );
});

test("a proposal that is no longer this request's contradicts its merge as it does its create", () => {
  const closed = evidence({ status: "Closed" });
  assert.deepEqual(
    reconcileChangeProposalMerge(request, { read: "Found", evidence: closed }),
    { reconciled: "Contradictory", contradiction: "Closed", evidence: closed },
  );
  const retargeted = evidence({
    base: {
      ref: asGitRefName("refs/heads/another-target"),
      commit: request.base.commit,
    },
    status: "Merged",
    mergeCommit,
  });
  assert.deepEqual(
    reconcileChangeProposalMerge(request, {
      read: "Found",
      evidence: retargeted,
    }),
    {
      reconciled: "Contradictory",
      contradiction: "BaseMismatch",
      evidence: retargeted,
    },
    "a merge into another branch is not the merge this request asked for",
  );
  for (const read of ["Absent", "Unavailable", "Denied"] as const) {
    assert.deepEqual(reconcileChangeProposalMerge(request, { read }), {
      reconciled: read,
    });
  }
});

test("a reading of a merge is of the proposal its number names, whatever a person has since edited of its words", () => {
  const edits: readonly Partial<ChangeProposalEvidence>[] = [
    { title: "feat: a title a reviewer chose" },
    { body: `${request.body}\r\n` },
    { body: "A description a reviewer rewrote, with no marker left in it." },
    {
      marker: proposalMarkerOf(asChangeProposalRequestIdentity("e".repeat(64))),
    },
  ];
  for (const edit of edits) {
    const open = evidence({ ...edit, mergeability: "Blocked" });
    assert.deepEqual(
      reconcileChangeProposalMerge(request, { read: "Found", evidence: open }),
      { reconciled: "Unmerged", evidence: open },
      JSON.stringify(edit).slice(0, 60),
    );
    const merged = evidence({ ...edit, status: "Merged", mergeCommit });
    assert.deepEqual(
      reconcileChangeProposalMerge(request, {
        read: "Found",
        evidence: merged,
      }),
      { reconciled: "Accepted", evidence: merged },
      JSON.stringify(edit).slice(0, 60),
    );
  }
});

test("a reading finding the proposal merged at a head somebody else pushed accepts that merge", () => {
  const merged = evidence({
    head: { ref: request.head.ref, commit: asGitObjectId("d".repeat(40)) },
    status: "Merged",
    mergeCommit,
  });
  assert.deepEqual(
    reconcileChangeProposalMerge(request, { read: "Found", evidence: merged }),
    { reconciled: "Accepted", evidence: merged },
  );
  for (const merging of [
    waiting(1, 0, { reconciled: "Accepted", evidence: merged }),
    moved(0, { reconciled: "Accepted", evidence: merged }),
    unheard(1, 1, { reconciled: "Accepted", evidence: merged }),
  ])
    assert.deepEqual(
      changeProposalMergeNext(request, merging, pinned, mergeBounds),
      { next: "Concluded", merge: { merged: "Merged", mergeCommit } },
      merging.merging,
    );
});

test("every arm of the merge reading roster is one this reconciliation answers with", () => {
  const answered = new Set(
    [
      ...(["Absent", "Unavailable", "Denied"] as const).map((read) => ({
        read,
      })),
      {
        read: "Found" as const,
        evidence: evidence({ status: "Merged", mergeCommit }),
      },
      { read: "Found" as const, evidence: evidence() },
      { read: "Found" as const, evidence: evidence({ status: "Closed" }) },
    ].map((read) => reconcileChangeProposalMerge(request, read).reconciled),
  );
  assert.deepEqual(
    [...answered].sort(),
    [...allChangeProposalMergeReconciliations].sort(),
  );
});

/** The ceilings every merging case below is continued under. */
const mergeBounds = { mergesMax: 2, readingsMax: 2, updatesMax: 2 };

/** The head this request proposed, pinned, with nothing updated yet. */
const pinned: ChangeProposalMergeGathered = {
  head: request.head.commit,
  updating: changeProposalUpdatingNone,
};

/** A reading that found the proposal open and the forge ready to merge it. */
const mergeableReading = {
  reconciled: "Unmerged",
  evidence: evidence({ mergeability: "Mergeable" }),
} as const;

/** A reading that found the proposal open and the forge's own rules refusing it. */
const blockedReading = {
  reconciled: "Unmerged",
  evidence: evidence({
    mergeability: "Blocked",
    mergeState: asProposalMergeState("blocked"),
  }),
} as const;

/** A merge the forge's own rules refused, its reading heard so many seconds ago. */
function waiting(
  merges: number,
  heardAgeSecs: number,
  reading: ChangeProposalMergeReconciliationStored = blockedReading,
): ChangeProposalMerging {
  return { merging: "Waiting", merges, reading, heardAgeSecs };
}

/** A merge answered as a moved head, the forge last heard so many seconds ago. */
function moved(
  heardAgeSecs: number,
  reading?: ChangeProposalMergeReconciliationStored,
): ChangeProposalMerging {
  return { merging: "Moved", reading, heardAgeSecs };
}

/** One merge in flight, with however many readings a case has already taken. */
function unheard(
  merges: number,
  readings: number,
  reading?: ChangeProposalMergeReconciliationStored,
): ChangeProposalMerging {
  return { merging: "Unanswered", merges, readings, reading };
}

test("a merge nobody heard back from is read back within its bound and then released", () => {
  assert.deepEqual(
    changeProposalMergeNext(request, unheard(1, 0), pinned, mergeBounds),
    {
      next: "ReadByNumber",
    },
  );
  const open = { reconciled: "Unmerged", evidence: evidence() } as const;
  assert.deepEqual(
    changeProposalMergeNext(request, unheard(1, 1, open), pinned, mergeBounds),
    { next: "ReadByNumber" },
  );
  assert.deepEqual(
    changeProposalMergeNext(request, unheard(1, 2, open), pinned, mergeBounds),
    { next: "RefuseAttempt" },
    "readings that all found it open prove the merge was never made",
  );
  assert.deepEqual(
    changeProposalMergeNext(request, unheard(2, 3, open), pinned, mergeBounds),
    { next: "ReadByNumber" },
    "the second attempt is read back under a budget of its own",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, { reconciled: "Absent" }),
      pinned,
      mergeBounds,
    ),
    { next: "Held", reason: "ProposalAbsent" },
    "a number a reading found nothing at is merged nothing again",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, {
        reconciled: "Contradictory",
        contradiction: "Closed",
        evidence: evidence({ status: "Closed" }),
      }),
      pinned,
      mergeBounds,
    ),
    { next: "Wait", reason: "Closed" },
    "a proposal closed unmerged waits on whoever may reopen it",
  );
});

test("only a merging with nothing in flight merges, and only while the merges are unspent", () => {
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      { merging: "Unasked" },
      pinned,
      mergeBounds,
    ),
    {
      next: "Merge",
    },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      { merging: "Idle", merges: 1 },
      pinned,
      mergeBounds,
    ),
    { next: "Merge" },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      { merging: "Idle", merges: 2 },
      pinned,
      mergeBounds,
    ),
    { next: "Held", reason: "MergesExhausted" },
  );
  for (const merging of [
    unheard(1, 0),
    unheard(1, 1, { reconciled: "Absent" }),
    unheard(1, 2, { reconciled: "Unmerged", evidence: evidence() }),
    { merging: "Idle" as const, merges: 2 },
    waiting(1, 0, { reconciled: "Unmerged", evidence: evidence() }),
    moved(proposalMergeRereadSecs, mergeableReading),
  ]) {
    assert.notEqual(
      changeProposalMergeNext(request, merging, pinned, mergeBounds).next,
      "Merge",
      JSON.stringify(merging).slice(0, 60),
    );
  }
  assert.throws(
    () => changeProposalMergeNext(request, unheard(0, 0), pinned, mergeBounds),
    RangeError,
    "a state with nothing in flight is no state to read back from",
  );
});

test("a reading of the merged proposal concludes the merge, whatever the merge itself answered", () => {
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, {
        reconciled: "Accepted",
        evidence: evidence({ status: "Merged", mergeCommit }),
      }),
      pinned,
      mergeBounds,
    ),
    { next: "Concluded", merge: { merged: "Merged", mergeCommit } },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, {
        reconciled: "Accepted",
        evidence: evidence({ status: "Merged" }),
      }),
      pinned,
      mergeBounds,
    ),
    { next: "ReadByNumber" },
    "a merge whose commit nothing names is asked about again",
  );
});

test("what the forge says about merging is what tells a conflict from its own rules", () => {
  const conflicting = {
    reconciled: "Unmerged",
    evidence: evidence({ mergeability: "Conflicting" }),
  } as const;
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, conflicting),
      pinned,
      mergeBounds,
    ),
    {
      next: "Concluded",
      merge: { merged: "NotMergeable", reason: "Conflict" },
    },
  );
  const blocked = {
    reconciled: "Unmerged",
    evidence: evidence({ mergeability: "Blocked" }),
  } as const;
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, blocked),
      pinned,
      mergeBounds,
    ),
    { next: "Wait", reason: "Blocked" },
    "the forge's own rules release the merge to wait on them",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, {
        reconciled: "Contradictory",
        contradiction: "Closed",
        evidence: evidence({ status: "Closed" }),
      }),
      pinned,
      mergeBounds,
    ),
    { next: "Wait", reason: "Closed" },
    "a closed proposal releases the merge to wait on whoever may reopen it",
  );
  for (const said of [
    evidence({ mergeability: "Mergeable" }),
    evidence({ mergeability: "Unknown" }),
    evidence(),
  ]) {
    assert.deepEqual(
      changeProposalMergeNext(
        request,
        unheard(1, 1, { reconciled: "Unmerged", evidence: said }),
        pinned,
        mergeBounds,
      ),
      { next: "ReadByNumber" },
      JSON.stringify(said.mergeability),
    );
  }
});

test("a merge the forge answered is concluded from the row", () => {
  for (const merge of [
    { merged: "Merged", mergeCommit },
    { merged: "NotMergeable", reason: "Conflict" },
  ] as const) {
    assert.deepEqual(
      changeProposalMergeNext(
        request,
        { merging: "Answered", merge },
        pinned,
        mergeBounds,
      ),
      { next: "Concluded", merge },
    );
  }
});

test("a merge waiting on the forge's own rules is read again only once the cadence has passed", () => {
  assert.deepEqual(
    changeProposalMergeNext(request, waiting(1, 0), pinned, mergeBounds),
    { next: "Held", reason: "Blocked" },
    "a reading just taken is not taken again",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, proposalMergeRereadSecs - 1),
      pinned,
      mergeBounds,
    ),
    { next: "Held", reason: "Blocked" },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, proposalMergeRereadSecs),
      pinned,
      mergeBounds,
    ),
    { next: "ReadByNumber" },
  );
  for (const said of [evidence({ mergeability: "Unknown" }), evidence()]) {
    assert.deepEqual(
      changeProposalMergeNext(
        request,
        waiting(1, proposalMergeRereadSecs, {
          reconciled: "Unmerged",
          evidence: said,
        }),
        pinned,
        mergeBounds,
      ),
      { next: "ReadByNumber" },
      "a forge that has not yet said keeps the merge waiting",
    );
  }
  assert.throws(
    () =>
      changeProposalMergeNext(request, waiting(1, 1.5), pinned, mergeBounds),
    RangeError,
    "an age that is not a count of seconds",
  );
  assert.throws(
    () => changeProposalMergeNext(request, waiting(0, 0), pinned, mergeBounds),
    RangeError,
    "a wait no merge was refused into",
  );
});

test("a waiting merge the forge's rules have cleared is merged again while the merges are unspent", () => {
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, 0, mergeableReading),
      pinned,
      mergeBounds,
    ),
    { next: "Merge" },
    "a reading that found it mergeable is acted on whatever its age",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(2, 0, mergeableReading),
      pinned,
      mergeBounds,
    ),
    { next: "Held", reason: "MergesExhausted" },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, 0, {
        reconciled: "Unmerged",
        evidence: evidence({ mergeability: "Conflicting" }),
      }),
      pinned,
      mergeBounds,
    ),
    {
      next: "Concluded",
      merge: { merged: "NotMergeable", reason: "Conflict" },
    },
  );
});

test("a waiting merge somebody else made or closed is settled by the reading that found it", () => {
  const merged = {
    reconciled: "Accepted",
    evidence: evidence({ status: "Merged", mergeCommit }),
  } as const;
  const closed = {
    reconciled: "Contradictory",
    contradiction: "Closed",
    evidence: evidence({ status: "Closed" }),
  } as const;
  for (const merging of [waiting(1, 0, merged), moved(0, merged)])
    assert.deepEqual(
      changeProposalMergeNext(request, merging, pinned, mergeBounds),
      { next: "Concluded", merge: { merged: "Merged", mergeCommit } },
      merging.merging,
    );
  for (const merging of [waiting(1, 0, closed), moved(0, closed)])
    assert.deepEqual(
      changeProposalMergeNext(request, merging, pinned, mergeBounds),
      { next: "Held", reason: "Closed" },
      merging.merging,
    );
  for (const merging of [
    waiting(1, proposalMergeRereadSecs, closed),
    moved(proposalMergeRereadSecs, closed),
  ])
    assert.deepEqual(
      changeProposalMergeNext(request, merging, pinned, mergeBounds),
      { next: "ReadByNumber" },
      `a closed proposal ${merging.merging} is read again on the cadence`,
    );
  for (const merging of [
    waiting(1, 0, { reconciled: "Absent" }),
    moved(0, { reconciled: "Absent" }),
  ])
    assert.deepEqual(
      changeProposalMergeNext(request, merging, pinned, mergeBounds),
      { next: "Held", reason: "ProposalAbsent" },
      merging.merging,
    );
});

test("a moved head waits on whoever moved it and is never merged again", () => {
  assert.deepEqual(
    changeProposalMergeNext(request, moved(0), pinned, mergeBounds),
    {
      next: "Held",
      reason: "HeadMoved",
    },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      moved(proposalMergeRereadSecs),
      pinned,
      mergeBounds,
    ),
    { next: "ReadByNumber" },
  );
  for (const reading of [
    mergeableReading,
    {
      reconciled: "Unmerged",
      evidence: evidence({ mergeability: "Conflicting" }),
    } as const,
  ]) {
    assert.deepEqual(
      changeProposalMergeNext(request, moved(0, reading), pinned, mergeBounds),
      { next: "Held", reason: "HeadMoved" },
      String(reading.evidence.mergeability),
    );
    assert.deepEqual(
      changeProposalMergeNext(
        request,
        moved(proposalMergeRereadSecs, reading),
        pinned,
        mergeBounds,
      ),
      { next: "ReadByNumber" },
      String(reading.evidence.mergeability),
    );
  }
});

test("every arm a merge settles a row with is one a merge answers with at all", () => {
  const answered = new Set<string>(allChangeProposalMerges);
  for (const merged of populated(
    allChangeProposalMergeAnswers,
    "the merge answers",
  )) {
    assert.ok(answered.has(merged), `${merged} is no arm a merge answers with`);
  }
});

test("a stored merge reading is rebound to the current request", () => {
  const stale = evidence({
    repository: asRepositoryId("stale-repository"),
    status: "Merged",
    mergeCommit,
  });
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, { reconciled: "Accepted", evidence: stale }),
      pinned,
      mergeBounds,
    ),
    { next: "Refused", contradiction: "RepositoryMismatch", evidence: stale },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, { reconciled: "Unstorable" }),
      pinned,
      mergeBounds,
    ),
    { next: "Held", reason: "EvidenceUnstorable" },
  );
});

test("a merging bound that is not a count is refused rather than treated as none", () => {
  for (const bound of [0, -1, 1.5]) {
    for (const offered of [
      { mergesMax: bound, readingsMax: 2, updatesMax: 2 },
      { mergesMax: 2, readingsMax: bound, updatesMax: 2 },
      { mergesMax: 2, readingsMax: 2, updatesMax: bound },
    ]) {
      assert.throws(
        () =>
          changeProposalMergeNext(
            request,
            { merging: "Unasked" },
            pinned,
            offered,
          ),
        RangeError,
        JSON.stringify(offered),
      );
    }
  }
});

/** A reading that found the proposal open and its base moved past it. */
const behindReading = {
  reconciled: "Unmerged",
  evidence: evidence({
    mergeability: "Behind",
    mergeState: asProposalMergeState("behind"),
  }),
} as const;

/** The head the forge's update of the pinned head made. */
const updatedHead = asGitObjectId("e".repeat(40));

/** A reading that found the proposal open at the updated head, the forge saying what a case needs. */
function updatedReading(
  overrides: Partial<ChangeProposalEvidence> = {},
): ChangeProposalMergeReconciliationStored {
  return {
    reconciled: "Unmerged",
    evidence: evidence({
      head: { ref: request.head.ref, commit: updatedHead },
      ...overrides,
    }),
  };
}

/** The pinned head with updating standing as a case needs it. */
function updating(
  overrides: Partial<ChangeProposalMergeGathered["updating"]>,
): ChangeProposalMergeGathered {
  return {
    ...pinned,
    updating: { ...changeProposalUpdatingNone, ...overrides },
  };
}

/** The pinned head, with what git proved of the updated one. */
function adopting(
  adoption: "Adoptable" | "Unadoptable" | "Unread",
): ChangeProposalMergeGathered {
  return { ...pinned, adoption: { head: updatedHead, adoption } };
}

test("a reading finding the proposal behind its base brings it up to date", () => {
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, behindReading),
      pinned,
      mergeBounds,
    ),
    { next: "Wait", reason: "Blocked" },
    "a merge the forge refused for being behind waits to be updated",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, 0, behindReading),
      pinned,
      mergeBounds,
    ),
    { next: "Update" },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, proposalMergeRereadSecs, behindReading),
      pinned,
      mergeBounds,
    ),
    { next: "ReadByNumber" },
    "a reading old enough to be taken again is taken before an update is spent on it",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, 0, behindReading),
      updating({ updates: 1, unread: true }),
      mergeBounds,
    ),
    { next: "Held", reason: "Blocked" },
    "an update no reading has seen is waited out",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, proposalMergeRereadSecs, behindReading),
      updating({ updates: 1, unread: true }),
      mergeBounds,
    ),
    { next: "ReadByNumber" },
    "and is seen by the next reading on the cadence",
  );
  for (const merging of [
    waiting(1, 0, blockedReading),
    waiting(1, 0, { reconciled: "Unmerged", evidence: evidence() }),
    moved(0, behindReading),
    unheard(1, 1, behindReading),
  ])
    assert.notEqual(
      changeProposalMergeNext(request, merging, pinned, mergeBounds).next,
      "Update",
      JSON.stringify(merging).slice(0, 80),
    );
});

test("updates are spent from a ceiling of their own, and its end holds as merges spent", () => {
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, 0, behindReading),
      updating({ updates: 1 }),
      mergeBounds,
    ),
    { next: "Update" },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, 0, behindReading),
      updating({ updates: 2 }),
      mergeBounds,
    ),
    { next: "Held", reason: "UpdatesExhausted" },
  );
  assert.throws(
    () =>
      changeProposalMergeNext(
        request,
        waiting(1, 0, behindReading),
        updating({ updates: 0, unread: true }),
        mergeBounds,
      ),
    RangeError,
    "an update unread that was never asked",
  );
});

test("a proposal behind waits while another on its base holds the turn", () => {
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, 0, behindReading),
      updating({ turn: false }),
      mergeBounds,
    ),
    { next: "Held", reason: "Blocked" },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, proposalMergeRereadSecs, behindReading),
      updating({ turn: false }),
      mergeBounds,
    ),
    { next: "ReadByNumber" },
    "it reads again on the cadence, and updates on the reading that finds its turn",
  );
});

test("a head git proved the pinned one brought up to date is adopted and then merged", () => {
  for (const merging of [
    waiting(1, 0, updatedReading({ mergeability: "Mergeable" })),
    waiting(1, 0, updatedReading({ mergeability: "Blocked" })),
    moved(0, updatedReading({ mergeability: "Mergeable" })),
  ])
    assert.deepEqual(
      changeProposalMergeNext(
        request,
        merging,
        adopting("Adoptable"),
        mergeBounds,
      ),
      { next: "Adopt", head: updatedHead },
      merging.merging,
    );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, 0, updatedReading({ mergeability: "Mergeable" })),
      { head: updatedHead, updating: changeProposalUpdatingNone },
      mergeBounds,
    ),
    { next: "Merge" },
    "once adopted, the head is the one merged at",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, 0, {
        reconciled: "Unmerged",
        evidence: evidence({
          head: { ref: request.head.ref, commit: updatedHead },
          mergeability: "Behind",
        }),
      }),
      { head: updatedHead, updating: changeProposalUpdatingNone },
      mergeBounds,
    ),
    { next: "Update" },
    "an adopted head the base moved past again is updated again",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, updatedReading({ mergeability: "Mergeable" })),
      pinned,
      mergeBounds,
    ),
    { next: "Wait", reason: "Blocked" },
    "a merge in flight found at another head is released to the wait that adopts it",
  );
});

test("no merge is spent on a head that is neither the pinned one nor adoptable", () => {
  for (const adoption of ["Unadoptable", "Unread"] as const) {
    for (const [merging, due] of [
      [
        waiting(1, 0, updatedReading({ mergeability: "Mergeable" })),
        waiting(
          1,
          proposalMergeRereadSecs,
          updatedReading({ mergeability: "Mergeable" }),
        ),
      ],
      [
        moved(0, updatedReading({ mergeability: "Mergeable" })),
        moved(
          proposalMergeRereadSecs,
          updatedReading({ mergeability: "Mergeable" }),
        ),
      ],
    ] as const) {
      assert.deepEqual(
        changeProposalMergeNext(
          request,
          merging,
          adopting(adoption),
          mergeBounds,
        ),
        { next: "Held", reason: "HeadMoved" },
        `${adoption} ${merging.merging}`,
      );
      assert.deepEqual(
        changeProposalMergeNext(request, due, adopting(adoption), mergeBounds),
        { next: "ReadByNumber" },
        `${adoption} ${merging.merging} is read again on the cadence`,
      );
    }
  }
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      waiting(1, 0, updatedReading({ mergeability: "Mergeable" })),
      pinned,
      mergeBounds,
    ),
    { next: "Held", reason: "HeadMoved" },
    "a head git was never asked about is not merged either",
  );
  assert.throws(
    () =>
      changeProposalMergeNext(
        request,
        waiting(1, 0, {
          reconciled: "Unmerged",
          evidence: evidence({
            head: {
              ref: request.head.ref,
              commit: asGitObjectId("f".repeat(40)),
            },
          }),
        }),
        adopting("Adoptable"),
        mergeBounds,
      ),
    RangeError,
    "adoption proved of a head no reading found",
  );
});

/** The proposal an earlier request of the ticket recorded, as its row addresses it. */
const recordedProposal = {
  forge,
  remote: asProposalRemoteIdentity("proposal-17"),
  number: asProposalNumber(17),
};

test("a proposal an earlier request of the ticket recorded is adopted where it is open on this request's head and base", () => {
  const earlier = evidence({
    marker: asProposalMarker("chuggy-handoff:" + "e".repeat(64)),
    title: "A person retitled it",
    body: "And rewrote what it says.",
    head: { ref: request.head.ref, commit: asGitObjectId("f".repeat(40)) },
  });
  assert.deepEqual(
    changeProposalAdoptionNext(request, {
      proposal: recordedProposal,
      read: { read: "Found", evidence: earlier },
    }),
    { next: "Adopt", evidence: earlier },
    "its marker, its words and its head commit are not what make it this ticket's",
  );
  assert.deepEqual(
    changeProposalAdoptionNext(request, {
      proposal: recordedProposal,
      read: { read: "Absent" },
    }),
    { next: "Create" },
  );
  for (const read of ["Unavailable", "Denied"] as const)
    assert.deepEqual(
      changeProposalAdoptionNext(request, {
        proposal: recordedProposal,
        read: { read },
      }),
      { next: "Held", reason: read },
    );
});

test("a proposal of the ticket's that is closed, merged or elsewhere is not adopted, and this request opens its own", () => {
  for (const [found, why] of [
    [evidence({ status: "Closed" }), "a closed proposal"],
    [evidence({ status: "Merged" }), "a merged proposal"],
    [
      evidence({
        base: { ...request.base, ref: asGitRefName("refs/heads/x") },
      }),
      "a proposal into another base",
    ],
    [
      evidence({
        head: { ...request.head, ref: asGitRefName("refs/heads/y") },
      }),
      "a proposal from another head",
    ],
    [
      evidence({
        identity: { ...recordedProposal, number: asProposalNumber(18) },
      }),
      "a proposal the recorded number does not address",
    ],
    [
      evidence({
        identity: {
          ...recordedProposal,
          forge: asForgeBindingId("forge-beta"),
        },
      }),
      "a proposal on another forge",
    ],
  ] as const) {
    assert.deepEqual(
      changeProposalAdoptionNext(request, {
        proposal: recordedProposal,
        read: { read: "Found", evidence: found },
      }),
      { next: "Create" },
      why,
    );
  }
});

test("an adopted proposal is judged by where it stands and never by the words it was opened with", () => {
  const adopted = evidence({
    marker: asProposalMarker("chuggy-handoff:" + "e".repeat(64)),
    title: "A person retitled it",
  });
  const answered = (
    found: ChangeProposalEvidence,
  ): ChangeProposalPublication => ({
    publication: "Answered",
    creation: { created: "Adopted", evidence: found },
  });
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      answered(adopted),
      bounds,
      "Accepted",
    ),
    { next: "Accepted", evidence: adopted },
  );
  const moved = evidence({
    base: { ...request.base, ref: asGitRefName("refs/heads/x") },
  });
  assert.deepEqual(
    changeProposalPublicationNext(request, answered(moved), bounds, "Accepted"),
    { next: "Refused", contradiction: "BaseMismatch", evidence: moved },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      {
        publication: "Answered",
        creation: { created: "AlreadyExists", evidence: adopted },
      },
      bounds,
      "Accepted",
    ),
    { next: "Refused", contradiction: "MarkerMismatch", evidence: adopted },
    "a create's answer is still held to this request's marker",
  );
});
