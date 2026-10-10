/**
 * Where a person stands on each step of setup: every state of every step,
 * and what each is said as.
 *
 * A case states a site and reads it as the program does, so what is proved
 * is the reads and the standing together. The tables are products where the
 * states are: every stage of a site set up one thing at a time, and every
 * read against every way a read fails. A step is said to be done or to do
 * only on a read that was got, and the last table is that rule.
 */

import { expect, test } from "vitest";

import type { TicketLandingResponse } from "../../../src/contract/responses.ts";
import {
  placementRoutes,
  sessionRunnerStandings,
  ticketLandingStates,
} from "../../../src/contract/rosters.ts";
import { projectInventoryPagesMax } from "../app/core/apiRoutes.ts";
import { setupLandingsMax } from "../app/core/setupReads.ts";
import type { SetupRead } from "../app/core/setupReads.ts";
import { setupSteps } from "../app/core/setupReport.ts";
import { setupStanding } from "../app/core/setupStanding.ts";
import { workRunner } from "../app/core/workRunner.ts";
import type { WorkRunnerRead } from "../app/core/workRunner.ts";
import {
  saidAcme,
  saidAccountsUnshown,
  saidFailures,
  saidFated,
  saidLanding,
  saidLandingSite,
  saidLandingTicket,
  saidLive,
  saidMember,
  saidMemberSite,
  saidOrg,
  saidRepository,
  saidRunnable,
  saidStages,
  saidTodo,
  saidUnread,
  saidViewer,
  saidViewerSite,
  saidWidgets,
} from "./setupSaid.ts";
import type { Said } from "./setupSaid.ts";
import {
  setupSiteAccount,
  setupSiteAt,
  setupSiteClaim,
  setupSiteHeld,
  setupSiteLanded,
  setupSiteProject,
  setupSiteProposed,
  setupSiteRepositoryAddress,
  setupSiteWorkspace,
} from "./setupSite.ts";
import type {
  SetupSite,
  SetupSiteFate,
  SetupSiteProject,
  SetupSiteStage,
  SetupSiteTicket,
} from "./setupSite.ts";
import { siteRead, stood } from "./setupStood.ts";
import type { Asking } from "./setupStood.ts";

/** Every step of a site as it is said, in order. */
async function column(
  site: SetupSite,
  asking: Asking = {},
): Promise<readonly Said[]> {
  const { steps } = await stood(site, asking);
  expect(steps.map((step) => step.step)).toEqual(setupSteps);
  for (const step of steps)
    expect(step.lacks === undefined, step.step).toBe(step.state === "done");
  return steps.map((step): Said => [step.state, step.detail]);
}

test.each(Object.entries(saidStages))(
  "a site set up as far as %s stands as that, each step in its order",
  async (stage, said) => {
    expect(await column(setupSiteAt(stage as SetupSiteStage))).toEqual(said);
  },
);

async function ticketed(
  tickets: readonly SetupSiteTicket[],
  given: (project: SetupSiteProject) => void = () => undefined,
): Promise<Said | undefined> {
  const { site, project } = saidRunnable();
  project.tickets.push(...tickets);
  given(project);
  return (await column(site)).at(-1);
}

test.each(["Work", "Evaluation", "Finalization"] as const)(
  "a ticket in %s is waited on, by its number and its phase",
  async (phase) => {
    expect(await ticketed([{ ticket: 7, phase }])).toEqual([
      "waiting",
      `ticket 7 is in ${phase}`,
    ]);
  },
);

test("a ticket that is released and has not started waits on a press that starts it, and is said as that and not as a phase", async () => {
  const { site, project } = saidRunnable();
  project.tickets.push({ ticket: 7, phase: "Pending" });
  const step = (await stood(site)).steps.at(-1);
  expect(step).toEqual({
    step: "ticket",
    state: "waiting",
    detail: "ticket 7 is released, not started",
    lacks: { lacks: "Dispatch", ticket: 7 },
  });
});

