/**
 * Everything the bare setup program reads of a site, as one bundle, and which
 * project those reads are of.
 *
 * Every read has a fate of its own: got, whole or cut short; refused, which
 * the site says as not found to whoever it will not show a thing to; failed;
 * or never asked, because a read it hangs on was not got. Nothing here turns
 * a read it did not get into an answer. The reads go out through ports that
 * can only read: one bearer for the whole bundle, nothing renewed and nothing
 * forgotten, and a request that is not a read is refused before it is sent.
 * Which project is meant is decided from the same reads: the one there is,
 * the one named, or the one the folder's remote is added to and no other is.
 * The list of projects is read a page at a time for a bounded count of pages,
 * and is whole only where the last page read named no next. A name is taken
 * from it without a question only where it is whole; a project named in full
 * is read by its name where a list short of whole could not have ruled it out.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { projectRepositoriesAnsweredMax } from "../../../../src/contract/http.ts";
import type {
  DraftResponse,
  ExecutionPlacementResponse,
  ForgeInstallationResponse,
  ProjectRepositoryListedResponse,
  SelectorProjectSettingsResponse,
  SessionPlacementResponse,
  TicketLandingResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiFailure, ApiPorts, ApiResult } from "./apiRequest.ts";
import {
  apiDrafts,
  apiExecutionPlacement,
  apiForgeInstallations,
  apiProject,
  apiProjectInventory,
  apiProjectRepositories,
  apiSelectorSettings,
  apiSessionPlacement,
  apiTicketLandings,
  projectInventoryPagesMax,
} from "./apiRoutes.ts";
import type { SetupAnswers } from "./setupArguments.ts";
import { setupRepositoryRead } from "./setupRemote.ts";
import type { SetupRemote } from "./setupRemote.ts";
import type { SetupWorkspacesAnswered } from "./setupSession.ts";

export type SetupRead<T> =
  | { readonly read: "Got"; readonly value: T; readonly whole: boolean }
  | { readonly read: "Refused" }
  | { readonly read: "Failed"; readonly outcome: ApiFailure["outcome"] }
  | { readonly read: "Unasked" };

const setupUnasked = { read: "Unasked" } as const;

/** The status a server that says so refuses a caller with; one that hides what it refuses answers not found. */
const setupForbiddenStatus = 403;

function setupGot<T, V>(
  result: ApiResult<T>,
  value: (answered: T) => V,
  whole: (answered: T) => boolean,
): SetupRead<V> {
  switch (result.outcome) {
    case "Ok":
      return {
        read: "Got",
        value: value(result.value),
        whole: whole(result.value),
      };
    case "Absent":
      return { read: "Refused" };
    case "Rejected":
      return result.status === setupForbiddenStatus
        ? { read: "Refused" }
        : { read: "Failed", outcome: result.outcome };
    case "Unauthenticated":
    case "Conflict":
    case "Retryable":
    case "Fault":
    case "Unreachable":
    case "Unreadable":
      return { read: "Failed", outcome: result.outcome };
  }
}

const setupReadMethod = "GET";

/**
 * The ports the checklist reads through. The bearer is the one the run got
 * while it held the lock, so nothing here renews it or forgets the sign-in,
 * both of which write the session file; and whatever is not a read fails
 * here, having reached nothing.
 */
export function setupReadPorts(api: ApiPorts, bearer: string): ApiPorts {
  return {
    fetch: (url, init) =>
      init.method === setupReadMethod
        ? api.fetch(url, init)
        : Promise.reject(new Error("the checklist sends nothing but reads")),
    bearer: () => Promise.resolve(bearer),
    sleepMs: api.sleepMs,
  };
}

/** What a run is told before it reads: the site, the names its arguments gave, the folder's remote, and the workspaces read that confirmed the sign-in. */
export interface SetupChosen {
  readonly site: string;
  readonly answers: SetupAnswers;
  readonly remote: SetupRemote | undefined;
  readonly workspaces: SetupWorkspacesAnswered;
}

/**
 * Which workspace and project the checklist is of: `Only` where there was
 * nothing to choose, `Named` by the arguments, or `Remote` for the one project
 * this folder's remote is added to. `Open` is a choice only the person makes,
 * one flag at a time, among the names the reads gave.
 */
