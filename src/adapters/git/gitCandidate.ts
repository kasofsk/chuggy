/**
 * Building a candidate commit out of verified handoff artifacts, and
 * integrating one against an observed target.
 *
 * A CANDIDATE IS THE OBSERVED BASE IT IS HANDED WITH THE ARTIFACTS STANDING IN
 * IT, and its parent is that base. A handoff names the files one task produced
 * and not the repository entire, so a tree built from the artifacts alone would
 * promote the deletion of everything nobody handed over; the observed commit's
 * tree is what the artifacts are written on top of, and the tree that comes out
 * is a function of those two things and nothing else. Which commit that is, is
 * the caller's answer and never this adapter's — it is the target for a ticket
 * landing where it worked, and the branch the work happened on for one landing
 * anywhere else.
 *
 * THE CONTENT ARRIVES AS A VALUE AND IS NEVER READ FROM ANYWHERE. The store
 * that holds an artifact is another adapter's, so this one is handed bytes and
 * metadata and answers with a commit identity; a path is refused here rather
 * than trusted, because the index format reads a tab in one as the end of the
 * field before it, a path climbing out of the tree would write somewhere the
 * promotion was never authorized for, and a `.git` component at any depth names
 * the repository itself.
 *
 * A HEAD IS ADOPTED ONLY AS THAT SAME INTEGRATION. A proposal's head that is
 * not the one pinned for it stands in for it only where it is a merge whose
 * first parent is the pinned head, whose second the base reaches, and whose
 * tree is the tree a clean merge of the two writes — so a parent order swapped,
 * a rebase, a conflict resolved by hand and a merge carrying anything else are
 * each another shape or another tree, and are refused.
 *
 * AN INTEGRATION THE TARGET IS ALREADY INSIDE OF IS THE CANDIDATE ITSELF.
 * Merging a commit into one that already contains it changes nothing, and the
 * ancestry check is what keeps a repeated integration from writing a second
 * merge commit and a second identity for the same work.
 *
 * A TARGET HOLDS A CANDIDATE IT REACHES, OR ONE WHOSE MERGE IS ITS OWN TREE.
 * That is the other direction of the same question, asked of the target a
 * ticket lands on: either way no commit could land anything there, so no merge
 * commit is written to find that out.
 */

import { textCodePointsCount } from "../../contract/http.ts";
import { assertNever } from "../../domain/assertNever.ts";
import {
  candidateBytesMax,
  candidateFilesMax,
  type CandidateFile,
  type CandidateHeld,
  type CandidateHeldQuestion,
  type CandidateIntegrated,
  type CandidateIntegration,
  type CandidatePrepared,
  type CandidatePreparation,
  type GitObjectId,
  type GitRefName,
  type HeadAdoption,
  type HeadAdoptionQuestion,
  type ObservedTarget,
  type RepositoryCredential,
} from "../../interpreter/finalizer.ts";
import {
  scratchCommitShape,
  scratchCommitTree,
  scratchFetchHistory,
  scratchFetchRef,
  scratchHasCommit,
  scratchIsAncestor,
  scratchKeepCommit,
  scratchMergeBase,
  scratchMergeTree,
  scratchReadRef,
  scratchWriteBlob,
  scratchWriteTree,
  type GitScratch,
  type GitScratchEntry,
} from "./gitScratch.ts";

/** The longest path one candidate file may take in the tree. */
const candidatePathCharsMax = 1_024;

/** The most components one candidate file's path may have, so no tree is made arbitrarily deep. */
const candidatePathDepthMax = 64;

/** The directory a candidate may never write into, because git reads it as the repository itself. */
const candidateReservedDirectory = ".git";

