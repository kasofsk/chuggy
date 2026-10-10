/**
 * The one next thing the setup program names, for every standing.
 *
 * The program has no command that does a step, so each thing a step can lack
 * is mended by the person on a page of the console: the table below holds
 * every lack there is, and will not compile with one missing, against the
 * page's full address, what is pressed there, and the condition the checklist
 * may be read again under. Nothing here is ever a command to run: a step that
 * waits on the person is told to her and stops.
 */

import { expect, test } from "vitest";

import { setupAnswersNone } from "../app/core/setupArguments.ts";
import { repositoryGrantLines } from "../app/core/projectRepositories.ts";
import { setupAskNamesMax, setupNext } from "../app/core/setupNext.ts";
import type { SetupChoice } from "../app/core/setupReads.ts";
import { setupRepositoryRead } from "../app/core/setupRemote.ts";
import type { SetupThing } from "../app/core/setupReport.ts";
import type {
  SetupFate,
  SetupLack,
  SetupStanding,
  SetupStep,
} from "../app/core/setupStanding.ts";
import { setupSiteAt, setupSiteStages } from "./setupSite.ts";
import type { SetupSiteStage } from "./setupSite.ts";
import { nextOf, stoodSite } from "./setupStood.ts";

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
    { step: "ticket", state: "todo", detail: "", lacks: { lacks: "Ticket" } },
  ];
  return {
    site: stoodSite,
    choice: chosen,
    remote: undefined,
    found: [],
    steps,
    ...given,
  };
}

function thing(lack: SetupLack, given?: Partial<SetupStanding>): SetupThing {
  return setupNext(lacking(lack, given), setupAnswersNone).thing;
}

/** What the person is told of a lack, which is nothing where it is not hers to mend. */
function told(lack: SetupLack, given?: Partial<SetupStanding>): string {
  const next = thing(lack, given);
  return next.thing === "Hand" ? next.tell : "";
}

const hand = (tell: string, when: string): SetupThing => ({
  thing: "Hand",
  tell,
  when,
});

const pages = `${stoodSite}/acme/widgets`;
const create = `Open ${pages}/tickets/new, say what you want done and press Create ticket`;

