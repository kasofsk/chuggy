/**
 * The folder's repository added by the setup program itself: `bind` named to
 * run at once wherever the next thing is a trip to GitHub or the repository
 * both apps are granted, reading the checklist again while GitHub is not yet
 * done and binding once it is, with the write the console's Add makes; and,
 * where an app is not granted it, one tell naming every such app with where
 * it is given it.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import {
  machineScript,
  machineServing,
  machineSignedIn,
  machineSite,
} from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
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
const accounts = `${machineSite}/tenants/acme/settings/accounts`;
const granting = `On GitHub, choose "All repositories", or "Only select repositories" and pick ${repository}, and save. Either is fine: with All, a later project needs no trip to GitHub. GitHub may ask you to confirm access first, with a code it emails you.`;
const runNow =
  "rule: Run the command on the next: line now, without asking the person";
const runNowRest =
  ". It waits until GitHub lets both apps into this folder's repository, and then adds it. Nothing has failed, so do not tell the person that it did or give them a deadline.";
const runBind = `next: node ${machineScript} bind ${at}`;
/** The rule and command a checklist ends on beside a tell of a trip to GitHub. */
const tripped = [
  `${runNow}, while they do what the tell: line says${runNowRest}`,
  runBind,
];

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

test("where both apps are granted the folder's repository, the checklist runs bind at once, which binds it once, and a second bind finds it added and writes nothing", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  const offered = lines(await machine.command(flags));
  expect(offered.slice(-2)).toEqual([`${runNow}${runNowRest}`, runBind]);
  expect(offered.some((line) => line.startsWith("tell: "))).toBe(false);
  expect(binds(machine)).toEqual([]);

  const report = await machine.command(["bind", ...flags]);
  const said = lines(report);
  expect(said[1]).toBe(
    `did: asked chuggy to add ${repository}, and it answered ${repository} · Default configuration added`,
  );
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
  expect(binds(machine)).toHaveLength(1);
  expect(step(said, "repository")).toBe(
    `step: repository  done     ${repository}`,
  );
});

test("a bind whose wait ends before GitHub is done binds nothing, says what GitHub still lacks, and names bind to run again", async () => {
  const machine = await inFolder(connected({ portal: true, worker: false }));
  const worker = setupSiteClaim(setupSiteAccount, "worker");
  const startedMs = machine.nowMs;
  const report = await machine.command(["bind", ...flags, "--wait-secs", "9"]);
  const said = lines(report);
  expect(machine.nowMs - startedMs).toBeGreaterThanOrEqual(9_000);
  expect(said[1]).toBe(
    "found: the wait ended before GitHub let both apps into this folder's repository",
  );
  expect(said.slice(-3)).toEqual([
    `tell: GitHub does not let this app into ${repository}, this folder's repository: the worker app, on its settings page ${setupSiteSettingsUrl(worker)}. ${granting}`,
    "rule: Run the command on the next: line again, and go on running it while GitHub still lacks what the tell: line says. Nothing has failed, so do not tell the person that it did or give them a deadline.",
    runBind,
  ]);
  expect(binds(machine)).toEqual([]);
  expect(setupReportExit(report)).toBe(0);
});

