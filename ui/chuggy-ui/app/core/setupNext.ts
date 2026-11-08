/**
 * The one next thing, from where a person stands on each step of setup.
 *
 * The first step that is not done decides it. This program does one step
 * itself, the runner's, and it never prints a `next:` it cannot run, so for
 * every other step what it names is a page of the console by its full address
 * and what is pressed there, and the checklist is read again only once the
 * person says the step is done. The runner's step changes the machine, so it
 * is offered and never run unasked: the person is told what `runner` would
 * put here, a service for the project's work and one for their chat host or
 * whichever of the two is lacking, and the command is named under a rule that
 * waits on their yes; where the machine could not take a runner, they are
 * told that instead.
 * `setupMend` is where each thing a step can lack is turned into its next
 * thing; the slice that gives a step its command changes that step's line
 * there and nowhere else. A tell says of a page only what is pressed there:
 * whether a step is done is this program's to say, from the reads, and never
 * a page's. A step that was not read is said as that: a read the site refused
 * or cut short is the person's to take up, and one that failed is a failure.
 * Where which project is meant is still open, the next thing is the question,
 * one flag at a time.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { Copy, CopyArgument } from "./copy.ts";
import { forgeInstallLabel } from "./forgeInstallation.ts";
import { inviteRoutePath } from "./inviteLinks.ts";
import { projectCreationPathIn } from "./projectCreation.ts";
import {
  repositoryGrantLines,
  repositoryLabel,
} from "./projectRepositories.ts";
import {
  runnerPackageOffered,
  runnerPackages,
  runnerRegisterCommand,
} from "./runners.ts";
import { settingsRoutes } from "./settingsNav.ts";
import type { SetupAnswers } from "./setupArguments.ts";
import type { SetupChoice } from "./setupReads.ts";
import type { SetupNext, SetupThing } from "./setupReport.ts";
import type { SetupRunnerHere } from "./setupRunnerMachine.ts";
import type { SetupClaudeKind } from "./setupRunnerSaid.ts";
import { setupDockerBarredTold, setupEnginesNone } from "./setupRunnerSaid.ts";
import { setupAppNames, setupPhaseSaid, setupSeen } from "./setupStanding.ts";
import type { SetupLack, SetupStanding, SetupStep } from "./setupStanding.ts";
import { setupFlat } from "./setupText.ts";
import { navRoutes } from "./shellNav.ts";

/**
 * What is pressed on the console's pages, by the message each page draws it
 * as, or the program's own where a page spells the name itself. A case reads
 * each page for it and fails where a page renamed it.
 */
export const setupPressed = {
  projectPage: { id: "project-creation-new-title" },
  projectCreate: { id: "project-creation-submit" },
  edit: { id: "ui-edit" },
  save: { id: "ui-save" },
  connect: { id: "repositories-connect-github" },
  add: { id: "repositories-add" },
  retry: { id: "repositories-retry" },
  runner: { id: "runners-add" },
  chatHost: { id: "runners-chat-host-register" },
  ticket: { id: "ticket-authoring-create-ticket" },
  dispatch: { id: "setup-pressed-dispatch" },
  workspaceCreate: { id: "settings-invite-create" },
} as const satisfies Readonly<Record<string, Copy>>;

/** How many names a question lists before it says how many more there are. */
export const setupAskNamesMax = 12;

/** Where the pages a step is done on are: the site, and the workspace and project as far as the checklist is of one. */
interface SetupAt {
  readonly site: string;
  readonly workspace: string;
  readonly project: string;
}

function setupPage(at: SetupAt, route: string): string {
  return `${at.site}${route
    .replace("$tenant", encodeURIComponent(at.workspace))
    .replace("$project", encodeURIComponent(at.project))}`;
}

function setupTicketPage(at: SetupAt, ticket: number): string {
  return `${setupPage(at, navRoutes.overview)}/tickets/${String(ticket)}`;
}

function setupNamed(at: SetupAt): string {
  return `${at.workspace}/${at.project}`;
}

function setupHand(tell: Copy, when: Copy): SetupThing {
  return { thing: "Hand", tell, when };
}

