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
  reconcileChangeProposal,
  type ChangeProposalAdapterSelector,
  type ChangeProposalEvidence,
  type ChangeProposalPort,
} from "../../src/interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
const requestIdentity = asChangeProposalRequestIdentity("a".repeat(64));
const forge = asForgeBindingId("forge-alpha");
const request = changeProposalRequest({
  binding: {
    forge,
    credential: asForgeCredentialReference("forge-alpha-proposals"),
  },
  repository: asRepositoryId("platform-desires"),
  request: requestIdentity,
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

test("redelivery after an ambiguous create only reconciles within its bound", () => {
  const creation = { created: "Ambiguous" } as const;
  assert.deepEqual(
    changeProposalPublicationNext(request, { creation, reconciliations: 0 }, 2),
    { next: "Reconcile" },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      {
        creation,
        reconciliation: { reconciled: "Absent" },
        reconciliations: 1,
      },
      2,
    ),
    { next: "Reconcile" },
  );
  assert.deepEqual(
    changeProposalPublicationNext(
      request,
      {
        creation,
        reconciliation: { reconciled: "Absent" },
        reconciliations: 2,
      },
      2,
    ),
    { next: "Held", reason: "ReconciliationExhausted" },
  );
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
    [{ repository: asRepositoryId("other-repository") }, "RepositoryMismatch"],
    [
      {
        head: {
          ref: request.head.ref,
          commit: asGitObjectId("d".repeat(40)),
        },
      },
      "HeadMismatch",
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

test("proposal metadata and deterministic branch identity are bounded", () => {
  assert.throws(
    () =>
      changeProposalRequest({
        ...request,
        headCommit: request.head.commit,
        baseRef: request.base.ref,
        baseCommit: request.base.commit,
        title: "",
        body: request.body,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      changeProposalRequest({
        ...request,
        headCommit: request.head.commit,
        baseRef: request.base.ref,
        baseCommit: request.base.commit,
        title: request.title,
        body: "x".repeat(16_385),
      }),
    RangeError,
  );
  assert.equal(
    request.head.ref,
    `refs/heads/chuggy/handoff/${requestIdentity}`,
  );
});
