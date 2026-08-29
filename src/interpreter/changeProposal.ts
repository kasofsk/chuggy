/**
 * The provider-neutral change proposal: the deterministic request one is opened
 * under, the evidence a forge answers with, and the bounded publication that
 * turns an unsettled create into an answer.
 *
 * A HEAD IS EITHER DERIVED OR NAMED, AND THE REST OF THE REQUEST IS THE SAME
 * EITHER WAY. A handoff has no branch of its own, so its head is minted from
 * the request identity; a ticket finishing by proposing its own work has one
 * already, and the commit a person will review is the one its promotion landed
 * there. Both are built through one bounding, so the two cannot drift apart in
 * the marker, the metadata or anything else a read compares.
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
 */

import { asBoundedText } from "./boundedText.ts";
import type { GitObjectId, GitRefName, RepositoryId } from "./finalizer.ts";
import { asGitRefName, finalizerIdentityCharsMax } from "./finalizer.ts";
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

/** The most one proposal's evidence is stored at: its own fields, and the encoding around them. */
export const proposalEvidenceCharsMax = 32_768;
export const proposalBranchPrefix = "refs/heads/chuggy/handoff/";
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

export function proposalMarkerOf(
  request: ChangeProposalRequestIdentity,
): ProposalMarker {
  const marker = `chuggy-handoff:${request}`;
  return asBoundedText(
    marker,
    "proposal marker",
    proposalMarkerCharsMax,
  ) as ProposalMarker;
}

export function proposalHeadRefOf(
  request: ChangeProposalRequestIdentity,
): GitRefName {
  return asGitRefName(`${proposalBranchPrefix}${request}`);
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

export type ChangeProposalPublicationNext =
  | { readonly next: "Create" }
  | { readonly next: "Reconcile" }
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
      readonly reason: "Unavailable" | "Denied" | "ReconciliationExhausted";
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
  readonly headCommit: GitObjectId;
  readonly baseRef: GitRefName;
  readonly baseCommit: GitObjectId;
  readonly title: string;
  readonly body: string;
}

/** The same request over a head branch the caller names rather than one derived from the identity. */
export interface ChangeProposalBranchRequestInput extends ChangeProposalRequestInput {
  readonly headRef: GitRefName;
}

export interface ChangeProposalPublicationView {
  readonly creation?: ChangeProposalCreated;
  readonly reconciliation?: ChangeProposalReconciled;
  readonly reconciliations: number;
}

/** Bounds one request's metadata and pins it to the head every retry must reuse. */
function changeProposalRequestOf(
  input: ChangeProposalRequestInput,
  headRef: GitRefName,
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
    head: { ref: headRef, commit: input.headCommit },
    base: { ref: input.baseRef, commit: input.baseCommit },
    title,
    body: input.body,
  };
}

/** Constructs the single marker and branch identity every retry must reuse. */
export function changeProposalRequest(
  input: ChangeProposalRequestInput,
): ChangeProposalRequest {
  return changeProposalRequestOf(input, proposalHeadRefOf(input.request));
}

/** The same request over a branch the work already happened on, named rather than minted. */
export function changeProposalRequestFromBranch(
  input: ChangeProposalBranchRequestInput,
): ChangeProposalRequest {
  return changeProposalRequestOf(input, input.headRef);
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

function proposalAcceptedNext(
  request: ChangeProposalRequest,
  evidence: ChangeProposalEvidence,
): ChangeProposalPublicationNext {
  const reconciled = reconcileChangeProposal(request, {
    read: "Found",
    evidence,
  });
  return reconciled.reconciled === "Accepted"
    ? { next: "Accepted", evidence: reconciled.evidence }
    : reconciled.reconciled === "Contradictory"
      ? {
          next: "Refused",
          contradiction: reconciled.contradiction,
          evidence: reconciled.evidence,
        }
      : { next: "Held", reason: "Unavailable" };
}

/**
 * Continues one recorded create. An ambiguous create can only be read back;
 * redelivery never authorizes a second create.
 */
export function changeProposalPublicationNext(
  request: ChangeProposalRequest,
  view: ChangeProposalPublicationView,
  reconciliationsMax: number,
): ChangeProposalPublicationNext {
  if (!Number.isSafeInteger(reconciliationsMax) || reconciliationsMax < 1)
    throw new RangeError("proposal reconciliation bound must be positive");
  if (view.creation === undefined) return { next: "Create" };
  switch (view.creation.created) {
    case "Created":
    case "AlreadyExists":
    case "Contradictory":
      return proposalAcceptedNext(request, view.creation.evidence);
    case "Unavailable":
      return { next: "Held", reason: "Unavailable" };
    case "Denied":
      return { next: "Held", reason: "Denied" };
    case "Ambiguous":
      break;
  }
  const reconciled = view.reconciliation;
  if (
    reconciled?.reconciled === "Accepted" ||
    reconciled?.reconciled === "Contradictory"
  )
    return proposalAcceptedNext(request, reconciled.evidence);
  if (reconciled?.reconciled === "Denied")
    return { next: "Held", reason: "Denied" };
  return view.reconciliations < reconciliationsMax
    ? { next: "Reconcile" }
    : { next: "Held", reason: "ReconciliationExhausted" };
}
