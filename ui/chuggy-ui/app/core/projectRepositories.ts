/**
 * What a project binds, what it could bind, and what one bind or one unbind
 * came to.
 *
 * A binding names a repository by the address the forge listing gives it, so
 * "already bound" is decided by that address and by nothing derived from it,
 * and so is whether the worker app grants what the portal app lists.
 */

import type {
  ForgeAppsResponse,
  ForgeInstallationResponse,
  ForgeInstallationsResponse,
  ForgeRepositoryResponse,
  ProjectRepositoryConfigurationsResponse,
  ProjectRepositoryConfiguredResponse,
  ProjectRepositoryResponse,
  ProjectRepositoryWorkerReachResponse,
  RepositoryConfigurationIgnoredResponse,
} from "../../../../src/contract/responses.ts";
import type {
  ForgeAppName,
  ProjectRepositoryConfigurationDeferralName,
} from "../../../../src/contract/rosters.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import type { ProjectRepositoryBindAnswer } from "./apiRoutes.ts";
import {
  forgePortalInstallations,
  forgeWorkerlessAccounts,
} from "./forgeInstallation.ts";
import type { ForgeReturnWord } from "./forgeReturn.ts";
import type { PanelState } from "./freshness.ts";
import type { WorkRunner } from "./workRunner.ts";

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

/** What one installation was read to grant, under the account it is on. */
export interface InstallationGrant {
  readonly account: string;
  readonly repositories: readonly ForgeRepositoryResponse[];
  readonly truncated: boolean;
}

/**
 * The addresses the portal app grants and the worker app was read not to, on
 * an account both are installed on. A worker listing that was not read, or is
 * not all of what its installation grants, says nothing of what it lacks; an
 * account with no worker installation is the page's own line.
 */
export function repositoriesWorkerless(
  portal: readonly InstallationGrant[],
  worker: readonly InstallationGrant[],
): readonly string[] {
  return portal.flatMap((listed) => {
    const granted = worker.find((grant) => grant.account === listed.account);
    if (granted === undefined || granted.truncated) return [];
    return listed.repositories
      .map((repository) => repository.url)
      .filter((url) => !granted.repositories.some((held) => held.url === url));
  });
}

/** A repository one opening of the picker has drawn, and whether the latest
 * reading still lists it. */
export interface RepositoryDrawn {
  readonly repository: ForgeRepositoryResponse;
  readonly listed: boolean;
}

/**
 * The picker's rows after a reading, from the rows it drew before it. A row
 * once drawn keeps its place, so a reading cannot move another repository
 * under a pointer aimed at it: what the reading lists is drawn as it lists it,
 * what it no longer lists stands unlisted where it stood, and what it brings is
 * drawn after them all in the reading's own order.
 */
export function repositoriesDrawn(
  drawn: readonly RepositoryDrawn[],
  read: readonly ForgeRepositoryResponse[],
): readonly RepositoryDrawn[] {
  const listed = new Map(
    read.map((repository) => [repository.url, repository]),
  );
  const kept = drawn.map((row) => {
    const relisted = listed.get(row.repository.url);
    return relisted === undefined
      ? { repository: row.repository, listed: false }
      : { repository: relisted, listed: true };
  });
  const held = new Set(drawn.map((row) => row.repository.url));
  const brought = read
    .filter((repository) => !held.has(repository.url))
    .map((repository) => ({ repository, listed: true }));
  return [...kept, ...brought];
}

/** One repository the picker draws, whether the latest reading still lists
 * it, whether this project binds it live, and whether the worker app was read
 * not to grant it. */
export interface RepositoryChoice {
  readonly repository: ForgeRepositoryResponse;
  readonly listed: boolean;
  readonly bound: boolean;
  readonly workerless: boolean;
}

/** The picker's rows: what it has drawn of the portal installations' grants,
 * marked against the live bindings and against what the worker app lacks. A
 * retired binding marks nothing, because binding its repository again is a
 * bind the route answers. */
export function repositoryChoices(
  drawn: readonly RepositoryDrawn[],
  bound: readonly ProjectRepositoryResponse[],
  workerless: readonly string[],
): readonly RepositoryChoice[] {
  return drawn.map(({ repository, listed }) => ({
    repository,
    listed,
    bound: bound.some(
      (held) =>
        held.repository === repository.url && held.retiredAt === undefined,
    ),
    workerless: workerless.includes(repository.url),
  }));
}