/** Refuses a path the index format cannot carry, or one naming something outside the tree. */
function candidateAssertPath(path: string): void {
  const chars = textCodePointsCount(path);
  if (path.length === 0 || chars > candidatePathCharsMax) {
    throw new RangeError(
      `candidate path: ${String(chars)} characters is not a path one tree entry takes`,
    );
  }
  if (/[\0\n\t]/u.test(path)) {
    throw new RangeError(
      "candidate path: a separator the index format reads as another entry",
    );
  }
  const parts = path.split("/");
  if (parts.length > candidatePathDepthMax) {
    throw new RangeError(
      `candidate path: ${String(parts.length)} components is deeper than a candidate tree goes`,
    );
  }
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") {
      throw new RangeError(
        `candidate path: ${path} does not stay inside the tree`,
      );
    }
    if (part.toLowerCase() === candidateReservedDirectory) {
      throw new RangeError(
        `candidate path: ${path} names the repository itself`,
      );
    }
  }
}

/**
 * Refuses a set of files that is unbounded, self-contradicting, or carrying a
 * path no tree entry takes. Two paths differing only in case are one path to a
 * filesystem that folds, and are one row to the manifest that sealed them.
 */
function candidateAssertFiles(files: readonly CandidateFile[]): void {
  if (files.length > candidateFilesMax) {
    throw new RangeError(
      `candidate files: ${String(files.length)} is past the most one candidate is built from`,
    );
  }
  let bytes = 0;
  const seen = new Set<string>();
  for (const file of files) {
    candidateAssertPath(file.path);
    const folded = file.path.toLowerCase();
    if (seen.has(folded)) {
      throw new RangeError(`candidate files: ${file.path} is handed twice`);
    }
    seen.add(folded);
    bytes += file.content.byteLength;
  }
  if (bytes > candidateBytesMax) {
    throw new RangeError(
      `candidate files: ${String(bytes)} bytes is past the most one candidate is built from`,
    );
  }
}

/** The message the candidate carries, which is what ties the commit back to the pinned bundle. */
function candidatePrepareMessage(preparation: CandidatePreparation): string {
  return `chug: finalize ticket ${String(preparation.ticket)}\n\nInput bundle ${preparation.bundle}.\n`;
}

/** The message an integration carries, naming the target the candidate was merged against. */
function candidateIntegrateMessage(integration: CandidateIntegration): string {
  return `chug: integrate candidate ${integration.candidate}\n\nAgainst ${integration.target.ref} at ${integration.target.commit}.\n`;
}

/** Writes every artifact as a blob, stopping at the first git will not take. */
async function candidatePrepareBlobs(
  scratch: GitScratch,
  preparation: CandidatePreparation,
): Promise<readonly GitScratchEntry[] | undefined> {
  const entries: GitScratchEntry[] = [];
  for (const file of preparation.files) {
    const blob = await scratchWriteBlob(
      scratch,
      preparation.repository.repository,
      file.content,
    );
    if (blob === undefined) return undefined;
    entries.push({ path: file.path, blob });
  }
  return entries;
}

/**
 * The ref a base's commit is fetched from: its own, or the one it was based on
 * where the base names a branch the remote does not hold yet.
 */
function candidateBaseRef(base: ObservedTarget): GitRefName {
  return base.baseRef ?? base.ref;
}

/** Builds the candidate commit for one preparation, with no working tree at any point. */
export async function candidatePrepare(
  scratch: GitScratch,
  credential: RepositoryCredential,
  preparation: CandidatePreparation,
): Promise<CandidatePrepared> {
  candidateAssertFiles(preparation.files);
  const repository = preparation.repository.repository;
  const commit = preparation.base.commit;
  const ref = candidateBaseRef(preparation.base);
  if (!(await scratchFetchRef(scratch, repository, credential, ref))) {
    return { prepared: "Failed", evidence: "RemoteUnreachable" };
  }
  if (!(await scratchHasCommit(scratch, repository, commit))) {
    return { prepared: "Failed", evidence: "ObjectMissing" };
  }
  const entries = await candidatePrepareBlobs(scratch, preparation);
  if (entries === undefined) {
    return { prepared: "Failed", evidence: "IntegrationFailed" };
  }
  const tree = await scratchWriteTree(scratch, repository, commit, entries);
  if (tree === undefined) {
    return { prepared: "Failed", evidence: "IntegrationFailed" };
  }
  const candidate = await scratchCommitTree(
    scratch,
    repository,
    tree,
    [commit],
    candidatePrepareMessage(preparation),
  );
  if (
    candidate === undefined ||
    !(await scratchKeepCommit(scratch, repository, candidate))
  ) {
    return { prepared: "Failed", evidence: "IntegrationFailed" };
  }
  return { prepared: "Candidate", candidate };
}

