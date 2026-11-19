/**
 * A personal runner of the person's, registered by hand, made to take the
 * project's work by the setup program itself: where the runner is not given
 * the project, the checklist offers `serve`, and one yes gives it the project,
 * with nothing else written, whatever the project names as its owner fallback
 * and whether or not the person administers it.
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
const serving =
  "tell: Your runner is registered and does not take acme/widgets's work yet.";
const offered = `${serving} With your yes I will give it acme/widgets. Tell me yes to go ahead.`;
const offerRule = `rule: Run node ${machineScript} serve ${at} only once the person says yes to their runner taking the project's work.`;

interface Held {
  readonly given: boolean;
  readonly fallback: OwnerFallback | undefined;
  readonly administer: boolean;
}

/** A site set up as far as a runner, whose chats run on the cluster, where the person holds a live personal runner, given the project or not. */
function held(given: Held): { site: SetupSite; project: SetupSiteProject } {
  const site = setupSiteAt("Configured");
  const [project] = site.projects;
  if (project === undefined) throw new Error("the stage has no project");
  project.threads = "InCluster";
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

const holdings: readonly (readonly [string, Held])[] = [
  [
    "an administrator of a project naming no fallback",
    { given: false, fallback: undefined, administer: true },
  ],
  [
    "a member who does not administer a project naming no fallback",
    { given: false, fallback: undefined, administer: false },
  ],
  [
    "an administrator of a project naming Strict",
    { given: false, fallback: "Strict", administer: true },
  ],
];

test.each(holdings)(
  "%s, with a personal runner not given the project, is offered serve, and one yes gives the runner the project, the only write made, and the step is done",
  async (_who, holding) => {
    const { site, project } = held(holding);
    const machine = await machineSignedIn(site);
    const asked = lines(await machine.command(flags));
    expect(asked.slice(-3)).toEqual([offered, offerRule, "next: stop"]);
    expect(asked.join("\n")).not.toMatch(/Register runner|Add a project/u);
    expect(writes(machine)).toEqual([]);

    const report = await machine.command(["serve", ...flags]);
    const said = lines(report);
    expect(said[1]).toBe("did: gave your personal runners widgets");
    expect(writes(machine)).toEqual([`PUT ${givePath}`]);
    expect(project.fallback).toBe(holding.fallback);
    expect(site.personal.get("acme")?.projects).toEqual(["widgets"]);
    expect(runnerStep(said)).toBe("step: runner      done     live");
    expect(setupReportExit(report)).toBe(0);
  },
);

test("a runner given the project that is offline waits, and serve is not offered", async () => {
  const { site, project } = held({
    given: true,
    fallback: undefined,
    administer: false,
  });
  site.personal.set("acme", { live: [false], projects: [project.project] });
  const machine = await machineSignedIn(site);
  const said = lines(await machine.command(flags));
  expect(runnerStep(said)).toBe(
    "step: runner      waiting  registered, not running",
  );
  expect(said.join("\n")).not.toContain(" serve ");
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

test("a give the site refuses is said as refused, and the step stays to do", async () => {
  const { site } = held({
    given: false,
    fallback: undefined,
    administer: true,
  });
  site.fates.set("serve", "Failed");
  const machine = await machineSignedIn(site);
  const said = lines(await machine.command(["serve", ...flags]));
  expect(said[1]).toBe(
    "found: chuggy did not give your personal runners widgets: Server error",
  );
  expect(writes(machine)).toEqual([`PUT ${givePath}`]);
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