test("an escalated ticket waits on the person, the one moved most lately is the one said, and a revoked one is no ticket at all", async () => {
  expect(await ticketed([{ ticket: 3, phase: "Escalated" }])).toEqual([
    "waiting",
    "ticket 3 is escalated",
  ]);
  expect(
    await ticketed([
      { ticket: 9, phase: "Work" },
      { ticket: 3, phase: "Escalated" },
    ]),
  ).toEqual(["waiting", "ticket 9 is in Work"]);
  expect(await ticketed([{ ticket: 3, phase: "Revoked" }])).toEqual(saidTodo);
});

test("a ticket on its way is said before a draft, and a ticket that is done before either", async () => {
  const drafted = (project: SetupSiteProject): void => {
    project.drafts.push(2);
  };
  expect(await ticketed([{ ticket: 5, phase: "Work" }], drafted)).toEqual([
    "waiting",
    "ticket 5 is in Work",
  ]);
  expect(
    await ticketed(
      [
        { ticket: 5, phase: "Work" },
        { ticket: 4, phase: "Done" },
      ],
      drafted,
    ),
  ).toEqual(["done", "ticket 4 landed"]);
});

test("a ticket being landed is done once a landing of it landed or opened a pull request, and waited on until then", async () => {
  const landed = (landings: readonly TicketLandingResponse[]) =>
    ticketed([saidLandingTicket(6)], (project) => {
      project.landings.set(6, landings);
    });
  expect(await landed([])).toEqual(["waiting", "ticket 6 is in Finalization"]);
  expect(await landed([setupSiteHeld])).toEqual([
    "waiting",
    "ticket 6 is in Finalization",
  ]);
  expect(await landed([setupSiteHeld, setupSiteLanded])).toEqual([
    "done",
    "ticket 6 landed",
  ]);
  expect(
    await landed([
      setupSiteProposed("https://github.com/acme-org/widgets/pull/1"),
    ]),
  ).toEqual(["done", "ticket 6 opened a pull request"]);
});

/** A landing in `state` that opened a pull request, where the state is one that carries nothing of its own. */
function proposedIn(
  state: Exclude<TicketLandingResponse["state"], "Held" | "Landed">,
): TicketLandingResponse {
  return { ...setupSiteProposed("https://example.org/pull/1"), state };
}

test("a pull request counts only on a landing that has neither failed nor been invalidated, whatever other landing the ticket has had", async () => {
  const landed = (landings: readonly TicketLandingResponse[]) =>
    ticketed([saidLandingTicket(6)], (project) => {
      project.landings.set(6, landings);
    });
  const counted: string[] = [];
  for (const state of ticketLandingStates) {
    if (state === "Held" || state === "Landed") continue;
    const [stands] = (await landed([proposedIn(state)])) ?? [];
    if (stands === "done") counted.push(state);
  }
  expect(counted).toEqual([
    "Running",
    "AwaitingApproval",
    "Unavailable",
    "Proposed",
  ]);
  expect(await landed([proposedIn("Failed")])).toEqual([
    "waiting",
    "ticket 6 is in Finalization",
  ]);
  expect(await landed([proposedIn("Failed"), proposedIn("Running")])).toEqual([
    "done",
    "ticket 6 opened a pull request",
  ]);
  const proposal = proposedIn("Running").proposal;
  for (const carrying of [setupSiteHeld, setupSiteLanded])
    expect(
      (await landed([{ ...carrying, ...(proposal && { proposal }) }]))?.[0],
    ).toBe("done");
});

