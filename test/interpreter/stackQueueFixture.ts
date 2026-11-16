/**
 * The queued tickets the stack suites replay the stacking model's scenarios
 * over. They are one fixture because the choice's suite and the re-stack's
 * read the same queues, and a queue restated in the second would drift from
 * the one the first proves against.
 */

import { asTicketId } from "../../src/domain/ids.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import type {
  StackEntry,
  StackMember,
  StackPhase,
  StackPolicy,
} from "../../src/interpreter/stackChoice.ts";

/** A commit identity of the real width, one per number. */
function commit(number: number) {
  return asGitObjectId(number.toString(16).padStart(40, "0"));
}

export function member(ticket: number, at = 1): StackMember {
  return { ticket: asTicketId(ticket), commit: commit(ticket * 100 + at) };
}

/** A queued ticket accepted at its first commit, ranked by its number. */
export function entry(
  ticket: number,
  policy: StackPolicy,
  phase: StackPhase,
  over: Partial<StackEntry> = {},
): StackEntry {
  return {
    ticket: asTicketId(ticket),
    policy,
    phase,
    rank: ticket,
    commit: member(ticket).commit,
    stack: undefined,
    ...over,
  };
}
