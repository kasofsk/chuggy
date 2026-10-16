/**
 * The provider-neutral change proposal: the deterministic request one is opened
 * under, the evidence a forge answers with, and the bounded publication and
 * merging that turn an unsettled act into an answer.
 *
 * EVERY REQUEST NAMES THE BRANCH ITS WORK LANDED ON. The commit a person will
 * review is the one the promotion put on the ticket's own branch, so the head
 * is the caller's and nothing here mints one.
 *
 * EACH SIDE IS IDENTIFIED BY ITS REF, AND THE PROPOSAL BY ITS MARKER. A
 * proposal stands between two branches, and what either branch holds is the
 * forge's to move between the moment it is observed and every later reading —
 * so comparing a commit would refuse a proposal this request had successfully
 * opened whenever anybody landed anything on either side in between, which for
 * a head that is the ticket's own work branch is every push the ticket makes
 * after the create. The marker is what says a proposal is this request's and
 * the two refs are where it stands, so each side's commit stays in the request
 * and in the evidence as what was observed and is compared with nothing.
 *
 * A CREATE IS EITHER IN FLIGHT OR IT IS NOT, AND THAT IS THE WHOLE STATE. An
 * attempt is counted before the forge is asked, so a create whose outcome
 * nobody heard is the state a crash and a lost answer both leave, and it can
 * only be read back. Releasing that attempt is what lets a later pass make
 * another create, and what the ceiling below is spent from is the creates that
 * may have reached the forge: one that readings found nothing of spends one,
 * and one the forge would not take at all spends none, because that answer is
 * about this deployment rather than about the proposal.
 *
 * A MERGE THE FORGE'S OWN RULES REFUSE WAITS ON THEM. A required check, a
 * required review and a branch that must be up to date each refuse a merge for
 * as long as somebody leaves them, which no reading can tell apart, so a merge
 * a reading found blocked is released with that reading kept as what it waits
 * on. A merge the forge answered had moved head waits the same way, on whoever
 * moved it. Either is read again once `proposalMergeRereadSecs` have passed
 * since the forge was last heard about it: a proposal merged by anyone is the
 * merge this request asked for, one closed unmerged is a merge that can no
 * longer happen, and only a blocked one read as mergeable is merged again,
 * under the same ceilings as any other.
 */

import { assertNever } from "../domain/assertNever.ts";
import {
  proposalMergeStateCharsMax,
  textCodePointsCount,
} from "../contract/http.ts";
import { asBoundedText } from "./boundedText.ts";
import type { GitObjectId, GitRefName, RepositoryId } from "./finalizer.ts";
import {
  finalizerIdentityCharsMax,
  repositoryCredentialCharsMax,
} from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
declare const forgeBindingIdBrand: unique symbol;
declare const proposalRemoteIdentityBrand: unique symbol;
declare const proposalMarkerBrand: unique symbol;
declare const forgeCredentialBrand: unique symbol;
declare const proposalDisplayUrlBrand: unique symbol;
declare const changeProposalRequestIdentityBrand: unique symbol;
declare const forgeCredentialReferenceBrand: unique symbol;
declare const proposalNumberBrand: unique symbol;
declare const proposalMergeStateBrand: unique symbol;

export type ForgeBindingId = string & {
  readonly [forgeBindingIdBrand]: true;
};
export type ProposalRemoteIdentity = string & {
  readonly [proposalRemoteIdentityBrand]: true;
};
export type ProposalMarker = string & {
  readonly [proposalMarkerBrand]: true;
};
export type ForgeCredential = string & {
  readonly [forgeCredentialBrand]: true;
};
export type ProposalDisplayUrl = string & {
  readonly [proposalDisplayUrlBrand]: true;
};
export type ChangeProposalRequestIdentity = string & {
  readonly [changeProposalRequestIdentityBrand]: true;
};
export type ForgeCredentialReference = string & {
  readonly [forgeCredentialReferenceBrand]: true;
};
export type ProposalNumber = number & {
  readonly [proposalNumberBrand]: true;
};
/** The forge's own word for whether a proposal can merge, carried as it said it so a person reads what the forge said. */
export type ProposalMergeState = string & {
  readonly [proposalMergeStateBrand]: true;
};

export const proposalTitleCharsMax = 256;
export const proposalBodyCharsMax = 16_384;
export const proposalMarkerCharsMax = 128;
export const proposalDisplayUrlCharsMax = 2_048;

/**
 * How long a merge waiting on the forge goes unread. A required check runs for
 * minutes and a review for as long as a person takes, so a reading every couple
 * of minutes lands a merge soon after either clears while each waiting proposal
 * spends one request a cadence of its installation's hourly rate limit.
 */
export const proposalMergeRereadSecs = 120;

/**
 * The most one proposal's evidence is stored at. Every field of it is bounded
 * above, so the bound is above the whole of them escaped and no answer a forge
 * can be read into needs storing at more than it.
 */
export const proposalEvidenceCharsMax = 131_072;
export const changeProposalRequestIdentityChars = 64;

export function asForgeBindingId(value: string): ForgeBindingId {
  return asBoundedText(
    value,
    "forge binding",
    finalizerIdentityCharsMax,
  ) as ForgeBindingId;
}

