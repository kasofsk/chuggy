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
  asProposalNumber,
  asProposalRemoteIdentity,
  changeProposalMergeNext,
  changeProposalMergeRequest,
  changeProposalPublicationNext,
  changeProposalRequest,
  proposalBodyCharsMax,
  proposalEvidenceCharsMax,
  proposalMarkerCharsMax,
  proposalDisplayUrlCharsMax,
  proposalTitleCharsMax,
  reconcileChangeProposal,
  reconcileChangeProposalMerge,
  type ChangeProposalAdapterSelector,
  type ChangeProposalEvidence,
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
  assert.deepEqual(calls, [
    "change-request:create",
    "merge-proposal:read",
    "merge-proposal:read-by-number",
    "merge-proposal:merge",
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
const mergeBounds = { mergesMax: 2, readingsMax: 2 };

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
    changeProposalMergeNext(request, unheard(1, 0), mergeBounds),
    {
      next: "ReadByNumber",
    },
  );
  const open = { reconciled: "Unmerged", evidence: evidence() } as const;
  assert.deepEqual(
    changeProposalMergeNext(request, unheard(1, 1, open), mergeBounds),
    { next: "ReadByNumber" },
  );
  assert.deepEqual(
    changeProposalMergeNext(request, unheard(1, 2, open), mergeBounds),
    { next: "RefuseAttempt" },
    "readings that all found it open prove the merge was never made",
  );
  assert.deepEqual(
    changeProposalMergeNext(request, unheard(2, 3, open), mergeBounds),
    { next: "ReadByNumber" },
    "the second attempt is read back under a budget of its own",
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, { reconciled: "Absent" }),
      mergeBounds,
    ),
    { next: "Held", reason: "ProposalAbsent" },
    "a number that addresses another proposal is merged nothing again",
  );
});

test("only a merging with nothing in flight merges, and only while the merges are unspent", () => {
  assert.deepEqual(
    changeProposalMergeNext(request, { merging: "Unasked" }, mergeBounds),
    {
      next: "Merge",
    },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      { merging: "Idle", merges: 1 },
      mergeBounds,
    ),
    { next: "Merge" },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      { merging: "Idle", merges: 2 },
      mergeBounds,
    ),
    { next: "Held", reason: "MergesExhausted" },
  );
  for (const merging of [
    unheard(1, 0),
    unheard(1, 1, { reconciled: "Absent" }),
    unheard(1, 2, { reconciled: "Unmerged", evidence: evidence() }),
    { merging: "Idle" as const, merges: 2 },
    { merging: "Answered" as const, merge: { merged: "HeadMoved" as const } },
  ]) {
    assert.notEqual(
      changeProposalMergeNext(request, merging, mergeBounds).next,
      "Merge",
      JSON.stringify(merging).slice(0, 60),
    );
  }
  assert.throws(
    () => changeProposalMergeNext(request, unheard(0, 0), mergeBounds),
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
    changeProposalMergeNext(request, unheard(1, 1, conflicting), mergeBounds),
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
    changeProposalMergeNext(request, unheard(1, 1, blocked), mergeBounds),
    { next: "Held", reason: "Blocked" },
    "the forge's own protections hold the merge for an operator",
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
        mergeBounds,
      ),
      { next: "ReadByNumber" },
      JSON.stringify(said.mergeability),
    );
  }
});

test("a merge the forge answered is concluded from the row, a blocked one held", () => {
  for (const merge of [
    { merged: "Merged", mergeCommit },
    { merged: "HeadMoved" },
    { merged: "NotMergeable", reason: "Conflict" },
  ] as const) {
    assert.deepEqual(
      changeProposalMergeNext(
        request,
        { merging: "Answered", merge },
        mergeBounds,
      ),
      { next: "Concluded", merge },
    );
  }
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      {
        merging: "Answered",
        merge: { merged: "NotMergeable", reason: "Blocked" },
      },
      mergeBounds,
    ),
    { next: "Held", reason: "Blocked" },
  );
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
      mergeBounds,
    ),
    { next: "Refused", contradiction: "RepositoryMismatch", evidence: stale },
  );
  assert.deepEqual(
    changeProposalMergeNext(
      request,
      unheard(1, 1, { reconciled: "Unstorable" }),
      mergeBounds,
    ),
    { next: "Held", reason: "EvidenceUnstorable" },
  );
});

test("a merging bound that is not a count is refused rather than treated as none", () => {
  for (const bound of [0, -1, 1.5]) {
    for (const offered of [
      { mergesMax: bound, readingsMax: 2 },
      { mergesMax: 2, readingsMax: bound },
    ]) {
      assert.throws(
        () => changeProposalMergeNext(request, { merging: "Unasked" }, offered),
        RangeError,
        JSON.stringify(offered),
      );
    }
  }
});