test("landings are read for a bounded few of the tickets being landed, and past them the step is not read unless one of the few says done", async () => {
  const many = Array.from({ length: setupLandingsMax + 1 }, (_, at) =>
    saidLandingTicket(at + 1),
  );
  const proposing = (ticket: number) => (project: SetupSiteProject) => {
    project.landings.set(ticket, [setupSiteProposed("https://example.org/1")]);
  };
  expect(await ticketed(many)).toEqual([
    "unread",
    "its tickets were sent only in part",
  ]);
  expect(await ticketed(many, proposing(setupLandingsMax))).toEqual([
    "done",
    `ticket ${String(setupLandingsMax)} opened a pull request`,
  ]);
  expect(await ticketed(many, proposing(setupLandingsMax + 1))).toEqual([
    "unread",
    "its tickets were sent only in part",
  ]);
  expect(await ticketed(many.slice(1))).toEqual([
    "waiting",
    "ticket 2 is in Finalization",
  ]);
});

/** A site whose one workspace the person is in and does not administer, seeing its project set up to a landed ticket. */
function joined(): SetupSite {
  const site = setupSiteAt("Landed");
  site.tenants = saidMemberSite().tenants;
  return site;
}

const shown = saidAccountsUnshown;

test("a member who administers nothing is waiting on an admin, is shown no accounts, and is told of no project as though there were none", async () => {
  expect(await column(saidMemberSite())).toEqual(saidMember);
  expect(await column(joined())).toEqual([
    ["waiting", "acme, where you are a member and not an admin"],
    saidWidgets,
    shown,
    saidRepository,
    saidLive,
    ["done", "ticket 1 landed"],
  ]);
});

test("a viewer of a project who is in no workspace is waiting on an admin of the workspace the project is in, and what a viewer is not shown is said as that", async () => {
  expect(await column(saidViewerSite())).toEqual(saidViewer);
});

test("a workspace named that the person is not in is to do, and so is everything in it", async () => {
  const named = { answers: { workspace: "globex" } };
  expect(await column(setupSiteAt("Landed"), named)).toEqual([
    ["todo", "you are in no workspace named globex"],
    ["todo", "no project of globex is shown to you"],
    saidTodo,
    saidTodo,
    saidTodo,
    saidTodo,
  ]);
});

test("with no workspace, a list of projects that was not got leaves the project step not read, and what would be in a workspace is still to do", async () => {
  const site = setupSiteAt("Nothing");
  site.fates.set("inventory", "Failed");
  expect(await column(site)).toEqual([
    ["todo", "you are in no workspace yet"],
    ["unread", "your projects were not answered (Fault)"],
    saidTodo,
    saidTodo,
    saidTodo,
    saidTodo,
  ]);
});

test("a workspace list sent only in part is never read as being in no workspace", async () => {
  const none = setupSiteAt("Nothing");
  none.fates.set("workspaces", "Cut");
  expect((await column(none))[0]).toEqual([
    "unread",
    "your workspaces were sent only in part",
  ]);
  const some = setupSiteAt("Workspace");
  some.fates.set("workspaces", "Cut");
  const named = { answers: { workspace: "globex" } };
  expect((await column(some, named))[0]).toEqual([
    "unread",
    "your workspaces were sent only in part",
  ]);
  expect((await column(some, { answers: { workspace: "acme" } }))[0]).toEqual(
    saidAcme,
  );
});

const absent: readonly Said[] = [
  saidAcme,
  ["todo", "acme has no project named gadgets"],
  saidOrg,
  saidTodo,
  saidTodo,
  saidTodo,
];

test("a project named that the workspace does not have is to do, whether a whole list says so or the site does when it is read by its name", async () => {
  const named = { answers: { project: "gadgets" } };
  expect(await column(setupSiteAt("Landed"), named)).toEqual(absent);
  const cut = setupSiteAt("Landed");
  cut.fates.set("inventory", "Cut");
  expect(await column(cut, named)).toEqual(absent);
  const failed = setupSiteAt("Landed");
  failed.fates.set("inventory", "Failed");
  const both = { answers: { workspace: "acme", project: "gadgets" } };
  expect(await column(failed, both)).toEqual(absent);
});

