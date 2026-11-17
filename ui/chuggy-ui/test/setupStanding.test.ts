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
  ownerFallbacks,
  placementRoutes,
  sessionRunnerStandings,
  ticketLandingStates,
} from "../../../src/contract/rosters.ts";
import type {
  OwnerFallback,
  SessionRunnerStanding,
} from "../../../src/contract/rosters.ts";
import { projectInventoryPagesMax } from "../app/core/apiRoutes.ts";
import { repositoriesWorkerless } from "../app/core/projectRepositories.ts";
import { setupNorthStarSkip } from "../app/core/setupArguments.ts";
import { setupLandingsMax } from "../app/core/setupReads.ts";
import type { SetupPersonal, SetupRead } from "../app/core/setupReads.ts";
import { setupSteps } from "../app/core/setupReport.ts";
import { setupStanding } from "../app/core/setupStanding.ts";
import type { SetupPluginHere, SetupStep } from "../app/core/setupStanding.ts";
import { workRunner } from "../app/core/workRunner.ts";
import type { WorkRunnerRead } from "../app/core/workRunner.ts";
import {
  saidAcme,
  saidAccountsUnshown,
  saidDetail,
  saidFailures,
  saidFated,
  saidFates,
  saidGranted,
  saidLanding,
  saidLandingSite,
  saidLandingTicket,
  saidLive,
  saidMember,
  saidMemberSite,
  saidOrg,
  saidPluginOn,
  saidRepository,
  saidRunnable,
  saidServed,
  saidStages,
  saidStarred,
  saidStep,
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
  setupSitePoolWaiting,
  setupSiteWaiting,
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
import {
  workRunnerNoPersonal,
  workRunnerUnnamed,
} from "./workRunnerFixture.ts";

/** A step with its few words as the program prints them. */
function worded(step: SetupStep | undefined) {
  return step === undefined
    ? undefined
    : { ...step, detail: saidDetail(step.detail) };
}

/** Every step of a site past the plugin's, which is on, as it is said, in order. */
async function column(
  site: SetupSite,
  asking: Asking = {},
): Promise<readonly Said[]> {
  const { steps } = await stood(site, asking);
  expect(steps.map((step) => step.step)).toEqual(setupSteps);
  for (const step of steps)
    expect(step.lacks === undefined, step.step).toBe(step.state === "done");
  const [plugin, ...past] = steps.map(saidStep);
  expect(plugin).toEqual(saidPluginOn);
  return past;
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

test.each([
  ["Work", "Work"],
  ["Evaluation", "Evaluation"],
  ["Finalization", "Finalization"],
] as const)(
  "a ticket in %s is waited on, by its number and its phase as the ticket page names its step",
  async (phase, step) => {
    expect(await ticketed([{ ticket: 7, phase }])).toEqual([
      "waiting",
      `ticket 7 is in ${step}`,
    ]);
  },
);

/** The ticket step of a site whose ticket 7 is in `phase` with `executions`, its executions read meeting `fate` where a case says so. */
async function runningStep(
  phase: SetupSiteTicket["phase"],
  executions: Parameters<SetupSiteProject["executions"]["set"]>[1],
  fate?: SetupSiteFate,
): Promise<SetupStep | undefined> {
  const { site, project } = saidRunnable();
  project.tickets.push({ ticket: 7, phase });
  project.executions.set(7, executions);
  if (fate !== undefined) site.fates.set("executions", fate);
  return (await stood(site)).steps.at(-1);
}

const room = { freeMib: 1434, neededMib: 4096 };

test.each([
  ["Work", setupSiteWaiting(7, "Live", room), { wait: "Room", ...room }],
  ["Evaluation", setupSiteWaiting(7, "Offline"), { wait: "Offline" }],
  ["Work", setupSiteWaiting(7, "Unable"), { wait: "Unable" }],
  ["Work", setupSiteWaiting(7, "Live"), undefined],
  ["Work", { ...setupSiteWaiting(7, "Offline"), mine: false }, undefined],
  ["Work", { ...setupSiteWaiting(7, "Offline"), status: "Queued" }, undefined],
  ["Work", setupSitePoolWaiting(7, room), { wait: "PoolRoom", ...room }],
  ["Work", { ...setupSitePoolWaiting(7, room), status: "Queued" }, undefined],
  [
    "Work",
    { ...setupSiteWaiting(7, "Offline"), poolRoom: room },
    { wait: "Offline" },
  ],
] as const)(
  "a ticket in %s carries what its starting execution of the person's waits on of their runners, or else what any starting execution waits on of the project's pools, by the console's own deciders: %j",
  async (phase, execution, wait) => {
    const step = await runningStep(phase, [execution]);
    expect(step?.state).toBe("waiting");
    expect(step?.lacks).toEqual({
      lacks: "Landing",
      ticket: 7,
      phase,
      pullRequest: false,
      bootstrapped: false,
      wait,
    });
  },
);

test.each(["Refused", "Failed", "Garbled", "Unauthenticated", "Cut"] as const)(
  "a ticket's executions read answered as %s leaves the ticket step read and waiting on its landing, and says no wait",
  async (fate) => {
    const step = await runningStep(
      "Work",
      [setupSiteWaiting(7, "Live", room)],
      fate,
    );
    expect(step?.state).toBe("waiting");
    expect(step?.lacks).toMatchObject({ lacks: "Landing", wait: undefined });
  },
);

test("a ticket's executions are read only where it is in its work or its evaluation, and for each such ticket up to the bound", async () => {
  const { site, project } = saidRunnable();
  project.tickets.push(
    saidLandingTicket(1),
    ...Array.from({ length: setupLandingsMax + 1 }, (_, at) => ({
      ticket: at + 2,
      phase: "Evaluation" as const,
    })),
  );
  const sent: string[] = [];
  await stood(site, { sent });
  const asked = sent.flatMap(
    (request) => /\/executions\?ticket=(\d+)$/u.exec(request)?.[1] ?? [],
  );
  expect(asked).toEqual(
    Array.from({ length: setupLandingsMax }, (_, at) => String(at + 2)),
  );
});

test("a ticket that is released and has not started waits on a press that starts it, and is said as that and not as a phase", async () => {
  const { site, project } = saidRunnable();
  project.tickets.push({ ticket: 7, phase: "Pending" });
  const step = worded((await stood(site)).steps.at(-1));
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
  ).toEqual(["done", "ticket 4 is done"]);
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
    "ticket 6 is finalized",
  ]);
  expect(
    await landed([
      setupSiteProposed("https://github.com/acme-org/widgets/pull/1"),
    ]),
  ).toEqual(["done", "ticket 6 opened a pull request"]);
});

