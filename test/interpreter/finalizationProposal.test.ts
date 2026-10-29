/**
 * The pure step a promoted candidate's change proposal takes, and the words the
 * proposal carries.
 *
 * THE NEGATIVE SPACE IS THE POINT HERE. A stored create that may have happened
 * must never authorize a second one, a hold must never become a conclusion, and
 * every reason a publication is held must reach a hold this tree declares — so
 * each is driven over the rosters rather than over one example.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { briefIntentCharsMax } from "../../src/contract/brief.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { textCodePointsCount } from "../../src/contract/http.ts";
import {
  allClosingLifecycles,
  allFinalizationHoldKinds,
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asForgeCredentialReference,
  asProposalNumber,
  asProposalRemoteIdentity,
  changeProposalMergeRequest,
  changeProposalRequest,
  changeProposalUpdatingNone,
  proposalBodyCharsMax,
  proposalMarkerOf,
  proposalMergeRereadSecs,
  proposalTitleCharsMax,
  type ChangeProposalEvidence,
  type ChangeProposalMergeGathered,
  type ChangeProposalMergeReconciliationStored,
  type ChangeProposalMerging,
  type ChangeProposalPublication,
  type ChangeProposalRead,
  type ChangeProposalReconciliationStored,
} from "../../src/interpreter/changeProposal.ts";
import {
  finalizationProposalBody,
  finalizationProposalCreationRecording,
  finalizationProposalMergeReadingRecording,
  finalizationProposalMergeRecording,
  finalizationProposalNext,
  finalizationProposalReadingRecording,
  finalizationProposalTitle,
  finalizationProposalUpdateRecording,
  type FinalizationProposalDecision,
  type FinalizationProposalGathered,
  type FinalizationProposalStanding,
} from "../../src/interpreter/finalizationProposal.ts";
import {
  asBriefIntent,
  asBriefTitle,
} from "../../src/interpreter/ticketBrief.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { populated } from "./roster.ts";

const identity = asChangeProposalRequestIdentity("a".repeat(64));
const marker = proposalMarkerOf(identity);
const intent = asBriefIntent("Serve the escalation reason.\nRead the ticket.");

const request = changeProposalRequest({
  binding: {
    forge: asForgeBindingId("forge-alpha"),
    credential: asForgeCredentialReference("forge-alpha-proposals"),
  },
  repository: asRepositoryId("https://forge.invalid/acme/atlas.git"),
  partition: {
    tenant: asTenantId("tenant"),
    project: asProjectId("project"),
  },
  request: identity,
  headRef: asGitRefName("refs/heads/chuggy/footer-2026"),
  headCommit: asGitObjectId("b".repeat(40)),
  baseRef: asGitRefName("refs/heads/main"),
  baseCommit: asGitObjectId("c".repeat(40)),
  title: finalizationProposalTitle(asTicketId(7), { intent }),
  body: finalizationProposalBody(intent, marker),
});

/** The evidence a forge holding this request's proposal answers with. */
function evidence(
  overrides: Partial<ChangeProposalEvidence> = {},
): ChangeProposalEvidence {
  return {
    identity: {
      forge: request.binding.forge,
      remote: asProposalRemoteIdentity("proposal-7"),
      number: asProposalNumber(7),
    },
    repository: request.repository,
    marker: request.marker,
    head: request.head,
    base: request.base,
    title: request.title,
    body: request.body,
    status: "Open",
    ...overrides,
  };
}

/** The ceilings every case below continues a proposal under. */
const bounds = {
  publication: { creationsMax: 2, reconciliationsMax: 2 },
  merging: { mergesMax: 2, readingsMax: 2, updatesMax: 2 },
};

/** The finalization every case below stands in unless it names another: one that only proposes. */
const proposing: FinalizationProposalStanding = {
  mode: "PullRequest",
  lifecycle: "Active",
};

/** The same finalization under the landing that merges what it proposed. */
const merging: FinalizationProposalStanding = {
  mode: "PullRequestMerge",
  lifecycle: "Active",
};

