/**
 * Where a person stands on each step of setup, from one bundle of reads.
 *
 * A step is done, waiting on something named, to do, or not read, and it is
 * never said to be done or to do on a read that was not got: a read that was
 * refused, failed or came back cut short where the rest could change the
 * answer makes the step unread, and says which. The one exception is a step
 * whose reads were never asked, or were refused to a project named in full
 * that no list names, because the workspace or project it belongs to is not
 * there for this person; that step is to do. Two steps turn on more than
 * their own read: GitHub is held to the account that owns the project's
 * repository once one is added, since that account's worker app is what a
 * ticket's work is given its credential under, and a runner is waited on
 * only where the project's work goes to runners, which the console's own
 * decider says. Beside its few words each step that is not done carries what
 * it lacks as a member of a closed set, which is what the next thing is
 * decided from. Nothing is remembered between runs: the server is the record.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ProjectRepositoryListedResponse,
  TicketLandingResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type { ForgeAppName } from "../../../../src/contract/rosters.ts";

import type { ApiFailure } from "./apiRequest.ts";
import { forgeAccountRows } from "./forgeInstallation.ts";
import type { ForgeAccountRow } from "./forgeInstallation.ts";
import { repositoryLabel } from "./projectRepositories.ts";
import { sessionRunnerShort } from "./sessionRunners.ts";
import {
  setupLanding,
  setupPartition,
  setupProjectListed,
} from "./setupReads.ts";
import type { SetupChoice, SetupRead, SetupReads } from "./setupReads.ts";
import { setupRepositoryOwner } from "./setupRemote.ts";
import type { SetupRemote } from "./setupRemote.ts";
import type {
  SetupStepName,
  SetupStepSaid,
  SetupStepState,
} from "./setupReport.ts";

/** The reads a step can be left unread by. */
export type SetupReadName =
  | "workspaces"
  | "inventory"
  | "settings"
  | "installations"
  | "repositories"
  | "work"
  | "placement"
  | "tickets"
  | "drafts"
  | "landings";

/** How a read that left a step unread ended. */
export type SetupFate =
  | { readonly fate: "Refused" }
  | { readonly fate: "Cut" }
  | { readonly fate: "Unasked" }
  | { readonly fate: "Failed"; readonly outcome: ApiFailure["outcome"] };

/** What a step that is not done lacks. */
export type SetupLack =
  | {
      readonly lacks: "Read";
      readonly read: SetupReadName;
      readonly fate: SetupFate;
    }
  | { readonly lacks: "Workspace"; readonly workspace: string | undefined }
  | { readonly lacks: "Administration"; readonly workspace: string }
  | { readonly lacks: "Project" }
  | { readonly lacks: "NorthStar" }
  | { readonly lacks: "Account" }
  | {
      readonly lacks: "App";
      readonly app: ForgeAppName;
      readonly account: string;
    }
  | { readonly lacks: "Binding" }
  | { readonly lacks: "Configuration"; readonly repository: string }
  | { readonly lacks: "Runner" }
  | { readonly lacks: "RunnerLive" }
  | { readonly lacks: "Ticket" }
  | { readonly lacks: "Release"; readonly ticket: number }
  | { readonly lacks: "Dispatch"; readonly ticket: number }
  | {
      readonly lacks: "Landing";
      readonly ticket: number;
      readonly phase: string;
    }
  | { readonly lacks: "Decision"; readonly ticket: number };

type TicketPhase = TicketResponse["phase"];

export interface SetupStep extends SetupStepSaid {
  /** Present exactly where the step is not done. */
  readonly lacks: SetupLack | undefined;
}

export interface SetupStanding {
  readonly site: string;
  readonly choice: SetupChoice;
  readonly remote: SetupRemote | undefined;
  /** What the folder's remote came to, where it was looked for. */
  readonly found: readonly string[];
  /** One a step in order, or none where which project is meant is still open. */
  readonly steps: readonly SetupStep[];
}

function setupDone(step: SetupStepName, detail: string): SetupStep {
  return { step, state: "done", detail, lacks: undefined };
}

function setupUndone(
  step: SetupStepName,
  state: Exclude<SetupStepState, "done" | "unread">,
  detail: string,
  lacks: SetupLack,
): SetupStep {
  return { step, state, detail, lacks };
}