/** Every thing a step can lack, the lack as it is found, and what the person is told to do about it. */
const mends: {
  readonly [Kind in Exclude<SetupLack["lacks"], "Read">]: readonly [
    Extract<SetupLack, { readonly lacks: Kind }>,
    SetupThing,
  ];
} = {
  Workspace: [
    { lacks: "Workspace", workspace: undefined },
    hand(
      `You are not in a chuggy workspace yet. A new workspace is made from an invite link: open the one you were sent (it starts ${stoodSite}/invite), and under New workspace name the workspace and press Create. Tell me once it is made.`,
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
  Project: [
    { lacks: "Project" },
    hand(
      `Open ${stoodSite}/projects/new?workspace=acme, the New project page, name the project and press Create project. Tell me once it is made.`,
      "once the person says the project is made",
    ),
  ],
  NorthStar: [
    { lacks: "NorthStar" },
    hand(
      `Open ${pages}/settings/lead, press Edit beside North Star, write a paragraph that says what the project is for, and press Save changes. Tell me once it is saved.`,
      "once the person says the North Star is saved",
    ),
  ],
  Grant: [
    {
      lacks: "Grant",
      app: "worker",
      account: "acme-org",
      repository: "acme-org/widgets",
    },
    hand(
      `The worker app is installed on acme-org, and GitHub does not let it into acme-org/widgets. Open ${pages}/repositories, press Add, and under the list find Worker app missing · grant it on GitHub. Follow the link beside it, Worker app, and on GitHub add acme-org/widgets to the repositories the app may reach. Tell me once it is granted.`,
      "once the person says the worker app is granted acme-org/widgets",
    ),
  ],
  Account: [
    { lacks: "Account" },
    hand(
      `Open ${pages}/repositories and press Connect GitHub, then install the chuggy app on the GitHub account that owns your repository. Tell me once GitHub is connected.`,
      "once the person says GitHub is connected",
    ),
  ],
  App: [
    { lacks: "App", app: "worker", account: "acme-org" },
    hand(
      `Open ${pages}/repositories and press Install worker, then install it on acme-org. Where acme-org is an organisation you do not own, GitHub asks its owner for you and this waits on them. Tell me once it is installed.`,
      "once the person says the worker app is installed on acme-org",
    ),
  ],
  Binding: [
    { lacks: "Binding" },
    hand(
      `Open ${pages}/repositories, press Add and choose your repository. Tell me once it is added.`,
      "once the person says the repository is added",
    ),
  ],
  Configuration: [
    { lacks: "Configuration", repository: "acme-org/widgets" },
    hand(
      `acme-org/widgets is added, but chuggy has not read its configuration. Open ${pages}/repositories and press Retry on the row for acme-org/widgets; if it still cannot, the row then says why. Tell me once Retry has answered.`,
      "once the person says Retry has answered for acme-org/widgets",
    ),
  ],
  Runner: [
    { lacks: "Runner" },
    hand(
      `Open ${pages}/runners and press Add runner, then do what it shows on the machine that will run the work. Tell me once the runner is running.`,
      "once the person says the runner is running",
    ),
  ],
  RunnerLive: [
    { lacks: "RunnerLive" },
    hand(
      "A runner is registered and is not running. Start it on its machine and tell me once it is running.",
      "once the person says the runner is running",
    ),
  ],
  Ticket: [
    { lacks: "Ticket" },
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
  Landing: [
    { lacks: "Landing", ticket: 4, phase: "Evaluation" },
    hand(
      `Ticket 4 is in Evaluation, and setup is done when it lands. ${pages}/tickets/4 shows where it is. Tell me when you want me to look again.`,
      "if the person asks to look again",
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

test("the portal app missing from an account is mended on the workspace's accounts page, which is the page that draws Connect GitHub where an account is already connected", () => {
  expect(thing({ lacks: "App", app: "portal", account: "acme-org" })).toEqual(
    hand(
      `Open ${stoodSite}/tenants/acme/settings/accounts, the workspace's accounts page, and press Connect GitHub, so chuggy is shown acme-org. Tell me once GitHub is connected.`,
      "once the person says GitHub is connected",
    ),
  );
});

test("an app not granted the repository is mended from the line the Add picker draws for that app, in the picker's own words, and the portal app's line is another", () => {
  const grant = { account: "acme-org", repository: "acme-org/widgets" };
  for (const app of ["portal", "worker"] as const) {
    const line = repositoryGrantLines[app];
    const tell = told({ lacks: "Grant", app, ...grant });
    expect(tell, app).toContain(`under the list find ${line.status}. `);
    expect(tell, app).toContain(`Follow the link beside it, ${line.label}, `);
  }
  expect(thing({ lacks: "Grant", app: "portal", ...grant })).toEqual(
    hand(
      `The portal app is installed on acme-org, and GitHub does not let it into acme-org/widgets. Open ${pages}/repositories, press Add, and under the list find Not listed · grant it on GitHub. Follow the link beside it, Portal app, and on GitHub add acme-org/widgets to the repositories the app may reach. Tell me once it is granted.`,
      "once the person says the portal app is granted acme-org/widgets",
    ),
  );
});

test("the repository to add is named as this folder's where the folder has a remote", () => {
  const remote = setupRepositoryRead("git@github.com:acme-org/widgets.git");
  expect(thing({ lacks: "Binding" }, { remote })).toMatchObject({
    tell: `Open ${pages}/repositories, press Add and choose acme-org/widgets, this folder's repository. Tell me once it is added.`,
  });
});

test("a workspace named that the person is not in is said by its name", () => {
  expect(told({ lacks: "Workspace", workspace: "globex" })).toMatch(
    /^You are not in a chuggy workspace named globex\. /u,
  );
});

test("a name is written into an address so that the address is still one address", () => {
  const choice: SetupChoice = {
    ...chosen,
    workspace: "two words",
    project: "a/b?c#d",
  };
  expect(told({ lacks: "Runner" }, { choice })).toContain(
    `Open ${stoodSite}/two%20words/a%2Fb%3Fc%23d/runners and press`,
  );
  expect(told({ lacks: "Project" }, { choice })).toContain(
    `Open ${stoodSite}/projects/new?workspace=two%20words, the`,
  );
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
  for (const detail of ["ticket 4 landed", "ticket 4 opened a pull request"]) {
    const steps: readonly SetupStep[] = [
      ...lacking({ lacks: "Runner" }).steps.slice(0, 1),
      { step: "ticket", state: "done", detail, lacks: undefined },
    ];
    expect(
      setupNext(lacking({ lacks: "Runner" }, { steps }), setupAnswersNone),
    ).toEqual({
      carried: setupAnswersNone,
      thing: {
        thing: "Done",
        tell: `chuggy is set up for acme/widgets: ${detail}. The next ticket is made at ${pages}/tickets/new.`,
      },
    });
  }
});

/** The step that decides what is next at each stage of a site set up one thing at a time: the first that is not done. */
const deciding: Readonly<Record<SetupSiteStage, keyof typeof mends | "Done">> =
  {
    Nothing: "Workspace",
    Workspace: "Project",
    Project: "NorthStar",
    NorthStar: "Account",
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
    const next = await nextOf(setupSiteAt(stage));
    const kind = deciding[stage];
    expect(next.carried, stage).toEqual(setupAnswersNone);
    if (kind === "Done") expect(next.thing.thing, stage).toBe("Done");
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
    return nextOf(site);
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
    { lacks: "Ticket" },
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
    setupNext(open("workspace", ["acme", "globex"]), setupAnswersNone),
  ).toEqual({
    carried: setupAnswersNone,
    thing: {
      thing: "Ask",
      ask: "Which workspace is this for: acme or globex? Pass the name as --workspace.",
      flag: "workspace",
    },
  });
  expect(
    setupNext(
      open("project", ["gadgets", "sprockets", "widgets"]),
      setupAnswersNone,
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
    setupNext(open("workspace", ["acme", "globex"]), named).carried,
  ).toEqual(named);
  expect(
    setupNext(open("project", ["gadgets"]), {
      workspace: "acme",
      project: undefined,
    }).carried,
  ).toEqual({ workspace: "acme", project: undefined });
});

test("a question says where the site sent only part of the names, and lists a bounded few of a long list", () => {
  expect(
    setupNext(open("project", ["widgets"], false), setupAnswersNone).thing,
  ).toMatchObject({
    ask: "Which project of acme is this for: widgets? The site sent only part of the list, so the one meant may not be named here. Pass the name as --project.",
  });
  expect(
    setupNext(open("project", [], false), setupAnswersNone).thing,
  ).toMatchObject({
    ask: "Which project of acme is this for? The site sent only part of the list, so the one meant may not be named here. Pass the name as --project.",
  });
  const many = Array.from(
    { length: setupAskNamesMax + 3 },
    (_, at) => `p${String(at)}`,
  );
  const shown = many.slice(0, setupAskNamesMax).join(", ");
  expect(
    setupNext(open("project", many), setupAnswersNone).thing,
  ).toMatchObject({
    ask: `Which project of acme is this for: ${shown} and 3 more? Pass the name as --project.`,
  });
});

test("a project that was named or proposed is carried by name with its workspace, so the next command means the same one", async () => {
  const site = setupSiteAt("Live");
  const named = await nextOf(site, { answers: { project: "widgets" } });
  expect(named.carried).toEqual({ workspace: "acme", project: "widgets" });
  const only = await nextOf(site, { answers: { workspace: "acme" } });
  expect(only.carried).toEqual({ workspace: "acme", project: "widgets" });
});
