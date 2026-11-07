/**
 * A binding's settings as one section edits them: its default finalization and
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
import type { z } from "zod";

import type { ApiFailure } from "./apiRequest.ts";
import { failureWords } from "./failureWords.ts";
import {
  finalizationChoiceKey,
  type FinalizationChoice,
} from "./finalizationChoice.ts";

/** What the reader has chosen of each setting, beside the value the page read it against. */
export interface RepositoryFinalizationDraft {
  readonly finalization: FinalizationChoice;
  readonly read: FinalizationChoice;
  readonly pipelinesWritable: boolean;
  readonly pipelinesWritableRead: boolean;
}

export function repositoryFinalizationDraft(
  binding: ProjectRepositoryResponse,
): RepositoryFinalizationDraft {
  return {
    finalization: binding.finalization,
    read: binding.finalization,
    pipelinesWritable: binding.pipelinesWritable,
    pipelinesWritableRead: binding.pipelinesWritable,
  };
}

export function repositoryFinalizationChosen(
  draft: RepositoryFinalizationDraft,
  finalization: FinalizationChoice,
): RepositoryFinalizationDraft {
  return { ...draft, finalization };
}

export function repositoryFinalizationPipelinesChosen(
  draft: RepositoryFinalizationDraft,
  pipelinesWritable: boolean,
): RepositoryFinalizationDraft {
  return { ...draft, pipelinesWritable };
}

/** The draft with the reader's choices given up, which is what Cancel leaves. */
export function repositoryFinalizationRestored(
  draft: RepositoryFinalizationDraft,
): RepositoryFinalizationDraft {
  return {
    ...draft,
    finalization: draft.read,
    pipelinesWritable: draft.pipelinesWritableRead,
  };
}

/** Nothing to write where every choice is the one the page read. */
export function repositoryFinalizationSavable(
  draft: RepositoryFinalizationDraft,
): boolean {
  return (
    finalizationChoiceKey(draft.finalization) !==
      finalizationChoiceKey(draft.read) ||
    draft.pipelinesWritable !== draft.pipelinesWritableRead
  );
}

/** The draft over the binding that now stands, which each untouched choice takes. */
export function repositoryFinalizationRebased(
  draft: RepositoryFinalizationDraft,
  binding: ProjectRepositoryResponse,
): RepositoryFinalizationDraft {
  const arriving = binding.finalization;
  const arrivingPipelines = binding.pipelinesWritable;
  const untouched =
    finalizationChoiceKey(draft.finalization) ===
    finalizationChoiceKey(draft.read);
  return {
    finalization: untouched ? arriving : draft.finalization,
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
export function repositoryFinalizationWrite(
  draft: RepositoryFinalizationDraft,
  repository: string,
): z.infer<typeof projectRepositoryLandingSchema> {
  return {
    repository,
    expected: draft.read,
    landing: draft.finalization,
    pipelinesWritable: {
      expected: draft.pipelinesWritableRead,
      wanted: draft.pipelinesWritable,
    },
  };
}

/** The code the route names a moved setting by. The wire publishes no roster of
 * its error codes, so it is read as the string it arrives as. */
const repositoryFinalizationMovedCode = "RepositoryLandingMoved";

/** What a refusal of the write moved for says. */
export const repositoryFinalizationMovedLine = "Settings moved";

/** The binding as it stands, where the write was refused because a setting
 * moved under it. */
export function repositoryFinalizationMoved(
  failure: ApiFailure | undefined,
): ProjectRepositoryResponse | undefined {
  if (
    failure?.outcome !== "Conflict" ||
    failure.code !== repositoryFinalizationMovedCode
  )
    return undefined;
  const read = projectRepositoryLandingConflictSchema.safeParse(failure.body);
  return read.success ? read.data.repository : undefined;
}

/** The line a refused write is drawn as: a moved setting, or the failure
 * in its word. */
export function repositoryFinalizationRefusal(failure: ApiFailure): string {
  return repositoryFinalizationMoved(failure) === undefined
    ? failureWords(failure).word
    : repositoryFinalizationMovedLine;
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
