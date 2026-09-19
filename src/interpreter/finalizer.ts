import type { TicketId } from "../domain/ids.ts";
import { asBoundedText } from "./boundedText.ts";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";

declare const commitPermitIdBrand: unique symbol;
declare const inputBundleIdBrand: unique symbol;
declare const repositoryIdBrand: unique symbol;
declare const finalizerOwnerIdBrand: unique symbol;
declare const gitRefNameBrand: unique symbol;
declare const gitObjectIdBrand: unique symbol;
declare const repositoryCredentialBrand: unique symbol;

export type CommitPermitId = string & { readonly [commitPermitIdBrand]: true };
export type InputBundleId = string & { readonly [inputBundleIdBrand]: true };
export type RepositoryId = string & { readonly [repositoryIdBrand]: true };
export type FinalizerOwnerId = string & {
  readonly [finalizerOwnerIdBrand]: true;
};
export type GitRefName = string & { readonly [gitRefNameBrand]: true };
export type GitObjectId = string & { readonly [gitObjectIdBrand]: true };
export type RepositoryCredential = string & {
  readonly [repositoryCredentialBrand]: true;
};

export const finalizerIdentityCharsMax = 256;
export const repositoryCredentialCharsMax = 4_096;
export const gitRefNameCharsMax = 256;
export const allGitObjectIdChars: readonly number[] = [40, 64];
export const conflictPathsMax = 256;
export const candidateFilesMax = 1_024;
export const candidateBytesMax = 64 * 1024 * 1024;
export const candidateExecutionsMax = 256;

export function gitObjectIdPattern(): string {
  return `^(${allGitObjectIdChars.map((chars) => `[0-9a-f]{${String(chars)}}`).join("|")})$`;
}

export function asCommitPermitId(value: string): CommitPermitId {
  return asBoundedText(
    value,
    "commit permit",
    finalizerIdentityCharsMax,
  ) as CommitPermitId;
}

export function asInputBundleId(value: string): InputBundleId {
  return asBoundedText(
    value,
    "input bundle",
    finalizerIdentityCharsMax,
  ) as InputBundleId;
}

export function asRepositoryId(value: string): RepositoryId {
  return asBoundedText(
    value,
    "repository",
    finalizerIdentityCharsMax,
  ) as RepositoryId;
}

export function asFinalizerOwnerId(value: string): FinalizerOwnerId {
  return asBoundedText(
    value,
    "finalizer owner",
    finalizerIdentityCharsMax,
  ) as FinalizerOwnerId;
}

export function asGitRefName(value: string): GitRefName {
  return asBoundedText(value, "ref name", gitRefNameCharsMax) as GitRefName;
}

export function asGitObjectId(value: string): GitObjectId {
  if (!new RegExp(gitObjectIdPattern(), "u").test(value))
    throw new RangeError(
      `object id: ${String(value.length)} characters is not a width git addresses an object at`,
    );
  return value as GitObjectId;
}

export function asRepositoryCredential(value: string): RepositoryCredential {
  return asBoundedText(
    value,
    "repository credential",
    repositoryCredentialCharsMax,
  ) as RepositoryCredential;
}

export type InputBundleReferenceKind =
  | "Configuration"
  | "FinalizationAttempt"
  | "Repository"
  | "TargetCommit"
  | "WorkResult";
export interface InputBundleReference {
  readonly kind: InputBundleReferenceKind;
  readonly reference: string;
  readonly digest?: string;
}
export interface InputBundle {
  readonly bundle: InputBundleId;
  readonly digest: string;
  readonly references: readonly InputBundleReference[];
}

export type GitEvidence =
  | "RemoteUnreachable"
  | "RemoteDenied"
  | "RefUnreadable"
  | "ObjectMissing"
  | "IntegrationFailed"
  | "PromotionTimedOut";

export interface RepositoryBinding {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly targetRef?: GitRefName;
  readonly credentialReference?: string;
}

export function repositoryBindingNarrowed(
  binding: RepositoryBinding,
  ref: GitRefName | undefined,
): RepositoryBinding {
  return ref === undefined ? binding : { ...binding, targetRef: ref };
}

export function repositoryBindingWidened(
  binding: RepositoryBinding,
): RepositoryBinding {
  const { targetRef, ...widened } = binding;
  return targetRef === undefined ? binding : widened;
}

