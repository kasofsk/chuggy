/**
 * The boundary of a person's merge of a ticket's pull request: it is
 * authorized as the ticket's read and then by `MergeProposals`, the pull
 * request is read before any merge is asked, and what the forge answers is
 * named.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import {
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asProposalDisplayUrl,
  asProposalNumber,
  asProposalRemoteIdentity,
  proposalMarkerOf,
  type ChangeProposalEvidence,
  type ChangeProposalMerged,
  type ChangeProposalMergeRequest,
  type ChangeProposalRead,
} from "../../src/interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  ticketProposalMergeCredential,
  ticketProposalMerges,
  type TicketProposedLanding,
} from "../../src/interpreter/ticketProposalMerge.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const member = asPrincipal("issuer-member");
const ticket = asTicketId(7);
const url = "https://github.com/acme/atlas/pull/9";
const headCommit = asGitObjectId("a".repeat(40));
const mergeCommit = asGitObjectId("b".repeat(40));

const landing: TicketProposedLanding = {
  repository: asRepositoryId("github.com/acme/atlas"),
  request: asChangeProposalRequestIdentity("1".repeat(64)),
  head: { ref: asGitRefName("chuggy/7"), commit: headCommit },
  baseRef: asGitRefName("main"),
  proposal: {
    forge: asForgeBindingId("github"),
    remote: asProposalRemoteIdentity("PR_x"),
    number: asProposalNumber(9),
  },
  url,
};

/** The pull request as a reading finds it, open and mergeable unless `over` says otherwise. */
function found(over: Partial<ChangeProposalEvidence> = {}): ChangeProposalRead {
  return {
    read: "Found",
    evidence: {
      identity: landing.proposal,
      repository: landing.repository,
      marker: proposalMarkerOf(landing.request),
      head: landing.head,
      base: { ref: landing.baseRef, commit: asGitObjectId("c".repeat(40)) },
      title: "t",
      body: "b",
      status: "Open",
      mergeability: "Mergeable",
      url: asProposalDisplayUrl(url),
      ...over,
    },
  };
}

interface Boundary {
  readonly kinds?: readonly ProjectAccessKind[];
  readonly stored?: TicketProposedLanding | undefined;
  readonly forge?: boolean;
  readonly reads?: readonly ChangeProposalRead[];
  readonly merged?: ChangeProposalMerged;
}

function boundary(given: Boundary = {}) {
  const calls: string[] = [];
  const requests: ChangeProposalMergeRequest[] = [];
  const reads = [...(given.reads ?? [found()])];
  const access = memoryProjectAccess();
  access.grant({
    partition,
    principal: member,
    access: new Set(given.kinds ?? ["Read", "MergeProposals"]),
  });
  const merges = ticketProposalMerges({
    access,
    store: {
      proposed: () => {
        calls.push("proposed");
        return Promise.resolve("stored" in given ? given.stored : landing);
      },
    },
    ...(given.forge === false
      ? {}
      : {
          proposals: {
            readByNumber: (request) => {
              calls.push("read");
              requests.push(request);
              const next = reads.shift();
              assert.ok(next !== undefined, "no reading left to answer");
              return Promise.resolve(next);
            },
            merge: (request) => {
              calls.push("merge");
              requests.push(request);
              return Promise.resolve(
                given.merged ?? { merged: "Merged", mergeCommit },
              );
            },
          },
        }),
  });
  return {
    calls,
    requests,
    merge: () => merges.merge(member, partition, ticket),
  };
}

test("a pull request read open is merged at the head the landing evaluated, through the portal app's credential", async () => {
  const pressed = boundary();
  assert.deepEqual(await pressed.merge(), {
    result: "Merged",
    mergeCommit,
    url,
  });
  assert.deepEqual(pressed.calls, ["proposed", "read", "merge"]);
  for (const request of pressed.requests) {
    assert.equal(request.headCommit, headCommit);
    assert.deepEqual(request.proposal, landing.proposal);
    assert.equal(request.binding.credential, ticketProposalMergeCredential);
    assert.equal(request.marker, proposalMarkerOf(landing.request));
  }
});

