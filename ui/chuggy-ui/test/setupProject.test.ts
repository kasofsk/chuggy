/**
 * A run of `project` over a machine and an installation that are both
 * doubles: the person with a workspace and no project is asked a name, the
 * program makes the project by the console form's own request, and the
 * checklist moves on to the next step. Refusals are said in the form's words,
 * and a run tried again after an answer that never arrived makes no second
 * project.
 */

import { expect, test } from "vitest";

import { setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import type { Copy } from "../app/core/copy.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { machineScript, machineSignedIn, machineSite } from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import { setupSiteProject } from "./setupSite.ts";

const make = ["project", "--workspace", "acme", "--name", "Atlas Web"];

const creation = `POST ${machineSite}/api/v1/projects`;

/** The writes a run sent the site. */
function writes(machine: SetupMachine): readonly string[] {
  return machine.sent.filter((sent) => !sent.startsWith("GET "));
}

function projectsIn(machine: SetupMachine): readonly string[] {
  return machine.world.projects.map((held) => `${held.tenant}/${held.project}`);
}

function refused(refusal: Copy, again: boolean, project?: string): SetupReport {
  return {
    report: "Project",
    site: machineSite,
    workspace: "acme",
    workspaceName: "acme",
    project,
    name: "Atlas Web",
    ended: { ended: "Refused", refusal, again },
  };
}

test("a person with a workspace and no project is asked what to call it, the program makes it at the address the name makes, and the checklist moves on to the next step", async () => {
  const machine = await machineSignedIn();
  const lines = setupReportLines(
    await machine.command([]),
    machineScript,
    copyTextEn,
  );
  expect(lines.slice(-3)).toEqual([
    "ask: What should the new project in acme be called? Its address is made from the name. Pass the name as --name.",
    `rule: Run node ${machineScript} project --workspace acme --name with the person's answer after it, quoted as one word, only once the person has answered.`,
    "next: stop",
  ]);
  expect(await machine.command(make)).toEqual({
    report: "Project",
    site: machineSite,
    workspace: "acme",
    workspaceName: "acme",
    project: undefined,
    name: "Atlas Web",
    ended: { ended: "Made", project: "atlas-web", name: "Atlas Web" },
  });
  expect(writes(machine)).toEqual([creation]);
  expect(machine.world.projects).toMatchObject([
    { tenant: "acme", project: "atlas-web", name: "Atlas Web" },
  ]);
  expect(
    await machine.command(["--workspace", "acme", "--project", "atlas-web"]),
  ).toMatchObject({
    report: "Checklist",
    steps: [
      { step: "plugin", state: "done" },
      { step: "workspace", state: "done" },
      { step: "project", state: "done" },
      ...Array.from({ length: 5 }, () => expect.anything() as unknown),
    ],
  });
});

test("an address given is the one the project is made at, under the name given", async () => {
  const machine = await machineSignedIn();
  expect(await machine.command([...make, "--project", "atlas"])).toMatchObject({
    ended: { ended: "Made", project: "atlas", name: "Atlas Web" },
  });
  expect(projectsIn(machine)).toEqual(["acme/atlas"]);
});

test("a site that refuses the project is said in the console form's words for it, and the project is not made", async () => {
  const exists = await machineSignedIn();
  exists.world.projects.push(setupSiteProject("acme", "atlas-web"));
  expect(await exists.command(make)).toEqual(
    refused({ id: "project-creation-refusal-exists" }, false),
  );
  const unadministered = await machineSignedIn();
  unadministered.world.tenants = unadministered.world.tenants.map((held) => ({
    ...held,
    administer: false,
  }));
  expect(await unadministered.command(make)).toEqual(
    refused({ id: "project-creation-refusal-taken" }, false),
  );
  expect(projectsIn(unadministered)).toEqual([]);
});

test("a name or an address the console form would not send is refused in its words, and nothing is sent", async () => {
  const cases: readonly (readonly [readonly string[], string])[] = [
    [["--name", "x".repeat(101)], "project-creation-name-too-long"],
    [["--name", "!!!"], "project-creation-address-none"],
    [
      ["--name", "Atlas Web", "--project", "Not-An-Address"],
      "project-creation-name-rule",
    ],
  ];
  for (const [named, refusal] of cases) {
    const machine = await machineSignedIn();
    expect(
      await machine.command(["project", "--workspace", "acme", ...named]),
      refusal,
    ).toMatchObject({ ended: { ended: "Refused", refusal: { id: refusal } } });
    expect(writes(machine)).toEqual([]);
  }
});

test("a run tried again after the site took the project and its answer never arrived is answered the same project, and no second one is made", async () => {
  const machine = await machineSignedIn();
  machine.drops = true;
  expect(await machine.command(make)).toEqual(
    refused({ id: "project-creation-refusal-unreachable" }, true),
  );
  expect(projectsIn(machine)).toEqual(["acme/atlas-web"]);
  machine.drops = false;
  expect(await machine.command(make)).toMatchObject({
    ended: { ended: "Made", project: "atlas-web", name: "Atlas Web" },
  });
  expect(projectsIn(machine)).toEqual(["acme/atlas-web"]);
  expect(writes(machine)).toEqual([creation, creation]);
});
