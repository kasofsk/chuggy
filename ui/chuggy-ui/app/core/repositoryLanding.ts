/**
 * A binding's settings as one section edits them: its landing default and
 * whether its jobs may write its pipeline definitions, the choice a reader
 * holds, the write it becomes, and what a refusal of that write says.
 *
 * A WRITE A SETTING MOVED UNDER IS NOT RETRIED. Every write carries each
 * setting as the page read it as well as the value it wants, so two
 * administrators editing the same binding cannot cross silently; the route
 * answers `409` with the binding as it stands and the draft is rebased onto it,
 * an untouched choice taking what now stands and a touched one standing while
 * the next write fences against the arriving value. A section edits one
 * setting and writes the other as it read it.
 */

import type { projectRepositoryLandingSchema } from "../../../../src/contract/requests.ts";
import { projectRepositoryLandingConflictSchema } from "../../../../src/contract/responses.ts";
import type {
  ProjectRepositoriesResponse,
  ProjectRepositoryListedResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import type { BriefFinalizationMode } from "../../../../src/contract/rosters.ts";
import type { z } from "zod";

import type { ApiFailure } from "./apiRequest.ts";
import { failureWords } from "./failureWords.ts";

/** What the reader has chosen of each setting, beside the value the page read it against. */
export interface RepositoryLandingDraft {
  readonly mode: BriefFinalizationMode;
  readonly read: BriefFinalizationMode;
  readonly pipelinesWritable: boolean;
  readonly pipelinesWritableRead: boolean;
}

export function repositoryLandingDraft(
  binding: ProjectRepositoryResponse,
): RepositoryLandingDraft {
  return {
    mode: binding.landing.mode,
    read: binding.landing.mode,
    pipelinesWritable: binding.pipelinesWritable,
    pipelinesWritableRead: binding.pipelinesWritable,
  };
}

export function repositoryLandingChosen(
  draft: RepositoryLandingDraft,
  mode: BriefFinalizationMode,
): RepositoryLandingDraft {
  return { ...draft, mode };
}

export function repositoryLandingPipelinesChosen(
  draft: RepositoryLandingDraft,
  pipelinesWritable: boolean,
): RepositoryLandingDraft {
  return { ...draft, pipelinesWritable };
}

/** The draft with the reader's choices given up, which is what Cancel leaves. */
export function repositoryLandingRestored(
  draft: RepositoryLandingDraft,
): RepositoryLandingDraft {
  return {
    ...draft,
    mode: draft.read,
    pipelinesWritable: draft.pipelinesWritableRead,
  };
}

/** Nothing to write where every choice is the one the page read. */
export function repositoryLandingSavable(
  draft: RepositoryLandingDraft,
): boolean {
  return (
    draft.mode !== draft.read ||
    draft.pipelinesWritable !== draft.pipelinesWritableRead
  );
}

/** The draft over the binding that now stands, which each untouched choice takes. */
export function repositoryLandingRebased(
  draft: RepositoryLandingDraft,
  binding: ProjectRepositoryResponse,
): RepositoryLandingDraft {
  const arriving = binding.landing.mode;
  const arrivingPipelines = binding.pipelinesWritable;
  return {
    mode: draft.mode === draft.read ? arriving : draft.mode,
    read: arriving,
    pipelinesWritable:
      draft.pipelinesWritable === draft.pipelinesWritableRead
        ? arrivingPipelines
        : draft.pipelinesWritable,
    pipelinesWritableRead: arrivingPipelines,
  };
}

/** The body the route refuses a write without: the binding, and each setting
 * as the page read it and as it is wanted. */
export function repositoryLandingWrite(
  draft: RepositoryLandingDraft,
  repository: string,
): z.infer<typeof projectRepositoryLandingSchema> {
  return {
    repository,
    expected: { mode: draft.read },
    landing: { mode: draft.mode },
    pipelinesWritable: {
      expected: draft.pipelinesWritableRead,
      wanted: draft.pipelinesWritable,
    },
  };
}

/** The code the route names a moved setting by. The wire publishes no roster of
 * its error codes, so it is read as the string it arrives as. */
const repositoryLandingMovedCode = "RepositoryLandingMoved";

/** What a refusal of the write moved for says. */
export const repositoryLandingMovedLine = "Settings moved";

/** The binding as it stands, where the write was refused because a setting
 * moved under it. */
export function repositoryLandingMoved(
  failure: ApiFailure | undefined,
): ProjectRepositoryResponse | undefined {
  if (
    failure?.outcome !== "Conflict" ||
    failure.code !== repositoryLandingMovedCode
  )
    return undefined;
  const read = projectRepositoryLandingConflictSchema.safeParse(failure.body);
  return read.success ? read.data.repository : undefined;
}

/** The line a refused write is drawn as: a moved setting, or the failure
 * in its word. */
export function repositoryLandingRefusal(failure: ApiFailure): string {
  return repositoryLandingMoved(failure) === undefined
    ? failureWords(failure).word
    : repositoryLandingMovedLine;
}

/** What only the listing says of a binding: what the project holds for it. */
function projectRepositoryHolding(
  row: ProjectRepositoryListedResponse,
): Pick<ProjectRepositoryListedResponse, "configured" | "configurationsHeld"> {
  const { configured, configurationsHeld } = row;
  return configurationsHeld === undefined
    ? { configured }
    : { configured, configurationsHeld };
}

/**
 * The bindings this page holds with one row's binding replaced and what only
 * the listing says of it kept. A write that landed IS the newest read of that
 * binding, and the route raises no frame, so the listing takes it rather than
 * waiting for a refetch nothing schedules.
 */
export function projectRepositoriesWith(
  held: ProjectRepositoriesResponse,
  binding: ProjectRepositoryResponse,
): ProjectRepositoriesResponse {
  return {
    ...held,
    repositories: held.repositories.map((row) =>
      row.repository === binding.repository
        ? { ...binding, ...projectRepositoryHolding(row) }
        : row,
    ),
  };
}

/** The binding this page is about, absent where the project does not bind it. */
export function projectRepositoryBound(
  held: ProjectRepositoriesResponse,
  repository: string,
): ProjectRepositoryListedResponse | undefined {
  return held.repositories.find((row) => row.repository === repository);
}
