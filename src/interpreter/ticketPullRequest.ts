import {
  changeProposalAddressed,
  changeProposalMergeNext,
  changeProposalMergeRequest,
  changeProposalPublicationNext,
  type ChangeProposalEvidence,
  type ChangeProposalMergeRequest,
  type ChangeProposalMerging,
  type ChangeProposalMergingBounds,
  type ChangeProposalPublication,
  type ChangeProposalPublicationBounds,
  type ChangeProposalRequest,
} from "./changeProposal.ts";
import type { TicketFinalizationOutcome } from "./ticketFinalization.ts";

export interface TicketPullRequestConfiguration {
  readonly kind: "finalizer";
  readonly operation: "pull-request";
  readonly target_ref: string;
  readonly branch_prefix: string;
  readonly merge: boolean;
}

export interface TicketPullRequestView {
  readonly configuration: TicketPullRequestConfiguration;
  readonly request: ChangeProposalRequest;
  readonly publication: ChangeProposalPublication;
  readonly merging: ChangeProposalMerging;
}

export interface TicketPullRequestBounds {
  readonly publication: ChangeProposalPublicationBounds;
  readonly merging: ChangeProposalMergingBounds;
}

export type TicketPullRequestStep =
  | {
      readonly step:
        "Create" | "ReadPublication" | "RefuseCreation" | "RefuseMerge";
    }
  | {
      readonly step: "Merge" | "ReadMerge";
      readonly request: ChangeProposalMergeRequest;
    }
  | {
      readonly step: "Complete";
      readonly outcome: TicketFinalizationOutcome;
      readonly evidence: unknown;
    };

function ticketPullRequestMerge(
  view: TicketPullRequestView,
  evidence: ChangeProposalEvidence,
  bounds: ChangeProposalMergingBounds,
): TicketPullRequestStep {
  const next = changeProposalMergeNext(view.request, view.merging, bounds);
  switch (next.next) {
    case "RefuseAttempt":
      return { step: "RefuseMerge" };
    case "Held":
    case "Refused":
      return { step: "Complete", outcome: "Unavailable", evidence: next };
    case "Concluded":
      return {
        step: "Complete",
        outcome:
          next.merge.merged === "Merged"
            ? "Succeeded"
            : next.merge.merged === "NotMergeable" &&
                next.merge.reason === "Conflict"
              ? "NeedsWork"
              : "Unavailable",
        evidence: next.merge,
      };
    case "Merge":
    case "ReadByNumber": {
      if (changeProposalAddressed(evidence.identity) === undefined)
        return {
          step: "Complete",
          outcome: "Unavailable",
          evidence: "ProposalUnaddressed",
        };
      if (
        next.next === "Merge" &&
        evidence.head.commit !== view.request.head.commit
      )
        return {
          step: "Complete",
          outcome: "Unavailable",
          evidence: "ProposalHeadMoved",
        };
      const request = changeProposalMergeRequest({
        binding: view.request.binding,
        partition: view.request.partition,
        repository: view.request.repository,
        proposal: evidence.identity,
        marker: view.request.marker,
        headCommit: view.request.head.commit,
      });
      return { step: next.next === "Merge" ? "Merge" : "ReadMerge", request };
    }
  }
}

/** PR publication and reconciliation remain inside the finalizer adapter protocol. */
export function ticketPullRequestNext(
  view: TicketPullRequestView,
  bounds: TicketPullRequestBounds,
): TicketPullRequestStep {
  const next = changeProposalPublicationNext(
    view.request,
    view.publication,
    bounds.publication,
    "Accepted",
  );
  switch (next.next) {
    case "Create":
      return { step: "Create" };
    case "Reconcile":
      return { step: "ReadPublication" };
    case "RefuseAttempt":
      return { step: "RefuseCreation" };
    case "Held":
    case "Refused":
      return { step: "Complete", outcome: "Unavailable", evidence: next };
    case "Accepted":
      if (next.evidence.head.commit !== view.request.head.commit)
        return {
          step: "Complete",
          outcome: "Unavailable",
          evidence: "ProposalHeadMoved",
        };
      if (
        view.configuration.merge &&
        next.evidence.status === "Merged" &&
        next.evidence.mergeCommit === undefined
      )
        return {
          step: "Complete",
          outcome: "Unavailable",
          evidence: "MergeCommitUnavailable",
        };
      if (!view.configuration.merge || next.evidence.status === "Merged")
        return {
          step: "Complete",
          outcome: "Succeeded",
          evidence: next.evidence,
        };
      return ticketPullRequestMerge(view, next.evidence, bounds.merging);
  }
}
