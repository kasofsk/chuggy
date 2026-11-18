/**
 * The folder's repository added by the setup program itself: `bind` named to
 * run at once wherever the next thing is a trip to GitHub or the repository
 * both apps are granted, reading the checklist again while GitHub is not yet
 * done or a look went unanswered and binding once it is, with the write the
 * console's Add makes, then saying both apps reach it in the project; and one
 * tell saying what each app is for and naming both with where each is given
 * it and whether it already is.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import { apiAttemptsMax } from "../app/core/apiRequest.ts";
import { setupBindPollMs } from "../app/core/setupBind.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import {
  machineScript,
  machineServing,
  machineSignedIn,
  machineSite,
} from "./setupMachine.ts";
import type { Answering, SetupMachine } from "./setupMachine.ts";
import {
  setupSiteAccount,
  setupSiteAt,
  setupSiteClaim,
  setupSiteInstallUrl,
  setupSiteRepositoryAddress,
  setupSiteSettingsUrl,
  setupSiteWorkspace,
} from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";

const flags = ["--workspace", "acme", "--project", "widgets"];
const at = flags.join(" ");
const repository = "acme-org/widgets";
const bindPath = "/api/v1/tenants/acme/projects/widgets/repositories";
const flow = `${machineSite}/acme/widgets/repositories?repository=acme-org%2Fwidgets&from=setup#add`;
const granting = `Open ${flow}: it opens on ${repository}, and each app it still lacks has one press there that goes to GitHub for it. GitHub may ask you to confirm access first, with a code it emails you.`;
const runNow =
  "rule: Run the command on the next: line now, without asking the person";
const runNowRest =
  ". It waits until GitHub lets both apps into this folder's repository, and then adds it. Nothing has failed, so do not tell the person that it did or give them a deadline.";
const runBind = `next: node ${machineScript} bind ${at}`;
const chose = `Which repository is this project for? This folder's is ${repository}, so that is the one I connect; for another, start me in the folder of its clone.`;
const explained = `chuggy uses two GitHub apps. The worker app pushes ticket work to branches and opens pull requests. The portal app merges finished work into protected branches such as main. Both need access to ${repository}.`;
const waiting = `I'll wait here. ${granting}`;
const addingNow = "Both are granted it, so I add it now.";
const confirmed = `tell: Both apps can reach ${repository}. It is connected to widgets.`;
const elsewhere =
  "elsewhere already has chuggy's apps installed, so I can see its repositories. Another workspace can only where one of its admins owns elsewhere on GitHub. ";

/** An app's line in the tell: whether it is granted the folder's repository, with its page where it is. */
function granted(page: string, is: boolean): string {
  return is
    ? `${page}, already granted ${repository}`
    : `installed, not let into ${repository} yet`;
}

/** The tell of the folder's repository, both apps' lines in the roster's order, and how it ends. */
function reachTell(
  portal: string,
  worker: string,
  end: string,
  installed = "",
): string {
  return `tell: ${chose} ${installed}${explained} 1. Portal: ${portal} 2. Worker: ${worker}. ${end}`;
}
/** The rule and command a checklist ends on beside its tell of GitHub. */
const tripped = [
  `${runNow}, and tell them what the tell: line says${runNowRest}`,
  runBind,
];

/** The settings page of `app`'s installation on the account that owns the folder's repository. */
function settings(app: "portal" | "worker"): string {
  return setupSiteSettingsUrl(setupSiteClaim(setupSiteAccount, app));
}

/** A site with both apps on the account that owns the folder's repository and nothing added, each app granted what `granted` says. */
function connected(granted: { portal: boolean; worker: boolean }): SetupSite {
  const site = setupSiteAt("Apps");
  for (const app of ["portal", "worker"] as const)
    site.grants.set(
      `${setupSiteAccount}-${app}`,
      granted[app] ? [setupSiteRepositoryAddress] : [],
    );
  return site;
}

async function inFolder(site: SetupSite): Promise<SetupMachine> {
  const machine = await machineSignedIn(site);
  machine.remote = "git@github.com:acme-org/widgets.git";
  return machine;
}

function lines(report: SetupReport): readonly string[] {
  return setupReportLines(report, machineScript, copyTextEn, machineServing);
}

function step(said: readonly string[], name: string): string | undefined {
  return said.find((line) => line.startsWith(`step: ${name} `));
}

