/**
 * The repository's own configuration, from the checkout the setup program is
 * run in: `configuration` writing a starting one, `check` judging what is
 * there as an import would, and `import` having the site import it.
 *
 * The site here imports what was pushed to the repository with the
 * contract's own judgment, so a tree `check` passes and the site takes is one
 * judgment met twice, and the whole flow is driven as the person's agent
 * drives it: from the checklist that names `configuration`, through filling
 * in and checking, to the checklist read after the import.
 */

import { expect, test } from "vitest";

import { repositoryConfigurationRoot } from "../../../src/contract/configurationDocument.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { setupAnswersNone } from "../app/core/setupArguments.ts";
import {
  setupConfigurationPath,
  setupConfigurationStarting,
  setupDeclarationDepthMax,
} from "../app/core/setupConfiguration.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import {
  machineScript,
  machineServing,
  machineSignedIn,
  setupMachine,
} from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import { boxFolder } from "./setupRunnerBox.ts";
import { setupSiteAt, setupSiteRepositoryAddress } from "./setupSite.ts";

const top = boxFolder;
const written = `${top}/${setupConfigurationPath}`;
const flags = ["--workspace", "acme", "--project", "widgets"];
const at = flags.join(" ");

/** A machine signed in to a site whose repository is added and holds no configuration, the folder being the top of its checkout. */
async function unconfigured(): Promise<SetupMachine> {
  const machine = await machineSignedIn(setupSiteAt("Added"));
  machine.top = top;
  return machine;
}

/** A machine signed in to nothing, the folder being the top of a checkout holding `files`, by path from its top. */
function checkout(files: Readonly<Record<string, string>>): SetupMachine {
  const machine = setupMachine();
  machine.top = top;
  for (const [path, text] of Object.entries(files))
    machine.box.paths.set(`${top}/${path}`, text);
  return machine;
}

function lines(report: SetupReport): readonly string[] {
  return setupReportLines(report, machineScript, copyTextEn, machineServing);
}

/** A report as a run given no workspace or project prints it. */
function bare(report: SetupReport): readonly string[] {
  return setupReportLines(report, machineScript, copyTextEn, setupAnswersNone);
}

/** The starting configuration as written, with `image` filled in. */
function filled(test: string | undefined, image = "node:22"): string {
  const envelope = JSON.parse(setupConfigurationStarting(test).text) as {
    configuration: Record<string, unknown>;
  };
  envelope.configuration["image"] = image;
  return JSON.stringify(envelope, undefined, 2);
}

/** Pushes the checkout's `.chug/` to the default branch of the repository, as the agent's commit and push does. */
function pushed(machine: SetupMachine): void {
  const tree = new Map<string, string>();
  for (const [path, text] of machine.box.paths)
    if (path.startsWith(`${top}/.chug/`) && text !== undefined)
      tree.set(path.slice(top.length + 1), text);
  machine.world.pushed.set(setupSiteRepositoryAddress, tree);
}

test("with no configuration the checklist names configuration for the project, with the test command where the agent knows it, and nothing to press", async () => {
  const machine = await unconfigured();
  const said = lines(await machine.command(flags));
  expect(said.join("\n")).not.toMatch(/Retry/u);
  expect(said.at(-2)).toBe(
    `rule: Run node ${machineScript} configuration ${at} --test with the command that tests this repository after it, quoted as one word, where you know that command, and node ${machineScript} configuration ${at} where you do not.`,
  );
});

