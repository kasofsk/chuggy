/**
 * A site that refuses the person until they agree to its policies: whichever
 * request of a run it refuses so, the run says the one stop that sends the
 * person to the site to agree, after what `runner` and `chat-host` had found
 * and done, sends nothing after it, and asks nothing of the agreement plane.
 * A 403 that carries another code, or none, is a refusal like any other.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import { setupAnswersAsked } from "../app/core/setupArguments.ts";
import { setupBindWrites } from "../app/core/setupBind.ts";
import { setupImportWrites } from "../app/core/setupConfiguration.ts";
import { setupMergeWrites } from "../app/core/setupMerge.ts";
import { setupProjectWrites } from "../app/core/setupProject.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import {
  setupChatHostWrites,
  setupRunnerWrites,
  setupServeWrites,
} from "../app/core/setupRunner.ts";
import { setupCommandLine } from "../app/core/setupText.ts";
import { setupTicketWrites } from "../app/core/setupTicket.ts";
import { setupUsageWrites } from "../app/core/setupUsage.ts";
import {
  machineScript,
  machineSignedIn,
  machineSite,
  machineUnagreed,
  machineWrites,
} from "./setupMachine.ts";
import type { MachineRefusal, SetupMachine } from "./setupMachine.ts";
import { boxFolder } from "./setupRunnerBox.ts";
import {
  setupSiteAccount,
  setupSiteAt,
  setupSiteBootstrap,
  setupSiteClaude,
  setupSiteOpened,
  setupSiteRepositoryAddress,
} from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";

const partition = { tenant: "acme", project: "widgets" };
const flags = ["--workspace", "acme", "--project", "widgets"];
const runner = ["runner", ...flags, "--chat-host", "yes"];
const chatHost = ["chat-host", "--workspace", "acme"];
const project = ["project", "--workspace", "acme", "--name", "Atlas Web"];
const usage = ["usage", ...flags, "--five-hour-percent", "90"];
const ticket = [
  "ticket",
  ...flags,
  "--image",
  "ghcr.io/acme-org/widgets-ci:1",
  "--toolchains",
  "Node",
];

/** Every request of the API a run sent, by method and path, but those the access plane answers. */
function apiSent(machine: SetupMachine): readonly string[] {
  return machine.sent
    .map((sent) => sent.replace(machineSite, ""))
    .filter((sent) => !sent.includes(" /access/v1/"));
}

/** Has the API refuse each request `from` picks, and every one after the first, as the person's agreement waited on; answers each it refused. */
function refusing(
  machine: SetupMachine,
  from: (sent: string) => boolean,
  refusal: MachineRefusal = machineUnagreed,
): readonly string[] {
  const refused: string[] = [];
  machine.refuses = (sent) => {
    if (refused.length === 0 && !from(sent)) return undefined;
    refused.push(sent);
    return refusal;
  };
  return refused;
}

/** The stop a run the site asked the person's agreement of ends on, naming `again` to run once they say they have agreed. */
function unagreedLines(again: readonly string[]): readonly string[] {
  const command = setupCommandLine([
    "node",
    machineScript,
    ...again,
    "--site",
    machineSite,
  ]);
  return [
    `site: ${machineSite}, needs your agreement`,
    "found: the site asks for your agreement to its policies before it answers",
    `tell: The chuggy site asks you to agree to its policies before chuggy setup can go on. Open ${machineSite} in your browser, sign in and agree there, and tell me once you have.`,
    "rule: Until then, run no other chuggy setup command. Agreeing is the person's alone: do not open the site for them and do not agree on their behalf.",
    `rule: Run ${command} only once the person says they have agreed.`,
    "next: stop",
  ];
}

/**
 * That a run ended on the stop, and only it: after what it had found and
 * done where it is `runner` or `chat-host`, exiting 0, with the site's own
 * message nowhere, no step said, no project offered, one request refused and
 * none sent after it, and nothing asked of the agreement plane.
 */
