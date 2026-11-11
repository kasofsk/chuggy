/**
 * The identity of a change, read from the bare scratch kept per repository
 * once the histories of both its commits are held there.
 *
 * THE DIFF IS READ WHOLE AND HANDED TO `patch-id` BYTE FOR BYTE, never decoded
 * on the way back in, so two edits differing only in bytes that are not UTF-8
 * are two identities. It is written by `diff-tree`, which reads none of the
 * configuration `diff` reads for a person, with renames, external diff drivers
 * and text conversion turned off, so prefixes, algorithm and drivers set on the
 * host's git do not change the answer.
 *
 * A READ THAT DID NOT END WITH GIT'S ANSWER ANSWERS NOTHING: a commit pair
 * sharing no history, a diff past the output bound, and a git stopped at its
 * bound included. A diff git wrote empty is the empty change.
 */

import {
  emptyChangeIdentity,
  type ChangeIdentity,
} from "../../interpreter/changeIdentity.ts";
import {
  gitObjectIdPattern,
  type GitObjectId,
  type RepositoryId,
} from "../../interpreter/finalizer.ts";
import { scratchRun, type GitScratch } from "./gitScratch.ts";

/** Whether git printed one object identity, which a patch-id is spelled as too. */
function gitChangeIdentityIsObjectId(value: string): boolean {
  return new RegExp(gitObjectIdPattern(), "u").test(value);
}

/** Where two commits meet, read with every replace ref set aside, and nothing where they share no history or git could not say. */
async function gitChangeIdentityMergeBase(
  scratch: GitScratch,
  repository: RepositoryId,
  work: GitObjectId,
  target: GitObjectId,
): Promise<string | undefined> {
  const ran = await scratchRun(scratch, {
    repository,
    timeoutMsMax: scratch.options.localTimeoutMsMax,
    argv: ["--no-replace-objects", "merge-base", work, target],
  });
  if (ran.ran === "Stopped" || ran.code !== 0) return undefined;
  const base = ran.stdout.trim();
  return gitChangeIdentityIsObjectId(base) ? base : undefined;
}

/** The diff from `base` to `work`, its bytes kept one to a character, and nothing where git could not write it whole. */
async function gitChangeIdentityDiff(
  scratch: GitScratch,
  repository: RepositoryId,
  base: string,
  work: GitObjectId,
): Promise<string | undefined> {
  const ran = await scratchRun(scratch, {
    repository,
    timeoutMsMax: scratch.options.localTimeoutMsMax,
    stdoutEncoding: "latin1",
    argv: [
      "--no-replace-objects",
      "diff-tree",
      "-p",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      base,
      work,
      "--",
    ],
  });
  if (ran.ran === "Stopped" || ran.code !== 0) return undefined;
  return ran.stdout;
}

/** The stable patch-id of one diff, and nothing where git did not print one. */
async function gitChangeIdentityPatchId(
  scratch: GitScratch,
  repository: RepositoryId,
  diff: string,
): Promise<ChangeIdentity | undefined> {
  const ran = await scratchRun(scratch, {
    repository,
    timeoutMsMax: scratch.options.localTimeoutMsMax,
    input: Buffer.from(diff, "latin1"),
    argv: ["patch-id", "--stable"],
  });
  if (ran.ran === "Stopped" || ran.code !== 0) return undefined;
  const [patchId] = ran.stdout.trim().split(" ");
  return patchId !== undefined && gitChangeIdentityIsObjectId(patchId)
    ? patchId
    : undefined;
}

/**
 * The identity of the change `work` makes over where it meets `target`, both
 * already held by the scratch, or nothing where git could not answer.
 */
export async function gitChangeIdentityRead(
  scratch: GitScratch,
  repository: RepositoryId,
  work: GitObjectId,
  target: GitObjectId,
): Promise<ChangeIdentity | undefined> {
  const base = await gitChangeIdentityMergeBase(
    scratch,
    repository,
    work,
    target,
  );
  if (base === undefined) return undefined;
  const diff = await gitChangeIdentityDiff(scratch, repository, base, work);
  if (diff === undefined) return undefined;
  if (diff === "") return emptyChangeIdentity;
  return gitChangeIdentityPatchId(scratch, repository, diff);
}