test("a standing over a list of projects that was not whole never says a workspace has no project, whatever choice it is handed with", async () => {
  const reads = await siteRead(setupSiteAt("Workspace"));
  expect(reads.choice).toMatchObject({ choice: "Made", project: undefined });
  const unasked = (subject: string): Said => ["unread", `${subject} not read`];
  const { steps } = setupStanding({
    ...reads,
    inventory: { read: "Got", value: [], whole: false },
  });
  expect(steps.map((step): Said => [step.state, step.detail])).toEqual([
    saidAcme,
    ["unread", "your projects were sent only in part"],
    unasked("its repositories were"),
    unasked("its repositories were"),
    unasked("where its work runs was"),
    unasked("its tickets were"),
  ]);
});

test("a project named with its workspace stands as it is read by its name, on no page of the list that was read and with no list at all", async () => {
  const named = { answers: { workspace: "acme", project: "widgets" } };
  const beyond = setupSiteAt("Landed");
  for (const held of beyond.projects) held.page = projectInventoryPagesMax;
  expect(await column(beyond, named)).toEqual(saidStages.Landed);
  const failed = setupSiteAt("Landed");
  failed.fates.set("inventory", "Failed");
  expect(await column(failed, named)).toEqual(saidStages.Landed);
  expect((await column(failed))[1]).toEqual([
    "unread",
    "your projects were not answered (Fault)",
  ]);
});

test("a project read by its name is not said to be absent on its lead settings alone: one whose tickets were read is there, and its settings are what was not shown", async () => {
  const named = { answers: { workspace: "acme", project: "widgets" } };
  const site = setupSiteAt("Landed");
  site.fates.set("inventory", "Failed");
  for (const held of site.projects) held.settled = false;
  expect((await column(site, named))[1]).toEqual([
    "unread",
    "acme/widgets: its lead settings were not shown to you",
  ]);
  site.fates.set("landed", "Refused");
  expect((await column(site, named))[1]).toEqual([
    "todo",
    "acme has no project named widgets",
  ]);
  site.fates.delete("inventory");
  expect((await column(site, named))[1]).toEqual([
    "unread",
    "acme/widgets: its lead settings were not shown to you",
  ]);
});

test("a project read by its name is not said to be absent on its tickets alone: one whose lead settings were read is there", async () => {
  const named = { answers: { workspace: "acme", project: "widgets" } };
  const site = setupSiteAt("Landed");
  site.fates.set("inventory", "Failed");
  site.fates.set("landed", "Refused");
  expect((await column(site, named))[1]).toEqual(saidWidgets);
});

test("a project is done on a North Star of its own, and one the installation gives every project is not one", async () => {
  const site = setupSiteAt("Project");
  for (const held of site.projects) held.inherited = "The installation's own.";
  expect((await column(site))[1]).toEqual([
    "waiting",
    "acme/widgets has no North Star yet",
  ]);
  for (const held of site.projects) held.northStar = "Widgets, made well.";
  expect((await column(site))[1]).toEqual(saidWidgets);
});

/** A site set up as far as its project, holding the claims a case names. */
function claimed(
  claims: readonly (readonly [string, "portal" | "worker"])[],
  fate?: SetupSiteFate,
): SetupSite {
  const site = setupSiteAt("NorthStar");
  site.installations.set(
    setupSiteWorkspace,
    claims.map(([account, app]) => setupSiteClaim(account, app)),
  );
  if (fate !== undefined) site.fates.set("installations", fate);
  return site;
}

test("GitHub is done where one account holds both apps, and otherwise waits on the app the nearest account lacks", async () => {
  const github = async (site: SetupSite) => (await column(site))[2];
  expect(await github(claimed([[setupSiteAccount, "worker"]]))).toEqual([
    "waiting",
    "acme-org has the worker app, not the portal app",
  ]);
  expect(
    await github(
      claimed([
        ["first", "worker"],
        ["second", "portal"],
      ]),
    ),
  ).toEqual(["waiting", "second has the portal app, not the worker app"]);
  expect(
    await github(
      claimed([
        ["first", "portal"],
        ["second", "portal"],
        ["second", "worker"],
      ]),
    ),
  ).toEqual(["done", "second"]);
});

