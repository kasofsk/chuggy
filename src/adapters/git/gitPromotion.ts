/**
 * The adapter behind `GitPromotionPort`: the remote reads a preparation pins,
 * the one conditional ref update a permit authorizes, and the ancestry proof
 * that says what the ref holds.
 *
 * A PROMOTION MAY BE AMBIGUOUS AND THAT IS AN ANSWER. The push either advanced
 * the ref, or was refused because the candidate was not a fast-forward of what
 * the remote holds — information rather than failure — or stopped without
 * saying which. A stopped push is `Ambiguous` even where nothing could plausibly
 * have been sent, because collapsing it into a refusal would let a candidate be
 * promoted twice, and the repository is the only authority that can settle it.
 *
 * REFUSAL IS THE RECEIVING REPOSITORY'S AND IS NEVER FORCED. The refspec is
 * plain, so a target that moved after it was observed refuses the update by
 * itself; forcing it, with or without a lease, would put the decision here,
 * where the observation is already stale.
 *
 * A CREDENTIAL IS RESOLVED PER ACT AND NEVER HELD. The port answers it, the
 * composition root answers the port, and a denial and an outage are kept apart
 * all the way into the evidence a caller records.
 *
 * NOTHING HERE READS OR WRITES A DATABASE. The durable state this serves is
 * another adapter's, which is what makes it structural rather than careful that
 * no git call happens inside a project decision transaction.
 */

import { assertNever } from "../../domain/assertNever.ts";
import type {
  AncestryProof,
  AncestryProved,
  CandidateIntegrated,
  CandidateIntegration,
  CandidatePrepared,
  CandidatePreparation,
  CandidateSourcePreparation,
  CandidatePromoted,
  CandidatePromotion,
  GitEvidence,
  GitPromotionPort,
  RepositoryBinding,
  RepositoryCredential,
  RepositoryCredentialPort,
  TargetObserved,
} from "../../interpreter/finalizer.ts";
import { candidateIntegrate, candidatePrepare } from "./gitCandidate.ts";
import {
  scratchFetchRef,
  scratchHasCommit,
  scratchIsAncestor,
  scratchObserveHead,
  scratchPush,
  scratchReadRef,
  scratchOpen,
  type GitCommitIdentity,
  type GitScratch,
} from "./gitScratch.ts";
import type { GitEnvironment } from "./gitRun.ts";

/** Everything the adapter is composed with, the credential port among them because nothing here reads an environment. */
export interface GitPromotionOptions {
  readonly scratchDirectory: string;
  readonly identity: GitCommitIdentity;
  readonly environment: GitEnvironment;
  readonly credentials: RepositoryCredentialPort;
  readonly credentialUsername?: string;
  readonly localTimeoutSecsMax?: number;
  readonly remoteTimeoutSecsMax?: number;
  readonly promotionTimeoutSecsMax?: number;
}

/** The bounds and the user a deployment gets when it names none. */
export const gitPromotionDefaults = {
  credentialUsername: "chuggy",
  localTimeoutSecsMax: 60,
  remoteTimeoutSecsMax: 300,
  promotionTimeoutSecsMax: 300,
} as const;

/** What the adapter holds across acts: its scratch, and the port its credentials come from. */
interface GitPromotionState {
  readonly scratch: GitScratch;
  readonly credentials: RepositoryCredentialPort;
}

/** Whether one act is authorized, a denial kept apart from an outage all the way into the evidence. */
type GitPromotionAuthorized =
  | {
      readonly authorized: "Credential";
      readonly credential: RepositoryCredential;
    }
  | { readonly authorized: "Refused"; readonly evidence: GitEvidence };

/** Resolves what authorizes one remote act, which is never stored and never folded into anything. */
async function gitPromotionCredentialOf(
  own: GitPromotionState,
  repository: RepositoryBinding,
): Promise<GitPromotionAuthorized> {
  const resolved = await own.credentials.credential(repository);
  switch (resolved.resolved) {
    case "Credential":
      return { authorized: "Credential", credential: resolved.credential };
    case "Denied":
      return { authorized: "Refused", evidence: "RemoteDenied" };
    case "Unavailable":
      return { authorized: "Refused", evidence: "RemoteUnreachable" };
    default:
      return assertNever(resolved);
  }
}