export function asProposalRemoteIdentity(
  value: string,
): ProposalRemoteIdentity {
  return asBoundedText(
    value,
    "proposal remote identity",
    finalizerIdentityCharsMax,
  ) as ProposalRemoteIdentity;
}

/**
 * A forge credential is the token a mint or a mounted file answers with and is
 * never stored, so it is held to the repository credential's bound rather than
 * an identity's: the token GitHub mints is longer than any stored identity.
 */
export function asForgeCredential(value: string): ForgeCredential {
  return asBoundedText(
    value,
    "forge credential",
    repositoryCredentialCharsMax,
  ) as ForgeCredential;
}

export function asProposalDisplayUrl(value: string): ProposalDisplayUrl {
  return asBoundedText(
    value,
    "proposal display URL",
    proposalDisplayUrlCharsMax,
  ) as ProposalDisplayUrl;
}

export function asProposalMergeState(value: string): ProposalMergeState {
  return asBoundedText(
    value,
    "proposal merge state",
    proposalMergeStateCharsMax,
  ) as ProposalMergeState;
}

export function asChangeProposalRequestIdentity(
  value: string,
): ChangeProposalRequestIdentity {
  if (
    value.length !== changeProposalRequestIdentityChars ||
    !/^[0-9a-f]+$/u.test(value)
  )
    throw new RangeError("change proposal request is not a canonical digest");
  return value as ChangeProposalRequestIdentity;
}

export function asForgeCredentialReference(
  value: string,
): ForgeCredentialReference {
  return asBoundedText(
    value,
    "forge credential reference",
    finalizerIdentityCharsMax,
  ) as ForgeCredentialReference;
}

/** The count one proposal is numbered at, which a safe integer is the whole of. */
export function asProposalNumber(value: number): ProposalNumber {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError("proposal number is not a positive count");
  return value as ProposalNumber;
}

export function asProposalMarker(value: string): ProposalMarker {
  return asBoundedText(
    value,
    "proposal marker",
    proposalMarkerCharsMax,
  ) as ProposalMarker;
}

export function proposalMarkerOf(
  request: ChangeProposalRequestIdentity,
): ProposalMarker {
  return asProposalMarker(`chuggy-handoff:${request}`);
}

export interface ForgeBinding {
  readonly forge: ForgeBindingId;
  readonly credential: ForgeCredentialReference;
}

/** One forge as a repository reaches it, under the host that is what selects it. */
export interface ForgeRepositoryBinding {
  readonly binding: ForgeBinding;
  readonly repositoryHost: string;
}

/**
 * The forge whose host a repository's own address names. A repository identity
 * is the remote's URL, so the host in it is what says which forge holds it; a
 * deployment that binds none for that host has no proposal to open there.
 */
export function forgeBindingOf(
  bindings: readonly ForgeRepositoryBinding[],
  repository: RepositoryId,
): ForgeBinding | undefined {
  let host: string;
  try {
    host = new URL(repository).host;
  } catch {
    return undefined;
  }
  return bindings.find((bound) => bound.repositoryHost === host)?.binding;
}

/**
 * What one proposal is on its forge, whose number stands beside the forge's own
 * identity for it because that identity names a proposal rather than addressing
 * one.
 *
 * An answer stored before any landing could ask a proposal to do anything
 * carries no number and is read and compared exactly as it always was; only the
 * acts addressed to one need it, and those refuse its absence as a value.
 */
export interface ChangeProposalIdentity {
  readonly forge: ForgeBindingId;
  readonly remote: ProposalRemoteIdentity;
  readonly number?: ProposalNumber;
}

/** One proposal a number addresses, which is the only kind an act can be asked of. */
export interface ChangeProposalAddress extends ChangeProposalIdentity {
  readonly number: ProposalNumber;
}

/** The proposal a number addresses, and nothing where the identity carries none. */
export function changeProposalAddressed(
  identity: ChangeProposalIdentity,
): ChangeProposalAddress | undefined {
  const number = identity.number;
  return number === undefined ? undefined : { ...identity, number };
}

export interface ChangeProposalRequest {
  readonly binding: ForgeBinding;
  /**
   * Whose project this proposal is opened for. It is no part of the proposal's
   * identity — `canonicalChangeProposalRequest` digests the claim and never
   * this — and is carried so a credential source that mints can be asked under
   * the tenant whose claim covers the repository.
   */
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly request: ChangeProposalRequestIdentity;
  readonly marker: ProposalMarker;
  readonly head: {
    readonly ref: GitRefName;
    readonly commit: GitObjectId;
  };
  readonly base: {
    readonly ref: GitRefName;
    readonly commit: GitObjectId;
  };
  readonly title: string;
  readonly body: string;
}

export type ChangeProposalStatus = "Open" | "Closed" | "Merged" | "Superseded";

/** What the forge last said about merging a proposal, `Unknown` where it said nothing this tree reads. */
export type ChangeProposalMergeability =
  "Mergeable" | "Conflicting" | "Blocked" | "Unknown";

/** Every mergeability, so a suite and a database CHECK iterate rather than restate. */
export const allChangeProposalMergeabilities: readonly ChangeProposalMergeability[] =
  ["Mergeable", "Conflicting", "Blocked", "Unknown"];