export type SetupChoice =
  | {
      readonly choice: "Made";
      readonly by: "Only" | "Named" | "Remote";
      readonly workspace: string | undefined;
      readonly project: string | undefined;
    }
  | {
      readonly choice: "Open";
      readonly open: "workspace" | "project";
      readonly workspace: string | undefined;
      readonly among: readonly string[];
      /** Whether `among` is every name there is, and not only what the site sent of them. */
      readonly whole: boolean;
    };

type SetupRepositories = SetupRead<readonly ProjectRepositoryListedResponse[]>;

/** One project the folder's remote could name, and what it has added. */
export interface SetupCandidate {
  readonly partition: PartitionIdentity;
  readonly repositories: SetupRepositories;
}

/** What looking for the folder's remote among the projects came to. */
export type SetupProposal =
  | { readonly proposal: "Unsought" }
  | { readonly proposal: "Unbound" }
  | { readonly proposal: "One"; readonly partition: PartitionIdentity }
  | {
      readonly proposal: "Several";
      readonly partitions: readonly PartitionIdentity[];
    }
  | { readonly proposal: "Unread" };

/** The landings of one ticket that was being landed when the tickets were read. */
export interface SetupTicketLandings {
  readonly ticket: number;
  readonly landings: SetupRead<readonly TicketLandingResponse[]>;
}

export interface SetupReads {
  readonly site: string;
  readonly remote: SetupRemote | undefined;
  readonly workspaces: SetupWorkspacesAnswered;
  readonly inventory: SetupRead<readonly PartitionIdentity[]>;
  readonly proposal: SetupProposal;
  readonly choice: SetupChoice;
  readonly installations: SetupRead<readonly ForgeInstallationResponse[]>;
  readonly settings: SetupRead<SelectorProjectSettingsResponse>;
  readonly repositories: SetupRepositories;
  /** Where the project's work runs, which is what says whether it waits on a runner at all. */
  readonly work: SetupRead<ExecutionPlacementResponse>;
  readonly placement: SetupRead<SessionPlacementResponse>;
  /** A ticket that is done, where the project has one: one is all that is asked for. */
  readonly landed: SetupRead<readonly TicketResponse[]>;
  /** The tickets on their way, most lately moved first. */
  readonly moving: SetupRead<readonly TicketResponse[]>;
  readonly drafts: SetupRead<readonly DraftResponse[]>;
  readonly landings: readonly SetupTicketLandings[];
}

/** The phases a ticket is in between its release and its end, a revoked one being neither on its way nor done. */
export const setupMovingPhases = [
  "Pending",
  "Work",
  "Evaluation",
  "Finalization",
  "Escalated",
] as const satisfies readonly TicketResponse["phase"][];

/** The phase in which a ticket has landings to read. */
export const setupLandingPhase =
  "Finalization" satisfies TicketResponse["phase"];

/** How many projects' repositories are read to see which the folder's remote names; past it nothing is proposed. */
export const setupCandidatesMax = 8;

/** How many tickets' landings are read; a project with more being landed at once is not one being set up. */
export const setupLandingsMax = 3;

function setupNames(names: readonly string[]): readonly string[] {
  return [...new Set(names)].toSorted();
}

/** The lists a choice is made among, with whether each is all there is. */
interface SetupListing {
  readonly answers: SetupAnswers;
  /** The workspaces a role names the person in. */
  readonly joined: readonly string[];
  readonly joinedWhole: boolean;
  readonly inventoried: boolean;
  readonly projects: readonly PartitionIdentity[];
  readonly projectsWhole: boolean;
  /** Every workspace the person is in or sees a project of. */
  readonly workspaces: readonly string[];
}

function setupListing(
  chosen: SetupChosen,
  inventory: SetupReads["inventory"],
): SetupListing {
  const joined = setupNames(
    chosen.workspaces.tenants.map((tenant) => tenant.tenant),
  );
  const projects = inventory.read === "Got" ? inventory.value : [];
  return {
    answers: chosen.answers,
    joined,
    joinedWhole: !chosen.workspaces.truncated,
    inventoried: inventory.read === "Got",
    projects,
    projectsWhole: inventory.read === "Got" && inventory.whole,
    workspaces: setupNames([
      ...joined,
      ...projects.map((partition) => partition.tenant),
    ]),
  };
}

function setupMade(
  by: "Only" | "Named" | "Remote",
  workspace: string | undefined,
  project: string | undefined,
): SetupChoice {
  return { choice: "Made", by, workspace, project };
}

