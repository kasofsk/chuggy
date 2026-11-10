/**
 * The identity of a ticket's change, asked of the repository its commits are
 * in: the stable patch-id of the diff from where the work commit and the target
 * tip meet to the work commit.
 *
 * THE MEETING POINT IS WHAT MAKES THE ANSWER THE SAME WHENEVER IT IS ASKED. A
 * work commit that merged a moved target cleanly meets that target at its new
 * tip, so the diff is still only the ticket's own change; a conflict resolved
 * or an edit added is a different diff and a different identity.
 *
 * AN EMPTY DIFF IS AN ANSWER, `emptyChangeIdentity`, and a port that could not
 * find out says so by answering nothing, which is not a finding about the
 * change: the same question is worth asking again.
 */

import type { GitObjectId, RepositoryBinding } from "./finalizer.ts";

/** One question: the identity of the change `work` makes over where it meets `target`. */
export interface ChangeIdentityQuestion {
  readonly repository: RepositoryBinding;
  readonly work: GitObjectId;
  readonly target: GitObjectId;
}

/** A change's identity: a stable patch-id, or `emptyChangeIdentity`. */
export type ChangeIdentity = string;

/** The identity of a change that changes nothing, which no patch-id is spelled as. */
export const emptyChangeIdentity: ChangeIdentity = "Empty";

/**
 * Answers the identity of a change, or nothing where it could not find out
 * this time. It raises only where it cannot work at all.
 */
export interface ChangeIdentityPort {
  changeIdentity(
    question: ChangeIdentityQuestion,
  ): Promise<ChangeIdentity | undefined>;
}
