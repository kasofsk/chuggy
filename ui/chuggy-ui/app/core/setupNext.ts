/**
 * The one next thing, from where a person stands on each step of setup.
 *
 * The first step that is not done decides it. This program does the plugin's
 * step, the project's, the MCP step's and the runner's itself, and it never prints
 * a `next:` it cannot run, so for every other step but one what it names is a
 * page of the console by its full address and what is pressed there, and the
 * checklist is read again only once the person says the step is done. A
 * project is made by `project` once the person has said what to call it, so
 * where one is lacking the next thing is that question. A repository holding
 * no configuration of its own is the one other: its configuration is written
 * in the checkout by the person's agent with them, through `configuration`,
 * `check` and `import`, and no page is pressed for it. Every trip to GitHub
 * names `bind` to run at once while the person makes it: `bind` waits for
 * GitHub to let both apps into the folder's repository and then adds it,
 * which the project's `Administer` permit already guards, so where both apps
 * are granted it the next thing is `bind` and nothing is asked. Where an app
 * is not granted it, the tell names that app's page on the forge and no page
 * of the console. Where the project has
 * no ticket yet and what a ticket may be drawn under was read, the person is
 * asked what they want done first, and `ticket` files it, with the
 * configuration they choose where there is a choice; where that read came to
 * nothing, the console's New ticket page is the way. The MCP step and the
 * runner's change the machine, so each is offered and never run unasked: the
 * person is told what `mcp` would do, the runner package installed where it
 * is not here and its server named in their agent, and for the runner's step
 * they are told what `runner` would put here, a service for the project's
 * work and what a job of it takes, and where their chats run on their chat
 * host and they have none, what one here would hold, recommended only where
 * the engine's memory has room for it beside a job: the command is named
 * under a rule that waits on their yes, with the answer recommended, and a
 * rule for the other; where the machine could not take a runner, they are
 * told that instead. A chat host lacking is never the next thing.
 * Where a personal runner of theirs is registered and does not take the
 * project's work, `serve` is offered on the same yes.
 * `setupMend` is where each thing a step can lack is turned into its next
 * thing; the slice that gives a step its command changes that step's line
 * there and nowhere else. A tell says of a page only what is pressed there:
 * whether a step is done is this program's to say, from the reads, and never
 * a page's. A step that was not read is said as that: a read the site refused
 * or cut short is the person's to take up, and one that failed is a failure.
 * Where which project is meant is still open, the next thing is the question,
 * one flag at a time. chuggy's Claude Code plugin is offered first, since its
 * setup skill holds the talk of every step after it: `plugin` installs it on
 * the person's yes, and on their no the checklist is read past it. Where every
 * step is done and the first ticket's pull request, holding the repository's
 * own configuration, stands unmerged, `merge` is offered on the person's yes,
 * leaning towards leaving the merge to them where the repository has a history
 * of its own; on their no, setup is done.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { RepositoryConfigurationImportAttemptResponse } from "../../../../src/contract/responses.ts";
import { forgeApps } from "../../../../src/contract/rosters.ts";
import type { Copy, CopyArgument } from "./copy.ts";
import { memoryMibFigure, quantityFigureCopy } from "./figures.ts";
import { forgeInstallLabel } from "./forgeInstallation.ts";
import { inviteRoutePath } from "./inviteLinks.ts";
import {
  repositoriesConnectPath,
  repositoryGrantLines,
  repositoryLabel,
} from "./projectRepositories.ts";
import { runnerPackages } from "./runners.ts";
import { settingsRoutes } from "./settingsNav.ts";
import {
  repositoryImportRefusedFile,
  repositoryImportWord,
  repositoryImportWordLabel,
} from "./repositoryImport.ts";
import { setupServerPackages } from "./setupAgent.ts";
import type { SetupMcpPackaged } from "./setupAgent.ts";
import { setupAnswersPlugin, setupNameFlag } from "./setupArguments.ts";
import { setupConfigurationPath } from "./setupConfiguration.ts";
import type { SetupAnswers, SetupChatHostAnswer } from "./setupArguments.ts";
import { setupMergeImportFailed } from "./setupMerge.ts";
import type { SetupHistory, SetupMergeSince } from "./setupMerge.ts";
import type { SetupPlatform } from "./setupPorts.ts";
import type { SetupChoice } from "./setupReads.ts";
import type { SetupNext, SetupThing } from "./setupReport.ts";
import { setupEngineSpareMib, setupJobMemoryMib } from "./setupFit.ts";
import type { SetupFit } from "./setupFit.ts";
import { setupChatSized } from "./setupRunnerMachine.ts";
import type { SetupChatSize, SetupRunnerHere } from "./setupRunnerMachine.ts";
import type { SetupTicketOffers } from "./setupTicket.ts";
import type { SetupClaudeKind } from "./setupRunnerSaid.ts";
import {
  setupChatCost,
  setupDockerBarredTold,
  setupEnginesNone,
  setupFitStopOf,
  setupFitToldSaid,
} from "./setupRunnerSaid.ts";
import { setupAppNames, setupPhaseSaid } from "./setupStanding.ts";
import type {
  SetupAppPage,
  SetupLack,
  SetupRunnerWait,
  SetupStanding,
  SetupStep,
  SetupUnmerged,
} from "./setupStanding.ts";
import { setupCommandLine, setupFlat } from "./setupText.ts";
import { navRoutes } from "./shellNav.ts";
import { workspaceNamesListed } from "./workspaceNames.ts";
import type { WorkspaceNamed } from "./workspaceNames.ts";

/**
 * What is pressed on the console's pages, by the message each page draws it
 * as, or the program's own where a page spells the name itself. A case reads
 * each page for it and fails where a page renamed it.
 */