function heldTo(
  machine: SetupMachine,
  report: SetupReport,
  argv: readonly string[],
  again: readonly string[],
  refused: readonly string[],
): readonly string[] {
  const said = setupReportLines(
    report,
    machineScript,
    copyTextEn,
    setupAnswersAsked(argv),
  );
  const ended = report.report === "RunnerOut" ? report.out : report;
  expect(ended).toMatchObject({ report: "Unagreed", site: machineSite });
  expect(said.slice(-6)).toEqual(unagreedLines(again));
  expect(said.join("\n")).not.toMatch(
    /machine-unagreed-message|not shown|^step: |^ask: |create/imu,
  );
  expect(setupReportExit(report)).toBe(0);
  expect(refused).toHaveLength(1);
  expect(apiSent(machine).at(-1)).toBe(refused[0]);
  expect(
    machine.asked.filter((asked) => asked.includes("/agreements/")),
  ).toEqual([]);
  return said;
}

const runFirst = () => true;

test.each([
  ["a bare run", [], [] as readonly string[]],
  ["a run naming a workspace and a project", flags, flags],
])(
  "%s whose first request of the API the site refuses until the person agrees says the stop that sends them to agree, with the site's address, naming itself again, and exits 0",
  async (_run, argv, again) => {
    const machine = await machineSignedIn();
    const refused = refusing(machine, runFirst);
    const report = await machine.command(argv);
    expect(heldTo(machine, report, argv, again, refused)).toEqual(
      unagreedLines(again),
    );
    expect(apiSent(machine)).toHaveLength(1);
  },
);

/** A machine signed in to a site set up as far as `stage`, as each command's own suite meets it. */
function signedIn(
  world: SetupSite,
  served = true,
): () => Promise<SetupMachine> {
  return () => machineSignedIn(world, served);
}

test.each([
  ["project", project, project, signedIn(setupSiteAt("Workspace"))],
  ["usage", usage, flags, signedIn(setupSiteClaude(setupSiteAt("Live"), {}))],
  ["runner", runner, runner, signedIn(setupSiteAt("Configured"))],
  ["chat-host", chatHost, chatHost, signedIn(setupSiteAt("Configured"), false)],
])(
  "%s whose first request the site refuses until the person agrees ends on that stop, having touched nothing on the machine",
  async (_command, argv, again, made) => {
    const machine = await made();
    const paths = new Map(machine.box.paths);
    const refused = refusing(machine, runFirst);
    heldTo(machine, await machine.command(argv), argv, again, refused);
    expect(apiSent(machine)).toHaveLength(1);
    expect(machine.box.acts).toEqual([]);
    expect(machine.box.paths).toEqual(paths);
  },
);

/** A site whose first ticket's pull request stands unmerged on the bootstrap, and merges into an import. */
function unmerged(): SetupSite {
  const site = setupSiteBootstrap(setupSiteAt("Landed"));
  site.projects[0]?.landings.set(1, [
    setupSiteOpened("https://github.com/acme-org/widgets/pull/2"),
  ]);
  site.merging = {
    merging: "Merged",
    reads: 2,
    outcome: { result: "Imported" },
  };
  return site;
}

/** A site whose apps are both installed, granted the folder's repository or not. */
function connected(granted: boolean): SetupSite {
  const site = setupSiteAt("Apps");
  site.grants.set(`${setupSiteAccount}-portal`, [setupSiteRepositoryAddress]);
  site.grants.set(
    `${setupSiteAccount}-worker`,
    granted ? [setupSiteRepositoryAddress] : [],
  );
  return site;
}

/** A machine whose folder is the checkout of the project's repository. */
function inFolder(world: SetupSite): () => Promise<SetupMachine> {
  return async () => {
    const machine = await machineSignedIn(world);
    machine.remote = "git@github.com:acme-org/widgets.git";
    machine.top = boxFolder;
    return machine;
  };
}

/** A personal runner of the person's, live and not given the project, whose chats run on the cluster. */
function serving(): SetupSite {
  const site = setupSiteAt("Configured");
  const [held] = site.projects;
  if (held !== undefined) held.threads = "InCluster";
  site.personal.set("acme", { live: [true], projects: [] });
  return site;
}