/** One gathered proposal over the publication a case names, and whatever its merge has come to. */
function gathered(
  publication: ChangeProposalPublication,
  merged: ChangeProposalMerging = { merging: "Unasked" },
  merge: ChangeProposalMergeGathered = pinned,
): FinalizationProposalGathered {
  return { gathered: "Request", request, publication, merging: merged, merge };
}

/** The head this request proposed, pinned, with nothing updated yet. */
const pinned: ChangeProposalMergeGathered = {
  head: request.head.commit,
  updating: changeProposalUpdatingNone,
};

/** One create in flight, with however many readings a case has already taken. */
function unanswered(
  creations: number,
  reconciliations: number,
  reading?: ChangeProposalReconciliationStored,
): ChangeProposalPublication {
  return { publication: "Unanswered", creations, reconciliations, reading };
}

test("a proposal nobody has attempted is created, and one in flight is read back", () => {
  assert.deepEqual(
    finalizationProposalNext(
      proposing,
      gathered({ publication: "Unopened" }),
      bounds,
    ),
    { decide: "ProposeChange", request },
  );
  assert.deepEqual(
    finalizationProposalNext(proposing, gathered(unanswered(1, 0)), bounds),
    { decide: "ReconcileProposal", request },
  );
  assert.deepEqual(
    finalizationProposalNext(
      proposing,
      gathered({ publication: "Idle", creations: 1 }),
      bounds,
    ),
    { decide: "ProposeChange", request },
    "a create that spent one of them leaves another one to make",
  );
});

test("a proposal the forge proves it holds is the one thing that concludes", () => {
  for (const created of ["Created", "AlreadyExists"] as const) {
    assert.deepEqual(
      finalizationProposalNext(
        proposing,
        gathered({
          publication: "Answered",
          creation: { created, evidence: evidence() },
        }),
        bounds,
      ),
      { decide: "Conclude" },
      created,
    );
  }
  assert.deepEqual(
    finalizationProposalNext(
      proposing,
      gathered(
        unanswered(1, 1, { reconciled: "Accepted", evidence: evidence() }),
      ),
      bounds,
    ),
    { decide: "Conclude" },
  );
});

test("every reason a publication is held reaches a hold this tree declares", () => {
  const holds = new Set<string>(allFinalizationHoldKinds);
  const held: readonly [ChangeProposalPublication, string][] = [
    [{ publication: "Idle", creations: 2 }, "ProposalCreationsExhausted"],
    [
      { publication: "Answered", creation: { created: "Unstorable" } },
      "ProposalEvidenceUnstorable",
    ],
    [
      unanswered(1, 1, { reconciled: "Unstorable" }),
      "ProposalEvidenceUnstorable",
    ],
    [
      {
        publication: "Answered",
        creation: {
          created: "Created",
          evidence: evidence({ status: "Closed" }),
        },
      },
      "ProposalRefused",
    ],
  ];
  for (const [publication, hold] of held) {
    assert.deepEqual(
      finalizationProposalNext(proposing, gathered(publication), bounds),
      { decide: "Hold", hold },
      hold,
    );
    assert.ok(holds.has(hold), `${hold} is not a declared hold`);
  }
});

test("a deployment binding no forge and an unreadable base are holds and not conclusions", () => {
  assert.deepEqual(
    finalizationProposalNext(proposing, { gathered: "Unbound" }, bounds),
    {
      decide: "Hold",
      hold: "ProposalDenied",
    },
  );
  assert.deepEqual(
    finalizationProposalNext(proposing, { gathered: "BaseUnreadable" }, bounds),
    {
      decide: "Hold",
      hold: "ProposalBaseUnreadable",
    },
    "the base a proposal opens into is named apart from the ref it landed on",
  );
});

test("a base that is the head it would be opened from is a hold this tree declares", () => {
  const decision = finalizationProposalNext(
    proposing,
    { gathered: "BaseIsHead" },
    bounds,
  );
  assert.deepEqual(decision, {
    decide: "Hold",
    hold: "ProposalBaseIsHead",
  });
  assert.ok(
    new Set<string>(allFinalizationHoldKinds).has("ProposalBaseIsHead"),
    "ProposalBaseIsHead is not on the roster a suite iterates",
  );
});

