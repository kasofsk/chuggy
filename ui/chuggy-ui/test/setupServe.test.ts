/**
 * A personal runner of the person's, registered by hand, made to take the
 * project's work by the setup program itself: where the project has no pool
 * and the runner does not take its work, the checklist offers `serve`, and
 * one yes gives it the project and, where the project names no owner
 * fallback and the person administers it, names Preferred, with nothing else
 * written.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import type { OwnerFallback } from "../../../src/contract/rosters.ts";
import {
  machineScript,
  machineServing,
  machineSignedIn,
  machineSite,
} from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import { setupSiteAt } from "./setupSite.ts";
import type { SetupSite, SetupSiteProject } from "./setupSite.ts";

const flags = ["--workspace", "acme", "--project", "widgets"];
const at = flags.join(" ");
const tenantPath = "/api/v1/tenants/acme";
const givePath = `${tenantPath}/personal-runner/projects/widgets`;
const allowPath = `${tenantPath}/projects/widgets/owner-fallback`;
const placement = `${machineSite}/acme/widgets/settings/placement`;
const serving =
  "tell: Your runner is registered and does not take acme/widgets's work yet.";
const offerRule = `rule: Run node ${machineScript} serve ${at} only once the person says yes to their runner taking the project's work.`;

interface Held {
  readonly given: boolean;
  readonly fallback: OwnerFallback | undefined;
  readonly administer: boolean;
}

/** A site set up as far as a runner, whose project has no pool and whose chats run on the cluster, where the person holds a live personal runner, given the project or not. */
function held(given: Held): { site: SetupSite; project: SetupSiteProject } {
  const site = setupSiteAt("Configured");
  const [project] = site.projects;
  if (project === undefined) throw new Error("the stage has no project");
  project.threads = "InCluster";
  project.runner = "Unregistered";
  project.fallback = given.fallback;
  project.administer = given.administer;
  site.personal.set("acme", {
    live: [true],
    projects: given.given ? [project.project] : [],
  });
  return { site, project };
}

function lines(report: SetupReport): readonly string[] {
  return setupReportLines(report, machineScript, copyTextEn, machineServing);
}

function runnerStep(said: readonly string[]): string | undefined {
  return said.find((line) => line.startsWith("step: runner "));
}

function writes(machine: SetupMachine): readonly string[] {
  return machine.sent
    .filter((sent) => !sent.startsWith("GET "))
    .map((sent) => sent.replace(machineSite, ""));
}

test("a project with no pool and a personal runner of the person's not given it offers serve, and one yes gives the runner the project and names Preferred, the only writes made, and the step is done", async () => {
  const { site, project } = held({
    given: false,
    fallback: undefined,
    administer: true,
  });
  const machine = await machineSignedIn(site);
  const offered = lines(await machine.command(flags));
  expect(offered.slice(-3)).toEqual([
    `${serving} With your yes I will give it acme/widgets and let your own runners take its work. Tell me yes to go ahead.`,
    offerRule,
    "next: stop",
  ]);
  expect(offered.join("\n")).not.toMatch(/Register runner|Add a project/u);
  expect(writes(machine)).toEqual([]);

  const report = await machine.command(["serve", ...flags]);
  const said = lines(report);
  expect(said.slice(1, 3)).toEqual([
    "did: gave your personal runners widgets",
    "did: set Personal runners on widgets to Preferred",
  ]);
  expect(writes(machine)).toEqual([`PUT ${givePath}`, `PUT ${allowPath}`]);
  expect(project.fallback).toBe("Preferred");
  expect(site.personal.get("acme")?.projects).toEqual(["widgets"]);
  expect(runnerStep(said)).toBe("step: runner      done     live");
  expect(setupReportExit(report)).toBe(0);
});