test("accounts sent only in part are done where the part holds an account with both apps, and are not read where it does not", async () => {
  const github = async (site: SetupSite) => (await column(site))[2];
  expect(await github(claimed([[setupSiteAccount, "portal"]], "Cut"))).toEqual([
    "unread",
    "its GitHub accounts were sent only in part",
  ]);
  expect(await github(claimed([], "Cut"))).toEqual([
    "unread",
    "its GitHub accounts were sent only in part",
  ]);
  expect(
    await github(
      claimed(
        [
          [setupSiteAccount, "portal"],
          [setupSiteAccount, "worker"],
        ],
        "Cut",
      ),
    ),
  ).toEqual(saidOrg);
});

const repository = "acme-org/widgets";

/** A site set up to a live runner, its repository owned by `acme-org`, with the claims a case names. */
function owned(
  claims: readonly (readonly [string, "portal" | "worker"])[],
  fate?: SetupSiteFate,
): SetupSite {
  const site = setupSiteAt("Live");
  site.installations.set(
    setupSiteWorkspace,
    claims.map(([account, app]) => setupSiteClaim(account, app)),
  );
  if (fate !== undefined) site.fates.set("installations", fate);
  return site;
}

const personal = [
  ["personal", "portal"],
  ["personal", "worker"],
] as const;

test("once a repository is added GitHub is held to the account that owns it, whatever another account holds, and waits on the app that account lacks", async () => {
  const github = async (site: SetupSite) => (await stood(site)).steps[2];
  const waiting = (detail: string, app: "portal" | "worker") => ({
    step: "github",
    state: "waiting",
    detail: `acme-org, which owns ${repository}, ${detail}`,
    lacks: { lacks: "App", app, account: setupSiteAccount },
  });
  expect(
    await github(owned([...personal, [setupSiteAccount, "portal"]])),
  ).toEqual(waiting("has the portal app, not the worker app", "worker"));
  expect(
    await github(owned([...personal, [setupSiteAccount, "worker"]])),
  ).toEqual(waiting("has the worker app, not the portal app", "portal"));
  expect(await github(owned(personal))).toEqual(
    waiting("has neither app", "portal"),
  );
  expect(
    await github(
      owned([
        ...personal,
        [setupSiteAccount, "portal"],
        [setupSiteAccount, "worker"],
      ]),
    ),
  ).toMatchObject({ state: "done", detail: setupSiteAccount });
});

test("an account is the repository's owner only by its whole name as the address writes it", async () => {
  const github = async (site: SetupSite) => (await column(site))[2];
  for (const near of ["acme-org-2", "acme", "Acme-Org"])
    expect(
      await github(
        owned([
          [near, "portal"],
          [near, "worker"],
        ]),
      ),
    ).toEqual([
      "waiting",
      `acme-org, which owns ${repository}, has neither app`,
    ]);
});

test("the owner's accounts sent only in part are done where the part shows it holding both apps, and are not read where it does not", async () => {
  const github = async (site: SetupSite) => (await column(site))[2];
  expect(
    await github(owned([...personal, [setupSiteAccount, "portal"]], "Cut")),
  ).toEqual(["unread", "its GitHub accounts were sent only in part"]);
  expect(await github(owned(personal, "Cut"))).toEqual([
    "unread",
    "its GitHub accounts were sent only in part",
  ]);
  expect(
    await github(
      owned(
        [
          [setupSiteAccount, "portal"],
          [setupSiteAccount, "worker"],
        ],
        "Cut",
      ),
    ),
  ).toEqual(saidOrg);
});

/** A site set up to a live runner whose project holds `repositories` and no other, with one account, `personal`, holding both apps. */
function holding(repositories: SetupSiteProject["repositories"]): SetupSite {
  const site = owned(personal);
  site.projects[0]?.repositories.splice(0, 1, ...repositories);
  return site;
}