/** What each read is called where a step says it was not got. */
const setupReadSubjects: Readonly<Record<SetupReadName, string>> = {
  workspaces: "your workspaces were",
  inventory: "your projects were",
  settings: "its lead settings were",
  installations: "its GitHub accounts were",
  repositories: "its repositories were",
  work: "where its work runs was",
  placement: "its runners were",
  tickets: "its tickets were",
  drafts: "its drafts were",
  landings: "a ticket's landings were",
};

function setupFateSaid(fate: SetupFate): string {
  switch (fate.fate) {
    case "Refused":
      return "not shown to you";
    case "Cut":
      return "sent only in part";
    case "Unasked":
      return "not read";
    case "Failed":
      return `not answered (${fate.outcome})`;
  }
}

function setupUnread(
  step: SetupStepName,
  read: SetupReadName,
  fate: SetupFate,
): SetupStep {
  return {
    step,
    state: "unread",
    detail: `${setupReadSubjects[read]} ${setupFateSaid(fate)}`,
    lacks: { lacks: "Read", read, fate },
  };
}

const setupCut: SetupFate = { fate: "Cut" };

function setupFateOf(
  read: Exclude<SetupRead<unknown>, { readonly read: "Got" }>,
): SetupFate {
  switch (read.read) {
    case "Refused":
      return { fate: "Refused" };
    case "Unasked":
      return { fate: "Unasked" };
    case "Failed":
      return { fate: "Failed", outcome: read.outcome };
  }
}

/** Done where she is an admin of it; waiting where she is in it, or sees a project of it, and is not. */
function setupWorkspaceStep(
  reads: SetupReads,
  workspace: string | undefined,
): SetupStep {
  const { tenants, truncated } = reads.workspaces;
  const lacking: SetupLack = { lacks: "Workspace", workspace };
  if (workspace === undefined)
    return truncated
      ? setupUnread("workspace", "workspaces", setupCut)
      : setupUndone(
          "workspace",
          "todo",
          "you are in no workspace yet",
          lacking,
        );
  const held = tenants.find((tenant) => tenant.tenant === workspace);
  if (held?.administer === true) return setupDone("workspace", workspace);
  const seen =
    reads.inventory.read === "Got" &&
    reads.inventory.value.some((partition) => partition.tenant === workspace);
  if (held !== undefined || seen)
    return setupUndone(
      "workspace",
      "waiting",
      held === undefined
        ? `${workspace}, where you see a project and are not an admin`
        : `${workspace}, where you are a member and not an admin`,
      { lacks: "Administration", workspace },
    );
  return truncated
    ? setupUnread("workspace", "workspaces", setupCut)
    : setupUndone(
        "workspace",
        "todo",
        `you are in no workspace named ${workspace}`,
        lacking,
      );
}

/** A workspace with no project to show: said as having none only to an admin, who is shown every project it has. */
function setupProjectless(
  workspace: string,
  project: string | undefined,
  administers: boolean,
): string {
  const named = project === undefined ? "" : ` named ${project}`;
  return administers
    ? `${workspace} has no project${named}${project === undefined ? " yet" : ""}`
    : `no project of ${workspace}${named} is shown to you`;
}

/** The project step where no project is read: one that is to do, or a list that was not got or was cut short of saying so. */
function setupProjectUnnamed(
  reads: SetupReads,
  workspace: string | undefined,
  administers: boolean,
): SetupStep {
  const inventory = reads.inventory;
  if (inventory.read !== "Got")
    return setupUnread("project", "inventory", setupFateOf(inventory));
  const lacking: SetupLack = { lacks: "Project" };
  if (workspace === undefined)
    return setupUndone("project", "todo", "", lacking);
  const project =
    reads.choice.choice === "Made" ? reads.choice.project : undefined;
  return inventory.whole
    ? setupUndone(
        "project",
        "todo",
        setupProjectless(workspace, project, administers),
        lacking,
      )
    : setupUnread("project", "inventory", setupCut);
}

/** Whether a project read by its name alone is not there for this person: no list names it, and the site refused both its settings and its tickets. */
function setupProjectAbsent(
  reads: SetupReads,
  partition: PartitionIdentity,
): boolean {
  return (
    !setupProjectListed(reads.inventory, partition) &&
    reads.settings.read === "Refused" &&
    reads.landed.read === "Refused"
  );
}