const setupLookAgain: Copy = { id: "setup-runner-when-look-again" };

function setupWorkspaceMend(
  lack: Extract<SetupLack, { readonly lacks: "Workspace" | "Administration" }>,
  at: SetupAt,
): SetupThing {
  if (lack.lacks === "Administration") {
    const { workspace } = lack;
    return setupHand(
      {
        id: "setup-mend-admin-tell",
        args: {
          workspace,
          people: setupPage(at, settingsRoutes.workspace.people),
        },
      },
      { id: "setup-mend-admin-when", args: { workspace } },
    );
  }
  const none: Copy =
    lack.workspace === undefined
      ? { id: "setup-mend-workspace-none" }
      : {
          id: "setup-mend-workspace-unnamed",
          args: { workspace: lack.workspace },
        };
  return setupHand(
    {
      id: "setup-mend-workspace-tell",
      args: {
        none,
        invites: `${at.site}${inviteRoutePath}`,
        naming: setupSeen.workspaceNaming,
        create: setupPressed.workspaceCreate,
      },
    },
    { id: "setup-mend-workspace-when" },
  );
}

function setupProjectMend(
  lack: Extract<SetupLack, { readonly lacks: "Project" | "NorthStar" }>,
  at: SetupAt,
): SetupThing {
  if (lack.lacks === "Project")
    return setupHand(
      {
        id: "setup-mend-project-tell",
        args: {
          page: `${at.site}${projectCreationPathIn(at.workspace)}`,
          named: setupPressed.projectPage,
          create: setupPressed.projectCreate,
        },
      },
      { id: "setup-mend-project-when" },
    );
  return setupHand(
    {
      id: "setup-mend-north-star-tell",
      args: {
        page: setupPage(at, settingsRoutes.project.lead),
        edit: setupPressed.edit,
        section: setupSeen.northStar,
        save: setupPressed.save,
      },
    },
    {
      id: "setup-mend-north-star-when",
      args: { section: setupSeen.northStar },
    },
  );
}

/** An app that is installed and not let into the repository: the picker draws a line for it under its list, with a link to that app's own page on the forge. */
function setupGrantMend(
  lack: Extract<SetupLack, { readonly lacks: "Grant" }>,
  page: string,
): SetupThing {
  const line = repositoryGrantLines[lack.app];
  const app = setupAppNames[lack.app];
  const { account, repository } = lack;
  return setupHand(
    {
      id: "setup-mend-grant-tell",
      args: {
        app,
        account,
        repository,
        page,
        add: setupPressed.add,
        status: line.status,
        label: line.label,
      },
    },
    { id: "setup-mend-grant-when", args: { app, repository } },
  );
}

function setupGithubMend(
  lack: Extract<SetupLack, { readonly lacks: "Account" | "App" | "Grant" }>,
  at: SetupAt,
): SetupThing {
  const page = setupPage(at, navRoutes.repositories);
  const connected: Copy = { id: "setup-mend-github-when" };
  if (lack.lacks === "Grant") return setupGrantMend(lack, page);
  if (lack.lacks === "Account")
    return setupHand(
      {
        id: "setup-mend-account-tell",
        args: { page, connect: setupPressed.connect },
      },
      connected,
    );
  const { account } = lack;
  if (lack.app === "worker")
    return setupHand(
      {
        id: "setup-mend-worker-tell",
        args: { page, install: forgeInstallLabel(lack.app), account },
      },
      { id: "setup-mend-worker-when", args: { account } },
    );
  return setupHand(
    {
      id: "setup-mend-portal-tell",
      args: {
        page: setupPage(at, settingsRoutes.workspace.accounts),
        connect: setupPressed.connect,
        account,
      },
    },
    connected,
  );
}