export interface ChangeProposalEvidence {
  readonly identity: ChangeProposalIdentity;
  readonly repository: RepositoryId;
  readonly marker: ProposalMarker;
  readonly head: ChangeProposalRequest["head"];
  readonly base: ChangeProposalRequest["base"];
  readonly title: string;
  readonly body: string;
  readonly status: ChangeProposalStatus;
  /** What the forge said about merging this proposal, absent where the answer it was read out of does not carry it. */
  readonly mergeability?: ChangeProposalMergeability;
  /** The forge's own word `mergeability` was read out of, absent where it said none. */
  readonly mergeState?: ProposalMergeState;
  /** The commit a merge left, carried only where the proposal is merged: a forge names one on an open proposal for the merge it would make. */
  readonly mergeCommit?: GitObjectId;
  readonly url?: ProposalDisplayUrl;
}

export type ChangeProposalContradiction =
  | "Closed"
  | "Merged"
  | "Superseded"
  | "ForgeMismatch"
  | "RepositoryMismatch"
  | "HeadMismatch"
  | "BaseMismatch"
  | "MetadataMismatch"
  | "MarkerMismatch";

/** Every contradiction, so a suite and a database CHECK iterate rather than restate. */
export const allChangeProposalContradictions: readonly ChangeProposalContradiction[] =
  [
    "Closed",
    "Merged",
    "Superseded",
    "ForgeMismatch",
    "RepositoryMismatch",
    "HeadMismatch",
    "BaseMismatch",
    "MetadataMismatch",
    "MarkerMismatch",
  ];

/** Every status a proposal stands in, so a suite and a stored row iterate rather than restate. */
export const allChangeProposalStatuses: readonly ChangeProposalStatus[] = [
  "Open",
  "Closed",
  "Merged",
  "Superseded",
];

export type ChangeProposalCreated =
  | {
      readonly created: "Created";
      readonly evidence: ChangeProposalEvidence;
    }
  | {
      readonly created: "AlreadyExists";
      readonly evidence: ChangeProposalEvidence;
    }
  | {
      readonly created: "Contradictory";
      readonly contradiction: ChangeProposalContradiction;
      readonly evidence: ChangeProposalEvidence;
    }
  | { readonly created: "Ambiguous" }
  | { readonly created: "Unavailable" }
  | { readonly created: "Denied" };

/** Every arm a create answers with, so a suite and a database CHECK iterate rather than restate. */
export const allChangeProposalCreations: readonly ChangeProposalCreated["created"][] =
  [
    "Created",
    "AlreadyExists",
    "Contradictory",
    "Ambiguous",
    "Unavailable",
    "Denied",
  ];

/** The arms a create the forge took answers with, which are the only ones that settle a row. */
export type ChangeProposalCreationAnswer = Extract<
  ChangeProposalCreated,
  { readonly evidence: ChangeProposalEvidence }
>;

/**
 * What a row says one create came to: the answer the forge gave, or that this
 * deployment could not store the evidence of it.
 */
export type ChangeProposalCreationStored =
  ChangeProposalCreationAnswer | { readonly created: "Unstorable" };

/** Every answer a create settles a row with, so a suite and a database CHECK iterate. */
export const allChangeProposalCreationAnswers: readonly ChangeProposalCreationAnswer["created"][] =
  ["Created", "AlreadyExists", "Contradictory"];

/** Every arm a row records a create as. */
export const allChangeProposalCreationsStored: readonly ChangeProposalCreationStored["created"][] =
  [...allChangeProposalCreationAnswers, "Unstorable"];

export type ChangeProposalRead =
  | { readonly read: "Found"; readonly evidence: ChangeProposalEvidence }
  | { readonly read: "Absent" }
  | { readonly read: "Unavailable" }
  | { readonly read: "Denied" };

export type ChangeProposalReconciled =
  | {
      readonly reconciled: "Accepted";
      readonly evidence: ChangeProposalEvidence;
    }
  | { readonly reconciled: "Absent" }
  | {
      readonly reconciled: "Contradictory";
      readonly contradiction: ChangeProposalContradiction;
      readonly evidence: ChangeProposalEvidence;
    }
  | { readonly reconciled: "Unavailable" }
  | { readonly reconciled: "Denied" };

/** Every arm a reconciliation answers with, so a suite and a database CHECK iterate rather than restate. */
export const allChangeProposalReconciliations: readonly ChangeProposalReconciled["reconciled"][] =
  ["Accepted", "Absent", "Contradictory", "Unavailable", "Denied"];

/** The arms a reading that reached the forge answers with, which are the only readings about a proposal. */
export type ChangeProposalReconciliationAnswer = Exclude<
  ChangeProposalReconciled,
  { readonly reconciled: "Unavailable" | "Denied" }
>;

/**
 * What a row says one reading came to: what the forge answered, or that this
 * deployment could not store the evidence of it.
 */
export type ChangeProposalReconciliationStored =
  ChangeProposalReconciliationAnswer | { readonly reconciled: "Unstorable" };

/** Every answer a reading records, so a suite and a database CHECK iterate. */
export const allChangeProposalReconciliationAnswers: readonly ChangeProposalReconciliationAnswer["reconciled"][] =
  ["Accepted", "Absent", "Contradictory"];

