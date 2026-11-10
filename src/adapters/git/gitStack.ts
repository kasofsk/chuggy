/**
 * Minting the commit an evaluation of a stacked ticket runs over, and taking
 * it down again.
 *
 * A STACK COMMIT IS A FUNCTION OF ITS INPUTS. It is the tip with each accepted
 * commit beneath, then the candidate, folded in by a merge, and every merge
 * commit is written under one fixed identity and date with a message of its own
 * parents, so minting the same stack again, here or anywhere, writes the same
 * commit and pushing it again moves nothing.
 *
 * A COMMIT THE RUNNING STACK ALREADY REACHES ADDS NOTHING, and a stack the
 * candidate alone reaches is the candidate. A textual conflict is no stack.
 */

import type {
  GitEvidence,
  GitObjectId,
  GitRefName,
  RepositoryCredential,
  RepositoryId,
  StackMinted,
  StackMinting,
  StackRemoved,
} from "../../interpreter/finalizer.ts";
import {
  scratchCommitShape,
  scratchCommitWritten,
  scratchCommitTreeFixed,
  scratchFetchHistory,
  scratchFetchRef,
  scratchHasCommit,
  scratchIsAncestor,
  scratchKeepCommit,
  scratchMergeTree,
  scratchPush,
  scratchPushDelete,
  scratchReadRef,
  type GitScratch,
  type ScratchPushed,
} from "./gitScratch.ts";

/** Who every stack commit is attributed to, and the instant it is dated at. */
export const stackIdentity = {
  name: "Chug Stack",
  email: "chug-stack@invalid",
  date: "@0 +0000",
} as const;

function stackMessage(into: GitObjectId, commit: GitObjectId): string {
  return `chug: stack ${commit}\n\nOn ${into}.\n`;
}

async function stackHolds(
  scratch: GitScratch,
  credential: RepositoryCredential,
  repository: RepositoryId,
  commit: GitObjectId,
): Promise<boolean> {
  if (await scratchHasCommit(scratch, repository, commit)) return true;
  await scratchFetchHistory(
    scratch,
    repository,
    credential,
    commit,
    scratch.options.remoteTimeoutMsMax,
  );
  return scratchHasCommit(scratch, repository, commit);
}

/** The running stack with one more commit folded in, or why it could not be. */
async function stackFolded(
  scratch: GitScratch,
  minting: StackMinting,
  running: GitObjectId,
  commit: GitObjectId,
): Promise<
  | { readonly folded: "Commit"; readonly commit: GitObjectId }
  | { readonly folded: "Conflicted" }
  | { readonly folded: "Failed" }
> {
  const repository = minting.repository.repository;
  const behind = await scratchIsAncestor(scratch, repository, commit, running);
  if (behind === undefined) return { folded: "Failed" };
  if (behind) return { folded: "Commit", commit: running };
  const ahead = await scratchIsAncestor(scratch, repository, running, commit);
  if (ahead === undefined) return { folded: "Failed" };
  if (ahead) return { folded: "Commit", commit };
  const merged = await scratchMergeTree(scratch, repository, running, commit);
  if (merged.merged === "Conflicted") return { folded: "Conflicted" };
  if (merged.merged === "Failed") return { folded: "Failed" };
  const written = await scratchCommitTreeFixed(
    scratch,
    repository,
    merged.tree,
    [running, commit],
    stackMessage(running, commit),
    stackIdentity,
  );
  return written === undefined
    ? { folded: "Failed" }
    : { folded: "Commit", commit: written };
}

function stackPushEvidence(pushed: ScratchPushed): GitEvidence | undefined {
  switch (pushed.pushed) {
    case "Advanced":
      return undefined;
    case "Refused":
    case "Declined":
      return "RemoteDeclined";
    case "TimedOut":
      return "PromotionTimedOut";
    case "Unknown":
      return "RemoteUnreachable";
  }
}