test("no publication carrying a create in flight reaches a create", () => {
  const publications: readonly ChangeProposalPublication[] = [
    unanswered(1, 0),
    unanswered(1, 9),
    unanswered(1, 1, { reconciled: "Absent" }),
    unanswered(2, 4, { reconciled: "Absent" }),
    { publication: "Idle", creations: 2 },
    { publication: "Answered", creation: { created: "Unstorable" } },
    {
      publication: "Answered",
      creation: {
        created: "Contradictory",
        contradiction: "Closed",
        evidence: evidence({ status: "Closed" }),
      },
    },
  ];
  for (const publication of populated(publications, "the publications")) {
    assert.notEqual(
      finalizationProposalNext(proposing, gathered(publication), bounds).decide,
      "ProposeChange",
      JSON.stringify(publication).slice(0, 60),
    );
  }
});

test("a bound that is not a positive count is refused rather than treated as none", () => {
  for (const bound of [0, -1, 1.5]) {
    assert.throws(
      () =>
        finalizationProposalNext(
          proposing,
          gathered({ publication: "Unopened" }),
          {
            publication: { creationsMax: bound, reconciliationsMax: bound },
            merging: bounds.merging,
          },
        ),
      RangeError,
      String(bound),
    );
    assert.throws(
      () =>
        finalizationProposalNext(merging, proved(), {
          publication: bounds.publication,
          merging: { mergesMax: bound, readingsMax: bound, updatesMax: bound },
        }),
      RangeError,
      String(bound),
    );
  }
});

test("an answer about this deployment is never recorded as one about the proposal", () => {
  assert.deepEqual(
    finalizationProposalCreationRecording({ created: "Unavailable" }),
    { record: "Decline", hold: "ProposalUnavailable" },
    "a create the forge would not take releases the attempt it stood on",
  );
  assert.deepEqual(
    finalizationProposalCreationRecording({ created: "Denied" }),
    { record: "Decline", hold: "ProposalDenied" },
  );
  assert.deepEqual(
    finalizationProposalCreationRecording({ created: "Ambiguous" }),
    { record: "Unanswered" },
  );
  assert.deepEqual(
    finalizationProposalCreationRecording({
      created: "Created",
      evidence: evidence(),
    }),
    {
      record: "Creation",
      created: { created: "Created", evidence: evidence() },
    },
  );
  assert.deepEqual(
    finalizationProposalReadingRecording({ reconciled: "Unavailable" }),
    { record: "Nothing", hold: "ProposalUnavailable" },
  );
  assert.deepEqual(
    finalizationProposalReadingRecording({ reconciled: "Denied" }),
    { record: "Nothing", hold: "ProposalDenied" },
  );
  assert.deepEqual(
    finalizationProposalReadingRecording({ reconciled: "Absent" }),
    {
      record: "Reconciliation",
      reconciled: { reconciled: "Absent" },
    },
  );
});

/** The commit a merge that landed left behind. */
const mergeCommit = asGitObjectId("d".repeat(40));

/** One proposal the create proved, standing at whatever its merge has come to. */
function proved(
  merged: ChangeProposalMerging = { merging: "Unasked" },
  overrides: Partial<ChangeProposalEvidence> = {},
  merge: ChangeProposalMergeGathered = pinned,
): FinalizationProposalGathered {
  return gathered(
    {
      publication: "Answered",
      creation: { created: "Created", evidence: evidence(overrides) },
    },
    merged,
    merge,
  );
}

/** The merge the step names for that proved proposal, addressed by the number its evidence carries. */
const mergeRequest = changeProposalMergeRequest({
  binding: request.binding,
  partition: request.partition,
  repository: request.repository,
  proposal: evidence().identity,
  marker: request.marker,
  headCommit: request.head.commit,
});

/** One merge in flight, with however many readings a case has already taken. */
function unheard(
  merges: number,
  readings: number,
  reading?: ChangeProposalMergeReconciliationStored,
): ChangeProposalMerging {
  return { merging: "Unanswered", merges, readings, reading };
}