function binds(machine: SetupMachine): readonly string[] {
  return machine.sent.filter(
    (sent) => sent.startsWith("POST ") && sent.endsWith(bindPath),
  );
}

test("where both apps are granted the folder's repository, the checklist tells both apps' pages as granted it and runs bind at once, which binds it once and says both apps reach it, and a second bind finds it added and writes nothing", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  const offered = lines(await machine.command(flags));
  expect(offered.slice(-3)).toEqual([
    reachTell(
      granted(settings("portal"), true),
      granted(settings("worker"), true),
      addingNow,
    ),
    ...tripped,
  ]);
  expect(offered).not.toContain(confirmed);
  expect(binds(machine)).toEqual([]);

  const report = await machine.command(["bind", ...flags]);
  const said = lines(report);
  expect(said[1]).toBe(
    `did: asked chuggy to add ${repository}, and it answered ${repository} · Default configuration added`,
  );
  expect(said[2]).toBe(confirmed);
  expect(step(said, "repository")).toBe(
    `step: repository  done     ${repository}`,
  );
  expect(binds(machine)).toHaveLength(1);
  expect(machine.world.projects[0]?.repositories).toMatchObject([
    { repository: setupSiteRepositoryAddress },
  ]);
  expect(setupReportExit(report)).toBe(0);

  const again = lines(await machine.command(["bind", ...flags]));
  expect(again[1]).toBe(
    "found: nothing to add: the next thing is not adding this folder's repository",
  );
  expect(again).not.toContain(confirmed);
  expect(binds(machine)).toHaveLength(1);
});

test("bind run while an app is not yet granted reads the checklist again until it is, then binds once under one operation", async () => {
  const machine = await inFolder(connected({ portal: true, worker: false }));
  const worker = setupSiteClaim(setupSiteAccount, "worker");
  const listing = `/forge-installations/${worker.installationId}/repositories`;
  let looks = 0;
  machine.answering = () => {
    if (!(machine.sent.at(-1) ?? "").endsWith(listing)) return;
    looks += 1;
    if (looks === 2)
      machine.world.grants.set(worker.installationId, [
        setupSiteRepositoryAddress,
      ]);
  };
  const said = lines(await machine.command(["bind", ...flags]));
  expect(looks).toBeGreaterThanOrEqual(2);
  expect(said[1]).toBe(
    `did: asked chuggy to add ${repository}, and it answered ${repository} · Default configuration added`,
  );
  expect(said[2]).toBe(confirmed);
  expect(binds(machine)).toHaveLength(1);
  expect(step(said, "repository")).toBe(
    `step: repository  done     ${repository}`,
  );
});

test("on a machine with no browser, the checklist gives the connect flow's address and bind connects the folder's repository once GitHub grants it, opening nothing", async () => {
  const machine = await inFolder(connected({ portal: false, worker: false }));
  machine.opener = { launched: "Unstarted" };
  const before = machine.launched.length;
  const told = lines(await machine.command(flags)).at(-3);
  expect(told).toContain(flow);
  let looks = 0;
  machine.answering = () => {
    if (!(machine.sent.at(-1) ?? "").endsWith("/permissions")) return;
    looks += 1;
    if (looks === 2)
      for (const app of ["portal", "worker"] as const)
        machine.world.grants.set(
          setupSiteClaim(setupSiteAccount, app).installationId,
          [setupSiteRepositoryAddress],
        );
  };
  const said = lines(await machine.command(["bind", ...flags]));
  expect(said[2]).toBe(confirmed);
  expect(step(said, "repository")).toBe(
    `step: repository  done     ${repository}`,
  );
  expect(binds(machine)).toHaveLength(1);
  expect(machine.launched.slice(before)).toEqual([]);
});

test("a bind whose wait ends before GitHub is done binds nothing, says what GitHub still lacks, and names bind to run again", async () => {
  const machine = await inFolder(connected({ portal: true, worker: false }));
  const startedMs = machine.nowMs;
  const report = await machine.command(["bind", ...flags, "--wait-secs", "9"]);
  const said = lines(report);
  expect(machine.nowMs - startedMs).toBeGreaterThanOrEqual(9_000);
  expect(said[1]).toBe(
    "found: the wait ended before GitHub let both apps into this folder's repository",
  );
  expect(said).not.toContain(confirmed);
  expect(said.slice(-3)).toEqual([
    reachTell(
      granted(settings("portal"), true),
      granted(settings("worker"), false),
      waiting,
    ),
    "rule: Run the command on the next: line again, and go on running it while GitHub still lacks what the tell: line says. Nothing has failed, so do not tell the person that it did or give them a deadline.",
    runBind,
  ]);
  expect(binds(machine)).toEqual([]);
  expect(setupReportExit(report)).toBe(0);
});

