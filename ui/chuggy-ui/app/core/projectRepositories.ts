/**
 * What a project binds, what it could bind, and what one bind came to.
 *
 * A binding names a repository by the address the forge listing gives it, so
 * "already bound" is decided by that address and by nothing derived from it.
 */

import type {
  ForgeRepositoryResponse,
  ProjectRepositoryBoundResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiResult } from "./apiRequest.ts";

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

export type RepositoryBindOutcome =
  | { readonly outcome: "Bound"; readonly repository: string }
  | { readonly outcome: "AlreadyBound"; readonly repository: string }
  | { readonly outcome: "Refused"; readonly status: string };

/**
 * What one bind came to, in the one line the picker draws under itself.
 *
 * WHETHER IT WAS ALREADY BOUND IS THE CONSOLE'S OWN READING. The route answers
 * `201` for a new binding and `200` for one that already stood, and
 * `src/contract/outcomes.ts` classifies both as `Ok` without the status, so the
 * bindings this page already read are what the two are told apart by.
 */
export function repositoryBindOutcome(
  result: ApiResult<ProjectRepositoryBoundResponse>,
  boundBefore: boolean,
): RepositoryBindOutcome {
  switch (result.outcome) {
    case "Ok":
      return boundBefore
        ? { outcome: "AlreadyBound", repository: result.value.repository }
        : { outcome: "Bound", repository: result.value.repository };
    case "Rejected":
      return {
        outcome: "Refused",
        status:
          result.code === "RepositoryNotInstalled" ? "Not installed" : "Refused",
      };
    case "Conflict":
      return {
        outcome: "Refused",
        status:
          result.code === "RepositoryBound" ? "Bound elsewhere" : "Conflict",
      };
    case "Retryable":
      return { outcome: "Refused", status: "Deferring" };
    case "Absent":
      return { outcome: "Refused", status: "Not found" };
    case "Unauthenticated":
      return { outcome: "Refused", status: "Not signed in" };
    case "Fault":
      return { outcome: "Refused", status: "Failed" };
    case "Unreachable":
      return { outcome: "Refused", status: "Unreachable" };
    case "Unreadable":
      return { outcome: "Refused", status: "Unreadable" };
  }
}

/** The one line a bind's outcome is drawn as. */
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
