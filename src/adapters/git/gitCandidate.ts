/**
 * Building a candidate commit out of verified handoff artifacts, and
 * integrating one against an observed target.
 *
 * A CANDIDATE IS THE OBSERVED TARGET WITH THE ARTIFACTS STANDING IN IT, and its
 * parent is that target. A handoff names the files one task produced and not
 * the repository entire, so a tree built from the artifacts alone would promote
 * the deletion of everything nobody handed over; the observed commit's tree is
 * what the artifacts are written on top of, and the tree that comes out is a
 * function of those two things and nothing else.
 *
 * THE CONTENT ARRIVES AS A VALUE AND IS NEVER READ FROM ANYWHERE. The store
 * that holds an artifact is another adapter's, so this one is handed bytes and
 * metadata and answers with a commit identity; a path is refused here rather
 * than trusted, because the index format reads a tab or a newline in one as the
 * start of another entry, and a path climbing out of the tree would write
 * somewhere the promotion was never authorized for.
 *
 * AN INTEGRATION THE TARGET IS ALREADY INSIDE OF IS THE CANDIDATE ITSELF.
 * Merging a commit into one that already contains it changes nothing, and the
 * ancestry check is what keeps a repeated integration from writing a second
 * merge commit and a second identity for the same work.
 */

import { assertNever } from "../../domain/assertNever.ts";
import {
  candidateBytesMax,
  candidateFilesMax,
  type CandidateFile,
  type CandidateIntegrated,
  type CandidateIntegration,
  type CandidatePrepared,
  type CandidatePreparation,
  type RepositoryCredential,
} from "../../interpreter/finalizer.ts";
import {
  scratchCommitTree,
  scratchFetchRef,
  scratchHasCommit,
  scratchIsAncestor,
  scratchKeepCommit,
  scratchMergeTree,
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
  if (path.length === 0 || path.length > candidatePathCharsMax) {
    throw new RangeError(
      `candidate path: ${String(path.length)} characters is not a path one tree entry takes`,
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
  }
  if (parts[0] === candidateReservedDirectory) {
    throw new RangeError(`candidate path: ${path} names the repository itself`);
  }
}

/** Refuses a set of files that is unbounded, self-contradicting, or carrying a path no tree entry takes. */
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
    if (seen.has(file.path)) {
      throw new RangeError(`candidate files: ${file.path} is handed twice`);
    }
    seen.add(file.path);
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

/** Builds the candidate commit for one preparation, with no working tree at any point. */
export async function candidatePrepare(
  scratch: GitScratch,
  credential: RepositoryCredential,
  preparation: CandidatePreparation,
): Promise<CandidatePrepared> {
  candidateAssertFiles(preparation.files);
  const repository = preparation.repository.repository;
  const { ref, commit } = preparation.target;
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
    case "Conflicted":
      return {
        integrated: "Conflicted",
        conflict: { paths: merged.paths, truncated: merged.truncated },
      };
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

/** Brings the target's objects in where the scratch has not got them, so an integration is answerable at all. */
async function candidateIntegrateHasTarget(
  scratch: GitScratch,
  credential: RepositoryCredential,
  integration: CandidateIntegration,
): Promise<boolean> {
  const repository = integration.repository.repository;
  const { ref, commit } = integration.target;
  if (await scratchHasCommit(scratch, repository, commit)) return true;
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
  if (!(await candidateIntegrateHasTarget(scratch, credential, integration))) {
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
