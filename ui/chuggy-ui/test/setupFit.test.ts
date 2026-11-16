/**
 * What a machine is short of for a job naming no memory or platform, as the
 * bare command offers it and `runner` mends it on the person's yes: a fake
 * Apple-silicon Mac whose docker runs in a small vz Colima VM, and a small
 * Linux box.
 */

import { expect, test } from "vitest";
import { copyTextEn } from "../app/copy/catalog.ts";
import { setupAnswersAsked } from "../app/core/setupArguments.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import {
  machineScript,
  machineServing,
  machineSignedIn,
  machineSite,
} from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import {
  boxLoginSecret,
  boxMacLogin,
  boxMacMade,
  boxServing,
} from "./setupRunnerBox.ts";
import type { BoxColimaVm, BoxMac } from "./setupRunnerBox.ts";
import { setupSiteAt } from "./setupSite.ts";

const gib = 2 ** 30;
const runner = ["runner", "--workspace", "acme", "--project", "widgets"];
const pages = `${machineSite}/acme/widgets`;
const instead = `For a runner on another machine instead, that machine's own browser opens ${pages}/settings/workspace/runner, where you press Register runner and do what it shows.`;
const short =
  "Colima's VM here has 2 GiB, short of the 4 GiB a run naming no memory needs, and 1 GiB for the container engine beside it, and runs no amd64 images, which a run naming no platform needs.";

/** A small vz VM on Apple silicon, running, with no Rosetta asked or on. */
function vmSmall(): BoxColimaVm {
  return {
    running: true,
    vmType: "vz",
    vzRosetta: false,
    memoryBytes: 2 * gib,
    arch: "aarch64",
    rosettaOn: false,
  };
}

/** A Mac signed in to a site that lacks only the project's runner, chuggy-darwin installed, and its Colima as `mac` says. */
async function macOf(
  mac: Partial<Omit<BoxMac, "vm">> & { readonly vm: BoxColimaVm | undefined },
): Promise<SetupMachine> {
  const site = setupSiteAt("Configured");
  for (const project of site.projects) project.threads = "InCluster";
  const machine = await machineSignedIn(site, false);
  machine.platform = "darwin";
  machine.box.paths.set(boxMacLogin, boxLoginSecret);
  boxServing(machine.box, machineServing, "chuggy-darwin");
  boxMacMade(machine.box, {
    silicon: true,
    rosetta: true,
    memoryBytes: 16 * gib,
    ...mac,
  });
  return machine;
}

async function said(
  machine: SetupMachine,
  argv: readonly string[],
): Promise<{ readonly exit: number; readonly lines: readonly string[] }> {
  const report = await machine.command(argv);
  return {
    exit: setupReportExit(report),
    lines: setupReportLines(
      report,
      machineScript,
      copyTextEn,
      setupAnswersAsked(argv),
    ),
  };
}

/** What the bare command tells the person of the runner step. */
async function offered(machine: SetupMachine): Promise<string> {
  const { lines } = await said(machine, []);
  return lines.find((line) => line.includes("The next step is a runner")) ?? "";
}

function colimaRan(machine: SetupMachine): readonly string[] {
  return machine.box.ran
    .filter((command) => command[0] === "colima")
    .map((command) => command.join(" "));
}

test("a Mac with Rosetta whose VM is short of memory and amd64 is offered both, and the yes stops the VM, starts it with them, says what it has and registers", async () => {
  const machine = await macOf({ vm: vmSmall() });
  const offer = await offered(machine);
  expect(offer).toContain(
    `${short} With your yes I first stop it, which stops its containers, and start it again with 8 GiB and Rosetta: colima stop, then colima start --memory 8 --vz-rosetta. Tell me yes to go ahead. ${instead}`,
  );
  expect(colimaRan(machine)).toEqual([]);

  const { exit, lines } = await said(machine, runner);
  expect(exit).toBe(0);
  expect(colimaRan(machine)).toEqual([
    "colima stop",
    "colima start --memory 8 --vz-rosetta",
  ]);
  const acts = machine.box.acts;
  expect(acts.indexOf("colimaStop")).toBeLessThan(acts.indexOf("colimaStart"));
  expect(acts.indexOf("colimaStart")).toBeLessThan(acts.indexOf("register"));
  expect(lines).toEqual(
    expect.arrayContaining([
      "did: ran colima stop",
      "did: ran colima start --memory 8 --vz-rosetta",
      "found: Colima's VM has 8 GiB and runs amd64 images",
    ]),
  );
});

