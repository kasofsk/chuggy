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
 * repository once one is added, and to both apps there being granted that
 * repository, since the portal app's listing is what the console offers a
 * repository from and the worker app is what a ticket's work is given its
 * credential under; and a runner is waited on only where the project's work
 * goes to runners, and the person's chat host only where their chats in it
 * do. Which repositories the worker app lacks and whether work or a chat
 * waits on a runner are the console's own deciders, so this program and the
 * pages do not say different things. Beside its few words each step that is
 * not done carries what it lacks as a member of a closed set, which is what
 * the next thing is decided from. Nothing is remembered between runs: the
 * server is the record.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ForgeRepositoryResponse,
  ProjectRepositoryListedResponse,
  TicketLandingResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type {
  ForgeAppName,
  PlacementRoute,
} from "../../../../src/contract/rosters.ts";

import type { ApiFailure } from "./apiRequest.ts";
import type { Copy, CopyOrData } from "./copy.ts";
import { forgeAccountRows } from "./forgeInstallation.ts";
import type { ForgeAccountRow } from "./forgeInstallation.ts";
import {
  repositoriesWorkerless,
  repositoryLabel,
} from "./projectRepositories.ts";
import { sessionPlacementShort, sessionRunnerShort } from "./sessionRunners.ts";
import {
  setupBindingMeant,
  setupBootstrapped,
  setupLanding,
  setupPartition,
  setupProjectListed,
} from "./setupReads.ts";
import type {
  SetupChoice,
  SetupGrant,
  SetupRead,
  SetupReads,
  SetupTicketLandings,
} from "./setupReads.ts";
import { setupRepositoryOwner, setupRepositoryRead } from "./setupRemote.ts";
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
  | "portalGrant"
  | "workerGrant"
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
  | {
      readonly lacks: "Grant";
      readonly app: ForgeAppName;
      readonly account: string;
      readonly repository: string;
    }
  | { readonly lacks: "Binding" }
  | { readonly lacks: "Configuration"; readonly repository: string }
  /** `chat` where the person's chat host is lacking too, which `runner` sets up beside the project's runner. */
  | { readonly lacks: "Runner"; readonly chat: boolean }
  | { readonly lacks: "RunnerLive"; readonly chat: boolean }
  /** `pooled` where the project's work goes to runners, which `runner` registers a machine for where it holds no registration of the project. */
  | { readonly lacks: "ChatHost"; readonly pooled: boolean }
  | { readonly lacks: "ChatHostLive"; readonly pooled: boolean }
  | { readonly lacks: "Ticket" }
  | { readonly lacks: "Release"; readonly ticket: number }
  | { readonly lacks: "Dispatch"; readonly ticket: number }
  | {
      readonly lacks: "Landing";
      readonly ticket: number;
      readonly phase: TicketPhase;
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
  readonly found: readonly Copy[];
  /** One a step in order, or none where which project is meant is still open. */
  readonly steps: readonly SetupStep[];
  /** The address of the pull request that writes the repository's own configuration, where the repository meant holds only the bootstrap and the ticket step is done on a ticket whose pull request stands unmerged. */
  readonly unmerged: string | undefined;
}

/**
 * What the program names on the console's pages beside what is pressed there,
 * by the message each page draws it as, so a case holds each against the
 * page.
 */
export const setupSeen = {
  northStar: { id: "lead-settings-section-north-star-title" },
  workspaceNaming: { id: "settings-invite-naming" },
} as const satisfies Readonly<Record<string, Copy>>;

/** Each forge app, as a sentence names it. */
export const setupAppNames: Readonly<Record<ForgeAppName, Copy>> = {
  portal: { id: "setup-app-portal" },
  worker: { id: "setup-app-worker" },
};

/** A phase as a sentence says a ticket is in it: by the name the ticket page gives its step, and by the ticket's standing where no step is named for it — the messages themselves, since the labels that name them reach past what the terminal may load. */
export function setupPhaseSaid(phase: TicketPhase): Copy {
  switch (phase) {
    case "Work":
      return { id: "ticket-steps-phase-work" };
    case "Evaluation":
      return { id: "ticket-steps-phase-evaluation" };
    case "Finalization":
      return { id: "ticket-steps-phase-landing" };
    case "Pending":
      return { id: "standing-pending" };
    case "Done":
      return { id: "standing-done" };
    case "Escalated":
      return { id: "standing-escalated" };
    case "Revoked":
      return { id: "standing-revoked" };
  }
}