const workspacesPath = `${machineSite}/access/v1/workspaces`;
const installationsPath = `${machineSite}/api/v1/tenants/acme/forge-installations`;
const bound = `did: asked chuggy to add ${repository}, and it answered ${repository} · Default configuration added`;
const unconfirmed = [
  `site: ${machineSite}, sign-in not confirmed`,
  "found: the site did not say which workspaces are yours (Unreachable)",
];

/** Has every request to `path` answered `how` until one look's read of it has used up its tries, and counts what is sent there. */
function failingOnce(
  machine: SetupMachine,
  path: string,
  how: Exclude<Answering, "Answers">,
): { readonly asked: () => number } {
  const tries = how === "Refuses" ? apiAttemptsMax : 1;
  let asked = 0;
  machine.answering = () => {
    if (machine.sent.at(-1) !== `GET ${path}`) {
      machine.api = "Answers";
      return;
    }
    asked += 1;
    machine.api = asked <= tries ? how : "Answers";
  };
  return { asked: () => asked };
}

for (const how of ["Silent", "Fails", "Refuses"] as const)
  test(`a bind whose first look the site does not answer, answering ${how}, looks again and binds once`, async () => {
    const machine = await inFolder(connected({ portal: true, worker: true }));
    const workspaces = failingOnce(machine, workspacesPath, how);
    const said = lines(await machine.command(["bind", ...flags]));
    expect(workspaces.asked()).toBeGreaterThan(
      how === "Refuses" ? apiAttemptsMax : 1,
    );
    expect(said[1]).toBe(bound);
    expect(step(said, "repository")).toBe(
      `step: repository  done     ${repository}`,
    );
    expect(binds(machine)).toHaveLength(1);
  });

test("a bind whose checklist read the site does not answer once looks again and binds", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  const installations = failingOnce(machine, installationsPath, "Silent");
  const said = lines(await machine.command(["bind", ...flags]));
  expect(installations.asked()).toBeGreaterThan(1);
  expect(said[1]).toBe(bound);
  expect(binds(machine)).toHaveLength(1);
});

test("a bind whose site stays unanswering for the whole wait ends with that look's report, after more than one look", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  const startedMs = machine.nowMs;
  machine.api = "Silent";
  let looks = 0;
  machine.answering = () => {
    if (machine.sent.at(-1) === `GET ${workspacesPath}`) looks += 1;
  };
  const said = lines(
    await machine.command(["bind", ...flags, "--wait-secs", "9"]),
  );
  expect(said.slice(0, 2)).toEqual(unconfirmed);
  expect(looks).toBeGreaterThan(1);
  expect(machine.nowMs - startedMs).toBeGreaterThanOrEqual(9_000);
  expect(binds(machine)).toEqual([]);
});

test("a bind the site refuses as signed out ends at its first look, with no poll and no bind", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  machine.admits = false;
  const startedMs = machine.nowMs;
  const said = lines(await machine.command(["bind", ...flags]));
  expect(said[0]).toBe(`site: ${machineSite}, not signed in`);
  expect(machine.nowMs - startedMs).toBeLessThan(setupBindPollMs);
  expect(binds(machine)).toEqual([]);
});

test("a bind whose first look fails while connecting GitHub is next opens the page once, at the look that reads where the person stands", async () => {
  const machine = await machineSignedIn(setupSiteAt("Project"));
  const connect = `${machineSite}/acme/widgets/repositories?from=setup#add`;
  const before = machine.launched.length;
  const workspaces = failingOnce(machine, workspacesPath, "Silent");
  const said = lines(
    await machine.command(["bind", ...flags, "--wait-secs", "9"]),
  );
  expect(workspaces.asked()).toBeGreaterThan(1);
  expect(machine.launched.slice(before)).toEqual([["xdg-open", connect]]);
  expect(said[1]).toBe(`did: opened ${connect} in a browser`);
});