function setupRepositoryMend(
  lack: Extract<SetupLack, { readonly lacks: "Binding" | "Configuration" }>,
  at: SetupAt,
  mine: string | undefined,
): SetupThing {
  const page = setupPage(at, navRoutes.repositories);
  if (lack.lacks === "Binding")
    return setupHand(
      {
        id: "setup-mend-binding-tell",
        args: {
          page,
          add: setupPressed.add,
          repository:
            mine === undefined
              ? { id: "setup-mend-binding-yours" }
              : { id: "setup-mend-binding-mine", args: { repository: mine } },
        },
      },
      { id: "setup-mend-binding-when" },
    );
  const { repository } = lack;
  return setupHand(
    {
      id: "setup-mend-configuration-tell",
      args: { repository, page, retry: setupPressed.retry },
    },
    {
      id: "setup-mend-configuration-when",
      args: { repository, retry: setupPressed.retry },
    },
  );
}

/** Something `runner` would do on this machine for the checklist's project, which waits on the person's yes. */
function setupOffer(tell: Copy, at: SetupAt): SetupThing {
  const { workspace, project } = at;
  return {
    thing: "Offer",
    tell,
    when: { id: "setup-offer-when" },
    workspace,
    project,
  };
}

/** What work on a runner whose credential is of `kind` runs on, as an offer says it. */
const setupClaudeOn: Readonly<Record<SetupClaudeKind, Copy>> = {
  Subscription: { id: "setup-claude-on-subscription" },
  ApiKey: { id: "setup-claude-on-api-key" },
  Bedrock: { id: "setup-claude-on-bedrock" },
  Vertex: { id: "setup-claude-on-vertex" },
  Foundry: { id: "setup-claude-on-foundry" },
};

const setupRunnerRunning: Copy = { id: "setup-mend-runner-running-when" };

/** Whether a sentence an offer may add is said: `with` where it is. */
function setupWith(said: boolean): string {
  return said ? "with" : "without";
}

/** Where an offer says work here runs: in containers, and on the Claude credential the runner would use, where its settings could be read. */
function setupRunsOn(claude: SetupClaudeKind | undefined): Copy {
  return claude === undefined
    ? { id: "setup-runs-in-containers" }
    : { id: "setup-runs-on", args: { claude: setupClaudeOn[claude] } };
}

/** The runner package an offer would put here, by the name its program goes by. */
const setupProgram = runnerPackageOffered.program;

/** A runner registered and not running: started here on the person's yes where this machine holds a registration for the project, and otherwise theirs to start where it is. */
function setupRunnerLiveMend(
  at: SetupAt,
  here: SetupRunnerHere | undefined,
  chat: boolean,
): SetupThing {
  return here?.held === true
    ? setupOffer(
        {
          id: "setup-mend-runner-live-offer",
          args: {
            project: setupNamed(at),
            runs: setupRunsOn(here.claude),
            program: setupProgram,
            chat: setupWith(chat),
          },
        },
        at,
      )
    : setupHand({ id: "setup-mend-runner-live-tell" }, setupRunnerRunning);
}

/** What `runner` puts here where the project's runner is lacking: its service, and beside it the person's chat host where that is lacking too. */
function setupRunnerPut(
  chat: boolean,
  claude: SetupClaudeKind | undefined,
): Copy {
  const args = { program: setupProgram, runs: setupRunsOn(claude) };
  return chat
    ? { id: "setup-mend-runner-put-chat", args }
    : { id: "setup-mend-runner-put", args };
}

/** How a chat host is registered on a machine `runner` does not set one up on, by each runner package's own commands, with the token the console's page shows in place of `<token>`. */
function setupChatByHand(at: SetupAt): Copy {
  const token = "<token>";
  const linux = runnerRegisterCommand(
    runnerPackages.linux,
    at.site,
    token,
    "ChatHost",
  );
  const darwin = runnerRegisterCommand(
    runnerPackages.darwin,
    at.site,
    token,
    "ChatHost",
  );
  return {
    id: "setup-mend-chat-by-hand",
    args: {
      page: setupPage(at, settingsRoutes.project.myRunner),
      register: setupPressed.chatHost,
      linux,
      darwin,
      agent: `${runnerPackages.darwin.program} install-agent --pool`,
    },
  };
}

/**
 * The person's chat host lacking where the project's work has what it needs.
 * `runner` makes this machine their chat host, which takes their chats in
 * every project of the workspace; it registers this machine for the project's
 * work too where the work goes to runners and this machine holds no
 * registration of the project, and the person is told so.
 */
