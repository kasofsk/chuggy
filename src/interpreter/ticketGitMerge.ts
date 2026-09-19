/**
 * Lands a ticket's work by merging it into the target ref, with no forge
 * anywhere in the path.
 *
 * It carries none of the attempt accounting the proposal path does, because a
 * conditional ref update is idempotent and the ref itself answers what became
 * of it: an unheard promotion is re-proved against the target, and a candidate
 * the target already holds is a landing that already happened. So every pass
 * re-observes the target and integrates against what it holds now, and nothing
 * between the passes has to be written down.
 */
import { assertNever } from "../domain/assertNever.ts";
import {
  repositoryBindingNarrowed,
  type CommitPermitId,
  type ConflictSummary,
  type GitObjectId,
  type GitPromotionPort,
  type GitRefName,
  type ObservedTarget,
  type RepositoryBinding,
} from "./finalizer.ts";
import type { TicketFinalizationOutcome } from "./ticketFinalization.ts";

export interface TicketGitMergeConfiguration {
  readonly kind: "finalizer";
  readonly operation: "git-merge";
  readonly target_ref: string;
}

export interface TicketGitMerge {
  readonly git: GitPromotionPort;
  readonly repository: RepositoryBinding;
  readonly targetRef: GitRefName;
  readonly candidate: GitObjectId;
  readonly permit: CommitPermitId;
}

export type TicketGitMergeEvidence =
  | { readonly landed: "Held" | "Merged"; readonly commit: GitObjectId }
  | { readonly landed: "Conflicted"; readonly conflict: ConflictSummary };

export type TicketGitMergeSettled =
  | {
      readonly settled: "Outcome";
      readonly outcome: TicketFinalizationOutcome;
      readonly evidence: TicketGitMergeEvidence;
    }
  | { readonly settled: "Unsettled" };

function ticketGitMergeLanded(
  landed: "Held" | "Merged",
  commit: GitObjectId,
): TicketGitMergeSettled {
  return {
    settled: "Outcome",
    outcome: "Succeeded",
    evidence: { landed, commit },
  };
}

/** Whether the target ref already holds the commit, however it came to. */
async function ticketGitMergeHolds(
  merge: TicketGitMerge,
  commit: GitObjectId,
): Promise<boolean> {
  const proved = await merge.git.proveCandidateAncestry({
    repository: merge.repository,
    ref: merge.targetRef,
    candidate: commit,
  });
  return proved.proved === "Ancestor";
}

/** Attempts the one conditional ref update, re-proving where the answer was ambiguous. */
async function ticketGitMergePromote(
  merge: TicketGitMerge,
  target: ObservedTarget,
  candidate: GitObjectId,
): Promise<TicketGitMergeSettled> {
  const promoted = await merge.git.promoteCandidate({
    repository: repositoryBindingNarrowed(merge.repository, merge.targetRef),
    permit: merge.permit,
    target,
    candidate,
  });
  switch (promoted.promoted) {
    case "Advanced":
      return ticketGitMergeLanded("Merged", candidate);
    case "Rejected":
      return { settled: "Unsettled" };
    case "Ambiguous":
      return (await ticketGitMergeHolds(merge, candidate))
        ? ticketGitMergeLanded("Merged", candidate)
        : { settled: "Unsettled" };
    default:
      return assertNever(promoted);
  }
}

/** Merges the candidate into what the target holds, a conflict being the ticket's to answer. */
async function ticketGitMergeIntegrate(
  merge: TicketGitMerge,
  target: ObservedTarget,
): Promise<TicketGitMergeSettled> {
  const integrated = await merge.git.integrateCandidate({
    repository: repositoryBindingNarrowed(merge.repository, merge.targetRef),
    target,
    candidate: merge.candidate,
    strategy: "Merge",
  });
  switch (integrated.integrated) {
    case "Candidate":
      return ticketGitMergePromote(merge, target, integrated.candidate);
    case "Conflicted":
      return {
        settled: "Outcome",
        outcome: "NeedsWork",
        evidence: { landed: "Conflicted", conflict: integrated.conflict },
      };
    case "Failed":
      return { settled: "Unsettled" };
    default:
      return assertNever(integrated);
  }
}

export async function ticketGitMergeRun(
  merge: TicketGitMerge,
): Promise<TicketGitMergeSettled> {
  if (await ticketGitMergeHolds(merge, merge.candidate))
    return ticketGitMergeLanded("Held", merge.candidate);
  const observed = await merge.git.observeTarget(
    repositoryBindingNarrowed(merge.repository, merge.targetRef),
  );
  return observed.observed === "Target"
    ? ticketGitMergeIntegrate(merge, observed.target)
    : { settled: "Unsettled" };
}