export const setupPressed = {
  connect: { id: "repositories-connect-github" },
  addAccount: { id: "settings-accounts-add" },
  add: { id: "repositories-add" },
  runner: { id: "runners-register" },
  fallback: { id: "runners-fallback-title" },
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

/** `bind` run at once for the checklist's project, while the person does what `tell` says on GitHub, where it says anything. */
function setupBindRun(at: SetupAt, tell: Copy | undefined): SetupThing {
  return {
    thing: "Run",
    command: "Bind",
    tell,
    workspace: at.workspace,
    project: at.project,
  };
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

function setupProjectMend(at: SetupAt): SetupThing {
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

/** An app that is installed and not let into the repository: the picker draws a line for it under its list, with a link to that app's own page on the forge. */
function setupGrantMend(
  lack: Extract<SetupLack, { readonly lacks: "Grant" }>,
  at: SetupAt,
): SetupThing {
  const line = repositoryGrantLines[lack.app];
  const app = setupAppNames[lack.app];
  const { account, repository } = lack;
  return setupBindRun(at, {
    id: "setup-mend-grant-tell",
    args: {
      app,
      account,
      repository,
      page: setupPage(at, navRoutes.repositories),
      add: setupPressed.add,
      status: line.status,
      label: line.label,
    },
  });
}

/** The repositories page asked to begin Connect GitHub's press, which it does by itself only for the workspace's sole administrator. */
function setupConnectPage(at: SetupAt): string {
  return repositoriesConnectPath(setupPage(at, navRoutes.repositories));
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
  if (lack.lacks === "Grant") return setupGrantMend(lack, at);
  if (lack.lacks === "Account")
    return setupBindRun(at, {
      id: "setup-mend-account-tell",
      args: {
        page: setupConnectPage(at),
        connect: setupPressed.connect,
        repository: setupMendBindingSaid(mine),
      },
    });
  const { account } = lack;
  if (lack.app === "worker")
    return setupBindRun(at, {
      id: "setup-mend-worker-tell",
      args: {
        page: setupPage(at, navRoutes.repositories),
        install: forgeInstallLabel(lack.app),
        account,
      },
    });
  return setupBindRun(at, {
    id: "setup-mend-portal-tell",
    args: {
      page: setupPage(at, settingsRoutes.workspace.accounts),
      connect: setupPressed.connect,
      account,
    },
  });
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
 * `bind` adds it at once, as the console's Add does; where an app is not,
 * every such app is named in the one tell with where it is given it, and
 * `bind` waits while the person gives it. Where what the apps grant was not
 * read, the console's Add is the way.
 */
function setupBindingMend(
  lack: Extract<SetupLack, { readonly lacks: "Binding" }>,
  at: SetupAt,
  mine: string | undefined,
): SetupThing {
  const reach = lack.reach;
  if (reach?.reach === "Granted") return setupBindRun(at, undefined);
  if (reach?.reach === "Ungranted") {
    if (reach.apps.length < 1 || reach.apps.length > forgeApps.length)
      throw new Error("a tell of the apps not granted names one or both");
    const [first, second] = reach.apps.map((page) =>
      setupAppPageSaid(page, reach.apps, at),
    );
    return setupBindRun(at, {
      id: "setup-mend-reach-tell",
      args: {
        repository: reach.repository,
        count: second === undefined ? "one" : "two",
        first: first ?? "",
        second: second ?? "",
      },
    });
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
function setupOffer(
  tell: Copy,
  at: SetupAt,
  chatHost: SetupChatHostAnswer | undefined,
): SetupThing {
  const { workspace, project } = at;
  return {
    thing: "Offer",
    command: "Runner",
    tell,
    when: { id: "setup-offer-when" },
    workspace,
    project,
    ...(chatHost === undefined ? {} : { chatHost }),
  };
}

const setupMcpOffers = {
  Current: "setup-mend-mcp-offer",
  Behind: "setup-mend-mcp-offer-behind",
  Absent: "setup-mend-mcp-offer-absent",
} as const satisfies Record<SetupMcpPackaged, string>;

/**
 * The agent's MCP server for the checklist's project, which `mcp` names in
 * its configuration on the person's yes, installing the platform's runner
 * package first where `packaged` says none here is one it leaves as it is.
 */
function setupMcpMend(
  at: SetupAt,
  platform: SetupPlatform,
  packaged: SetupMcpPackaged,
): SetupThing {
  const { site, workspace, project } = at;
  const program = setupServerPackages[platform].offered.program;
  return {
    thing: "Offer",
    command: "Mcp",
    tell: {
      id: setupMcpOffers[packaged],
      args: { project: setupNamed(at), site, program },
    },
    when: { id: "setup-offer-mcp-when" },
    workspace,
    project,
  };
}

/** chuggy's Claude Code plugin, which `plugin` installs, or enables where it is installed and off, on the person's yes. */
function setupPluginMend(off: boolean): SetupThing {
  return {
    thing: "Offer",
    command: "Plugin",
    tell: {
      id: off ? "setup-mend-plugin-offer-off" : "setup-mend-plugin-offer",
    },
    when: { id: "setup-offer-plugin-when" },
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

/** What a job of the project's takes, as an offer says it. */
const setupJobSaid: Copy = quantityFigureCopy(
  memoryMibFigure(setupJobMemoryMib),
);

/** The answer `runner` is told for the person's chat host where a chat host here is asked about, which is the one recommended: yes only where the engine's memory has room for one beside a job. */
function setupChatHostRecommended(size: SetupChatSize): SetupChatHostAnswer {
  return size.room > 0 ? "yes" : "no";
}

/** What a chat host here would be, where the machine was looked at and its engine named; sized as having no room where the engine was not read. */
function setupChatSizeHere(here: SetupRunnerHere): SetupChatSize {
  return here.chatSize ?? setupChatSized(undefined, undefined, {});
}

/** Where memory is short for a chat host of `size` beside a run, as the engine `engine` said it or did not. */
function setupChatHostShort(size: SetupChatSize, engine: string): Copy {
  const id = "setup-mend-chat-host-short";
  const { engineMib, inUseMib } = size;
  if (engineMib === undefined)
    return { id, args: { said: "unsaid", engine, memory: "", used: "" } };
  if (inUseMib === undefined)
    return { id, args: { said: "uncounted", engine, memory: "", used: "" } };
  const memory = setupMemorySaid(engineMib);
  return inUseMib === 0
    ? { id, args: { said: "said", engine, memory, used: "" } }
    : {
        id,
        args: { said: "used", engine, memory, used: setupMemorySaid(inUseMib) },
      };
}

/** The question an offer of `runner` asks of the person's chat host: what it would hold, what it is for, and whether it is recommended, with where memory is short where it is not; an engine not yet answering is a Mac's docker, which Colima runs. */
function setupChatHostAsk(here: SetupRunnerHere): Copy {
  const size = setupChatSizeHere(here);
  const engine = here.room.room === "Open" ? here.room.engine : "docker";
  const short = setupChatHostShort(size, engine);
  return {
    id: "setup-mend-chat-host-ask",
    args: {
      ...setupChatCost(size.sessionsMax, size.sessionMemoryMib),
      recommend: setupChatHostRecommended(size),
      short,
    },
  };
}

/** Memory as an offer says it. */
function setupMemorySaid(mib: number): Copy {
  return quantityFigureCopy(memoryMibFigure(mib));
}

/** What Colima's VM is short of for a job, as the word an offer's sentence picks its clause by. */
function setupColimaShort(
  fit: Extract<SetupFit, { readonly fit: "Colima" }>,
): string {
  if (fit.short && fit.hasMib !== undefined)
    return fit.amd64 ? "both" : "memory";
  return fit.amd64 ? "amd64" : "none";
}

/** What a yes to `runner` gives Colima's VM, as the word an offer's sentence picks its clause by. */
function setupColimaGives(
  fit: Extract<SetupFit, { readonly fit: "Colima" }>,
): string {
  if (fit.vm === "None") return fit.rosetta ? "both" : "memory";
  const memory = fit.targetMib !== undefined;
  if (memory && fit.rosetta) return "both";
  if (memory) return "memory";
  return fit.rosetta ? "rosetta" : "none";
}

/** What an offer of `runner` says this machine is short of for a job naming no memory or platform, and what a yes does for it, or nothing where it is short of nothing. */
function setupFitSaid(here: SetupRunnerHere): CopyArgument {
  const { fit } = here;
  const engine = here.room.room === "Open" ? here.room.engine : "docker";
  const job = setupMemorySaid(setupJobMemoryMib);
  const spare = setupMemorySaid(setupEngineSpareMib);
  switch (fit.fit) {
    case "Small":
      return {
        id: "setup-mend-fit-small",
        args: {
          machine: fit.machine === "Mac" ? "mac" : "engine",
          engine,
          has: setupMemorySaid(fit.hasMib),
          job,
          spare,
        },
      };
    case "Colima":
      return {
        id: "setup-mend-fit-colima",
        args: {
          vm: fit.vm.toLowerCase(),
          short: setupColimaShort(fit),
          has: fit.hasMib === undefined ? "" : setupMemorySaid(fit.hasMib),
          job,
          spare,
          gives: setupColimaGives(fit),
          target:
            fit.targetMib === undefined ? "" : setupMemorySaid(fit.targetMib),
          commands: {
            id: "setup-mend-fit-commands",
            args: {
              first: setupCommandLine(fit.commands[0] ?? []),
              then: fit.commands.length > 1 ? "then" : "alone",
              second: setupCommandLine(fit.commands[1] ?? []),
            },
          },
        },
      };
    case "Room":
    case "Rosettaless":
    case "Rebuild":
      return "";
  }
}

/** Where this machine is short of what a job naming no platform needs and only the person can mend it, what they are told to do, with `instead` for another machine. */
function setupFitToldMend(
  fit: SetupFit,
  instead: Copy,
): SetupThing | undefined {
  const stop = setupFitStopOf(fit);
  if (stop === undefined) return undefined;
  const { told, when } = setupFitToldSaid(stop, false);
  return setupHand(
    { id: "setup-mend-runner-fit", args: { told, instead } },
    { id: "setup-mend-runner-or-running", args: { when } },
  );
}

/** The answer an offer of `runner` carries for the chat host, where it asks of one: where the person's chats run on a chat host they lack. */
function setupChatHostOffered(
  chat: boolean,
  here: SetupRunnerHere,
): SetupChatHostAnswer | undefined {
  return chat ? setupChatHostRecommended(setupChatSizeHere(here)) : undefined;
}

/** A runner registered and not running: started here on the person's yes where this machine holds a registration for the project, and otherwise theirs to start where it is. */
function setupRunnerLiveMend(
  at: SetupAt,
  here: SetupRunnerHere | undefined,
  chat: boolean,
  instead: Copy,
): SetupThing {
  if (here?.held !== true)
    return setupHand({ id: "setup-mend-runner-live-tell" }, setupRunnerRunning);
  return (
    setupFitToldMend(here.fit, instead) ??
    setupOffer(
      {
        id: "setup-mend-runner-live-offer",
        args: {
          project: setupNamed(at),
          runs: setupRunsOn(here.claude),
          job: setupJobSaid,
          fit: setupFitSaid(here),
          chat: setupWith(chat),
          ask: chat ? setupChatHostAsk(here) : "",
        },
      },
      at,
      setupChatHostOffered(chat, here),
    )
  );
}

/**
 * A personal runner of the person's that does not take the project's work.
 * `serve` gives it the project where it is not given, and names Preferred
 * where the project names no owner fallback and the person may name one;
 * where they may not, the tell names the project's Placement page, where an
 * admin of it does, and where the project is given already that is all there
 * is to do.
 */
function setupServingMend(
  lack: Extract<SetupLack, { readonly lacks: "Serving" }>,
  at: SetupAt,
): SetupThing {
  const project = setupNamed(at);
  const setting = setupPressed.fallback;
  const placement = setupPage(at, settingsRoutes.project.placement);
  const allow = !lack.named && lack.administers;
  const admin = !lack.named && !lack.administers;
  if (lack.given && !allow)
    return setupHand(
      {
        id: "setup-mend-serving-admin-tell",
        args: { project, setting, placement },
      },
      { id: "setup-mend-serving-admin-when", args: { setting } },
    );
  return {
    thing: "Offer",
    command: "Serve",
    tell: {
      id: "setup-mend-serving-offer",
      args: {
        project,
        does: lack.given ? "allow" : allow ? "both" : "give",
        admin: admin ? "admin" : "none",
        setting,
        placement,
      },
    },
    when: { id: "setup-offer-serve-when" },
    workspace: at.workspace,
    project: at.project,
  };
}

/**
 * No runner yet. Where this machine could take one the person is told what
 * `runner` would put here, with the package of the platform the program runs
 * on, before it may be run; where it could not, why not; and where the
 * machine was not looked at, the console's own page.
 */
function setupRunnerMend(
  lack: Extract<SetupLack, { readonly lacks: "Runner" | "RunnerLive" }>,
  at: SetupAt,
  here: SetupRunnerHere | undefined,
  platform: SetupPlatform,
): SetupThing {
  const page = setupPage(at, settingsRoutes.project.myRunner);
  const add = setupPressed.runner;
  const elsewhere: Copy = {
    id: "setup-mend-runner-elsewhere",
    args: { page, add },
  };
  const instead: Copy = {
    id: "setup-mend-runner-instead",
    args: { page, add },
  };
  if (lack.lacks === "RunnerLive")
    return setupRunnerLiveMend(at, here, lack.chat, instead);
  if (here === undefined) return setupHand(elsewhere, setupRunnerRunning);
  const { room } = here;
  switch (room.room) {
    case "Open":
      return setupRunnerPutMend(lack.chat, at, here, platform, instead);
    case "Serviceless":
      return setupHand(
        { id: "setup-mend-runner-serviceless", args: { elsewhere } },
        setupRunnerRunning,
      );
    case "Engineless":
      return setupColimaMends(here.fit)
        ? setupRunnerPutMend(lack.chat, at, here, platform, instead)
        : setupRunnerBarredMend(room, instead);
    case "DockerBarred":
      return setupRunnerBarredMend(room, instead);
  }
}

/** Whether a fit is one where Colima's VM is what a yes or the person mends, which is so also where docker does not answer yet. */
function setupColimaMends(fit: SetupFit): boolean {
  return (
    fit.fit === "Colima" || fit.fit === "Rosettaless" || fit.fit === "Rebuild"
  );
}

/** What `runner` would put on this machine, offered on the person's yes with what a yes changes of Colima first, or what they are to mend first where only they can. */
function setupRunnerPutMend(
  chat: boolean,
  at: SetupAt,
  here: SetupRunnerHere,
  platform: SetupPlatform,
  instead: Copy,
): SetupThing {
  const told = setupFitToldMend(here.fit, instead);
  if (told !== undefined) return told;
  const page = setupPage(at, settingsRoutes.project.myRunner);
  return setupOffer(
    {
      id: "setup-mend-runner-offer",
      args: {
        put: {
          id: "setup-mend-runner-put",
          args: {
            program: runnerPackages[platform].program,
            runs: setupRunsOn(here.claude),
            job: setupJobSaid,
          },
        },
        fit: setupFitSaid(here),
        chat: setupWith(chat),
        ask: chat ? setupChatHostAsk(here) : "",
        page,
        add: setupPressed.runner,
      },
    },
    at,
    setupChatHostOffered(chat, here),
  );
}

/** A machine that could hold a runner once its engine is mended, told what to mend, with `instead` for not mending it. */
function setupRunnerBarredMend(
  room: Extract<
    NonNullable<SetupRunnerHere["room"]>,
    { readonly room: "Engineless" | "DockerBarred" }
  >,
  instead: Copy,
): SetupThing {
  if (room.room === "Engineless") {
    const none = setupEnginesNone(room.asked);
    return setupHand(
      room.start === undefined
        ? { id: "setup-mend-runner-engineless", args: { none, instead } }
        : {
            id: "setup-mend-runner-engineless-colima",
            args: { start: room.start, instead },
          },
      {
        id: "setup-mend-runner-or-running",
        args: { when: { id: "setup-runner-engineless-when" } },
      },
    );
  }
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

/** What a ticket's starting execution waits on of the person's runners, as the finalization tell says it: the fact, and no remedy. */
function setupWaitSaid(wait: SetupRunnerWait | undefined): {
  readonly wait: "room" | "offline" | "unable" | "none";
  readonly free: CopyArgument;
  readonly needed: CopyArgument;
} {
  switch (wait?.wait) {
    case "Room":
      return {
        wait: "room",
        free: quantityFigureCopy(memoryMibFigure(wait.freeMib)),
        needed: quantityFigureCopy(memoryMibFigure(wait.neededMib)),
      };
    case "Offline":
      return { wait: "offline", free: "", needed: "" };
    case "Unable":
      return { wait: "unable", free: "", needed: "" };
    case undefined:
      return { wait: "none", free: "", needed: "" };
  }
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
          args: {
            ticket,
            phase: setupPhaseSaid(lack.phase),
            page,
            ends: lack.pullRequest ? "pull" : "finish",
            bootstrap: lack.bootstrapped ? "bootstrap" : "own",
            ...setupWaitSaid(lack.wait),
          },
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
  mcp: SetupMcpHere,
  offers: SetupTicketOffers | undefined,
): SetupThing {
  switch (lack.lacks) {
    case "Read":
      return setupUnreadMend(lack, step);
    case "Mcp":
      return setupMcpMend(at, mcp.platform, mcp.packaged);
    case "Plugin":
      return setupPluginMend(lack.off);
    case "Workspace":
    case "Administration":
      return setupWorkspaceMend(lack, at);
    case "Project":
      return setupProjectMend(at);
    case "Account":
    case "App":
    case "Grant":
      return setupGithubMend(lack, at, mine);
    case "Binding":
    case "Configuration":
      return setupRepositoryMend(lack, at, mine);
    case "Runner":
    case "RunnerLive":
      return setupRunnerMend(lack, at, here, mcp.platform);
    case "Serving":
      return setupServingMend(lack, at);
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

/** The workspace and project a checklist's commands carry: none where there was nothing to choose, and otherwise the choice as far as it is made; and the plugin step passed over, where it was. */
function setupCarried(
  choice: SetupChoice,
  answers: SetupAnswers,
): SetupAnswers {
  const plugin = setupAnswersPlugin(answers);
  if (choice.choice === "Made")
    return choice.by === "Only"
      ? answers
      : { workspace: choice.workspace, project: choice.project, ...plugin };
  return choice.open === "workspace"
    ? { workspace: undefined, project: answers.project, ...plugin }
    : { workspace: choice.workspace, project: undefined, ...plugin };
}

/** What setup said to be done says of the repository's own configuration, after a `merge` run: in place, being imported, or refused by its import with what the import said. */
type SetupDoneConfiguration =
  | { readonly configuration: "imported" | "importing" | "none" }
  | { readonly configuration: "refused"; readonly last: Copy };

/** Setup said to be done in the ticket step's own words, so a pull request that was opened is not said to have landed, and with what became of the repository's own configuration where a `merge` run waited on it. */
function setupDoneTell(
  standing: SetupStanding,
  at: SetupAt,
  done: SetupDoneConfiguration,
): Copy {
  const detail = standing.steps.find((step) => step.step === "ticket")?.detail;
  return {
    id: "setup-done",
    args: {
      project: setupNamed(at),
      how: detail === undefined ? "unsaid" : "said",
      detail: detail ?? "",
      configuration: done.configuration,
      last: done.configuration === "refused" ? done.last : "",
      page: setupPage(at, navRoutes.ticketNew),
    },
  };
}

/** The first ticket's pull request, which `merge` merges on the person's yes, leaning towards leaving it to them where the folder's history is long. */
function setupMergeOffer(
  unmerged: SetupUnmerged,
  at: SetupAt,
  history: SetupHistory,
): SetupThing {
  return {
    thing: "Offer",
    command: "Merge",
    tell: {
      id: "setup-mend-merge-offer",
      args: {
        ticket: String(unmerged.ticket),
        url: unmerged.url,
        lean: history === "Long" ? "leave" : "ask",
      },
    },
    when: { id: "setup-offer-merge-when" },
    workspace: at.workspace,
    project: at.project,
  };
}

/**
 * What the merge offer turns on beyond the reads: the folder's history, where
 * the offer is looked at; that a `merge` run merged, with what it looked at
 * before; or that the site refused it.
 */
export type SetupMergeSeen =
  | { readonly seen: "Offered"; readonly history: SetupHistory }
  | ({ readonly seen: "Merged" } & SetupMergeSince)
  | { readonly seen: "Refused" };

/** The merge offer looked at with nothing read of the folder's history. */
export const setupMergeUnseen: SetupMergeSeen = {
  seen: "Offered",
  history: "Unread",
};

/**
 * Every step done: the merge offered where the first ticket's pull request
 * stands unmerged, and otherwise setup said to be done; after a merge, with
 * the import of the repository's own configuration in place, refused, or
 * still under way, which is `merge` run again.
 */
function setupDoneThing(
  standing: SetupStanding,
  at: SetupAt,
  merge: SetupMergeSeen,
): SetupThing {
  const done = (configuration: SetupDoneConfiguration): SetupThing => ({
    thing: "Done",
    tell: setupDoneTell(standing, at, configuration),
  });
  if (merge.seen === "Refused") return done({ configuration: "none" });
  if (merge.seen === "Offered")
    return standing.unmerged === undefined
      ? done({ configuration: "none" })
      : setupMergeOffer(standing.unmerged, at, merge.history);
  if (standing.bootstrap === undefined)
    return done({ configuration: "imported" });
  const last = standing.bootstrap.lastImport;
  if (setupMergeImportFailed(merge, last))
    return done({ configuration: "refused", last: setupLastImport(last) });
  return {
    thing: "Run",
    command: "Merge",
    tell: setupDoneTell(standing, at, { configuration: "importing" }),
    workspace: at.workspace,
    project: at.project,
  };
}

/** What the runner's step can lack, each of which `runner` mends. */
const setupRunnerLacks: readonly SetupLack["lacks"][] = [
  "Runner",
  "RunnerLive",
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

/**
 * Whether the one next thing waits on GitHub: an account to connect, an app
 * to install, or an app to let into the folder's repository, which is what
 * `bind` waits out before it adds the repository.
 */
export function setupBindAwaited(standing: SetupStanding): boolean {
  if (setupDue(standing, ["Account", "App", "Grant", "Binding"]) === undefined)
    return false;
  const lack = standing.steps.find((step) => step.lacks !== undefined)?.lacks;
  return lack?.lacks !== "Binding" || lack.reach?.reach === "Ungranted";
}

/** The repositories page asked to begin Connect GitHub's press, where connecting GitHub is the one next thing, which is when `bind` opens it in a browser. */
export function setupConnectDue(standing: SetupStanding): string | undefined {
  const partition = setupDue(standing, ["Account"]);
  return partition === undefined
    ? undefined
    : setupConnectPage({
        site: standing.site,
        workspace: partition.tenant,
        project: partition.project,
        named: workspaceNamesListed(standing.workspaces),
      });
}

/** What `serve` writes for a project: the project given to the person's runners, and Preferred named as its owner fallback. */
export interface SetupServeDue {
  readonly partition: PartitionIdentity;
  readonly give: boolean;
  readonly allow: boolean;
}

/** What `serve` writes where a personal runner of the person's taking the project's work is the one next thing, and something of it is theirs to write. */
export function setupServeDue(
  standing: SetupStanding,
): SetupServeDue | undefined {
  const partition = setupDue(standing, ["Serving"]);
  const lack = standing.steps.find((step) => step.lacks !== undefined)?.lacks;
  if (partition === undefined || lack?.lacks !== "Serving") return undefined;
  const give = !lack.given;
  const allow = !lack.named && lack.administers;
  return give || allow ? { partition, give, allow } : undefined;
}

/** The project of a checklist whose every step is done. */
function setupAllDone(standing: SetupStanding): PartitionIdentity | undefined {
  if (standing.choice.choice === "Open") return undefined;
  const { workspace, project } = standing.choice;
  if (workspace === undefined || project === undefined) return undefined;
  return standing.steps.some((step) => step.lacks !== undefined)
    ? undefined
    : { tenant: workspace, project };
}

/** The project and the first ticket's pull request, where every step is done and that pull request stands unmerged, which is when the merge is offered and `merge` asks the site to merge it. */
export function setupMergeDue(
  standing: SetupStanding,
):
  | { readonly partition: PartitionIdentity; readonly unmerged: SetupUnmerged }
  | undefined {
  const partition = setupAllDone(standing);
  const unmerged = standing.unmerged;
  return partition === undefined || unmerged === undefined
    ? undefined
    : { partition, unmerged };
}

/** Whether every step is done and the repository still holds only the bootstrap, which is what `merge` waits out once it has merged. */
export function setupMergeAwaited(standing: SetupStanding): boolean {
  return (
    setupAllDone(standing) !== undefined && standing.bootstrap !== undefined
  );
}

/** The project whose ticket step is the one next and has no ticket at all, which is when what a ticket may be drawn under is read and `ticket` files one. */
export function setupTicketDue(
  standing: SetupStanding,
): PartitionIdentity | undefined {
  return setupDue(standing, ["Ticket"]);
}

/** The platform the program runs on, and what `mcp` would find of its runner package here. */
interface SetupMcpHere {
  readonly platform: SetupPlatform;
  readonly packaged: SetupMcpPackaged;
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
  mcp: SetupMcpHere,
  offers: SetupTicketOffers | undefined,
  merge: SetupMergeSeen,
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
  if (undone?.lacks === undefined) return setupDoneThing(standing, at, merge);
  const mine =
    standing.remote === undefined
      ? undefined
      : repositoryLabel(standing.remote.said);
  return setupMend(undone, undone.lacks, at, mine, here, mcp, offers);
}

/**
 * Names the one next thing and the choice every command printed with it
 * carries, where `answers` is what the run's own arguments named, which a
 * question about the other name keeps. `platform` is the one the program
 * runs on; `here` is what this machine showed where `setupRunnerDue` named a
 * project, and nothing where it was not looked at; `packaged` is what `mcp`
 * would find of the platform's runner package here, where `setupMcpDue`
 * named one; `offers` is what a ticket may be drawn under where
 * `setupTicketDue` named a project and it was read; `merge` is what the merge
 * offer turns on beyond the reads.
 */
export function setupNext(
  standing: SetupStanding,
  answers: SetupAnswers,
  platform: SetupPlatform,
  here?: SetupRunnerHere,
  packaged: SetupMcpPackaged = "Absent",
  offers?: SetupTicketOffers,
  merge: SetupMergeSeen = setupMergeUnseen,
): SetupNext {
  return {
    carried: setupCarried(standing.choice, answers),
    thing: setupThing(standing, here, { platform, packaged }, offers, merge),
  };
}