function setupChatMend(
  lack: Extract<SetupLack, { readonly lacks: "ChatHost" | "ChatHostLive" }>,
  at: SetupAt,
  here: SetupRunnerHere | undefined,
): SetupThing {
  const project = setupNamed(at);
  const chats: Copy = { id: "setup-mend-chats", args: { project } };
  const besides = setupWith(lack.pooled && here?.held !== true);
  const running: Copy = { id: "setup-mend-chat-host-when" };
  if (lack.lacks === "ChatHostLive")
    return here?.chat === true
      ? setupOffer(
          {
            id: "setup-mend-chat-live-offer",
            args: { chats, program: setupProgram, besides, project },
          },
          at,
        )
      : setupHand(
          { id: "setup-mend-chat-live-tell", args: { chats } },
          running,
        );
  if (here?.room.room === "Open")
    return setupOffer(
      {
        id: "setup-mend-chat-offer",
        args: {
          chats,
          program: setupProgram,
          runs: setupRunsOn(here.claude),
          besides,
          project,
        },
      },
      at,
    );
  return setupHand(
    {
      id: "setup-mend-chat-tell",
      args: {
        chats,
        here: here === undefined ? "unseen" : "seen",
        byHand: setupChatByHand(at),
      },
    },
    running,
  );
}

/**
 * No runner yet. Where this machine could take one the person is told what
 * `runner` would put here before it may be run; where it could not, why not;
 * and where the machine was not looked at, the console's own page.
 */
function setupRunnerMend(
  lack: Extract<
    SetupLack,
    { readonly lacks: "Runner" | "RunnerLive" | "ChatHost" | "ChatHostLive" }
  >,
  at: SetupAt,
  here: SetupRunnerHere | undefined,
): SetupThing {
  if (lack.lacks === "ChatHost" || lack.lacks === "ChatHostLive")
    return setupChatMend(lack, at, here);
  if (lack.lacks === "RunnerLive")
    return setupRunnerLiveMend(at, here, lack.chat);
  const page = setupPage(at, navRoutes.runners);
  const add = setupPressed.runner;
  const elsewhere: Copy = {
    id: "setup-mend-runner-elsewhere",
    args: { page, add },
  };
  const instead: Copy = {
    id: "setup-mend-runner-instead",
    args: { page, add },
  };
  const room = here?.room;
  switch (room?.room) {
    case undefined:
      return setupHand(elsewhere, setupRunnerRunning);
    case "Open":
      return setupOffer(
        {
          id: "setup-mend-runner-offer",
          args: { put: setupRunnerPut(lack.chat, here?.claude), page, add },
        },
        at,
      );
    case "Mac":
      return setupHand(
        {
          id: "setup-mend-runner-mac",
          args: { program: runnerPackages.darwin.program, page, add },
        },
        setupRunnerRunning,
      );
    case "Serviceless":
      return setupHand(
        { id: "setup-mend-runner-serviceless", args: { elsewhere } },
        setupRunnerRunning,
      );
    case "Engineless":
    case "DockerBarred":
      return setupRunnerBarredMend(room, instead);
  }
}

/** A machine that could hold a runner once its engine is mended, told what to mend, with `instead` for not mending it. */
function setupRunnerBarredMend(
  room: Extract<
    NonNullable<SetupRunnerHere["room"]>,
    { readonly room: "Engineless" | "DockerBarred" }
  >,
  instead: Copy,
): SetupThing {
  if (room.room === "Engineless")
    return setupHand(
      {
        id: "setup-mend-runner-engineless",
        args: { none: setupEnginesNone(room.asked), instead },
      },
      {
        id: "setup-mend-runner-or-running",
        args: { when: { id: "setup-runner-engineless-when" } },
      },
    );
  const { why, state, mend, when } = setupDockerBarredTold(room.user, room.how);
  return setupHand(
    { id: "setup-mend-runner-docker", args: { why, state, mend, instead } },
    { id: "setup-mend-runner-or-running", args: { when } },
  );
}