function setupOpenWorkspace(
  among: readonly string[],
  whole: boolean,
): SetupChoice {
  return {
    choice: "Open",
    open: "workspace",
    workspace: undefined,
    among,
    whole,
  };
}

/** With nothing named: the one there is, the one the remote proposes, or the question. */
function setupChoiceUnnamed(
  listing: SetupListing,
  proposed: PartitionIdentity | undefined,
): SetupChoice {
  const [workspace] = listing.workspaces;
  const lone = listing.workspaces.length <= 1 && listing.joinedWhole;
  if (!listing.inventoried)
    return lone
      ? setupMade("Only", workspace, undefined)
      : setupOpenWorkspace(listing.workspaces, listing.joinedWhole);
  if (lone && listing.projectsWhole && listing.projects.length <= 1)
    return setupMade("Only", workspace, listing.projects[0]?.project);
  if (proposed !== undefined)
    return setupMade("Remote", proposed.tenant, proposed.project);
  if (workspace === undefined) return setupMade("Only", undefined, undefined);
  if (!lone)
    return setupOpenWorkspace(
      listing.workspaces,
      listing.joinedWhole && listing.projectsWhole,
    );
  return setupOpenProject(listing, workspace);
}

function setupOpenProject(
  listing: SetupListing,
  workspace: string,
): SetupChoice {
  return {
    choice: "Open",
    open: "project",
    workspace,
    among: setupNames(
      listing.projects
        .filter((partition) => partition.tenant === workspace)
        .map((partition) => partition.project),
    ),
    whole: listing.projectsWhole,
  };
}

/** A workspace settled on before the project is: the one named, or the one a named project is in. */
interface SetupWorkspaceFound {
  readonly choice: "Workspace";
  readonly workspace: string | undefined;
}

function setupWorkspaceFound(
  workspace: string | undefined,
): SetupWorkspaceFound {
  return { choice: "Workspace", workspace };
}

/** The workspace a named project is in where none was named beside it, or the question of which: the one holder is taken only from a list that was whole. */
function setupWorkspaceOf(
  listing: SetupListing,
  project: string,
): SetupWorkspaceFound | SetupChoice {
  const holders = setupNames(
    listing.projects
      .filter((partition) => partition.project === project)
      .map((partition) => partition.tenant),
  );
  if (holders.length > 1 || (holders.length === 1 && !listing.projectsWhole))
    return setupOpenWorkspace(holders, listing.projectsWhole);
  if (holders.length === 1) return setupWorkspaceFound(holders[0]);
  if (listing.workspaces.length <= 1 && listing.joinedWhole)
    return setupWorkspaceFound(listing.workspaces[0]);
  return setupOpenWorkspace(
    listing.workspaces,
    listing.joinedWhole && listing.projectsWhole,
  );
}

function setupChoiceNamed(
  listing: SetupListing,
  proposed: PartitionIdentity | undefined,
): SetupChoice {
  const { workspace: named, project } = listing.answers;
  const found =
    named !== undefined || project === undefined
      ? setupWorkspaceFound(named)
      : setupWorkspaceOf(listing, project);
  if (found.choice !== "Workspace") return found;
  const workspace = found.workspace;
  if (project !== undefined || workspace === undefined || !listing.inventoried)
    return setupMade("Named", workspace, project);
  const within = listing.projects.filter(
    (partition) => partition.tenant === workspace,
  );
  if (within.length <= 1 && listing.projectsWhole)
    return setupMade("Named", workspace, within[0]?.project);
  if (proposed !== undefined)
    return setupMade("Remote", proposed.tenant, proposed.project);
  return setupOpenProject(listing, workspace);
}

function setupChoiceOf(
  listing: SetupListing,
  proposed: PartitionIdentity | undefined,
): SetupChoice {
  return listing.answers.workspace === undefined &&
    listing.answers.project === undefined
    ? setupChoiceUnnamed(listing, proposed)
    : setupChoiceNamed(listing, proposed);
}

/** The projects the folder's remote could name: those the open question is among, where the whole list of them is known. */
function setupCandidates(
  listing: SetupListing,
  choice: SetupChoice,
): readonly PartitionIdentity[] {
  if (choice.choice !== "Open" || !listing.projectsWhole) return [];
  if (listing.answers.project !== undefined) return [];
  return choice.open === "workspace"
    ? listing.projects
    : listing.projects.filter(
        (partition) => partition.tenant === choice.workspace,
      );
}