/** Merges one candidate with one target, writing the merge commit the promotion would advance to. */
async function candidateIntegrateMerge(
  scratch: GitScratch,
  integration: CandidateIntegration,
): Promise<CandidateIntegrated> {
  const repository = integration.repository.repository;
  const merged = await scratchMergeTree(
    scratch,
    repository,
    integration.target.commit,
    integration.candidate,
  );
  switch (merged.merged) {
    case "Failed":
      return { integrated: "Failed", evidence: "IntegrationFailed" };
    case "Conflicted": {
      const base = await scratchMergeBase(
        scratch,
        repository,
        integration.target.commit,
        integration.candidate,
      );
      return {
        integrated: "Conflicted",
        conflict: { paths: merged.paths, truncated: merged.truncated },
        ...(base === undefined ? {} : { base }),
      };
    }
    case "Tree": {
      const candidate = await scratchCommitTree(
        scratch,
        repository,
        merged.tree,
        [integration.target.commit, integration.candidate],
        candidateIntegrateMessage(integration),
      );
      if (
        candidate === undefined ||
        !(await scratchKeepCommit(scratch, repository, candidate))
      ) {
        return { integrated: "Failed", evidence: "IntegrationFailed" };
      }
      return { integrated: "Candidate", candidate };
    }
    default:
      return assertNever(merged);
  }
}

/** Brings the target's objects in where the scratch has not got them, so a question about it is answerable at all. */
async function candidateHasTarget(
  scratch: GitScratch,
  credential: RepositoryCredential,
  question: Pick<CandidateIntegration, "repository" | "target">,
): Promise<boolean> {
  const repository = question.repository.repository;
  const commit = question.target.commit;
  if (await scratchHasCommit(scratch, repository, commit)) return true;
  const ref = candidateBaseRef(question.target);
  if (!(await scratchFetchRef(scratch, repository, credential, ref))) {
    return false;
  }
  return scratchHasCommit(scratch, repository, commit);
}

/** Integrates one candidate against exactly one observed target, deterministically. */
export async function candidateIntegrate(
  scratch: GitScratch,
  credential: RepositoryCredential,
  integration: CandidateIntegration,
): Promise<CandidateIntegrated> {
  const repository = integration.repository.repository;
  if (!(await scratchHasCommit(scratch, repository, integration.candidate))) {
    return { integrated: "Failed", evidence: "ObjectMissing" };
  }
  if (!(await candidateHasTarget(scratch, credential, integration))) {
    return { integrated: "Failed", evidence: "ObjectMissing" };
  }
  const contains = await scratchIsAncestor(
    scratch,
    repository,
    integration.target.commit,
    integration.candidate,
  );
  if (contains === undefined) {
    return { integrated: "Failed", evidence: "IntegrationFailed" };
  }
  if (contains) {
    return { integrated: "Candidate", candidate: integration.candidate };
  }
  switch (integration.strategy) {
    case "Merge":
      return candidateIntegrateMerge(scratch, integration);
    default:
      return assertNever(integration.strategy);
  }
}