function setupTicketMend(
  lack: Extract<
    SetupLack,
    {
      readonly lacks:
        "Ticket" | "Release" | "Dispatch" | "Landing" | "Decision";
    }
  >,
  at: SetupAt,
): SetupThing {
  const create: Copy = {
    id: "setup-mend-ticket-create",
    args: {
      page: setupPage(at, navRoutes.ticketNew),
      create: setupPressed.ticket,
    },
  };
  const created: Copy = { id: "setup-mend-ticket-when" };
  if (lack.lacks === "Ticket")
    return setupHand(
      { id: "setup-mend-ticket-tell", args: { create } },
      created,
    );
  const ticket = String(lack.ticket);
  const page = setupTicketPage(at, lack.ticket);
  switch (lack.lacks) {
    case "Release":
      return setupHand(
        { id: "setup-mend-release-tell", args: { ticket, create } },
        created,
      );
    case "Dispatch":
      return setupHand(
        {
          id: "setup-mend-dispatch-tell",
          args: { ticket, page, dispatch: setupPressed.dispatch },
        },
        { id: "setup-mend-dispatch-when", args: { ticket } },
      );
    case "Landing":
      return setupHand(
        {
          id: "setup-mend-landing-tell",
          args: { ticket, phase: setupPhaseSaid(lack.phase), page },
        },
        setupLookAgain,
      );
    case "Decision":
      return setupHand(
        { id: "setup-mend-decision-tell", args: { ticket, page } },
        { id: "setup-mend-decision-when", args: { ticket } },
      );
  }
}

/** A step that was not read: a failure where the read failed or was never asked, and otherwise the person's to take up with whoever can show it to them. */
function setupUnreadMend(
  lack: Extract<SetupLack, { readonly lacks: "Read" }>,
  step: SetupStep,
): SetupThing {
  const said: Copy = {
    id: "setup-mend-unread-found",
    args: { step: step.step, detail: step.detail ?? "" },
  };
  switch (lack.fate.fate) {
    case "Failed":
      return {
        thing: "Failed",
        found: said,
        stale: lack.fate.outcome === "Unreadable",
      };
    case "Unasked":
      return { thing: "Failed", found: said, stale: false };
    case "Refused":
      return setupHand(
        { id: "setup-mend-unread-refused-tell", args: { step: step.step } },
        { id: "setup-runner-unread-refused-when" },
      );
    case "Cut":
      return setupHand(
        { id: "setup-mend-unread-cut-tell", args: { step: step.step } },
        setupLookAgain,
      );
  }
}

/**
 * How each thing a step lacks is mended: today, by the person, on a page of
 * the console. The slice that can do a step itself changes that step's line
 * here, and what stands on either side of it stays as it is.
 */
function setupMend(
  step: SetupStep,
  lack: SetupLack,
  at: SetupAt,
  mine: string | undefined,
  here: SetupRunnerHere | undefined,
): SetupThing {
  switch (lack.lacks) {
    case "Read":
      return setupUnreadMend(lack, step);
    case "Workspace":
    case "Administration":
      return setupWorkspaceMend(lack, at);
    case "Project":
    case "NorthStar":
      return setupProjectMend(lack, at);
    case "Account":
    case "App":
    case "Grant":
      return setupGithubMend(lack, at);
    case "Binding":
    case "Configuration":
      return setupRepositoryMend(lack, at, mine);
    case "Runner":
    case "RunnerLive":
    case "ChatHost":
    case "ChatHostLive":
      return setupRunnerMend(lack, at, here);
    case "Ticket":
    case "Release":
    case "Dispatch":
    case "Landing":
    case "Decision":
      return setupTicketMend(lack, at);
  }
}

/** Names as a sentence lists them, the last after `or`. */
function setupListed(names: readonly string[]): CopyArgument {
  const flat = names.map(setupFlat);
  const last = flat.at(-1) ?? "";
  return flat.length < 2
    ? last
    : {
        id: "setup-listed",
        args: { names: flat.slice(0, -1).join(", "), last },
      };
}