/** A done step, said by a name alone or in a few words. */
function setupDone(step: SetupStepName, detail: CopyOrData): SetupStep {
  return { step, state: "done", detail, lacks: undefined };
}

function setupUndone(
  step: SetupStepName,
  state: Exclude<SetupStepState, "done" | "unread">,
  detail: Copy | undefined,
  lacks: SetupLack,
): SetupStep {
  return { step, state, detail, lacks };
}

/** What each read is called where a step says it was not got. */
const setupReadSubjects: Readonly<Record<SetupReadName, Copy>> = {
  workspaces: { id: "setup-read-workspaces" },
  inventory: { id: "setup-read-inventory" },
  settings: { id: "setup-read-settings" },
  installations: { id: "setup-read-installations" },
  portalGrant: { id: "setup-read-portal-grant" },
  workerGrant: { id: "setup-read-worker-grant" },
  repositories: { id: "setup-read-repositories" },
  work: { id: "setup-read-work" },
  placement: { id: "setup-read-placement" },
  tickets: { id: "setup-read-tickets" },
  drafts: { id: "setup-read-drafts" },
  landings: { id: "setup-read-landings" },
};

function setupFateSaid(fate: SetupFate): Copy {
  switch (fate.fate) {
    case "Refused":
      return { id: "setup-fate-refused" };
    case "Cut":
      return { id: "setup-fate-cut" };
    case "Unasked":
      return { id: "setup-fate-unasked" };
    case "Failed":
      return { id: "setup-fate-failed", args: { outcome: fate.outcome } };
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
    detail: {
      id: "setup-step-unread",
      args: { subject: setupReadSubjects[read], fate: setupFateSaid(fate) },
    },
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
          { id: "setup-step-workspace-none" },
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
      {
        id:
          held === undefined
            ? "setup-step-workspace-seen"
            : "setup-step-workspace-member",
        args: { workspace },
      },
      { lacks: "Administration", workspace },
    );
  return truncated
    ? setupUnread("workspace", "workspaces", setupCut)
    : setupUndone(
        "workspace",
        "todo",
        { id: "setup-step-workspace-unnamed", args: { workspace } },
        lacking,
      );
}

/** A workspace with no project to show: said as having none only to an admin, who is shown every project it has. */
function setupProjectless(
  workspace: string,
  project: string | undefined,
  administers: boolean,
): Copy {
  if (project === undefined)
    return {
      id: administers
        ? "setup-step-projectless"
        : "setup-step-projectless-unshown",
      args: { workspace },
    };
  return {
    id: administers
      ? "setup-step-projectless-named"
      : "setup-step-projectless-unshown-named",
    args: { workspace, project },
  };
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
    return setupUndone("project", "todo", undefined, lacking);
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
    return {
      ...unread,
      detail: {
        id: "setup-step-named",
        args: { name, detail: unread.detail ?? "" },
      },
    };
  }
  return settings.value.overrides.northStar === undefined
    ? setupUndone(
        "project",
        "waiting",
        {
          id: "setup-step-north-star",
          args: { project: name, section: setupSeen.northStar },
        },
        { lacks: "NorthStar" },
      )
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
  const binding = setupBindingMeant(read);
  if (binding !== undefined) return { meant: "Repository", binding };
  return read.whole ? { meant: "None" } : { meant: "Unread", fate: setupCut };
}

function setupBoth(row: ForgeAccountRow | undefined): boolean {
  return row?.portal === "Installed" && row.worker === "Installed";
}

function setupAppLackedSaid(
  account: string,
  owned: string | undefined,
  has: ForgeAppName,
  lacks: ForgeAppName,
): Copy {
  const apps = { has: setupAppNames[has], lacks: setupAppNames[lacks] };
  return owned === undefined
    ? { id: "setup-step-app-lacked", args: { account, ...apps } }
    : {
        id: "setup-step-app-lacked-owner",
        args: { account, repository: owned, ...apps },
      };
}

