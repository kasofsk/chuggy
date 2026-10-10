/**
 * What the bare setup program reads of a site, and which project it takes
 * those reads to be of.
 *
 * The first half is the choice: with one workspace and one project there is
 * none, names given are taken as given, and this folder's remote proposes a
 * project only where it is added to exactly one of those it could have meant
 * and every one of them was read whole. The second half is the requests
 * themselves: which are sent for which site, that the list of projects is
 * read past its first page and no further than a bound, that a project named
 * in full is read by its name where no whole list ruled it out, that a read
 * hanging on one that was not got is never sent, and that the ports the reads
 * go through send nothing that is not a read.
 */

import { expect, test } from "vitest";

import type { ApiPorts } from "../app/core/apiRequest.ts";
import {
  apiCreateProject,
  apiMintWorkerPoolToken,
  apiProjectInventory,
  apiWriteSessionPlacement,
  projectInventoryPagesMax,
} from "../app/core/apiRoutes.ts";
import {
  setupCandidatesMax,
  setupMovingPhases,
  setupReadPorts,
} from "../app/core/setupReads.ts";
import type { SetupAnswers } from "../app/core/setupArguments.ts";
import type { SetupChoice } from "../app/core/setupReads.ts";
import {
  setupSiteAt,
  setupSiteEmpty,
  setupSiteHeld,
  setupSiteProject,
} from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";
import { nextOf, sitePorts, siteRead, stood } from "./setupStood.ts";
import type { Asking } from "./setupStood.ts";

/** A site the person is an admin of each workspace named in, seeing each project written `workspace/project`. */
function siteOf(
  workspaces: readonly string[],
  projects: readonly string[],
): SetupSite {
  const site = setupSiteEmpty();
  site.tenants = workspaces.map((tenant) => ({
    tenant,
    roles: ["Admin"],
    administer: true,
  }));
  site.projects = projects.map((name) => {
    const [tenant = "", project = ""] = name.split("/");
    return setupSiteProject(tenant, project);
  });
  return site;
}

const made = (
  by: "Only" | "Named" | "Remote",
  workspace?: string,
  project?: string,
): SetupChoice => ({ choice: "Made", by, workspace, project });

const open = (
  flag: "workspace" | "project",
  among: readonly string[],
  workspace?: string,
  whole = true,
): SetupChoice => ({ choice: "Open", open: flag, workspace, among, whole });

const both = ["acme", "globex"];
const pair = ["acme/widgets", "acme/gadgets"];
const spread = ["acme/widgets", "globex/widgets", "globex/turbines"];

/** A site, what the run was given, and the choice that comes of them. */
type Chosen = readonly [string, SetupSite, Partial<SetupAnswers>, SetupChoice];

const choices: readonly Chosen[] = [
  ["nobody's site", siteOf([], []), {}, made("Only")],
  ["one workspace", siteOf(["acme"], []), {}, made("Only", "acme")],
  [
    "one workspace and its one project",
    siteOf(["acme"], ["acme/widgets"]),
    {},
    made("Only", "acme", "widgets"),
  ],
  [
    "one project seen in a workspace the person is not in",
    siteOf([], ["acme/widgets"]),
    {},
    made("Only", "acme", "widgets"),
  ],
  [
    "two projects",
    siteOf(["acme"], pair),
    {},
    open("project", ["gadgets", "widgets"], "acme"),
  ],
  [
    "two projects, one named",
    siteOf(["acme"], pair),
    { project: "gadgets" },
    made("Named", "acme", "gadgets"),
  ],
  ["two workspaces", siteOf(both, []), {}, open("workspace", both)],
  [
    "a workspace joined and another only seen into",
    siteOf(["acme"], ["globex/widgets"]),
    {},
    open("workspace", both),
  ],
  [
    "two workspaces, the one named having one project",
    siteOf(both, ["acme/widgets"]),
    { workspace: "acme" },
    made("Named", "acme", "widgets"),
  ],
  [
    "two workspaces, the one named having none",
    siteOf(both, ["acme/widgets"]),
    { workspace: "globex" },
    made("Named", "globex"),
  ],
  [
    "two workspaces, the one named having two",
    siteOf(both, spread),
    { workspace: "globex" },
    open("project", ["turbines", "widgets"], "globex"),
  ],
  [
    "a project named that one workspace has",
    siteOf(both, spread),
    { project: "turbines" },
    made("Named", "globex", "turbines"),
  ],
  [
    "a project named that two workspaces have",
    siteOf(both, spread),
    { project: "widgets" },
    open("workspace", both),
  ],
  [
    "a project named that no workspace has",
    siteOf(both, spread),
    { project: "sprockets" },
    open("workspace", both),
  ],
  [
    "both named, whether or not the site has them",
    siteOf(both, spread),
    { workspace: "initech", project: "sprockets" },
    made("Named", "initech", "sprockets"),
  ],
];