/** One merge the forge's own rules refused, waiting on a reading of the proposal heard so many seconds ago. */
function waitingOn(
  heardAgeSecs: number,
  read: Partial<ChangeProposalEvidence>,
  contradiction?: "Closed",
): Extract<ChangeProposalMerging, { readonly merging: "Waiting" }> {
  const said = evidence(read);
  return {
    merging: "Waiting",
    merges: 1,
    reading:
      contradiction !== undefined
        ? { reconciled: "Contradictory", contradiction, evidence: said }
        : said.status === "Merged"
          ? { reconciled: "Accepted", evidence: said }
          : { reconciled: "Unmerged", evidence: said },
    heardAgeSecs,
  };
}

test("a proved proposal is merged only under the landing that merges it", () => {
  assert.deepEqual(finalizationProposalNext(proposing, proved(), bounds), {
    decide: "Conclude",
  });
  assert.deepEqual(finalizationProposalNext(merging, proved(), bounds), {
    decide: "MergeProposal",
    request,
    merge: mergeRequest,
  });
  assert.deepEqual(
    finalizationProposalNext(merging, proved(unheard(1, 0)), bounds),
    { decide: "ReconcileMerge", request, merge: mergeRequest },
  );
  assert.deepEqual(
    finalizationProposalNext(merging, proved(unheard(1, 2)), bounds),
    { decide: "RefuseMergeAttempt" },
    "readings that found nothing release the attempt rather than holding it",
  );
});

test("a proposal no number addresses holds the merge rather than raising out of the pass", () => {
  const named: Partial<ChangeProposalEvidence> = {
    identity: {
      forge: request.binding.forge,
      remote: asProposalRemoteIdentity("proposal-7"),
    },
  };
  for (const merged of [
    { merging: "Unasked" },
    unheard(1, 0),
  ] satisfies readonly ChangeProposalMerging[])
    assert.deepEqual(
      finalizationProposalNext(merging, proved(merged, named), bounds),
      { decide: "Hold", hold: "ProposalUnaddressed" },
      merged.merging,
    );
});

test("a proposal somebody else already merged is the success only a merging landing asked for", () => {
  const landed = { status: "Merged", mergeCommit } as const;
  assert.deepEqual(
    finalizationProposalNext(
      merging,
      proved({ merging: "Unasked" }, landed),
      bounds,
    ),
    {
      decide: "Conclude",
    },
  );
  assert.deepEqual(
    finalizationProposalNext(
      proposing,
      proved({ merging: "Unasked" }, landed),
      bounds,
    ),
    { decide: "Hold", hold: "ProposalRefused" },
    "a landing that leaves merging to somebody else is contradicted by one that happened",
  );
  assert.deepEqual(
    finalizationProposalNext(
      merging,
      proved({ merging: "Unasked" }, { status: "Merged" }),
      bounds,
    ),
    { decide: "MergeProposal", request, merge: mergeRequest },
    "a merge the forge named no commit for is asked for rather than believed",
  );
});

/** Asserts each merge state proved over the request decides what it is paired with. */
function mergesDecided(
  cases: readonly (readonly [
    Parameters<typeof proved>[0],
    FinalizationProposalDecision,
  ])[],
): void {
  for (const [merged, decision] of cases)
    assert.deepEqual(
      finalizationProposalNext(merging, proved(merged), bounds),
      decision,
      JSON.stringify(merged).slice(0, 70),
    );
}

