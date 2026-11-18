/**
 * The one next thing the setup program names, for every standing.
 *
 * Where the machine was not looked at, each thing a step can lack but the
 * repository's configuration is mended by the person on a page of the
 * console: the table below holds every such lack, and will not compile with
 * one missing, against the page's full
 * address, what is pressed there, and the condition the checklist may be read
 * again under. The runner's step is the one this program does, so where the
 * machine was looked at and could take a runner it is offered, under a rule
 * that waits on her yes. The project's step is done by this program too, once
 * she has said what to call the project. The repository's configuration is
 * the agent's to write with her, from `configuration` on. A trip to GitHub,
 * and the repository both apps are granted, are the one command run unasked:
 * `bind`, which waits on GitHub and adds the repository.
 */

import { expect, test } from "vitest";

import { setupConfigurationPath } from "../app/core/setupConfiguration.ts";
import type { TicketLandingResponse } from "../../../src/contract/responses.ts";
import type { SetupMcpPackaged } from "../app/core/setupAgent.ts";
import type { SetupPlatform } from "../app/core/setupPorts.ts";
import { setupAnswersNone } from "../app/core/setupArguments.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import {
  setupAskNamesMax,
  setupBindAwaited,
  setupBindDue,
  setupConfigurationDue,
  setupConnectDue,
  setupMcpDue,
  setupNext,
  setupRunnerDue,
  setupServeDue,
} from "../app/core/setupNext.ts";
import type { SetupChoice } from "../app/core/setupReads.ts";
import { setupRepositoryRead } from "../app/core/setupRemote.ts";
import type {
  SetupRunnerHeld,
  SetupRunnerHere,
  SetupRunnerRoom,
} from "../app/core/setupRunnerMachine.ts";
import type {
  SetupClaudeCredential,
  SetupClaudeKind,
} from "../app/core/setupRunnerSaid.ts";
import {
  setupClaudeSaved,
  setupClaudeWords,
} from "../app/core/setupRunnerSaid.ts";
import type {
  SetupFate,
  SetupLack,
  SetupStanding,
  SetupStep,
} from "../app/core/setupStanding.ts";
import {
  saidLandingTicket,
  saidNext,
  saidRunnable,
  saidThing,
} from "./setupSaid.ts";
import type { SaidThing } from "./setupSaid.ts";
import type { SetupHistory } from "../app/core/setupMerge.ts";
import {
  setupSiteAt,
  setupSiteBootstrap,
  setupSiteLanded,
  setupSiteOpened,
  setupSiteProposed,
  setupSiteStages,
  setupSitePoolWaiting,
  setupSiteWaiting,
} from "./setupSite.ts";
import type { SetupSite, SetupSiteFate, SetupSiteStage } from "./setupSite.ts";
import { nextOf, stoodSite } from "./setupStood.ts";
import type { Asking } from "./setupStood.ts";

const chosen: SetupChoice = {
  choice: "Made",
  by: "Only",
  workspace: "acme",
  project: "widgets",
};

/** A standing whose first step that is not done lacks `lack`. */
function lacking(
  lack: SetupLack,
  given: Partial<SetupStanding> = {},
): SetupStanding {
  const steps: readonly SetupStep[] = [
    { step: "workspace", state: "done", detail: "acme", lacks: undefined },
    { step: "runner", state: "waiting", detail: "why", lacks: lack },
    {
      step: "ticket",
      state: "todo",
      detail: "",
      lacks: { lacks: "Ticket", pullRequest: true },
    },
  ];
  return {
    site: stoodSite,
    choice: chosen,
    remote: undefined,
    workspaces: [],
    found: [],
    steps,
    unmerged: undefined,
    bootstrap: undefined,
    ...given,
  };
}

const lacking_ = (lack: SetupLack): SetupStanding => lacking(lack);

function thing(lack: SetupLack, given?: Partial<SetupStanding>): SaidThing {
  return saidThing(
    setupNext(lacking(lack, given), setupAnswersNone, "linux").thing,
  );
}

/** The next thing for a site, in the catalog's words. */
async function nextSaid(site: SetupSite, asking?: Asking) {
  return saidNext(await nextOf(site, asking));
}

/** What the person is told of a lack, which is nothing where it is not hers to mend. */
function told(lack: SetupLack, given?: Partial<SetupStanding>): string {
  const next = thing(lack, given);
  return next.thing === "Hand" ? next.tell : "";
}

/** What a thing for the agent and the person tells, which is nothing where it is the person's alone. */
function told_(lack: SetupLack): string {
  const next = thing(lack);
  return next.thing === "Configure" ? next.tell : "";
}

const hand = (tell: string, when: string): SaidThing => ({
  thing: "Hand",
  tell,
  when,
});

const pages = `${stoodSite}/acme/widgets`;

/** How a chat host is registered on another machine, by the commands its personal runners page shows. */
const create = `Open ${pages}/tickets/new, say what you want done and press Create ticket`;

/** Every thing a step can lack, the lack as it is found, and what the person is told to do about it. */
const mends: {
  readonly [
    Kind in Exclude<
      SetupLack["lacks"],
      | "Read"
      | "Plugin"
      | "Mcp"
      | "Project"
      | "Configuration"
      | "Account"
      | "App"
      | "Grant"
      | "Serving"
      | "Landing"
    >
  ]: readonly [Extract<SetupLack, { readonly lacks: Kind }>, SaidThing];
} = {
  Workspace: [
    { lacks: "Workspace", workspace: undefined },
    hand(
      `You are not in a chuggy workspace yet. A new workspace is made from an invite link: open the one you were sent (it starts ${stoodSite}/invite) and sign in, and the workspace is made for you. Tell me once it is made.`,
      "once the person says their workspace is made",
    ),
  ],
  Administration: [
    { lacks: "Administration", workspace: "acme" },
    hand(
      `Setting chuggy up takes an admin of the workspace, and you are not one in acme. Ask an admin of acme to make you one on its People page, ${stoodSite}/tenants/acme/settings/people. Tell me once you are an admin.`,
      "once the person says they are an admin of acme",
    ),
  ],
  Binding: [
    { lacks: "Binding", reach: undefined },
    hand(
      `Open ${pages}/repositories?from=setup#add and name your repository there: it then shows both apps, and adds it once both reach it. Tell me once it is added.`,
      "once the person says the repository is added",
    ),
  ],
  Runner: [
    { lacks: "Runner", chat: false },
    hand(
      `Open ${pages}/settings/workspace/runner, press Register runner and do what it shows on the machine that will run the work. Tell me once the runner is running.`,
      "once the person says the runner is running",
    ),
  ],
  RunnerLive: [
    { lacks: "RunnerLive", chat: false },
    hand(
      "A runner is registered and is not running. Start it on its machine and tell me once it is running.",
      "once the person says the runner is running",
    ),
  ],
  Ticket: [
    { lacks: "Ticket", pullRequest: true },
    hand(
      `${create}. Tell me once it is created.`,
      "once the person says the ticket is created",
    ),
  ],
  Release: [
    { lacks: "Release", ticket: 4 },
    hand(
      `Ticket 4 was drafted and never released, so nothing is working on it, and the console has no page that releases it. ${create}, which makes a ticket and releases it at once. Tell me once it is created.`,
      "once the person says the ticket is created",
    ),
  ],
  Dispatch: [
    { lacks: "Dispatch", ticket: 4 },
    hand(
      `Ticket 4 is released and has not started. Open ${pages}/tickets/4 and press Dispatch to start it. Tell me once it has started.`,
      "once the person says ticket 4 has started",
    ),
  ],
  Decision: [
    { lacks: "Decision", ticket: 4 },
    hand(
      `Ticket 4 is escalated: it waits on a decision of yours at ${pages}/tickets/4. Tell me once it is moving again.`,
      "once the person says ticket 4 is moving again",
    ),
  ],
};

/** `watch` run at once for the project, beside where its first ticket is. */
const watchRun = (tell: string): SaidThing => ({
  thing: "Run",
  command: "Watch",
  tell,
  workspace: "acme",
  project: "widgets",
});

test("a first ticket on its way to its landing is watched: watch is run at once beside where it is, and the person is not asked to say when to look again", () => {
  expect(
    thing({
      lacks: "Landing",
      ticket: 4,
      phase: "Evaluation",
      pullRequest: false,
      bootstrapped: false,
      wait: undefined,
    }),
  ).toEqual(
    watchRun(
      `Ticket 4 is in Evaluation. Setup is done when it finishes. ${pages}/tickets/4 shows where it is. I'll keep watching it and tell you what changes.`,
    ),
  );
});

