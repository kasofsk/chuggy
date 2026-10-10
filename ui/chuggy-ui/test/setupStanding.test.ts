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
import { setupLandingsMax } from "../app/core/setupReads.ts";
import { setupSteps } from "../app/core/setupReport.ts";
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
import { stood } from "./setupStood.ts";
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

test.each(["Pending", "Work", "Evaluation", "Finalization"] as const)(
  "a ticket in %s is waited on, by its number and its phase",
  async (phase) => {
    expect(await ticketed([{ ticket: 7, phase }])).toEqual([
      "waiting",
      `ticket 7 is in ${phase}`,
    ]);
  },
);

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

test("a project named that the workspace does not have is to do, and one that a part of the list does not hold is not read", async () => {
  const named = { answers: { project: "gadgets" } };
  expect(await column(setupSiteAt("Landed"), named)).toEqual([
    saidAcme,
    ["todo", "acme has no project named gadgets"],
    saidOrg,
    saidTodo,
    saidTodo,
    saidTodo,
  ]);
  const cut = setupSiteAt("Landed");
  cut.fates.set("inventory", "Cut");
  const unasked = (subject: string): Said => ["unread", `${subject} not read`];
  expect(await column(cut, named)).toEqual([
    saidAcme,
    ["unread", "your projects were sent only in part"],
    saidOrg,
    unasked("its repositories were"),
    unasked("its runners were"),
    unasked("its tickets were"),
  ]);
  expect(await column(cut, { answers: { project: "widgets" } })).toEqual(
    saidStages.Landed,
  );
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
