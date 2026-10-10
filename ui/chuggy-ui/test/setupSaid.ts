/**
 * How the setup program says where a person stands, for the sites its suites
 * share: each stage of a site set up one thing at a time, and a site with a
 * ticket being landed, where every read there is has been asked.
 *
 * The suites that call the program's own functions and the suites that run
 * it as a process both check against these, so the words a step is said in
 * are written once.
 */

import type { SetupStepState } from "../app/core/setupReport.ts";
import { setupSiteAt, setupSiteHeld, setupSiteWorkspace } from "./setupSite.ts";
import type {
  SetupSite,
  SetupSiteFate,
  SetupSiteProject,
  SetupSiteRead,
  SetupSiteStage,
  SetupSiteTicket,
} from "./setupSite.ts";

/** A step as it is said: how it stands, and the few words beside it. */
export type Said = readonly [SetupStepState, string];

export const saidTodo: Said = ["todo", ""];
export const saidAcme: Said = ["done", "acme"];
export const saidWidgets: Said = ["done", "acme/widgets"];
export const saidOrg: Said = ["done", "acme-org"];
/** GitHub once a repository is added: the account that owns it, and that both apps there are granted it. */
export const saidGranted: Said = [
  "done",
  "acme-org, both apps granted acme-org/widgets",
];
export const saidRepository: Said = ["done", "acme-org/widgets"];
export const saidLive: Said = ["done", "live"];
export const saidReady = [
  saidAcme,
  saidWidgets,
  saidGranted,
  saidRepository,
  saidLive,
] as const;

export const saidStages: Readonly<Record<SetupSiteStage, readonly Said[]>> = {
  Nothing: [
    ["todo", "you are in no workspace yet"],
    saidTodo,
    saidTodo,
    saidTodo,
    saidTodo,
    saidTodo,
  ],
  Workspace: [
    saidAcme,
    ["todo", "acme has no project yet"],
    saidTodo,
    saidTodo,
    saidTodo,
    saidTodo,
  ],
  Project: [
    saidAcme,
    ["waiting", "acme/widgets has no North Star yet"],
    saidTodo,
    saidTodo,
    saidTodo,
    saidTodo,
  ],
  NorthStar: [saidAcme, saidWidgets, saidTodo, saidTodo, saidTodo, saidTodo],
  Portal: [
    saidAcme,
    saidWidgets,
    ["waiting", "acme-org has the portal app, not the worker app"],
    saidTodo,
    saidTodo,
    saidTodo,
  ],
  Apps: [saidAcme, saidWidgets, saidOrg, saidTodo, saidTodo, saidTodo],
  Added: [
    saidAcme,
    saidWidgets,
    saidGranted,
    ["waiting", "acme-org/widgets is added, its configuration not read yet"],
    saidTodo,
    saidTodo,
  ],
  Configured: [
    saidAcme,
    saidWidgets,
    saidGranted,
    saidRepository,
    saidTodo,
    saidTodo,
  ],
  Offline: [
    saidAcme,
    saidWidgets,
    saidGranted,
    saidRepository,
    ["waiting", "registered, not running"],
    saidTodo,
  ],
  Live: [...saidReady, saidTodo],
  Draft: [...saidReady, ["waiting", "ticket 1 is a draft, not released"]],
  Moving: [...saidReady, ["waiting", "ticket 1 is in Work"]],
  Landed: [...saidReady, ["done", "ticket 1 is done"]],
};

/** A site with everything before the ticket done, and its project to put tickets in. */
export function saidRunnable(): { site: SetupSite; project: SetupSiteProject } {
  const site = setupSiteAt("Live");
  const [project] = site.projects;
  if (project === undefined) throw new Error("the stage has no project");
  return { site, project };
}

export const saidLandingTicket = (ticket: number): SetupSiteTicket => ({
  ticket,
  phase: "Finalization",
});