/** `bind` run at once for the project, beside what `tell` has the person do on GitHub. */
const bindRun = (tell: string | undefined): SaidThing => ({
  thing: "Run",
  command: "Bind",
  tell,
  workspace: "acme",
  project: "widgets",
});

/** Every trip to GitHub a step can lack, the lack as it is found, and what the person is told to do there while `bind` waits. */
const trips: {
  readonly [Kind in "Account" | "App" | "Grant"]: readonly [
    Extract<SetupLack, { readonly lacks: Kind }>,
    SaidThing,
  ];
} = {
  Grant: [
    {
      lacks: "Grant",
      app: "worker",
      account: "acme-org",
      repository: "acme-org/widgets",
    },
    bindRun(
      `This project's repository is acme-org/widgets. The worker app is installed on acme-org, and GitHub does not let it in yet. Open ${pages}/repositories?repository=acme-org%2Fwidgets&from=setup#add: it opens on acme-org/widgets, and the worker app's press there goes to GitHub to let it in. I'll wait here.`,
    ),
  ],
  Account: [
    { lacks: "Account" },
    bindRun(
      `Which repository is this project for? I could not tell this folder's, so name it on ${pages}/repositories?from=setup#add. chuggy uses two GitHub apps. The worker app pushes ticket work to branches and opens pull requests. The portal app merges finished work into protected branches such as main. Both need access to your repository. That page then shows both apps, and each app it still lacks has one press there that goes to GitHub for it. I'll wait here and add it once both reach it.`,
    ),
  ],
  App: [
    { lacks: "App", app: "worker", account: "acme-org", repository: undefined },
    bindRun(
      `Which repository is this project for? I could not tell this folder's, so name it on ${pages}/repositories?from=setup#add. chuggy uses two GitHub apps. The worker app pushes ticket work to branches and opens pull requests. The portal app merges finished work into protected branches such as main. Both need access to your repository. That page then shows both apps, and each app it still lacks has one press there that goes to GitHub for it. I'll wait here and add it once both reach it.`,
    ),
  ],
};

test.each(Object.entries(trips))(
  "a step that lacks %s sends the person to GitHub and names bind to run at once while they go, with no sentence asking to be told",
  (_kind, [lack, told]) => {
    const next = thing(lack);
    expect(next).toEqual(told);
    expect(next.thing === "Run" ? next.tell : "", lack.lacks).not.toMatch(
      /[Tt]ell me/u,
    );
  },
);

/** What `plugin` offers, with `tell` said. */
const pluginOffered = (tell: string): SaidThing => ({
  thing: "Offer",
  command: "Plugin",
  tell,
  when: "once the person says yes to chuggy's plugin in Claude Code",
});

const pluginAdds =
  "It adds two skills to Claude Code: one that sets chuggy up with you, and one that files tickets. It is installed with Claude Code's own commands, for you alone: they write your Claude Code user settings and clone the plugin into the plugins folder of ~/.claude, and the plugin runs nothing.";

test("the plugin step offers plugin, saying what the plugin adds and writes, and what the person's yes is to where it is installed and off", () => {
  expect(thing({ lacks: "Plugin", off: false })).toEqual(
    pluginOffered(
      `The first step is chuggy's plugin for Claude Code. ${pluginAdds} With your yes I will install it. Tell me yes to go ahead, or no to go on without it.`,
    ),
  );
  expect(thing({ lacks: "Plugin", off: true })).toEqual(
    pluginOffered(
      `The first step is chuggy's plugin for Claude Code, which is installed here and off. ${pluginAdds} With your yes I will update it and turn it on. Tell me yes to go ahead, or no to go on without it.`,
    ),
  );
});

test("signed in with no workspace, the plugin is what is next where Claude Code here has it off or not at all, and passed over the workspace is, with the way past carried", async () => {
  for (const plugin of ["None", "Off"] as const)
    expect(
      (await nextSaid(setupSiteAt("Nothing"), { plugin })).thing,
      plugin,
    ).toMatchObject({ thing: "Offer", command: "Plugin" });
  const skip = { plugin: "skip" } as const;
  const past = await nextSaid(setupSiteAt("Nothing"), {
    plugin: "Skipped",
    answers: skip,
  });
  expect(past.thing).toEqual(mends.Workspace[1]);
  expect(past.carried).toEqual({ ...setupAnswersNone, ...skip });
});

/** What `mcp` offers for the project, with `tell` said. */
const mcpOffered = (tell: string): SaidThing => ({
  thing: "Offer",
  command: "Mcp",
  tell,
  when: "once the person says yes to chuggy's MCP server on this machine",
  workspace: "acme",
  project: "widgets",
});

test("the MCP step offers mcp in one sentence naming the step, an install where the runner package here is absent or behind and a connection where it is current, and names nothing of how it is done", () => {
  const lacking = { lacks: "Mcp" } as const;
  const offered = (packaged?: SetupMcpPackaged) =>
    saidThing(
      setupNext(
        lacking_(lacking),
        setupAnswersNone,
        "linux",
        undefined,
        packaged,
      ).thing,
    );
  const installing = "Next, let's install the chuggy cli here. Okay?";
  expect(thing(lacking)).toEqual(offered({ packaged: "Absent" }));
  expect(offered({ packaged: "Absent" })).toEqual(mcpOffered(installing));
  expect(offered({ packaged: "Behind" })).toEqual(mcpOffered(installing));
  expect(offered({ packaged: "Current" })).toEqual(
    mcpOffered("Next, let's connect chuggy to your agent here. Okay?"),
  );
});

/** What a next thing tells the person, where it tells them anything. */
function toldOf(said: SaidThing): string {
  if (!("tell" in said) || said.tell === undefined) throw new Error(said.thing);
  return said.tell;
}

test("on a Mac the runner, with or without the chat host, offers the Mac's own package, as Linux's offers Linux's", () => {
  const looked: SetupRunnerHere = {
    room: { room: "Open", engine: "docker" },
    held: undefined,
    chat: false,
    claude: "Subscription",
    fit: { fit: "Room" },
    settings: undefined,
    loginMissing: undefined,
  };
  for (const lack of [
    { lacks: "Runner", chat: false },
    { lacks: "Runner", chat: true },
  ] as const) {
    const tell = toldOf(
      saidThing(
        setupNext(lacking(lack), setupAnswersNone, "darwin", looked).thing,
      ),
    );
    expect(tell).toEqual(
      toldOf(
        saidThing(
          setupNext(lacking(lack), setupAnswersNone, "linux", looked).thing,
        ),
      ).replaceAll("chuggy-linux", "chuggy-darwin"),
    );
    expect(tell).toContain("chuggy-darwin");
  }
});

test("the MCP step is the one next only while it is the first step not done, which is when the package here is looked for", () => {
  expect(setupMcpDue(lacking_({ lacks: "Mcp" }))).toEqual({
    tenant: "acme",
    project: "widgets",
  });
  expect(
    setupMcpDue(lacking_({ lacks: "Ticket", pullRequest: true })),
  ).toBeUndefined();
  expect(setupRunnerDue(lacking_({ lacks: "Mcp" }))).toBeUndefined();
});

/** The repository holding no configuration, with what its last import came to. */
function unconfigured(
  lastImport?: Extract<
    SetupLack,
    { readonly lacks: "Configuration" }
  >["lastImport"],
): Extract<SetupLack, { readonly lacks: "Configuration" }> {
  return {
    lacks: "Configuration",
    repository: "acme-org/widgets",
    bound: "Acme-Org/Widgets",
    lastImport,
  };
}

const configureTell = (last: string) =>
  `acme-org/widgets is added, but chuggy holds no configuration of its own for it (${last}). Next I write a starting one into this checkout, as ${setupConfigurationPath}, and fill in with you what it leaves for you to choose. I then test it as chuggy's import would, commit it and push it to the default branch of acme-org/widgets, and have chuggy import it, which says how that went.`;

test("a repository with no configuration is the agent's to configure with the person, for the project it is bound in, and no page is pressed for it", () => {
  expect(thing(unconfigured())).toEqual({
    thing: "Configure",
    tell: configureTell("no import of it has finished yet"),
    workspace: "acme",
    project: "widgets",
  });
});