test("bind run where GitHub is not connected opens the connect flow, with the opener sign-in uses, and says so", async () => {
  const machine = await machineSignedIn(setupSiteAt("Project"));
  const connect = `${machineSite}/acme/widgets/repositories?from=setup#add`;
  const before = machine.launched.length;
  const said = lines(
    await machine.command(["bind", ...flags, "--wait-secs", "0"]),
  );
  expect(machine.launched.slice(before)).toEqual([["xdg-open", connect]]);
  expect(said[1]).toBe(`did: opened ${connect} in a browser`);
  expect(said.at(-3)).toMatch(
    new RegExp(
      `^tell: Which repository is this project for\\? I could not tell this folder's, so name it on ${connect.replace(/[.?]/gu, "\\$&")}\\. ${explained.replace(repository, "your repository").replace(/[.]/gu, "\\$&")} That page then shows both apps`,
      "u",
    ),
  );
  expect(binds(machine)).toEqual([]);
});

test("a bind whose wait ran out with Connect GitHub still next names itself again as having opened the page, and that run opens nothing", async () => {
  const machine = await machineSignedIn(setupSiteAt("Project"));
  const wait = ["--wait-secs", "0"];
  const first = lines(await machine.command(["bind", ...flags, ...wait]));
  const rerun = `${runBind} --opened github`;
  expect(first.at(-1)).toBe(rerun);
  const before = machine.launched.length;
  const said = lines(
    await machine.command(["bind", ...flags, "--opened", "github", ...wait]),
  );
  expect(machine.launched.slice(before)).toEqual([]);
  expect(said.some((line) => line.startsWith("did: opened "))).toBe(false);
  expect(said.at(-1)).toBe(rerun);
  expect(binds(machine)).toEqual([]);
});

test("a later project whose repository an All installation already reaches has bind run at once, told as granted to both apps, with no trip to GitHub", async () => {
  const site = setupSiteAt("Apps");
  for (const app of ["portal", "worker"] as const)
    site.grants.set(`${setupSiteAccount}-${app}`, [
      "https://github.com/acme-org/gadgets",
      setupSiteRepositoryAddress,
    ]);
  const machine = await inFolder(site);
  const said = lines(await machine.command(flags));
  expect(said.slice(-3)).toEqual([
    reachTell(
      granted(settings("portal"), true),
      granted(settings("worker"), true),
      addingNow,
    ),
    ...tripped,
  ]);
  expect(lines(await machine.command(["bind", ...flags]))[1]).toBe(
    `did: asked chuggy to add ${repository}, and it answered ${repository} · Default configuration added`,
  );
});

test("a bind the site refuses says the refusal in the Add dialog's words, binds nothing, and leaves the step to do", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  machine.world.fates.set("bind", "Failed");
  const said = lines(await machine.command(["bind", ...flags]));
  expect(said[1]).toMatch(
    new RegExp(`^found: chuggy did not add ${repository}: `, "u"),
  );
  expect(step(said, "repository")).toBe(
    "step: repository  todo     github.com/acme-org/widgets (this folder's remote)",
  );
  expect(binds(machine)).toHaveLength(1);
  expect(machine.world.projects[0]?.repositories).toEqual([]);
});

test("bind waits on nothing and asks nothing of the site where the next thing is neither GitHub's nor adding the folder's repository, and says so", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  machine.world.fates.set("workerGrant", "Failed");
  const startedMs = machine.nowMs;
  const said = lines(await machine.command(["bind", ...flags]));
  expect(machine.nowMs - startedMs).toBeLessThan(3_000);
  expect(said[1]).toBe(
    "found: nothing to add: the next thing is not adding this folder's repository",
  );
  expect(binds(machine)).toEqual([]);
});

test("where neither app is granted the folder's repository, one tell says what each app is for and names each as not let into it, and says GitHub may ask to confirm access", async () => {
  const machine = await inFolder(connected({ portal: false, worker: false }));
  const said = lines(await machine.command(flags));
  expect(said.slice(-3)).toEqual([
    reachTell(
      granted(settings("portal"), false),
      granted(settings("worker"), false),
      waiting,
    ),
    ...tripped,
  ]);
  expect(said).not.toContain(confirmed);
});

test("where one app is granted the folder's repository, the tell names both apps' pages and which is granted it, and once the other is the checklist tells both as granted and runs bind", async () => {
  const machine = await inFolder(connected({ portal: true, worker: false }));
  const worker = setupSiteClaim(setupSiteAccount, "worker");
  const said = lines(await machine.command(flags));
  expect(said.at(-3)).toBe(
    reachTell(
      granted(settings("portal"), true),
      granted(settings("worker"), false),
      waiting,
    ),
  );
  expect(said).not.toContain(confirmed);
  machine.world.grants.set(worker.installationId, [setupSiteRepositoryAddress]);
  expect(lines(await machine.command(flags)).slice(-3)).toEqual([
    reachTell(
      granted(settings("portal"), true),
      granted(settings("worker"), true),
      addingNow,
    ),
    ...tripped,
  ]);
});

