/**
 * The folder's repository added by the setup program itself: offered where
 * both apps are granted it and bound by `bind` on the person's yes, with the
 * write the console's Add makes; and, where an app is not granted it, one
 * tell naming every such app with where it is given it, with the checklist
 * read again once the person says they are done there.
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
const granting = `On GitHub choose ${repository} among the repositories each app may reach, and save. GitHub may ask you to confirm access first, with a code it emails you. Tell me once you are done there.`;

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

test("where both apps are granted the folder's repository, the checklist offers bind, and one yes binds it and the step is done", async () => {
  const machine = await inFolder(connected({ portal: true, worker: true }));
  const offered = lines(await machine.command(flags));
  expect(offered.slice(-3)).toEqual([
    `tell: The portal app and the worker app are both let into ${repository}, this folder's repository, and acme/widgets does not have it yet. With your yes I will add it to acme/widgets, as the repositories page's Add does. Tell me yes to go ahead.`,
    `rule: Run node ${machineScript} bind ${at} only once the person says yes to adding ${repository} to the project.`,
    "next: stop",
  ]);
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

test("bind asks nothing of the site where adding the folder's repository is not the next thing, and says so", async () => {
  const machine = await inFolder(connected({ portal: true, worker: false }));
  const said = lines(await machine.command(["bind", ...flags]));
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
    `rule: Run node ${machineScript} ${at} only once the person says each app named is given ${repository} on GitHub.`,
    "next: stop",
  ]);
});

test("where one app is granted the folder's repository, the tell names only the other, and once it is granted the checklist offers bind", async () => {
  const machine = await inFolder(connected({ portal: true, worker: false }));
  const worker = setupSiteClaim(setupSiteAccount, "worker");
  const said = lines(await machine.command(flags));
  expect(said.at(-3)).toBe(
    `tell: GitHub does not let this app into ${repository}, this folder's repository: the worker app, on its settings page ${setupSiteSettingsUrl(worker)}. ${granting}`,
  );
  machine.world.grants.set(worker.installationId, [setupSiteRepositoryAddress]);
  expect(lines(await machine.command(flags)).at(-2)).toBe(
    `rule: Run node ${machineScript} bind ${at} only once the person says yes to adding ${repository} to the project.`,
  );
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

test("an app not installed on the account that owns the folder's repository is sent to the console's install of it, whose claim the next read finds, and then bind is offered", async () => {
  const machine = await inFolder(owning(["portal"]));
  const tell = lines(await machine.command(flags)).at(-3);
  expect(tell).toBe(
    `tell: GitHub does not let this app into ${repository}, this folder's repository: the worker app, which is not installed there yet: on ${accounts} press Install worker on the row of ${setupSiteAccount}. ${granting}`,
  );
  expect(tell).not.toContain(setupSiteInstallUrl("worker"));
  claimed(machine, "worker");
  expect(lines(await machine.command(flags)).at(-2)).toBe(
    `rule: Run node ${machineScript} bind ${at} only once the person says yes to adding ${repository} to the project.`,
  );
});

test("where neither app is installed on the account that owns the folder's repository, one tell names Add account for the portal app and the worker app's install on the row that follows it", async () => {
  const machine = await inFolder(owning([]));
  const tell = lines(await machine.command(flags)).at(-3);
  expect(tell).toBe(
    `tell: GitHub does not let these apps into ${repository}, this folder's repository: the portal app, which is not installed there yet: on ${accounts} press Add account and install it on ${setupSiteAccount}; and the worker app, which is not installed there either: once ${setupSiteAccount} is listed on that page, press Install worker on its row. ${granting}`,
  );
  claimed(machine, "portal");
  claimed(machine, "worker");
  expect(lines(await machine.command(flags)).at(-2)).toBe(
    `rule: Run node ${machineScript} bind ${at} only once the person says yes to adding ${repository} to the project.`,
  );
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