test("what the last import of the repository came to is said in the words of the repositories page, with the first file it refused", () => {
  const at = "2026-11-15T10:00:00Z";
  expect(
    told_(
      unconfigured({
        attemptedAt: at,
        outcome: { result: "SnapshotAbsent", absent: "ConfigurationDirectory" },
      }),
    ),
  ).toBe(configureTell("its last import: Undeclared"));
  expect(
    told_(
      unconfigured({
        attemptedAt: at,
        outcome: {
          result: "DeclarationsRefused",
          refusals: [
            {
              path: `${setupConfigurationPath}`,
              fault: "ConfigurationInvalid",
            },
          ],
          refusalCount: 1,
        },
      }),
    ),
  ).toMatch(
    /\(its last import: Invalid, \.chug\/configurations\/development\.json\b[^)]*\)/u,
  );
});

test("the import is due only while the configuration is the first step not done, and is of the repository as its binding names it", () => {
  expect(setupConfigurationDue(lacking_(unconfigured()))).toEqual({
    partition: { tenant: "acme", project: "widgets" },
    repository: "Acme-Org/Widgets",
  });
  expect(
    setupConfigurationDue(lacking_({ lacks: "Ticket", pullRequest: true })),
  ).toBeUndefined();
  expect(setupRunnerDue(lacking_(unconfigured()))).toBeUndefined();
});

test.each(Object.entries(mends))(
  "a step that lacks %s is the person's to mend, on the page named by its full address, and is read again only once she says so",
  (_kind, [lack, told]) => {
    expect(thing(lack)).toEqual(told);
  },
);

test("nothing a step can lack is mended by a command: each is told, waits on the person, and names a page of this site wherever something is pressed on one", () => {
  const pageless: string[] = [];
  for (const [lack] of Object.values(mends)) {
    const next = thing(lack);
    if (next.thing !== "Hand") throw new Error(`${lack.lacks} is not handed`);
    if (!next.tell.includes(`${stoodSite}/`)) pageless.push(lack.lacks);
    expect(next.tell, lack.lacks).toMatch(
      / [Tt]ell me (once|when|if) [^.]+\.$/u,
    );
    expect(next.when, lack.lacks).toMatch(/^(once|if|when) the person /u);
  }
  expect(pageless).toEqual(["RunnerLive"]);
});

test("a runner that is registered and not running is started on its machine, and the tell says nothing of any page, since no page of the console says whether one is live", () => {
  const { tell } = mends.RunnerLive[1] as { readonly tell: string };
  expect(tell).not.toMatch(/https?:|page|shows/u);
});

test("the portal app missing from an account is sent to the connect flow on the folder's repository, as the worker app missing is", () => {
  const remote = setupRepositoryRead("git@github.com:acme-org/widgets.git");
  const portal = thing(
    { lacks: "App", app: "portal", account: "acme-org", repository: undefined },
    { remote },
  );
  expect(portal).toEqual(
    thing(
      {
        lacks: "App",
        app: "worker",
        account: "acme-org",
        repository: undefined,
      },
      { remote },
    ),
  );
  expect(portal).toEqual(thing({ lacks: "Account" }, { remote }));
});

test("an app not granted the project's repository is sent to the connect flow on that repository, naming the app, and asks no question the binding settled", () => {
  const grant = { account: "acme-org", repository: "acme-org/widgets" };
  expect(thing({ lacks: "Grant", app: "portal", ...grant })).toEqual(
    bindRun(
      `This project's repository is acme-org/widgets. The portal app is installed on acme-org, and GitHub does not let it in yet. Open ${pages}/repositories?repository=acme-org%2Fwidgets&from=setup#add: it opens on acme-org/widgets, and the portal app's press there goes to GitHub to let it in. I'll wait here.`,
    ),
  );
});

test("an app missing from the owner of the project's repository is sent to the connect flow on that repository, called the project's", () => {
  const remote = setupRepositoryRead("git@github.com:acme-org/other.git");
  expect(
    thing(
      {
        lacks: "App",
        app: "worker",
        account: "acme-org",
        repository: "acme-org/widgets",
      },
      { remote },
    ),
  ).toEqual(
    bindRun(
      `This project's repository is acme-org/widgets. chuggy uses two GitHub apps. The worker app pushes ticket work to branches and opens pull requests. The portal app merges finished work into protected branches such as main. Both need access to acme-org/widgets. Open ${pages}/repositories?repository=acme-org%2Fwidgets&from=setup#add: it opens on acme-org/widgets with both apps, and each app it still lacks has one press there that goes to GitHub for it. I'll wait here until both reach it.`,
    ),
  );
});

test("a tell of the project's repository makes no claim about the folder and asks nothing, whatever the folder's remote", () => {
  const remotes = [
    undefined,
    setupRepositoryRead("git@github.com:acme-org/other.git"),
  ];
  const lacks: readonly SetupLack[] = [
    {
      lacks: "Grant",
      app: "worker",
      account: "acme-org",
      repository: "acme-org/widgets",
    },
    {
      lacks: "App",
      app: "portal",
      account: "acme-org",
      repository: "acme-org/widgets",
    },
  ];
  for (const remote of remotes)
    for (const lack of lacks) {
      const { tell } = thing(lack, { remote }) as { readonly tell: string };
      expect(tell).not.toMatch(/folder|Which repository/u);
      expect(tell).toMatch(
        /^This project's repository is acme-org\/widgets\./u,
      );
    }
});

test("the repository to add is named as this folder's where the folder has a remote, and the address setup gives carries it", () => {
  const remote = setupRepositoryRead("git@github.com:acme-org/widgets.git");
  expect(
    thing({ lacks: "Binding", reach: undefined }, { remote }),
  ).toMatchObject({
    tell: `Open ${pages}/repositories?repository=acme-org%2Fwidgets&from=setup#add: it opens on acme-org/widgets, this folder's repository, shows both apps, and adds it once both reach it. Tell me once it is added.`,
  });
});

test("the repository to add is named on the connect flow where the folder has no remote, and the address says the person came from setup", () => {
  expect(
    thing(
      { lacks: "Binding", reach: undefined },
      {
        remote: undefined,
      },
    ),
  ).toMatchObject({
    tell: `Open ${pages}/repositories?from=setup#add and name your repository there: it then shows both apps, and adds it once both reach it. Tell me once it is added.`,
  });
});

test("connecting GitHub asks which repository first, names the folder's, and sends the person to the connect flow with it in the address", () => {
  const remote = setupRepositoryRead("git@github.com:acme-org/widgets.git");
  const next = thing({ lacks: "Account" }, { remote });
  expect(next).toEqual(
    bindRun(
      `Which repository is this project for? This folder's is acme-org/widgets. chuggy uses two GitHub apps. The worker app pushes ticket work to branches and opens pull requests. The portal app merges finished work into protected branches such as main. Both need access to acme-org/widgets, this folder's repository. Open ${pages}/repositories?repository=acme-org%2Fwidgets&from=setup#add: it opens on acme-org/widgets with both apps, and each app it still lacks has one press there that goes to GitHub for it. I'll wait here and add it once both reach it.`,
    ),
  );
});

test("every tell of a trip to GitHub says the repository before any app, carries it in the address it sends the person to, and never has them pick it on GitHub's page", () => {
  const remote = setupRepositoryRead("git@github.com:acme-org/widgets.git");
  const lacks: readonly SetupLack[] = [
    ...Object.values(trips).map(([lack]) => lack),
    {
      lacks: "Binding",
      reach: {
        reach: "Ungranted",
        repository: "acme-org/widgets",
        apps: [
          {
            reached: "Lacking",
            page: { app: "portal", page: "Settings", settings: "https://f/s" },
          },
          {
            reached: "Lacking",
            page: { app: "worker", page: "Install", account: "acme-org" },
          },
        ],
        installed: ["elsewhere"],
      },
    },
  ];
  for (const lack of lacks) {
    const next = thing(lack, { remote });
    const tell = next.thing === "Run" ? (next.tell ?? "") : "";
    const repository = tell.indexOf("acme-org/widgets");
    const app = tell.search(/\bapps?\b/u);
    expect(repository, lack.lacks).toBeGreaterThanOrEqual(0);
    expect(repository, lack.lacks).toBeLessThan(app);
    expect(tell, lack.lacks).toContain(
      `${pages}/repositories?repository=acme-org%2Fwidgets&from=setup#add`,
    );
    expect(tell, lack.lacks).not.toMatch(
      /All repositories|Only select repositories|pick acme-org/u,
    );
  }
});

test("a workspace named that the person is not in is said by its name", () => {
  expect(told({ lacks: "Workspace", workspace: "globex" })).toMatch(
    /^You are not in a chuggy workspace named globex\. /u,
  );
});