/** Every arm a row records a reading as. */
export const allChangeProposalReconciliationsStored: readonly ChangeProposalReconciliationStored["reconciled"][] =
  [...allChangeProposalReconciliationAnswers, "Unstorable"];

export type ChangeProposalPublicationNext =
  | { readonly next: "Create" }
  | { readonly next: "Reconcile" }
  | { readonly next: "RefuseAttempt" }
  | {
      readonly next: "Accepted";
      readonly evidence: ChangeProposalEvidence;
    }
  | {
      readonly next: "Refused";
      readonly contradiction: ChangeProposalContradiction;
      readonly evidence: ChangeProposalEvidence;
    }
  | {
      readonly next: "Held";
      readonly reason: "CreationsExhausted" | "EvidenceUnstorable";
    };

/** The provider-neutral API selected by an explicit forge binding at composition. */
export interface ChangeProposalPort {
  create(request: ChangeProposalRequest): Promise<ChangeProposalCreated>;
  readByMarker(request: ChangeProposalRequest): Promise<ChangeProposalRead>;
  readByNumber(
    request: ChangeProposalMergeRequest,
  ): Promise<ChangeProposalRead>;
  merge(request: ChangeProposalMergeRequest): Promise<ChangeProposalMerged>;
}

/** The composition boundary selects one adapter by the configured forge binding. */
export interface ChangeProposalAdapterSelector {
  select(forge: ForgeBindingId): ChangeProposalPort | undefined;
}

/**
 * Every forge a deployment opens change proposals on: which one holds a given
 * repository, and which adapter answers for it. Both are the composition's, so
 * a deployment that binds none opens none rather than failing to start.
 */
export interface ChangeProposalForges {
  readonly selector: ChangeProposalAdapterSelector;
  bindingOf(repository: RepositoryId): ForgeBinding | undefined;
}

/**
 * What one forge act is authorized for: the binding that selects the forge, and
 * the partition and repository a source that mints needs to mint under. A
 * source reading a mounted file answers from the binding alone, as it always
 * has; the other two are what an installation token is scoped by.
 */
export interface ChangeProposalCredentialRequest {
  readonly binding: ForgeBinding;
  readonly partition: Partition;
  readonly repository: RepositoryId;
}

/** Resolves proposal API authority independently of either repository credential. */
export interface ForgeCredentialPort {
  credential(
    request: ChangeProposalCredentialRequest,
  ): Promise<
    | { readonly resolved: "Credential"; readonly credential: ForgeCredential }
    | { readonly resolved: "Denied" }
    | { readonly resolved: "Unavailable" }
  >;
}

export interface ChangeProposalRequestInput {
  readonly binding: ForgeBinding;
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly request: ChangeProposalRequestIdentity;
  readonly headRef: GitRefName;
  readonly headCommit: GitObjectId;
  readonly baseRef: GitRefName;
  readonly baseCommit: GitObjectId;
  readonly title: string;
  readonly body: string;
}

/**
 * The three states one proposal stands in, and whether a row records it at all.
 * A create is in flight in exactly one of them, which is what says whether
 * another may be made, and `creations` counts the creates that may have reached
 * the forge, which is what both ceilings below are spent from.
 */
export type ChangeProposalPublication =
  | { readonly publication: "Unopened" }
  | { readonly publication: "Idle"; readonly creations: number }
  | {
      readonly publication: "Unanswered";
      readonly creations: number;
      readonly reconciliations: number;
      readonly reading: ChangeProposalReconciliationStored | undefined;
    }
  | {
      readonly publication: "Answered";
      readonly creation: ChangeProposalCreationStored;
    };

/** The states a stored row stands in, a row that is there never reading as no row. */
export type OpenedChangeProposalPublication = Exclude<
  ChangeProposalPublication,
  { readonly publication: "Unopened" }
>;

/** How many creates one request may make, and how many readings each of them is read back by. */
export interface ChangeProposalPublicationBounds {
  readonly creationsMax: number;
  readonly reconciliationsMax: number;
}

/** Bounds one request's metadata and pins the marker and head every retry must reuse. */
export function changeProposalRequest(
  input: ChangeProposalRequestInput,
): ChangeProposalRequest {
  const title = asBoundedText(
    input.title,
    "proposal title",
    proposalTitleCharsMax,
  );
  if (
    textCodePointsCount(input.body) > proposalBodyCharsMax ||
    !input.body.isWellFormed()
  )
    throw new RangeError("proposal body is not bounded text");
  return {
    binding: input.binding,
    partition: input.partition,
    repository: input.repository,
    request: input.request,
    marker: proposalMarkerOf(input.request),
    head: { ref: input.headRef, commit: input.headCommit },
    base: { ref: input.baseRef, commit: input.baseCommit },
    title,
    body: input.body,
  };
}

/**
 * What a proposal the forge has already merged is to the request that opened
 * it: the contradiction it is where the merge was somebody else's to make, and
 * the thing asked for where the request would have merged it itself.
 */
export type ChangeProposalMergedStanding = "Contradictory" | "Accepted";

