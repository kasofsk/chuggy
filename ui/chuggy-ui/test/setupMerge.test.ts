/**
 * The first ticket's pull request merged by the setup program on the person's
 * yes: offered where the checklist is otherwise done and it stands unmerged on
 * a repository holding only the bootstrap, leaning by the folder's history,
 * merged through the one write the site's merge takes, and waited on until the
 * repository's own configuration is imported; and every refusal said in one
 * line with the pull request's link, after which setup still ends.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import { proposalMergeRefusals } from "../../../src/contract/rosters.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import {
  setupHistoryCommand,
  setupHistoryNewCommitsMax,
  setupMergeWrites,
} from "../app/core/setupMerge.ts";
import {
  setupNextStop,
  setupReportExit,
  setupReportLines,
} from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import { setupWritePorts } from "../app/core/setupRunner.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import {
  machineScript,
  machineServing,
  machineSignedIn,
  machineSite,
} from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import {
  setupSiteAt,
  setupSiteBootstrap,
  setupSiteOpened,
} from "./setupSite.ts";
import type { SetupSite, SetupSiteMerging } from "./setupSite.ts";
import { saidMoreCommand, saidMoreOffered } from "./setupSaid.ts";

const flags = ["--workspace", "acme", "--project", "widgets"];
const at = flags.join(" ");
const pullRequest = "https://github.com/acme-org/widgets/pull/2";
const mergePath =
  "/api/v1/tenants/acme/projects/widgets/tickets/1/proposal-merge";
const mergeSent = `POST ${machineSite}${mergePath}`;
const page = `${machineSite}/acme/widgets/tickets/new`;
const stop = `next: ${setupNextStop}`;

/** A site set up to a done first ticket whose pull request stands unmerged on a repository holding only the bootstrap, meeting a merge as `merging` says. */
function unmerged(merging?: SetupSiteMerging): SetupSite {
  const site = setupSiteBootstrap(setupSiteAt("Landed"));
  site.projects[0]?.landings.set(1, [setupSiteOpened(pullRequest)]);
  if (merging !== undefined) site.merging = merging;
  return site;
}

async function signedIn(
  site: SetupSite,
  history?: string,
): Promise<SetupMachine> {
  const machine = await machineSignedIn(site);
  machine.history = history;
  return machine;
}

function lines(report: SetupReport): readonly string[] {
  return setupReportLines(report, machineScript, copyTextEn, machineServing);
}

function told(said: readonly string[]): string | undefined {
  return said.find((line) => line.startsWith("tell: "));
}

function writes(machine: SetupMachine): readonly string[] {
  return machine.sent.filter((sent) => !sent.startsWith("GET "));
}

const offerTold = (lean: string): string =>
  `tell: Ticket 1 opened a pull request, ${pullRequest}, holding its work and this repository's own configuration; once it is merged, later tickets run on that configuration. Do you want me to merge it, or would you rather review it and merge it yourself?${lean} If you merge it yourself, setup is done now, and the configuration is in place once it is merged.`;
const leaning =
  " I would leave it to you: a repository with a history of its own often has rules an app cannot pass, such as a branch protection or a required review or check, and its owners may want to review the change first.";
/** Setup said to be done, with the offers after it unless the import the merge brought on is still under way. */
const doneTold = (configuration: string, offered = true): string => {
  const done = `chuggy is set up for acme/widgets: ticket 1 is done.${configuration} The next ticket is made at ${page}.`;
  return `tell: ${offered ? saidMoreOffered(done) : done}`;
};
const merged = `did: asked chuggy to merge ${pullRequest}, and it is merged`;

test("where the first ticket's pull request stands unmerged on the bootstrap, the checklist offers merge under one rule in place of setup done, and merges nothing", async () => {
  const machine = await signedIn(unmerged());
  const said = lines(await machine.command(flags));
  expect(told(said)).toBe(offerTold(""));
  expect(said.slice(-3)).toEqual([
    `rule: Run node ${machineScript} merge ${at} only once the person says yes to chuggy merging that pull request.`,
    `rule: Run ${saidMoreCommand(machineScript, "offer")} only if the person would rather merge it themselves.`,
    stop,
  ]);
  expect(writes(machine)).toEqual([]);
});