test("the repository GitHub is held to is the one the repository step is said of: the first that is configured, else the first added, and none that is retired", async () => {
  const steps = async (site: SetupSite) => (await column(site)).slice(2, 4);
  const mine = "https://github.com/personal/notes";
  const theirs = setupSiteRepositoryAddress;
  expect(
    await steps(
      holding([
        { repository: theirs, configured: false },
        { repository: mine, configured: true },
      ]),
    ),
  ).toEqual([
    ["done", "personal"],
    ["done", "personal/notes"],
  ]);
  expect(
    await steps(
      holding([
        { repository: theirs, configured: false },
        { repository: mine, configured: false },
      ]),
    ),
  ).toEqual([
    ["waiting", `acme-org, which owns ${repository}, has neither app`],
    ["waiting", `${repository} is added, its configuration not read yet`],
  ]);
  expect(
    await steps(
      holding([
        { repository: theirs, configured: true, retired: true },
        { repository: mine, configured: false },
      ]),
    ),
  ).toEqual([
    ["done", "personal"],
    ["waiting", "personal/notes is added, its configuration not read yet"],
  ]);
  expect(
    await steps(
      holding([{ repository: theirs, configured: true, retired: true }]),
    ),
  ).toEqual([["done", "personal"], saidTodo]);
});

test("repositories sent only in part hold GitHub to a configured one among them, and leave it not read where none is, since the one meant may be in the rest", async () => {
  const github = async (site: SetupSite) => (await column(site))[2];
  const cut = (repositories: SetupSiteProject["repositories"]): SetupSite => {
    const site = holding(repositories);
    site.fates.set("repositories", "Cut");
    return site;
  };
  const theirs = setupSiteRepositoryAddress;
  expect(await github(cut([{ repository: theirs, configured: true }]))).toEqual(
    ["waiting", `acme-org, which owns ${repository}, has neither app`],
  );
  for (const none of [[], [{ repository: theirs, configured: false }]])
    expect(await github(cut(none))).toEqual([
      "unread",
      "its repositories were sent only in part",
    ]);
});

test("a repository whose address names no one owner, being more than an owner and a name or less, holds GitHub to no account, and any account with both apps does", async () => {
  const site = holding([
    { repository: "https://forge.example/group/team/notes", configured: true },
  ]);
  expect((await column(site)).slice(2, 4)).toEqual([
    ["done", "personal"],
    ["done", "team/notes"],
  ]);
  const lone = holding([
    { repository: "https://forge.example/notes", configured: true },
  ]);
  expect((await column(lone))[2]).toEqual(["done", "personal"]);
});

/** A read as a screen of the console holds one that came back. */
function settled<T>(read: SetupRead<T>): WorkRunnerRead<T> {
  if (read.read !== "Got") throw new Error("the read was not got");
  return {
    state: { state: "Ready", value: read.value, observedAtMs: undefined },
    settled: true,
  };
}

test("for every route a project's work can take and every standing its runners can have, the runner step is to do exactly where the console says the work has no runner, and done wherever the cluster runs it", async () => {
  const said: Record<string, Said | undefined> = {};
  for (const route of placementRoutes)
    for (const runner of sessionRunnerStandings) {
      const { site, project } = saidRunnable();
      project.work = route;
      project.runner = runner;
      const step = (await column(site))[4];
      const reads = await siteRead(site);
      const console = workRunner(settled(reads.work), settled(reads.placement));
      expect(step?.[0] === "todo", `${route} ${runner}`).toBe(
        console === "NoRunner",
      );
      said[`${route} ${runner}`] = step;
    }
  const hosted: Said = ["done", "the cluster runs its work"];
  expect(said).toEqual({
    "InCluster Unregistered": hosted,
    "InCluster Offline": hosted,
    "InCluster Live": hosted,
    "Pool Unregistered": saidTodo,
    "Pool Offline": ["waiting", "registered, not running"],
    "Pool Live": saidLive,
  });
});