/** Whether one proposal is this request's, and what it is not where it is not. */
function proposalContradiction(
  request: ChangeProposalRequest,
  evidence: ChangeProposalEvidence,
  merged: ChangeProposalMergedStanding,
): ChangeProposalContradiction | undefined {
  if (evidence.identity.forge !== request.binding.forge) return "ForgeMismatch";
  if (evidence.marker !== request.marker) return "MarkerMismatch";
  if (evidence.repository !== request.repository) return "RepositoryMismatch";
  if (evidence.head.ref !== request.head.ref) return "HeadMismatch";
  if (evidence.base.ref !== request.base.ref) return "BaseMismatch";
  if (evidence.title !== request.title || evidence.body !== request.body)
    return "MetadataMismatch";
  if (evidence.status === "Closed") return "Closed";
  if (evidence.status === "Merged")
    return merged === "Accepted" ? undefined : "Merged";
  if (evidence.status === "Superseded") return "Superseded";
  return undefined;
}

/** Verifies a marker lookup before an ambiguous create may be accepted. */
export function reconcileChangeProposal(
  request: ChangeProposalRequest,
  read: ChangeProposalRead,
  merged: ChangeProposalMergedStanding,
): ChangeProposalReconciled {
  switch (read.read) {
    case "Absent":
      return { reconciled: "Absent" };
    case "Unavailable":
      return { reconciled: "Unavailable" };
    case "Denied":
      return { reconciled: "Denied" };
    case "Found": {
      const contradiction = proposalContradiction(
        request,
        read.evidence,
        merged,
      );
      return contradiction === undefined
        ? { reconciled: "Accepted", evidence: read.evidence }
        : {
            reconciled: "Contradictory",
            contradiction,
            evidence: read.evidence,
          };
    }
  }
}

/** What evidence of a proposal settles this request to, whichever answer carried it. */
function proposalEvidenceNext(
  request: ChangeProposalRequest,
  evidence: ChangeProposalEvidence,
  merged: ChangeProposalMergedStanding,
): ChangeProposalPublicationNext {
  const contradiction = proposalContradiction(request, evidence, merged);
  return contradiction === undefined
    ? { next: "Accepted", evidence }
    : { next: "Refused", contradiction, evidence };
}

/** Refuses a bound that is not a count, which no ceiling below could then fire on. */
function proposalBoundsAsserted(bounds: ChangeProposalPublicationBounds): void {
  if (!Number.isSafeInteger(bounds.creationsMax) || bounds.creationsMax < 1)
    throw new RangeError("proposal creation bound must be positive");
  if (
    !Number.isSafeInteger(bounds.reconciliationsMax) ||
    bounds.reconciliationsMax < 1
  )
    throw new RangeError("proposal reconciliation bound must be positive");
}

/**
 * What a create nobody has heard back from authorizes. Its readings are spent
 * on it alone, so a create no reading of them found is one the forge never
 * took and the attempt it stands on is refused.
 */
function proposalUnansweredNext(
  request: ChangeProposalRequest,
  publication: Extract<
    ChangeProposalPublication,
    { readonly publication: "Unanswered" }
  >,
  bounds: ChangeProposalPublicationBounds,
  merged: ChangeProposalMergedStanding,
): ChangeProposalPublicationNext {
  if (publication.creations < 1)
    throw new RangeError("proposal publication: nothing is in flight");
  const reading = publication.reading;
  if (reading?.reconciled === "Unstorable")
    return { next: "Held", reason: "EvidenceUnstorable" };
  if (
    reading?.reconciled === "Accepted" ||
    reading?.reconciled === "Contradictory"
  )
    return proposalEvidenceNext(request, reading.evidence, merged);
  return publication.reconciliations <
    publication.creations * bounds.reconciliationsMax
    ? { next: "Reconcile" }
    : { next: "RefuseAttempt" };
}

/**
 * Continues one publication from the state its row is in. A create whose
 * outcome is unknown can only be read back; only a state with nothing in
 * flight authorizes another create, and only while the creations are unspent.
 */
export function changeProposalPublicationNext(
  request: ChangeProposalRequest,
  publication: ChangeProposalPublication,
  bounds: ChangeProposalPublicationBounds,
  merged: ChangeProposalMergedStanding,
): ChangeProposalPublicationNext {
  proposalBoundsAsserted(bounds);
  switch (publication.publication) {
    case "Unopened":
      return { next: "Create" };
    case "Idle":
      return publication.creations < bounds.creationsMax
        ? { next: "Create" }
        : { next: "Held", reason: "CreationsExhausted" };
    case "Unanswered":
      return proposalUnansweredNext(request, publication, bounds, merged);
    case "Answered":
      return publication.creation.created === "Unstorable"
        ? { next: "Held", reason: "EvidenceUnstorable" }
        : proposalEvidenceNext(request, publication.creation.evidence, merged);
    default:
      return assertNever(publication);
  }
}

/**
 * What one merge and the reading that settles it are asked under: the proposal
 * the number addresses, the marker that says it is this request's, the commit
 * the merge is conditional on, and what authorizes the act.
 */
export interface ChangeProposalMergeRequest extends ChangeProposalCredentialRequest {
  readonly proposal: ChangeProposalAddress;
  readonly marker: ProposalMarker;
  readonly headCommit: GitObjectId;
}

/**
 * Why a forge will not merge a proposal. Only a conflict settles a row: the
 * forge's own rules may lift and a refusal naming neither tells nothing apart,
 * so a reading of the proposal is what either is decided by.
 */