test("a bound repository with no configuration is configured end to end: written, refused by field, filled in, checked clean, pushed and imported, and the checklist moves on", async () => {
  const machine = await unconfigured();

  const wrote = await machine.command([
    "configuration",
    ...flags,
    "--test",
    "npm test",
  ]);
  expect(lines(wrote).slice(0, 2)).toEqual([
    `did: wrote ${setupConfigurationPath}, a starting configuration for this repository`,
    "tell: configuration.image is left blank: the container image every step of it uses, which holds what this repository needs to build and test",
  ]);
  expect(machine.box.paths.get(written)).toBe(
    setupConfigurationStarting("npm test").text,
  );
  expect(machine.sent).toEqual([]);

  const blank = await machine.command(["check", ...flags]);
  expect(lines(blank)[0]).toBe(
    `found: ${setupConfigurationPath}: Configuration invalid (ReleaseShapeInvalid) at configuration.image`,
  );
  expect(setupReportExit(blank)).toBe(1);

  machine.box.paths.set(written, filled("npm test"));
  const clean = await machine.command(["check", ...flags]);
  expect(lines(clean)).toEqual([
    `found: ${setupConfigurationPath} imports as it stands`,
    "tell: The configuration is ready. I commit it, with every file it names under .chug/, and push it to the default branch, then have chuggy import it.",
    `rule: Run node ${machineScript} import ${at} only once the commit holding it is pushed to the default branch.`,
    "next: stop",
  ]);

  const early = lines(await machine.command(["import", ...flags]));
  expect(early[1]).toBe(
    `found: chuggy did not import ${setupSiteRepositoryAddress}: Undeclared`,
  );
  expect(early.join("\n")).toContain("(its last import: Undeclared)");

  pushed(machine);
  machine.sent.length = 0;
  const done = await machine.command(["import", ...flags]);
  expect(machine.sent.filter((sent) => !sent.startsWith("GET "))).toEqual([
    `POST ${machineServing.site}/api/v1/tenants/acme/projects/widgets/configurations/imports`,
  ]);
  const said = lines(done);
  expect(said[1]).toBe(
    `did: asked chuggy to import ${setupSiteRepositoryAddress}`,
  );
  expect(said.join("\n")).not.toContain("configuration of its own");
  expect(done).toMatchObject({
    checklist: { next: { thing: { thing: "Offer", command: "Runner" } } },
  });
});

test("an import the site refuses says each file it refused from the site's answer, and the checklist says the last import as the repositories page does", async () => {
  const machine = await unconfigured();
  await machine.command(["configuration", ...flags]);
  pushed(machine);
  const said = lines(await machine.command(["import", ...flags]));
  expect(said.slice(1, 3)).toEqual([
    `found: chuggy did not import ${setupSiteRepositoryAddress}: Invalid`,
    `found: ${setupConfigurationPath}: Configuration invalid (ReleaseShapeInvalid)`,
  ]);
  expect(said.join("\n")).toContain(
    `(its last import: Invalid, ${setupConfigurationPath}`,
  );
});

test("import asks nothing of the site where the configuration is not the next thing, and says so", async () => {
  const machine = await machineSignedIn(setupSiteAt("Configured"));
  const report = await machine.command(["import", ...flags]);
  expect(lines(report)[1]).toBe(
    "found: nothing to import: the next thing is not the configuration of a repository",
  );
  expect(machine.sent.filter((sent) => !sent.startsWith("GET "))).toEqual([]);
});

test("configuration with no test command leaves the check's commands blank too, and check names both fields", async () => {
  const machine = checkout({});
  const report = await machine.command(["configuration"]);
  expect(report).toMatchObject({
    ended: {
      ended: "Written",
      blanks: [
        { blank: "Image", field: "configuration.image" },
        { blank: "Test", field: "configuration.workloads.checks.commands" },
      ],
    },
  });
  expect(bare(await machine.command(["check"]))[0]).toBe(
    `found: ${setupConfigurationPath}: Configuration invalid (ReleaseShapeInvalid) at configuration.image, configuration.workloads.checks.commands`,
  );
});

test("configuration never writes over a configuration already declared, anywhere under the directory, and leaves it as it was", async () => {
  for (const path of [
    setupConfigurationPath,
    `${repositoryConfigurationRoot}nested/other.json`,
  ]) {
    const machine = checkout({ [path]: "held" });
    const before = new Map(machine.box.paths);
    const report = await machine.command(["configuration", "--test", "make"]);
    expect(bare(report), path).toEqual([
      `found: this checkout already declares ${path}, which is left as it is`,
      `next: node ${machineScript} check`,
    ]);
    expect(machine.box.paths.get(`${top}/${path}`)).toBe("held");
    expect(machine.box.paths, path).toEqual(before);
  }
});