test("what the merge answered is what the finalization does next", () => {
  mergesDecided([
    [
      { merging: "Answered", merge: { merged: "Merged", mergeCommit } },
      { decide: "Conclude" },
    ],
    [
      { merging: "Moved", reading: undefined, heardAgeSecs: 0 },
      { decide: "Hold", hold: "ProposalHeadMoved" },
    ],
    [
      {
        merging: "Moved",
        reading: undefined,
        heardAgeSecs: proposalMergeRereadSecs,
      },
      { decide: "ReconcileMerge", request, merge: mergeRequest },
    ],
    [
      {
        merging: "Answered",
        merge: { merged: "NotMergeable", reason: "Conflict" },
      },
      { decide: "RecordMergeConflict" },
    ],
    [
      unheard(1, 1, {
        reconciled: "Accepted",
        evidence: evidence({ status: "Merged", mergeCommit }),
      }),
      { decide: "Conclude" },
    ],
    [
      unheard(1, 1, {
        reconciled: "Unmerged",
        evidence: evidence({ mergeability: "Conflicting" }),
      }),
      { decide: "RecordMergeConflict" },
    ],
    [
      unheard(1, 1, {
        reconciled: "Unmerged",
        evidence: evidence({ mergeability: "Blocked" }),
      }),
      { decide: "WaitMergeAttempt", hold: "ProposalMergeBlocked" },
    ],
    [
      unheard(1, 1, {
        reconciled: "Contradictory",
        contradiction: "Closed",
        evidence: evidence({ status: "Closed" }),
      }),
      { decide: "WaitMergeAttempt", hold: "ProposalAbsent" },
    ],
  ]);
});

test("a merge read as closed is read again on the cadence, waiting or moved, since a person may reopen it", () => {
  const closed = {
    reconciled: "Contradictory",
    contradiction: "Closed",
    evidence: evidence({ status: "Closed" }),
  } as const;
  mergesDecided([
    [
      waitingOn(0, { status: "Closed" }, "Closed"),
      { decide: "Hold", hold: "ProposalAbsent" },
    ],
    [
      waitingOn(proposalMergeRereadSecs, { status: "Closed" }, "Closed"),
      { decide: "ReconcileMerge", request, merge: mergeRequest },
    ],
    [
      { merging: "Moved", reading: closed, heardAgeSecs: 0 },
      { decide: "Hold", hold: "ProposalAbsent" },
    ],
    [
      {
        merging: "Moved",
        reading: closed,
        heardAgeSecs: proposalMergeRereadSecs,
      },
      { decide: "ReconcileMerge", request, merge: mergeRequest },
    ],
  ]);
});

test("a merge anybody made concludes the landing at whatever head it was made, and edits to the words refuse nothing", () => {
  const later = {
    ref: request.head.ref,
    commit: asGitObjectId("d".repeat(40)),
  };
  const edited = {
    title: "feat: serve the escalation reason",
    body: request.body.replaceAll("\n", "\r\n"),
  };
  mergesDecided([
    [
      waitingOn(0, { status: "Merged", head: later, mergeCommit }),
      { decide: "Conclude" },
    ],
    [
      {
        merging: "Moved",
        reading: {
          reconciled: "Accepted",
          evidence: evidence({ status: "Merged", head: later, mergeCommit }),
        },
        heardAgeSecs: 0,
      },
      { decide: "Conclude" },
    ],
    [
      waitingOn(0, { ...edited, mergeability: "Blocked" }),
      { decide: "Hold", hold: "ProposalMergeBlocked" },
    ],
    [
      waitingOn(0, { ...edited, status: "Merged", mergeCommit }),
      { decide: "Conclude" },
    ],
  ]);
});

test("a merge waiting on the forge holds until it is due, is read then, and lands on what a reading finds", () => {
  mergesDecided([
    [
      waitingOn(0, { mergeability: "Blocked" }),
      { decide: "Hold", hold: "ProposalMergeBlocked" },
    ],
    [
      waitingOn(proposalMergeRereadSecs, { mergeability: "Blocked" }),
      { decide: "ReconcileMerge", request, merge: mergeRequest },
    ],
    [
      waitingOn(0, { mergeability: "Mergeable" }),
      { decide: "MergeProposal", request, merge: mergeRequest },
    ],
    [
      waitingOn(0, { status: "Closed" }, "Closed"),
      { decide: "Hold", hold: "ProposalAbsent" },
    ],
    [waitingOn(0, { status: "Merged", mergeCommit }), { decide: "Conclude" }],
  ]);
});

