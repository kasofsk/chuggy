/**
 * Reading one directory of declarations out of one bound repository at one
 * commit: what a reader is asked, and what it found before any document is
 * interpreted.
 */

import type { GitObjectId, RepositoryBinding } from "./finalizer.ts";
import type { RepositoryDeclarationFile } from "./repositoryDeclaration.ts";

/** One commit of one bound repository, which is what a declaration directory is read at. */
export interface RepositoryDeclarationSnapshotRequest {
  readonly repository: RepositoryBinding;
  readonly commit: GitObjectId;
}

/**
 * What reading one declaration directory at one commit found. A tree holding
 * no such directory is a snapshot of no files, and `Absent` is a commit the
 * repository does not hold.
 */
export type RepositoryDeclarationSnapshotRead =
  | {
      readonly read: "Snapshot";
      readonly files: readonly RepositoryDeclarationFile[];
    }
  | { readonly read: "Absent" }
  | {
      readonly read: "Unavailable";
      readonly unavailable: "Credential" | "Repository";
    }
  | { readonly read: "Refused" };