/** What a row says once the latest reading no longer lists it. */
export const repositoryUnlisted = "Unlisted";

/** What a retired binding is called wherever one is drawn, which is the word
 * of the button that retires one. */
export const repositoryUnbound = "Unbound";

/** The line the picker draws when a listing is not all of what an installation holds. */
export const repositoriesTruncated = "More than shown";

/** What the page and the picker both call a job's app not being where the work is. */
export const repositoryWorkerMissing = "Worker app missing";

/** What a bound row says of the worker app's reach, why, and the forge's page an owner changes it on where it names one. */
export interface RepositoryWorkerReachLine {
  readonly status: string;
  readonly detail: string;
  readonly settingsUrl?: string;
}

/** The line a bound row draws for the reason the worker app cannot be said to reach it. */
export function repositoryWorkerReachLine(
  reach: ProjectRepositoryWorkerReachResponse,
): RepositoryWorkerReachLine {
  switch (reach.reach) {
    case "Unselected":
      return {
        status: repositoryWorkerMissing,
        detail: `The worker app's installation ${reach.installationId} does not select this repository.`,
        settingsUrl: reach.settingsUrl,
      };
    case "Unclaimed":
      return {
        status: repositoryWorkerMissing,
        detail: `No worker app installation is connected on ${reach.account}.`,
      };
    case "Unknown":
      return {
        status: "Worker app unread",
        detail:
          "GitHub did not say whether the worker app reaches this repository.",
      };
  }
}

/** A line under the picker's roster, and what its link to the forge says. */
export interface RepositoryGrantLine {
  readonly status: string;
  readonly label: string;
}

/**
 * The picker's line for a repository an app's installation does not grant, by
 * the app whose own page on the forge grants it: the portal app's for one the
 * roster does not list, and the worker app's for one a row marks.
 */
export const repositoryGrantLines: Readonly<
  Record<ForgeAppName, RepositoryGrantLine>
> = {
  portal: { status: "Not listed · grant it on GitHub", label: "Portal app" },
  worker: {
    status: `${repositoryWorkerMissing} · grant it on GitHub`,
    label: "Worker app",
  },
};

/** What the picker draws under its roster about the worker app, where it has
 * anything to say. */
export type RepositoryWorkerLine = "Reading" | "Missing";

/** The line the picker draws where a row was chosen before the worker app's
 * listings were read, so it is not taken for one the worker app grants. */
export const repositoryWorkerReading = "Worker app · loading…";

/**
 * The worker app's line under the roster, from what it was read not to grant,
 * which is `undefined` until its listings are read. Unread is said only once a
 * row was `chosen`, to the one reader a mark still to come would be late for.
 */
export function repositoryWorkerLine(
  workerless: readonly string[] | undefined,
  chosen: boolean,
): RepositoryWorkerLine | undefined {
  if (workerless === undefined) return chosen ? "Reading" : undefined;
  return workerless.length > 0 ? "Missing" : undefined;
}

/** The roster an opening of the picker draws. */
export interface ForgeReachable {
  readonly repositories: readonly ForgeRepositoryResponse[];
  readonly truncated: boolean;
  /** The addresses among them the worker app was read not to grant, and
   * `undefined` until its listings are read. */
  readonly workerless: readonly string[] | undefined;
}

/** How often an open picker reads its roster again by itself. */
export const repositoryRosterPolledMs = 15_000;

/** How many readings one opening of the picker makes by itself, so a picker
 * left open stops asking the forge. They are held to outlasting the lag a
 * grant was seen to take by `ui/chuggy-ui/test/projectRepositories.test.ts`. */
export const repositoryRosterRereadsMax = 40;

/** How long until an open picker reads its roster again, from how many
 * readings this opening has made by itself, and nothing once they are spent. */
export function repositoryRosterRereadMs(rereads: number): number | undefined {
  return rereads < repositoryRosterRereadsMax
    ? repositoryRosterPolledMs
    : undefined;
}

/** The anchor the page's address opens the picker at. */
export const repositoryAddAnchor = "add";

/** The page's address with the picker open, which is where a grant made from
 * the picker returns to. */
export function repositoryAddReturnPath(path: string): string {
  return `${path}#${repositoryAddAnchor}`;
}