test("every reason a merge is held reaches a hold this tree declares", () => {
  const holds = new Set<string>(allFinalizationHoldKinds);
  const held: readonly [Parameters<typeof proved>[0], string][] = [
    [{ merging: "Idle", merges: 2 }, "ProposalMergesExhausted"],
    [unheard(1, 1, { reconciled: "Absent" }), "ProposalAbsent"],
    [unheard(1, 1, { reconciled: "Unstorable" }), "ProposalEvidenceUnstorable"],
    [waitingOn(0, { mergeability: "Blocked" }), "ProposalMergeBlocked"],
    [
      { merging: "Moved", reading: undefined, heardAgeSecs: 0 },
      "ProposalHeadMoved",
    ],
    [waitingOn(0, { status: "Closed" }, "Closed"), "ProposalAbsent"],
  ];
  for (const [merged, hold] of populated(held, "the merge holds")) {
    assert.deepEqual(
      finalizationProposalNext(merging, proved(merged), bounds),
      { decide: "Hold", hold },
      hold,
    );
    assert.ok(holds.has(hold), `${hold} is not a declared hold`);
  }
});

test("a project that will admit no further act aborts rather than merging", () => {
  for (const lifecycle of allClosingLifecycles) {
    assert.deepEqual(
      finalizationProposalNext(
        { mode: "PullRequestMerge", lifecycle },
        proved(),
        bounds,
      ),
      { decide: "Abort" },
      lifecycle,
    );
    assert.deepEqual(
      finalizationProposalNext(
        { mode: "PullRequestMerge", lifecycle },
        proved(unheard(1, 0)),
        bounds,
      ),
      { decide: "ReconcileMerge", request, merge: mergeRequest },
      "a merge already asked is read back whatever the lifecycle says",
    );
    assert.deepEqual(
      finalizationProposalNext(
        { mode: "PullRequestMerge", lifecycle },
        proved({
          merging: "Answered",
          merge: { merged: "Merged", mergeCommit },
        }),
        bounds,
      ),
      { decide: "Conclude" },
      "and a merge that landed is the success it is whatever became of the project",
    );
  }
});

test("an answer about this deployment is never recorded as one about the merge", () => {
  assert.deepEqual(
    finalizationProposalMergeRecording({ merged: "Unavailable" }),
    {
      record: "Decline",
      hold: "ProposalUnavailable",
    },
  );
  assert.deepEqual(finalizationProposalMergeRecording({ merged: "Denied" }), {
    record: "Decline",
    hold: "ProposalDenied",
  });
  assert.deepEqual(
    finalizationProposalMergeRecording({ merged: "Ambiguous" }),
    {
      record: "Unanswered",
    },
  );
  assert.deepEqual(
    finalizationProposalMergeRecording({
      merged: "NotMergeable",
      reason: "Unknown",
    }),
    { record: "Unanswered" },
    "a refusal naming no reason settles nothing and is read back",
  );
  assert.deepEqual(
    finalizationProposalMergeRecording({
      merged: "NotMergeable",
      reason: "Blocked",
    }),
    { record: "Unanswered" },
    "a refusal naming the forge's own rules is read back, since they may lift",
  );
  assert.deepEqual(
    finalizationProposalMergeRecording({ merged: "Merged", mergeCommit }),
    { record: "Merge", merged: { merged: "Merged", mergeCommit } },
  );
  assert.deepEqual(
    finalizationProposalMergeReadingRecording({ reconciled: "Unavailable" }),
    { record: "Nothing", hold: "ProposalUnavailable" },
  );
  assert.deepEqual(
    finalizationProposalMergeReadingRecording({ reconciled: "Denied" }),
    { record: "Nothing", hold: "ProposalDenied" },
  );
  assert.deepEqual(
    finalizationProposalMergeReadingRecording({ reconciled: "Absent" }),
    {
      record: "Reading",
      reconciled: { reconciled: "Absent" },
      hold: undefined,
    },
  );
  const closed = {
    reconciled: "Contradictory",
    contradiction: "Closed",
    evidence: evidence({ status: "Closed" }),
  } as const;
  assert.deepEqual(
    finalizationProposalMergeReadingRecording(closed),
    { record: "Reading", reconciled: closed, hold: "ProposalAbsent" },
    "a reading of a closed proposal holds as every pass it stays closed does",
  );
});