/** Whether a clean merge of the candidate with the target is the target's own tree. */
async function candidateHeldMerged(
  scratch: GitScratch,
  question: CandidateHeldQuestion,
): Promise<CandidateHeld> {
  const repository = question.repository.repository;
  const merged = await scratchMergeTree(
    scratch,
    repository,
    question.target.commit,
    question.candidate,
  );
  switch (merged.merged) {
    case "Failed":
      return "Unread";
    case "Conflicted":
      return "Unheld";
    case "Tree": {
      const shape = await scratchCommitShape(
        scratch,
        repository,
        question.target.commit,
      );
      if (shape === undefined) return "Unread";
      return merged.tree === shape.tree ? "Held" : "Unheld";
    }
    default:
      return assertNever(merged);
  }
}

/** Whether the target a ticket lands on already holds its candidate, so landing it would change nothing. */
export async function candidateHeld(
  scratch: GitScratch,
  credential: RepositoryCredential,
  question: CandidateHeldQuestion,
): Promise<CandidateHeld> {
  const repository = question.repository.repository;
  if (!(await scratchHasCommit(scratch, repository, question.candidate)))
    return "Unread";
  if (!(await candidateHasTarget(scratch, credential, question)))
    return "Unread";
  const reached = await scratchIsAncestor(
    scratch,
    repository,
    question.candidate,
    question.target.commit,
  );
  if (reached === undefined) return "Unread";
  if (reached) return "Held";
  return candidateHeldMerged(scratch, question);
}

/** The commit the base stands at with its objects in the scratch, and nothing where either could not be read. */
async function candidateAdoptableBase(
  scratch: GitScratch,
  credential: RepositoryCredential,
  question: HeadAdoptionQuestion,
): Promise<GitObjectId | undefined> {
  const repository = question.repository.repository;
  const base = await scratchReadRef(
    scratch,
    repository,
    credential,
    question.baseRef,
  );
  if (base.read !== "Value") return undefined;
  if (
    !(await scratchFetchRef(scratch, repository, credential, question.baseRef))
  )
    return undefined;
  return (await scratchHasCommit(scratch, repository, base.value))
    ? base.value
    : undefined;
}

/** Brings the head read into the scratch, by its branch and then by its hash where the branch has moved past it. */
async function candidateAdoptableHead(
  scratch: GitScratch,
  credential: RepositoryCredential,
  question: HeadAdoptionQuestion,
): Promise<boolean> {
  const repository = question.repository.repository;
  await scratchFetchRef(scratch, repository, credential, question.headRef);
  if (await scratchHasCommit(scratch, repository, question.head)) return true;
  await scratchFetchHistory(
    scratch,
    repository,
    credential,
    question.head,
    scratch.options.remoteTimeoutSecsMax,
  );
  return scratchHasCommit(scratch, repository, question.head);
}

/** Whether a proposal's head is its pinned head brought up to date with its base, and nothing more. */
export async function candidateAdoptable(
  scratch: GitScratch,
  credential: RepositoryCredential,
  question: HeadAdoptionQuestion,
): Promise<HeadAdoption> {
  const repository = question.repository.repository;
  const base = await candidateAdoptableBase(scratch, credential, question);
  if (base === undefined) return "Unread";
  if (!(await candidateAdoptableHead(scratch, credential, question)))
    return "Unread";
  const shape = await scratchCommitShape(scratch, repository, question.head);
  if (shape === undefined) return "Unread";
  const [first, second, ...rest] = shape.parents;
  if (first !== question.pinned || second === undefined || rest.length > 0)
    return "Unadoptable";
  const onBase = await scratchIsAncestor(scratch, repository, second, base);
  if (onBase === undefined) return "Unread";
  if (!onBase) return "Unadoptable";
  const merged = await scratchMergeTree(scratch, repository, first, second);
  switch (merged.merged) {
    case "Failed":
      return "Unread";
    case "Conflicted":
      return "Unadoptable";
    case "Tree":
      return merged.tree === shape.tree ? "Adoptable" : "Unadoptable";
    default:
      return assertNever(merged);
  }
}
