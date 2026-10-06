/**
 * Whether one commit is in another's history, asked of the repository both are
 * in.
 *
 * THE ANSWER IS ABOUT TWO IMMUTABLE COMMITS, so `Ancestor` and `NotAncestor`
 * cannot change once given. `Unknown` says nothing about the commits: it is a
 * port that could not find out this time, and the same question is worth
 * asking again.
 *
 * THE TWO COMMITS ARE NAMED AND NOT POSITIONED. Both are object identities, so
 * a question taken as two arguments could be asked backwards and still compile.
 */

import type { GitObjectId, RepositoryBinding } from "./finalizer.ts";

/** One question: whether `candidate` is `tip` or a commit `tip` descends from. */
export interface CommitAncestryQuestion {
  readonly repository: RepositoryBinding;
  readonly candidate: GitObjectId;
  readonly tip: GitObjectId;
}

/** What one question came to, `NotAncestor` being a finding about a history read whole and never a commit that could not be read. */
export type CommitAncestry = "Ancestor" | "NotAncestor" | "Unknown";

/** Answers ancestry, a repository or a commit that could not be read being `Unknown` and never a raise. */
export interface CommitAncestryPort {
  ancestry(question: CommitAncestryQuestion): Promise<CommitAncestry>;
}