test("no merging in flight and no answered one reaches a second merge", () => {
  const merged: readonly ChangeProposalMerging[] = [
    unheard(1, 0),
    unheard(1, 1, { reconciled: "Unmerged", evidence: evidence() }),
    { merging: "Idle", merges: 2 },
    { merging: "Answered", merge: { merged: "Merged", mergeCommit } },
    { merging: "Moved", reading: undefined, heardAgeSecs: 0 },
    {
      merging: "Moved",
      reading: {
        reconciled: "Unmerged",
        evidence: evidence({ mergeability: "Mergeable" }),
      },
      heardAgeSecs: 0,
    },
    waitingOn(0, { mergeability: "Blocked" }),
    { ...waitingOn(0, { mergeability: "Mergeable" }), merges: 2 },
  ];
  for (const state of populated(merged, "the mergings")) {
    assert.notEqual(
      finalizationProposalNext(merging, proved(state), bounds).decide,
      "MergeProposal",
      JSON.stringify(state).slice(0, 60),
    );
  }
});

test("a proposal behind its base is updated at the pinned head, and its ceiling holds as merges spent", () => {
  mergesDecided([
    [
      waitingOn(0, { mergeability: "Behind" }),
      { decide: "UpdateProposal", request, merge: mergeRequest },
    ],
  ]);
  assert.deepEqual(
    finalizationProposalNext(
      merging,
      proved(
        waitingOn(0, { mergeability: "Behind" }),
        {},
        {
          ...pinned,
          updating: { updates: 2, unread: false, turn: true },
        },
      ),
      bounds,
    ),
    { decide: "Hold", hold: "ProposalMergesExhausted" },
  );
  for (const lifecycle of allClosingLifecycles)
    assert.deepEqual(
      finalizationProposalNext(
        { mode: "PullRequestMerge", lifecycle },
        proved(waitingOn(0, { mergeability: "Behind" })),
        bounds,
      ),
      { decide: "Abort" },
      lifecycle,
    );
});

test("a head adopted is pinned first and merged at after", () => {
  const updated = asGitObjectId("e".repeat(40));
  const at = { head: { ref: request.head.ref, commit: updated } };
  assert.deepEqual(
    finalizationProposalNext(
      merging,
      proved(
        waitingOn(0, { ...at, mergeability: "Mergeable" }),
        {},
        {
          ...pinned,
          adoption: { head: updated, adoption: "Adoptable" },
        },
      ),
      bounds,
    ),
    { decide: "AdoptProposalHead", head: updated },
  );
  assert.deepEqual(
    finalizationProposalNext(
      merging,
      proved(
        waitingOn(0, { ...at, mergeability: "Mergeable" }),
        {},
        {
          head: updated,
          updating: changeProposalUpdatingNone,
        },
      ),
      bounds,
    ),
    {
      decide: "MergeProposal",
      request,
      merge: { ...mergeRequest, headCommit: updated },
    },
  );
});

test("an update the forge took or left unsettled stands unread, and one it would not take is declined", () => {
  assert.deepEqual(
    finalizationProposalUpdateRecording({ updated: "Accepted" }),
    {
      record: "Asked",
    },
  );
  assert.deepEqual(
    finalizationProposalUpdateRecording({ updated: "Ambiguous" }),
    { record: "Asked" },
  );
  assert.deepEqual(
    finalizationProposalUpdateRecording({ updated: "Refused" }),
    {
      record: "Refused",
    },
  );
  assert.deepEqual(
    finalizationProposalUpdateRecording({ updated: "Unavailable" }),
    { record: "Declined", hold: "ProposalUnavailable" },
  );
  assert.deepEqual(finalizationProposalUpdateRecording({ updated: "Denied" }), {
    record: "Declined",
    hold: "ProposalDenied",
  });
});

test("the words a proposal carries name its ticket and always end on its marker", () => {
  assert.equal(
    finalizationProposalTitle(asTicketId(7), { intent }),
    "ticket 7: Serve the escalation reason.",
  );
  assert.equal(
    finalizationProposalBody(intent, marker),
    `Serve the escalation reason.\nRead the ticket.\n\n${marker}`,
  );
});