export type ChangeProposalUnmergeableSettled = "Conflict";
export type ChangeProposalUnmergeableReason =
  ChangeProposalUnmergeableSettled | "Blocked" | "Unknown";

/** The reasons a refusal settles a row with. */
export const allChangeProposalUnmergeableSettled: readonly ChangeProposalUnmergeableSettled[] =
  ["Conflict"];

/** Every reason a merge is refused for, so a suite and a database CHECK iterate rather than restate. */
export const allChangeProposalUnmergeableReasons: readonly ChangeProposalUnmergeableReason[] =
  [...allChangeProposalUnmergeableSettled, "Blocked", "Unknown"];

export type ChangeProposalMerged =
  | { readonly merged: "Merged"; readonly mergeCommit: GitObjectId }
  | {
      readonly merged: "NotMergeable";
      readonly reason: ChangeProposalUnmergeableReason;
    }
  | { readonly merged: "HeadMoved" }
  | { readonly merged: "Denied" }
  | { readonly merged: "Unavailable" }
  | { readonly merged: "Ambiguous" };

/** Every arm a merge answers with, so a suite and a database CHECK iterate rather than restate. */
export const allChangeProposalMerges: readonly ChangeProposalMerged["merged"][] =
  ["Merged", "NotMergeable", "HeadMoved", "Denied", "Unavailable", "Ambiguous"];

/** The arms that settle a merge, which are the only ones that settle a row. */
export type ChangeProposalMergeAnswer =
  | Extract<ChangeProposalMerged, { readonly merged: "Merged" | "HeadMoved" }>
  | {
      readonly merged: "NotMergeable";
      readonly reason: ChangeProposalUnmergeableSettled;
    };

/** Every arm a merge settles a row with, so a suite and a database CHECK iterate rather than restate. */
export const allChangeProposalMergeAnswers: readonly ChangeProposalMergeAnswer["merged"][] =
  ["Merged", "HeadMoved", "NotMergeable"];

/** The answers a merge concludes on, a moved head being one that waits on whoever moved it. */
export type ChangeProposalMergeConcluded = Exclude<
  ChangeProposalMergeAnswer,
  { readonly merged: "HeadMoved" }
>;

export type ChangeProposalMergeReconciled =
  | {
      readonly reconciled: "Accepted";
      readonly evidence: ChangeProposalEvidence;
    }
  | {
      readonly reconciled: "Unmerged";
      readonly evidence: ChangeProposalEvidence;
    }
  | {
      readonly reconciled: "Contradictory";
      readonly contradiction: ChangeProposalContradiction;
      readonly evidence: ChangeProposalEvidence;
    }
  | { readonly reconciled: "Absent" }
  | { readonly reconciled: "Unavailable" }
  | { readonly reconciled: "Denied" };

/** Every arm a merge reading answers with, so a suite and a database CHECK iterate rather than restate. */
export const allChangeProposalMergeReconciliations: readonly ChangeProposalMergeReconciled["reconciled"][] =
  ["Accepted", "Unmerged", "Contradictory", "Absent", "Unavailable", "Denied"];

/** The arms a reading that reached the forge answers with, which are the only readings about a proposal. */
export type ChangeProposalMergeReconciliationAnswer = Exclude<
  ChangeProposalMergeReconciled,
  { readonly reconciled: "Unavailable" | "Denied" }
>;

/**
 * What a row says one merge reading came to: what the forge answered, or that
 * this deployment could not store the evidence of it.
 */
export type ChangeProposalMergeReconciliationStored =
  | ChangeProposalMergeReconciliationAnswer
  | { readonly reconciled: "Unstorable" };

/** Every answer a merge reading records, so a suite and a database CHECK iterate. */
export const allChangeProposalMergeReconciliationAnswers: readonly ChangeProposalMergeReconciliationAnswer["reconciled"][] =
  ["Accepted", "Unmerged", "Contradictory", "Absent"];

/** Every arm a row records a merge reading as. */
export const allChangeProposalMergeReconciliationsStored: readonly ChangeProposalMergeReconciliationStored["reconciled"][] =
  [...allChangeProposalMergeReconciliationAnswers, "Unstorable"];

/** What a merge waiting on the forge waits on: its own rules, or a head somebody else moved. */
export type ChangeProposalMergeWait = "Blocked" | "HeadMoved";

/** Every wait, so a suite and a read iterate rather than restate. */
export const allChangeProposalMergeWaits: readonly ChangeProposalMergeWait[] = [
  "Blocked",
  "HeadMoved",
];

/**
 * The states one merge stands in, and whether a row records it at all. Only
 * `Unanswered` has a merge in flight, `merges` counts the merges that may have
 * reached the forge, which is what both ceilings below are spent from, and the
 * two waiting states carry the last reading and how many seconds before this
 * pass the forge was heard about the merge at all.
 */
