/**
 * What a project binds, what it could bind, and what one bind came to.
 *
 * A binding names a repository by the address the forge listing gives it, so
 * "already bound" is decided by that address and by nothing derived from it.
 */

import type {
  ForgeRepositoryResponse,
  ProjectRepositoryConfigurationsResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import type { ProjectRepositoryBindAnswer } from "./apiRoutes.ts";

/**
 * A repository as a row names it. The address is opaque to this console, so
 * the label is its last two path segments where it has them and the whole
 * address where it does not; the address itself is what hovering reveals.
 */
export function repositoryLabel(repository: string): string {
  const segments = repository.split("/").filter((segment) => segment !== "");
  const last = segments.slice(-2);
  return last.length === 2 ? last.join("/") : repository;
}

/** One repository an installation grants, and whether this project holds it. */
export interface RepositoryChoice {
  readonly repository: ForgeRepositoryResponse;
  readonly bound: boolean;
}

/** The picker's rows: what the installations grant, marked against the bindings. */
export function repositoryChoices(
  reachable: readonly ForgeRepositoryResponse[],
  bound: readonly ProjectRepositoryResponse[],
): readonly RepositoryChoice[] {
  return reachable.map((repository) => ({
    repository,
    bound: bound.some((held) => held.repository === repository.url),
  }));
}

/** The line the picker draws when a listing is not all of what an installation holds. */
export const repositoriesTruncated = "More than shown";

/**
 * A refusal that says nothing about the repository asked for, which every
 * repository route draws the same way. The refusals that do say something are
 * the ones carrying a code, and each route reads its own.
 */
export function repositoryRefusalStatus(
  refusal: Exclude<
    ApiFailure,
    { readonly outcome: "Rejected" } | { readonly outcome: "Conflict" }
  >,
): string {
  switch (refusal.outcome) {
    case "Retryable":
      return "Deferring";
    case "Absent":
      return "Not found";
    case "Unauthenticated":
      return "Not signed in";
    case "Fault":
      return "Failed";
    case "Unreachable":
      return "Unreachable";
    case "Unreadable":
      return "Unreadable";
  }
}

/**
 * What a newly bound repository's own configurations came to, as the one line
 * drawn beside the binding. A `Deferred` names its reason because the reason
 * is what says whether anything can be done about it.
 */
export function repositoryConfigurationsStatus(
  configurations: ProjectRepositoryConfigurationsResponse,
): string {
  switch (configurations.result) {
    case "Imported":
      return "Imported";
    case "Bootstrapped":
      return "Bootstrapped";
    case "Deferred":
      return `Deferred · ${configurations.reason}`;
  }
}

export type RepositoryBindOutcome =
  | {
      readonly outcome: "Bound";
      readonly repository: string;
      readonly configurations: ProjectRepositoryConfigurationsResponse;
    }
  | { readonly outcome: "AlreadyBound"; readonly repository: string }
  | { readonly outcome: "Refused"; readonly status: string };

/**
 * THE SHAPE IS WHAT TELLS A NEW BINDING FROM ONE THAT STOOD. The route answers
 * `201` carrying the configurations the binding found and `200` carrying the
 * repository alone, and `src/contract/outcomes.ts` keeps neither status, so
 * the body the wire parsed is what the two are told apart by.
 */
export function repositoryBindOutcome(
  result: ApiResult<ProjectRepositoryBindAnswer>,
): RepositoryBindOutcome {
  if (result.outcome === "Ok")
    return "configurations" in result.value
      ? {
          outcome: "Bound",
          repository: result.value.repository,
          configurations: result.value.configurations,
        }
      : { outcome: "AlreadyBound", repository: result.value.repository };
  if (result.outcome === "Rejected")
    return {
      outcome: "Refused",
      status:
        result.code === "RepositoryNotInstalled" ? "Not installed" : "Refused",
    };
  if (result.outcome === "Conflict")
    return {
      outcome: "Refused",
      status:
        result.code === "RepositoryBound" ? "Bound elsewhere" : "Conflict",
    };
  return { outcome: "Refused", status: repositoryRefusalStatus(result) };
}

/** The one word a bind's outcome is drawn as. */
export function repositoryBindStatus(outcome: RepositoryBindOutcome): string {
  switch (outcome.outcome) {
    case "Bound":
      return "Bound";
    case "AlreadyBound":
      return "Already bound";
    case "Refused":
      return outcome.status;
  }
}

/**
 * The lines a bind is drawn as. A new binding carries a second, because its
 * configurations are beside the binding rather than part of it: the binding
 * stands whatever that line says.
 */
export function repositoryBindLines(
  outcome: RepositoryBindOutcome,
): readonly string[] {
  const status = repositoryBindStatus(outcome);
  return outcome.outcome === "Bound"
    ? [status, repositoryConfigurationsStatus(outcome.configurations)]
    : [status];
}
