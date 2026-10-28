/**
 * The adapter behind `GitPromotionPort`: the remote reads a preparation pins,
 * the one conditional ref update a permit authorizes, and the ancestry proof
 * that says what the ref holds, a ref the remote does not hold being an answer
 * of its own rather than an unreadable one.
 *
 * A PROMOTION MAY BE AMBIGUOUS AND THAT IS AN ANSWER. The push either advanced
 * the ref, or was refused because the candidate was not a fast-forward of what
 * the remote holds — information rather than failure — or stopped without
 * saying which. A stopped push is `Ambiguous` even where nothing could plausibly
 * have been sent, because collapsing it into a refusal would let a candidate be
 * promoted twice, and the repository is the only authority that can settle it.
 *
 * A DECLINED PUSH IS AMBIGUOUS TOO, AND ITS EVIDENCE SAYS WHO DECLINED IT. A
 * repository that would not take the update for a reason of its own answers
 * `RemoteDeclined`, and GitHub refusing a credential that may not change a
 * workflow file answers `WorkflowsRefused`, read off the reason GitHub gives.
 * Neither is a refusal: a decline says nothing of the target, so neither is
 * sent to the re-read that means it moved, and the reading proves where it is.
 *
 * A CANDIDATE THE SCRATCH DOES NOT HOLD IS PROVED FROM THE TIP'S HISTORY. A
 * scratch may not outlive its process, so a candidate it lacks is proved from
 * that history: one still missing once every commit of it has been read is not
 * in it.
 *
 * A SOURCE THAT DOES NOT DESCEND FROM ITS BASE IS PROVED THE SAME WAY. A worker
 * that rewrote the history it was handed publishes a commit whose history no
 * longer holds the base it declares, and that is `Undescended` only once that
 * whole history has been read.
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
  CandidateHeld,
  CandidateHeldQuestion,
  CandidateIntegrated,
  CandidateIntegration,
  CandidatePrepared,
  CandidatePreparation,
  CandidateSourcePreparation,
  CandidateSourcePrepared,
  CandidatePromoted,
  CandidatePromotion,
  GitEvidence,
  GitObjectId,
  GitPromotionPort,
  HeadAdoption,
  HeadAdoptionQuestion,
  RepositoryBinding,
  RepositoryCredential,
  RepositoryCredentialPort,
  RepositoryId,
  TargetObserved,
} from "../../interpreter/finalizer.ts";
import {
  candidateAdoptable,
  candidateHeld,
  candidateIntegrate,
  candidatePrepare,
} from "./gitCandidate.ts";
import {
  scratchFetchRef,
  scratchHasCommit,
  scratchIsAncestor,
  scratchNamesCommit,
  scratchObserveHead,
  scratchPush,
  scratchReaches,
  scratchReadRef,
  scratchOpen,
  scratchWalksHistory,
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
): Promise<CandidateSourcePrepared> {
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
  return gitPromotionSourceDescends(own, repository, preparation);
}

/**
 * Whether a fetched source commit descends from its declared base. Git says
 * no both of a base it does not hold and of a walk that met a commit it could
 * not read, so a no is `Undescended` only once the commit's whole history has
 * been read; any read that did not look is a failure to read, not an answer.
 */