test.each(choices)(
  "%s: the choice is the one there is, the one named, or the person's",
  async (_said, site, answers, choice) => {
    expect((await siteRead(site, { answers })).choice).toEqual(choice);
  },
);

test("a list the site sent only part of is never taken for the whole of what there is to choose among", async () => {
  const workspaces = siteOf(["acme"], ["acme/widgets"]);
  workspaces.fates.set("workspaces", "Cut");
  expect((await siteRead(workspaces)).choice).toEqual(
    open("workspace", ["acme"], undefined, false),
  );
  const projects = siteOf(["acme"], ["acme/widgets"]);
  projects.fates.set("inventory", "Cut");
  expect((await siteRead(projects)).choice).toEqual(
    open("project", ["widgets"], "acme", false),
  );
});

test("with the projects not read, one workspace is still the only one, and two are still the person's to choose between", async () => {
  const one = siteOf(["acme"], ["acme/widgets"]);
  one.fates.set("inventory", "Failed");
  expect((await siteRead(one)).choice).toEqual(made("Only", "acme"));
  const two = siteOf(both, spread);
  two.fates.set("inventory", "Refused");
  expect((await siteRead(two)).choice).toEqual(open("workspace", both));
});

const address = "https://github.com/acme-org/widgets";
const remote = "git@github.com:Acme-Org/widgets.git";
const said = "this folder's remote github.com/Acme-Org/widgets";

/** A site of the projects named, the remote's repository added to each of `bound`. */
function bound(
  workspaces: readonly string[],
  projects: readonly string[],
  holders: readonly string[],
  retired = false,
): SetupSite {
  const site = siteOf(workspaces, projects);
  for (const project of site.projects)
    if (holders.includes(`${project.tenant}/${project.project}`))
      project.repositories.push({
        repository: address,
        configured: true,
        retired,
      });
  return site;
}

test("a remote added to exactly one of the projects it could mean proposes that one, says so, and every command then carries it", async () => {
  const site = bound(["acme"], pair, ["acme/gadgets"]);
  const reads = await siteRead(site, { remote });
  expect(reads.choice).toEqual(made("Remote", "acme", "gadgets"));
  expect((await stood(site, { remote })).found).toEqual([
    `${said} is added to acme/gadgets and to no other project of yours, so this checklist is of acme/gadgets: proposed and not chosen, and --workspace with --project names another`,
  ]);
  expect((await nextOf(site, { remote })).carried).toEqual({
    workspace: "acme",
    project: "gadgets",
  });
});

test("a remote proposes across workspaces, and within the one named", async () => {
  const site = bound(both, spread, ["globex/turbines"]);
  expect((await siteRead(site, { remote })).choice).toEqual(
    made("Remote", "globex", "turbines"),
  );
  const named = { remote, answers: { workspace: "globex" } };
  expect((await siteRead(site, named)).choice).toEqual(
    made("Remote", "globex", "turbines"),
  );
  const elsewhere = bound(both, spread, ["acme/widgets"]);
  expect((await siteRead(elsewhere, named)).choice).toEqual(
    open("project", ["turbines", "widgets"], "globex"),
  );
});

test("a remote added to two projects, or to none, proposes neither and says which, and the choice stays the person's", async () => {
  const asked = open("project", ["gadgets", "widgets"], "acme");
  const two = bound(["acme"], pair, pair);
  expect((await siteRead(two, { remote })).choice).toEqual(asked);
  expect((await stood(two, { remote })).found).toEqual([
    `${said} is added to more than one of your projects (acme/widgets, acme/gadgets), so it proposes none`,
  ]);
  for (const none of [
    bound(["acme"], pair, []),
    bound(["acme"], pair, ["acme/widgets"], true),
  ]) {
    expect((await siteRead(none, { remote })).choice).toEqual(asked);
    expect((await stood(none, { remote })).found).toEqual([
      `${said} is added to none of your projects, so it proposes none`,
    ]);
  }
});