test("the offer leans towards leaving the merge to the person only past a new repository's history, asks git with the remote wait, and asks without leaning where git says nothing it can count", async () => {
  for (const [history, lean] of [
    [String(setupHistoryNewCommitsMax + 1), leaning],
    [String(setupHistoryNewCommitsMax), ""],
    ["1", ""],
    [undefined, ""],
    ["fatal: not a git repository", ""],
  ] as const) {
    const machine = await signedIn(unmerged(), history);
    expect(told(lines(await machine.command(flags))), history).toBe(
      offerTold(lean),
    );
    const asked = machine.ran.findIndex(
      (command) => command.join(" ") === setupHistoryCommand.join(" "),
    );
    expect(asked).toBeGreaterThanOrEqual(0);
    expect(machine.ranWaitMs[asked]).toBe(machine.pacing.remoteWaitMs);
  }
});

test("where nothing stands unmerged, git is not asked and setup done closes as it always has", async () => {
  const site = setupSiteBootstrap(setupSiteAt("Landed"));
  const machine = await signedIn(site);
  const said = lines(await machine.command(flags));
  expect(told(said)).toBe(doneTold(""));
  expect(said.at(-1)).toBe(stop);
  expect(
    machine.ran.some(
      (command) => command.join(" ") === setupHistoryCommand.join(" "),
    ),
  ).toBe(false);
});

test("merge on a yes merges the pull request once, waits on the import it brought on, and ends on setup done with the configuration in place", async () => {
  const site = unmerged({
    merging: "Merged",
    reads: 2,
    outcome: { result: "Imported" },
  });
  const machine = await signedIn(site);
  const report = await machine.command(["merge", ...flags]);
  const said = lines(report);
  expect(said[1]).toBe(merged);
  expect(told(said)).toBe(
    doneTold(
      " The repository's own configuration is in place, and later tickets run on it.",
    ),
  );
  expect(said.at(-1)).toBe(stop);
  expect(writes(machine)).toEqual([mergeSent]);
  expect(site.importing).toBeUndefined();
  expect(setupReportExit(report)).toBe(0);
});

test("a merge whose wait ends before the import says it is under way and names merge to run again, which merges nothing and waits on the same import", async () => {
  const site = unmerged({
    merging: "Merged",
    reads: Number.MAX_SAFE_INTEGER,
    outcome: { result: "Imported" },
  });
  const machine = await signedIn(site);
  const startedMs = machine.nowMs;
  const report = await machine.command(["merge", ...flags, "--wait-secs", "9"]);
  const said = lines(report);
  expect(machine.nowMs - startedMs).toBeGreaterThanOrEqual(9_000);
  expect(said[1]).toBe(merged);
  expect(said.slice(-3)).toEqual([
    doneTold(
      " chuggy is importing the repository's own configuration, and later tickets run on it once it is in place.",
      false,
    ),
    "rule: Run the command on the next: line again, and go on running it while chuggy imports the repository's own configuration: the pull request is merged already, so it merges nothing again and waits on the same import. Nothing has failed, so do not tell the person that it did or give them a deadline.",
    `next: node ${machineScript} merge ${at}`,
  ]);
  expect(setupReportExit(report)).toBe(0);

  if (site.importing !== undefined) site.importing.reads = 1;
  const again = lines(await machine.command(["merge", ...flags]));
  expect(again[1]).toBe(
    "found: nothing to merge: no pull request of the first ticket stands unmerged",
  );
  expect(told(again)).toBe(
    doneTold(
      " The repository's own configuration is in place, and later tickets run on it.",
    ),
  );
  expect(writes(machine)).toEqual([mergeSent]);
});

test("a merge whose import fails ends setup saying the configuration was not imported, and why", async () => {
  const machine = await signedIn(
    unmerged({
      merging: "Merged",
      reads: 1,
      outcome: { result: "SnapshotAbsent", absent: "ConfigurationDirectory" },
    }),
  );
  const said = lines(await machine.command(["merge", ...flags]));
  expect(said[1]).toBe(merged);
  expect(told(said)).toMatch(
    /^tell: chuggy is set up for acme\/widgets: ticket 1 is done\. chuggy did not import the repository's own configuration \(.+\), so later tickets run on the bootstrap until it does\. /u,
  );
  expect(said.at(-1)).toBe(stop);
});

