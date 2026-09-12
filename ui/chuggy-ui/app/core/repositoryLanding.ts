/**
 * A repository's landing default as one section edits it: the choice a reader
 * holds, the write it becomes, and what that write answered.
 *
 * A WRITE THE LANDING MOVED UNDER IS NOT RETRIED. Every write carries the mode
 * the page read as well as the one it wants, so two administrators editing the
 * same binding cannot cross silently; the route answers `409` with the binding
 * as it stands and the draft is rebased onto it, an untouched choice taking what
 * now stands and a touched one standing while the next write fences against the
 * arriving mode.
 */

import type { projectRepositoryLandingSchema } from "../../../../src/contract/requests.ts";
import { projectRepositoryLandingConflictSchema } from "../../../../src/contract/responses.ts";
import type {
  ProjectRepositoriesResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import type { BriefFinalizationMode } from "../../../../src/contract/rosters.ts";
import type { z } from "zod";

import type { ApiResult } from "./apiRequest.ts";
import { panelReason } from "./freshness.ts";

/** What the reader has chosen, beside the mode the page read it against. */
export interface RepositoryLandingDraft {
  readonly mode: BriefFinalizationMode;
  readonly read: BriefFinalizationMode;
}

export function repositoryLandingDraft(
  binding: ProjectRepositoryResponse,
): RepositoryLandingDraft {
  return { mode: binding.landing.mode, read: binding.landing.mode };
}

export function repositoryLandingChosen(
  draft: RepositoryLandingDraft,
  mode: BriefFinalizationMode,
): RepositoryLandingDraft {
  return { ...draft, mode };
}

/** The draft with the reader's choice given up, which is what Cancel leaves. */
export function repositoryLandingRestored(
  draft: RepositoryLandingDraft,
): RepositoryLandingDraft {
  return { ...draft, mode: draft.read };
}

/** Nothing to write where the choice is the one the page read. */
export function repositoryLandingSavable(
  draft: RepositoryLandingDraft,
): boolean {
  return draft.mode !== draft.read;
}

/** The draft over the binding that now stands, which an untouched choice takes. */
export function repositoryLandingRebased(
  draft: RepositoryLandingDraft,
  binding: ProjectRepositoryResponse,
): RepositoryLandingDraft {
  const arriving = binding.landing.mode;
  return {
    mode: draft.mode === draft.read ? arriving : draft.mode,
    read: arriving,
  };
}

/** The body the route refuses a write without: the binding, the mode the page
 * read, and the mode it wants. */
export function repositoryLandingWrite(
  draft: RepositoryLandingDraft,
  repository: string,
): z.infer<typeof projectRepositoryLandingSchema> {
  return {
    repository,
    expected: { mode: draft.read },
    landing: { mode: draft.mode },
  };
}

/** Where the last write stands, both answers that moved the landing carrying
 * the binding behind it. */
export type RepositoryLandingSaved =
  | { readonly saved: "Idle" }
  | { readonly saved: "Writing" }
  | { readonly saved: "Written"; readonly binding: ProjectRepositoryResponse }
  | { readonly saved: "Conflict"; readonly binding: ProjectRepositoryResponse }
  | { readonly saved: "Failed"; readonly reason: string };

/** The code the route names a moved landing by. The wire publishes no roster of
 * its error codes, so it is read as the string it arrives as. */
const repositoryLandingMovedCode = "RepositoryLandingMoved";

export function repositoryLandingAnswered(
  result: ApiResult<ProjectRepositoryResponse>,
): RepositoryLandingSaved {
  if (result.outcome === "Ok")
    return { saved: "Written", binding: result.value };
  if (
    result.outcome === "Conflict" &&
    result.code === repositoryLandingMovedCode
  ) {
    const read = projectRepositoryLandingConflictSchema.safeParse(result.body);
    if (read.success)
      return { saved: "Conflict", binding: read.data.repository };
  }
  return { saved: "Failed", reason: panelReason(result) };
}

/**
 * The bindings this page holds with one row replaced. A write that landed IS the
 * newest read of that row, and the route raises no frame, so the listing takes
 * it rather than waiting for a refetch nothing schedules.
 */
export function projectRepositoriesWith(
  held: ProjectRepositoriesResponse,
  binding: ProjectRepositoryResponse,
): ProjectRepositoriesResponse {
  return {
    ...held,
    repositories: held.repositories.map((row) =>
      row.repository === binding.repository ? binding : row,
    ),
  };
}

/** The binding this page is about, absent where the project does not bind it. */
export function projectRepositoryBound(
  held: ProjectRepositoriesResponse,
  repository: string,
): ProjectRepositoryResponse | undefined {
  return held.repositories.find((row) => row.repository === repository);
}
