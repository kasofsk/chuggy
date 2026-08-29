/**
 * The provider-neutral change proposal: the deterministic request one is opened
 * under, the evidence a forge answers with, and the bounded publication that
 * turns an unsettled create into an answer.
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
 */

import { assertNever } from "../domain/assertNever.ts";
import { asBoundedText } from "./boundedText.ts";
import type { GitObjectId, GitRefName, RepositoryId } from "./finalizer.ts";
import { finalizerIdentityCharsMax } from "./finalizer.ts";
declare const forgeBindingIdBrand: unique symbol;
declare const proposalRemoteIdentityBrand: unique symbol;
declare const proposalMarkerBrand: unique symbol;
declare const forgeCredentialBrand: unique symbol;
declare const proposalDisplayUrlBrand: unique symbol;
declare const changeProposalRequestIdentityBrand: unique symbol;
declare const forgeCredentialReferenceBrand: unique symbol;

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

export const proposalTitleCharsMax = 256;
export const proposalBodyCharsMax = 16_384;
export const proposalMarkerCharsMax = 128;
export const proposalDisplayUrlCharsMax = 2_048;

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

export function asForgeCredential(value: string): ForgeCredential {
  return asBoundedText(
    value,
    "forge credential",
    finalizerIdentityCharsMax,
  ) as ForgeCredential;
}

export function asProposalDisplayUrl(value: string): ProposalDisplayUrl {
  return asBoundedText(
    value,
    "proposal display URL",
    proposalDisplayUrlCharsMax,
  ) as ProposalDisplayUrl;
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

export interface ChangeProposalIdentity {
  readonly forge: ForgeBindingId;
  readonly remote: ProposalRemoteIdentity;
}

export interface ChangeProposalRequest {
  readonly binding: ForgeBinding;
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

export interface ChangeProposalEvidence {
  readonly identity: ChangeProposalIdentity;
  readonly repository: RepositoryId;
  readonly marker: ProposalMarker;
  readonly head: ChangeProposalRequest["head"];
  readonly base: ChangeProposalRequest["base"];
  readonly title: string;
  readonly body: string;
  readonly status: ChangeProposalStatus;
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

/** Resolves proposal API authority independently of either repository credential. */
export interface ForgeCredentialPort {
  credential(
    binding: ForgeBinding,
  ): Promise<
    | { readonly resolved: "Credential"; readonly credential: ForgeCredential }
    | { readonly resolved: "Denied" }
    | { readonly resolved: "Unavailable" }
  >;
}

export interface ChangeProposalRequestInput {
  readonly binding: ForgeBinding;
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
  if (input.body.length > proposalBodyCharsMax || !input.body.isWellFormed())
    throw new RangeError("proposal body is not bounded text");
  return {
    binding: input.binding,
    repository: input.repository,
    request: input.request,
    marker: proposalMarkerOf(input.request),
    head: { ref: input.headRef, commit: input.headCommit },
    base: { ref: input.baseRef, commit: input.baseCommit },
    title,
    body: input.body,
  };
}

/** Whether one proposal is this request's, and what it is not where it is not. */
function proposalContradiction(
  request: ChangeProposalRequest,
  evidence: ChangeProposalEvidence,
): ChangeProposalContradiction | undefined {
  if (evidence.identity.forge !== request.binding.forge) return "ForgeMismatch";
  if (evidence.marker !== request.marker) return "MarkerMismatch";
  if (evidence.repository !== request.repository) return "RepositoryMismatch";
  if (evidence.head.ref !== request.head.ref) return "HeadMismatch";
  if (evidence.base.ref !== request.base.ref) return "BaseMismatch";
  if (evidence.title !== request.title || evidence.body !== request.body)
    return "MetadataMismatch";
  if (evidence.status === "Closed") return "Closed";
  if (evidence.status === "Merged") return "Merged";
  if (evidence.status === "Superseded") return "Superseded";
  return undefined;
}

/** Verifies a marker lookup before an ambiguous create may be accepted. */
export function reconcileChangeProposal(
  request: ChangeProposalRequest,
  read: ChangeProposalRead,
): ChangeProposalReconciled {
  switch (read.read) {
    case "Absent":
      return { reconciled: "Absent" };
    case "Unavailable":
      return { reconciled: "Unavailable" };
    case "Denied":
      return { reconciled: "Denied" };
    case "Found": {
      const contradiction = proposalContradiction(request, read.evidence);
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
): ChangeProposalPublicationNext {
  const contradiction = proposalContradiction(request, evidence);
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
    return proposalEvidenceNext(request, reading.evidence);
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
      return proposalUnansweredNext(request, publication, bounds);
    case "Answered":
      return publication.creation.created === "Unstorable"
        ? { next: "Held", reason: "EvidenceUnstorable" }
        : proposalEvidenceNext(request, publication.creation.evidence);
    default:
      return assertNever(publication);
  }
}