export type ChangeProposalMerging =
  | { readonly merging: "Unasked" }
  | { readonly merging: "Idle"; readonly merges: number }
  | {
      readonly merging: "Unanswered";
      readonly merges: number;
      readonly readings: number;
      readonly reading: ChangeProposalMergeReconciliationStored | undefined;
    }
  | {
      readonly merging: "Waiting";
      readonly merges: number;
      readonly reading: ChangeProposalMergeReconciliationStored;
      readonly heardAgeSecs: number;
    }
  | {
      readonly merging: "Answered";
      readonly merge: ChangeProposalMergeConcluded;
    }
  | {
      readonly merging: "Moved";
      readonly reading: ChangeProposalMergeReconciliationStored | undefined;
      readonly heardAgeSecs: number;
    };

/** How many merges one request may ask for, and how many readings each of them is read back by. */
export interface ChangeProposalMergingBounds {
  readonly mergesMax: number;
  readonly readingsMax: number;
}

export type ChangeProposalMergingNext =
  | { readonly next: "Merge" }
  | { readonly next: "ReadByNumber" }
  | { readonly next: "RefuseAttempt" }
  | { readonly next: "Wait" }
  | { readonly next: "Concluded"; readonly merge: ChangeProposalMergeConcluded }
  | {
      readonly next: "Refused";
      readonly contradiction: ChangeProposalContradiction;
      readonly evidence: ChangeProposalEvidence;
    }
  | {
      readonly next: "Held";
      readonly reason:
        | "MergesExhausted"
        | "Blocked"
        | "HeadMoved"
        | "Closed"
        | "ProposalAbsent"
        | "EvidenceUnstorable";
    };

/** What a merge is offered under, before this boundary has checked it addresses one proposal. */
export interface ChangeProposalMergeInput extends Omit<
  ChangeProposalMergeRequest,
  "proposal"
> {
  readonly proposal: ChangeProposalIdentity;
}

/** Refuses a merge naming a proposal on another forge, and one no number addresses. */
export function changeProposalMergeRequest(
  input: ChangeProposalMergeInput,
): ChangeProposalMergeRequest {
  if (input.proposal.forge !== input.binding.forge)
    throw new TypeError("a merge names a proposal on another forge");
  const proposal = changeProposalAddressed(input.proposal);
  if (proposal === undefined)
    throw new TypeError("a merge names a proposal no number addresses");
  return {
    binding: input.binding,
    partition: input.partition,
    repository: input.repository,
    proposal: {
      forge: proposal.forge,
      remote: proposal.remote,
      number: asProposalNumber(proposal.number),
    },
    marker: asProposalMarker(input.marker),
    headCommit: input.headCommit,
  };
}

/**
 * Verifies a reading of the proposal a merge was asked of. The status the
 * create's reconciliation calls a contradiction is what this one is waiting
 * for, and every other contradiction is one here too.
 */
export function reconcileChangeProposalMerge(
  request: ChangeProposalRequest,
  read: ChangeProposalRead,
): ChangeProposalMergeReconciled {
  switch (read.read) {
    case "Absent":
      return { reconciled: "Absent" };
    case "Unavailable":
      return { reconciled: "Unavailable" };
    case "Denied":
      return { reconciled: "Denied" };
    case "Found": {
      const evidence = read.evidence;
      const contradiction = proposalContradiction(
        request,
        evidence,
        "Contradictory",
      );
      if (contradiction === undefined)
        return { reconciled: "Unmerged", evidence };
      if (contradiction !== "Merged")
        return { reconciled: "Contradictory", contradiction, evidence };
      return evidence.mergeCommit === undefined
        ? { reconciled: "Unavailable" }
        : { reconciled: "Accepted", evidence };
    }
  }
}

/** Refuses a bound that is not a count, which no ceiling below could then fire on. */
function proposalMergingBoundsAsserted(
  bounds: ChangeProposalMergingBounds,
): void {
  if (!Number.isSafeInteger(bounds.mergesMax) || bounds.mergesMax < 1)
    throw new RangeError("proposal merge bound must be positive");
  if (!Number.isSafeInteger(bounds.readingsMax) || bounds.readingsMax < 1)
    throw new RangeError("proposal merge reading bound must be positive");
}

/**
 * What one stored reading says of the proposal a merge was asked of: what it
 * settles the merge to, whoever merged or closed it; what the forge said of
 * merging a proposal it found open; and nothing where it was read as merged at
 * no commit.
 */
type ProposalMergeRead =
  | { readonly read: "Settled"; readonly next: ChangeProposalMergingNext }
  | {
      readonly read: "Open";
      readonly mergeability: ChangeProposalMergeability | undefined;
    }
  | { readonly read: "Unsettled" };

/** Rebinds one stored reading to the current request, which is the only request it is ever compared against. */
function proposalMergeRead(
  request: ChangeProposalRequest,
  reading: ChangeProposalMergeReconciliationStored | undefined,
): ProposalMergeRead {
  if (reading === undefined) return { read: "Unsettled" };
  if (reading.reconciled === "Unstorable")
    return {
      read: "Settled",
      next: { next: "Held", reason: "EvidenceUnstorable" },
    };
  if (reading.reconciled === "Absent")
    return {
      read: "Settled",
      next: { next: "Held", reason: "ProposalAbsent" },
    };
  const evidence = reading.evidence;
  const contradiction = proposalContradiction(
    request,
    evidence,
    "Contradictory",
  );
  switch (contradiction) {
    case undefined:
      return { read: "Open", mergeability: evidence.mergeability };
    case "Merged":
      return evidence.mergeCommit === undefined
        ? { read: "Unsettled" }
        : {
            read: "Settled",
            next: {
              next: "Concluded",
              merge: { merged: "Merged", mergeCommit: evidence.mergeCommit },
            },
          };
    case "Closed":
      return { read: "Settled", next: { next: "Held", reason: "Closed" } };
    case "Superseded":
    case "ForgeMismatch":
    case "RepositoryMismatch":
    case "HeadMismatch":
    case "BaseMismatch":
    case "MetadataMismatch":
    case "MarkerMismatch":
      return {
        read: "Settled",
        next: { next: "Refused", contradiction, evidence },
      };
    default:
      return assertNever(contradiction);
  }
}