async function gitPromotionSourceDescends(
  own: GitPromotionState,
  repository: RepositoryId,
  preparation: CandidateSourcePreparation,
): Promise<CandidateSourcePrepared> {
  const { base, commit } = preparation;
  const named = await scratchNamesCommit(own.scratch, repository, base);
  const reached =
    named === "Yes"
      ? await scratchReaches(own.scratch, repository, base, commit)
      : named;
  switch (reached) {
    case "Yes":
      return { prepared: "Candidate", candidate: commit };
    case "Unread":
      return { prepared: "Failed", evidence: "ObjectMissing" };
    case "No":
      return (await scratchWalksHistory(own.scratch, repository, commit)) ===
        "Yes"
        ? { prepared: "Undescended" }
        : { prepared: "Failed", evidence: "ObjectMissing" };
    default:
      return assertNever(reached);
  }
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

/** The reason GitHub declines a push with where the credential behind it may not create or update a workflow file. */
const gitPromotionWorkflowsRefusal =
  "refusing to allow a GitHub App to create or update workflow ";

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
    case "Declined":
      return {
        promoted: "Ambiguous",
        evidence: pushed.reason.startsWith(gitPromotionWorkflowsRefusal)
          ? "WorkflowsRefused"
          : "RemoteDeclined",
      };
    case "TimedOut":
      return { promoted: "Ambiguous", evidence: "PromotionTimedOut" };
    case "Unknown":
      return { promoted: "Ambiguous", evidence: "RemoteUnreachable" };
    default:
      return assertNever(pushed);
  }
}

/**
 * What a fetched tip proves about a candidate the scratch did not hold, and
 * `undefined` where reading the tip's history brought it. Nothing is proved
 * until every commit of that history has been read.
 */
async function gitPromotionProveMissing(
  own: GitPromotionState,
  repository: RepositoryId,
  candidate: GitObjectId,
  observed: GitObjectId,
): Promise<AncestryProved | undefined> {
  if (
    (await scratchWalksHistory(own.scratch, repository, observed)) !== "Yes"
  ) {
    return { proved: "Unreadable", evidence: "ObjectMissing" };
  }
  const named = await scratchNamesCommit(own.scratch, repository, candidate);
  switch (named) {
    case "No":
      return { proved: "NotAncestor", observed };
    case "Yes":
      return undefined;
    case "Unread":
      return { proved: "Unreadable", evidence: "ObjectMissing" };
    default:
      return assertNever(named);
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
  if (read.read === "Absent") return { proved: "Absent" };
  if (read.read === "Unreachable") {
    return { proved: "Unreadable", evidence: "RemoteUnreachable" };
  }
  const observed = read.value;
  if (
    !(await scratchFetchRef(own.scratch, repository, credential, proof.ref))
  ) {
    return { proved: "Unreadable", evidence: "RemoteUnreachable" };
  }
  if (!(await scratchHasCommit(own.scratch, repository, observed))) {
    return { proved: "Unreadable", evidence: "ObjectMissing" };
  }
  if (!(await scratchHasCommit(own.scratch, repository, proof.candidate))) {
    const missing = await gitPromotionProveMissing(
      own,
      repository,
      proof.candidate,
      observed,
    );
    if (missing !== undefined) return missing;
  }
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

/** Reads whether the target a ticket lands on already holds its candidate, a credential refused being no answer. */
async function gitPromotionHeld(
  own: GitPromotionState,
  question: CandidateHeldQuestion,
): Promise<CandidateHeld> {
  const authorized = await gitPromotionCredentialOf(own, question.repository);
  if (authorized.authorized === "Refused") return "Unread";
  return candidateHeld(own.scratch, authorized.credential, question);
}

/** Reads whether a proposal's head is its pinned head brought up to date with its base, a credential refused being no answer. */
async function gitPromotionAdoptable(
  own: GitPromotionState,
  question: HeadAdoptionQuestion,
): Promise<HeadAdoption> {
  const authorized = await gitPromotionCredentialOf(own, question.repository);
  if (authorized.authorized === "Refused") return "Unread";
  return candidateAdoptable(own.scratch, authorized.credential, question);
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
    proveCandidateHeld: (question) => gitPromotionHeld(own, question),
    integrateCandidate: (integration) =>
      gitPromotionIntegrate(own, integration),
    promoteCandidate: (promotion) => gitPromotionPromote(own, promotion),
    proveCandidateAncestry: (proof) => gitPromotionProve(own, proof),
    proveHeadAdoptable: (question) => gitPromotionAdoptable(own, question),
  };
}
