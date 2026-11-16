/**
 * The one next thing, from where a person stands on each step of setup.
 *
 * The first step that is not done decides it. This program does three steps
 * itself, the project's, the MCP step's and the runner's, and it never prints
 * a `next:` it cannot run, so for every other step but one what it names is a
 * page of the console by its full address and what is pressed there, and the
 * checklist is read again only once the person says the step is done. A
 * project is made by `project` once the person has said what to call it, so
 * where one is lacking the next thing is that question. A repository holding
 * no configuration of its own is the one other: its configuration is written
 * in the checkout by the person's agent with them, through `configuration`,
 * `check` and `import`, and no page is pressed for it. Where the project
 * holds no repository and both apps are granted the folder's own, `bind`
 * adds it on the person's yes, and where an app is not, the tell names that
 * app's page on the forge and no page of the console. Where the project has
 * no ticket yet and what a ticket may be drawn under was read, the person is
 * asked what they want done first, and `ticket` files it, with the
 * configuration they choose where there is a choice; where that read came to
 * nothing, the console's New ticket page is the way. The MCP step and the
 * runner's change the machine, so each is offered and never run unasked: the
 * person is told what `mcp` would do, the runner package installed where it
 * is not here and its server named in their agent, and for the runner's step
 * they are told what `runner` would put here, a service for the project's
 * work and one for their chat host or the first alone, or, where their chat
 * host is all that is lacking, what `chat-host` would; the command is named
 * under a rule that waits on their yes; where the machine could not take a runner, they are told that instead.
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
import type { RepositoryConfigurationImportAttemptResponse } from "../../../../src/contract/responses.ts";
import { forgeApps } from "../../../../src/contract/rosters.ts";
import type { Copy, CopyArgument } from "./copy.ts";
import { forgeInstallLabel } from "./forgeInstallation.ts";
import { inviteRoutePath } from "./inviteLinks.ts";
import {
  repositoryGrantLines,
  repositoryLabel,
} from "./projectRepositories.ts";
import { ownerFallbackLabel } from "./myRunner.ts";
import { runnerPackageOffered, runnerPackages } from "./runners.ts";
import { settingsRoutes } from "./settingsNav.ts";
import {
  repositoryImportRefusedFile,
  repositoryImportWord,
  repositoryImportWordLabel,
} from "./repositoryImport.ts";
import { setupNameFlag } from "./setupArguments.ts";
import { setupConfigurationPath } from "./setupConfiguration.ts";
import type { SetupAnswers } from "./setupArguments.ts";
import type { SetupChoice } from "./setupReads.ts";
import type { SetupNext, SetupThing } from "./setupReport.ts";
import type { SetupRunnerHere } from "./setupRunnerMachine.ts";
import type { SetupTicketOffers } from "./setupTicket.ts";
import type { SetupClaudeKind } from "./setupRunnerSaid.ts";
import {
  setupChatByHand,
  setupChatHostPressed,
  setupDockerBarredTold,
  setupEnginesNone,
} from "./setupRunnerSaid.ts";
import { setupAppNames, setupPhaseSaid, setupSeen } from "./setupStanding.ts";
import type {
  SetupAppPage,
  SetupLack,
  SetupStanding,
  SetupStep,
} from "./setupStanding.ts";
import { setupFlat } from "./setupText.ts";
import { navRoutes } from "./shellNav.ts";
import { workspaceNamesListed } from "./workspaceNames.ts";
import type { WorkspaceNamed } from "./workspaceNames.ts";

/**
 * What is pressed on the console's pages, by the message each page draws it
 * as, or the program's own where a page spells the name itself. A case reads
 * each page for it and fails where a page renamed it.
 */
export const setupPressed = {
  edit: { id: "ui-edit" },
  save: { id: "ui-save" },
  connect: { id: "repositories-connect-github" },
  addAccount: { id: "settings-accounts-add" },
  add: { id: "repositories-add" },
  runner: { id: "runners-register" },
  runnerProject: { id: "runners-personal-project-add" },
  fallback: { id: "runners-fallback-title" },
  chatHost: setupChatHostPressed,
  ticket: { id: "ticket-authoring-create-ticket" },
  dispatch: { id: "setup-pressed-dispatch" },
} as const satisfies Readonly<Record<string, Copy>>;