test("a proposal is titled by the ticket's own title where its brief names one", () => {
  assert.equal(
    finalizationProposalTitle(asTicketId(7), {
      title: asBriefTitle("Serve the reason"),
      intent,
    }),
    "ticket 7: Serve the reason",
  );
});

/** The longest intent a draft stores, written as one line of `character`. */
function longestIntent(character: string): ReturnType<typeof asBriefIntent> {
  return asBriefIntent(character.repeat(briefIntentCharsMax));
}

test("an intent no proposal could carry whole is bounded rather than refused", () => {
  const long = longestIntent("w");
  const title = finalizationProposalTitle(asTicketId(7), { intent: long });
  const body = finalizationProposalBody(long, marker);
  assert.equal(title.length, proposalTitleCharsMax);
  assert.equal(body.length, proposalBodyCharsMax);
  assert.equal(body.endsWith(`\n\n${marker}`), true);
});

test("a bound falling inside a character keeps the words well formed", () => {
  const emoji = "\u{1f600}";
  const paired = longestIntent(emoji);
  const title = finalizationProposalTitle(asTicketId(70), { intent: paired });
  assert.equal(
    title,
    `ticket 70: ${emoji.repeat(proposalTitleCharsMax - "ticket 70: ".length)}`,
    "the title fills exactly to the code-point bound",
  );
  assert.equal(title.isWellFormed(), true);
  const body = finalizationProposalBody(paired, marker);
  assert.equal(body.isWellFormed(), true);
  assert.ok(textCodePointsCount(body) <= proposalBodyCharsMax);
  assert.equal(body.endsWith(`\n\n${marker}`), true);
});

/** The proposal an earlier request of the ticket recorded, as its row addresses it. */
const recordedProposal = {
  ...evidence().identity,
  number: asProposalNumber(7),
};

/** A request with no row of its own, beside what reading its ticket's proposal found. */
function adopting(
  read: ChangeProposalRead,
  publication: ChangeProposalPublication = { publication: "Unopened" },
): FinalizationProposalGathered {
  return {
    gathered: "Request",
    request,
    publication,
    merging: { merging: "Unasked" },
    merge: pinned,
    adoption: { proposal: recordedProposal, read },
  };
}

test("a request with no proposal of its own adopts its ticket's open one, and opens its own otherwise", () => {
  const earlier = evidence({ title: "Retitled by a reviewer" });
  for (const standing of [proposing, merging])
    assert.deepEqual(
      finalizationProposalNext(
        standing,
        adopting({ read: "Found", evidence: earlier }),
        bounds,
      ),
      { decide: "AdoptProposal", request, evidence: earlier },
    );
  assert.deepEqual(
    finalizationProposalNext(
      merging,
      adopting({ read: "Found", evidence: evidence({ status: "Closed" }) }),
      bounds,
    ),
    { decide: "ProposeChange", request },
    "a closed proposal is left closed, and this request opens its own",
  );
  assert.deepEqual(
    finalizationProposalNext(
      merging,
      adopting(
        { read: "Found", evidence: earlier },
        { publication: "Idle", creations: 1 },
      ),
      bounds,
    ),
    { decide: "ProposeChange", request },
    "a request that already asked for its own proposal adopts nothing",
  );
  assert.deepEqual(
    finalizationProposalNext(
      merging,
      adopting({ read: "Unavailable" }),
      bounds,
    ),
    { decide: "Hold", hold: "ProposalUnavailable" },
  );
  assert.deepEqual(
    finalizationProposalNext(merging, adopting({ read: "Denied" }), bounds),
    { decide: "Hold", hold: "ProposalDenied" },
  );
});

test("an adopted proposal is merged as one this request opened", () => {
  const earlier = evidence({ title: "Retitled by a reviewer" });
  assert.deepEqual(
    finalizationProposalNext(
      merging,
      gathered({
        publication: "Answered",
        creation: { created: "Adopted", evidence: earlier },
      }),
      bounds,
    ),
    {
      decide: "MergeProposal",
      request,
      merge: changeProposalMergeRequest({
        binding: request.binding,
        partition: request.partition,
        repository: request.repository,
        proposal: recordedProposal,
        marker: request.marker,
        headCommit: request.head.commit,
      }),
    },
  );
});