/** Done where the project is there and its lead settings carry a North Star of its own. */
function setupProjectStep(
  reads: SetupReads,
  workspace: string | undefined,
  partition: PartitionIdentity | undefined,
  administers: boolean,
): SetupStep {
  if (partition === undefined)
    return setupProjectUnnamed(reads, workspace, administers);
  if (setupProjectAbsent(reads, partition))
    return setupUndone(
      "project",
      "todo",
      setupProjectless(partition.tenant, partition.project, administers),
      { lacks: "Project" },
    );
  const name = `${partition.tenant}/${partition.project}`;
  const settings = reads.settings;
  if (settings.read !== "Got") {
    const unread = setupUnread("project", "settings", setupFateOf(settings));
    return { ...unread, detail: `${name}: ${unread.detail}` };
  }
  return settings.value.overrides.northStar === undefined
    ? setupUndone("project", "waiting", `${name} has no North Star yet`, {
        lacks: "NorthStar",
      })
    : setupDone("project", name);
}

/**
 * The repository the GitHub step and the repository step are both said of:
 * the first that is configured, else the first added. `Unread` where the
 * list that would say was not got, or was cut short of a configured one.
 */
type SetupMeant =
  | {
      readonly meant: "Repository";
      readonly binding: ProjectRepositoryListedResponse;
    }
  | { readonly meant: "None" }
  | { readonly meant: "Unread"; readonly fate: SetupFate };

function setupMeant(read: SetupReads["repositories"]): SetupMeant {
  if (read.read !== "Got") return { meant: "Unread", fate: setupFateOf(read) };
  const added = read.value.filter((held) => held.retiredAt === undefined);
  const binding =
    added.find((held) => held.configured) ??
    (read.whole ? added[0] : undefined);
  if (binding !== undefined) return { meant: "Repository", binding };
  return read.whole ? { meant: "None" } : { meant: "Unread", fate: setupCut };
}

function setupBoth(row: ForgeAccountRow | undefined): boolean {
  return row?.portal === "Installed" && row.worker === "Installed";
}

/** An account that does not hold both apps, said by the one it lacks: the worker app where it has the portal app, and the portal app first where it has not. */
function setupAppLacked(
  account: string,
  row: ForgeAccountRow | undefined,
  owned: string | undefined,
): SetupStep {
  const [has, app]: readonly [ForgeAppName, ForgeAppName] =
    row?.portal === "Installed" ? ["portal", "worker"] : ["worker", "portal"];
  const of = owned === undefined ? "" : `, which owns ${owned},`;
  const detail =
    row === undefined
      ? `${account}${of} has neither app`
      : `${account}${of} has the ${has} app, not the ${app} app`;
  return setupUndone("github", "waiting", detail, {
    lacks: "App",
    app,
    account,
  });
}

type SetupInstallations = Extract<
  SetupReads["installations"],
  { readonly read: "Got" }
>;

/** Before a repository is added: done where one account holds both apps; waiting where accounts are connected and none does, said of the one nearest to it. */
function setupGithubAny(read: SetupInstallations): SetupStep {
  const rows = forgeAccountRows(read.value);
  const both = rows.find(setupBoth);
  if (both !== undefined) return setupDone("github", both.account);
  if (!read.whole) return setupUnread("github", "installations", setupCut);
  const nearest = rows.find((row) => row.portal === "Installed") ?? rows[0];
  return nearest === undefined
    ? setupUndone("github", "todo", "", { lacks: "Account" })
    : setupAppLacked(nearest.account, nearest, undefined);
}

/** Once a repository is added: done where the account that owns it holds both apps, and waiting on that account where it does not. */
function setupGithubOwned(
  read: SetupInstallations,
  binding: ProjectRepositoryListedResponse,
): SetupStep {
  const owner = setupRepositoryOwner(binding.repository);
  if (owner === undefined) return setupGithubAny(read);
  const row = forgeAccountRows(read.value).find(
    (held) => held.account === owner,
  );
  if (setupBoth(row)) return setupDone("github", owner);
  return read.whole
    ? setupAppLacked(owner, row, repositoryLabel(binding.repository))
    : setupUnread("github", "installations", setupCut);
}