test("a merge run again after its import failed ends setup saying the configuration was not imported, and merges nothing again", async () => {
  const site = unmerged({
    merging: "Merged",
    reads: Number.MAX_SAFE_INTEGER,
    outcome: { result: "SnapshotAbsent", absent: "ConfigurationDirectory" },
  });
  const machine = await signedIn(site);
  const first = lines(
    await machine.command(["merge", ...flags, "--wait-secs", "3"]),
  );
  expect(first.at(-1)).toBe(`next: node ${machineScript} merge ${at}`);

  if (site.importing !== undefined) site.importing.reads = 0;
  const startedMs = machine.nowMs;
  const report = await machine.command(["merge", ...flags]);
  const again = lines(report);
  expect(machine.nowMs - startedMs).toBeLessThan(
    machine.pacing.mergePollMs * 2,
  );
  expect(told(again)).toMatch(
    /^tell: chuggy is set up for acme\/widgets: ticket 1 is done\. chuggy did not import the repository's own configuration \(.+\), so later tickets run on the bootstrap until it does\. /u,
  );
  expect(again.at(-1)).toBe(stop);
  expect(writes(machine)).toEqual([mergeSent]);
});

test("every refusal of the merge is one line in the person's words with the pull request's link, and setup still ends", async () => {
  for (const merging of [
    ...proposalMergeRefusals.map((refused): SetupSiteMerging => ({
      merging: "Refused",
      refused,
    })),
    { merging: "Forbidden" } as const,
  ]) {
    const machine = await signedIn(unmerged(merging));
    const report = await machine.command(["merge", ...flags]);
    const said = lines(report);
    const linked = said.filter((line) => line.includes(pullRequest));
    expect(linked, JSON.stringify(merging)).toHaveLength(1);
    expect(linked[0]).toMatch(
      new RegExp(
        `^found: chuggy did not merge ${pullRequest}: .+; merge it on GitHub your own way$`,
        "u",
      ),
    );
    expect(told(said)).toBe(doneTold(""));
    expect(said.at(-1)).toBe(stop);
    expect(writes(machine)).toEqual([mergeSent]);
    expect(setupReportExit(report)).toBe(0);
  }
});

test("merge where nothing stands unmerged writes nothing and says so", async () => {
  const machine = await signedIn(setupSiteBootstrap(setupSiteAt("Landed")));
  const said = lines(await machine.command(["merge", ...flags]));
  expect(said[1]).toBe(
    "found: nothing to merge: no pull request of the first ticket stands unmerged",
  );
  expect(writes(machine)).toEqual([]);
});

test("merge's ports let out the merge of the one ticket's pull request and any read, and refuse every other write having reached nothing", async () => {
  const reached: string[] = [];
  const api: ApiPorts = {
    fetch: (url, init) => {
      reached.push(`${init.method} ${url}`);
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
    bearer: () => Promise.resolve("the session's own"),
    sleepMs: () => Promise.resolve(),
  };
  const ports = setupWritePorts(
    api,
    "the run's",
    { asked: false },
    setupMergeWrites({ tenant: "acme", project: "widgets" }, 1),
  );
  const init = (method: string) => ({
    method,
    headers: {},
    signal: new AbortController().signal,
  });
  await ports.fetch(mergePath, init("POST"));
  await ports.fetch("/api/v1/projects", init("GET"));
  for (const [method, url] of [
    ["POST", mergePath.replace("/tickets/1/", "/tickets/2/")],
    ["POST", `${mergePath}/`],
    ["PUT", mergePath],
    ["DELETE", mergePath],
    ["POST", "/api/v1/tenants/acme/projects/widgets/repositories"],
    ["POST", "/api/v1/tenants/acme/projects/widgets/drafts"],
  ] as const)
    await expect(
      ports.fetch(url, init(method)),
      `${method} ${url}`,
    ).rejects.toThrow("the checklist sends nothing but reads");
  expect(reached).toEqual([`POST ${mergePath}`, "GET /api/v1/projects"]);
});
