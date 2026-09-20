/**
 * What one bound repository declares, as the lines its page draws.
 *
 * A ROSTER THAT IS EMPTY IS NOT A ROSTER THAT IS ABSENT. A repository
 * declaring no finalizer and one whose catalog holds none read the same on
 * this wire, so a section says its roster is empty rather than drawing nothing
 * and leaving a reader to decide which it was.
 */

import type { RepositoryDeclarationsResponse } from "../../../../src/contract/responses.ts";

/** One named roster as a section draws it. */
export interface RepositoryDeclaredRoster {
  readonly name: string;
  readonly members: readonly string[];
}

/**
 * The rosters a reader can act on, in the order the page states them: what a
 * ticket here is run under, then what it may be finished with.
 */
export function repositoryDeclaredRosters(
  declared: RepositoryDeclarationsResponse,
): readonly RepositoryDeclaredRoster[] {
  return [
    { name: "Execution profiles", members: declared.executionProfiles },
    { name: "Finalizers", members: declared.finalizers },
  ];
}

/**
 * The commit these declarations were read at, drawn as a digest is. The whole
 * commit is the title, so a reader comparing it with a forge has the full one.
 */
export function repositoryDeclaredCommit(declared: {
  readonly commit: string;
}): { readonly text: string; readonly title: string } {
  return { text: declared.commit.slice(0, 12), title: declared.commit };
}
