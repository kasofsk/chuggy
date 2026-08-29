import assert from "node:assert/strict";
import test from "node:test";

import {
  asForgeBindingId,
  asForgeCredentialReference,
  asChangeProposalRequestIdentity,
  asProposalDisplayUrl,
  asProposalRemoteIdentity,
  changeProposalPublicationNext,
  changeProposalRequest,
  proposalBodyCharsMax,
  proposalEvidenceCharsMax,
  proposalMarkerCharsMax,
  proposalDisplayUrlCharsMax,
  proposalTitleCharsMax,
  reconcileChangeProposal,
  type ChangeProposalAdapterSelector,
  type ChangeProposalEvidence,
  type ChangeProposalPort,
  type ChangeProposalPublication,
  type ChangeProposalReconciliationStored,
} from "../../src/interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  allGitObjectIdChars,
  finalizerIdentityCharsMax,
  gitRefNameCharsMax,
} from "../../src/interpreter/finalizer.ts";
const requestIdentity = asChangeProposalRequestIdentity("a".repeat(64));
const forge = asForgeBindingId("forge-alpha");
const requestHeadRef = asGitRefName("refs/heads/chuggy/footer-2026");
const request = changeProposalRequest({
  binding: {
    forge,
    credential: asForgeCredentialReference("forge-alpha-proposals"),
  },
  repository: asRepositoryId("platform-desires"),
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
    reconcileChangeProposal(request, {
      read: "Found",
      evidence: evidence(),
    }),
    { reconciled: "Accepted", evidence: evidence() },
  );
  assert.deepEqual(reconcileChangeProposal(request, { read: "Absent" }), {
    reconciled: "Absent",
  });
  assert.deepEqual(reconcileChangeProposal(request, { read: "Unavailable" }), {
    reconciled: "Unavailable",
  });
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
    changeProposalPublicationNext(request, unanswered(1, 0), bounds),
    {
      next: "Reconcile",
    },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      unanswered(1, 1, { reconciled: "Absent" }),
      bounds,
    ),
    { next: "Reconcile" },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      unanswered(1, 2, { reconciled: "Absent" }),
      bounds,
    ),
    { next: "RefuseAttempt" },
    "readings that all found nothing prove the create was never taken",
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      unanswered(2, 3, { reconciled: "Absent" }),
      bounds,
    ),
    { next: "Reconcile" },
    "the second attempt is read back under a budget of its own",
  );
});

test("only a state with nothing in flight creates, and only while the creations are unspent", () => {
  assert.deepEqual(
    changeProposalPublicationNext(request, { publication: "Unopened" }, bounds),
    { next: "Create" },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      { publication: "Idle", creations: 1 },
      bounds,
    ),
    { next: "Create" },
    "a create that spent one of them leaves another one to make",
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      { publication: "Idle", creations: 2 },
      bounds,
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
    ),
    { next: "Held", reason: "EvidenceUnstorable" },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      unanswered(1, 1, { reconciled: "Unstorable" }),
      bounds,
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
      changeProposalPublicationNext(request, publication, bounds).next,
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
        },
      },
      "ForgeMismatch",
    ],
  ];
  for (const [overrides, contradiction] of cases) {
    const found = evidence(overrides);
    assert.deepEqual(
      reconcileChangeProposal(request, { read: "Found", evidence: found }),
      { reconciled: "Contradictory", contradiction, evidence: found },
    );
  }
});

test("a base branch that moved between the observation and the create is the same proposal", () => {
  const moved = evidence({
    base: {
      ref: request.base.ref,
      commit: asGitObjectId("e".repeat(40)),
    },
  });
  assert.deepEqual(
    reconcileChangeProposal(request, { read: "Found", evidence: moved }),
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
    ),
    { next: "Accepted", evidence: moved },
  );
});

test("a head branch pushed to between the create and the reading is the same proposal", () => {
  const pushed = evidence({
    head: { ref: request.head.ref, commit: asGitObjectId("d".repeat(40)) },
  });
  assert.deepEqual(
    reconcileChangeProposal(request, { read: "Found", evidence: pushed }),
    { reconciled: "Accepted", evidence: pushed },
  );
  assert.deepEqual(
    changeProposalPublicationNext(request, unanswered(1, 0), bounds),
    { next: "Reconcile" },
    "the reading that finds it is the one this recovers through",
  );
});

test("created and existing evidence from another forge is never accepted", () => {
  const wrongForge = evidence({
    identity: {
      forge: asForgeBindingId("forge-beta"),
      remote: asProposalRemoteIdentity("proposal-17"),
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
      changeProposalPublicationNext(request, unanswered(1, 1, reading), bounds),
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
  assert.deepEqual(calls, ["change-request:create", "merge-proposal:read"]);
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
