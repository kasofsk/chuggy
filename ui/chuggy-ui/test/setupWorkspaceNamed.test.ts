/**
 * The setup program names a workspace to the person by its display name in
 * every sentence, and by its id in every command and address, which is what
 * the program and the site take. Where the person's own list of workspaces
 * gives no name for it, the sentence says the id.
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import { setupAnswersAsked } from "../app/core/setupArguments.ts";
import { setupReportLines } from "../app/core/setupReport.ts";
import { machineScript, machineSignedIn, machineSite } from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import { setupSiteAt } from "./setupSite.ts";
import type { SetupSite, SetupSiteStage } from "./setupSite.ts";

const named = "Acme's Workspace";

/** A site set up as far as `stage`, whose one workspace, `acme`, is called something else. */
function siteNamed(stage: SetupSiteStage): SetupSite {
  const site = setupSiteAt(stage);
  site.tenants = site.tenants.map((held) => ({ ...held, displayName: named }));
  return site;
}

async function said(
  machine: SetupMachine,
  argv: readonly string[] = [],
): Promise<readonly string[]> {
  return setupReportLines(
    await machine.command(argv),
    machineScript,
    copyTextEn,
    setupAnswersAsked(argv),
  );
}

test("the checklist names a workspace by its display name in its steps and its question, and by its id in the command", async () => {
  const lines = await said(await machineSignedIn(siteNamed("Workspace")));
  expect(lines).toContain(`step: workspace   done     ${named}`);
  expect(lines).toContain(
    `step: project     todo     ${named} has no project yet`,
  );
  expect(lines.slice(-3)).toEqual([
    `ask: What should the new project in ${named} be called? Its address is made from the name. Pass the name as --name.`,
    `rule: Run node ${machineScript} project --workspace acme --name with the person's answer after it, quoted as one word, only once the person has answered.`,
    "next: stop",
  ]);
});

test("a tell names the project by its workspace's display name, and the address it gives is the id's", async () => {
  const offered = await said(
    await machineSignedIn(siteNamed("NorthStar"), false),
  );
  const tell = offered.find((line) => line.startsWith("tell: "));
  expect(tell).toContain(`for ${named}/widgets at ${machineSite}`);
  expect(offered.at(-2)).toContain("mcp --workspace acme --project widgets");
  const done = await said(await machineSignedIn(siteNamed("Landed")));
  const finished = done.find((line) => line.startsWith("tell: "));
  expect(finished).toContain(`chuggy is set up for ${named}/widgets`);
  expect(finished).toContain(`${machineSite}/acme/widgets/tickets/new`);
});

test("a workspace the person's list gives no name for is named by its id", async () => {
  const seen = setupSiteAt("Project");
  seen.tenants = [];
  const lines = await said(await machineSignedIn(seen), [
    "--workspace",
    "acme",
    "--project",
    "widgets",
  ]);
  expect(lines.find((line) => line.startsWith("step: workspace"))).toMatch(
    /^step: workspace +waiting +acme, where you see a project/u,
  );
});

test("a project made says the workspace it was made in by its display name, and the command after it carries the id", async () => {
  const lines = await said(await machineSignedIn(siteNamed("Workspace")), [
    "project",
    "--workspace",
    "acme",
    "--name",
    "Atlas Web",
  ]);
  expect(lines).toContain(`did: made ${named}/atlas-web, called Atlas Web`);
  expect(lines.at(-1)).toBe(
    `next: node ${machineScript} --workspace acme --project atlas-web`,
  );
});

test("a run of runner says the project by its workspace's display name, and the command after it carries the id", async () => {
  const site = siteNamed("Configured");
  for (const project of site.projects) project.threads = "InCluster";
  const lines = await said(await machineSignedIn(site), [
    "runner",
    "--workspace",
    "acme",
    "--project",
    "widgets",
  ]);
  expect(lines).toContain(
    `found: the site sees a runner of ${named}/widgets live`,
  );
  expect(lines.at(-1)).toBe(
    `next: node ${machineScript} --workspace acme --project widgets`,
  );
});