test("a reader who may not merge is refused apart from a ticket they cannot read, and neither reaches the store", async () => {
  const forbidden = boundary({ kinds: ["Read"] });
  assert.deepEqual(await forbidden.merge(), { result: "Forbidden" });
  assert.deepEqual(forbidden.calls, []);
  const unreadable = boundary({ kinds: ["MergeProposals"] });
  assert.deepEqual(await unreadable.merge(), { result: "NotFound" });
  assert.deepEqual(unreadable.calls, []);
});

test("a ticket whose newest success opened no pull request is not found, and one with no portal key is unavailable", async () => {
  const none = boundary({ stored: undefined });
  assert.deepEqual(await none.merge(), { result: "NotFound" });
  assert.deepEqual(none.calls, ["proposed"]);
  assert.deepEqual(await boundary({ forge: false }).merge(), {
    result: "Unavailable",
  });
});

test("a pull request merged already answers Merged, so a second press asks no merge", async () => {
  const again = boundary({ reads: [found({ status: "Merged", mergeCommit })] });
  assert.deepEqual(await again.merge(), { result: "Merged", mergeCommit, url });
  assert.deepEqual(again.calls, ["proposed", "read"]);
});

test("each reading that stops a merge is refused by name and asks none", async () => {
  const otherRef = asGitRefName("elsewhere");
  for (const [evidence, refused] of [
    [{ status: "Closed" }, "Closed"],
    [{ mergeability: "Conflicting" }, "Conflicting"],
    [{ mergeability: "Blocked" }, "Blocked"],
    [{ mergeability: "Behind" }, "Behind"],
    [{ status: "Superseded" }, "NotMergeable"],
    [{ head: { ref: otherRef, commit: headCommit } }, "NotMergeable"],
    [
      { base: { ref: otherRef, commit: asGitObjectId("c".repeat(40)) } },
      "NotMergeable",
    ],
    [{ repository: asRepositoryId("github.com/acme/other") }, "NotMergeable"],
  ] as const) {
    const pressed = boundary({ reads: [found(evidence)] });
    assert.deepEqual(
      await pressed.merge(),
      { result: "Refused", refused, url },
      refused,
    );
    assert.deepEqual(pressed.calls, ["proposed", "read"], refused);
  }
  for (const [read, answer] of [
    [{ read: "Absent" }, { result: "Refused", refused: "NotMergeable", url }],
    [{ read: "Denied" }, { result: "Refused", refused: "AppDenied", url }],
    [{ read: "Unavailable" }, { result: "Unavailable" }],
  ] as const) {
    const pressed = boundary({ reads: [read] });
    assert.deepEqual(await pressed.merge(), answer, read.read);
    assert.deepEqual(pressed.calls, ["proposed", "read"], read.read);
  }
});

test("a merge the forge refuses is named by what it said, and one it gave no reason for by a second reading", async () => {
  for (const [merged, answer] of [
    [{ merged: "HeadMoved" }, { result: "Refused", refused: "HeadMoved", url }],
    [{ merged: "Denied" }, { result: "Refused", refused: "AppDenied", url }],
    [{ merged: "Unavailable" }, { result: "Unavailable" }],
  ] as const) {
    const pressed = boundary({ merged });
    assert.deepEqual(await pressed.merge(), answer, merged.merged);
    assert.deepEqual(pressed.calls, ["proposed", "read", "merge"]);
  }
  for (const merged of [
    { merged: "NotMergeable", reason: "Unknown" },
    { merged: "Ambiguous" },
  ] as const)
    for (const [reread, answer] of [
      [
        found({ status: "Merged", mergeCommit }),
        { result: "Merged", mergeCommit, url },
      ],
      [
        found({ mergeability: "Blocked" }),
        { result: "Refused", refused: "Blocked", url },
      ],
      [found(), { result: "Refused", refused: "NotMergeable", url }],
      [
        { read: "Unavailable" },
        { result: "Refused", refused: "NotMergeable", url },
      ],
    ] as const) {
      const pressed = boundary({ merged, reads: [found(), reread] });
      assert.deepEqual(await pressed.merge(), answer, merged.merged);
      assert.deepEqual(pressed.calls, ["proposed", "read", "merge", "read"]);
    }
});

test("a link a report could not carry is left out of the answer", async () => {
  const pressed = boundary({
    stored: { ...landing, url: "javascript:alert(1)" },
  });
  assert.deepEqual(await pressed.merge(), { result: "Merged", mergeCommit });
});