export interface ObservedTarget {
  readonly ref: GitRefName;
  readonly commit: GitObjectId;
  readonly baseRef?: GitRefName;
}

export type TargetObserved =
  | { readonly observed: "Target"; readonly target: ObservedTarget }
  | { readonly observed: "Unreadable"; readonly evidence: GitEvidence };

export interface CandidateFile {
  readonly path: string;
  readonly content: Uint8Array;
}
export interface CandidatePreparation {
  readonly repository: RepositoryBinding;
  readonly ticket: TicketId;
  readonly bundle: InputBundleId;
  readonly base: ObservedTarget;
  readonly files: readonly CandidateFile[];
}
export interface CandidateSourcePreparation {
  readonly repository: RepositoryBinding;
  readonly ref: GitRefName;
  readonly commit: GitObjectId;
  readonly base: GitObjectId;
}
export type CandidatePrepared =
  | { readonly prepared: "Candidate"; readonly candidate: GitObjectId }
  | { readonly prepared: "Failed"; readonly evidence: GitEvidence };
export type IntegrationStrategy = "Merge";
export interface CandidateIntegration {
  readonly repository: RepositoryBinding;
  readonly target: ObservedTarget;
  readonly candidate: GitObjectId;
  readonly strategy: IntegrationStrategy;
}
export interface ConflictSummary {
  readonly paths: readonly string[];
  readonly truncated: boolean;
}
export type CandidateIntegrated =
  | { readonly integrated: "Candidate"; readonly candidate: GitObjectId }
  | {
      readonly integrated: "Conflicted";
      readonly conflict: ConflictSummary;
      readonly base?: GitObjectId;
    }
  | { readonly integrated: "Failed"; readonly evidence: GitEvidence };
export interface CandidatePromotion {
  readonly repository: RepositoryBinding;
  readonly permit: CommitPermitId;
  readonly target: ObservedTarget;
  readonly candidate: GitObjectId;
}
export type CandidatePromoted =
  | { readonly promoted: "Advanced" }
  | { readonly promoted: "Rejected"; readonly observed: GitObjectId }
  | { readonly promoted: "Ambiguous"; readonly evidence: GitEvidence };
export interface AncestryProof {
  readonly repository: RepositoryBinding;
  readonly ref: GitRefName;
  readonly candidate: GitObjectId;
}
export type AncestryProved =
  | { readonly proved: "Ancestor"; readonly observed: GitObjectId }
  | { readonly proved: "NotAncestor"; readonly observed: GitObjectId }
  | { readonly proved: "Unreadable"; readonly evidence: GitEvidence };

export interface GitPromotionPort {
  observeTarget(repository: RepositoryBinding): Promise<TargetObserved>;
  prepareCandidate(
    preparation: CandidatePreparation,
  ): Promise<CandidatePrepared>;
  prepareSource(
    preparation: CandidateSourcePreparation,
  ): Promise<CandidatePrepared>;
  integrateCandidate(
    integration: CandidateIntegration,
  ): Promise<CandidateIntegrated>;
  promoteCandidate(promotion: CandidatePromotion): Promise<CandidatePromoted>;
  proveCandidateAncestry(proof: AncestryProof): Promise<AncestryProved>;
}

export async function repositoryTargetObserved(
  git: Pick<GitPromotionPort, "observeTarget">,
  binding: RepositoryBinding,
  branch: GitRefName | undefined,
): Promise<TargetObserved> {
  const observed = await git.observeTarget(
    repositoryBindingNarrowed(binding, branch),
  );
  if (branch === undefined || observed.observed === "Target") return observed;
  if (observed.evidence !== "RefUnreadable") return observed;
  const base = await git.observeTarget(binding);
  return base.observed === "Target"
    ? {
        observed: "Target",
        target: {
          ref: branch,
          commit: base.target.commit,
          baseRef: base.target.ref,
        },
      }
    : base;
}

export type CredentialResolved =
  | {
      readonly resolved: "Credential";
      readonly credential: RepositoryCredential;
    }
  | { readonly resolved: "Denied" }
  | { readonly resolved: "Unavailable" };

export interface RepositoryCredentialPort {
  credential(repository: RepositoryBinding): Promise<CredentialResolved>;
}
