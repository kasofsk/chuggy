/**
 * The git tree one commit records, asked of the repository the commit is in.
 *
 * A COMMIT NAMES ITS TREE FOR GOOD, so an answer is true for good and a port
 * that could not find out says so by answering nothing, which is not a finding
 * about the commit: the same question is worth asking again.
 */

import type { GitObjectId, RepositoryBinding } from "./finalizer.ts";

/** One question: the tree `commit` records. */
export interface CommitTreeQuestion {
  readonly repository: RepositoryBinding;
  readonly commit: GitObjectId;
}

/**
 * Answers the tree a commit records, or nothing where it could not find out
 * this time. It raises only where it cannot work at all.
 */
export interface CommitTreePort {
  tree(question: CommitTreeQuestion): Promise<GitObjectId | undefined>;
}