/** Held to the account that owns the project's repository once one is added, and to any one account before; `none` and `projectless` say the workspace, or the project, is itself to do. */
function setupGithubStep(
  reads: SetupReads,
  none: boolean,
  projectless: boolean,
): SetupStep {
  const read = reads.installations;
  if (read.read !== "Got")
    return none
      ? setupUndone("github", "todo", "", { lacks: "Account" })
      : setupUnread("github", "installations", setupFateOf(read));
  const meant = setupMeant(reads.repositories);
  switch (meant.meant) {
    case "Repository":
      return setupGithubOwned(read, meant.binding);
    case "None":
      return setupGithubAny(read);
    case "Unread":
      return projectless
        ? setupGithubAny(read)
        : setupUnread("github", "repositories", meant.fate);
  }
}

/** Done where the repository meant is configured; waiting where it is added and is not. */
function setupRepositoryStep(reads: SetupReads, none: boolean): SetupStep {
  const mine =
    reads.remote === undefined
      ? ""
      : `${reads.remote.said} (this folder's remote)`;
  const lacking: SetupLack = { lacks: "Binding" };
  const meant = setupMeant(reads.repositories);
  switch (meant.meant) {
    case "Unread":
      return none
        ? setupUndone("repository", "todo", mine, lacking)
        : setupUnread("repository", "repositories", meant.fate);
    case "None":
      return setupUndone("repository", "todo", mine, lacking);
    case "Repository": {
      const repository = repositoryLabel(meant.binding.repository);
      return meant.binding.configured
        ? setupDone("repository", repository)
        : setupUndone(
            "repository",
            "waiting",
            `${repository} is added, its configuration not read yet`,
            { lacks: "Configuration", repository },
          );
    }
  }
}

/** Done where the cluster runs the project's work or a runner of it is live; waiting where one is registered and is not running. */
function setupRunnerStep(reads: SetupReads, none: boolean): SetupStep {
  const lacking: SetupLack = { lacks: "Runner" };
  const work = reads.work;
  if (work.read !== "Got")
    return none
      ? setupUndone("runner", "todo", "", lacking)
      : setupUnread("runner", "work", setupFateOf(work));
  const route = work.value.work.route;
  if (sessionRunnerShort(route, "Unregistered") === undefined)
    return setupDone("runner", "the cluster runs its work");
  const read = reads.placement;
  if (read.read !== "Got")
    return setupUnread("runner", "placement", setupFateOf(read));
  switch (sessionRunnerShort(route, read.value.runners.project)) {
    case undefined:
      return setupDone("runner", "live");
    case "RunnerOffline":
      return setupUndone("runner", "waiting", "registered, not running", {
        lacks: "RunnerLive",
      });
    case "NoRunner":
      return setupUndone("runner", "todo", "", lacking);
  }
}

/** Whether a landing's pull request stands: one it opened, on a landing that has neither failed nor been invalidated. */
function setupProposed(landing: TicketLandingResponse): boolean {
  if (landing.proposal?.url === undefined) return false;
  switch (landing.state) {
    case "Failed":
    case "Invalidated":
      return false;
    case "Running":
    case "Held":
    case "AwaitingApproval":
    case "Unavailable":
    case "Landed":
    case "Proposed":
      return true;
  }
}

/** The ticket that has landed, where a read that was got shows one: a ticket that is done, or a landing that landed or whose pull request stands. */
function setupTicketLanded(reads: SetupReads): string | undefined {
  const [done] = reads.landed.read === "Got" ? reads.landed.value : [];
  if (done !== undefined) return `ticket ${String(done.ticket)} landed`;
  for (const held of reads.landings) {
    if (held.landings.read !== "Got") continue;
    const ticket = `ticket ${String(held.ticket)}`;
    if (held.landings.value.some((landing) => landing.state === "Landed"))
      return `${ticket} landed`;
    if (held.landings.value.some(setupProposed))
      return `${ticket} opened a pull request`;
  }
  return undefined;
}

/** The first of the ticket step's reads that was not got, or was got short of what could show a landing. */
function setupTicketUnread(reads: SetupReads): SetupStep | undefined {
  const asked: readonly (readonly [SetupReadName, SetupRead<unknown>])[] = [
    ["tickets", reads.landed],
    ["tickets", reads.moving],
    ["drafts", reads.drafts],
    ...reads.landings.map((held) => ["landings", held.landings] as const),
  ];
  for (const [name, read] of asked)
    if (read.read !== "Got")
      return setupUnread("ticket", name, setupFateOf(read));
  const short = reads.landings.some(
    (held) => held.landings.read === "Got" && !held.landings.whole,
  );
  if (short) return setupUnread("ticket", "landings", setupCut);
  const cut =
    (reads.moving.read === "Got" && !reads.moving.whole) ||
    setupLanding(reads.moving).length > reads.landings.length;
  return cut ? setupUnread("ticket", "tickets", setupCut) : undefined;
}