test("a runner added by hand is registered on Personal runners and nothing more is pressed there or on Placement, since the next run offers serve", () => {
  const byHand = told({ lacks: "Runner", chat: false });
  expect(byHand).toContain(
    `Open ${pages}/settings/workspace/runner, press Register runner`,
  );
  expect(byHand).not.toMatch(/\/runners\b|Add runner/u);
  expect(byHand).not.toMatch(/Add a project|Personal runners|placement/u);
});

test("a name is written into an address so that the address is still one address", () => {
  const choice: SetupChoice = {
    ...chosen,
    workspace: "two words",
    project: "a/b?c#d",
  };
  expect(told({ lacks: "Runner", chat: false }, { choice })).toContain(
    `Open ${stoodSite}/two%20words/a%2Fb%3Fc%23d/settings/workspace/runner, press`,
  );
});

test("a project lacking is asked a name for, to be made by project in the workspace chosen, at the address the person named where she named one", () => {
  expect(
    thing({ lacks: "Project" }, { choice: { ...chosen, project: undefined } }),
  ).toEqual({
    thing: "Name",
    ask: "First, we'll create a new project in acme. What should it be called? Pass the name as --name.",
    workspace: "acme",
    project: undefined,
  });
  const named: SetupChoice = { ...chosen, by: "Named", project: "atlas" };
  expect(thing({ lacks: "Project" }, { choice: named })).toEqual({
    thing: "Name",
    ask: "First, we'll create a new project in acme. What should it be called? Pass the name as --name.",
    workspace: "acme",
    project: "atlas",
  });
});

const unread = (fate: SetupFate): SetupLack => ({
  lacks: "Read",
  read: "placement",
  fate,
});

test("a step whose read failed, or was never asked, is a failure that says which step and why", () => {
  const found = "the runner step is not read: why";
  expect(thing(unread({ fate: "Failed", outcome: "Fault" }))).toEqual({
    thing: "Failed",
    found,
    stale: false,
  });
  expect(thing(unread({ fate: "Unasked" }))).toEqual({
    thing: "Failed",
    found,
    stale: false,
  });
  expect(thing(unread({ fate: "Failed", outcome: "Unreadable" }))).toEqual({
    thing: "Failed",
    found,
    stale: true,
  });
});

test("a step the site would not show, or sent only part of, is a state the person is told of, and no failure", () => {
  expect(thing(unread({ fate: "Refused" }))).toEqual(
    hand(
      "The chuggy site does not show you what the runner step is read from, so I cannot say whether it is done. An admin of the workspace can see it, or can give you the access to. Tell me if your access changes.",
      "if the person says their access has changed",
    ),
  );
  expect(thing(unread({ fate: "Cut" }))).toEqual(
    hand(
      "The chuggy site sent only part of what the runner step is read from, so I cannot say whether it is done. Tell me if you want me to look again.",
      "if the person asks to look again",
    ),
  );
});

test("with every step done, setup is said to be done in the ticket step's own words, and nothing is named but where the next ticket is made", () => {
  for (const detail of [
    "ticket 4 is finalized",
    "ticket 4 opened a pull request",
  ]) {
    const steps: readonly SetupStep[] = [
      ...lacking({ lacks: "Runner", chat: false }).steps.slice(0, 1),
      { step: "ticket", state: "done", detail, lacks: undefined },
    ];
    expect(
      saidNext(
        setupNext(
          lacking({ lacks: "Runner", chat: false }, { steps }),
          setupAnswersNone,
          "linux",
        ),
      ),
    ).toEqual({
      carried: setupAnswersNone,
      thing: {
        thing: "Done",
        tell: `chuggy is set up for acme/widgets: ${detail}. The next ticket is made at ${pages}/tickets/new.`,
      },
    });
  }
});

const pullRequest = "https://github.com/acme-org/widgets/pull/2";

/** Setup said to be done in the ticket step's words. */
function closing(detail: string): SaidThing {
  return {
    thing: "Done",
    tell: `chuggy is set up for acme/widgets: ${detail}. The next ticket is made at ${pages}/tickets/new.`,
  };
}

/** What a reader of this repository is told as the offer to merge `ticket`'s pull request, leaning towards leaving it to the person where `leave` is said. */
function mergeOffered(ticket: number, leave = ""): SaidThing {
  return {
    thing: "Offer",
    command: "Merge",
    tell: `Ticket ${String(ticket)} opened a pull request, ${pullRequest}, holding its work and this repository's own configuration; once it is merged, later tickets run on that configuration. Do you want me to merge it, or would you rather review it and merge it yourself?${leave} If you merge it yourself, setup is done now, and the configuration is in place once it is merged.`,
    when: "once the person says yes to chuggy merging that pull request",
    workspace: "acme",
    project: "widgets",
  };
}

const mergeLeaning =
  " I would leave it to you: a repository with a history of its own often has rules an app cannot pass, such as a branch protection or a required review or check, and its owners may want to review the change first.";

/** A site set up to a done first ticket with `landings`, its repository holding only the bootstrap unless `own`. */
function doneWith(
  landings: readonly TicketLandingResponse[],
  own = false,
): SetupSite {
  const site = setupSiteAt("Landed");
  site.projects[0]?.landings.set(1, landings);
  return own ? site : setupSiteBootstrap(site);
}

/** A site with everything but the ticket done and ticket 6 being landed with `landings`, its repository holding only the bootstrap unless `own`. */
function landingWith(
  landings: readonly TicketLandingResponse[],
  own = false,
): SetupSite {
  const { site, project } = saidRunnable();
  project.tickets.push(saidLandingTicket(6));
  project.landings.set(6, landings);
  return own ? site : setupSiteBootstrap(site);
}

/** A site with everything but the ticket done and ticket 7 in its work with `executions`, its executions read meeting `fate` where a case says so. */
function workingWith(
  executions: Parameters<SetupSite["projects"][number]["executions"]["set"]>[1],
  fate?: SetupSiteFate,
): SetupSite {
  const { site, project } = saidRunnable();
  project.tickets.push({ ticket: 7, phase: "Work" });
  project.executions.set(7, executions);
  if (fate !== undefined) site.fates.set("executions", fate);
  return site;
}

/** The tell of ticket 7 in its work, with what it waits on of the person's runners said after its phase. */
const working = (waits: string): SaidThing =>
  watchRun(
    `Ticket 7 is in Work.${waits} Setup is done when it finishes. ${pages}/tickets/7 shows where it is. I'll keep watching it and tell you what changes.`,
  );

const room = { freeMib: 1434, neededMib: 4096 };

test.each([
  [
    "short of memory",
    setupSiteWaiting(7, "Live", room),
    " It is waiting on your personal runner, which has 1.4 GiB free; this run needs 4 GiB.",
  ],
  [
    "offline",
    setupSiteWaiting(7, "Offline"),
    " It is waiting on your personal runner, which is offline.",
  ],
  [
    "unable to run it",
    setupSiteWaiting(7, "Unable"),
    " It is waiting on your personal runners, and none of them can run it.",
  ],
] as const)(
  "a ticket whose starting execution waits on the person's runners %s is told that fact, and no remedy, in one sentence after its phase",
  async (_, execution, waits) => {
    expect((await nextSaid(workingWith([execution]))).thing).toEqual(
      working(waits),
    );
  },
);

test("a ticket whose starting execution waits on its project's pools short of memory is told how much they have free and it needs, and no remedy, in one sentence after its phase", async () => {
  expect(
    (await nextSaid(workingWith([setupSitePoolWaiting(7, room)]))).thing,
  ).toEqual(
    working(
      " It is waiting on this project's runners, which have 1.4 GiB free; this run needs 4 GiB.",
    ),
  );
});

test("a ticket whose starting execution waits on runners that are live, with no room said, is told as it was before any wait was read", async () => {
  expect(
    (await nextSaid(workingWith([setupSiteWaiting(7, "Live")]))).thing,
  ).toEqual(working(""));
});

test.each(["Refused", "Failed", "Garbled", "Unauthenticated", "Cut"] as const)(
  "a ticket's executions read answered as %s stops nothing, and the ticket is told as it was before any wait was read",
  async (fate) => {
    expect(
      (await nextSaid(workingWith([setupSiteWaiting(7, "Live", room)], fate)))
        .thing,
    ).toEqual(working(""));
  },
);

test("where the repository holds only the bootstrap and the ticket's pull request stands unmerged, the next thing is the offer to merge it, by its address and its ticket, in place of setup done", async () => {
  expect(
    (await nextSaid(doneWith([setupSiteOpened(pullRequest)]))).thing,
  ).toEqual(mergeOffered(1));
  expect(
    (await nextSaid(landingWith([setupSiteProposed(pullRequest)]))).thing,
  ).toEqual(mergeOffered(6));
  const older = setupSiteProposed("https://github.com/acme-org/widgets/pull/1");
  expect(
    (await nextSaid(doneWith([older, setupSiteOpened(pullRequest)]))).thing,
  ).toEqual(mergeOffered(1));
});

