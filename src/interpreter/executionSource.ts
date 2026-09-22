/**
 * A ticket's source: the commit its work is based on, and the reference the
 * journal carries for it.
 *
 * ONLY THE DISPATCH OBSERVES. The source is a field of the ticket, pinned by
 * the one command that looks at what the ticket's repository holds; every
 * later spawn — a rework, a resume, an evaluation of what the work produced,
 * the finalizer — runs at the source the ticket already carries, and a passed
 * work result is what replaces it. So `observe` answers the dispatch alone and
 * `spawnSource` answers everything else out of the ticket's own history.
 */

import type {
  GitObjectId,
  ObservedTarget,
  RepositoryId,
  TargetObserved,
} from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import type { ResultManifestId } from "./resultManifest.ts";

export interface ExecutionSourceObservation {
  readonly repository: RepositoryId;
  readonly target: Pick<ObservedTarget, "commit"> &
    Partial<Pick<ObservedTarget, "ref">>;
  readonly manifests: readonly ResultManifestId[];
}

/**
 * What a dispatch pins onto its ticket: the reference the event carries, and
 * the commit that reference folds where there was one to fold.
 */
export interface DispatchSource {
  readonly reference: number;
  readonly repository?: RepositoryId;
  readonly commit?: GitObjectId;
  readonly ref?: ObservedTarget["ref"];
}

/**
 * The source reference a ticket whose brief names no repository is dispatched
 * at. `result_digest_fold` reads thirteen hexadecimal characters into a
 * fifty-two-bit integer and adds one, so every folded source is at or below
 * two to the fifty-second; this is the next value above all of them, and a
 * reader that finds it knows there was no commit rather than one it cannot
 * resolve.
 */
export const unsourcedTicketReference = 2 ** 52 + 1;

export interface ExecutionSourceObservationPort {
  observe(input: {
    readonly partition: Partition;
    readonly ticket: number;
    readonly repository?: RepositoryId;
    readonly ref?: ObservedTarget["ref"];
    readonly credentialReference?: string;
  }): Promise<
    | {
        readonly observed: "Source";
        readonly source: DispatchSource;
      }
    | Exclude<TargetObserved, { readonly observed: "Target" }>
  >;
  /**
   * What one spawn runs against: the ticket's own source, and the manifests an
   * evaluation of its work judges. A ticket with no repository has nothing for
   * a bundle to name and answers undefined.
   */
  spawnSource(input: {
    readonly partition: Partition;
    readonly ticket: number;
    readonly source: number;
    readonly kind: "Work" | "Evaluation";
  }): Promise<ExecutionSourceObservation | undefined>;
}
