/**
 * What a project binds, what it could bind, and what one bind came to.
 *
 * A binding names a repository by the address the forge listing gives it, so
 * "already bound" is decided by that address and by nothing derived from it.
 */

import type {
  ForgeAppsResponse,
  ForgeInstallationResponse,
  ForgeInstallationsResponse,
  ForgeRepositoryResponse,
  ProjectRepositoryConfigurationsResponse,
  ProjectRepositoryConfiguredResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import type { ProjectRepositoryConfigurationDeferralName } from "../../../../src/contract/rosters.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import type { ProjectRepositoryBindAnswer } from "./apiRoutes.ts";
import {
  forgeCreatingAccounts,
  forgePortalInstallations,
} from "./forgeInstallation.ts";
import type { PanelState } from "./freshness.ts";

/**
 * A repository as a row names it. The address is opaque to this console, so
 * the label is its last two path segments, less the `.git` a clone address
 * ends in, where it has them and the whole address where it does not; the
 * address itself is what hovering reveals.
 */
export function repositoryLabel(repository: string): string {
  const segments = repository.split("/").filter((segment) => segment !== "");
  const last = segments.slice(-2);
  return last.length === 2 ? last.join("/").replace(/\.git$/u, "") : repository;
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

/** What the accounts panel draws for a viewer the listing is not shown to,
 * which is anyone who does not administer the workspace. */
export const forgeAccountsWithheld =
  "A workspace admin connects GitHub accounts";

const repositoryOffersNotConfigured = "GitHub not configured · ask an operator";

/**
 * Why Add and Create are not both offered, as the one line drawn under them;
 * nothing where both are, or where a read the answer turns on is in flight.
 * Each line names what is missing or who supplies it, and points at a step only
 * where the page offers that step to this reader.
 */
export function repositoryOffersWithheld(
  accounts: PanelState<ForgeInstallationsResponse>,
  apps: PanelState<ForgeAppsResponse>,
): string | undefined {
  switch (accounts.state) {
    case "Pending":
      return undefined;
    case "Absent":
      return "A workspace admin adds repositories";
    case "Failed":
      return "Accounts failed to load";
    case "Ready": {
      const installations = accounts.value.installations;
      return installations.length === 0
        ? repositoryOffersWithheldUnconnected(apps)
        : repositoryOffersWithheldClaimed(installations);
    }
  }
}

/** No account yet: connecting one is the step, where this deployment can. */
function repositoryOffersWithheldUnconnected(
  apps: PanelState<ForgeAppsResponse>,
): string | undefined {
  switch (apps.state) {
    case "Pending":
      return undefined;
    case "Absent":
      return repositoryOffersNotConfigured;
    case "Failed":
      return "GitHub unavailable";
    case "Ready":
      return apps.value.authorization === undefined
        ? repositoryOffersNotConfigured
        : "Connect a GitHub account first";
  }
}

/**
 * Whether the line Add and Create withhold points at the tenant's own
 * accounts page — true only where this reader has read a tenant holding no
 * account, since every other reason the line withholds (no admin, a read that
 * failed) is not something that page would answer either, and it is the one
 * place that connects one.
 */
export function repositoryOffersPointsAtAccounts(
  accounts: PanelState<ForgeInstallationsResponse>,
): boolean {
  return (
    accounts.state === "Ready" && accounts.value.installations.length === 0
  );
}

/** Add reads under a portal claim and Create needs both apps on one account,
 * which are the tests each button is disabled by. */
function repositoryOffersWithheldClaimed(
  installations: readonly ForgeInstallationResponse[],
): string | undefined {
  if (forgePortalInstallations(installations).length === 0)
    return "No account has the portal app";
  if (forgeCreatingAccounts(installations).length === 0)
    return "No account has both apps";
  return undefined;
}

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

/** What a binding's configuration step draws, and whether asking again could change it. */
export interface RepositoryStepStatus {
  readonly status: string;
  readonly retry: boolean;
}

/**
 * Every deferral as a row draws it. One that asking again cannot clear names
 * who has to act instead, and its row offers no Retry.
 */
export const repositoryDeferrals: Readonly<
  Record<ProjectRepositoryConfigurationDeferralName, RepositoryStepStatus>
> = {
  NotConfigured: {
    status: "No configuration step · ask an operator",
    retry: false,
  },
  NoBootstrapImage: {
    status: "No worker image · ask an operator",
    retry: false,
  },
  DefaultBranchAbsent: {
    status: "Empty repository · push a commit",
    retry: false,
  },
  DefaultBranchUnavailable: { status: "GitHub unavailable", retry: true },
  RepositoryAbsent: { status: "Not bound · bind again", retry: false },
  SnapshotAbsent: { status: "Head unreadable", retry: true },
  SnapshotUnavailable: { status: "GitHub unavailable", retry: true },
  SnapshotRefused: {
    status: "Unreadable configurations · fix the repository",
    retry: false,
  },
  DeclarationsRefused: {
    status: "Invalid configurations · fix the repository",
    retry: false,
  },
  IdentityConflict: {
    status: "Configuration conflict · ask an operator",
    retry: false,
  },
  BootstrapDiffers: {
    status: "Bootstrap differs · add configurations",
    retry: false,
  },
  StaleBinding: { status: "Binding changed", retry: true },
  NotFound: { status: "Project not found · ask an operator", retry: false },
  ParentNotFound: {
    status: "Project not found · ask an operator",
    retry: false,
  },
  StepFailed: { status: "Step failed", retry: true },
};

/** The one line a bind or a create leaves, and whether it offers a first
 * ticket as the next step. */
export interface RepositoryNote {
  readonly status: string;
  readonly ticketOffered: boolean;
}

/** What a repository's configuration step came to as a line, which offers a
 * ticket once the project holds a configuration to file it against. */
export function repositoryConfigurationsNote(
  configurations: ProjectRepositoryConfigurationsResponse,
): RepositoryNote {
  switch (configurations.result) {
    case "Imported":
      return { status: "Configurations imported", ticketOffered: true };
    case "Bootstrapped":
      return { status: "Default configuration added", ticketOffered: true };
    case "Deferred":
      return {
        status: repositoryDeferrals[configurations.reason].status,
        ticketOffered: false,
      };
  }
}

/**
 * What a configuration step asked for again came to on its row. A refusal of
 * the request itself leaves Retry offered unless the binding is retired.
 */
export function repositoryConfigureStatus(
  result: ApiResult<ProjectRepositoryConfiguredResponse>,
): RepositoryStepStatus {
  if (result.outcome === "Ok") {
    const configurations = result.value.configurations;
    switch (configurations.result) {
      case "Imported":
        return { status: "Imported", retry: false };
      case "Bootstrapped":
        return { status: "Added", retry: false };
      case "Deferred":
        return repositoryDeferrals[configurations.reason];
    }
  }
  if (result.outcome === "Conflict")
    return result.code === "RepositoryRetired"
      ? { status: "Retired", retry: false }
      : { status: "Conflict", retry: true };
  if (result.outcome === "Rejected") return { status: "Refused", retry: true };
  return { status: repositoryRefusalStatus(result), retry: true };
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

/** A new binding's line is what its configurations came to, because the
 * picker's row already marks it Bound and it stands whatever that line says. */
export function repositoryBindNote(
  outcome: RepositoryBindOutcome,
): RepositoryNote {
  switch (outcome.outcome) {
    case "Bound":
      return repositoryConfigurationsNote(outcome.configurations);
    case "AlreadyBound":
      return { status: "Already bound", ticketOffered: false };
    case "Refused":
      return { status: outcome.status, ticketOffered: false };
  }
}