test("the merge offer leans towards leaving the merge to the person, and says why, only where the folder's history is longer than a new repository's", async () => {
  const site = doneWith([setupSiteOpened(pullRequest)]);
  const offered = async (history: SetupHistory) =>
    (await nextSaid(site, { merge: { seen: "Offered", history } })).thing;
  expect(await offered("Long")).toEqual(mergeOffered(1, mergeLeaning));
  expect(await offered("Short")).toEqual(mergeOffered(1));
  expect(await offered("Unread")).toEqual(mergeOffered(1));
});

test("where the site refused the merge, setup done closes as it always has, with the pull request still unmerged", async () => {
  expect(
    (
      await nextSaid(doneWith([setupSiteOpened(pullRequest)]), {
        merge: { seen: "Refused" },
      })
    ).thing,
  ).toEqual(closing("ticket 1 is done"));
});

test("where the repository holds its own configuration, setup done closes as it always has, whatever pull request the ticket opened", async () => {
  expect(
    (await nextSaid(doneWith([setupSiteOpened(pullRequest)], true))).thing,
  ).toEqual(closing("ticket 1 is done"));
  expect(
    (await nextSaid(landingWith([setupSiteProposed(pullRequest)], true))).thing,
  ).toEqual(closing("ticket 6 opened a pull request"));
});

test("where the repository holds only the bootstrap and no pull request of the ticket stands unmerged, setup done closes as it always has: none opened, one pushed, one that landed or says it merged, one failed or invalidated", async () => {
  const opened = setupSiteOpened(pullRequest);
  const proposal = {
    url: pullRequest,
    headRef: "chug/ticket",
    headCommit: "b".repeat(40),
    baseRef: "main",
  };
  const unstanding: readonly (readonly TicketLandingResponse[])[] = [
    [],
    [setupSiteLanded],
    [{ ...setupSiteLanded, proposal }],
    [{ ...setupSiteLanded, proposal: { ...proposal, merge: "Merged" } }],
    [{ ...opened, proposal: { ...proposal, merge: "Merged" } }],
    [{ ...opened, state: "Failed" }],
    [{ ...opened, state: "Invalidated" }],
    [opened, setupSiteLanded],
  ];
  for (const landings of unstanding)
    expect(
      (await nextSaid(doneWith(landings))).thing,
      JSON.stringify(landings),
    ).toEqual(closing("ticket 1 is done"));
  expect(
    (await nextSaid(landingWith([{ ...setupSiteLanded, proposal }]))).thing,
  ).toEqual(closing("ticket 6 is finalized"));
});

test.each(["Refused", "Failed", "Garbled", "Unauthenticated", "Cut"] as const)(
  "the done ticket's landings answered as %s leave setup done, closing as it always has, and stop nothing",
  async (fate) => {
    const site = doneWith([setupSiteOpened(pullRequest)]);
    site.fates.set("landings", fate);
    expect((await nextSaid(site)).thing).toEqual(closing("ticket 1 is done"));
  },
);

/** The line that sets up the runner, with the chat host where `chat`, on another machine. */
function otherMachine(chat: boolean): string {
  const things = chat ? "runner and chat host" : "runner";
  const host = chat ? " --chat-host yes" : "";
  return `Make this machine my chuggy ${things}: run "curl -fsS ${stoodSite}/chuggy-setup.mjs -o ~/.chuggy-setup.mjs && node ~/.chuggy-setup.mjs runner --site ${stoodSite} --workspace acme --project widgets${host}" and do what its output says.`;
}

const offered = (tell: string, chat = false): SaidThing => ({
  thing: "Offer",
  command: "Runner",
  tell,
  when: "once the person has been told what it does here, has not objected, and has not asked for it on another machine instead",
  workspace: "acme",
  project: "widgets",
  chatHost: chat,
  elsewhere: otherMachine(chat),
});

/** What is next for a lack once the machine was looked at and showed `room`. */
function here(
  lack: SetupLack,
  room: SetupRunnerRoom,
  held: SetupRunnerHeld | undefined = undefined,
  chat = false,
  platform: SetupPlatform = "linux",
): SaidThing {
  const looked: SetupRunnerHere = {
    room,
    held,
    chat,
    claude: "Subscription",
    fit: { fit: "Room" },
    settings: undefined,
    loginMissing: undefined,
  };
  return saidThing(
    setupNext(lacking(lack), setupAnswersNone, platform, looked).thing,
  );
}

const roomy: SetupRunnerRoom = { room: "Open", engine: "docker" };

/** The lacks of the runner's step, which `runner` mends. */
const runnerKinds: readonly string[] = ["Runner", "RunnerLive"];
const runnerIs =
  "The next step is a runner: the machine that does the work on your tickets";

const runnerOnly =
  "I'll install your runner on this machine, as yours alone. Say if you'd rather not have it here, or want it on another machine.";
const runnerAndHost =
  "I'll install your chat host and your runner on this machine, as yours alone. Say if you'd rather not have either here, or want them on another machine.";
const putHere =
  "The runner package, chuggy-linux, runs it as a background service of yours that starts when you log in. Work on your tickets then runs on this machine in containers, on your Claude plan.";

/** What no tell of the runner's step says where the machine fits a job as it stands: a memory, Colima, or a file's mode. */
const unsaid = /GiB|MiB|Colima|mode 600|setup-token/u;
const takesWork =
  "Your runner will take work for acme/widgets. Say if you'd rather it didn't.";

test("with no runner yet and a machine that could take one, the person is told what a runner is, that it goes here as theirs alone and takes the project's work, and the line for another machine instead, and nothing waits on a yes", () => {
  expect(here({ lacks: "Runner", chat: false }, roomy)).toEqual(
    offered(`${runnerOnly} ${putHere} ${takesWork}`),
  );
  expect(here({ lacks: "Runner", chat: false }, roomy, "Personal")).toEqual(
    here({ lacks: "Runner", chat: false }, roomy),
  );
});

test("with neither a runner nor the person's chat host, the offer installs both by default, says what neither holds, and introduces neither again", () => {
  const told = here({ lacks: "Runner", chat: true }, roomy);
  expect(told).toEqual(
    offered(`${runnerAndHost} ${putHere} ${takesWork}`, true),
  );
  expect(toldOf(told)).not.toMatch(unsaid);
  expect(toldOf(told)).not.toContain("Now let's");
});

/** What is next for a runner the machine lacks, where its settings and Claude login are as `looked` says. */
function hereFound(
  chat: boolean,
  looked: Pick<SetupRunnerHere, "settings" | "loginMissing" | "claude">,
): SaidThing {
  return saidThing(
    setupNext(lacking({ lacks: "Runner", chat }), setupAnswersNone, "linux", {
      room: roomy,
      held: undefined,
      chat: false,
      fit: { fit: "Room" },
      ...looked,
    }).thing,
  );
}

test("runner settings already on this machine are named before anything is changed, with the Claude credential they run work on, which is whose they are", () => {
  const settings = "/home/person/.config/chuggy-linux/runner.json";
  const found = (credential: SetupClaudeCredential) =>
    hereFound(false, {
      claude: credential.kind,
      settings: { path: settings, credential },
      loginMissing: undefined,
    });
  expect(found({ kind: "Subscription", path: "/home/other/token" })).toEqual(
    offered(
      `${runnerOnly} This machine already has runner settings, in ${settings}, which run its work on the Claude login at /home/other/token. I keep them as they are. ${putHere} ${takesWork}`,
    ),
  );
  expect(
    (found({ kind: "ApiKey", path: "/srv/key" }) as { tell: string }).tell,
  ).toContain(
    `This machine already has runner settings, in ${settings}, which run its work on the Anthropic API key at /srv/key. I keep them as they are.`,
  );
});

/** The runner step's opening, with the chat host where `chat`. */
function opening(chat: boolean): string {
  return chat
    ? "Now let's set up your chat host and a runner. The chat host will power your chat in the chuggy web app, and the runner will run your work. You'll need a token from `claude setup-token` or an Anthropic API key. Point me to it and I'll set these up on this machine. If you want them hosted elsewhere, let me know."
    : "Now let's set up a runner, which will run your work. You'll need a token from `claude setup-token` or an Anthropic API key. Point me to it and I'll set it up on this machine. If you want it hosted elsewhere, let me know.";
}