/** A landing in `state` that opened a pull request, where the state is one that carries nothing of its own. */
function proposedIn(
  state: Exclude<
    TicketLandingResponse["state"],
    "Held" | "AwaitingMerge" | "Landed"
  >,
): TicketLandingResponse {
  return { ...setupSiteProposed("https://example.org/pull/1"), state };
}

/** A landing whose pull request waits on the forge's own rules to merge. */
function proposedWaiting(): TicketLandingResponse {
  return {
    ...setupSiteProposed("https://example.org/pull/1"),
    state: "AwaitingMerge",
    wait: { reason: "Blocked", checkedAt: "2026-10-07T14:02:11.000000Z" },
  };
}

test("a pull request counts only on a landing that has neither failed nor been invalidated, whatever other landing the ticket has had", async () => {
  const landed = (landings: readonly TicketLandingResponse[]) =>
    ticketed([saidLandingTicket(6)], (project) => {
      project.landings.set(6, landings);
    });
  const counted: string[] = [];
  for (const state of ticketLandingStates) {
    if (state === "Held" || state === "Landed") continue;
    const [stands] =
      (await landed([
        state === "AwaitingMerge" ? proposedWaiting() : proposedIn(state),
      ])) ?? [];
    if (stands === "done") counted.push(state);
  }
  expect(counted).toEqual([
    "Running",
    "AwaitingMerge",
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
    saidStarred,
    saidServed,
    shown,
    saidRepository,
    saidLive,
    ["done", "ticket 1 is done"],
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
  saidTodo,
  saidTodo,
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
  const { steps } = setupStanding(
    {
      ...reads,
      inventory: { read: "Got", value: [], whole: false },
    },
    true,
    "On",
  );
  expect(steps.map(saidStep)).toEqual([
    saidPluginOn,
    saidAcme,
    ["unread", "your projects were sent only in part"],
    unasked("its chat settings were"),
    saidTodo,
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

test("a project read by its name is not said to be absent on its settings alone: one whose tickets were read is there, and its settings are what was not shown", async () => {
  const named = { answers: { workspace: "acme", project: "widgets" } };
  const site = setupSiteAt("Landed");
  site.fates.set("inventory", "Failed");
  for (const held of site.projects) held.settled = false;
  expect((await column(site, named))[1]).toEqual([
    "unread",
    "acme/widgets: its chat settings were not shown to you",
  ]);
  site.fates.set("landed", "Refused");
  expect((await column(site, named))[1]).toEqual([
    "todo",
    "acme has no project named widgets",
  ]);
  site.fates.delete("inventory");
  expect((await column(site, named))[1]).toEqual([
    "unread",
    "acme/widgets: its chat settings were not shown to you",
  ]);
});

test("a project read by its name is not said to be absent on its tickets alone: one whose settings were read is there", async () => {
  const named = { answers: { workspace: "acme", project: "widgets" } };
  const site = setupSiteAt("Landed");
  site.fates.set("inventory", "Failed");
  site.fates.set("landed", "Refused");
  expect((await column(site, named))[1]).toEqual(saidWidgets);
});

/** A site set up as far as its project, holding the claims a case names. */
function claimed(
  claims: readonly (readonly [string, "portal" | "worker"])[],
  fate?: SetupSiteFate,
): SetupSite {
  const site = setupSiteAt("Project");
  site.installations.set(
    setupSiteWorkspace,
    claims.map(([account, app]) => setupSiteClaim(account, app)),
  );
  if (fate !== undefined) site.fates.set("installations", fate);
  return site;
}

test("GitHub is done where one account holds both apps, and otherwise waits on the app the nearest account lacks", async () => {
  const github = async (site: SetupSite) => (await column(site))[4];
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
  const github = async (site: SetupSite) => (await column(site))[4];
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
  const github = async (site: SetupSite) =>
    worded((await stood(site)).steps[5]);
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
  ).toMatchObject({ state: "done", detail: saidGranted[1] });
});

test("an account is the repository's owner only by its whole name as the address writes it", async () => {
  const github = async (site: SetupSite) => (await column(site))[4];
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
  const github = async (site: SetupSite) => (await column(site))[4];
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
  ).toEqual(saidGranted);
});

const both = [
  [setupSiteAccount, "portal"],
  [setupSiteAccount, "worker"],
] as const;

/** A site whose repository's owner holds both apps, each granted the addresses a case names, and each listing whole or cut short. */
function granting(
  portal: readonly string[],
  worker: readonly string[],
  cut: readonly ("portalGrant" | "workerGrant")[] = [],
): SetupSite {
  const site = owned([...personal, ...both]);
  site.grants.set(`${setupSiteAccount}-portal`, [...portal]);
  site.grants.set(`${setupSiteAccount}-worker`, [...worker]);
  for (const read of cut) site.fates.set(read, "Cut");
  return site;
}

const elsewhere = "https://github.com/acme-org/gadgets";

test("with both apps on the owner's account, GitHub waits on whichever is not granted this repository, the portal app said first, and is done only where both are", async () => {
  const github = async (site: SetupSite) =>
    worded((await stood(site)).steps[5]);
  const mine = setupSiteRepositoryAddress;
  const waiting = (app: "portal" | "worker") => ({
    step: "github",
    state: "waiting",
    detail: `the ${app} app on acme-org is not granted ${repository}`,
    lacks: { lacks: "Grant", app, account: setupSiteAccount, repository },
  });
  expect(await github(granting([mine], [elsewhere]))).toEqual(
    waiting("worker"),
  );
  expect(await github(granting([mine, elsewhere], []))).toEqual(
    waiting("worker"),
  );
  expect(await github(granting([elsewhere], [mine]))).toEqual(
    waiting("portal"),
  );
  expect(await github(granting([], []))).toEqual(waiting("portal"));
  expect(await github(granting([elsewhere, mine], [mine]))).toEqual({
    step: "github",
    state: "done",
    detail: saidGranted[1],
    lacks: undefined,
  });
});

test("a listing cut short counts where it names the repository and leaves its half not read where it does not, since the rest may name it; it is never a grant that is missing", async () => {
  const github = async (site: SetupSite) => (await column(site))[4];
  const mine = [setupSiteRepositoryAddress];
  const unread = (app: string): Said => [
    "unread",
    `what the ${app} app is granted on GitHub was sent only in part`,
  ];
  for (const cut of [
    ["portalGrant"],
    ["workerGrant"],
    ["portalGrant", "workerGrant"],
  ] as const)
    expect(await github(granting(mine, mine, cut)), cut.join()).toEqual(
      saidGranted,
    );
  expect(await github(granting([elsewhere], mine, ["portalGrant"]))).toEqual(
    unread("portal"),
  );
  expect(await github(granting(mine, [elsewhere], ["workerGrant"]))).toEqual(
    unread("worker"),
  );
  expect(
    await github(granting([], [], ["portalGrant", "workerGrant"])),
  ).toEqual(unread("portal"));
  expect(await github(granting(mine, [], ["portalGrant"]))).toEqual([
    "waiting",
    `the worker app on acme-org is not granted ${repository}`,
  ]);
});

test("the worker app is waited on exactly where the console's own decider, over the two listings as they were read, says the repository's row lacks it", async () => {
  const mine = setupSiteRepositoryAddress;
  const each = [false, true] as const;
  let waited = 0;
  for (const portalHas of each)
    for (const workerHas of each)
      for (const portalCut of each)
        for (const workerCut of each) {
          const site = granting(
            portalHas ? [mine] : [elsewhere],
            workerHas ? [mine] : [elsewhere],
            [
              ...(portalCut ? (["portalGrant"] as const) : []),
              ...(workerCut ? (["workerGrant"] as const) : []),
            ],
          );
          const reads = await siteRead(site);
          const [portal, worker] = reads.grants.map((grant) => {
            if (grant.listed.read !== "Got") throw new Error("not got");
            return {
              account: setupSiteAccount,
              repositories: grant.listed.value,
              truncated: !grant.listed.whole,
            };
          });
          if (portal === undefined || worker === undefined)
            throw new Error("a listing was not asked for");
          const lacks = setupStanding(reads, true, "On").steps[5]?.lacks;
          const said = lacks?.lacks === "Grant" && lacks.app === "worker";
          expect(said, JSON.stringify(site.grants)).toBe(
            repositoriesWorkerless([portal], [worker]).includes(mine),
          );
          waited += said ? 1 : 0;
        }
  expect(waited).toBe(2);
});

test("a repository the forge lists under another spelling of its address is the same repository: the portal app's entry is found by what the two have in common", async () => {
  const site = granting(
    [setupSiteRepositoryAddress],
    [setupSiteRepositoryAddress],
  );
  site.projects[0]?.repositories.splice(0, 1, {
    repository: "https://GitHub.com/acme-org/widgets.git",
    configured: true,
  });
  expect((await column(site))[4]).toEqual(saidGranted);
});

/** A site set up to a live runner whose project holds `repositories` and no other, with one account, `personal`, holding both apps. */
function holding(repositories: SetupSiteProject["repositories"]): SetupSite {
  const site = owned(personal);
  site.projects[0]?.repositories.splice(0, 1, ...repositories);
  return site;
}

test("the repository GitHub is held to is the one the repository step is said of: the first that is configured, else the first added, and none that is retired", async () => {
  const steps = async (site: SetupSite) => (await column(site)).slice(4, 6);
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
    ["done", "personal, both apps granted personal/notes"],
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
    ["done", "personal, both apps granted personal/notes"],
    ["waiting", "personal/notes is added, its configuration not read yet"],
  ]);
  expect(
    await steps(
      holding([{ repository: theirs, configured: true, retired: true }]),
    ),
  ).toEqual([["done", "personal"], saidTodo]);
});

test("repositories sent only in part hold GitHub to a configured one among them, and leave it not read where none is, since the one meant may be in the rest", async () => {
  const github = async (site: SetupSite) => (await column(site))[4];
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
  expect((await column(site)).slice(4, 6)).toEqual([
    ["done", "personal"],
    ["done", "team/notes"],
  ]);
  const lone = holding([
    { repository: "https://forge.example/notes", configured: true },
  ]);
  expect((await column(lone))[4]).toEqual(["done", "personal"]);
});

/** A read as a screen of the console holds one that came back. */
function settled<T>(read: SetupRead<T>): WorkRunnerRead<T> {
  if (read.read !== "Got") throw new Error("the read was not got");
  return {
    state: { state: "Ready", value: read.value, observedAtMs: undefined },
    settled: true,
  };
}

/** The person's personal runners as the console's decider takes them: unregistered where none is, or the project is not given them. */
function settledPersonal(
  read: SetupRead<SetupPersonal>,
): WorkRunnerRead<SessionRunnerStanding> {
  const held = settled(read);
  const personal = held.state.state === "Ready" ? held.state.value : undefined;
  return settled({
    read: "Got",
    value: personal?.registered === true ? personal.standing : "Unregistered",
    whole: true,
  });
}

test("for every route a project's work can take and every standing its runners can have, the runner step is to do exactly where the console says the work has no runner, and done wherever the cluster runs it", async () => {
  const said: Record<string, Said | undefined> = {};
  for (const route of placementRoutes)
    for (const runner of sessionRunnerStandings) {
      const { site, project } = saidRunnable();
      project.work = route;
      project.runner = runner;
      const step = (await column(site))[6];
      const reads = await siteRead(site);
      const console = workRunner(
        settled(reads.work),
        settled(reads.placement),
        workRunnerUnnamed,
        workRunnerNoPersonal,
        "Reader",
      );
      expect(step?.[0] === "todo", `${route} ${runner}`).toBe(
        console === "NoRunner",
      );
      said[`${route} ${runner}`] = step;
    }
  const hosted: Said = ["done", "hosted runs take its work"];
  expect(said).toEqual({
    "InCluster Unregistered": hosted,
    "InCluster Offline": hosted,
    "InCluster Live": hosted,
    "Pool Unregistered": saidTodo,
    "Pool Offline": ["waiting", "registered, not running"],
    "Pool Live": saidLive,
  });
});

test("a project with no pool that names an owner fallback takes the person's own personal runner serving it as its runner, live or offline as a pool is, exactly where the console says the work has a runner", async () => {
  const said: Record<string, Said | undefined> = {};
  for (const fallback of [undefined, ...ownerFallbacks])
    for (const own of sessionRunnerStandings) {
      const { site, project } = saidRunnable();
      project.runner = "Unregistered";
      project.fallback = fallback;
      if (own !== "Unregistered")
        site.personal.set("acme", {
          live: [own === "Live"],
          projects: [project.project],
        });
      const step = (await column(site))[6];
      const reads = await siteRead(site);
      const console = workRunner(
        settled(reads.work),
        settled(reads.placement),
        settled(reads.fallback),
        settledPersonal(reads.personal),
        "Reader",
      );
      expect(step?.[0] === "todo", `${String(fallback)} ${own}`).toBe(
        console === "NoRunner",
      );
      said[`${fallback ?? "None"} ${own}`] = step;
    }
  const offline: Said = ["waiting", "registered, not running"];
  expect(said).toEqual({
    "None Unregistered": saidTodo,
    "None Offline": saidTodo,
    "None Live": saidTodo,
    "Strict Unregistered": saidTodo,
    "Strict Offline": offline,
    "Strict Live": saidLive,
    "Preferred Unregistered": saidTodo,
    "Preferred Offline": offline,
    "Preferred Live": saidLive,
  });
});

test("a pool registered and not running beside the person's own runner live, given the project and named its fallback, reads the runner step done, and the same pool beside one not given it, unnamed or offline still waits on the pool", async () => {
  const step = async (
    fallback: OwnerFallback | undefined,
    live: boolean,
    projects: string[],
  ) => {
    const { site, project } = saidRunnable();
    project.runner = "Offline";
    project.fallback = fallback;
    site.personal.set("acme", { live: [live], projects });
    return (await column(site))[6];
  };
  const widgets = saidRunnable().project.project;
  const offline: Said = ["waiting", "registered, not running"];
  expect(await step("Preferred", true, [widgets])).toEqual(saidLive);
  expect(await step("Strict", true, [widgets])).toEqual(saidLive);
  expect(await step(undefined, true, [widgets])).toEqual(offline);
  expect(await step("Preferred", true, ["gadgets"])).toEqual(offline);
  expect(await step("Preferred", false, [widgets])).toEqual(offline);
});

/** A chat host runs the person's threads and takes no work, and a personal
 * runner takes only the work of the projects it is given. */
test("a project with no pool that names an owner fallback takes neither the person's chat host nor a personal runner given only another project as its runner", async () => {
  for (const held of ["chat host", "another project's runner"] as const) {
    const { site, project } = saidRunnable();
    project.runner = "Unregistered";
    project.fallback = "Strict";
    site.chat.set("acme", { id: "chuggy-chat-1", live: true });
    if (held === "another project's runner")
      site.personal.set("acme", { live: [true], projects: ["gadgets"] });
    expect((await column(site))[6], held).toEqual(saidTodo);
    const reads = await siteRead(site);
    expect(
      workRunner(
        settled(reads.work),
        settled(reads.placement),
        settled(reads.fallback),
        settledPersonal(reads.personal),
        "Reader",
      ),
      held,
    ).toBe("NoRunner");
  }
});

test("the person's personal runners unread leave the runner step unread wherever the project has no pool, so a person holding one is never told to register one", async () => {
  const unread: Said = [
    "unread",
    "your personal runners were not answered (Fault)",
  ];
  for (const [runner, fallback, said] of [
    ["Unregistered", "Strict", unread],
    ["Unregistered", undefined, unread],
    ["Live", "Strict", saidLive],
    ["Live", undefined, saidLive],
  ] as const) {
    const { site, project } = saidRunnable();
    project.runner = runner;
    project.fallback = fallback;
    site.fates.set("personal", "Failed");
    expect((await column(site))[6], `${runner} ${String(fallback)}`).toEqual(
      said,
    );
  }
});

test("a project with no pool lacks a runner where the person holds no personal runner, and where they hold one that does not take its work, lacks that runner serving it, saying whether it is given the project, whether a fallback is named and whether the person may name one", async () => {
  const lacks: Record<string, unknown> = {};
  for (const held of ["none", "another project", "given"] as const)
    for (const fallback of [undefined, "Preferred"] as const)
      for (const administer of [true, false]) {
        const { site, project } = saidRunnable();
        project.runner = "Unregistered";
        project.fallback = fallback;
        project.administer = administer;
        site.chat.clear();
        if (held !== "none")
          site.personal.set("acme", {
            live: [true],
            projects: [held === "given" ? project.project : "gadgets"],
          });
        lacks[`${held} ${fallback ?? "None"} ${String(administer)}`] = (
          await stood(site)
        ).steps[7]?.lacks;
      }
  const runner = { lacks: "Runner", chat: true };
  const serving = (given: boolean, named: boolean, administers: boolean) => ({
    lacks: "Serving",
    given,
    named,
    administers,
  });
  expect(lacks).toEqual({
    "none None true": runner,
    "none None false": runner,
    "none Preferred true": runner,
    "none Preferred false": runner,
    "another project None true": serving(false, false, true),
    "another project None false": serving(false, false, false),
    "another project Preferred true": serving(false, true, true),
    "another project Preferred false": serving(false, true, false),
    "given None true": serving(true, false, true),
    "given None false": serving(true, false, false),
    "given Preferred true": undefined,
    "given Preferred false": undefined,
  });
});

test("the owner fallback unread leaves the runner step unread only where the project has no pool", async () => {
  for (const [runner, said] of [
    [
      "Unregistered",
      [
        "unread",
        "whether personal runners take its work was not answered (Fault)",
      ],
    ],
    ["Live", saidLive],
  ] as const) {
    const { site, project } = saidRunnable();
    project.runner = runner;
    site.fates.set("fallback", "Failed");
    expect((await column(site))[6], runner).toEqual(said);
  }
});

test("a project whose work the cluster runs needs no runner of its own, and its step is done saying chat-host where the person's chats in it run on a chat host they lack", async () => {
  const site = setupSiteAt("Landed");
  for (const held of site.projects) {
    held.work = "InCluster";
    held.runner = "Unregistered";
  }
  const hosted: Said = ["done", "hosted runs take its work"];
  expect((await column(site)).slice(6)).toEqual([
    hosted,
    ["done", "ticket 1 is done"],
  ]);
  site.chat.clear();
  expect((await column(site))[6]).toEqual([
    "done",
    "hosted runs take its work; you have no chat host, which only your chats in the browser need, and chat-host sets one up",
  ]);
  for (const held of site.projects) held.threads = "InCluster";
  expect((await column(site))[6]).toEqual(hosted);
  site.fates.set("placement", "Failed");
  expect((await column(site))[6]).toEqual([
    "unread",
    "its runners were not answered (Fault)",
  ]);
});

test("where the person's chats run on runners the runner step is done once the project's runner is live, and a chat host of theirs that is missing or not running is said on its done line with chat-host, never as what the step lacks", async () => {
  const said: Record<string, readonly unknown[]> = {};
  for (const runner of sessionRunnerStandings)
    for (const mine of sessionRunnerStandings) {
      const { site, project } = saidRunnable();
      project.runner = runner;
      if (mine === "Unregistered") site.chat.clear();
      else
        site.chat.set("acme", { id: "chuggy-chat-1", live: mine === "Live" });
      const step = (await stood(site)).steps[7];
      said[`${runner} ${mine}`] = [
        step?.state,
        saidDetail(step?.detail),
        step?.lacks,
      ];
    }
  expect(said).toEqual({
    "Unregistered Unregistered": ["todo", "", { lacks: "Runner", chat: true }],
    "Unregistered Offline": ["todo", "", { lacks: "Runner", chat: true }],
    "Unregistered Live": ["todo", "", { lacks: "Runner", chat: false }],
    "Offline Unregistered": [
      "waiting",
      "registered, not running",
      { lacks: "RunnerLive", chat: true },
    ],
    "Offline Offline": [
      "waiting",
      "registered, not running",
      { lacks: "RunnerLive", chat: true },
    ],
    "Offline Live": [
      "waiting",
      "registered, not running",
      { lacks: "RunnerLive", chat: false },
    ],
    "Live Unregistered": [
      "done",
      "live; you have no chat host, which only your chats in the browser need, and chat-host sets one up",
      undefined,
    ],
    "Live Offline": [
      "done",
      "live; your chat host, which only your chats in the browser need, is registered and not running, and chat-host on its machine starts it",
      undefined,
    ],
    "Live Live": ["done", "live", undefined],
  });
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
  const held = async (site: SetupSite) => (await column(site))[5];
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
  const held = async (site: SetupSite) => (await column(site))[5];
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
  expect((await column(setupSiteAt("Apps"), { remote }))[5]).toEqual([
    "todo",
    "github.com/acme-org/widgets (this folder's remote)",
  ]);
  expect((await column(setupSiteAt("Configured"), { remote }))[5]).toEqual(
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

test("signed in, the plugin's step comes first and is done where Claude Code here has it on or the run was given the way past it, and otherwise lacks it, saying whether it is installed", async () => {
  const first = async (plugin: SetupPluginHere) => {
    const [step] = (await stood(setupSiteAt("Nothing"), { plugin })).steps;
    return step === undefined
      ? undefined
      : { said: saidStep(step), lacks: step.lacks };
  };
  expect(await first("On")).toEqual({ said: saidPluginOn, lacks: undefined });
  expect(await first("Skipped")).toEqual({
    said: ["done", "passed over without chuggy's plugin"],
    lacks: undefined,
  });
  expect(await first("Off")).toEqual({
    said: ["todo", "Claude Code here has chuggy's plugin, off"],
    lacks: { lacks: "Plugin", off: true },
  });
  expect(await first("None")).toEqual({
    said: ["todo", "Claude Code here has no chuggy plugin"],
    lacks: { lacks: "Plugin", off: false },
  });
});

test("the North Star step is done where the project's settings carry one, and where the step is passed over whatever they carry", async () => {
  const star = async (site: SetupSite, asking: Asking = {}) =>
    (await column(site, asking))[2];
  expect(await star(setupSiteAt("Project"))).toEqual(saidStarred);
  const site = setupSiteAt("Project");
  for (const held of site.projects) held.overrides = {};
  const skip = { answers: { northStar: setupNorthStarSkip } } as const;
  expect(await star(site, skip)).toEqual([
    "done",
    "passed over without a North Star",
  ]);
  expect(await star(setupSiteAt("Project"), skip)).toEqual([
    "done",
    "passed over without a North Star",
  ]);
});

test("a project whose settings carry no North Star has the step to do, lacking it, while every other override it sets leaves it so", async () => {
  const site = setupSiteAt("Landed");
  for (const held of site.projects)
    held.overrides = { threadStandingRules: "Be kind.", threadEffort: "high" };
  const step = (await stood(site)).steps[3];
  expect(step?.step).toBe("north-star");
  expect(worded(step)).toEqual({
    step: "north-star",
    state: "todo",
    detail: "the project has no North Star yet",
    lacks: { lacks: "NorthStar" },
  });
});

test.each(Object.keys(saidFates) as (keyof typeof saidFates)[])(
  "the project's settings answered as %s leave the North Star step unread, as they leave the project step, and never to do",
  async (fate) => {
    const site = setupSiteAt("Project");
    for (const held of site.projects) held.overrides = {};
    site.fates.set("settings", fate);
    const [, project, star] = await column(site);
    expect(project?.[0]).toBe("unread");
    expect(star).toEqual([
      "unread",
      `its chat settings were ${saidFates[fate]}`,
    ]);
  },
);