/** The question a choice still open is put as, with the names it is among as far as the site sent them. */
function setupAsk(
  choice: Extract<SetupChoice, { readonly choice: "Open" }>,
): SetupThing {
  const of: Copy =
    choice.open === "workspace"
      ? { id: "setup-ask-workspace" }
      : {
          id: "setup-ask-project",
          args: { workspace: choice.workspace ?? "" },
        };
  const shown = choice.among.slice(0, setupAskNamesMax);
  const more = choice.among.length - shown.length;
  const names: CopyArgument =
    more > 0
      ? {
          id: "setup-ask-more",
          args: { names: shown.join(", "), more: String(more) },
        }
      : setupListed(shown);
  const args = {
    of,
    whole: choice.whole ? "whole" : "part",
    flag: `--${choice.open}`,
  };
  return {
    thing: "Ask",
    ask:
      shown.length === 0
        ? { id: "setup-ask-unnamed", args }
        : { id: "setup-ask", args: { ...args, names } },
    flag: choice.open,
  };
}

/** The workspace and project a checklist's commands carry: none where there was nothing to choose, and otherwise the choice as far as it is made. */
function setupCarried(
  choice: SetupChoice,
  answers: SetupAnswers,
): SetupAnswers {
  if (choice.choice === "Made")
    return choice.by === "Only"
      ? answers
      : { workspace: choice.workspace, project: choice.project };
  return choice.open === "workspace"
    ? { workspace: undefined, project: answers.project }
    : { workspace: choice.workspace, project: undefined };
}

/** Setup said to be done in the ticket step's own words, so a pull request that was opened is not said to have landed, and with the pull request to merge where one writes the repository's own configuration. */
function setupDoneThing(standing: SetupStanding, at: SetupAt): SetupThing {
  const detail = standing.steps.find((step) => step.step === "ticket")?.detail;
  return {
    thing: "Done",
    tell: {
      id: "setup-done",
      args: {
        project: setupNamed(at),
        how: detail === undefined ? "unsaid" : "said",
        detail: detail ?? "",
        merge: standing.unmerged === undefined ? "merged" : "unmerged",
        url: standing.unmerged ?? "",
        page: setupPage(at, navRoutes.ticketNew),
      },
    },
  };
}

/** What the runner's step can lack, each of which `runner` mends. */
const setupRunnerLacks: readonly SetupLack["lacks"][] = [
  "Runner",
  "RunnerLive",
  "ChatHost",
  "ChatHostLive",
];

/** The project whose runner step is the one next, which is when the machine is looked at before the next thing is named. */
export function setupRunnerDue(
  standing: SetupStanding,
): PartitionIdentity | undefined {
  if (standing.choice.choice === "Open") return undefined;
  const { workspace, project } = standing.choice;
  const lacks = standing.steps.find((step) => step.lacks !== undefined)?.lacks;
  if (lacks === undefined || !setupRunnerLacks.includes(lacks.lacks))
    return undefined;
  return workspace === undefined || project === undefined
    ? undefined
    : { tenant: workspace, project };
}

function setupThing(
  standing: SetupStanding,
  here: SetupRunnerHere | undefined,
): SetupThing {
  if (standing.choice.choice === "Open") return setupAsk(standing.choice);
  const at: SetupAt = {
    site: standing.site,
    workspace: standing.choice.workspace ?? "",
    project: standing.choice.project ?? "",
  };
  const undone = standing.steps.find((step) => step.lacks !== undefined);
  if (undone?.lacks === undefined) return setupDoneThing(standing, at);
  const mine =
    standing.remote === undefined
      ? undefined
      : repositoryLabel(standing.remote.said);
  return setupMend(undone, undone.lacks, at, mine, here);
}

/**
 * Names the one next thing and the choice every command printed with it
 * carries, where `answers` is what the run's own arguments named, which a
 * question about the other name keeps. `here` is what this machine showed
 * where `setupRunnerDue` named a project, and nothing where it was not
 * looked at.
 */
export function setupNext(
  standing: SetupStanding,
  answers: SetupAnswers,
  here?: SetupRunnerHere,
): SetupNext {
  return {
    carried: setupCarried(standing.choice, answers),
    thing: setupThing(standing, here),
  };
}