/** Each command that writes: how it is run, what it names again, the machine it writes on, and its writes. */
const writing: readonly (readonly [
  string,
  readonly string[],
  readonly string[],
  () => Promise<SetupMachine>,
  readonly string[],
])[] = [
  [
    "project",
    project,
    project,
    signedIn(setupSiteAt("Workspace")),
    setupProjectWrites,
  ],
  [
    "import",
    ["import", ...flags],
    ["import", ...flags],
    inFolder(setupSiteAt("Added")),
    setupImportWrites(partition),
  ],
  [
    "bind",
    ["bind", ...flags],
    ["bind", ...flags],
    inFolder(connected(true)),
    setupBindWrites(partition),
  ],
  [
    "merge",
    ["merge", ...flags],
    ["merge", ...flags],
    signedIn(unmerged()),
    setupMergeWrites(partition, 1),
  ],
  [
    "serve",
    ["serve", ...flags],
    ["serve", ...flags],
    signedIn(serving()),
    setupServeWrites({ partition }),
  ],
  [
    "ticket",
    ticket,
    flags,
    signedIn(setupSiteBootstrap(setupSiteAt("Live"))),
    setupTicketWrites(partition),
  ],
  [
    "usage",
    usage,
    flags,
    signedIn(setupSiteClaude(setupSiteAt("Live"), {})),
    setupUsageWrites(),
  ],
  [
    "runner",
    runner,
    runner,
    signedIn(setupSiteAt("Configured")),
    setupRunnerWrites(partition, true),
  ],
  [
    "chat-host",
    chatHost,
    chatHost,
    signedIn(setupSiteAt("Configured"), false),
    setupChatHostWrites("acme"),
  ],
];

test.each(
  writing.flatMap(([command, argv, again, made, writes]) =>
    [...new Set(writes)].map(
      (write) => [command, write, argv, again, made] as const,
    ),
  ),
)(
  "%s whose write %s the site refuses until the person agrees, as it does every request after it, ends on that stop and sends no write after it",
  async (command, write, argv, again, made) => {
    const machine = await made();
    const refused = refusing(machine, (sent) => sent === write);
    const report = await machine.command(argv);
    heldTo(machine, report, argv, again, refused);
    expect(refused).toEqual([write]);
    expect(machineWrites(machine).at(-1)).toBe(write);
    if (command === "runner" || command === "chat-host")
      expect(report).toMatchObject({
        report: "RunnerOut",
        notes: expect.arrayContaining([expect.anything()]) as unknown,
      });
  },
);

/** Each command that looks again while it waits, on a site it would wait on. */
const waiting: readonly (readonly [string, () => Promise<SetupMachine>])[] = [
  ["bind", inFolder(connected(false))],
  ["merge", signedIn(unmerged())],
  ["watch", signedIn(setupSiteAt("Moving"))],
];

test.each(
  waiting.flatMap(([command, made]) =>
    (["first", "later"] as const).map((look) => [command, look, made] as const),
  ),
)(
  "%s whose %s look the site refuses until the person agrees ends at that look",
  async (command, look, made) => {
    const machine = await made();
    const startedMs = machine.nowMs;
    const refused = refusing(
      machine,
      (sent) =>
        sent.startsWith("GET ") &&
        (look === "first" || machine.nowMs > startedMs),
    );
    const argv = [command, ...flags];
    heldTo(machine, await machine.command(argv), argv, argv, refused);
    expect(machine.nowMs > startedMs).toBe(look === "later");
  },
);

const forbidden: readonly (readonly [string, MachineRefusal])[] = [
  [
    "a 403 carrying another code",
    {
      status: 403,
      text: JSON.stringify({ error: { code: "Forbidden", message: "no" } }),
    },
  ],
  ["a 403 carrying no envelope", { status: 403, text: "{}" }],
];

test.each(forbidden)(
  "%s is read as refused, and draws the report a refusal draws",
  async (_answer, refusal) => {
    const drawn = async (answer: MachineRefusal) => {
      const machine = await machineSignedIn();
      machine.refuses = (sent) =>
        sent.startsWith("GET /api/v1/projects") ? answer : undefined;
      return machine.command([]);
    };
    const report = await drawn(refusal);
    expect(report).toEqual(await drawn({ status: 404, text: "{}" }));
    expect(
      setupReportLines(report, machineScript, copyTextEn).join("\n"),
    ).toContain("not shown to you");
  },
);