test("a directory past the listing's depth bound is refused by check and kept by configuration, as the import refuses any file below it", async () => {
  const levels = Array.from({ length: setupDeclarationDepthMax + 1 }, (_, at) =>
    String.fromCharCode(97 + at),
  );
  const unlisted = `${repositoryConfigurationRoot}${levels.join("/")}/`;
  const files = {
    [setupConfigurationPath]: filled("make"),
    [`${unlisted}x.json`]: "held",
  };
  expect(bare(await checkout(files).command(["check"]))[0]).toBe(
    `found: ${unlisted}: Path not allowed`,
  );
  const deep = checkout({ [`${unlisted}x.json`]: "held" });
  const before = new Map(deep.box.paths);
  expect(bare(await deep.command(["configuration", "--test", "make"]))[0]).toBe(
    `found: this checkout already declares ${unlisted}, which is left as it is`,
  );
  expect(deep.box.paths).toEqual(before);
});

test("outside a checkout neither configuration nor check reads or writes anything, and each is a stop", async () => {
  for (const command of ["configuration", "check"]) {
    const machine = checkout({});
    machine.top = undefined;
    const before = new Map(machine.box.paths);
    const report = await machine.command([command]);
    expect(bare(report)[0], command).toBe(
      "found: this folder is in no git checkout",
    );
    expect(setupReportExit(report), command).toBe(1);
    expect(machine.box.paths, command).toEqual(before);
    expect(machine.box.read, command).toEqual([]);
  }
});

/** A prompt a case's catalog names, beside the declarations, which a file not ending `.json` is not one of. */
const prompt = `${repositoryConfigurationRoot}prompts/build.md`;

const prompted = (path: string) => {
  const envelope = JSON.parse(filled("make")) as {
    configuration: { workloads: { build: { prompt: unknown } } };
  };
  envelope.configuration.workloads.build.prompt = { path };
  return JSON.stringify(envelope);
};

test("check judges a tree as the import does: each file it refuses by its path and fault, and what the catalogs name read from the checkout", async () => {
  const root = repositoryConfigurationRoot;
  const cases: readonly [
    Readonly<Record<string, string>>,
    readonly string[],
  ][] = [
    [{ [`${root}a.json`]: "{" }, [`found: ${root}a.json: Not JSON`]],
    [
      {
        [`${root}a.json`]: filled("make"),
        [`${root}b.json`]: filled("make"),
      },
      [`found: ${root}b.json: Name declared twice at name`],
    ],
    [
      { [`${root}a.json`]: prompted(prompt) },
      [`found: ${root}a.json: Missing ${prompt}`],
    ],
  ];
  for (const [files, faults] of cases) {
    const said = bare(await checkout(files).command(["check"]));
    expect(said.slice(0, faults.length), JSON.stringify(files)).toEqual(faults);
    expect(said[faults.length]).toMatch(/^tell: chuggy's import would refuse/u);
  }
  const named = checkout({
    [`${root}a.json`]: prompted(prompt),
    [prompt]: "Build it.",
  });
  expect(bare(await named.command(["check"]))[0]).toBe(
    `found: ${root}a.json imports as it stands`,
  );
});

test("check refuses a declaration that is a link as the import does, and names configuration where nothing is declared", async () => {
  const linked = checkout({ [setupConfigurationPath]: filled("make") });
  linked.box.links.add(written);
  expect(bare(await linked.command(["check"]))[0]).toBe(
    `found: ${setupConfigurationPath}: Symlink`,
  );
  const empty = await checkout({}).command(["check"]);
  expect(bare(empty)[0]).toBe(
    `found: this checkout declares no configuration under ${repositoryConfigurationRoot}`,
  );
  expect(setupReportExit(empty)).toBe(0);
});