test("bind run where GitHub is not connected opens the repositories page that begins Connect GitHub, with the opener sign-in uses, and says so", async () => {
  const machine = await machineSignedIn(setupSiteAt("Project"));
  const connect = `${machineSite}/acme/widgets/repositories?connect=github`;
  const before = machine.launched.length;
  const said = lines(
    await machine.command(["bind", ...flags, "--wait-secs", "0"]),
  );
  expect(machine.launched.slice(before)).toEqual([["xdg-open", connect]]);
  expect(said[1]).toBe(`did: opened ${connect} in a browser`);
  expect(said.at(-3)).toMatch(
    new RegExp(
      `^tell: Open ${connect.replace(/[.?]/gu, "\\$&")}, and press Connect GitHub if the page does not go on to GitHub by itself\\. `,
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

test("a later project whose repository an All installation already reaches has bind run at once, with no trip to GitHub", async () => {
  const site = setupSiteAt("Apps");
  for (const app of ["portal", "worker"] as const)
    site.grants.set(`${setupSiteAccount}-${app}`, [
      "https://github.com/acme-org/gadgets",
      setupSiteRepositoryAddress,
    ]);
  const machine = await inFolder(site);
  const said = lines(await machine.command(flags));
  expect(said.slice(-2)).toEqual([`${runNow}${runNowRest}`, runBind]);
  expect(said.some((line) => line.startsWith("tell: "))).toBe(false);
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

test("where neither app is granted the folder's repository, one tell names each app's settings page and says GitHub may ask to confirm access", async () => {
  const machine = await inFolder(connected({ portal: false, worker: false }));
  const [portal, worker] =
    machine.world.installations.get(setupSiteWorkspace) ?? [];
  if (portal === undefined || worker === undefined)
    throw new Error("no claims");
  const said = lines(await machine.command(flags));
  expect(said.slice(-3)).toEqual([
    `tell: GitHub does not let these apps into ${repository}, this folder's repository: the portal app, on its settings page ${setupSiteSettingsUrl(portal)}; and the worker app, on its settings page ${setupSiteSettingsUrl(worker)}. ${granting}`,
    ...tripped,
  ]);
});

test("where one app is granted the folder's repository, the tell names only the other, and once it is granted the checklist runs bind with no tell", async () => {
  const machine = await inFolder(connected({ portal: true, worker: false }));
  const worker = setupSiteClaim(setupSiteAccount, "worker");
  const said = lines(await machine.command(flags));
  expect(said.at(-3)).toBe(
    `tell: GitHub does not let this app into ${repository}, this folder's repository: the worker app, on its settings page ${setupSiteSettingsUrl(worker)}. ${granting}`,
  );
  machine.world.grants.set(worker.installationId, [setupSiteRepositoryAddress]);
  expect(lines(await machine.command(flags)).slice(-2)).toEqual([
    `${runNow}${runNowRest}`,
    runBind,
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

test("an app not installed on the account that owns the folder's repository is sent to the console's install of it, whose claim the next read finds, and then bind is run with no tell", async () => {
  const machine = await inFolder(owning(["portal"]));
  const tell = lines(await machine.command(flags)).at(-3);
  expect(tell).toBe(
    `tell: GitHub does not let this app into ${repository}, this folder's repository: the worker app, which is not installed there yet: on ${accounts} press Install worker on the row of ${setupSiteAccount}. ${granting}`,
  );
  expect(tell).not.toContain(setupSiteInstallUrl("worker"));
  claimed(machine, "worker");
  expect(lines(await machine.command(flags)).slice(-2)).toEqual([
    `${runNow}${runNowRest}`,
    runBind,
  ]);
});

test("where neither app is installed on the account that owns the folder's repository, one tell names Add account for the portal app and the worker app's install on the row that follows it", async () => {
  const machine = await inFolder(owning([]));
  const tell = lines(await machine.command(flags)).at(-3);
  expect(tell).toBe(
    `tell: GitHub does not let these apps into ${repository}, this folder's repository: the portal app, which is not installed there yet: on ${accounts} press Add account and install it on ${setupSiteAccount}; and the worker app, which is not installed there either: once ${setupSiteAccount} is listed on that page, press Install worker on its row. ${granting}`,
  );
  claimed(machine, "portal");
  claimed(machine, "worker");
  expect(lines(await machine.command(flags)).slice(-2)).toEqual([
    `${runNow}${runNowRest}`,
    runBind,
  ]);
});

test("where the deployment offers no install the workspace can claim, an app not installed there leaves the console's Add the way", async () => {
  const site = owning(["portal"]);
  site.authorizing = false;
  const machine = await inFolder(site);
  expect(lines(await machine.command(flags)).at(-3)).toMatch(
    /^tell: Open \S+\/repositories, press Add and choose acme-org\/widgets, this folder's repository\./u,
  );
});

test("the deployment's apps and an installation's settings page are asked only where the tell names them", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  await machine.command(flags);
  expect(
    machine.sent.filter((sent) => /forge\/github$|\/permissions$/u.test(sent)),
  ).toEqual([]);
});

test("where what an app grants was not read, the console's Add is the way", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  machine.world.fates.set("workerGrant", "Failed");
  expect(lines(await machine.command(flags)).at(-3)).toMatch(
    /^tell: Open \S+\/repositories, press Add and choose acme-org\/widgets, this folder's repository\./u,
  );
});