test("a project whose work the cluster runs is set up with no runner, and waits on no read of its runners", async () => {
  const site = setupSiteAt("Landed");
  for (const held of site.projects) {
    held.work = "InCluster";
    held.runner = "Unregistered";
  }
  const hosted: Said = ["done", "the cluster runs its work"];
  expect((await column(site)).slice(4)).toEqual([
    hosted,
    ["done", "ticket 1 landed"],
  ]);
  site.fates.set("placement", "Failed");
  expect((await column(site))[4]).toEqual(hosted);
});

/** A site with GitHub connected, holding the repositories a case names. */
function added(
  repositories: SetupSiteProject["repositories"],
  fate?: SetupSiteFate,
): SetupSite {
  const site = setupSiteAt("Apps");
  const [project] = site.projects;
  project?.repositories.push(...repositories);
  if (fate !== undefined) site.fates.set("repositories", fate);
  return site;
}

const other = "https://github.com/acme-org/gadgets";

test("a repository is done where one that is added and not retired is configured, and a retired one is as though it were never added", async () => {
  const held = async (site: SetupSite) => (await column(site))[3];
  const retired = {
    repository: setupSiteRepositoryAddress,
    configured: true,
    retired: true,
  };
  expect(await held(added([retired]))).toEqual(saidTodo);
  expect(
    await held(added([retired, { repository: other, configured: false }])),
  ).toEqual([
    "waiting",
    "acme-org/gadgets is added, its configuration not read yet",
  ]);
  expect(
    await held(
      added([
        { repository: other, configured: false },
        { repository: setupSiteRepositoryAddress, configured: true },
      ]),
    ),
  ).toEqual(saidRepository);
});

test("repositories sent as many as one answer holds are done where one of them is configured, and are not read where none is", async () => {
  const held = async (site: SetupSite) => (await column(site))[3];
  expect(await held(added([], "Cut"))).toEqual([
    "unread",
    "its repositories were sent only in part",
  ]);
  expect(
    await held(added([{ repository: other, configured: false }], "Cut")),
  ).toEqual(["unread", "its repositories were sent only in part"]);
  expect(
    await held(added([{ repository: other, configured: true }], "Cut")),
  ).toEqual(["done", "acme-org/gadgets"]);
});

test("with nothing added, the repository to do is said as this folder's remote where the folder has one", async () => {
  const remote = "git@github.com:acme-org/widgets.git";
  expect((await column(setupSiteAt("Apps"), { remote }))[3]).toEqual([
    "todo",
    "github.com/acme-org/widgets (this folder's remote)",
  ]);
  expect((await column(setupSiteAt("Configured"), { remote }))[3]).toEqual(
    saidRepository,
  );
});

test("the site with a ticket being landed has every read asked and every step but the last done", async () => {
  expect(await column(saidLandingSite())).toEqual(saidLanding);
});

test.each(saidFailures)(
  "the %s read %s leaves its step not read and says which, and no other step is said any differently for it",
  async (read, fate) => {
    const site = saidLandingSite();
    site.fates.set(read, fate);
    expect(await column(site)).toEqual(saidFated(read, fate));
  },
);

test.each(["moving", "landings"] as const)(
  "the %s read cut short leaves the ticket step not read, since the rest could hold a landing",
  async (read) => {
    const site = saidLandingSite();
    site.fates.set(read, "Cut");
    const subject =
      read === "moving" ? "its tickets were" : saidUnread[read][1];
    expect((await column(site)).at(-1)).toEqual([
      "unread",
      `${subject} sent only in part`,
    ]);
  },
);

test("a second project in the workspace changes nothing of a project that was named", async () => {
  const site = saidLandingSite();
  site.projects.push(setupSiteProject(setupSiteWorkspace, "gadgets"));
  const named = { answers: { project: "widgets" } };
  expect(await column(site, named)).toEqual(saidLanding);
  expect((await stood(site)).steps).toEqual([]);
});