/** An account that does not hold both apps, said by the one it lacks: the worker app where it has the portal app, and the portal app first where it has not. */
function setupAppLacked(
  account: string,
  row: ForgeAccountRow | undefined,
  owned: string | undefined,
): SetupStep {
  const [has, app]: readonly [ForgeAppName, ForgeAppName] =
    row?.portal === "Installed" ? ["portal", "worker"] : ["worker", "portal"];
  const detail: Copy =
    row === undefined
      ? owned === undefined
        ? { id: "setup-step-apps-none", args: { account } }
        : {
            id: "setup-step-apps-none-owner",
            args: { account, repository: owned },
          }
      : setupAppLackedSaid(account, owned, has, app);
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
    ? setupUndone("github", "todo", undefined, { lacks: "Account" })
    : setupAppLacked(nearest.account, nearest, undefined);
}

const setupGrantReads = {
  portal: "portalGrant",
  worker: "workerGrant",
} as const satisfies Readonly<Record<ForgeAppName, SetupReadName>>;

/** One app's listing on the owner's account, as it was got, or the step it leaves not read. */
function setupGrantListed(
  grants: readonly SetupGrant[],
  app: ForgeAppName,
): Extract<SetupGrant["listed"], { readonly read: "Got" }> | SetupStep {
  const listed = grants.find((grant) => grant.app === app)?.listed;
  if (listed?.read === "Got") return listed;
  return setupUnread(
    "github",
    setupGrantReads[app],
    listed === undefined ? { fate: "Unasked" } : setupFateOf(listed),
  );
}

/** The portal app's own entry for a repository, found by what two addresses of one repository have in common. */
function setupGrantEntry(
  listed: readonly ForgeRepositoryResponse[],
  repository: string,
): ForgeRepositoryResponse | undefined {
  const key = setupRepositoryRead(repository)?.key;
  return key === undefined
    ? undefined
    : listed.find((held) => setupRepositoryRead(held.url)?.key === key);
}

/**
 * Both apps on the owner's account, held to the one repository: done where
 * each listing names it, waiting on the app whose whole listing does not, and
 * not read where a listing was not got or was cut short of naming it. Which
 * the worker app lacks is the console's decider over the two listings.
 */
function setupGithubGranted(
  grants: readonly SetupGrant[],
  owner: string,
  address: string,
): SetupStep {
  const repository = repositoryLabel(address);
  const waiting = (app: ForgeAppName): SetupStep =>
    setupUndone(
      "github",
      "waiting",
      {
        id: "setup-step-ungranted",
        args: { app: setupAppNames[app], account: owner, repository },
      },
      { lacks: "Grant", app, account: owner, repository },
    );
  const portal = setupGrantListed(grants, "portal");
  if ("step" in portal) return portal;
  const entry = setupGrantEntry(portal.value, address);
  if (entry === undefined)
    return portal.whole
      ? waiting("portal")
      : setupUnread("github", "portalGrant", setupCut);
  const worker = setupGrantListed(grants, "worker");
  if ("step" in worker) return worker;
  const lacked = repositoriesWorkerless(
    [{ account: owner, repositories: [entry], truncated: false }],
    [{ account: owner, repositories: worker.value, truncated: !worker.whole }],
  );
  if (lacked.includes(entry.url)) return waiting("worker");
  return worker.value.some((held) => held.url === entry.url)
    ? setupDone("github", {
        id: "setup-step-granted",
        args: { account: owner, repository },
      })
    : setupUnread("github", "workerGrant", setupCut);
}