/**
 * The address the page takes in this entry's place once the picker closes or
 * binds: its own without the picker's anchor, so a reload or Back opens none.
 * It is nothing where the address carries no such anchor, a picker opened by a
 * press having moved nothing.
 */
export function repositoryAddClosedPath(
  path: string,
  anchor: string,
): string | undefined {
  return anchor === repositoryAddAnchor ? path : undefined;
}

/**
 * Whether the page opens with the picker open: at the picker's anchor, unless
 * the return brought a word, which is drawn on the page the picker would cover.
 */
export function repositoryAddOpened(
  anchor: string,
  returned: ForgeReturnWord | undefined,
): boolean {
  return anchor === repositoryAddAnchor && returned === undefined;
}

/** What the accounts panel draws for a viewer the listing is not shown to,
 * which is anyone who does not administer the workspace. */
export const forgeAccountsWithheld =
  "A workspace admin connects GitHub accounts";

const repositoryOffersNotConfigured = "GitHub not configured · ask an operator";

/** How a repository comes to be one Add lists, drawn over Add on an empty
 * roster. */
export const repositoryAddHow =
  "Create one on GitHub, install both apps on it, then Add";

/** What this reader takes from the page itself, under the line that names it. */
export const repositoryOffersSteps = ["Connect", "InstallWorker"] as const;

export type RepositoryOffersStep = (typeof repositoryOffersSteps)[number];

/** The one line drawn under Add, and the step drawn under it where the page
 * offers one. */
export interface RepositoryOffersLine {
  readonly status: string;
  readonly step: RepositoryOffersStep | undefined;
}

function repositoryOffersSaid(status: string): RepositoryOffersLine {
  return { status, step: undefined };
}

/**
 * The line under Add: why it is not offered, or that a connected account lacks
 * the worker app, and nothing where neither is so or a read the answer turns on
 * is in flight. It names what is missing or who supplies it, and carries a step
 * only where this reader can take that step.
 */
export function repositoryOffersLine(
  accounts: PanelState<ForgeInstallationsResponse>,
  apps: PanelState<ForgeAppsResponse>,
): RepositoryOffersLine | undefined {
  switch (accounts.state) {
    case "Pending":
      return undefined;
    case "Absent":
      return repositoryOffersSaid("A workspace admin adds repositories");
    case "Failed":
      return repositoryOffersSaid("Accounts failed to load");
    case "Ready": {
      const installations = accounts.value.installations;
      return installations.length === 0
        ? repositoryOffersLineUnconnected(apps)
        : repositoryOffersLineClaimed(installations);
    }
  }
}

/** No account yet: connecting one is the step, where this deployment can. */
function repositoryOffersLineUnconnected(
  apps: PanelState<ForgeAppsResponse>,
): RepositoryOffersLine | undefined {
  switch (apps.state) {
    case "Pending":
      return undefined;
    case "Absent":
      return repositoryOffersSaid(repositoryOffersNotConfigured);
    case "Failed":
      return repositoryOffersSaid("GitHub unavailable");
    case "Ready":
      return apps.value.authorization === undefined
        ? repositoryOffersSaid(repositoryOffersNotConfigured)
        : { status: "Connect a GitHub account first", step: "Connect" };
  }
}

/** Add reads under a portal claim, and a job's credential is minted under the
 * worker app, so the line names the oldest account that lacks it. */