test.each(["Refused", "Failed", "Cut"] as const)(
  "a remote proposes nothing where a project's repositories were %s, since the one not read could be another it is added to",
  async (fate) => {
    const site = bound(["acme"], pair, ["acme/gadgets"]);
    site.fates.set("repositories", fate);
    expect((await siteRead(site, { remote })).choice).toEqual(
      open("project", ["gadgets", "widgets"], "acme"),
    );
    expect((await stood(site, { remote })).found).toEqual([
      `${said} could not be looked for in every project of yours, so it proposes none`,
    ]);
  },
);

test("past a bounded few projects the remote is looked for in none of them, and says it could not be", async () => {
  const names = Array.from(
    { length: setupCandidatesMax + 1 },
    (_, at) => `acme/project-${String(at)}`,
  );
  const sent: string[] = [];
  const most = bound(["acme"], names, [names[0] ?? ""]);
  expect((await siteRead(most, { remote, sent })).proposal).toEqual({
    proposal: "Unread",
  });
  expect(sent).toEqual(["GET /api/v1/projects"]);
  const fewer = bound(["acme"], names.slice(1), [names[1] ?? ""]);
  expect((await siteRead(fewer, { remote })).choice).toEqual(
    made("Remote", "acme", "project-1"),
  );
});

test("where there is nothing to choose, or the project was named, the remote is not looked for and nothing is said of it", async () => {
  const sent: string[] = [];
  const one = bound(["acme"], ["acme/widgets"], ["acme/widgets"]);
  const reads = await siteRead(one, { remote, sent });
  expect(reads.proposal).toEqual({ proposal: "Unsought" });
  expect(reads.choice).toEqual(made("Only", "acme", "widgets"));
  expect((await stood(one, { remote })).found).toEqual([]);
  expect(sent.filter((asked) => asked.endsWith("/repositories"))).toHaveLength(
    1,
  );
  const named = { remote, answers: { project: "widgets" } };
  const two = bound(["acme"], pair, ["acme/gadgets"]);
  expect((await siteRead(two, named)).choice).toEqual(
    made("Named", "acme", "widgets"),
  );
  expect((await stood(two, named)).found).toEqual([]);
  const twice = await siteRead(bound(both, spread, ["globex/widgets"]), named);
  expect(twice.choice).toEqual(open("workspace", both));
  expect(twice.proposal).toEqual({ proposal: "Unsought" });
});

test("a part of the projects is never where the remote is looked for nor all a named workspace has, and a part of the workspaces is never all a named project could be in", async () => {
  const part = bound(["acme"], pair, ["acme/gadgets"]);
  part.fates.set("inventory", "Cut");
  const reads = await siteRead(part, { remote });
  expect(reads.proposal).toEqual({ proposal: "Unsought" });
  expect(reads.choice).toEqual(
    open("project", ["gadgets", "widgets"], "acme", false),
  );
  const within = siteOf(both, ["acme/widgets"]);
  within.fates.set("inventory", "Cut");
  const workspace = { answers: { workspace: "acme" } };
  expect((await siteRead(within, workspace)).choice).toEqual(
    open("project", ["widgets"], "acme", false),
  );
  const joined = siteOf(["acme"], ["acme/widgets"]);
  joined.fates.set("workspaces", "Cut");
  const sprockets = { answers: { project: "sprockets" } };
  expect((await siteRead(joined, sprockets)).choice).toEqual(
    open("workspace", ["acme"], undefined, false),
  );
});

const inventory = "GET /api/v1/projects";

/** The pages of the list of projects a run asked for, as the cursor each was asked by. */
function paged(sent: readonly string[]): readonly string[] {
  return sent
    .filter((asked) => asked.startsWith(inventory))
    .map((asked) => asked.slice(inventory.length));
}