/** Everything done but a ticket still being landed, so every read there is has been asked. */
export function saidLandingSite(): SetupSite {
  const { site, project } = saidRunnable();
  project.tickets.push(saidLandingTicket(1));
  project.landings.set(1, [setupSiteHeld]);
  return site;
}

export const saidLanding: readonly Said[] = [
  ...saidReady,
  ["waiting", "ticket 1 is in Finalization"],
];

/** The step each read leaves unread, and what the read is called there. */
export const saidUnread: Readonly<
  Record<Exclude<SetupSiteRead, "workspaces">, readonly [number, string]>
> = {
  inventory: [1, "your projects were"],
  settings: [1, "acme/widgets: its lead settings were"],
  installations: [2, "its GitHub accounts were"],
  portalGrant: [2, "what the portal app is granted on GitHub was"],
  workerGrant: [2, "what the worker app is granted on GitHub was"],
  repositories: [3, "its repositories were"],
  work: [4, "where its work runs was"],
  placement: [4, "its runners were"],
  landed: [5, "its tickets were"],
  moving: [5, "its tickets were"],
  drafts: [5, "its drafts were"],
  landings: [5, "a ticket's landings were"],
};

/** Where the GitHub step is said, which the project's repositories leave unread as they do their own step: it is held to the account that owns one. */
const saidGithubAt = 2;

/** How each way a read fails is said. */
export const saidFates: Readonly<
  Record<Exclude<SetupSiteFate, "Cut">, string>
> = {
  Refused: "not shown to you",
  Failed: "not answered (Fault)",
  Garbled: "not answered (Unreadable)",
  Unauthenticated: "not answered (Unauthenticated)",
};

/** Every read that can fail by itself, with every way it can. */
export const saidFailures = (
  Object.keys(saidUnread) as (keyof typeof saidUnread)[]
).flatMap((read) =>
  (Object.keys(saidFates) as (keyof typeof saidFates)[]).map(
    (fate) => [read, fate] as const,
  ),
);

/** The site with a ticket being landed, as it is said where one read went one way: that read's step not read, and with it every step that hangs on it. */
export function saidFated(
  read: keyof typeof saidUnread,
  fate: keyof typeof saidFates,
): readonly Said[] {
  const [at, subject] = saidUnread[read];
  const said = [...saidLanding];
  said[at] = ["unread", `${subject} ${saidFates[fate]}`];
  if (read === "repositories") said[saidGithubAt] = said[at] ?? saidTodo;
  if (read === "inventory")
    for (const [after, hung] of [
      [saidGithubAt, "its repositories were"],
      [3, "its repositories were"],
      [4, "where its work runs was"],
      [5, "its tickets were"],
    ] as const)
      said[after] = ["unread", `${hung} not read`];
  return said;
}

/** A site whose one workspace the person is in and does not administer, seeing no project of it. */
export function saidMemberSite(): SetupSite {
  const site = setupSiteAt("Workspace");
  site.tenants = [
    { tenant: setupSiteWorkspace, roles: ["Member"], administer: false },
  ];
  return site;
}

export const saidAccountsUnshown: Said = [
  "unread",
  "its GitHub accounts were not shown to you",
];

export const saidMember: readonly Said[] = [
  ["waiting", "acme, where you are a member and not an admin"],
  ["todo", "no project of acme is shown to you"],
  saidAccountsUnshown,
  saidTodo,
  saidTodo,
  saidTodo,
];

/** A site set up to a landed ticket, seen by someone who is in no workspace and is shown its one project and not that project's lead settings. */
export function saidViewerSite(): SetupSite {
  const site = setupSiteAt("Landed");
  site.tenants = [];
  for (const project of site.projects) project.settled = false;
  return site;
}

export const saidViewer: readonly Said[] = [
  ["waiting", "acme, where you see a project and are not an admin"],
  ["unread", "acme/widgets: its lead settings were not shown to you"],
  saidAccountsUnshown,
  saidRepository,
  saidLive,
  ["done", "ticket 1 is done"],
];