test("with no Claude credential on this machine, the step opens once, asking for a token or an API key by its path and offering another machine, and offers nothing else", () => {
  const login = "/home/person/.config/chuggy-linux/claude/token";
  for (const chat of [true, false]) {
    const told = hereFound(chat, {
      claude: "Subscription",
      settings: undefined,
      loginMissing: { kind: "Subscription", path: login },
    });
    expect(told, String(chat)).toEqual({
      thing: "Offer",
      command: "Runner",
      tell: opening(chat),
      when: "once the person points you to the file of a token from `claude setup-token`, with the first, or of an Anthropic API key, with the second, and has not asked for it on another machine instead",
      workspace: "acme",
      project: "widgets",
      chatHost: false,
      credential: true,
      elsewhere: otherMachine(chat),
    });
    expect(toldOf(told)).not.toMatch(/GiB|MiB|Colima|mode 600|\/home\//u);
  }
});

test("runner settings naming a Claude credential that is not there have the person put it where they name it, before anything is installed", () => {
  const key = "/srv/key";
  const credential: SetupClaudeCredential = { kind: "ApiKey", path: key };
  expect(
    hereFound(true, {
      claude: "ApiKey",
      settings: {
        path: "/home/person/.config/chuggy-linux/runner.json",
        credential,
      },
      loginMissing: credential,
    }),
  ).toEqual({
    thing: "Hand",
    tell: `Now let's set up your chat host and a runner. The chat host will power your chat in the chuggy web app, and the runner will run your work. First, Claude needs to be logged in for them: the runner's settings name its Anthropic API key as ${key}, and nothing is there. ${copyTextEn(setupClaudeSaved(credential))} Tell me once it is there.`,
    when: copyTextEn({
      id: "setup-runner-login-missing-when",
      args: { credential: setupClaudeWords.ApiKey.credential },
    }),
  });
});

test("with the runner's credential in place, the offer follows without the opening, whether settings were there before or written with the credential", () => {
  for (const credential of [
    {
      kind: "Subscription",
      path: "/home/person/.config/chuggy-linux/claude/token",
    },
    {
      kind: "ApiKey",
      path: "/home/person/.config/chuggy-linux/claude/api-key",
    },
  ] as const) {
    const told = toldOf(
      hereFound(true, {
        claude: credential.kind,
        settings: {
          path: "/home/person/.config/chuggy-linux/runner.json",
          credential,
        },
        loginMissing: undefined,
      }),
    );
    expect(told, credential.kind).toMatch(
      /^I'll install your chat host and your runner/u,
    );
    expect(told, credential.kind).not.toContain("Now let's");
    expect(told, credential.kind).not.toMatch(/GiB|MiB|Colima|mode 600/u);
  }
});

test("where this machine could not take a runner the person is told why instead, and nothing is offered: user services that do not answer, no engine, and on a Mac, Colima not started", () => {
  const running = "once the person says the runner is running";
  expect(
    here({ lacks: "Runner", chat: false }, { room: "Serviceless" }),
  ).toEqual(
    hand(
      `${runnerIs}. chuggy setup runs one as a background service of yours, and this machine's user services did not answer, so it cannot set one up here. Open ${pages}/settings/workspace/runner, press Register runner and do what it shows on the machine that will run the work. Tell me once the runner is running.`,
      running,
    ),
  );
  expect(
    here(
      { lacks: "Runner", chat: false },
      {
        room: "Engineless",
        asked: [
          { engine: "docker", answered: "No" },
          { engine: "podman", answered: "Absent" },
        ],
        start: undefined,
      },
    ),
  ).toEqual(
    hand(
      `${runnerIs}, in containers. This machine cannot be one yet: neither Docker nor Podman answered here without a password. Installing a container engine, or letting your user reach one, takes a password, and chuggy setup never takes one. Tell me once one answers you here. For a runner on another machine instead, open ${pages}/settings/workspace/runner there, press Register runner and do what it shows, and tell me once it is running.`,
      "once the person says a container engine answers them on this machine, or that a runner is running",
    ),
  );
  expect(
    here(
      { lacks: "Runner", chat: false },
      {
        room: "Engineless",
        asked: [{ engine: "docker", answered: "No" }],
        start: "colima start",
      },
      undefined,
      false,
      "darwin",
    ),
  ).toMatchObject({
    tell: `${runnerIs}, in containers. This machine cannot be one yet: Docker did not answer here. On a Mac, Docker runs in Colima, which colima start starts without a password. Tell me once Docker answers you here. For a runner on another machine instead, open ${pages}/settings/workspace/runner there, press Register runner and do what it shows, and tell me once it is running.`,
  });
});

test("a user the runner package bars from docker is told the package's reason and its way out before any runner is offered here, and the page for another machine", () => {
  const why =
    "Under docker a runner's work runs as this machine's user 1000, which could not read the file your Claude credential is in, so the runner package takes docker only from that user, and you are user 1001.";
  const podman =
    "The package's own answer for any other user is rootless podman";
  const instead = `For a runner on another machine instead, open ${pages}/settings/workspace/runner there, press Register runner and do what it shows, and tell me once it is running.`;
  expect(
    here(
      { lacks: "Runner", chat: false },
      {
        room: "DockerBarred",
        user: "1001",
        how: { barred: "Podmanless", answered: "Absent" },
      },
    ),
  ).toEqual(
    hand(
      `${runnerIs}, in containers. This machine cannot be one yet. ${why} ${podman}, and podman is not installed. Installing a container engine, or letting your user reach one, takes a password, and chuggy setup never takes one. Tell me once podman answers you. ${instead}`,
      "once the person says podman answers them on this machine, or that a runner is running",
    ),
  );
  expect(
    here(
      { lacks: "Runner", chat: false },
      {
        room: "DockerBarred",
        user: "1001",
        how: { barred: "Named", settings: "/home/person/runner.json" },
      },
    ),
  ).toEqual(
    hand(
      `${runnerIs}, in containers. This machine cannot be one yet. ${why} The runner's settings, /home/person/runner.json, set it to use docker. ${podman}: once podman answers you, set "engine" to "podman" in that file, and tell me once you have. ${instead}`,
      "once the person says /home/person/runner.json names podman, or that a runner is running",
    ),
  );
});

test("a runner registered and not running is offered to be started here only where this machine holds the person's runner's registration, said as held and as registered again where the site no longer knows it, offered to be registered again beside a pool's registration, and where this machine holds none is offered as where there is no runner", () => {
  const holds =
    "A runner is registered for acme/widgets and is not running, and this machine holds the registration of a runner. I'll check it and start it here as a background service of yours that starts when you log in, registering this machine again as yours alone first if the site no longer knows that registration, so work on your tickets runs on this machine in containers, on your Claude plan.";
  const instead =
    "It can live on another machine instead; say so if you want that.";
  expect(here({ lacks: "RunnerLive", chat: false }, roomy, "Personal")).toEqual(
    offered(`${holds} ${takesWork} ${instead}`),
  );
  for (const room of [roomy, { room: "Serviceless" }] as const)
    expect(here({ lacks: "RunnerLive", chat: false }, room), room.room).toEqual(
      here({ lacks: "Runner", chat: false }, room),
    );
  expect(here({ lacks: "RunnerLive", chat: true }, roomy, "Personal")).toEqual(
    offered(
      `${holds} I'll make this machine your chat host too. ${takesWork} ${instead}`,
      true,
    ),
  );
  expect(here({ lacks: "RunnerLive", chat: false }, roomy, "Pool")).toEqual(
    offered(
      `A runner is registered for acme/widgets and is not running, and this machine holds the registration of a runner of the project's rather than yours. I'll leave that registration as it is and register this machine again as yours alone, then check your runner and start it here as a background service of yours that starts when you log in, so work on your tickets runs on this machine in containers, on your Claude plan. ${takesWork} ${instead}`,
    ),
  );
});

test("an offer names a Claude plan only where the runner's credential is a subscription's: another kind is named as its own, and one whose settings could not be read is not named at all", () => {
  const said = (claude: SetupClaudeKind | undefined) =>
    (
      [
        [{ lacks: "Runner", chat: false }, undefined],
        [{ lacks: "Runner", chat: true }, undefined],
        [{ lacks: "RunnerLive", chat: false }, "Personal"],
      ] as const
    ).map(([lack, held]) => {
      const { thing } = saidNext(
        setupNext(lacking(lack), setupAnswersNone, "linux", {
          room: roomy,
          held,
          chat: false,
          claude,
          fit: { fit: "Room" },
          settings: undefined,
          loginMissing: undefined,
        }),
      );
      return thing.thing === "Offer" ? thing.tell : "";
    });
  for (const tell of said("Subscription"))
    expect(tell).toContain("in containers, on your Claude plan.");
  for (const [claude, on] of [
    ["ApiKey", "your Anthropic API key"],
    ["Bedrock", "your Amazon Bedrock account"],
    ["Vertex", "your Google Cloud project"],
    ["Foundry", "your Microsoft Foundry resource"],
  ] as const)
    for (const tell of said(claude)) {
      expect(tell, claude).toContain(`in containers, on ${on}.`);
      expect(tell, claude).not.toContain("Claude plan");
    }
  for (const tell of said(undefined)) {
    expect(tell).toContain("in containers.");
    expect(tell).not.toContain("Claude plan");
  }
});

test("what the machine showed moves no step but the runner's", () => {
  for (const [kind, [lack, told]] of Object.entries(mends))
    if (!runnerKinds.includes(kind))
      expect(here(lack, roomy, "Personal"), kind).toEqual(told);
});

test("a project lacking is asked for the same whatever the machine showed, and has the machine looked at for nothing", () => {
  const lack: SetupLack = { lacks: "Project" };
  expect(here(lack, roomy, "Personal")).toEqual(thing(lack));
  expect(setupRunnerDue(lacking(lack))).toBeUndefined();
  expect(setupMcpDue(lacking(lack))).toBeUndefined();
});

test("the machine is looked at only where the runner's step is the first not done and the project is chosen", () => {
  const due = (lack: SetupLack, given?: Partial<SetupStanding>) =>
    setupRunnerDue(lacking(lack, given));
  expect(due({ lacks: "Runner", chat: false })).toEqual({
    tenant: "acme",
    project: "widgets",
  });
  expect(due({ lacks: "RunnerLive", chat: false })).toEqual({
    tenant: "acme",
    project: "widgets",
  });
  for (const [kind, [lack]] of Object.entries(mends))
    if (!runnerKinds.includes(kind)) expect(due(lack), kind).toBeUndefined();
  expect(due(unread({ fate: "Refused" }))).toBeUndefined();
  expect(
    due(
      { lacks: "Runner", chat: false },
      { choice: { ...chosen, project: undefined } },
    ),
  ).toBeUndefined();
  expect(
    due(
      { lacks: "Runner", chat: false },
      {
        choice: {
          choice: "Open",
          open: "project",
          workspace: "acme",
          among: [],
          whole: true,
        },
      },
    ),
  ).toBeUndefined();
  const behind: readonly SetupStep[] = [
    { step: "github", state: "todo", detail: "", lacks: { lacks: "Account" } },
    {
      step: "runner",
      state: "todo",
      detail: "",
      lacks: { lacks: "Runner", chat: false },
    },
  ];
  expect(
    due({ lacks: "Runner", chat: false }, { steps: behind }),
  ).toBeUndefined();
});

/** The step that decides what is next at each stage of a site set up one thing at a time: the first that is not done. */
const deciding: Readonly<
  Record<
    SetupSiteStage,
    | keyof typeof mends
    | keyof typeof trips
    | "Project"
    | "Configuration"
    | "Landing"
    | "Done"
  >
> = {
  Nothing: "Workspace",
  Workspace: "Project",
  Project: "Account",
  Portal: "App",
  Apps: "Binding",
  Added: "Configuration",
  Configured: "Runner",
  Offline: "RunnerLive",
  Live: "Ticket",
  Draft: "Release",
  Moving: "Landing",
  Landed: "Done",
};

test("at each stage of a site the first step that is not done decides what is next, and with one workspace and one project no command carries a name", async () => {
  for (const stage of setupSiteStages) {
    const next = await nextSaid(setupSiteAt(stage));
    const kind = deciding[stage];
    expect(next.carried, stage).toEqual(setupAnswersNone);
    if (kind === "Done") expect(next.thing.thing, stage).toBe("Done");
    else if (kind === "Project")
      expect(next.thing, stage).toMatchObject({
        thing: "Name",
        workspace: "acme",
        project: undefined,
      });
    else if (kind === "Configuration")
      expect(next.thing, stage).toMatchObject({
        thing: "Configure",
        workspace: "acme",
        project: "widgets",
      });
    else if (kind === "Account" || kind === "App" || kind === "Grant")
      expect(next.thing, stage).toMatchObject({
        thing: "Run",
        command: "Bind",
      });
    else if (kind === "Landing")
      expect(next.thing, stage).toMatchObject({
        thing: "Run",
        command: "Watch",
      });
    else {
      const { when } = mends[kind][1] as { readonly when: string };
      expect(next.thing, stage).toMatchObject({ thing: "Hand", when });
    }
  }
});

test("a ticket released and not started is what is next only once the project has somewhere to run it: before that the runner is", async () => {
  const pending = (stage: SetupSiteStage) => {
    const site = setupSiteAt(stage);
    site.projects[0]?.tickets.push({ ticket: 4, phase: "Pending" });
    return nextSaid(site);
  };
  expect((await pending("Live")).thing).toEqual(mends.Dispatch[1]);
  expect((await pending("Configured")).thing).toEqual(mends.Runner[1]);
  expect((await pending("Offline")).thing).toEqual(mends.RunnerLive[1]);
});

const open = (
  flag: "workspace" | "project",
  among: readonly string[],
  whole = true,
): SetupStanding =>
  lacking(
    { lacks: "Ticket", pullRequest: true },
    {
      steps: [],
      choice: {
        choice: "Open",
        open: flag,
        workspace: flag === "project" ? "acme" : undefined,
        among,
        whole,
      },
    },
  );

test("a choice that is the person's is asked one flag at a time, among the names the site gave", () => {
  expect(
    saidNext(
      setupNext(
        open("workspace", ["acme", "globex"]),
        setupAnswersNone,
        "linux",
      ),
    ),
  ).toEqual({
    carried: setupAnswersNone,
    thing: {
      thing: "Ask",
      ask: "Which workspace is this for: acme or globex? Pass the name as --workspace.",
      flag: "workspace",
    },
  });
  expect(
    saidNext(
      setupNext(
        open("project", ["gadgets", "sprockets", "widgets"]),
        setupAnswersNone,
        "linux",
      ),
    ),
  ).toEqual({
    carried: { workspace: "acme", project: undefined },
    thing: {
      thing: "Ask",
      ask: "Which project of acme is this for: gadgets, sprockets or widgets? Pass the name as --project.",
      flag: "project",
    },
  });
});

test("a question about the workspace keeps the project the run named, and one about the project keeps the workspace it is of", () => {
  const named = { workspace: undefined, project: "widgets" };
  expect(
    saidNext(setupNext(open("workspace", ["acme", "globex"]), named, "linux"))
      .carried,
  ).toEqual(named);
  expect(
    setupNext(
      open("project", ["gadgets"]),
      {
        workspace: "acme",
        project: undefined,
      },
      "linux",
    ).carried,
  ).toEqual({ workspace: "acme", project: undefined });
});

test("a question says where the site sent only part of the names, and lists a bounded few of a long list", () => {
  expect(
    saidNext(
      setupNext(open("project", ["widgets"], false), setupAnswersNone, "linux"),
    ).thing,
  ).toMatchObject({
    ask: "Which project of acme is this for: widgets? The site sent only part of the list, so the one meant may not be named here. Pass the name as --project.",
  });
  expect(
    saidNext(setupNext(open("project", [], false), setupAnswersNone, "linux"))
      .thing,
  ).toMatchObject({
    ask: "Which project of acme is this for? The site sent only part of the list, so the one meant may not be named here. Pass the name as --project.",
  });
  const many = Array.from(
    { length: setupAskNamesMax + 3 },
    (_, at) => `p${String(at)}`,
  );
  const shown = many.slice(0, setupAskNamesMax).join(", ");
  expect(
    saidNext(setupNext(open("project", many), setupAnswersNone, "linux")).thing,
  ).toMatchObject({
    ask: `Which project of acme is this for: ${shown} and 3 more? Pass the name as --project.`,
  });
});

test("a project that was named or proposed is carried by name with its workspace, so the next command means the same one", async () => {
  const site = setupSiteAt("Live");
  const named = await nextSaid(site, { answers: { project: "widgets" } });
  expect(named.carried).toEqual({ workspace: "acme", project: "widgets" });
  const only = await nextSaid(site, { answers: { workspace: "acme" } });
  expect(only.carried).toEqual({ workspace: "acme", project: "widgets" });
});

const reachSaid = `Which repository is this project for? This folder's is acme-org/widgets, so that is the one I connect; for another, start me in the folder of its clone. chuggy uses two GitHub apps. The worker app pushes ticket work to branches and opens pull requests. The portal app merges finished work into protected branches such as main. Both need access to acme-org/widgets.`;

test("the folder's repository both apps are granted has bind run at once for the project, told with both apps' pages as granted, and is what bind is due to add", () => {
  const lack: SetupLack = {
    lacks: "Binding",
    reach: {
      reach: "Granted",
      repository: "acme-org/widgets",
      url: "https://github.com/acme-org/widgets",
      apps: [
        { reached: "Granted", app: "portal", settings: "https://forge/p" },
        { reached: "Granted", app: "worker", settings: undefined },
      ],
      installed: [],
    },
  };
  expect(thing(lack)).toEqual(
    bindRun(
      `${reachSaid} 1. Portal: https://forge/p, already granted acme-org/widgets 2. Worker: already granted acme-org/widgets. Both are granted it, so I add it now.`,
    ),
  );
  expect(setupBindDue(lacking(lack))).toEqual({
    partition: { tenant: "acme", project: "widgets" },
    repository: "acme-org/widgets",
    url: "https://github.com/acme-org/widgets",
  });
});

test("both apps are named in one tell, each with whether it reaches the folder's repository, with the connect flow's address, bind run at once to wait for them and nothing yet due to bind", () => {
  const lack: SetupLack = {
    lacks: "Binding",
    reach: {
      reach: "Ungranted",
      repository: "acme-org/widgets",
      apps: [
        {
          reached: "Lacking",
          page: {
            app: "portal",
            page: "Settings",
            settings: "https://forge/settings",
          },
        },
        {
          reached: "Lacking",
          page: { app: "worker", page: "Install", account: "acme-org" },
        },
      ],
      installed: [],
    },
  };
  expect(thing(lack)).toEqual(
    bindRun(
      `${reachSaid} 1. Portal: installed, not let into acme-org/widgets yet 2. Worker: not installed on acme-org yet. I'll wait here. Open ${pages}/repositories?repository=acme-org%2Fwidgets&from=setup#add: it opens on acme-org/widgets, and each app it still lacks has one press there that goes to GitHub for it. GitHub may ask you to confirm access first, with a code it emails you.`,
    ),
  );
  expect(setupBindDue(lacking(lack))).toBeUndefined();
  expect(
    setupBindDue(lacking({ lacks: "Binding", reach: undefined })),
  ).toBeUndefined();
});

test("accounts the workspace holds both apps on beside the repository's owner are said once the repository is, as why their repositories are shown", () => {
  const reach = (installed: readonly string[]): SetupLack => ({
    lacks: "Binding",
    reach: {
      reach: "Granted",
      repository: "acme-org/widgets",
      url: "https://github.com/acme-org/widgets",
      apps: [
        { reached: "Granted", app: "portal", settings: undefined },
        { reached: "Granted", app: "worker", settings: undefined },
      ],
      installed,
    },
  });
  const told = (installed: readonly string[]): string => {
    const run = thing(reach(installed));
    return run.thing === "Run" ? (run.tell ?? "") : "";
  };
  const asked =
    "Which repository is this project for? This folder's is acme-org/widgets, so that is the one I connect; for another, start me in the folder of its clone. ";
  expect(told(["elsewhere"])).toContain(
    `${asked}elsewhere already has chuggy's apps installed, so I can see its repositories. Another workspace can only where one of its admins owns elsewhere on GitHub. chuggy uses two GitHub apps.`,
  );
  expect(told(["one", "two"])).toContain(
    `${asked}one, two already have chuggy's apps installed, so I can see their repositories. `,
  );
  expect(told([])).toContain(`${asked}chuggy uses two GitHub apps.`);
});

test("bind waits while the next thing is a trip to GitHub, and on nothing else", () => {
  const ungranted: SetupLack = {
    lacks: "Binding",
    reach: {
      reach: "Ungranted",
      repository: "acme-org/widgets",
      apps: [
        { reached: "Granted", app: "portal", settings: undefined },
        {
          reached: "Lacking",
          page: {
            app: "worker",
            page: "Settings",
            settings: "https://forge/s",
          },
        },
      ],
      installed: [],
    },
  };
  for (const [lack] of Object.values(trips))
    expect(setupBindAwaited(lacking(lack)), lack.lacks).toBe(true);
  expect(setupBindAwaited(lacking(ungranted))).toBe(true);
  for (const lack of [
    { lacks: "Binding", reach: undefined },
    unconfigured(),
    { lacks: "Ticket", pullRequest: true },
    { lacks: "Runner", chat: false },
  ] as const satisfies readonly SetupLack[])
    expect(setupBindAwaited(lacking(lack)), lack.lacks).toBe(false);
});

test("the page bind opens is the connect flow, on the folder's repository where it has one, and only where connecting GitHub is next", () => {
  expect(setupConnectDue(lacking({ lacks: "Account" }))).toBe(
    `${pages}/repositories?from=setup#add`,
  );
  expect(
    setupConnectDue(
      lacking(
        { lacks: "Account" },
        { remote: setupRepositoryRead("git@github.com:acme-org/widgets.git") },
      ),
    ),
  ).toBe(`${pages}/repositories?repository=acme-org%2Fwidgets&from=setup#add`);
  expect(
    setupConnectDue(
      lacking({
        lacks: "App",
        app: "worker",
        account: "a",
        repository: undefined,
      }),
    ),
  ).toBeUndefined();
});

/** What a personal runner of the person's lacks to take the project's work. */
function serving(
  given: boolean,
  named: boolean,
  administers: boolean,
): SetupLack {
  return { lacks: "Serving", given, named, administers };
}

const servingWhen =
  "once the person says yes to their runner taking the project's work";
const servingPlacement = `${pages}/settings/placement`;

test("a personal runner that does not take the project's work is offered serve, which gives it the project and lets the person's own runners take the work, each only where it is lacking", () => {
  const offered = (tell: string): SaidThing => ({
    thing: "Offer",
    command: "Serve",
    tell: `Your runner is registered and does not take acme/widgets's work yet. With your yes I will ${tell}. Tell me yes to go ahead.`,
    when: servingWhen,
    workspace: "acme",
    project: "widgets",
  });
  expect(thing(serving(false, false, true))).toEqual(
    offered("give it acme/widgets and let your own runners take its work"),
  );
  expect(thing(serving(false, true, true))).toEqual(
    offered("give it acme/widgets"),
  );
  expect(thing(serving(false, true, false))).toEqual(
    offered("give it acme/widgets"),
  );
  expect(thing(serving(true, false, true))).toEqual(
    offered("let your own runners take acme/widgets's work"),
  );
});

test("a person who cannot administer a project naming no owner fallback is offered serve for the project alone, and told an admin sets Personal runners on its Placement page", () => {
  const admin = `Your own runners take its work only once an admin of the project sets Personal runners on its Placement page, ${servingPlacement}.`;
  expect(thing(serving(false, false, false))).toEqual({
    thing: "Offer",
    command: "Serve",
    tell: `Your runner is registered and does not take acme/widgets's work yet. With your yes I will give it acme/widgets. ${admin} Tell me yes to go ahead.`,
    when: servingWhen,
    workspace: "acme",
    project: "widgets",
  });
  expect(thing(serving(true, false, false))).toEqual(
    hand(
      `Your runner is registered and given acme/widgets, and does not take its work yet. ${admin} Tell me once they have.`,
      "once the person says an admin of the project set Personal runners",
    ),
  );
});

test("serve is due only where the runner step lacks Serving and writes only what the person may and what is lacking: the project given where it is not, and Preferred where no fallback is named and the person administers", () => {
  const partition = { tenant: "acme", project: "widgets" };
  const due = (lack: SetupLack) => setupServeDue(lacking_(lack));
  expect(due(serving(false, false, true))).toEqual({
    partition,
    give: true,
    allow: true,
  });
  expect(due(serving(false, true, true))).toEqual({
    partition,
    give: true,
    allow: false,
  });
  expect(due(serving(false, false, false))).toEqual({
    partition,
    give: true,
    allow: false,
  });
  expect(due(serving(true, false, true))).toEqual({
    partition,
    give: false,
    allow: true,
  });
  expect(due(serving(true, false, false))).toBeUndefined();
  expect(due({ lacks: "Runner", chat: false })).toBeUndefined();
  expect(setupRunnerDue(lacking_(serving(false, false, true)))).toBeUndefined();
});