test("the list of projects is read past its first page, and is whole once a page names no next, however the projects fall on the pages", async () => {
  const trailing = siteOf(["acme"], ["acme/widgets"]);
  trailing.inventoryPages = 2;
  const later = siteOf(["acme"], ["acme/widgets"]);
  for (const held of later.projects) held.page = 2;
  for (const site of [trailing, later]) {
    const sent: string[] = [];
    const reads = await siteRead(site, { sent });
    expect(reads.inventory).toEqual({
      read: "Got",
      value: [{ tenant: "acme", project: "widgets" }],
      whole: true,
    });
    expect(reads.choice).toEqual(made("Only", "acme", "widgets"));
    expect(paged(sent).slice(0, 2)).toEqual(["", "?cursor=1"]);
  }
});

test("a project name two workspaces hold is asked about though one of them is on a later page", async () => {
  const site = siteOf(["acme", "zeta"], ["acme/widgets", "zeta/widgets"]);
  for (const held of site.projects) if (held.tenant === "zeta") held.page = 1;
  const named = { answers: { project: "widgets" } };
  expect((await siteRead(site, named)).choice).toEqual(
    open("workspace", ["acme", "zeta"]),
  );
});

test("the pages of the list of projects are read up to the console's own bound and no further, and a list that still names a next is not whole", async () => {
  const site = siteOf(["acme"], ["acme/widgets"]);
  site.fates.set("inventory", "Cut");
  const sent: string[] = [];
  const reads = await siteRead(site, { sent });
  expect(reads.inventory).toMatchObject({ read: "Got", whole: false });
  expect(paged(sent)).toHaveLength(projectInventoryPagesMax);
  expect(paged(sent).at(-1)).toBe(
    `?cursor=${String(projectInventoryPagesMax - 1)}`,
  );
});

test("a later page of the list of projects that was not got is what the whole read came to, and no part of the list is kept", async () => {
  const site = siteOf(["acme"], ["acme/widgets", "acme/gadgets"]);
  site.inventoryPages = 3;
  const through = answering("cursor=1", () =>
    Response.json({}, { status: 500 }),
  );
  const reads = await siteRead(site, { through });
  expect(reads.inventory).toEqual({ read: "Failed", outcome: "Fault" });
  expect(reads.choice).toEqual(made("Only", "acme"));
});

test("the one workspace seen to hold a named project is taken only from a list that was whole, and is asked about from one that was not", async () => {
  const named = { answers: { project: "widgets" } };
  const site = siteOf(["acme"], ["acme/widgets"]);
  expect((await siteRead(site, named)).choice).toEqual(
    made("Named", "acme", "widgets"),
  );
  site.fates.set("inventory", "Cut");
  expect((await siteRead(site, named)).choice).toEqual(
    open("workspace", ["acme"], undefined, false),
  );
});

test("a question about the workspace of a named project lists the workspaces that hold it and no other", async () => {
  const three = [...both, "initech"];
  const site = siteOf(three, [...spread, "initech/turbines"]);
  expect(
    (await siteRead(site, { answers: { project: "widgets" } })).choice,
  ).toEqual(open("workspace", both));
  expect(
    (await siteRead(site, { answers: { project: "sprockets" } })).choice,
  ).toEqual(open("workspace", three));
});

test.each(["workspaces", "inventory"] as const)(
  "a question about the workspace says the names are not all of them where the %s were sent only in part",
  async (read) => {
    const site = siteOf(both, spread);
    expect((await siteRead(site)).choice).toEqual(open("workspace", both));
    site.fates.set(read, "Cut");
    expect((await siteRead(site)).choice).toEqual(
      open("workspace", both, undefined, false),
    );
    expect(
      (await siteRead(site, { answers: { project: "sprockets" } })).choice,
    ).toEqual(open("workspace", both, undefined, false));
  },
);

const widgets = "/api/v1/tenants/acme/projects/widgets";

test("a project named with its workspace is read by its name where the list was not whole or not got, and need be on no page that was read", async () => {
  const named = { answers: { workspace: "acme", project: "widgets" } };
  const beyond = setupSiteAt("Landed");
  for (const held of beyond.projects) held.page = projectInventoryPagesMax;
  const failed = setupSiteAt("Landed");
  failed.fates.set("inventory", "Failed");
  for (const site of [beyond, failed]) {
    const sent: string[] = [];
    const reads = await siteRead(site, { ...named, sent });
    expect(reads.choice).toEqual(made("Named", "acme", "widgets"));
    expect(reads.settings.read).toBe("Got");
    expect(sent).toContain(`GET ${widgets}/selector-settings`);
  }
  expect((await siteRead(beyond, named)).inventory).toEqual({
    read: "Got",
    value: [],
    whole: false,
  });
});

