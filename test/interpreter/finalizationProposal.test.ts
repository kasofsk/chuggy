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

import {
  briefIntentLinesMax,
  briefLineCharsMax,
} from "../../src/contract/brief.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  allFinalizationHoldKinds,
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asForgeCredentialReference,
  asProposalRemoteIdentity,
  changeProposalRequestFromBranch,
  proposalBodyCharsMax,
  proposalMarkerOf,
  proposalTitleCharsMax,
  type ChangeProposalEvidence,
  type ChangeProposalPublicationView,
} from "../../src/interpreter/changeProposal.ts";
import {
  finalizationProposalBody,
  finalizationProposalNext,
  finalizationProposalTitle,
  type FinalizationProposalGathered,
} from "../../src/interpreter/finalizationProposal.ts";
import { asBriefIntent } from "../../src/interpreter/ticketBrief.ts";
import { populated } from "./roster.ts";

const identity = asChangeProposalRequestIdentity("a".repeat(64));
const marker = proposalMarkerOf(identity);
const intent = asBriefIntent("Serve the escalation reason.\nRead the ticket.");

const request = changeProposalRequestFromBranch({
  binding: {
    forge: asForgeBindingId("forge-alpha"),
    credential: asForgeCredentialReference("forge-alpha-proposals"),
  },
  repository: asRepositoryId("https://forge.invalid/acme/atlas.git"),
  request: identity,
  headRef: asGitRefName("refs/heads/chuggy/footer-2026"),
  headCommit: asGitObjectId("b".repeat(40)),
  baseRef: asGitRefName("refs/heads/main"),
  baseCommit: asGitObjectId("c".repeat(40)),
  title: finalizationProposalTitle(asTicketId(7), intent),
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

/** One gathered proposal over the publication a case names. */
function gathered(
  publication: ChangeProposalPublicationView,
): FinalizationProposalGathered {
  return { gathered: "Request", request, publication };
}

test("a proposal nobody has opened is created, and one that may exist is read back", () => {
  assert.deepEqual(
    finalizationProposalNext(gathered({ reconciliations: 0 }), 2),
    { decide: "ProposeChange", request },
  );
  assert.deepEqual(
    finalizationProposalNext(
      gathered({ creation: { created: "Ambiguous" }, reconciliations: 0 }),
      2,
    ),
    { decide: "ReconcileProposal", request },
  );
});

test("a proposal the forge proves it holds is the one thing that concludes", () => {
  for (const created of ["Created", "AlreadyExists"] as const) {
    assert.deepEqual(
      finalizationProposalNext(
        gathered({
          creation: { created, evidence: evidence() },
          reconciliations: 0,
        }),
        2,
      ),
      { decide: "Conclude" },
      created,
    );
  }
  assert.deepEqual(
    finalizationProposalNext(
      gathered({
        creation: { created: "Ambiguous" },
        reconciliation: { reconciled: "Accepted", evidence: evidence() },
        reconciliations: 1,
      }),
      2,
    ),
    { decide: "Conclude" },
  );
});

test("every reason a publication is held reaches a hold this tree declares", () => {
  const holds = new Set<string>(allFinalizationHoldKinds);
  const held: readonly [ChangeProposalPublicationView, string][] = [
    [
      { creation: { created: "Unavailable" }, reconciliations: 0 },
      "ProposalUnavailable",
    ],
    [{ creation: { created: "Denied" }, reconciliations: 0 }, "ProposalDenied"],
    [
      { creation: { created: "Ambiguous" }, reconciliations: 2 },
      "ProposalReconciliationsExhausted",
    ],
    [
      {
        creation: {
          created: "Created",
          evidence: evidence({ status: "Closed" }),
        },
        reconciliations: 0,
      },
      "ProposalRefused",
    ],
  ];
  for (const [publication, hold] of held) {
    assert.deepEqual(
      finalizationProposalNext(gathered(publication), 2),
      { decide: "Hold", hold },
      hold,
    );
    assert.ok(holds.has(hold), `${hold} is not a declared hold`);
  }
});

test("a deployment binding no forge and an unreadable base are holds and not conclusions", () => {
  assert.deepEqual(finalizationProposalNext({ gathered: "Unbound" }, 2), {
    decide: "Hold",
    hold: "ProposalDenied",
  });
  assert.deepEqual(
    finalizationProposalNext({ gathered: "BaseUnreadable" }, 2),
    {
      decide: "Hold",
      hold: "ProposalBaseUnreadable",
    },
    "the base a proposal opens into is named apart from the ref it landed on",
  );
});

test("no publication this machine can be handed reaches a create twice", () => {
  const publications: readonly ChangeProposalPublicationView[] = [
    { creation: { created: "Ambiguous" }, reconciliations: 0 },
    { creation: { created: "Ambiguous" }, reconciliations: 9 },
    {
      creation: { created: "Ambiguous" },
      reconciliation: { reconciled: "Absent" },
      reconciliations: 1,
    },
    {
      creation: { created: "Ambiguous" },
      reconciliation: { reconciled: "Unavailable" },
      reconciliations: 1,
    },
    {
      creation: { created: "Ambiguous" },
      reconciliation: { reconciled: "Denied" },
      reconciliations: 1,
    },
    { creation: { created: "Unavailable" }, reconciliations: 0 },
    { creation: { created: "Denied" }, reconciliations: 0 },
    {
      creation: {
        created: "Contradictory",
        contradiction: "Closed",
        evidence: evidence({ status: "Closed" }),
      },
      reconciliations: 0,
    },
  ];
  for (const publication of populated(publications, "the publications")) {
    assert.notEqual(
      finalizationProposalNext(gathered(publication), 2).decide,
      "ProposeChange",
      JSON.stringify(publication).slice(0, 60),
    );
  }
});

test("a bound that is not a positive count is refused rather than treated as none", () => {
  for (const bound of [0, -1, 1.5]) {
    assert.throws(
      () => finalizationProposalNext(gathered({ reconciliations: 0 }), bound),
      RangeError,
      String(bound),
    );
  }
});

test("the words a proposal carries name its ticket and always end on its marker", () => {
  assert.equal(
    finalizationProposalTitle(asTicketId(7), intent),
    "ticket 7: Serve the escalation reason.",
  );
  assert.equal(
    finalizationProposalBody(intent, marker),
    `Serve the escalation reason.\nRead the ticket.\n\n${marker}`,
  );
});

/** The longest intent a draft stores, as the lines it is bounded in. */
function longestIntent(line: string): ReturnType<typeof asBriefIntent> {
  return asBriefIntent(
    Array.from({ length: briefIntentLinesMax }, () => line).join("\n"),
  );
}

test("an intent no proposal could carry whole is bounded rather than refused", () => {
  const long = longestIntent("w".repeat(briefLineCharsMax - 1));
  const title = finalizationProposalTitle(asTicketId(7), long);
  const body = finalizationProposalBody(long, marker);
  assert.equal(title.length, proposalTitleCharsMax);
  assert.equal(body.length, proposalBodyCharsMax);
  assert.equal(body.endsWith(`\n\n${marker}`), true);
});

test("a bound falling inside a character keeps the words well formed", () => {
  const emoji = "\u{1f600}";
  const paired = longestIntent(emoji.repeat(briefLineCharsMax / 2 - 1));
  const title = finalizationProposalTitle(asTicketId(70), paired);
  assert.equal(
    title,
    `ticket 70: ${emoji.repeat((proposalTitleCharsMax - "ticket 70: ".length - 1) / 2)}`,
    "the title stops one character short rather than half of one",
  );
  assert.equal(title.isWellFormed(), true);
  const body = finalizationProposalBody(paired, marker);
  assert.equal(body.isWellFormed(), true);
  assert.ok(body.length <= proposalBodyCharsMax);
  assert.equal(body.endsWith(`\n\n${marker}`), true);
});