/** A site where `elsewhere` holds both apps and the account that owns the folder's repository holds those `held` names. */
function owning(held: readonly ("portal" | "worker")[]): SetupSite {
  const site = connected({ portal: true, worker: true });
  site.installations.set(setupSiteWorkspace, [
    setupSiteClaim("elsewhere", "portal"),
    setupSiteClaim("elsewhere", "worker"),
    ...held.map((app) => setupSiteClaim(setupSiteAccount, app)),
  ]);
  return site;
}

/** What the setup landing comes to once the console's install of `app` on the owner's account is claimed. */
function claimed(machine: SetupMachine, app: "portal" | "worker"): void {
  machine.world.installations
    .get(setupSiteWorkspace)
    ?.push(setupSiteClaim(setupSiteAccount, app));
}

test("an app not installed on the account that owns the folder's repository is sent to the connect flow, whose install's claim the next read finds, and then bind is run told as granted", async () => {
  const machine = await inFolder(owning(["portal"]));
  const tell = lines(await machine.command(flags)).at(-3);
  expect(tell).toBe(
    reachTell(
      granted(settings("portal"), true),
      `not installed on ${setupSiteAccount} yet`,
      waiting,
      elsewhere,
    ),
  );
  expect(tell).not.toContain(setupSiteInstallUrl("worker"));
  claimed(machine, "worker");
  expect(lines(await machine.command(flags)).slice(-3)).toEqual([
    reachTell(
      granted(settings("portal"), true),
      granted(settings("worker"), true),
      addingNow,
      elsewhere,
    ),
    ...tripped,
  ]);
});

test("where neither app is installed on the account that owns the folder's repository, one tell names both as not installed there and sends the person to the connect flow", async () => {
  const machine = await inFolder(owning([]));
  const tell = lines(await machine.command(flags)).at(-3);
  expect(tell).toBe(
    reachTell(
      `not installed on ${setupSiteAccount} yet`,
      `not installed on ${setupSiteAccount} yet`,
      waiting,
      elsewhere,
    ),
  );
  claimed(machine, "portal");
  claimed(machine, "worker");
  expect(lines(await machine.command(flags)).slice(-3)).toEqual([
    reachTell(
      granted(settings("portal"), true),
      granted(settings("worker"), true),
      addingNow,
      elsewhere,
    ),
    ...tripped,
  ]);
});

test("where the workspace already holds both apps on another account, the tell says so once the repository is said and before the apps, and a bind of the folder's repository both apps are granted says both apps reach it", async () => {
  const machine = await inFolder(owning(["portal", "worker"]));
  const said = lines(await machine.command(flags));
  expect(said.slice(-3)).toEqual([
    reachTell(
      granted(settings("portal"), true),
      granted(settings("worker"), true),
      addingNow,
      elsewhere,
    ),
    ...tripped,
  ]);
  const bound = lines(await machine.command(["bind", ...flags]));
  expect(bound[2]).toBe(confirmed);
  expect(binds(machine)).toHaveLength(1);
});

test("where the deployment offers no install the workspace can claim, an app not installed there leaves the console's Add the way", async () => {
  const site = owning(["portal"]);
  site.authorizing = false;
  const machine = await inFolder(site);
  expect(lines(await machine.command(flags)).at(-3)).toMatch(
    /^tell: Open \S+\/repositories, press Add and choose acme-org\/widgets, this folder's repository\./u,
  );
});

test("the deployment's apps are asked only where the tell names an install, and each installation's settings page wherever the tell names the apps", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  await machine.command(flags);
  expect(machine.sent.filter((sent) => /forge\/github$/u.test(sent))).toEqual(
    [],
  );
  expect(
    machine.sent.filter((sent) => /\/permissions$/u.test(sent)),
  ).toHaveLength(2);
});

test("where what an app grants was not read, the console's Add is the way", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  machine.world.fates.set("workerGrant", "Failed");
  expect(lines(await machine.command(flags)).at(-3)).toMatch(
    /^tell: Open \S+\/repositories, press Add and choose acme-org\/widgets, this folder's repository\./u,
  );
});