/** Merges the stack and publishes it at its ref. */
export async function stackMint(
  scratch: GitScratch,
  credential: RepositoryCredential,
  minting: StackMinting,
): Promise<StackMinted> {
  const repository = minting.repository.repository;
  const base = minting.tip.baseRef ?? minting.tip.ref;
  if (
    !(await scratchHasCommit(scratch, repository, minting.tip.commit)) &&
    !(await scratchFetchRef(scratch, repository, credential, base))
  ) {
    return { minted: "Failed", evidence: "RemoteUnreachable" };
  }
  const commits = [...minting.beneath, minting.candidate];
  for (const commit of [minting.tip.commit, ...commits]) {
    if (!(await stackHolds(scratch, credential, repository, commit)))
      return { minted: "Failed", evidence: "ObjectMissing" };
  }
  let running = minting.tip.commit;
  for (const commit of commits) {
    const folded = await stackFolded(scratch, minting, running, commit);
    if (folded.folded === "Conflicted") return { minted: "Conflicted" };
    if (folded.folded === "Failed")
      return { minted: "Failed", evidence: "IntegrationFailed" };
    running = folded.commit;
  }
  const shape = await scratchCommitShape(scratch, repository, running);
  if (
    shape === undefined ||
    !(await scratchKeepCommit(scratch, repository, running))
  )
    return { minted: "Failed", evidence: "IntegrationFailed" };
  const held = await scratchReadRef(
    scratch,
    repository,
    credential,
    minting.ref,
  );
  if (held.read === "Unreachable")
    return { minted: "Failed", evidence: "RemoteUnreachable" };
  const evidence =
    held.read === "Value" && held.value === running
      ? undefined
      : stackPushEvidence(
          await scratchPush(
            scratch,
            repository,
            credential,
            running,
            minting.ref,
            held.read === "Value" ? held.value : "Absent",
          ),
        );
  return evidence === undefined
    ? { minted: "Stack", commit: running, tree: shape.tree }
    : { minted: "Failed", evidence };
}

/**
 * Deletes the ref a stack was published at while it holds the commit the stack
 * was recorded at. A ref the remote holds none of, or holds at another commit,
 * has nothing of this stack to take down.
 */
export async function stackRemove(
  scratch: GitScratch,
  credential: RepositoryCredential,
  removal: {
    readonly repository: RepositoryId;
    readonly ref: GitRefName;
    readonly commit: GitObjectId;
  },
): Promise<StackRemoved> {
  const repository = removal.repository;
  const read = await scratchReadRef(
    scratch,
    repository,
    credential,
    removal.ref,
  );
  if (read.read === "Absent") return { removed: "Removed" };
  if (read.read === "Unreachable")
    return { removed: "Failed", evidence: "RemoteUnreachable" };
  if (read.value !== removal.commit) return { removed: "Removed" };
  const evidence = stackPushEvidence(
    await scratchPushDelete(
      scratch,
      repository,
      credential,
      removal.ref,
      removal.commit,
    ),
  );
  return evidence === undefined
    ? { removed: "Removed" }
    : { removed: "Failed", evidence };
}

/** Whether `commit` is the work itself or a merge of the stack identity that contains it. */
async function stackIsOfCandidate(
  scratch: GitScratch,
  credential: RepositoryCredential,
  repository: RepositoryId,
  commit: GitObjectId,
  candidate: GitObjectId,
): Promise<boolean | undefined> {
  if (!(await stackHolds(scratch, credential, repository, commit)))
    return undefined;
  if (commit !== candidate) {
    const written = await scratchCommitWritten(scratch, repository, commit);
    if (
      written?.name !== stackIdentity.name ||
      written.email !== stackIdentity.email ||
      !written.subject.startsWith("chug: stack ")
    )
      return false;
  }
  return scratchIsAncestor(scratch, repository, candidate, commit);
}

/**
 * Deletes the ref a stack may have been published at without a record: the
 * ref is read, and taken down under a lease on that value only where it is
 * the work itself or a stack commit that contains it. Any other ref is left.
 */
export async function stackRemoveUnrecorded(
  scratch: GitScratch,
  credential: RepositoryCredential,
  removal: {
    readonly repository: RepositoryId;
    readonly ref: GitRefName;
    readonly candidate: GitObjectId;
  },
): Promise<StackRemoved> {
  const repository = removal.repository;
  const read = await scratchReadRef(
    scratch,
    repository,
    credential,
    removal.ref,
  );
  if (read.read === "Absent") return { removed: "Removed" };
  if (read.read === "Unreachable")
    return { removed: "Failed", evidence: "RemoteUnreachable" };
  const ours = await stackIsOfCandidate(
    scratch,
    credential,
    repository,
    read.value,
    removal.candidate,
  );
  if (ours === undefined)
    return { removed: "Failed", evidence: "RemoteUnreachable" };
  if (!ours) return { removed: "Removed" };
  return stackRemove(scratch, credential, {
    repository,
    ref: removal.ref,
    commit: read.value,
  });
}