/** Whether a project has a repository added, and not retired, that is the one an address names. */
export function setupBound(
  repositories: readonly ProjectRepositoryListedResponse[],
  remote: SetupRemote,
): boolean {
  return repositories.some(
    (binding) =>
      binding.retiredAt === undefined &&
      setupRepositoryRead(binding.repository)?.key === remote.key,
  );
}

/** One project is proposed only where every project it could have been was read whole and no other has the remote. */
function setupProposalOf(
  remote: SetupRemote,
  candidates: readonly SetupCandidate[],
): SetupProposal {
  const partitions = candidates
    .filter(
      (candidate) =>
        candidate.repositories.read === "Got" &&
        setupBound(candidate.repositories.value, remote),
    )
    .map((candidate) => candidate.partition);
  const [partition] = partitions;
  if (partitions.length > 1) return { proposal: "Several", partitions };
  const unread = candidates.some(
    (candidate) =>
      candidate.repositories.read !== "Got" || !candidate.repositories.whole,
  );
  if (unread) return { proposal: "Unread" };
  return partition === undefined
    ? { proposal: "Unbound" }
    : { proposal: "One", partition };
}

async function setupRepositoriesRead(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<SetupRepositories> {
  return setupGot(
    await apiProjectRepositories(ports, partition),
    (answered) => answered.repositories,
    (answered) => answered.repositories.length < projectRepositoriesAnsweredMax,
  );
}

interface SetupSought {
  readonly proposal: SetupProposal;
  readonly candidates: readonly SetupCandidate[];
}

async function setupSought(
  ports: ApiPorts,
  remote: SetupRemote | undefined,
  partitions: readonly PartitionIdentity[],
): Promise<SetupSought> {
  if (remote === undefined || partitions.length === 0)
    return { proposal: { proposal: "Unsought" }, candidates: [] };
  if (partitions.length > setupCandidatesMax)
    return { proposal: { proposal: "Unread" }, candidates: [] };
  const candidates = await Promise.all(
    partitions.map(async (partition) => ({
      partition,
      repositories: await setupRepositoriesRead(ports, partition),
    })),
  );
  return { proposal: setupProposalOf(remote, candidates), candidates };
}

type SetupProjectReads = Pick<
  SetupReads,
  | "settings"
  | "repositories"
  | "work"
  | "placement"
  | "landed"
  | "moving"
  | "drafts"
>;

const setupProjectUnasked: SetupProjectReads = {
  settings: setupUnasked,
  repositories: setupUnasked,
  work: setupUnasked,
  placement: setupUnasked,
  landed: setupUnasked,
  moving: setupUnasked,
  drafts: setupUnasked,
};

async function setupProjectRead(
  ports: ApiPorts,
  partition: PartitionIdentity,
  held: SetupRepositories | undefined,
): Promise<SetupProjectReads> {
  const [settings, repositories, work, placement, landed, moving, drafts] =
    await Promise.all([
      apiSelectorSettings(ports, partition),
      held ?? setupRepositoriesRead(ports, partition),
      apiExecutionPlacement(ports, partition),
      apiSessionPlacement(ports, partition),
      apiProject(ports, partition, { phase: ["Done"], limit: 1 }),
      apiProject(ports, partition, {
        phase: setupMovingPhases,
        order: "RecentActivity",
      }),
      apiDrafts(ports, partition, { limit: 1 }),
    ]);
  const all = (): boolean => true;
  return {
    settings: setupGot(settings, (answered) => answered, all),
    repositories,
    work: setupGot(work, (answered) => answered, all),
    placement: setupGot(placement, (answered) => answered, all),
    landed: setupGot(landed, (answered) => answered.tickets, all),
    moving: setupGot(
      moving,
      (answered) => answered.tickets,
      (answered) =>
        answered.nextCursor === undefined && answered.nextAfter === undefined,
    ),
    drafts: setupGot(drafts, (answered) => answered.drafts, all),
  };
}

/** The tickets whose landings say whether one has landed: those being landed, up to the bound. */
export function setupLanding(
  moving: SetupReads["moving"],
): readonly TicketResponse[] {
  return moving.read === "Got"
    ? moving.value.filter((ticket) => ticket.phase === setupLandingPhase)
    : [];
}

async function setupLandingsRead(
  ports: ApiPorts,
  partition: PartitionIdentity,
  moving: SetupReads["moving"],
): Promise<readonly SetupTicketLandings[]> {
  return Promise.all(
    setupLanding(moving)
      .slice(0, setupLandingsMax)
      .map(async (ticket) => ({
        ticket: ticket.ticket,
        landings: setupGot(
          await apiTicketLandings(ports, partition, ticket.ticket),
          (answered) => answered.landings,
          (answered) => !answered.truncated,
        ),
      })),
  );
}

/** Whether the list of projects, as far as it was got, names the one a workspace and a project name together. */
export function setupProjectListed(
  inventory: SetupReads["inventory"],
  named: PartitionIdentity,
): boolean {
  return (
    inventory.read === "Got" &&
    inventory.value.some(
      (partition) =>
        partition.tenant === named.tenant &&
        partition.project === named.project,
    )
  );
}

/**
 * The project a made choice names in full, which is the one its reads are
 * of: none where a list that was whole does not name it, and otherwise the
 * one named, listed or not, since a list short of whole rules nothing out.
 */
export function setupPartition(
  choice: SetupChoice,
  inventory: SetupReads["inventory"],
): PartitionIdentity | undefined {
  if (choice.choice !== "Made") return undefined;
  const { workspace: tenant, project } = choice;
  if (tenant === undefined || project === undefined) return undefined;
  const named = { tenant, project };
  const ruledOut =
    inventory.read === "Got" &&
    inventory.whole &&
    !setupProjectListed(inventory, named);
  return ruledOut ? undefined : named;
}

async function setupChosenRead(
  ports: ApiPorts,
  choice: SetupChoice,
  inventory: SetupReads["inventory"],
  candidates: readonly SetupCandidate[],
): Promise<SetupProjectReads & Pick<SetupReads, "installations" | "landings">> {
  const partition = setupPartition(choice, inventory);
  const held = candidates.find(
    (candidate) =>
      candidate.partition.tenant === partition?.tenant &&
      candidate.partition.project === partition.project,
  )?.repositories;
  const [installations, project] = await Promise.all([
    choice.choice === "Made" && choice.workspace !== undefined
      ? apiForgeInstallations(ports, choice.workspace).then((answered) =>
          setupGot(
            answered,
            (value) => value.installations,
            (value) => !value.truncated,
          ),
        )
      : setupUnasked,
    partition === undefined
      ? setupProjectUnasked
      : setupProjectRead(ports, partition, held),
  ]);
  const landings =
    partition === undefined
      ? []
      : await setupLandingsRead(ports, partition, project.moving);
  return { ...project, installations, landings };
}

/**
 * The projects the person is shown, a page at a time for as many pages as the
 * console reads of them: whole where the last page read named no next, and
 * whatever a page that was not got came to where one was not.
 */
async function setupInventoryRead(
  ports: ApiPorts,
): Promise<SetupReads["inventory"]> {
  const projects: PartitionIdentity[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < projectInventoryPagesMax; page += 1) {
    const read = setupGot(
      await apiProjectInventory(ports, { cursor }),
      (answered) => answered,
      () => true,
    );
    if (read.read !== "Got") return read;
    projects.push(...read.value.projects);
    cursor = read.value.nextCursor;
    if (cursor === undefined) break;
  }
  return { read: "Got", value: projects, whole: cursor === undefined };
}

/**
 * Reads where a person stands: their projects, then which of them is meant,
 * then that project's own reads at once, then the landings of whatever was
 * being landed. A read that hangs on one that was not got is not asked.
 */
export async function readSetup(
  ports: ApiPorts,
  chosen: SetupChosen,
): Promise<SetupReads> {
  const inventory = await setupInventoryRead(ports);
  const listing = setupListing(chosen, inventory);
  const sought = await setupSought(
    ports,
    chosen.remote,
    setupCandidates(listing, setupChoiceOf(listing, undefined)),
  );
  const choice = setupChoiceOf(
    listing,
    sought.proposal.proposal === "One" ? sought.proposal.partition : undefined,
  );
  return {
    site: chosen.site,
    remote: chosen.remote,
    workspaces: chosen.workspaces,
    inventory,
    proposal: sought.proposal,
    choice,
    ...(await setupChosenRead(ports, choice, inventory, sought.candidates)),
  };
}
