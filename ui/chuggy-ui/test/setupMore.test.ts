/**
 * What setup offers once its last step is done: more runners, the person's
 * own configuration and image, and where else chuggy is set, offered together
 * once the first ticket is done and its merge settled, by chuggy or by the
 * person, and on every bare run after; each taken through `--more`, and none
 * of them a step.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import { chuggyDocsIndex } from "../../../src/contract/sessionTools.ts";
import { setupAsked } from "../app/core/setupArguments.ts";
import {
  setupConfigurationPath,
  setupConfigurationStarting,
} from "../app/core/setupConfiguration.ts";
import { setupDocsPages } from "../app/core/setupNext.ts";
import { setupNextStop, setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import {
  machineScript,
  machineServing,
  machineSignedIn,
  machineSite,
} from "./setupMachine.ts";
import { boxFolder } from "./setupRunnerBox.ts";
import { saidMoreCommand, saidMoreOffered, saidMoreRule } from "./setupSaid.ts";
import {
  setupSiteAt,
  setupSiteBootstrap,
  setupSiteOpened,
} from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";

const flags = ["--workspace", "acme", "--project", "widgets"];
const pullRequest = "https://github.com/acme-org/widgets/pull/2";
const pages = `${machineSite}/acme/widgets`;
const stop = `next: ${setupNextStop}`;
const done = `chuggy is set up for acme/widgets: ticket 1 is done.`;
const next = `The next ticket is made at ${pages}/tickets/new.`;

function lines(report: SetupReport): readonly string[] {
  return setupReportLines(report, machineScript, copyTextEn, machineServing);
}

/** A site set up to a done first ticket, its pull request standing unmerged on a repository holding only the bootstrap. */
function unmerged(): SetupSite {
  const site = setupSiteBootstrap(setupSiteAt("Landed"));
  site.projects[0]?.landings.set(1, [setupSiteOpened(pullRequest)]);
  return site;
}

/** What a run prints after its steps, and its steps. */
async function ran(
  site: SetupSite,
  argv: readonly string[],
): Promise<{
  readonly steps: readonly string[];
  readonly after: readonly string[];
  readonly writes: readonly string[];
}> {
  const machine = await machineSignedIn(site);
  const said = lines(await machine.command(argv));
  return {
    steps: said.filter((line) => line.startsWith("step: ")),
    after: said.filter(
      (line) => !line.startsWith("step: ") && !line.startsWith("site: "),
    ),
    writes: machine.sent.filter((sent) => !sent.startsWith("GET ")),
  };
}

/** A starting configuration as written, with its image filled in. */
function filled(text: string): string {
  const envelope = JSON.parse(text) as {
    configuration: Record<string, unknown>;
  };
  envelope.configuration["image"] = "node:22";
  return JSON.stringify(envelope, undefined, 2);
}

/** The bare command for acme/widgets taking `more`. */
const more = (taken: string): readonly string[] => [...flags, "--more", taken];

/** The rule each taken offer ends on, naming the other two and the one taken by the bare command. */
const moreNext = `rule: Once that is done, run ${saidMoreCommand(machineScript, "runners")} where the person also wanted more runners, ${saidMoreCommand(machineScript, "configuration")} where they also wanted their configuration different, and ${saidMoreCommand(machineScript, "review")} where they also wanted to see what else they can set, each that has not been run yet, one at a time; where none is left, setup is done and nothing more is run.`;

test("once chuggy has merged the first ticket's pull request on the person's yes and its configuration is imported, setup is said to be done with all three offered, each under the bare command taking it", async () => {
  const site = unmerged();
  site.merging = {
    merging: "Merged",
    reads: 1,
    outcome: { result: "Imported" },
  };
  const { after } = await ran(site, ["merge", ...flags]);
  expect(after.slice(-3)).toEqual([
    `tell: ${saidMoreOffered(`${done} The repository's own configuration is in place, and later tickets run on it. ${next}`)}`,
    saidMoreRule(machineScript),
    stop,
  ]);
});