function repositoryOffersLineClaimed(
  installations: readonly ForgeInstallationResponse[],
): RepositoryOffersLine | undefined {
  if (forgePortalInstallations(installations).length === 0)
    return repositoryOffersSaid("No account has the portal app");
  const [workerless] = forgeWorkerlessAccounts(installations);
  return workerless === undefined
    ? undefined
    : {
        status: `${repositoryWorkerMissing} · ${workerless}`,
        step: "InstallWorker",
      };
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

/** The line a bind leaves, whether it offers a first ticket as the next step,
 * and the line under it naming what under `.chug/` the step read none of. */
export interface RepositoryNote {
  readonly status: string;
  readonly ticketOffered: boolean;
  readonly ignored?: string;
}

/** What the entries a configuration step read none of are called wherever
 * they are drawn. */
const repositoryIgnoredLabel = "Not configurations";

/** The entries a configuration step read none of as a line's detail: the
 * first it names, and how many more there are. */
export function repositoryIgnoredDetail(
  ignored: RepositoryConfigurationIgnoredResponse,
): string {
  const [first, ...rest] = ignored.paths;
  if (first === undefined) return "entries in .chug/";
  if (ignored.truncated) return `${first} and ${String(rest.length + 1)}+ more`;
  return rest.length === 0 ? first : `${first} and ${String(rest.length)} more`;
}

/** The line under a step's own naming what it read none of, where there is
 * anything. */
function repositoryConfigurationsNoteIgnored(
  ignored: RepositoryConfigurationIgnoredResponse | undefined,
): { readonly ignored?: string } {
  return ignored === undefined
    ? {}
    : {
        ignored: `${repositoryIgnoredLabel} · ${repositoryIgnoredDetail(ignored)}`,
      };
}

/** What a repository's configuration step came to as a line, which offers a
 * ticket once the project holds a configuration to file it against. */
function repositoryConfigurationsNote(
  configurations: ProjectRepositoryConfigurationsResponse,
): RepositoryNote {
  switch (configurations.result) {
    case "Imported":
      return { status: "Configurations imported", ticketOffered: true };
    case "Bootstrapped":
      return {
        status: "Default configuration added",
        ticketOffered: true,
        ...repositoryConfigurationsNoteIgnored(configurations.ignored),
      };
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
      ? { status: repositoryUnbound, retry: false }
      : { status: "Conflict", retry: true };
  if (result.outcome === "Rejected") return { status: "Refused", retry: true };
  return { status: repositoryRefusalStatus(result), retry: true };
}

/** What Unbind asks before it is sent: the question its confirm is named by,
 * and the line drawn above the press that sends it. */
export interface RepositoryUnbindQuestion {
  readonly question: string;
  readonly line: string;
}

/** The question names the repository, what a new ticket can no longer do with
 * it, what stays of the tickets that named it, and that it is not gone. */
export function repositoryUnbindQuestion(
  repository: string,
): RepositoryUnbindQuestion {
  const label = repositoryLabel(repository);
  return {
    question: `Unbind ${label}?`,
    line: `New tickets can't name ${label}. Existing tickets and their history stay. It can be added again, here or to another project.`,
  };
}

/** The word a refused unbind is drawn as. */
export function repositoryUnbindNote(failure: ApiFailure): string {
  if (failure.outcome === "Rejected") return "Refused";
  if (failure.outcome === "Conflict") return "Conflict";
  return repositoryRefusalStatus(failure);
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

/**
 * A new binding's line is what its configurations came to, because the
 * picker's row already marks it Bound and it stands whatever that line says.
 * Either line names the repository, so a press that bound the wrong one says
 * which.
 */
export function repositoryBindNote(
  outcome: RepositoryBindOutcome,
): RepositoryNote {
  switch (outcome.outcome) {
    case "Bound": {
      const note = repositoryConfigurationsNote(outcome.configurations);
      return {
        ...note,
        status: `${repositoryLabel(outcome.repository)} · ${note.status}`,
      };
    }
    case "AlreadyBound":
      return {
        status: `${repositoryLabel(outcome.repository)} · Already bound`,
        ticketOffered: false,
      };
    case "Refused":
      return { status: outcome.status, ticketOffered: false };
  }
}

/** What a line that offers a first ticket leads to next. */
export type RepositoryNextStep = "AddRunner" | "NewTicket";

/**
 * The step after a line that offers a first ticket: a runner first where the
 * project's work has none to go to. It is nothing while that is unread, so the
 * step is not drawn as one and then the other.
 */
export function repositoryNextStep(
  ticketOffered: boolean,
  runner: WorkRunner,
): RepositoryNextStep | undefined {
  if (!ticketOffered) return undefined;
  switch (runner) {
    case "Held":
      return undefined;
    case "NoRunner":
      return "AddRunner";
    case "Clear":
      return "NewTicket";
  }
}

/**
 * Whether an empty roster carries Add under its line, where it is the one
 * thing to do: an account grants repositories to add, and the line above the
 * roster names no step to take first.
 */
export function repositoryAddLeads(view: {
  readonly bindings: readonly ProjectRepositoryResponse[] | undefined;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly line: RepositoryOffersLine | undefined;
}): boolean {
  return (
    view.bindings?.length === 0 &&
    forgePortalInstallations(view.installations).length > 0 &&
    view.line?.step === undefined
  );
}