/** The conflict a reading of an open proposal settles the merge to, which only the forge's word for it does. */
const proposalMergeConflicted: ChangeProposalMergingNext = {
  next: "Concluded",
  merge: { merged: "NotMergeable", reason: "Conflict" },
};

/**
 * What a merge nobody has heard the fate of authorizes. Its readings are spent
 * on it alone, so a merge none of them found landed is one the forge never made
 * and the attempt it stands on is released, while one a reading found blocked
 * is released to wait on the forge and one ruled out of the number it addressed
 * merges nothing again.
 */
function proposalMergeUnansweredNext(
  request: ChangeProposalRequest,
  merging: Extract<ChangeProposalMerging, { readonly merging: "Unanswered" }>,
  bounds: ChangeProposalMergingBounds,
): ChangeProposalMergingNext {
  if (merging.merges < 1)
    throw new RangeError("proposal merging: nothing is in flight");
  const read = proposalMergeRead(request, merging.reading);
  if (read.read === "Settled") return read.next;
  if (read.read === "Open" && read.mergeability === "Conflicting")
    return proposalMergeConflicted;
  if (read.read === "Open" && read.mergeability === "Blocked")
    return { next: "Wait" };
  return merging.readings < merging.merges * bounds.readingsMax
    ? { next: "ReadByNumber" }
    : { next: "RefuseAttempt" };
}

/** Whether the forge was last heard about a waiting merge long enough ago to be asked again. */
function proposalMergeRereadDue(heardAgeSecs: number): boolean {
  if (!Number.isSafeInteger(heardAgeSecs))
    throw new RangeError(
      "proposal merging: a wait's age is not a count of seconds",
    );
  return heardAgeSecs >= proposalMergeRereadSecs;
}

/**
 * What a merge the forge's own rules refused authorizes: another merge only
 * once a reading finds the proposal mergeable and while the merges are unspent,
 * and otherwise a reading on the cadence the forge is asked again at.
 */
function proposalMergeWaitingNext(
  request: ChangeProposalRequest,
  merging: Extract<ChangeProposalMerging, { readonly merging: "Waiting" }>,
  bounds: ChangeProposalMergingBounds,
): ChangeProposalMergingNext {
  if (merging.merges < 1)
    throw new RangeError("proposal merging: nothing was refused to wait on");
  const read = proposalMergeRead(request, merging.reading);
  if (read.read === "Settled") return read.next;
  if (read.read === "Open" && read.mergeability === "Conflicting")
    return proposalMergeConflicted;
  if (read.read === "Open" && read.mergeability === "Mergeable")
    return merging.merges < bounds.mergesMax
      ? { next: "Merge" }
      : { next: "Held", reason: "MergesExhausted" };
  return proposalMergeRereadDue(merging.heardAgeSecs)
    ? { next: "ReadByNumber" }
    : { next: "Held", reason: "Blocked" };
}

/**
 * What a merge the forge answered had moved head authorizes. The commit the
 * permit landed is the only one this request ever asked to have merged, so it
 * is never merged again and waits on whoever moved it to merge or close it.
 */
function proposalMergeMovedNext(
  request: ChangeProposalRequest,
  merging: Extract<ChangeProposalMerging, { readonly merging: "Moved" }>,
): ChangeProposalMergingNext {
  const read = proposalMergeRead(request, merging.reading);
  if (read.read === "Settled") return read.next;
  return proposalMergeRereadDue(merging.heardAgeSecs)
    ? { next: "ReadByNumber" }
    : { next: "Held", reason: "HeadMoved" };
}

/**
 * Continues one merging from the state its row is in. A merge whose outcome is
 * unknown can only be read back; only a state with nothing in flight authorizes
 * another merge, and only while the merges are unspent.
 */
export function changeProposalMergeNext(
  request: ChangeProposalRequest,
  merging: ChangeProposalMerging,
  bounds: ChangeProposalMergingBounds,
): ChangeProposalMergingNext {
  proposalMergingBoundsAsserted(bounds);
  switch (merging.merging) {
    case "Unasked":
      return { next: "Merge" };
    case "Idle":
      return merging.merges < bounds.mergesMax
        ? { next: "Merge" }
        : { next: "Held", reason: "MergesExhausted" };
    case "Unanswered":
      return proposalMergeUnansweredNext(request, merging, bounds);
    case "Waiting":
      return proposalMergeWaitingNext(request, merging, bounds);
    case "Answered":
      return { next: "Concluded", merge: merging.merge };
    case "Moved":
      return proposalMergeMovedNext(request, merging);
    default:
      return assertNever(merging);
  }
}