test("where the person merges the first ticket's pull request themselves, the merge offer names the bare command that takes their no, and that run offers all three, saying the configuration is in place once they merge it, and merges nothing", async () => {
  const offered = await ran(unmerged(), flags);
  expect(offered.after).toContain(
    `rule: Run ${saidMoreCommand(machineScript, "offer")} only if the person would rather merge it themselves.`,
  );
  const settled = await ran(unmerged(), more("offer"));
  expect(settled.after).toEqual([
    `tell: ${saidMoreOffered(`${done} The repository's own configuration is in place once you merge ${pullRequest}, and later tickets run on it then. ${next}`)}`,
    saidMoreRule(machineScript),
    stop,
  ]);
  expect(settled.writes).toEqual([]);
});

test("a later bare run where every step is done gives the same offer, and nothing that says there is nothing to do", async () => {
  for (const argv of [[], flags]) {
    const { after } = await ran(setupSiteAt("Landed"), argv);
    expect(after).toEqual([
      `tell: ${saidMoreOffered(`${done} ${next}`)}`,
      saidMoreRule(machineScript),
      stop,
    ]);
  }
});

test("more runners gives the line the Register runner panel gives, for another machine, and has nothing run here", async () => {
  const { after } = await ran(setupSiteAt("Landed"), more("runners"));
  const line = `Make this machine my chuggy runner: run "curl -fsS ${machineSite}/chuggy-setup.mjs -o ~/.chuggy-setup.mjs && node ~/.chuggy-setup.mjs runner --site ${machineSite} --workspace acme --project widgets" and do what its output says.`;
  expect(after).toEqual([
    `tell: To add a runner on another machine, paste this into Claude Code on that machine: ${line} It makes that machine one of your personal runners for this project. ${setupDocsPages.runners} says more about runners.`,
    "rule: Give the person that line as it is, for the other machine, and run nothing here for it.",
    moreNext,
    stop,
  ]);
});

test("their own configuration asks what they want different, and its rule names configuration, check and the docs page for the project's image", async () => {
  const { after } = await ran(setupSiteAt("Landed"), more("configuration"));
  expect(after).toEqual([
    "tell: Your repository's configuration is under .chug/configurations/. What would you like different: the image your tickets run in, the checks they run, or the model?",
    `rule: Read each file under .chug/configurations/ in this checkout, ask the person what they want different, and change it with them; where the checkout holds none there, pull its default branch, and where that brings none either, run node ${machineScript} configuration --workspace acme --project widgets to write a starting one. Where they want an image of their own, read ${setupDocsPages.image} first for what an image needs and how a configuration names it. Then run node ${machineScript} check --workspace acme --project widgets, fix each fault it names, and commit and push the change to the default branch. Do not run node ${machineScript} import --workspace acme --project widgets, though node ${machineScript} check --workspace acme --project widgets names it once clean: with every step done it has nothing to import. Tell the person chuggy imports the push at its next import, or at once where Import now is pressed on the repository's page, from ${pages}/repositories.`,
    moreNext,
    stop,
  ]);
  expect(setupDocsPages.image).toBe(
    "https://raw.githubusercontent.com/kasofsk/chuggy-docs/main/docs/jobs/image.md",
  );
});

test("while the person has yet to merge the first ticket's pull request themselves, their own configuration has nothing changed or written until it is merged, and names the bare command that takes it then", async () => {
  const { after, writes } = await ran(unmerged(), more("configuration"));
  expect(after).toEqual([
    `tell: Your repository's configuration is in ${pullRequest}, which is not merged yet. Once you have merged it, ask for this again and it is changed with you then.`,
    `rule: Change nothing under .chug/configurations/ and run nothing for it now: the default branch holds no configuration until the person merges ${pullRequest}. Once they say they have merged it, run ${saidMoreCommand(machineScript, "configuration")}.`,
    moreNext,
    stop,
  ]);
  expect(after.join("\n")).not.toContain(" configuration --workspace");
  expect(writes).toEqual([]);
});

