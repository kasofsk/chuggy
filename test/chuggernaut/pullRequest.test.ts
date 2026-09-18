import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asForgeCredentialReference,
  asProposalNumber,
  asProposalRemoteIdentity,
  changeProposalRequest,
  type ChangeProposalEvidence,
} from "../../src/interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asTenantId, asProjectId } from "../../src/interpreter/projectStore.ts";
import {
  ticketPullRequestNext,
  type TicketPullRequestView,
  type TicketPullRequestBounds,
} from "../../src/interpreter/ticketPullRequest.ts";
import { ticketFinalizationReport } from "../../src/interpreter/ticketFinalization.ts";
import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import {
  ContentRef,
  CycleNumber,
  Generation,
  TicketId,
} from "../../src/domain/chuggernaut/task.js";
import { source } from "./domain/testing.js";

const request = changeProposalRequest({
  binding: {
    forge: asForgeBindingId("github"),
    credential: asForgeCredentialReference("test"),
  },
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  repository: asRepositoryId("https://github.com/example/repository"),
  request: asChangeProposalRequestIdentity("a".repeat(64)),
  headRef: asGitRefName("refs/heads/tickets/1"),
  headCommit: asGitObjectId("b".repeat(40)),
  baseRef: asGitRefName("refs/heads/main"),
  baseCommit: asGitObjectId("c".repeat(40)),
  title: "Implement ticket",
  body: "Ticket instructions",
});
const evidence: ChangeProposalEvidence = {
  identity: {
    forge: request.binding.forge,
    remote: asProposalRemoteIdentity("pr-1"),
    number: asProposalNumber(1),
  },
  repository: request.repository,
  marker: request.marker,
  head: request.head,
  base: request.base,
  title: request.title,
  body: request.body,
  status: "Open",
};
const bounds: TicketPullRequestBounds = {
  publication: { creationsMax: 2, reconciliationsMax: 3 },
  merging: { mergesMax: 2, readingsMax: 3 },
};
function view(merge: boolean): TicketPullRequestView {
  return {
    configuration: {
      kind: "finalizer",
      operation: "pull-request",
      target_ref: "refs/heads/main",
      branch_prefix: "tickets/",
      merge,
    },
    request,
    publication: {
      publication: "Answered",
      creation: { created: "Created", evidence },
    },
    merging: { merging: "Unasked" },
  };
}

test("PR finalizer completes after opening when merge is disabled", () => {
  assert.deepEqual(ticketPullRequestNext(view(false), bounds), {
    step: "Complete",
    outcome: "Succeeded",
    evidence,
  });
});

test("the same finalizer asks for a conditional merge when enabled", () => {
  const step = ticketPullRequestNext(view(true), bounds);
  assert.equal(step.step, "Merge");
  if (step.step !== "Merge") throw new Error("expected merge");
  assert.equal(step.request.headCommit, request.head.commit);
  assert.deepEqual(step.request.proposal, evidence.identity);
});

test("ambiguous creation and merge are reconciled before another mutation", () => {
  for (const merge of [false, true]) {
    const pending: TicketPullRequestView = {
      ...view(merge),
      publication: {
        publication: "Unanswered",
        creations: 1,
        reconciliations: 0,
        reading: undefined,
      },
    };
    assert.equal(
      ticketPullRequestNext(pending, bounds).step,
      "ReadPublication",
    );
  }
  const pending: TicketPullRequestView = {
    ...view(true),
    merging: {
      merging: "Unanswered",
      merges: 1,
      readings: 0,
      reading: undefined,
    },
  };
  assert.equal(ticketPullRequestNext(pending, bounds).step, "ReadMerge");
});

test("only a merge conflict requests more work", () => {
  for (const reason of ["Conflict", "Blocked"] as const) {
    const state: TicketPullRequestView = {
      ...view(true),
      merging: {
        merging: "Answered",
        merge: { merged: "NotMergeable", reason },
      },
    };
    const step = ticketPullRequestNext(state, bounds);
    assert.equal(step.step, "Complete");
    if (step.step !== "Complete") throw new Error("expected completion");
    assert.equal(
      step.outcome,
      reason === "Conflict" ? "NeedsWork" : "Unavailable",
    );
  }
});

test("reconciliation cannot accept a different commit under the same branch", () => {
  for (const merge of [false, true]) {
    const changed = {
      ...evidence,
      head: { ...evidence.head, commit: asGitObjectId("d".repeat(40)) },
    };
    const state: TicketPullRequestView = {
      ...view(merge),
      publication: {
        publication: "Answered",
        creation: { created: "AlreadyExists", evidence: changed },
      },
    };
    assert.deepEqual(ticketPullRequestNext(state, bounds), {
      step: "Complete",
      outcome: "Unavailable",
      evidence: "ProposalHeadMoved",
    });
  }
});

test("finalizer reports carry the exact work cycle and generation", () => {
  const obligation = new ticket.FinalizeTicket(
    TicketId(1),
    new ticket.FinalizationOperation(
      CycleNumber(2),
      Generation(3),
      ContentRef(4),
      source(5),
    ),
    ContentRef(6),
  );
  for (const [outcome, result] of [
    ["Succeeded", "FinalizationSucceeded"],
    ["NeedsWork", "FinalizationNeedsWork"],
    ["Unavailable", "FinalizationResultUnavailable"],
  ] as const) {
    const command = ticketFinalizationReport(
      obligation,
      outcome,
      ContentRef(7),
    );
    assert.equal(command.report.ticket, obligation.ticket);
    assert.equal(command.report.work_cycle, 2);
    assert.equal(command.report.generation, 3);
    assert.equal(command.report.result.kind, result);
  }
});