test("a project named with its workspace that a whole list does not name is not asked for, and the one that is read is the one in the workspace named", async () => {
  const site = siteOf(both, ["acme/widgets"]);
  const sent: string[] = [];
  const absent = { workspace: "globex", project: "widgets" };
  const reads = await siteRead(site, { answers: absent, sent });
  expect(reads.choice).toEqual(made("Named", "globex", "widgets"));
  expect(reads.settings).toEqual({ read: "Unasked" });
  expect(sent.filter((asked) => asked.includes("/projects/"))).toEqual([]);
  const twice = siteOf(both, ["acme/widgets", "globex/widgets"]);
  const asked: string[] = [];
  await siteRead(twice, { answers: absent, sent: asked });
  const read = asked.filter((line) => line.includes("/projects/widgets"));
  expect(read.length).toBeGreaterThan(0);
  for (const line of read) expect(line).toContain("/tenants/globex/");
});

test("the repositories read while the remote was looked for are the chosen project's own, by its workspace and by its name", async () => {
  const across = bound(
    both,
    ["acme/widgets", "globex/widgets"],
    ["globex/widgets"],
  );
  const within = bound(["acme"], pair, ["acme/gadgets"]);
  for (const [site, chosen] of [
    [across, made("Remote", "globex", "widgets")],
    [within, made("Remote", "acme", "gadgets")],
  ] as const) {
    const reads = await siteRead(site, { remote });
    expect(reads.choice).toEqual(chosen);
    expect(reads.repositories).toMatchObject({
      read: "Got",
      value: [{ repository: address, configured: true }],
    });
  }
});

const project = widgets;
const moving = setupMovingPhases.map((phase) => `phase=${phase}`).join("&");

/** Every request a site set up to its end is sent, and no other: in particular nothing that mints or reads a token. */
const reads = [
  "GET /api/v1/projects",
  "GET /api/v1/tenants/acme/forge-installations",
  `GET ${project}/selector-settings`,
  `GET ${project}/repositories`,
  `GET ${project}/execution-placement`,
  `GET ${project}/session-placement`,
  `GET ${project}?limit=1&phase=Done`,
  `GET ${project}?order=RecentActivity&${moving}`,
  `GET ${project}/drafts?limit=1`,
];

async function sentFor(site: SetupSite, asking: Asking = {}) {
  const sent: string[] = [];
  await siteRead(site, { ...asking, sent });
  return sent;
}

test("a site set up to its end is sent these reads and no other, each once", async () => {
  expect(await sentFor(setupSiteAt("Landed"))).toEqual(reads);
});

test("the landings of a ticket being landed are read, and of no other ticket", async () => {
  const site = setupSiteAt("Live");
  site.projects[0]?.tickets.push(
    { ticket: 4, phase: "Work" },
    { ticket: 3, phase: "Finalization" },
  );
  site.projects[0]?.landings.set(3, [setupSiteHeld]);
  expect(await sentFor(site)).toEqual([
    ...reads,
    `GET ${project}/tickets/3/landings`,
  ]);
});

test("a read that hangs on one that was not got is never sent", async () => {
  expect(await sentFor(setupSiteAt("Nothing"))).toEqual(reads.slice(0, 1));
  expect(await sentFor(setupSiteAt("Workspace"))).toEqual(reads.slice(0, 2));
  const unlisted = setupSiteAt("Landed");
  unlisted.fates.set("inventory", "Failed");
  expect(await sentFor(unlisted)).toEqual(reads.slice(0, 2));
  expect(await sentFor(siteOf(both, spread))).toEqual(reads.slice(0, 1));
});

test("a project the remote was looked for in has its repositories read once, whether or not it is the one proposed", async () => {
  const sent = await sentFor(bound(["acme"], pair, ["acme/widgets"]), {
    remote,
  });
  expect(sent.filter((asked) => asked.endsWith("/repositories"))).toEqual([
    `GET ${project}/repositories`,
    "GET /api/v1/tenants/acme/projects/gadgets/repositories",
  ]);
});

/** Ports that record what reaches them and answer nothing readable. */
function recording(sent: string[]): ApiPorts {
  return {
    ...sitePorts(setupSiteEmpty(), sent),
    renew: () => Promise.reject(new Error("the ports renewed")),
    refused: () => {
      throw new Error("the ports forgot the sign-in");
    },
  };
}