test("followed through check, the configuration offer stops at the push: check's clean result names import, which with every step done has nothing to import and gives the offer again, so the offer's rule says not to run it", async () => {
  const machine = await machineSignedIn(setupSiteAt("Landed"));
  machine.top = boxFolder;
  const rule = lines(await machine.command(more("configuration"))).find(
    (line) => line.startsWith("rule: Read each file"),
  );
  const importing = `node ${machineScript} import ${flags.join(" ")}`;
  expect(rule).toContain(`Do not run ${importing}`);

  machine.box.paths.set(
    `${boxFolder}/${setupConfigurationPath}`,
    filled(setupConfigurationStarting("npm test").text),
  );
  const checked = lines(await machine.command(["check", ...flags]));
  expect(checked[0]).toBe(
    `found: ${setupConfigurationPath} imports as it stands`,
  );
  expect(checked).toContain(
    `rule: Run ${importing} only once the commit holding it is pushed to the default branch.`,
  );

  machine.sent.length = 0;
  const imported = lines(await machine.command(["import", ...flags]));
  expect(imported).toContain(
    "found: nothing to import: the next thing is not the configuration of a repository",
  );
  expect(imported.at(-3)).toMatch(
    /^tell: .* A few more things you might want: /u,
  );
  expect(machine.sent.filter((sent) => !sent.startsWith("GET "))).toEqual([]);
});

test("the review lists what else can be set, each with its address, and asks nothing", async () => {
  const { after } = await ran(setupSiteAt("Landed"), more("review"));
  const [tell, ...rest] = after;
  expect(rest).toEqual([moreNext, stop]);
  const items = (tell ?? "")
    .replace(/^tell: What else you can set, and where: /u, "")
    .replace(/\.$/u, "")
    .split("; ");
  expect(items).toEqual([
    `who may dispatch tickets, at ${pages}/settings/permissions`,
    `where work is placed, at ${pages}/settings/placement`,
    `the usage thresholds chuggy pauses your work at, at ${pages}/settings/workspace/usage`,
    `the repository's configuration under .chug/configurations/, with its image, workloads, plans and finalizers, at ${setupDocsPages.configuration}`,
    `sizing a stage, at ${setupDocsPages.sizing}`,
    "and your runner's own settings file on a machine that runs one, chuggy-linux's runner.json, at https://github.com/kasofsk/chuggy-linux#configure",
  ]);
  expect(tell).not.toContain("?");
});

test("none says in one sentence how to be offered them again, and setup ends", async () => {
  const { after } = await ran(setupSiteAt("Landed"), more("none"));
  expect(after).toEqual([
    `tell: Setup is done; whenever you want any of these later, paste the line you set chuggy up with into Claude Code again: Set up chuggy for the repository in this folder: run "curl -fsS ${machineSite}/chuggy-setup.mjs -o ~/.chuggy-setup.mjs && node ~/.chuggy-setup.mjs --site ${machineSite}" and do what its output says.`,
    stop,
  ]);
});

test("the checklist's steps are the same whichever offer is taken, so none of them is a step, and none names a North Star", async () => {
  const bare = await ran(setupSiteAt("Landed"), flags);
  for (const taken of ["offer", "runners", "configuration", "review", "none"]) {
    const { steps, after } = await ran(setupSiteAt("Landed"), more(taken));
    expect(steps, taken).toEqual(bare.steps);
    expect(after.join("\n"), taken).not.toMatch(/north.?star/iu);
  }
  expect(bare.steps.map((line) => line.split(/ +/u)[1])).toEqual([
    "plugin",
    "workspace",
    "project",
    "mcp",
    "github",
    "repository",
    "runner",
    "ticket",
  ]);
});

test("a step not done is what is next whatever offer is taken", async () => {
  const { after } = await ran(setupSiteAt("Live"), more("review"));
  expect(after.join("\n")).not.toContain("What else you can set");
});

test("every docs page the offers name is a page of the docs the index sits beside", () => {
  const root = new URL(".", chuggyDocsIndex).href;
  for (const page of Object.values(setupDocsPages))
    expect(new URL(page).href.startsWith(root), page).toBe(true);
});

test("--more is read only by the bare command, and only as one of the offers", () => {
  expect(setupAsked(["--more", "review"])).toMatchObject({
    asked: "Status",
    answers: { more: "review" },
  });
  expect(setupAsked(["--more", "everything"])).toEqual({
    asked: "Wrongly",
    fault: "More",
  });
  expect(setupAsked(["watch", "--more", "review"])).toEqual({
    asked: "Wrongly",
    fault: "Flag",
  });
});