/** Once a repository is added: waiting on the account that owns it where that account lacks an app, and held to what both apps are granted there where it has both. */
function setupGithubOwned(
  reads: SetupReads,
  read: SetupInstallations,
  binding: ProjectRepositoryListedResponse,
): SetupStep {
  const owner = setupRepositoryOwner(binding.repository);
  if (owner === undefined) return setupGithubAny(read);
  const row = forgeAccountRows(read.value).find(
    (held) => held.account === owner,
  );
  if (setupBoth(row))
    return setupGithubGranted(reads.grants, owner, binding.repository);
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
      ? setupUndone("github", "todo", undefined, { lacks: "Account" })
      : setupUnread("github", "installations", setupFateOf(read));
  const meant = setupMeant(reads.repositories);
  switch (meant.meant) {
    case "Repository":
      return setupGithubOwned(reads, read, meant.binding);
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
  const mine: Copy | undefined =
    reads.remote === undefined
      ? undefined
      : { id: "setup-step-remote", args: { remote: reads.remote.said } };
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
            { id: "setup-step-unconfigured", args: { repository } },
            { lacks: "Configuration", repository },
          );
    }
  }
}

/** Whether a project's work runs where no runner of its own is needed, by the console's own decider. */
export function setupHosted(route: PlacementRoute): boolean {
  return sessionRunnerShort(route, "Unregistered") === undefined;
}

/**
 * Done where the project's work has a runner live or the cluster runs it, and
 * the person's chats in it have their chat host live or the cluster runs
 * them; waiting where a runner is registered and is not running. The
 * project's runner is said first, and the person's chat host once it is done.
 */
function setupRunnerStep(reads: SetupReads, none: boolean): SetupStep {
  const work = reads.work;
  if (work.read !== "Got")
    return none
      ? setupUndone("runner", "todo", undefined, {
          lacks: "Runner",
          chat: true,
        })
      : setupUnread("runner", "work", setupFateOf(work));
  const read = reads.placement;
  if (read.read !== "Got")
    return setupUnread("runner", "placement", setupFateOf(read));
  const route = work.value.work.route;
  const mine = sessionPlacementShort(read.value, "thread", "mine");
  const chat = mine !== undefined;
  switch (sessionRunnerShort(route, read.value.runners.project)) {
    case "RunnerOffline":
      return setupUndone(
        "runner",
        "waiting",
        { id: "setup-step-runner-offline" },
        { lacks: "RunnerLive", chat },
      );
    case "NoRunner":
      return setupUndone("runner", "todo", undefined, {
        lacks: "Runner",
        chat,
      });
    case undefined:
      break;
  }
  const pooled = !setupHosted(route);
  const said: Copy = pooled
    ? { id: "setup-step-runner-live" }
    : { id: "setup-step-runner-hosted" };
  switch (mine) {
    case undefined:
      return setupDone("runner", said);
    case "RunnerOffline":
      return setupUndone(
        "runner",
        "waiting",
        { id: "setup-step-chat-host-offline", args: { runner: said } },
        { lacks: "ChatHostLive", pooled },
      );
    case "NoRunner":
      return setupUndone(
        "runner",
        "todo",
        { id: "setup-step-chat-host-none", args: { runner: said } },
        { lacks: "ChatHost", pooled },
      );
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
    case "AwaitingMerge":
    case "Unavailable":
    case "Landed":
    case "Proposed":
      return true;
  }
}

/** The ticket setup is done on, as the ticket step says it, and the address of its pull request where one stands unmerged. */
interface SetupTicketDone {
  readonly detail: Copy;
  readonly unmerged: string | undefined;
}

/** The pull request of a ticket's landings that stands and is not merged, from landings got whole: none where one of them landed, or where the newest that stands says it merged. */
function setupUnmerged(
  held: SetupTicketLandings | undefined,
): string | undefined {
  if (held?.landings.read !== "Got" || !held.landings.whole) return undefined;
  const landings = held.landings.value;
  if (landings.some((landing) => landing.state === "Landed")) return undefined;
  const proposal = landings.findLast(setupProposed)?.proposal;
  return proposal?.merge === "Merged" ? undefined : proposal?.url;
}