test.each(["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "get", ""])(
  "a request with the method %j fails at the ports the checklist reads through, having reached nothing",
  async (method) => {
    const sent: string[] = [];
    const ports = setupReadPorts(recording(sent), "access");
    const init = { headers: {}, signal: new AbortController().signal };
    await expect(
      ports.fetch("/api/v1/projects", { ...init, method }),
    ).rejects.toThrow("the checklist sends nothing but reads");
    expect(sent).toEqual([]);
    await ports.fetch("/api/v1/projects", { ...init, method: "GET" });
    expect(sent).toEqual(["GET /api/v1/projects"]);
  },
);

test("each of the console's writes, sent through the ports the checklist reads through, reaches nothing and is said as unreachable", async () => {
  const sent: string[] = [];
  const ports = setupReadPorts(recording(sent), "access");
  const partition = { tenant: "acme", project: "widgets" };
  const writes = [
    apiCreateProject(ports, { tenant: "acme", project: "widgets" }, "op-1"),
    apiMintWorkerPoolToken(ports, partition, { pool: "laptop" } as never),
    apiWriteSessionPlacement(ports, partition, {} as never),
  ];
  for (const write of writes)
    expect(await write).toMatchObject({ outcome: "Unreachable" });
  expect(sent).toEqual([]);
});

test("the ports the checklist reads through hold one bearer, renew nothing and forget nothing, whatever a read is answered", async () => {
  const refusing: ApiPorts = {
    ...recording([]),
    fetch: () => Promise.resolve(new Response("{}", { status: 401 })),
  };
  const ports = setupReadPorts(refusing, "access");
  expect(await ports.bearer()).toBe("access");
  expect(Object.keys(ports).toSorted()).toEqual(["bearer", "fetch", "sleepMs"]);
  expect(await apiProjectInventory(ports)).toEqual({
    outcome: "Unauthenticated",
  });
});

test("every read goes out under the bearer the run got while it held the lock, and never under one the ports it reads through would answer now", async () => {
  const authorized: (string | undefined)[] = [];
  const later: ApiPorts = {
    ...sitePorts(setupSiteAt("Landed")),
    fetch: (_target, init) => {
      authorized.push(new Headers(init.headers).get("authorization") ?? "");
      return Promise.resolve(Response.json({ projects: [] }));
    },
    bearer: () => Promise.resolve("renewed-since"),
  };
  const ports = setupReadPorts(later, "got-under-the-lock");
  expect(await ports.bearer()).toBe("got-under-the-lock");
  await apiProjectInventory(ports);
  expect(authorized).toEqual(["Bearer got-under-the-lock"]);
});

/** Ports that answer as `ports` do, but for the reads whose address holds `part`, which are answered as `answer` makes of what the site sent. */
function answering(
  part: string,
  answer: (sent: object) => Response,
): (ports: ApiPorts) => ApiPorts {
  return (ports) => ({
    ...ports,
    fetch: async (target, init) => {
      const response = await ports.fetch(target, init);
      return target.includes(part)
        ? answer((await response.json()) as object)
        : response;
    },
  });
}

test.each([{ nextCursor: "more" }, { nextAfter: 1 }])(
  "a page of the tickets on their way that says more follow, as %j, is not taken for all of them",
  async (more) => {
    const through = answering("order=RecentActivity", (sent) =>
      Response.json({ ...sent, ...more }),
    );
    const reads = await siteRead(setupSiteAt("Moving"), { through });
    expect(reads.moving).toMatchObject({ read: "Got", whole: false });
    expect((await siteRead(setupSiteAt("Moving"))).moving).toMatchObject({
      read: "Got",
      whole: true,
    });
  },
);

test("a read the site forbids is refused, as one it hides is, and any other rejection is a failure", async () => {
  const answered = (status: number) =>
    answering("/session-placement", () => Response.json({}, { status }));
  const forbidden = await siteRead(setupSiteAt("Live"), {
    through: answered(403),
  });
  expect(forbidden.placement).toEqual({ read: "Refused" });
  const rejected = await siteRead(setupSiteAt("Live"), {
    through: answered(400),
  });
  expect(rejected.placement).toEqual({ read: "Failed", outcome: "Rejected" });
});