/** How many names a question lists before it says how many more there are. */
export const setupAskNamesMax = 12;

/** Where the pages a step is done on are: the site, and the workspace and project as far as the checklist is of one; `named` is what a sentence calls a workspace. */
interface SetupAt {
  readonly site: string;
  readonly workspace: string;
  readonly project: string;
  readonly named: WorkspaceNamed;
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
  return `${at.named(at.workspace)}/${at.project}`;
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
    const workspace = at.named(lack.workspace);
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
      },
    },
    { id: "setup-mend-workspace-when" },
  );
}

function setupProjectMend(
  lack: Extract<SetupLack, { readonly lacks: "Project" | "NorthStar" }>,
  at: SetupAt,
): SetupThing {
  if (lack.lacks === "Project") {
    const { workspace, project } = at;
    const address = project === "" ? undefined : project;
    return {
      thing: "Name",
      ask: {
        id: "setup-ask-project-name",
        args: {
          workspace: at.named(workspace),
          address: address === undefined ? "made" : "given",
          project: address ?? "",
          flag: setupNameFlag,
        },
      },
      workspace,
      project: address,
    };
  }
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

/** The folder's repository by its remote, or the person's where it has none. */
function setupMendBindingSaid(mine: string | undefined): Copy {
  return mine === undefined
    ? { id: "setup-mend-binding-yours" }
    : { id: "setup-mend-binding-mine", args: { repository: mine } };
}

function setupGithubMend(
  lack: Extract<SetupLack, { readonly lacks: "Account" | "App" | "Grant" }>,
  at: SetupAt,
  mine: string | undefined,
): SetupThing {
  const page = setupPage(at, navRoutes.repositories);
  const connected: Copy = { id: "setup-mend-github-when" };
  if (lack.lacks === "Grant") return setupGrantMend(lack, page);
  if (lack.lacks === "Account")
    return setupHand(
      {
        id: "setup-mend-account-tell",
        args: {
          page,
          connect: setupPressed.connect,
          repository: setupMendBindingSaid(mine),
        },
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

/**
 * An app as a line of the tell names it: with its settings page on the forge,
 * or with the press on the workspace's accounts page that installs it. The
 * worker app's install is on the row of an account holding the portal app, so
 * where the portal app is to be installed there too, its row is waited on.
 */
function setupAppPageSaid(
  page: SetupAppPage,
  pages: readonly SetupAppPage[],
  at: SetupAt,
): Copy {
  const app = setupAppNames[page.app];
  if (page.page === "Settings")
    return {
      id: "setup-mend-reach-settings",
      args: { app, page: page.settings },
    };
  const accounts = setupPage(at, settingsRoutes.workspace.accounts);
  const { account } = page;
  if (page.app === "portal")
    return {
      id: "setup-mend-reach-install-portal",
      args: { app, page: accounts, press: setupPressed.addAccount, account },
    };
  const after = pages.some(
    (other) => other.app === "portal" && other.page === "Install",
  );
  const press = forgeInstallLabel("worker");
  return after
    ? {
        id: "setup-mend-reach-install-worker-after",
        args: { app, press, account },
      }
    : {
        id: "setup-mend-reach-install-worker",
        args: { app, page: accounts, press, account },
      };
}

/**
 * The folder's repository before it is added: where both apps are granted it,
 * `bind` adds it on the person's yes, as the console's Add does; where an app
 * is not, every such app is named in the one tell with where it is given it,
 * and the checklist is read again once the person says they are done there.
 * Where what the apps grant was not read, the console's Add is the way.
 */
function setupBindingMend(
  lack: Extract<SetupLack, { readonly lacks: "Binding" }>,
  at: SetupAt,
  mine: string | undefined,
): SetupThing {
  const reach = lack.reach;
  if (reach?.reach === "Granted")
    return {
      thing: "Offer",
      command: "Bind",
      tell: {
        id: "setup-mend-bind-offer",
        args: { repository: reach.repository, project: setupNamed(at) },
      },
      when: {
        id: "setup-offer-bind-when",
        args: { repository: reach.repository },
      },
      workspace: at.workspace,
      project: at.project,
    };
  if (reach?.reach === "Ungranted") {
    if (reach.apps.length < 1 || reach.apps.length > forgeApps.length)
      throw new Error("a tell of the apps not granted names one or both");
    const [first, second] = reach.apps.map((page) =>
      setupAppPageSaid(page, reach.apps, at),
    );
    return setupHand(
      {
        id: "setup-mend-reach-tell",
        args: {
          repository: reach.repository,
          count: second === undefined ? "one" : "two",
          first: first ?? "",
          second: second ?? "",
        },
      },
      { id: "setup-mend-reach-when", args: { repository: reach.repository } },
    );
  }
  return setupHand(
    {
      id: "setup-mend-binding-tell",
      args: {
        page: setupPage(at, navRoutes.repositories),
        add: setupPressed.add,
        repository: setupMendBindingSaid(mine),
      },
    },
    { id: "setup-mend-binding-when" },
  );
}

function setupRepositoryMend(
  lack: Extract<SetupLack, { readonly lacks: "Binding" | "Configuration" }>,
  at: SetupAt,
  mine: string | undefined,
): SetupThing {
  return lack.lacks === "Binding"
    ? setupBindingMend(lack, at, mine)
    : setupConfigurationMend(lack, at);
}

/** What the import of the repository last came to, as the line on the repositories page says it, where one finished. */
function setupLastImport(
  lastImport: RepositoryConfigurationImportAttemptResponse | undefined,
): Copy {
  if (lastImport === undefined) return { id: "setup-mend-configuration-never" };
  const word = repositoryImportWordLabel(repositoryImportWord(lastImport));
  const file = repositoryImportRefusedFile(lastImport);
  return file === undefined
    ? { id: "setup-mend-configuration-last", args: { word } }
    : { id: "setup-mend-configuration-last-file", args: { word, file } };
}

/**
 * The repository holding no configuration of its own: written, filled in,
 * checked, committed and pushed by the person's agent with the person, then
 * imported by `import`, which reads the checklist again. What the site said
 * of the last import is said with it.
 */
function setupConfigurationMend(
  lack: Extract<SetupLack, { readonly lacks: "Configuration" }>,
  at: SetupAt,
): SetupThing {
  return {
    thing: "Configure",
    tell: {
      id: "setup-mend-configuration-tell",
      args: {
        repository: lack.repository,
        last: setupLastImport(lack.lastImport),
        path: setupConfigurationPath,
      },
    },
    workspace: at.workspace,
    project: at.project,
  };
}

/** Something `runner` would do on this machine for the checklist's project, which waits on the person's yes. */
function setupOffer(tell: Copy, at: SetupAt): SetupThing {
  const { workspace, project } = at;
  return {
    thing: "Offer",
    command: "Runner",
    tell,
    when: { id: "setup-offer-when" },
    workspace,
    project,
  };
}

/**
 * The agent's MCP server for the checklist's project, which `mcp` names in
 * its configuration on the person's yes, installing the runner package first
 * where `packaged` says none here is one it leaves as it is.
 */
function setupMcpMend(at: SetupAt, packaged: boolean): SetupThing {
  const { site, workspace, project } = at;
  return {
    thing: "Offer",
    command: "Mcp",
    tell: {
      id: packaged ? "setup-mend-mcp-offer" : "setup-mend-mcp-offer-package",
      args: { project: setupNamed(at), site, program: setupProgram },
    },
    when: { id: "setup-offer-mcp-when" },
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

/** Something `chat-host` would do on this machine for the checklist's workspace, which waits on the person's yes. */
function setupChatOffer(tell: Copy, at: SetupAt): SetupThing {
  return {
    thing: "Offer",
    command: "ChatHost",
    tell,
    when: { id: "setup-offer-chat-host-when" },
    workspace: at.workspace,
    project: undefined,
  };
}

/**
 * The person's chat host lacking where the project's work has what it needs.
 * `chat-host` makes this machine their chat host, which takes their chats in
 * every project of the workspace, and registers no runner of the project.
 */
function setupChatMend(
  lack: Extract<SetupLack, { readonly lacks: "ChatHost" | "ChatHostLive" }>,
  at: SetupAt,
  here: SetupRunnerHere | undefined,
): SetupThing {
  const project = setupNamed(at);
  const chats: Copy = { id: "setup-mend-chats", args: { project } };
  const running: Copy = { id: "setup-mend-chat-host-when" };
  if (lack.lacks === "ChatHostLive")
    return here?.chat === true
      ? setupChatOffer(
          {
            id: "setup-mend-chat-live-offer",
            args: { chats, program: setupProgram },
          },
          at,
        )
      : setupHand(
          { id: "setup-mend-chat-live-tell", args: { chats } },
          running,
        );
  if (here?.room.room === "Open")
    return setupChatOffer(
      {
        id: "setup-mend-chat-offer",
        args: {
          chats,
          program: setupProgram,
          runs: setupRunsOn(here.claude),
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
        byHand: setupChatByHand(setupPage(at, settingsRoutes.project.myRunner)),
      },
    },
    running,
  );
}

/**
 * What a runner of the person's own, registered by hand on Personal runners,
 * needs there before it takes the project's work: the project given to it,
 * and where the project names no owner fallback, one set on its Placement
 * page, which the person is told of and this program never sets.
 */
function setupRunnerServes(at: SetupAt, named: boolean): Copy {
  const choose = setupPressed.runnerProject;
  const project = at.project;
  if (named)
    return { id: "setup-mend-runner-serves", args: { choose, project } };
  return {
    id: "setup-mend-runner-serves-unnamed",
    args: {
      choose,
      project,
      placement: setupPage(at, settingsRoutes.project.placement),
      setting: setupPressed.fallback,
      strict: ownerFallbackLabel("Strict"),
      preferred: ownerFallbackLabel("Preferred"),
    },
  };
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
  const page = setupPage(at, settingsRoutes.project.myRunner);
  const add = setupPressed.runner;
  const serves = setupRunnerServes(at, lack.named);
  const elsewhere: Copy = {
    id: "setup-mend-runner-elsewhere",
    args: { page, add, serves },
  };
  const instead: Copy = {
    id: "setup-mend-runner-instead",
    args: { page, add, serves },
  };
  const room = here?.room;
  switch (room?.room) {
    case undefined:
      return setupHand(elsewhere, setupRunnerRunning);
    case "Open":
      return setupOffer(
        {
          id: "setup-mend-runner-offer",
          args: {
            put: setupRunnerPut(lack.chat, here?.claude),
            page,
            add,
            serves,
          },
        },
        at,
      );
    case "Mac":
      return setupHand(
        {
          id: "setup-mend-runner-mac",
          args: {
            program: runnerPackages.darwin.program,
            page,
            add,
            serves,
          },
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

/** What the person wants done first, asked with the configurations they choose among where there is a choice, and the console's page named for writing it themselves. */
function setupBriefAsked(
  at: SetupAt,
  offers: SetupTicketOffers,
  create: Copy,
): SetupThing {
  return {
    thing: "Brief",
    ask: {
      id: "setup-ask-ticket",
      args: {
        project: setupNamed(at),
        choose: offers.choose ? "choose" : "given",
        names: setupListed(offers.names),
        create,
      },
    },
    workspace: at.workspace,
    project: at.project,
    choose: offers.choose,
  };
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
  offers: SetupTicketOffers | undefined,
): SetupThing {
  const create: Copy = {
    id: "setup-mend-ticket-create",
    args: {
      page: setupPage(at, navRoutes.ticketNew),
      create: setupPressed.ticket,
    },
  };
  const created: Copy = { id: "setup-mend-ticket-when" };
  if (lack.lacks === "Ticket" && offers !== undefined)
    return setupBriefAsked(at, offers, create);
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
          id: "setup-mend-finalization-tell",
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
  packaged: boolean,
  offers: SetupTicketOffers | undefined,
): SetupThing {
  switch (lack.lacks) {
    case "Read":
      return setupUnreadMend(lack, step);
    case "Mcp":
      return setupMcpMend(at, packaged);
    case "Workspace":
    case "Administration":
      return setupWorkspaceMend(lack, at);
    case "Project":
    case "NorthStar":
      return setupProjectMend(lack, at);
    case "Account":
    case "App":
    case "Grant":
      return setupGithubMend(lack, at, mine);
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
      return setupTicketMend(lack, at, offers);
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
  named: WorkspaceNamed,
): SetupThing {
  const of: Copy =
    choice.open === "workspace"
      ? { id: "setup-ask-workspace" }
      : {
          id: "setup-ask-project",
          args: {
            workspace:
              choice.workspace === undefined ? "" : named(choice.workspace),
          },
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

/** The project whose step is the one next where that step lacks one of `lacks`. */
function setupDue(
  standing: SetupStanding,
  lacks: readonly SetupLack["lacks"][],
): PartitionIdentity | undefined {
  if (standing.choice.choice === "Open") return undefined;
  const { workspace, project } = standing.choice;
  const lack = standing.steps.find((step) => step.lacks !== undefined)?.lacks;
  if (lack === undefined || !lacks.includes(lack.lacks)) return undefined;
  return workspace === undefined || project === undefined
    ? undefined
    : { tenant: workspace, project };
}

/** The project whose runner step is the one next, which is when the machine is looked at before the next thing is named. */
export function setupRunnerDue(
  standing: SetupStanding,
): PartitionIdentity | undefined {
  return setupDue(standing, setupRunnerLacks);
}

/** The project and the repository, as its binding names it, whose configuration is the one next thing, which is when `import` asks the site to import it. */
export function setupConfigurationDue(
  standing: SetupStanding,
):
  | { readonly partition: PartitionIdentity; readonly repository: string }
  | undefined {
  const partition = setupDue(standing, ["Configuration"]);
  const lack = standing.steps.find((step) => step.lacks !== undefined)?.lacks;
  return partition === undefined || lack?.lacks !== "Configuration"
    ? undefined
    : { partition, repository: lack.bound };
}

/** The project and the folder's repository, by the address the portal app lists it by, where adding it is the one next thing, which is when `bind` asks the site to add it. */
export function setupBindDue(standing: SetupStanding):
  | {
      readonly partition: PartitionIdentity;
      readonly repository: string;
      readonly url: string;
    }
  | undefined {
  const partition = setupDue(standing, ["Binding"]);
  const lack = standing.steps.find((step) => step.lacks !== undefined)?.lacks;
  if (partition === undefined || lack?.lacks !== "Binding") return undefined;
  const reach = lack.reach;
  return reach?.reach === "Granted"
    ? { partition, repository: reach.repository, url: reach.url }
    : undefined;
}

/** The project whose ticket step is the one next and has no ticket at all, which is when what a ticket may be drawn under is read and `ticket` files one. */
export function setupTicketDue(
  standing: SetupStanding,
): PartitionIdentity | undefined {
  return setupDue(standing, ["Ticket"]);
}

/** The project whose MCP step is the one next, which is when the runner package here is looked for before the next thing is named. */
export function setupMcpDue(
  standing: SetupStanding,
): PartitionIdentity | undefined {
  return setupDue(standing, ["Mcp"]);
}

function setupThing(
  standing: SetupStanding,
  here: SetupRunnerHere | undefined,
  packaged: boolean,
  offers: SetupTicketOffers | undefined,
): SetupThing {
  const named = workspaceNamesListed(standing.workspaces);
  if (standing.choice.choice === "Open")
    return setupAsk(standing.choice, named);
  const at: SetupAt = {
    site: standing.site,
    workspace: standing.choice.workspace ?? "",
    project: standing.choice.project ?? "",
    named,
  };
  const undone = standing.steps.find((step) => step.lacks !== undefined);
  if (undone?.lacks === undefined) return setupDoneThing(standing, at);
  const mine =
    standing.remote === undefined
      ? undefined
      : repositoryLabel(standing.remote.said);
  return setupMend(undone, undone.lacks, at, mine, here, packaged, offers);
}

/**
 * Names the one next thing and the choice every command printed with it
 * carries, where `answers` is what the run's own arguments named, which a
 * question about the other name keeps. `here` is what this machine showed
 * where `setupRunnerDue` named a project, and nothing where it was not
 * looked at; `packaged` is whether the runner package here is one `mcp`
 * leaves as it is, where `setupMcpDue` named one; `offers` is what a ticket
 * may be drawn under where `setupTicketDue` named a project and it was read.
 */
export function setupNext(
  standing: SetupStanding,
  answers: SetupAnswers,
  here?: SetupRunnerHere,
  packaged = false,
  offers?: SetupTicketOffers,
): SetupNext {
  return {
    carried: setupCarried(standing.choice, answers),
    thing: setupThing(standing, here, packaged, offers),
  };
}