/** Re-reads the remote's default branch, which every preparation pins and none remembers. */
async function gitPromotionObserve(
  own: GitPromotionState,
  repository: RepositoryBinding,
): Promise<TargetObserved> {
  const authorized = await gitPromotionCredentialOf(own, repository);
  if (authorized.authorized === "Refused") {
    return { observed: "Unreadable", evidence: authorized.evidence };
  }
  if (repository.targetRef !== undefined) {
    const read = await scratchReadRef(
      own.scratch,
      repository.repository,
      authorized.credential,
      repository.targetRef,
    );
    switch (read.read) {
      case "Value":
        return {
          observed: "Target",
          target: { ref: repository.targetRef, commit: read.value },
        };
      case "Absent":
        return { observed: "Unreadable", evidence: "RefUnreadable" };
      case "Unreachable":
        return { observed: "Unreadable", evidence: "RemoteUnreachable" };
      default:
        return assertNever(read);
    }
  }
  const read = await scratchObserveHead(
    own.scratch,
    repository.repository,
    authorized.credential,
  );
  switch (read.read) {
    case "Value":
      return { observed: "Target", target: read.value };
    case "Absent":
      return { observed: "Unreadable", evidence: "RefUnreadable" };
    case "Unreachable":
      return { observed: "Unreadable", evidence: "RemoteUnreachable" };
    default:
      return assertNever(read);
  }
}

/** Builds the candidate for one preparation against the target it pinned. */
async function gitPromotionPrepare(
  own: GitPromotionState,
  preparation: CandidatePreparation,
): Promise<CandidatePrepared> {
  const authorized = await gitPromotionCredentialOf(
    own,
    preparation.repository,
  );
  if (authorized.authorized === "Refused") {
    return { prepared: "Failed", evidence: authorized.evidence };
  }
  return candidatePrepare(own.scratch, authorized.credential, preparation);
}

/** Imports a worker candidate only where the remote ref, commit and base agree. */
async function gitPromotionPrepareSource(
  own: GitPromotionState,
  preparation: CandidateSourcePreparation,
): Promise<CandidatePrepared> {
  const authorized = await gitPromotionCredentialOf(
    own,
    preparation.repository,
  );
  if (authorized.authorized === "Refused") {
    return { prepared: "Failed", evidence: authorized.evidence };
  }
  const repository = preparation.repository.repository;
  const observed = await scratchReadRef(
    own.scratch,
    repository,
    authorized.credential,
    preparation.ref,
  );
  if (observed.read === "Unreachable") {
    return { prepared: "Failed", evidence: "RemoteUnreachable" };
  }
  if (observed.read !== "Value") {
    return { prepared: "Failed", evidence: "RefUnreadable" };
  }
  if (observed.value !== preparation.commit) {
    return { prepared: "Failed", evidence: "ObjectMissing" };
  }
  if (
    !(await scratchFetchRef(
      own.scratch,
      repository,
      authorized.credential,
      preparation.ref,
    )) ||
    !(await scratchHasCommit(own.scratch, repository, preparation.commit))
  ) {
    return { prepared: "Failed", evidence: "ObjectMissing" };
  }
  const descends = await scratchIsAncestor(
    own.scratch,
    repository,
    preparation.base,
    preparation.commit,
  );
  return descends === true
    ? { prepared: "Candidate", candidate: preparation.commit }
    : { prepared: "Failed", evidence: "ObjectMissing" };
}

/** Integrates one candidate against one observed target. */
async function gitPromotionIntegrate(
  own: GitPromotionState,
  integration: CandidateIntegration,
): Promise<CandidateIntegrated> {
  const authorized = await gitPromotionCredentialOf(
    own,
    integration.repository,
  );
  if (authorized.authorized === "Refused") {
    return { integrated: "Failed", evidence: authorized.evidence };
  }
  return candidateIntegrate(own.scratch, authorized.credential, integration);
}

/** What the remote holds now, which is the read that turns a refusal into information. */
async function gitPromotionRefusedBy(
  own: GitPromotionState,
  promotion: CandidatePromotion,
  credential: RepositoryCredential,
): Promise<CandidatePromoted> {
  const read = await scratchReadRef(
    own.scratch,
    promotion.repository.repository,
    credential,
    promotion.target.ref,
  );
  switch (read.read) {
    case "Value":
      return { promoted: "Rejected", observed: read.value };
    case "Absent":
    case "Unreachable":
      return { promoted: "Ambiguous", evidence: "RefUnreadable" };
    default:
      return assertNever(read);
  }
}