/** The ticket setup is done on, where a read that was got shows one, said as what was read of it: a ticket that is done, or a landing that landed or whose pull request stands. */
function setupTicketDone(reads: SetupReads): SetupTicketDone | undefined {
  const [done] = reads.landed.read === "Got" ? reads.landed.value : [];
  if (done !== undefined)
    return {
      detail: {
        id: "setup-step-ticket-done",
        args: { ticket: String(done.ticket) },
      },
      unmerged: setupUnmerged(reads.doneLandings),
    };
  for (const held of reads.landings) {
    if (held.landings.read !== "Got") continue;
    const args = { ticket: String(held.ticket) };
    if (held.landings.value.some((landing) => landing.state === "Landed"))
      return {
        detail: { id: "setup-step-ticket-landed", args },
        unmerged: undefined,
      };
    if (held.landings.value.some(setupProposed))
      return {
        detail: { id: "setup-step-ticket-proposed", args },
        unmerged: setupUnmerged(held),
      };
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
  const args = { ticket: String(ticket) };
  if (phase === "Escalated")
    return setupUndone(
      "ticket",
      "waiting",
      { id: "setup-step-ticket-escalated", args },
      { lacks: "Decision", ticket },
    );
  if (phase === setupUnstartedPhase)
    return setupUndone(
      "ticket",
      "waiting",
      { id: "setup-step-ticket-unstarted", args },
      { lacks: "Dispatch", ticket },
    );
  return setupUndone(
    "ticket",
    "waiting",
    {
      id: "setup-step-ticket-moving",
      args: { ...args, phase: setupPhaseSaid(phase) },
    },
    { lacks: "Landing", ticket, phase },
  );
}

/** Done where a ticket has landed; waiting where one is on its way, escalated, or a draft not yet released. */
function setupTicketStep(
  reads: SetupReads,
  none: boolean,
  done: SetupTicketDone | undefined,
): SetupStep {
  if (done !== undefined) return setupDone("ticket", done.detail);
  if (none)
    return setupUndone("ticket", "todo", undefined, { lacks: "Ticket" });
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
      {
        id: "setup-step-ticket-draft",
        args: { ticket: String(draft.ticket) },
      },
      { lacks: "Release", ticket: draft.ticket },
    );
  return setupUndone("ticket", "todo", undefined, { lacks: "Ticket" });
}

function setupNamed(partition: PartitionIdentity): string {
  return `${partition.tenant}/${partition.project}`;
}

/** What the folder's remote came to among the projects it was looked for in, said of those and of no others, whether or not it proposed one. */
function setupRemoteFound(reads: SetupReads): readonly Copy[] {
  const proposal = reads.proposal;
  if (reads.remote === undefined || proposal.proposal === "Unsought") return [];
  const remote = reads.remote.said;
  const among: Copy =
    proposal.within === undefined
      ? { id: "setup-remote-among" }
      : {
          id: "setup-remote-among-within",
          args: { workspace: proposal.within },
        };
  switch (proposal.proposal) {
    case "Unbound":
      return [{ id: "setup-remote-unbound", args: { remote, among } }];
    case "One":
      return [
        {
          id: "setup-remote-one",
          args: {
            remote,
            among,
            project: setupNamed(proposal.partition),
            workspaceFlag: "--workspace",
            projectFlag: "--project",
          },
        },
      ];
    case "Several":
      return [
        {
          id: "setup-remote-several",
          args: {
            remote,
            among,
            projects: proposal.partitions.map(setupNamed).join(", "),
          },
        },
      ];
    case "Unread":
      return [{ id: "setup-remote-unread", args: { remote, among } }];
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
  if (reads.choice.choice === "Open")
    return { ...standing, steps: [], unmerged: undefined };
  const workspace = setupWorkspaceStep(reads, reads.choice.workspace);
  const project = setupProjectStep(
    reads,
    reads.choice.workspace,
    setupPartition(reads.choice, reads.inventory),
    workspace.state === "done",
  );
  const none = workspace.state === "todo" || project.state === "todo";
  const done = setupTicketDone(reads);
  return {
    ...standing,
    steps: [
      workspace,
      project,
      setupGithubStep(reads, workspace.state === "todo", none),
      setupRepositoryStep(reads, none),
      setupRunnerStep(reads, none),
      setupTicketStep(reads, none, done),
    ],
    unmerged: setupBootstrapped(reads.repositories)
      ? done?.unmerged
      : undefined,
  };
}