test("a Mac without Rosetta is told to install it first, with no restart offered and nothing run", async () => {
  const machine = await macOf({ rosetta: false, vm: vmSmall() });
  const offer = await offered(machine);
  expect(offer).toContain(
    "softwareupdate --install-rosetta --agree-to-license, which can ask for your password",
  );
  expect(offer).not.toContain("colima stop");
  const { exit, lines } = await said(machine, runner);
  expect(exit).toBe(0);
  expect(colimaRan(machine)).toEqual([]);
  expect(machine.box.acts).not.toContain("register");
  expect(lines.join("\n")).toContain("so nothing was changed on this machine");
});

test("a stopped VM, read from Colima's list and its profile's settings, is started with what it lacks and never stopped", async () => {
  const machine = await macOf({ vm: { ...vmSmall(), running: false } });
  expect(await offered(machine)).toContain(
    "With your yes I first start it with 8 GiB and Rosetta: colima start --memory 8 --vz-rosetta.",
  );
  const { exit } = await said(machine, runner);
  expect(exit).toBe(0);
  expect(colimaRan(machine)).toEqual(["colima start --memory 8 --vz-rosetta"]);
  expect(machine.box.acts).toContain("register");
});

test("a VM of 8 GiB that runs amd64 is offered no restart, and one whose memory is not said is restarted with no --memory", async () => {
  const roomy = await macOf({
    vm: {
      ...vmSmall(),
      memoryBytes: 8 * gib,
      vzRosetta: true,
      rosettaOn: true,
    },
  });
  expect(await offered(roomy)).not.toContain("Colima");
  await said(roomy, runner);
  expect(colimaRan(roomy)).toEqual([]);
  expect(roomy.box.acts).toContain("register");

  const unsaid = await macOf({ vm: { ...vmSmall(), memoryBytes: undefined } });
  const offer = await offered(unsaid);
  expect(offer).toContain("colima stop, then colima start --vz-rosetta.");
  expect(offer).not.toContain("--memory");
});

test("a QEMU VM is told it is made again with what that costs, and nothing is run", async () => {
  const machine = await macOf({ vm: { ...vmSmall(), vmType: "qemu" } });
  const offer = await offered(machine);
  expect(offer).toContain(
    "colima delete, which asks you a yes and removes the VM and its settings, then colima start --vm-type vz --vz-rosetta --memory 8.",
  );
  expect(offer).toContain(
    "Its images, containers and volumes stay on Colima's data disk, except for a VM made before Colima 0.9.0",
  );
  expect(offer).not.toContain("--data");
  await said(machine, runner);
  expect(colimaRan(machine)).toEqual([]);
  expect(machine.box.acts).not.toContain("register");
});

test("a Linux box of 3 GiB is told it cannot run a job naming no memory, and one with room is offered as before", async () => {
  const site = setupSiteAt("Configured");
  for (const project of site.projects) project.threads = "InCluster";
  const small = await machineSignedIn(site);
  small.box.memoryBytes = 3 * gib;
  expect(await offered(small)).toContain(
    "Here docker has 3 GiB, less than the 4 GiB a run naming no memory needs, and 1 GiB for the container engine beside it, so this machine has no room for such a run: run it on another machine.",
  );

  const roomy = await machineSignedIn(site);
  const offer = await offered(roomy);
  expect(offer).toContain("4 GiB a run. Tell me yes to go ahead.");
  expect(offer).not.toContain("no room");
});

test("a Mac with Colima and no VM is offered one made as vz with Rosetta and room for a job, which the yes makes before registering", async () => {
  const machine = await macOf({ vm: undefined });
  expect(await offered(machine)).toContain(
    "Colima has no VM here yet. With your yes I first make one with 8 GiB and Rosetta",
  );
  const { exit, lines } = await said(machine, runner);
  expect(exit).toBe(0);
  expect(colimaRan(machine)).toEqual([
    "colima start --vm-type vz --vz-rosetta --memory 8",
  ]);
  expect(lines).toContain("found: Colima's VM has 8 GiB and runs amd64 images");
  expect(machine.box.acts).toContain("register");
});