/** Advances the target ref to the candidate, conditionally on the target the candidate was built over. */
async function gitPromotionPromote(
  own: GitPromotionState,
  promotion: CandidatePromotion,
): Promise<CandidatePromoted> {
  const authorized = await gitPromotionCredentialOf(own, promotion.repository);
  if (authorized.authorized === "Refused") {
    return { promoted: "Ambiguous", evidence: authorized.evidence };
  }
  const repository = promotion.repository.repository;
  if (!(await scratchHasCommit(own.scratch, repository, promotion.candidate))) {
    return { promoted: "Ambiguous", evidence: "ObjectMissing" };
  }
  const pushed = await scratchPush(
    own.scratch,
    repository,
    authorized.credential,
    promotion.candidate,
    promotion.target.ref,
  );
  switch (pushed.pushed) {
    case "Advanced":
      return { promoted: "Advanced" };
    case "Refused":
      return gitPromotionRefusedBy(own, promotion, authorized.credential);
    case "TimedOut":
      return { promoted: "Ambiguous", evidence: "PromotionTimedOut" };
    case "Unknown":
      return { promoted: "Ambiguous", evidence: "RemoteUnreachable" };
    default:
      return assertNever(pushed);
  }
}

/** Reads what the target ref proves about the immutable candidate identity. */
async function gitPromotionProve(
  own: GitPromotionState,
  proof: AncestryProof,
): Promise<AncestryProved> {
  const authorized = await gitPromotionCredentialOf(own, proof.repository);
  if (authorized.authorized === "Refused") {
    return { proved: "Unreadable", evidence: authorized.evidence };
  }
  const repository = proof.repository.repository;
  const credential = authorized.credential;
  const read = await scratchReadRef(
    own.scratch,
    repository,
    credential,
    proof.ref,
  );
  if (read.read === "Absent") {
    return { proved: "Unreadable", evidence: "RefUnreadable" };
  }
  if (read.read === "Unreachable") {
    return { proved: "Unreadable", evidence: "RemoteUnreachable" };
  }
  const observed = read.value;
  if (
    !(await scratchFetchRef(own.scratch, repository, credential, proof.ref))
  ) {
    return { proved: "Unreadable", evidence: "RemoteUnreachable" };
  }
  const held =
    (await scratchHasCommit(own.scratch, repository, observed)) &&
    (await scratchHasCommit(own.scratch, repository, proof.candidate));
  if (!held) return { proved: "Unreadable", evidence: "ObjectMissing" };
  const ancestor = await scratchIsAncestor(
    own.scratch,
    repository,
    proof.candidate,
    observed,
  );
  if (ancestor === undefined) {
    return { proved: "Unreadable", evidence: "RefUnreadable" };
  }
  return ancestor
    ? { proved: "Ancestor", observed }
    : { proved: "NotAncestor", observed };
}

/** The adapter over its options, refusing at construction what it could never serve. */
export function gitPromotion(options: GitPromotionOptions): GitPromotionPort {
  const own: GitPromotionState = {
    scratch: scratchOpen({
      directory: options.scratchDirectory,
      identity: options.identity,
      environment: options.environment,
      credentialUsername:
        options.credentialUsername ?? gitPromotionDefaults.credentialUsername,
      localTimeoutSecsMax:
        options.localTimeoutSecsMax ?? gitPromotionDefaults.localTimeoutSecsMax,
      remoteTimeoutSecsMax:
        options.remoteTimeoutSecsMax ??
        gitPromotionDefaults.remoteTimeoutSecsMax,
      promotionTimeoutSecsMax:
        options.promotionTimeoutSecsMax ??
        gitPromotionDefaults.promotionTimeoutSecsMax,
    }),
    credentials: options.credentials,
  };
  return {
    observeTarget: (repository) => gitPromotionObserve(own, repository),
    prepareCandidate: (preparation) => gitPromotionPrepare(own, preparation),
    prepareSource: (preparation) => gitPromotionPrepareSource(own, preparation),
    integrateCandidate: (integration) =>
      gitPromotionIntegrate(own, integration),
    promoteCandidate: (promotion) => gitPromotionPromote(own, promotion),
    proveCandidateAncestry: (proof) => gitPromotionProve(own, proof),
  };
}
