/**
 * Where a ticket's finalization lands, as its brief and its repository's
 * binding say before anything is read of the remote. The finalizer gathers its
 * view and reads a proposal's base from it, and a work task is told the ref to
 * merge from it, so the two cannot name different refs for one ticket.
 */

import { briefFinalizationOpensProposal } from "../contract/brief.ts";
import {
  repositoryBindingNarrowed,
  repositoryBindingWidened,
  type GitRefName,
  type RepositoryBinding,
} from "./finalizer.ts";
import {
  briefFinalizationTarget,
  briefLandsOn,
  type DraftBrief,
} from "./ticketBrief.ts";

/**
 * The branches one brief names: where the work happened, and where the
 * promotion lands it. The brief itself is kept, because the finalization it
 * names is what the pure pass reads of it.
 */
export interface FinalizerBranches {
  readonly work?: GitRefName;
  readonly target?: GitRefName;
  readonly brief?: DraftBrief;
}

/**
 * What the ticket's brief says about each: a push lands on the reference its
 * finalization names or on the work's own branch where it names none, and a
 * pull request always lands on the work's branch — that branch being the head a
 * proposal is opened from and its finalization's reference the base. A
 * proposing brief naming no branch of its own is answered by neither, because
 * such a brief is refused where briefs are written and the binding's default is
 * not a stand-in for the head a proposal opens from.
 */
export function finalizerBranchesOf(
  brief: DraftBrief | undefined,
): FinalizerBranches | undefined {
  if (brief === undefined) return {};
  const proposing = briefFinalizationOpensProposal(brief.finalization);
  if (proposing && brief.branch === undefined) return undefined;
  const target = briefLandsOn(brief);
  return {
    brief,
    ...(brief.branch === undefined ? {} : { work: brief.branch }),
    ...(target === undefined ? {} : { target }),
  };
}

/**
 * Where one ticket lands: nowhere, for a brief whose finalization is `None` or
 * a ticket no binding answers for; not yet, for a proposing brief naming no
 * branch; and otherwise on the binding its branches narrow, beside the binding
 * they narrowed, which is what a branch the remote does not hold yet is read
 * from.
 */
export type FinalizerLanding =
  | { readonly landing: "None" }
  | { readonly landing: "Unbound" }
  | { readonly landing: "Unbranched" }
  | {
      readonly landing: "Lands";
      readonly branches: FinalizerBranches;
      readonly binding: RepositoryBinding;
      readonly repository: RepositoryBinding;
    };

/** Where the ticket `brief` describes lands, against the binding its repository has. */
export function finalizerLandingOf(
  brief: DraftBrief | undefined,
  binding: RepositoryBinding | undefined,
): FinalizerLanding {
  if (brief?.finalization?.kind === "None") return { landing: "None" };
  if (binding === undefined) return { landing: "Unbound" };
  const branches = finalizerBranchesOf(brief);
  if (branches === undefined) return { landing: "Unbranched" };
  return {
    landing: "Lands",
    branches,
    binding,
    repository: repositoryBindingNarrowed(binding, branches.target),
  };
}

/**
 * The ref the ticket lands on, where its brief or its binding names one. A
 * landing on whatever branch the remote defaults to names none, because only
 * the finalizer's own read of the remote at landing says which branch that is.
 */
export function finalizerLandingRef(
  brief: DraftBrief | undefined,
  binding: RepositoryBinding | undefined,
): GitRefName | undefined {
  const landing = finalizerLandingOf(brief, binding);
  return landing.landing === "Lands" ? landing.repository.targetRef : undefined;
}

/**
 * The binding a proposal's base is read through: the reference its
 * finalization names, read as itself rather than through the binding's own, or
 * the branch the remote defaults to where it names none.
 */
export function finalizerProposalBaseBinding(
  binding: RepositoryBinding,
  named: GitRefName | undefined,
): RepositoryBinding {
  return repositoryBindingNarrowed(repositoryBindingWidened(binding), named);
}

/** What `git fetch origin` names the branch the remote defaults to by. */
export const finalizerRemoteDefaultRef = "HEAD";

/**
 * The ref a work task merges in to meet the change it lands beside: where the
 * ticket lands, for a push, and for a proposal the base it opens into rather
 * than the branch it opens from. A base the remote defaults to is named as
 * `finalizerRemoteDefaultRef`, because only the finalizer's own read of the
 * remote says which branch that is.
 */
export function finalizerLandingBaseRef(
  brief: DraftBrief | undefined,
  binding: RepositoryBinding | undefined,
): string | undefined {
  const landing = finalizerLandingOf(brief, binding);
  if (landing.landing !== "Lands") return undefined;
  const finalization = landing.branches.brief?.finalization;
  if (!briefFinalizationOpensProposal(finalization))
    return landing.repository.targetRef;
  return (
    finalizerProposalBaseBinding(
      landing.binding,
      briefFinalizationTarget(finalization),
    ).targetRef ?? finalizerRemoteDefaultRef
  );
}