/** The phase a ticket is in between its release and its start, where pressing is what starts one nothing else has. */
export const setupUnstartedPhase = "Pending" satisfies TicketPhase;

/** A ticket on its way, by what it waits on: a decision where it is escalated, a start where it is released and not started, and its landing otherwise. */
function setupTicketMoving(ticket: number, phase: TicketPhase): SetupStep {
  const said = `ticket ${String(ticket)}`;
  if (phase === "Escalated")
    return setupUndone("ticket", "waiting", `${said} is escalated`, {
      lacks: "Decision",
      ticket,
    });
  if (phase === setupUnstartedPhase)
    return setupUndone(
      "ticket",
      "waiting",
      `${said} is released, not started`,
      {
        lacks: "Dispatch",
        ticket,
      },
    );
  return setupUndone("ticket", "waiting", `${said} is in ${phase}`, {
    lacks: "Landing",
    ticket,
    phase,
  });
}

/** Done where a ticket has landed; waiting where one is on its way, escalated, or a draft not yet released. */
function setupTicketStep(reads: SetupReads, none: boolean): SetupStep {
  const landed = setupTicketLanded(reads);
  if (landed !== undefined) return setupDone("ticket", landed);
  if (none) return setupUndone("ticket", "todo", "", { lacks: "Ticket" });
  const unread = setupTicketUnread(reads);
  if (unread !== undefined) return unread;
  const [moving] = reads.moving.read === "Got" ? reads.moving.value : [];
  const [draft] = reads.drafts.read === "Got" ? reads.drafts.value : [];
  if (moving !== undefined)
    return setupTicketMoving(moving.ticket, moving.phase);
  if (draft !== undefined)
    return setupUndone(
      "ticket",
      "waiting",
      `ticket ${String(draft.ticket)} is a draft, not released`,
      { lacks: "Release", ticket: draft.ticket },
    );
  return setupUndone("ticket", "todo", "", { lacks: "Ticket" });
}

function setupNamed(partition: PartitionIdentity): string {
  return `${partition.tenant}/${partition.project}`;
}

/** What the folder's remote came to among the projects it could have named, said whether or not it proposed one. */
function setupRemoteFound(reads: SetupReads): readonly string[] {
  if (reads.remote === undefined) return [];
  const said = `this folder's remote ${reads.remote.said}`;
  switch (reads.proposal.proposal) {
    case "Unsought":
      return [];
    case "Unbound":
      return [`${said} is added to none of your projects, so it proposes none`];
    case "One": {
      const name = setupNamed(reads.proposal.partition);
      return [
        `${said} is added to ${name} and to no other project of yours, so this checklist is of ${name}: proposed and not chosen, and --workspace with --project names another`,
      ];
    }
    case "Several":
      return [
        `${said} is added to more than one of your projects (${reads.proposal.partitions.map(setupNamed).join(", ")}), so it proposes none`,
      ];
    case "Unread":
      return [
        `${said} could not be looked for in every project of yours, so it proposes none`,
      ];
  }
}

/**
 * One state a step, in the order the steps are done. A step whose reads were
 * never asked is to do where the workspace or the project it belongs to is
 * itself to do, since a read that was got is what said so.
 */
export function setupStanding(reads: SetupReads): SetupStanding {
  const standing = {
    site: reads.site,
    choice: reads.choice,
    remote: reads.remote,
    found: setupRemoteFound(reads),
  };
  if (reads.choice.choice === "Open") return { ...standing, steps: [] };
  const workspace = setupWorkspaceStep(reads, reads.choice.workspace);
  const project = setupProjectStep(
    reads,
    reads.choice.workspace,
    setupPartition(reads.choice, reads.inventory),
    workspace.state === "done",
  );
  const none = workspace.state === "todo" || project.state === "todo";
  return {
    ...standing,
    steps: [
      workspace,
      project,
      setupGithubStep(reads, workspace.state === "todo", none),
      setupRepositoryStep(reads, none),
      setupRunnerStep(reads, none),
      setupTicketStep(reads, none),
    ],
  };
}