test("where the project already names an owner fallback, serve gives the runner the project and leaves the fallback as it was", async () => {
  const { site, project } = held({
    given: false,
    fallback: "Strict",
    administer: true,
  });
  const machine = await machineSignedIn(site);
  expect(lines(await machine.command(flags)).at(-3)).toBe(
    `${serving} With your yes I will give it acme/widgets. Tell me yes to go ahead.`,
  );
  const said = lines(await machine.command(["serve", ...flags]));
  expect(said[1]).toBe("did: gave your personal runners widgets");
  expect(writes(machine)).toEqual([`PUT ${givePath}`]);
  expect(project.fallback).toBe("Strict");
  expect(runnerStep(said)).toBe("step: runner      done     live");
});

test("a runner given the project that names no fallback is offered Preferred alone, and an offline one then waits as a pool's would", async () => {
  const { site, project } = held({
    given: true,
    fallback: undefined,
    administer: true,
  });
  site.personal.set("acme", { live: [false], projects: [project.project] });
  const machine = await machineSignedIn(site);
  expect(lines(await machine.command(flags)).at(-3)).toBe(
    `${serving} With your yes I will let your own runners take acme/widgets's work. Tell me yes to go ahead.`,
  );
  const said = lines(await machine.command(["serve", ...flags]));
  expect(said[1]).toBe("did: set Personal runners on widgets to Preferred");
  expect(writes(machine)).toEqual([`PUT ${allowPath}`]);
  expect(runnerStep(said)).toBe(
    "step: runner      waiting  registered, not running",
  );
});

test("a person who does not administer a project naming no fallback has serve give the runner the project only, and is told an admin sets Personal runners on its Placement page", async () => {
  const { site, project } = held({
    given: false,
    fallback: undefined,
    administer: false,
  });
  const machine = await machineSignedIn(site);
  const admin = `Your own runners take its work only once an admin of the project sets Personal runners on its Placement page, ${placement}.`;
  expect(lines(await machine.command(flags)).at(-3)).toBe(
    `${serving} With your yes I will give it acme/widgets. ${admin} Tell me yes to go ahead.`,
  );
  const said = lines(await machine.command(["serve", ...flags]));
  expect(said[1]).toBe("did: gave your personal runners widgets");
  expect(writes(machine)).toEqual([`PUT ${givePath}`]);
  expect(project.fallback).toBeUndefined();
  expect(said.slice(-3)).toEqual([
    `tell: Your runner is registered and given acme/widgets, and does not take its work yet. ${admin} Tell me once they have.`,
    `rule: Run node ${machineScript} ${at} only once the person says an admin of the project set Personal runners.`,
    "next: stop",
  ]);
});

test("serve writes nothing where its runner taking the project's work is not the next thing, and says so", async () => {
  const { site } = held({
    given: true,
    fallback: undefined,
    administer: false,
  });
  const machine = await machineSignedIn(site);
  const said = lines(await machine.command(["serve", ...flags]));
  expect(said[1]).toBe(
    "found: nothing to change: the next thing is not your runner taking the project's work",
  );
  expect(writes(machine)).toEqual([]);
});

test("a write the site refuses is said as refused, and the step stays to do", async () => {
  const { site } = held({
    given: false,
    fallback: undefined,
    administer: true,
  });
  site.fates.set("serve", "Failed");
  site.fates.set("allow", "Refused");
  const machine = await machineSignedIn(site);
  const said = lines(await machine.command(["serve", ...flags]));
  expect(said.slice(1, 3)).toEqual([
    "found: chuggy did not give your personal runners widgets: Server error",
    "found: chuggy did not set Personal runners on widgets: Not found",
  ]);
  expect(runnerStep(said)).toBe("step: runner      todo");
});

test("a person with no personal runner is offered one on this machine, and serve is not offered", async () => {
  const { site } = held({
    given: false,
    fallback: undefined,
    administer: true,
  });
  site.personal.clear();
  const machine = await machineSignedIn(site);
  const said = lines(await machine.command(flags)).join("\n");
  expect(said).toContain(
    "I'll install your runner on this machine, as yours alone.",
  );
  expect(said).not.toContain(" serve ");
});
