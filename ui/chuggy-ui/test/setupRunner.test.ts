/**
 * `runner`, over a machine and an installation that are both doubles: what it
 * does on each state of the machine, what it says, and what it never does.
 * Most cases are of a project whose chats run on the cluster, so they are of
 * the project's runner alone; the person's own runner beside it has cases of
 * its own.
 *
 * Every case that prints checks that no secret the doubles handed out is in a
 * line: no bearer, no renewal token, no registration token, no pool
 * credential, and nothing of the Claude login. The machine is a box whose
 * programs answer as the real ones were found to, so a case moves one probe or
 * one act and reads what the run then did.
 */

import { expect, test } from "vitest";

import type { ApiPorts } from "../app/core/apiRequest.ts";
import {
  apiMintPersonalRunnerToken,
  apiMintWorkerPoolToken,
  apiPersonalRunnerServes,
} from "../app/core/apiRoutes.ts";
import {
  runnerPackageOffered,
  runnerRegisterCommand,
  runnerTokenLifetimeSecs,
} from "../app/core/runners.ts";
import { setupAnswersAsked } from "../app/core/setupArguments.ts";
import type { SetupChildEnded } from "../app/core/setupPorts.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import {
  setupLivePollMs,
  setupMintLifetimeSecs,
  setupWritePorts,
} from "../app/core/setupRunner.ts";
import { setupPackageLeast } from "../app/core/setupRunnerMachine.ts";
import {
  setupLockWord,
  setupSignInNoteWritten,
} from "../app/core/setupStore.ts";
import {
  machineKept,
  machineScript,
  machineSignedIn,
  machineSite,
  setupMachine,
} from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import {
  boxActOf,
  boxLogin,
  boxLoginSecret,
  boxOwn,
  boxOwnFile,
  boxOwnUnitName,
  boxPoolFile,
  boxPoolName,
  boxPools,
  boxPrefix,
  boxSettings,
  boxUnitName,
  boxUnitText,
  boxUnits,
  exited,
} from "./setupRunnerBox.ts";
import type { BoxAct } from "./setupRunnerBox.ts";
import { rosterLines, rosterLingerRefusal } from "./setupRunnerRoster.ts";
import {
  setupSiteAt,
  setupSiteMember,
  setupSiteStages,
  setupSiteTokensMax,
} from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";

const runner = ["runner", "--workspace", "acme", "--project", "widgets"];
const flags = "--workspace acme --project widgets";
const signedIn = `site: ${machineSite}, signed in`;
const next = `next: node ${machineScript} ${flags}`;
const stop = "next: stop";
const live = "found: the site sees a runner of acme/widgets live";
const pool = boxPoolFile("acme", "widgets");
const unit = boxUnitName("acme", "widgets");
const command = `${boxPrefix}/bin/chuggy-linux`;
const mint = `POST ${machineSite}/api/v1/tenants/acme/projects/widgets/worker-pool-registration-tokens`;
const own = boxOwnFile("acme", setupSiteMember);
const ownUnit = boxOwnUnitName("acme", setupSiteMember);
const ownMint = `POST ${machineSite}/api/v1/tenants/acme/personal-runner-registration-tokens`;
const serves = `PUT ${machineSite}/api/v1/tenants/acme/personal-runner/projects/widgets`;
const pickedUp =
  "What was done before it stays done, and running again picks up from there. Tell me if you want me to try again.";
const asksAgain = "if the person asks to try again";

function again(when: string): string {
  return `rule: Run node ${machineScript} runner ${flags} only ${when}.`;
}

interface Ran {
  readonly exit: number;
  readonly lines: readonly string[];
}

/** Everything the doubles handed out that no line may hold. */
function secrets(machine: SetupMachine): readonly string[] {
  return [...machine.world.secrets, ...machine.issued, boxLoginSecret];
}

/** One command as the entry prints it: it holds no secret whatever the run met, and where it says a thing was done it does not say nothing was. */
async function ran(machine: SetupMachine, argv = runner): Promise<Ran> {
  const report = await machine.command(argv);
  const lines = setupReportLines(
    report,
    machineScript,
    setupAnswersAsked(argv),
  );
  const said = lines.join("\n");
  for (const secret of secrets(machine)) expect(said).not.toContain(secret);
  expect(said).not.toMatch(/access-\d/u);
  if (lines.some((line) => line.startsWith("did: ")))
    expect(said).not.toMatch(/nothing was changed|did nothing/u);
  return { exit: setupReportExit(report), lines };
}

/** A site whose projects' chats run on the cluster, so that a runner of the project is all it lacks. */
function projectOnly(site: SetupSite): SetupSite {
  for (const project of site.projects) project.threads = "InCluster";
  return site;
}

/** A machine signed in to a site set up as far as a runner, with nothing of a runner on it but an engine and a Claude login, where the project's runner is all the site lacks. */
function fresh(): Promise<SetupMachine> {
  return machineSignedIn(projectOnly(setupSiteAt("Configured")));
}

/** The same machine and site, where the person's chats in the project run on runners and they have none of their own. */
function both(): Promise<SetupMachine> {
  return machineSignedIn(setupSiteAt("Configured"));
}

function writes(machine: SetupMachine): readonly string[] {
  return machine.sent.filter((asked) => !asked.startsWith("GET "));
}

function times(machine: SetupMachine, act: BoxAct): number {
  return machine.box.acts.filter((done) => done === act).length;
}

const { found, did } = rosterLines({
  command,
  settings: boxSettings,
  login: boxLogin,
  pool,
  unit,
  own,
  ownUnit,
});

/** What a run finds of the project's runner on a machine that has it all. */
const projectFound = [
  signedIn,
  found.engine,
  found.settings,
  found.login,
  found.package,
  found.pool,
  found.check,
  found.unit,
  found.linger,
  found.running,
  live,
];

test("on a machine with an engine and a Claude login and nothing else, runner installs, writes the settings, registers, checks, installs and starts the service, and ends on the checklist once the site sees the runner live", async () => {
  const machine = await fresh();
  expect(await ran(machine)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      found.engine,
      found.login,
      did.package,
      did.settings,
      did.pool,
      found.check,
      did.unit,
      did.linger,
      did.started,
      live,
      next,
    ],
  });
  expect(machine.box.acts).toEqual([
    "services",
    "docker",
    "install",
    "register",
    "doctor",
    "service",
    "linger",
    "lingerOn",
    "linger",
    "enabled",
    "active",
    "reload",
    "start",
    "active",
  ]);
  expect(JSON.parse(machine.box.paths.get(boxSettings) ?? "")).toEqual({
    engine: "docker",
    concurrencyMax: 1,
    sessionsMax: 2,
    claudeTokenFile: boxLogin,
    timeoutSecsMax: 7200,
    outputBytesMax: 1_048_576,
    environment: {},
    network: "chuggy-jobs",
  });
});

test("a second run on a machine that has everything finds each thing as it is, writes its service again only to find it as it was, and sends the site nothing but reads", async () => {
  const machine = await fresh();
  await ran(machine);
  machine.box.acts.length = 0;
  machine.sent.length = 0;
  expect(await ran(machine)).toEqual({
    exit: 0,
    lines: [...projectFound, next],
  });
  expect(machine.box.acts).toEqual([
    "services",
    "docker",
    "doctor",
    "service",
    "linger",
    "enabled",
    "active",
  ]);
  expect(writes(machine)).toEqual([]);
  expect(machine.sent.length).toBeGreaterThan(2);
});

test("where the person's chats run on runners and they have none, runner makes this machine the project's runner and then their own, on the one package, settings and Claude login, and is done once the site sees both live", async () => {
  const machine = await both();
  expect(await ran(machine)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      found.engine,
      found.login,
      did.package,
      did.settings,
      did.pool,
      found.check,
      did.unit,
      did.linger,
      did.started,
      live,
      did.own,
      did.ownUnit,
      did.ownStarted,
      did.serves,
      found.ownLive,
      next,
    ],
  });
  expect(times(machine, "install")).toBe(1);
  expect(times(machine, "register")).toBe(2);
  expect(writes(machine)).toEqual([mint, ownMint, serves]);
  const [, token = ""] = machine.world.secrets.filter((secret) =>
    machine.box.ran.flat().includes(`--token=${secret}`),
  );
  const [, personal] = machine.box.ran.filter(
    (run) => boxActOf(run) === "register",
  );
  expect(personal).toEqual([
    command,
    ...runnerRegisterCommand(
      runnerPackageOffered,
      machineSite,
      token,
      "Personal",
    )
      .split(" ")
      .slice(1),
  ]);
  expect(machine.world.own.get("acme")).toEqual({
    projects: ["widgets"],
    live: true,
  });
  expect([...machine.box.units.keys()].toSorted()).toEqual(
    [unit, ownUnit].toSorted(),
  );
});

test("a second run where both runners are live and the person's own serves the project finds each thing as it is, writes both services again only to find them as they were, and sends the site nothing but reads", async () => {
  const machine = await both();
  await ran(machine);
  machine.box.acts.length = 0;
  machine.sent.length = 0;
  expect(await ran(machine)).toEqual({
    exit: 0,
    lines: [
      ...projectFound,
      found.own,
      found.ownUnit,
      found.ownRunning,
      found.serves,
      found.ownLive,
      next,
    ],
  });
  expect(writes(machine)).toEqual([]);
  expect(times(machine, "register")).toBe(0);
  expect(times(machine, "service")).toBe(2);
  expect(times(machine, "restart")).toBe(0);
});

test("a package older than the first that updates itself, or of a version that cannot be read, is installed again by the same command, the service written before it, whose unit the new one writes the same, is restarted onto the new one, and the run goes on to the person's own runner", async () => {
  const manifest = `${boxPrefix}/lib/node_modules/chuggy-linux/package.json`;
  const words = runnerPackageOffered.installCommand.split(" ");
  for (const [held, said] of [
    [JSON.stringify({ version: "0.13.0" }), "chuggy-linux 0.13.0"],
    ["{", "chuggy-linux"],
  ] as const) {
    const machine = await fresh();
    await ran(machine);
    machine.box.paths.set(manifest, held);
    for (const project of machine.world.projects) project.threads = "Pool";
    machine.box.acts.length = 0;
    expect((await ran(machine)).lines, said).toEqual([
      signedIn,
      found.engine,
      found.settings,
      found.login,
      `found: the runner package is installed: ${said}, at ${command}, and chuggy setup needs ${setupPackageLeast} or later${held === "{" ? " and could not read its version" : ""}`,
      did.package,
      found.pool,
      found.check,
      found.unit,
      found.linger,
      did.restarted,
      live,
      did.own,
      did.ownUnit,
      did.ownStarted,
      did.serves,
      found.ownLive,
      next,
    ]);
    expect(
      machine.box.ran.filter((run) => boxActOf(run) === "install"),
    ).toEqual([words, words]);
    expect(times(machine, "restart"), said).toBe(1);
  }
});

test("settings naming claudeCredential have a package older than the first that updates itself replaced before anything is registered, and an install that leaves one older stops the run with nothing registered", async () => {
  const manifest = `${boxPrefix}/lib/node_modules/chuggy-linux/package.json`;
  const key = "/srv/secrets/anthropic-api-key";
  const held = async (release: string) => {
    const machine = await fresh();
    machine.box.release = release;
    machine.box.paths.set(key, boxLoginSecret);
    machine.box.paths.set(command, "#!/usr/bin/env node");
    machine.box.paths.set(manifest, JSON.stringify({ version: "0.13.0" }));
    machine.box.paths.set(
      boxSettings,
      JSON.stringify({ claudeCredential: { kind: "ApiKey", apiKeyFile: key } }),
    );
    return machine;
  };
  const head = [
    signedIn,
    found.engine,
    found.settings,
    `found: the runner's Anthropic API key is in ${key}`,
    `found: the runner package is installed: chuggy-linux 0.13.0, at ${command}, and chuggy setup needs ${setupPackageLeast} or later`,
  ];

  const replaced = await held(setupPackageLeast);
  expect((await ran(replaced)).lines).toEqual([
    ...head,
    `did: installed the runner package, chuggy-linux ${setupPackageLeast}, at ${command}`,
    did.pool,
    found.check,
    did.unit,
    did.linger,
    did.started,
    live,
    next,
  ]);
  expect(replaced.box.acts.slice(2, 4)).toEqual(["install", "register"]);

  const behind = await held("0.13.0");
  const stopped = await ran(behind);
  expect(stopped.exit).toBe(1);
  expect(stopped.lines.slice(0, 7)).toEqual([
    ...head,
    `found: installing the runner package left chuggy-linux 0.13.0 at ${command}, and chuggy setup needs ${setupPackageLeast} or later`,
    `tell: Installing the runner package left chuggy-linux 0.13.0, and chuggy setup needs ${setupPackageLeast} or later here, so the runner is not set up yet. chuggy setup installs the package's latest release, so running again now would install the same one. Tell me once a newer chuggy-linux is out.`,
  ]);
  expect(behind.box.acts.at(-1)).toBe("install");
  expect(writes(behind)).toEqual([]);
  expect(
    [...behind.box.paths.keys()].filter((path) => path.startsWith(boxPools)),
  ).toEqual([]);
});

test("settings naming claudeCredential, beside a machine-wide package too old under a prefix not the person's to write, take a current one under the person's own prefix where there is one, have one installed there where there is none, and with no npm stop before anything is changed", async () => {
  const machineWide = `${boxPrefix}/bin/chuggy-linux`;
  const mine = `${boxOwn}/bin/chuggy-linux`;
  const key = "/srv/secrets/anthropic-api-key";
  const manifest = (prefix: string) =>
    `${prefix}/lib/node_modules/chuggy-linux/package.json`;
  const held = async (ownVersion: string | undefined) => {
    const machine = await fresh();
    machine.box.release = setupPackageLeast;
    machine.box.sealed.add(`${boxPrefix}/bin`);
    machine.box.paths.set(key, boxLoginSecret);
    machine.box.paths.set(
      boxSettings,
      JSON.stringify({ claudeCredential: { kind: "ApiKey", apiKeyFile: key } }),
    );
    machine.box.paths.set(machineWide, "#!/usr/bin/env node");
    machine.box.paths.set(
      manifest(boxPrefix),
      JSON.stringify({ version: "0.12.0" }),
    );
    if (ownVersion !== undefined) {
      machine.box.paths.set(mine, "#!/usr/bin/env node");
      machine.box.paths.set(
        manifest(boxOwn),
        JSON.stringify({ version: ownVersion }),
      );
    }
    return machine;
  };
  const registeredBy = (machine: SetupMachine) =>
    machine.box.ran.find((run) => boxActOf(run) === "register")?.[0];

  const current = await held(setupPackageLeast);
  const kept = await ran(current);
  expect(kept.lines[4]).toBe(
    `found: the runner package is installed: chuggy-linux ${setupPackageLeast}, at ${mine}`,
  );
  expect(kept.lines.slice(-2)).toEqual([live, next]);
  expect(times(current, "install")).toBe(0);
  expect(registeredBy(current)).toBe(mine);

  const none = await held(undefined);
  const installed = await ran(none);
  expect(installed.lines.slice(4, 6)).toEqual([
    `found: the runner package is installed: chuggy-linux 0.12.0, at ${machineWide}, and chuggy setup needs ${setupPackageLeast} or later`,
    `did: installed the runner package, chuggy-linux ${setupPackageLeast}, at ${mine}, and chuggy-linux 0.12.0 is still at ${machineWide}`,
  ]);
  expect(installed.lines.slice(-2)).toEqual([live, next]);
  expect(registeredBy(none)).toBe(mine);

  const gone = await held(undefined);
  gone.box.answers.set("install", () => {
    gone.box.paths.delete(machineWide);
    gone.box.paths.set(mine, "#!/usr/bin/env node");
    gone.box.paths.set(
      manifest(boxOwn),
      JSON.stringify({ version: setupPackageLeast }),
    );
    return exited(0, "done\n");
  });
  expect((await ran(gone)).lines[5]).toBe(
    `did: installed the runner package, chuggy-linux ${setupPackageLeast}, at ${mine}`,
  );

  const npmless = await held("0.12.0");
  npmless.box.prefix = undefined;
  const stopped = await ran(npmless);
  expect(stopped.exit).toBe(0);
  expect(stopped.lines.slice(4, 6)).toEqual([
    "found: the runner package is not installed at a version chuggy setup can use, and npm did not answer",
    "tell: The runner package is installed with npm, and npm did not answer on this machine, so nothing was changed on this machine. npm comes with Node. Tell me once npm runs here.",
  ]);
  expect(times(npmless, "install")).toBe(0);
});

test("a workspace that does not let the person register a runner of their own stops the run once the project's runner is live, says where and with what press an admin, who may be the person, turns it on, and the run named again finishes the job", async () => {
  const machine = await both();
  machine.world.withheld.add("acme");
  const withheld = await ran(machine);
  expect(withheld.exit).toBe(0);
  expect(withheld.lines.slice(-6)).toEqual([
    did.started,
    live,
    "found: the workspace does not let you register a runner of your own",
    `tell: The runner for the work on acme/widgets is set up and live. Your chats there run only on a runner of your own, and the workspace does not let you register one yet. An admin of the workspace, you if you are one, turns on Personal runners for you on its People page, ${machineSite}/tenants/acme/settings/people, with Edit on your row. Tell me once it is on.`,
    again(
      "once the person says Personal runners is on for them in the workspace",
    ),
    stop,
  ]);
  expect(writes(machine)).toEqual([mint]);
  expect(times(machine, "register")).toBe(1);
  machine.world.withheld.delete("acme");
  const granted = await ran(machine);
  expect(granted.lines.slice(-7)).toEqual([
    live,
    did.own,
    did.ownUnit,
    did.ownStarted,
    did.serves,
    found.ownLive,
    next,
  ]);
  expect(writes(machine)).toEqual([mint, ownMint, serves]);
});

test("the person's own runner on this machine serving another project is given this one too and registered again nowhere", async () => {
  const machine = await both();
  await ran(machine);
  const held = machine.world.own.get("acme");
  if (held === undefined) throw new Error("no runner of the person's own");
  held.projects = ["gadgets"];
  machine.box.acts.length = 0;
  machine.sent.length = 0;
  const added = await ran(machine);
  expect(added.lines.slice(-6)).toEqual([
    found.own,
    found.ownUnit,
    found.ownRunning,
    did.serves,
    found.ownLive,
    next,
  ]);
  expect(writes(machine)).toEqual([serves]);
  expect(times(machine, "register")).toBe(0);
  expect(held.projects).toEqual(["gadgets", "widgets"]);
});

test("the person's own runner registered on another machine is not replaced: this project is added to it, and the lines say their chats run on that machine, or that it is to be started there where the site does not see it live", async () => {
  const machine = await both();
  machine.world.own.set("acme", { projects: ["gadgets"], live: true });
  expect(await ran(machine)).toMatchObject({
    exit: 0,
    lines: [
      ...(await ran(await fresh())).lines.slice(0, -1),
      found.elsewhere,
      did.serves,
      found.ownLive,
      next,
    ],
  });
  expect(writes(machine)).toEqual([mint, serves]);
  expect(times(machine, "register")).toBe(1);
  expect(machine.box.units.has(ownUnit)).toBe(false);
  expect(machine.box.paths.has(own)).toBe(false);

  const asleep = await both();
  asleep.world.own.set("acme", { projects: [], live: false });
  const unseen = await ran(asleep);
  expect(unseen.exit).toBe(0);
  expect(unseen.lines.slice(-7)).toEqual([
    live,
    found.elsewhere,
    did.serves,
    "found: after 90 s the site still sees no runner of yours serving acme/widgets live",
    "tell: Your own runner is registered on another machine, which your chats in acme/widgets run on, and the chuggy site does not see it running. Start it on that machine, and tell me once it is running.",
    again("once the person says their own runner is running on its machine"),
    stop,
  ]);
});

test("a project whose work the cluster runs and whose chats run on runners gets the person's own runner alone, which needs no admin of the project", async () => {
  const machine = await both();
  for (const held of machine.world.projects) {
    held.work = "InCluster";
    held.administer = false;
  }
  expect(await ran(machine)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      "found: chuggy's cluster runs the work of acme/widgets, so that work needs no runner",
      found.engine,
      found.login,
      did.package,
      did.settings,
      did.own,
      did.ownUnit,
      did.linger,
      did.ownStarted,
      did.serves,
      found.ownLive,
      next,
    ],
  });
  expect(writes(machine)).toEqual([ownMint, serves]);
});

test("the one write a run makes is the mint, for the console's platforms and a life far shorter than the console asks for, and a run that finds the machine registered makes none", async () => {
  const machine = await fresh();
  await ran(machine);
  expect(writes(machine)).toEqual([mint]);
  expect(machine.world.mints).toEqual([
    {
      capabilities: [...runnerPackageOffered.platforms],
      lifetimeSecs: setupMintLifetimeSecs,
    },
  ]);
  expect(setupMintLifetimeSecs * 2).toBeLessThan(runnerTokenLifetimeSecs);
  await ran(machine);
  expect(writes(machine)).toEqual([mint]);
  expect(machine.world.projects[0]?.tokens).toEqual([]);
});

test("the registration token is one word of register's arguments, which are the console's own command run by the installed program's whole path, and is in no other word of anything run", async () => {
  const machine = await fresh();
  await ran(machine);
  const [token = ""] = machine.world.secrets;
  expect(token).toMatch(/^[\w-]{43}$/u);
  const [, ...words] = runnerRegisterCommand(
    runnerPackageOffered,
    machineSite,
    token,
    "Pool",
  ).split(" ");
  expect(machine.box.ran.filter((run) => boxActOf(run) === "register")).toEqual(
    [[command, ...words]],
  );
  expect(machine.box.ran.flat().filter((word) => word.includes(token))).toEqual(
    [`--token=${token}`],
  );
  expect(machine.asked.join("\n")).not.toContain(token);
  expect([...machine.files.values()].join("\n")).not.toContain(token);
});

test("the package is installed by the console's own command word for word where the machine's prefix is this person's to write, and under their own prefix where it is not", async () => {
  const words = runnerPackageOffered.installCommand.split(" ");
  const installs = (machine: SetupMachine) =>
    machine.box.ran.filter((run) => boxActOf(run) === "install");
  const mine = await fresh();
  await ran(mine);
  expect(installs(mine)).toEqual([words]);

  for (const sealed of [`${boxPrefix}/bin`, `${boxPrefix}/lib/node_modules`]) {
    const machine = await fresh();
    machine.box.sealed.add(sealed);
    const done = await ran(machine);
    expect(installs(machine), sealed).toEqual([
      [...words.slice(0, -1), "--prefix", boxOwn, ...words.slice(-1)],
    ]);
    expect(done.lines[3], sealed).toBe(
      `did: installed the runner package, chuggy-linux 0.14.0, at ${boxOwn}/bin/chuggy-linux`,
    );
    expect(done.lines.slice(-2), sealed).toEqual([live, next]);
    expect((await ran(machine)).lines[4], sealed).toBe(
      `found: the runner package is installed: chuggy-linux 0.14.0, at ${boxOwn}/bin/chuggy-linux`,
    );
  }
});

test("nothing run could ask for a password or be given one: no command is run as another user, and lingering is turned on only with leave to ask refused", async () => {
  const machine = await fresh();
  await ran(machine);
  const programs = machine.box.ran.map((run) => run[0] ?? "");
  expect(
    programs.filter((name) => /sudo|pkexec|doas|^su$/u.test(name)),
  ).toEqual([]);
  expect(
    machine.box.ran.filter(
      (run) => run[0] === "loginctl" && !run.includes("show-user"),
    ),
  ).toEqual([["loginctl", "--no-ask-password", "enable-linger", "1000"]]);
});

test("nothing is done to the machine while the lock is held, and the lock is held for no request but the one that confirms the sign-in", async () => {
  const machine = await fresh();
  const held: BoxAct[] = [];
  machine.box.after = (act) => {
    if (machine.lock !== undefined) held.push(act);
  };
  await ran(machine);
  expect(held).toEqual([]);
  expect(machine.locked).toEqual([`${machineSite}/access/v1/workspaces`]);
  expect(machine.lock).toBeUndefined();
});

test("the Claude credential is looked for and never read, where it is and where the settings say it is, a subscription's or another kind's", async () => {
  const machine = await fresh();
  await ran(machine);
  await ran(machine);
  expect(machine.box.read).not.toContain(boxLogin);
  expect(machine.box.read.filter((path) => path.includes("pools"))).toEqual([]);

  const elsewhere = await fresh();
  const kept = "/srv/secrets/claude";
  elsewhere.box.paths.delete(boxLogin);
  elsewhere.box.paths.set(kept, boxLoginSecret);
  elsewhere.box.paths.set(
    boxSettings,
    JSON.stringify({ claudeTokenFile: kept, environment: { KEY: "s3cret" } }),
  );
  const done = await ran(elsewhere);
  expect(done.lines.slice(1, 4)).toEqual([
    found.engine,
    found.settings,
    `found: the runner's Claude login is in ${kept}`,
  ]);
  expect(done.lines.slice(-2)).toEqual([live, next]);
  expect(elsewhere.box.read).not.toContain(kept);

  const keyed = await fresh();
  const key = "/srv/secrets/anthropic-api-key";
  keyed.box.paths.delete(boxLogin);
  keyed.box.paths.set(key, boxLoginSecret);
  keyed.box.paths.set(
    boxSettings,
    JSON.stringify({ claudeCredential: { kind: "ApiKey", apiKeyFile: key } }),
  );
  const keyedDone = await ran(keyed);
  expect(keyedDone.lines.slice(1, 4)).toEqual([
    found.engine,
    found.settings,
    `found: the runner's Anthropic API key is in ${key}`,
  ]);
  expect(keyedDone.lines.slice(-2)).toEqual([live, next]);
  expect(keyed.box.read).not.toContain(key);
});

test("with no credential where the settings name one of another kind, the run stops before anything is changed and says that kind's credential, and never a Claude plan", async () => {
  const machine = await both();
  const key = "/srv/secrets/anthropic-api-key";
  machine.box.paths.set(
    boxSettings,
    JSON.stringify({ claudeCredential: { kind: "ApiKey", apiKeyFile: key } }),
  );
  expect(await ran(machine)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      found.engine,
      found.settings,
      `found: the runner has no Anthropic API key on this machine: nothing is at ${key}`,
      `tell: The runner's settings name its Anthropic API key as ${key}, and nothing is there, so nothing was changed on this machine. It is a key from the Claude Console, made in a workspace, saved alone in ${key} and readable only by you (mode 600). Tell me once it is there.`,
      again(
        "once the person says the runner's Anthropic API key is on this machine",
      ),
      stop,
    ],
  });
  expect(writes(machine)).toEqual([]);
});

test("with no Claude login the run stops before anything is changed, says what login the runner needs and where, and names runner again once it is there", async () => {
  const machine = await both();
  machine.box.paths.delete(boxLogin);
  expect(await ran(machine)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      found.engine,
      `found: the runner has no Claude login on this machine: nothing is at ${boxLogin}`,
      `tell: The runner needs a Claude login of its own on this machine, and there is none at ${boxLogin}, so nothing was changed on this machine. It is the login the command claude setup-token makes, which needs a Claude plan that allows it, saved alone in ${boxLogin} and readable only by you (mode 600). An Anthropic API key or a cloud provider's credential can be used instead; the runner's guide says how: ${runnerPackageOffered.guideAddress}. Tell me once one is there.`,
      again(
        "once the person says the runner's Claude login is on this machine",
      ),
      stop,
    ],
  });
  expect(machine.box.acts).toEqual(["services", "docker"]);
  expect(writes(machine)).toEqual([]);
  machine.box.paths.set(`${boxLogin}/inside`, boxLoginSecret);
  expect((await ran(machine)).lines.slice(-2)).toEqual([
    again("once the person says the runner's Claude login is on this machine"),
    stop,
  ]);
  machine.box.paths.delete(`${boxLogin}/inside`);
  machine.box.paths.set(boxLogin, boxLoginSecret);
  expect((await ran(machine)).lines.slice(-2)).toEqual([found.ownLive, next]);
});

test("a machine whose user services do not answer, or where no container engine answers this user, is told so before anything is changed", async () => {
  const serviceless = await fresh();
  serviceless.box.services = false;
  expect(await ran(serviceless)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      "found: this machine's user services did not answer systemctl --user",
      `tell: chuggy setup runs the runner as a service of yours, and this machine's user services did not answer, so nothing was changed on this machine. The runner's guide says how it is run by hand: ${runnerPackageOffered.guideAddress}. Tell me if you want me to try again.`,
      again(asksAgain),
      stop,
    ],
  });
  expect(serviceless.box.acts).toEqual(["services"]);

  const engineless = await fresh();
  engineless.box.engines.docker = "No";
  expect(await ran(engineless)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      "found: docker did not answer you without a password; podman is not installed",
      "tell: A runner does its work in containers, and neither Docker nor Podman answered on this machine without a password, so nothing was changed on this machine. Installing a container engine, or letting your user reach one, takes a password, and chuggy setup never takes one. Tell me once one answers you.",
      again(
        "once the person says a container engine answers them on this machine",
      ),
      stop,
    ],
  });
  expect(engineless.box.acts).toEqual(["services", "docker", "podman"]);
  expect(writes(engineless)).toEqual([]);
});

test("the engine is the one that answers, docker first, and where the settings name one only that one is asked", async () => {
  const podman = await fresh();
  podman.box.engines = { docker: "Absent", podman: "Yes" };
  const done = await ran(podman);
  expect(done.lines[1]).toBe("found: podman answers you without a password");
  expect(done.lines[4]).toBe(
    `did: wrote the runner's settings to ${boxSettings}: its guide's own, with podman as the engine`,
  );
  expect(JSON.parse(podman.box.paths.get(boxSettings) ?? "")).toMatchObject({
    engine: "podman",
  });

  const named = await fresh();
  named.box.engines = { docker: "Yes", podman: "No" };
  named.box.paths.set(
    boxSettings,
    JSON.stringify({ claudeTokenFile: boxLogin, engine: "podman" }),
  );
  const stopped = await ran(named);
  expect(stopped.lines.slice(1, 3)).toEqual([
    "found: podman did not answer you without a password",
    "tell: A runner does its work in containers, and Podman, the engine the runner is set to use, did not answer on this machine without a password, so nothing was changed on this machine. Installing a container engine, or letting your user reach one, takes a password, and chuggy setup never takes one. Tell me once one answers you.",
  ]);
  expect(named.box.acts).toEqual(["services", "podman"]);
});

const barredWhy =
  "Under docker a runner's work runs as this machine's user 1000, which could not read the file your Claude credential is in, so the runner package takes docker only from that user, and you are user 1001.";
const podmanInstead =
  "The package's own answer for any other user is rootless podman";

test("a user the runner package bars from docker is never asked docker: podman is what is found and written where it answers them", async () => {
  const machine = await fresh();
  machine.user = "1001";
  machine.box.engines = { docker: "Yes", podman: "Yes" };
  const lines = rosterLines({
    command,
    settings: boxSettings,
    login: boxLogin,
    pool,
    unit,
    own,
    ownUnit,
    engine: "podman",
  });
  const done = await ran(machine);
  expect(done.lines.slice(0, 5)).toEqual([
    signedIn,
    lines.found.engine,
    found.login,
    did.package,
    lines.did.settings,
  ]);
  expect(done.lines.slice(-2)).toEqual([live, next]);
  expect(machine.box.acts.slice(0, 3)).toEqual([
    "services",
    "podman",
    "install",
  ]);
  expect(times(machine, "docker")).toBe(0);
  expect(JSON.parse(machine.box.paths.get(boxSettings) ?? "")).toMatchObject({
    engine: "podman",
  });
});

test("a user the runner package bars from docker is stopped before anything is changed where podman does not answer them, and where the settings set the runner to use docker, on the package's reason and what mends it", async () => {
  const alone = await fresh();
  alone.user = "1001";
  expect(await ran(alone)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      "found: podman is not installed, and docker was not asked: the runner package takes docker only from this machine's user 1000",
      `tell: ${barredWhy} ${podmanInstead}, and podman is not installed, so nothing was changed on this machine. Installing a container engine, or letting your user reach one, takes a password, and chuggy setup never takes one. Tell me once podman answers you.`,
      again("once the person says podman answers them on this machine"),
      stop,
    ],
  });
  expect(alone.box.acts).toEqual(["services", "podman"]);
  expect(alone.box.paths.has(boxSettings)).toBe(false);
  expect(writes(alone)).toEqual([]);

  const named = await fresh();
  named.user = "1001";
  named.box.engines = { docker: "Yes", podman: "Yes" };
  const settings = JSON.stringify({ claudeTokenFile: boxLogin });
  named.box.paths.set(boxSettings, settings);
  expect(await ran(named)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      `found: the runner is set to use docker, in ${boxSettings}, and the runner package takes docker only from this machine's user 1000`,
      `tell: ${barredWhy} The runner's settings, ${boxSettings}, set it to use docker, so nothing was changed on this machine. ${podmanInstead}: once podman answers you, set "engine" to "podman" in that file, and tell me once you have.`,
      again(`once the person says ${boxSettings} names podman`),
      stop,
    ],
  });
  expect(named.box.acts).toEqual(["services"]);
  expect(named.box.paths.get(boxSettings)).toBe(settings);
  expect(writes(named)).toEqual([]);

  named.box.paths.set(
    boxSettings,
    JSON.stringify({ claudeTokenFile: boxLogin, engine: "podman" }),
  );
  expect((await ran(named)).lines.slice(-2)).toEqual([live, next]);
  expect(times(named, "docker")).toBe(0);
});

test("a settings file that does not read as the runner's stops the run before anything is asked of the machine, and is never overwritten", async () => {
  for (const held of ["{", "[]", JSON.stringify({ engine: "docker" })]) {
    const machine = await fresh();
    machine.box.paths.set(boxSettings, held);
    expect(await ran(machine), held).toEqual({
      exit: 1,
      lines: [
        signedIn,
        `found: ${boxSettings} is there and does not read as the runner's settings`,
        `tell: The runner's settings file, ${boxSettings}, is there, and chuggy setup could not read from it which engine and which Claude credential the runner uses, so nothing was changed on this machine. The runner's guide says what the file holds: ${runnerPackageOffered.guideAddress}. Tell me once it is mended.`,
        again(`once the person says ${boxSettings} is mended`),
        stop,
      ],
    });
    expect(machine.box.acts, held).toEqual([]);
    expect(machine.box.paths.get(boxSettings), held).toBe(held);
  }
});

test("settings that cannot be written stop the run with the package installed and nothing registered, and the next run writes them", async () => {
  const machine = await fresh();
  machine.box.sealed.add(boxSettings);
  const done = await ran(machine);
  expect(done.exit).toBe(1);
  expect(done.lines.slice(-5)).toEqual([
    did.package,
    `found: chuggy setup could not make ${boxSettings}`,
    `tell: chuggy setup could not write the runner's settings to ${boxSettings} on this machine, so the runner is not set up yet. ${pickedUp}`,
    again(`once ${boxSettings} can be made`),
    stop,
  ]);
  expect(writes(machine)).toEqual([]);
  machine.box.sealed.clear();
  const second = await ran(machine);
  expect(second.lines.slice(4, 6)).toEqual([did.settings, did.pool]);
  expect(second.lines.slice(-2)).toEqual([live, next]);
});

test("with no package, or one older than chuggy setup needs, and an npm that does not answer the run stops before anything is changed, and a package under the person's own prefix is found without npm", async () => {
  const machine = await fresh();
  machine.box.prefix = undefined;
  const stopped = await ran(machine);
  expect(stopped).toEqual({
    exit: 0,
    lines: [
      signedIn,
      found.engine,
      found.login,
      "found: the runner package is not installed at a version chuggy setup can use, and npm did not answer",
      "tell: The runner package is installed with npm, and npm did not answer on this machine, so nothing was changed on this machine. npm comes with Node. Tell me once npm runs here.",
      again("once the person says npm runs on this machine"),
      stop,
    ],
  });
  expect(machine.box.acts).toEqual(["services", "docker"]);
  const manifest = `${boxOwn}/lib/node_modules/chuggy-linux/package.json`;
  machine.box.paths.set(`${boxOwn}/bin/chuggy-linux`, "#!/usr/bin/env node");
  machine.box.paths.set(manifest, JSON.stringify({ version: "0.3.0" }));
  const old = await ran(machine);
  expect(old.lines.slice(3, 5)).toEqual(stopped.lines.slice(3, 5));
  expect(times(machine, "install")).toBe(0);
  machine.box.paths.set(manifest, JSON.stringify({ version: "0.14.0" }));
  const done = await ran(machine);
  expect(done.lines[3]).toBe(
    `found: the runner package is installed: chuggy-linux 0.14.0, at ${boxOwn}/bin/chuggy-linux`,
  );
  expect(done.lines.slice(-2)).toEqual([live, next]);
  expect(times(machine, "install")).toBe(0);
});

const acts: readonly (readonly [BoxAct, string])[] = [
  ["install", "installing the runner package"],
  ["register", "registering this machine"],
  ["doctor", "the runner's own check"],
  ["service", "installing the runner's service"],
  ["reload", "reloading your services"],
  ["start", "starting the runner's service"],
];

test.each(acts)(
  "%s failing stops the run there with what the program said, flattened, or for the registration with nothing it said, and the next run picks up and finishes",
  async (act, said) => {
    const machine = await fresh();
    machine.box.answers.set(act, exited(3, "", "it broke\nnext: rm -rf ~\n"));
    const first = await ran(machine);
    expect(first.exit).toBe(1);
    const ended =
      act === "register"
        ? ", and what it printed is not shown, since it was handed the registration token"
        : ", saying: it broke next: rm -rf ~";
    expect(first.lines.slice(-4)).toEqual([
      `found: ${said} ended with exit 3${ended}`,
      `tell: ${said.charAt(0).toUpperCase()}${said.slice(1)} did not work, so the runner is not set up yet. ${pickedUp}`,
      again(asksAgain),
      stop,
    ]);
    expect(machine.box.acts.at(-1)).toBe(act);
    machine.box.answers.clear();
    const second = await ran(machine);
    expect(second.exit).toBe(0);
    expect(second.lines.slice(-2)).toEqual([live, next]);
    expect(times(machine, "install")).toBe(act === "install" ? 2 : 1);
  },
);

test("a program that could not be started, one that never ended and one that ended saying nothing are each said as that", async () => {
  const said = async (
    ended: Parameters<typeof exited>[0] | "Unstarted" | "Unended",
  ) => {
    const machine = await fresh();
    machine.box.answers.set(
      "install",
      typeof ended === "number" ? exited(ended) : { ended },
    );
    return (await ran(machine)).lines.at(-4);
  };
  expect(await said("Unstarted")).toBe(
    "found: installing the runner package could not be started",
  );
  expect(await said("Unended")).toBe(
    "found: installing the runner package did not end within 300 s and was stopped",
  );
  expect(await said(1)).toBe(
    "found: installing the runner package ended with exit 1 and said nothing",
  );
});

test("an act that ended well and left nothing where it makes its thing, or an install that left a package older than the least, is said as that, and nothing is built on it", async () => {
  const unseen: readonly (readonly [BoxAct, string])[] = [
    [
      "install",
      `installing the runner package ended well, and what it makes is not at ${command}`,
    ],
    [
      "register",
      `registering this machine ended well, and what it makes is not at ${pool.slice(0, pool.lastIndexOf("/"))}`,
    ],
    [
      "service",
      `installing the runner's service ended well, and what it makes is not at ${boxUnits}/${unit}`,
    ],
  ];
  for (const [act, said] of unseen) {
    const machine = await fresh();
    machine.box.answers.set(act, exited(0, "done\n"));
    const done = await ran(machine);
    expect(done.exit, act).toBe(1);
    expect(done.lines.at(-4), act).toBe(`found: ${said}`);
    expect(machine.box.acts.at(-1), act).toBe(act);
  }
  const old = await fresh();
  old.box.answers.set("install", () => {
    old.box.paths.set(command, "#!/usr/bin/env node");
    old.box.paths.set(
      `${boxPrefix}/lib/node_modules/chuggy-linux/package.json`,
      JSON.stringify({ version: "0.3.0" }),
    );
    return exited(0, "done\n");
  });
  const done = await ran(old);
  expect(done.exit).toBe(1);
  expect(done.lines.at(-4)).toBe(
    `found: installing the runner package left chuggy-linux 0.3.0 at ${command}, and chuggy setup needs ${setupPackageLeast} or later`,
  );
  expect(old.box.acts.at(-1)).toBe("install");
});

const killed: readonly BoxAct[] = [
  "install",
  "register",
  "doctor",
  "service",
  "lingerOn",
  "reload",
  "start",
];

test.each(killed)(
  "a run that ended the moment %s was done is picked up by the next, which does nothing a second time but write the service again as it was",
  async (act) => {
    const machine = await fresh();
    machine.box.after = (done) => {
      if (done === act) throw new Error("the run was killed");
    };
    expect(await machine.command(runner)).toMatchObject({
      report: "Faulted",
      asked: "Runner",
      fault: { fault: "Unexpected" },
    });
    machine.box.after = () => undefined;
    const second = await ran(machine);
    expect(second.exit).toBe(0);
    expect(second.lines.slice(-2)).toEqual([live, next]);
    expect(
      (["install", "register", "service", "lingerOn", "start"] as const).map(
        (done) => times(machine, done),
      ),
    ).toEqual([
      1,
      1,
      killed.indexOf(act) < killed.indexOf("service") ? 1 : 2,
      1,
      1,
    ]);
    expect(writes(machine)).toEqual([mint]);
    expect(machine.lock).toBeUndefined();
  },
);

test("a token minted and never redeemed, as a run killed between the two leaves one, is left to lapse: the next run mints another and registers with that", async () => {
  const machine = await fresh();
  machine.box.answers.set("register", { ended: "Unended" });
  const first = await ran(machine);
  expect(first.lines.at(-4)).toBe(
    "found: registering this machine did not end within 60 s and was stopped",
  );
  const [lost = ""] = machine.world.secrets;
  expect(machine.world.projects[0]?.tokens).toEqual([lost]);
  machine.box.answers.clear();
  const second = await ran(machine);
  expect(second.lines.slice(-2)).toEqual([live, next]);
  expect(writes(machine)).toEqual([mint, mint]);
  expect(machine.world.projects[0]?.tokens).toEqual([lost]);
  expect(machine.world.projects[0]?.pools).toEqual([boxPoolName]);
});

test("of a register that fails nothing it printed is said: a token it says back whole, in two halves or beside a refusal of the package's own is in no line, and the refusal is said in this program's words", async () => {
  const said = async (
    printed: (halves: string, word: string) => readonly [string, string],
  ) => {
    const machine = await fresh();
    let token = "";
    machine.box.answers.set("register", (run) => {
      const word = run.at(-1) ?? "";
      token = word.slice("--token=".length);
      const cut = Math.floor(token.length / 2);
      const halves = `${token.slice(0, cut)} ${token.slice(cut)}`;
      const [out, err] = printed(halves, word);
      return exited(1, out, err);
    });
    const done = await ran(machine);
    expect(machine.world.secrets).toEqual([token]);
    const text = done.lines.join("\n");
    for (const half of [token.slice(0, 20), token.slice(-20)])
      expect(text).not.toContain(half);
    expect(done.lines.at(-3)).toBe(
      `tell: Registering this machine did not work, so the runner is not set up yet. ${pickedUp}`,
    );
    return done.lines.at(-4);
  };
  const unshown =
    "found: registering this machine ended with exit 1, and what it printed is not shown, since it was handed the registration token";
  expect(await said((halves) => ["", `error: bad token ${halves}\n`])).toBe(
    unshown,
  );
  expect(await said((halves, word) => [`said ${word}\n`, halves])).toBe(
    unshown,
  );
  expect(
    await said((halves) => [
      "",
      `the registration token is unknown, spent or expired; mint another in chuggy's console (${halves})\n`,
    ]),
  ).toBe(
    "found: registering this machine ended with exit 1: the site did not take the registration token it had just made",
  );
});

test("a registration the package refuses for this machine's processor or for its name stops on what would have to change, and names no try that would have the site make another token", async () => {
  const refused = async (line: string) => {
    const machine = await fresh();
    machine.box.answers.set("register", exited(2, "", `${line}\n`));
    const done = await ran(machine);
    expect([done.exit, machine.world.mints.length], line).toEqual([1, 1]);
    expect(done.lines.join("\n"), line).not.toContain("try again");
    return done.lines.slice(-4);
  };
  expect(
    await refused(
      "this machine is riscv64, and a Linux pool runs on x64 or arm64",
    ),
  ).toEqual([
    "found: registering this machine ended with exit 2: the runner package does not run on this machine's kind of processor",
    "tell: The runner package does not run on this machine's kind of processor, so chuggy setup cannot set a runner up here. The work on your tickets needs a runner on a Linux machine it does run on. Tell me once one is running there.",
    `rule: Run node ${machineScript} ${flags} only once the person says a runner is running on another machine.`,
    stop,
  ]);
  const named =
    "this machine's name starts with a letter from a to z or a digit";
  expect(
    await refused(
      "this machine's hostname makes no pool name; name the pool with --pool",
    ),
  ).toEqual([
    "found: registering this machine ended with exit 2: this machine's name makes no name for a runner",
    `tell: The runner package names a runner after its machine, and this machine's name makes no name for one, so the runner is not set up yet. Running again as the machine is named now would end the same way. Tell me once ${named}.`,
    again(`once the person says ${named}`),
    stop,
  ]);
});

test("a token nothing would know by its shape is struck from what a later program says of it, because the run tells the redactor what it minted", async () => {
  const machine = await fresh();
  machine.world.letters = "Ab.Cd.Ef.Gh.Ij.";
  machine.box.answers.set("doctor", () =>
    exited(1, "", `FAIL  plane: denied ${machine.world.secrets[0] ?? ""}\n`),
  );
  const done = await ran(machine);
  expect(machine.world.secrets[0]).toMatch(/^registration1_Ab\.Cd\./u);
  expect(done.lines.at(-4)).toBe(
    "found: chuggy did not answer this machine as a runner; the runner's own check said: FAIL plane: denied [redacted]",
  );
});

test("a token that is not one word a command line carries whole is handed to nothing, and is said as an answer of the site's that could not be read", async () => {
  for (const letters of ["two words ", "line\nbreak", "bell\u0007"]) {
    const machine = await fresh();
    machine.world.letters = letters;
    const done = await ran(machine);
    expect(done.exit, letters).toBe(1);
    expect(times(machine, "register"), letters).toBe(0);
    expect(done.lines.at(-4), letters).toBe(
      "found: the site made no registration token for acme/widgets (Unreadable)",
    );
    expect(done.lines.slice(-2), letters).toEqual([again(asksAgain), stop]);
  }
});

test("the mint the site refuses is said by why: not an admin, as many unused as it keeps, or no answer; and nothing is run for it", async () => {
  const refused = async (prepare: (machine: SetupMachine) => void) => {
    const machine = await fresh();
    prepare(machine);
    const done = await ran(machine);
    expect(times(machine, "register")).toBe(0);
    expect(done.lines.at(-2)).toMatch(/^rule: Run node \S+ runner /u);
    return [done.exit, ...done.lines.slice(-4, -2)];
  };
  expect(
    await refused((machine) => {
      machine.world.fates.set("abilities", "Failed");
      for (const held of machine.world.projects) held.administer = false;
    }),
  ).toEqual([
    1,
    "found: the site made no registration token for acme/widgets (Absent)",
    "tell: The chuggy site would not make a registration for acme/widgets: that takes an admin of it. The runner package is on this machine and nothing is registered. Tell me once you are an admin of acme/widgets.",
  ]);
  expect(
    await refused((machine) => {
      const held = machine.world.projects[0]?.tokens ?? [];
      while (held.length < setupSiteTokensMax)
        held.push(`unused-${String(held.length)}`);
    }),
  ).toEqual([
    1,
    "found: the site made no registration token for acme/widgets (Conflict)",
    "tell: chuggy already holds as many unused registrations for acme/widgets as it keeps at once, so it made no more. Each lapses by itself within 60 minutes of being made. Tell me when you want me to try again.",
  ]);
  expect(
    await refused((machine) => {
      machine.world.fates.set("mint", "Failed");
    }),
  ).toEqual([
    1,
    "found: the site made no registration token for acme/widgets (Fault)",
    `tell: The chuggy site did not make a registration for acme/widgets, so this machine is not registered yet. ${pickedUp}`,
  ]);
});

test("a pool file the site lists no pool for is said and registered over, and a service found running from before is restarted so it runs as it is now registered", async () => {
  const machine = await fresh();
  await ran(machine);
  machine.world.projects[0]?.pools.splice(0);
  machine.box.acts.length = 0;
  const done = await ran(machine);
  expect(done.lines.slice(5, 7)).toEqual([
    `found: ${pool} registered this machine as ${boxPoolName}, and the site lists no runner of acme/widgets by that name`,
    did.pool,
  ]);
  expect(done.lines.slice(-5)).toEqual([
    found.unit,
    found.linger,
    `did: restarted ${unit}, so it runs as it is now registered and installed`,
    live,
    next,
  ]);
  expect(machine.box.acts.slice(-5)).toEqual([
    "enabled",
    "active",
    "reload",
    "restart",
    "active",
  ]);
  expect(writes(machine)).toEqual([mint, mint]);
});

test("the registration a run goes on with is the file register said it wrote, also beside one from before under another name, and the only one there where register said something else", async () => {
  const beside = await fresh();
  const before = pool.replace(`.${boxPoolName}.json`, ".a-name-before.json");
  beside.box.paths.set(before, "{}");
  const done = await ran(beside);
  expect(done.lines.slice(5, 7)).toEqual([
    `found: ${before} registered this machine as a-name-before, and the site lists no runner of acme/widgets by that name`,
    did.pool,
  ]);
  expect(done.lines.slice(-2)).toEqual([live, next]);
  const checked = beside.box.ran.find((run) => boxActOf(run) === "doctor");
  expect(checked?.at(-1)).toBe(pool);
  expect([...beside.box.units.keys()]).toEqual([unit]);

  const reworded = await fresh();
  reworded.box.answers.set("register", () => {
    reworded.box.paths.set(pool, "{}");
    reworded.world.projects[0]?.pools.push(boxPoolName);
    return exited(0, "registered.\n");
  });
  const other = await ran(reworded);
  expect(other.lines).toContain(did.pool);
  expect(other.lines.slice(-2)).toEqual([live, next]);
});

test("a package gone from a machine that was set up is installed again where it was, which writes the unit as it was, and its service is restarted onto it", async () => {
  const machine = await fresh();
  await ran(machine);
  machine.box.paths.delete(command);
  machine.box.acts.length = 0;
  machine.sent.length = 0;
  const done = await ran(machine);
  expect(done.lines.filter((line) => line.startsWith("did: "))).toEqual([
    did.package,
    did.restarted,
  ]);
  expect(done.lines).toContain(found.unit);
  expect(done.lines.slice(-2)).toEqual([live, next]);
  expect(times(machine, "service")).toBe(1);
  expect(times(machine, "register")).toBe(0);
  expect(writes(machine)).toEqual([]);
});

test("a service whose unit another copy of the package wrote, under another prefix or Node, is written again by the copy this run found and restarted onto it, for the project's runner and the person's own alike", async () => {
  const machine = await both();
  await ran(machine);
  const other = "/opt/node-22/bin/chuggy-linux";
  machine.box.paths.set(`${boxUnits}/${unit}`, boxUnitText(other, pool));
  machine.box.paths.set(`${boxUnits}/${ownUnit}`, boxUnitText(other, own));
  machine.box.acts.length = 0;
  machine.sent.length = 0;
  const done = await ran(machine);
  expect(done.exit).toBe(0);
  expect(done.lines.filter((line) => line.startsWith("did: "))).toEqual([
    did.unit,
    did.restarted,
    did.ownUnit,
    did.ownRestarted,
  ]);
  for (const [served, file] of [
    [unit, pool],
    [ownUnit, own],
  ] as const)
    expect(machine.box.paths.get(`${boxUnits}/${served}`)).toBe(
      boxUnitText(command, file),
    );
  expect(times(machine, "register")).toBe(0);
  expect(writes(machine)).toEqual([]);
});

test("a unit of the service's name that serves another registration, or that the package cannot read back, is refused by the package, and the run stops on its line, naming the unit and saying to remove it where it is stale, with nothing started or restarted", async () => {
  for (const [held, line] of [
    [
      boxUnitText(command, "/elsewhere.json"),
      `${boxUnits}/${unit} serves /elsewhere.json, not ${pool}; remove it if it is stale`,
    ],
    [
      "[Service]\nExecStart=/home/person/run-it-my-way\n",
      `${boxUnits}/${unit} has no ExecStart chuggy-linux wrote; remove it if it is stale`,
    ],
  ] as const) {
    const machine = await fresh();
    await ran(machine);
    machine.box.paths.set(`${boxUnits}/${unit}`, held);
    machine.box.acts.length = 0;
    const done = await ran(machine);
    expect(done.exit, line).toBe(1);
    expect(done.lines.slice(-4), line).toEqual([
      `found: installing the runner's service ended with exit 1, saying: ${line}`,
      `tell: Installing the runner's service did not work, so the runner is not set up yet: the runner package would not write it over the service already at ${boxUnits}/${unit}. If that one is left from a runner set up before, remove it, and tell me once you have or if you want me to try again.`,
      again(
        `once the person says ${boxUnits}/${unit} is removed, or asks to try again`,
      ),
      stop,
    ]);
    expect(machine.box.paths.get(`${boxUnits}/${unit}`), line).toBe(held);
    expect(machine.box.acts.at(-1), line).toBe("service");
  }
});

test("a service found running and not set to start at login is set to by the one command that starts it, is not restarted for that, and is not said to have been started; one found stopped is", async () => {
  const machine = await fresh();
  await ran(machine);
  const held = machine.box.units.get(unit);
  expect(held).toEqual({ enabled: true, active: true });
  if (held !== undefined) held.enabled = false;
  machine.box.acts.length = 0;
  const done = await ran(machine);
  expect(done.lines.slice(-4)).toEqual([found.linger, did.enabled, live, next]);
  const started = ["enabled", "active", "reload", "start", "active"];
  expect(machine.box.acts.slice(-5)).toEqual(started);
  expect(machine.box.units.get(unit)).toEqual({ enabled: true, active: true });

  if (held !== undefined) held.active = false;
  const stopped = await ran(machine);
  expect(stopped.lines.slice(-4)).toEqual([
    found.linger,
    did.started,
    live,
    next,
  ]);
  expect(machine.box.acts.slice(-5)).toEqual(started);
});

test("whether a pool file is good is the site's to say: an unread roster stops the run, a cut one that lists the pool is enough, and a cut one that does not is not taken for the pool being gone", async () => {
  const machine = await fresh();
  await ran(machine);
  machine.world.fates.set("pools", "Failed");
  const unread = await ran(machine);
  expect(unread.exit).toBe(1);
  expect(unread.lines.slice(-4, -2)).toEqual([
    "found: the site did not say of acme/widgets which runners it has (Fault)",
    "tell: The chuggy site did not answer everything I asked it, so I cannot say the runner is set up. What was done before stays done. Tell me if you want me to try again.",
  ]);
  machine.world.fates.set("pools", "Cut");
  expect((await ran(machine)).lines.slice(-2)).toEqual([live, next]);
  machine.world.projects[0]?.pools.splice(0);
  const cut = await ran(machine);
  expect(cut.lines.at(-4)).toBe(
    "found: the site did not say of acme/widgets which runners it has (Cut)",
  );
  expect(writes(machine)).toEqual([mint]);
});

test("the runner's own check is run before its service is started, and the first line that failed it is said in this program's words with the runner's own beside it", async () => {
  const machine = await fresh();
  machine.box.doctor = {
    exit: 1,
    aside:
      "warn  job network: chuggy-jobs is missing\nFAIL  container engine: docker at unix:///var/run/docker.sock did not answer\nFAIL  plane: no\n",
  };
  const done = await ran(machine);
  expect(done.exit).toBe(1);
  expect(done.lines.slice(-4)).toEqual([
    "found: the runner could not use the container engine; the runner's own check said: FAIL container engine: docker at unix:///var/run/docker.sock did not answer",
    "tell: The runner is installed and registered on this machine, and its own check did not pass: the runner could not use the container engine. What it said is: FAIL container engine: docker at unix:///var/run/docker.sock did not answer. Tell me once that is mended, or if you want me to try again.",
    again("once the person says it is mended or asks to try again"),
    stop,
  ]);
  expect(machine.box.acts.at(-1)).toBe("doctor");
  expect(times(machine, "service") + times(machine, "start")).toBe(0);

  machine.box.doctor = { exit: 1, aside: "FAIL  a new check: no\n" };
  expect((await ran(machine)).lines.at(-4)).toBe(
    "found: the runner's own check did not pass; the runner's own check said: FAIL a new check: no",
  );
  machine.box.doctor = { exit: 1, aside: "warn  plane: slow to answer\n" };
  expect((await ran(machine)).lines.at(-4)).toBe(
    "found: chuggy did not answer this machine as a runner; the runner's own check said: warn plane: slow to answer",
  );
  machine.box.doctor = { exit: 1, aside: "it fell over\n" };
  expect((await ran(machine)).lines.at(-4)).toBe(
    "found: the runner's own check ended with exit 1, saying: it fell over",
  );
});

test("a check that passed with a warning says the warning and goes on, and whatever the check prints that looks like a secret is struck", async () => {
  const machine = await fresh();
  const credential = "s3cr3tS3cr3tS3cr3tS3cr3tS3cr3t";
  machine.box.doctor = {
    exit: 0,
    aside: `warn  pool token: ${credential} is about to lapse\n`,
  };
  const done = await ran(machine);
  expect(done.lines[6]).toBe(
    "found: the runner's own check passed, with a warning: warn pool token: [redacted] is about to lapse",
  );
  expect(done.lines.slice(-2)).toEqual([live, next]);
  expect(done.lines.join("\n")).not.toContain(credential);
});

test("lingering already on is left, one that is off or unread is turned on, and one that wants a password is the person's to turn on in a terminal of their own", async () => {
  const on = await fresh();
  on.box.linger = "yes";
  expect((await ran(on)).lines).toContain(found.linger);
  expect(times(on, "lingerOn")).toBe(0);

  const unread = await fresh();
  unread.box.linger = undefined;
  unread.box.answers.set("lingerOn", exited(0));
  expect((await ran(unread)).lines).toContain(
    "did: set your services to keep running after you log out, not having learned whether they already did",
  );

  const asks = await fresh();
  asks.box.lingerAsks = true;
  const done = await ran(asks);
  expect(done.exit).toBe(0);
  expect(done.lines.slice(-4)).toEqual([
    `found: your services stop when you log out, and chuggy setup could not change that: loginctl said ${rosterLingerRefusal}`,
    "tell: The runner is installed and registered on this machine. For it to keep running after you log out, one command is yours to run, because it may ask for your password and chuggy setup never takes one. In a terminal of your own, run loginctl enable-linger and tell me once you have.",
    again("once the person says they have run it"),
    stop,
  ]);
  expect(times(asks, "start")).toBe(0);
  asks.box.linger = "yes";
  expect((await ran(asks)).lines.slice(-2)).toEqual([live, next]);

  const silent = await fresh();
  silent.box.answers.set("lingerOn", exited(0));
  expect((await ran(silent)).lines.at(-4)).toBe(
    "found: your services stop when you log out, and chuggy setup could not change that",
  );
});

test("a service that was started and is not running is a stop that says the state the service manager gave", async () => {
  const machine = await fresh();
  machine.box.stays = false;
  const done = await ran(machine);
  expect(done.exit).toBe(1);
  expect(done.lines.slice(-5)).toEqual([
    did.started,
    `found: ${unit} was started and is inactive`,
    `tell: The runner's service was started and is not running, so the runner is not set up yet. ${pickedUp}`,
    again(asksAgain),
    stop,
  ]);
});

/** How many times a run asked the site how the project's runners stand. */
function polls(machine: SetupMachine): number {
  return machine.sent.filter((asked) => asked.endsWith("/session-placement"))
    .length;
}

test("the site is asked until it sees the runner live and no longer than the wait, and the wait running out is a stop that says how long was waited", async () => {
  const machine = await fresh();
  machine.box.polls = false;
  const before = machine.nowMs;
  const done = await ran(machine, [...runner, "--wait-secs", "7"]);
  expect(done.exit).toBe(1);
  expect(done.lines.slice(-4)).toEqual([
    "found: the runner's service is running, and after 7 s the site still sees no runner of acme/widgets live",
    "tell: The runner is installed, registered and started on this machine, and the chuggy site does not see it live yet. It can take a little longer. Tell me when you want me to look again.",
    again("if the person asks to look again"),
    stop,
  ]);
  expect(polls(machine)).toBe(4);
  expect(machine.nowMs - before).toBe(3 * setupLivePollMs);
  expect(machine.box.acts.slice(-3)).toEqual(["start", "active", "active"]);

  machine.sent.length = 0;
  expect((await ran(machine, [...runner, "--wait-secs", "0"])).exit).toBe(1);
  expect(polls(machine)).toBe(1);

  for (const held of machine.world.projects) held.runner = "Unregistered";
  const unlisted = await ran(machine, [...runner, "--wait-secs", "0"]);
  expect(unlisted.lines.at(-4)).toBe(
    "found: the runner's service is running, and after 0 s the site lists no runner of acme/widgets",
  );
  for (const held of machine.world.projects) held.runner = "Offline";

  machine.sent.length = 0;
  machine.answering = () => {
    if (polls(machine) === 3)
      for (const held of machine.world.projects) held.runner = "Live";
  };
  const late = await ran(machine);
  expect(late.lines.slice(-3)).toEqual([found.running, live, next]);
  expect(polls(machine)).toBe(3);
});

test("a service that stops while the site is waited on is what the run says when the wait runs out, having asked the service manager once more, and not that it is running", async () => {
  const machine = await fresh();
  machine.box.polls = false;
  machine.answering = () => {
    const held = machine.box.units.get(unit);
    if (polls(machine) === 2 && held !== undefined) held.active = false;
  };
  const done = await ran(machine, [...runner, "--wait-secs", "7"]);
  expect(done.exit).toBe(1);
  expect(done.lines.slice(-5)).toEqual([
    did.started,
    `found: ${unit} was running and after 7 s is inactive`,
    `tell: The runner's service was started and is not running, so the runner is not set up yet. ${pickedUp}`,
    again(asksAgain),
    stop,
  ]);
  expect(polls(machine)).toBe(4);
  expect(machine.box.acts.slice(-3)).toEqual(["start", "active", "active"]);
});

test("a service manager that does not answer whether the service is running, or ends badly having printed nothing as one that cannot reach the person's services does, is said as that, straight after the start and after the wait, and never as a service that is not running", async () => {
  const silentFrom = async (ask: number, silent: SetupChildEnded) => {
    const machine = await fresh();
    machine.box.polls = false;
    let asked = 0;
    machine.box.answers.set("active", (): SetupChildEnded => {
      asked += 1;
      if (asked >= ask) return silent;
      return asked === 1 ? exited(3, "inactive\n") : exited(0, "active\n");
    });
    const done = await ran(machine, [...runner, "--wait-secs", "3"]);
    expect([done.exit, asked]).toEqual([1, ask]);
    expect(done.lines.slice(-3)).toEqual([
      `tell: This machine's user services did not answer when I asked whether the runner's service is running, so I cannot say the runner is set up. ${pickedUp}`,
      again(asksAgain),
      stop,
    ]);
    return done.lines.at(-4);
  };
  const unanswered =
    "this machine's user services did not answer whether it is running";
  const busless = exited(1, "", "Failed to connect to bus: No medium found\n");
  for (const silent of [{ ended: "Unended" } as const, busless]) {
    expect(await silentFrom(2, silent)).toBe(
      `found: ${unit} was started and ${unanswered}`,
    );
    expect(await silentFrom(3, silent)).toBe(
      `found: ${unit} was running and after 3 s ${unanswered}`,
    );
  }
});

test("a workspace or project named as a place an address would fold away is asked wrongly and nothing is asked of the site or the machine, and the names beside those are asked whole, each one part of the address", async () => {
  const places = [
    ["..", ".."],
    [".", "widgets"],
    ["acme", ".."],
    ["acme", "."],
  ] as const;
  for (const [workspace, project] of places)
    for (const asked of [[], ["runner"], ["sign-in"]]) {
      const machine = await fresh();
      machine.sent.length = 0;
      const argv = [...asked, "--workspace", workspace, "--project", project];
      expect((await ran(machine, argv)).exit, argv.join(" ")).toBe(2);
      expect(machine.sent, argv.join(" ")).toEqual([]);
      expect(machine.box.acts).toEqual([]);
    }
  const machine = await fresh();
  machine.sent.length = 0;
  const beside = ["--workspace", "...", "--project", "%2e%2e"];
  expect((await ran(machine, ["runner", ...beside])).lines.at(-1)).toBe(stop);
  const api = machine.sent.filter((asked) => asked.includes("/api/v1/"));
  expect(api.length).toBeGreaterThan(0);
  for (const asked of api)
    expect(asked).toMatch(
      new RegExp(
        `^GET ${machineSite}/api/v1/tenants/\\.\\.\\./projects/%252e%252e/`,
        "u",
      ),
    );
});

test("a project whose work the cluster runs needs no runner, and one this person does not administer gets none: either way the machine is not looked at", async () => {
  const hosted = await fresh();
  for (const held of hosted.world.projects) held.work = "InCluster";
  expect(await ran(hosted)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      "found: chuggy's cluster runs the work of acme/widgets, so it needs no runner",
      next,
    ],
  });
  const viewer = await fresh();
  for (const held of viewer.world.projects) held.administer = false;
  expect(await ran(viewer)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      "found: the site says you are not an admin of acme/widgets",
      "tell: Putting a runner on a project takes an admin of it, and the chuggy site says you are not one of acme/widgets, so nothing was changed on this machine. Ask an admin to make you one. Tell me once you are.",
      again("once the person says they are an admin of acme/widgets"),
      stop,
    ],
  });
  for (const machine of [hosted, viewer]) {
    expect(machine.box.ran).toEqual([]);
    expect(machine.box.read).toEqual([]);
    expect(writes(machine)).toEqual([]);
  }
});

test("where the project's work runs not read is a stop before the machine is looked at: a failure where the site failed, and the person's to take up where it does not show them the project", async () => {
  const machine = await fresh();
  machine.world.fates.set("work", "Failed");
  const failed = await ran(machine);
  expect([failed.exit, failed.lines.at(-4)]).toEqual([
    1,
    "found: the site did not say of acme/widgets where its work runs (Fault)",
  ]);
  const other = await ran(machine, [
    "runner",
    "--workspace",
    "acme",
    "--project",
    "gone",
  ]);
  expect([other.exit, ...other.lines.slice(-4, -1)]).toEqual([
    0,
    "found: the site does not show you acme/gone or where its work runs",
    "tell: The chuggy site does not show you what a runner for acme/gone is set up from, so nothing was changed on this machine. An admin of the workspace can see it, or can give you the access to. Tell me if your access changes.",
    `rule: Run node ${machineScript} runner --workspace acme --project gone only if the person says their access has changed.`,
  ]);
  expect(machine.box.ran).toEqual([]);
});

test("a read the site hides once the run has acted is the person's to take up as the first is, and says what was done stays done where the first says nothing was changed", async () => {
  const hidden = (what: string) => [
    `found: the site does not show you acme/widgets or ${what}`,
    "tell: The chuggy site does not show you what a runner for acme/widgets is set up from, so I cannot say the runner is set up. What was done before stays done. An admin of the workspace can see it, or can give you the access to. Tell me if your access changes.",
    again("if the person says their access has changed"),
    stop,
  ];
  const waited = await fresh();
  waited.world.fates.set("placement", "Refused");
  const unseen = await ran(waited);
  expect(unseen.exit).toBe(0);
  expect(unseen.lines.slice(-5)).toEqual([
    did.started,
    ...hidden("how its runners stand"),
  ]);
  expect(unseen.lines.slice(3, 5)).toEqual([did.package, did.settings]);

  const machine = await fresh();
  await ran(machine);
  machine.box.paths.delete(command);
  machine.world.fates.set("pools", "Refused");
  const unlisted = await ran(machine);
  expect(unlisted.exit).toBe(0);
  expect(unlisted.lines.slice(-5)).toEqual([
    did.package,
    ...hidden("which runners it has"),
  ]);
});

test("on a Mac runner says it cannot set one up and names no page, before it asks a site anything or looks at the machine, signed in or not", async () => {
  const lines = [
    "found: this machine is a Mac, and chuggy setup puts a runner only on Linux",
    "tell: chuggy setup puts a runner only on Linux and cannot set one up here, so nothing was changed on this machine. A Mac runs one with chuggy-darwin, added by hand, and a Linux machine runs one too. Tell me once one is running.",
    `rule: Run node ${machineScript} ${flags} only once the person says a runner is running.`,
    stop,
  ];
  const signed = await fresh();
  const stranger = setupMachine();
  for (const machine of [signed, stranger]) {
    machine.platform = "darwin";
    expect(await ran(machine)).toEqual({ exit: 2, lines });
    expect(machine.asked).toEqual([]);
    expect(machine.box.ran).toEqual([]);
    expect(machine.box.read).toEqual([]);
    expect(machine.lock).toBeUndefined();
  }
  expect(lines.join("\n")).not.toMatch(/https?:|\/runners/u);
});

test("not signed in, runner does nothing to the machine and says what the bare command says, with the project carried", async () => {
  const stranger = setupMachine();
  expect((await ran(stranger)).lines).toEqual([
    "found: no chuggy site is remembered on this machine yet",
    expect.stringMatching(
      new RegExp(`^rule: Run node \\S+ ${flags} --site with the address `, "u"),
    ),
    stop,
  ]);
  const out = await ran(stranger, [...runner, "--site", machineSite]);
  expect(out.lines.at(-1)).toBe(`next: node ${machineScript} sign-in ${flags}`);
  expect(stranger.box.ran).toEqual([]);
  expect(writes(stranger)).toEqual([]);
});

test("runner is not read without both names, and takes the wait the sign-in takes", async () => {
  const machine = await fresh();
  for (const argv of [
    ["runner"],
    ["runner", "--workspace", "acme"],
    ["runner", "--project", "widgets"],
  ])
    expect((await ran(machine, argv)).lines, argv.join(" ")).toEqual([
      "found: runner takes --workspace and --project, both: the project the runner is for",
      `next: node ${machineScript}`,
    ]);
  expect((await ran(machine, [...runner, "--wait-secs", "601"])).exit).toBe(2);
  expect((await ran(machine, [...runner, "--life-secs", "5"])).exit).toBe(2);
  expect(machine.box.ran).toEqual([]);
});

test("a bearer the site stops taking part-way is entered again under the lock as every run enters, and the run goes on with the mint made once", async () => {
  const machine = await fresh();
  let lapsed = false;
  machine.answering = () => {
    if (lapsed || machine.sent.at(-1) !== mint) return;
    lapsed = true;
    machine.lapse();
  };
  const done = await ran(machine);
  expect(done.lines.slice(-2)).toEqual([live, next]);
  expect(writes(machine)).toEqual([mint, mint]);
  expect(machine.world.mints).toHaveLength(1);
  expect(machine.locked).toEqual([
    `${machineSite}/access/v1/workspaces`,
    `${machineSite}/access/v1/workspaces`,
  ]);
  expect(times(machine, "register")).toBe(1);
});

test("a sign-in that cannot be entered again ends the run as not signed in, after everything the run had found and done by then, with what was done left done and nothing registered", async () => {
  const machine = await fresh();
  machine.answering = () => {
    if (machine.sent.at(-1) !== mint) return;
    machine.lapse();
    machine.token = "Refuses";
  };
  const done = await ran(machine);
  expect(done.exit).toBe(0);
  expect(done.lines.slice(0, 5)).toEqual([
    found.engine,
    found.login,
    did.package,
    did.settings,
    `site: ${machineSite}, not signed in`,
  ]);
  expect(done.lines.filter((line) => line.startsWith("site: "))).toHaveLength(
    1,
  );
  expect(done.lines.at(-1)).toBe(
    `next: node ${machineScript} sign-in ${flags}`,
  );
  expect(machine.world.mints).toEqual([]);
  expect([times(machine, "install"), times(machine, "register")]).toEqual([
    1, 0,
  ]);
});

/** The run as far as the mint, where the site stops taking its bearer and `then` is how the machine or the site is found when the sign-in is entered again. */
async function lapsedAt(then: (machine: SetupMachine) => void): Promise<Ran> {
  const machine = await fresh();
  machine.answering = () => {
    if (machine.sent.at(-1) !== mint) return;
    machine.lapse();
    then(machine);
  };
  return ran(machine);
}

const byMint = [found.engine, found.login, did.package, did.settings];

test("a sign-in entered again part-way that this machine does not keep ends the run on that fault after everything the run had found and done by then, and the same fault at the first entry is said alone as it always was", async () => {
  const session = `${machineKept}/session.json`;
  const fault = [
    `found: the sign-in was renewed and could not be kept: chuggy setup could not write ${session}`,
    `tell: chuggy setup renewed your sign-in and then could not write it to ${session} on this machine, so it was not kept and you may have to sign in again. Tell me once that path can be written.`,
    again(`once ${session} can be made and written`),
    stop,
  ];
  const unkept = (machine: SetupMachine) => {
    machine.takes = () => false;
  };
  expect(await lapsedAt(unkept)).toEqual({
    exit: 1,
    lines: [...byMint, ...fault],
  });
  const first = await fresh();
  first.lapse();
  unkept(first);
  expect(await ran(first)).toEqual({ exit: 1, lines: fault });
  expect(first.box.ran).toEqual([]);
});

test("a run ended part-way by another command holding the lock, or by a site that no longer answers as one, says it went no further after what it had done, and never that it did nothing", async () => {
  const busy = await lapsedAt((machine) => {
    machine.alive.add(4242);
    machine.lock = setupLockWord(4242, machine.nowMs);
  });
  expect(busy.lines).toEqual([
    ...byMint,
    "found: another chuggy setup command is running on this machine, as process 4242",
    "tell: Another chuggy setup command is still running on this machine, so this one went no further. I will run it again once the other has ended.",
    again("once that command has ended"),
    stop,
  ]);
  const tells = [
    `tell: ${machineSite} did not answer, so chuggy setup went no further. Check the address and that this machine can reach it, and tell me if you want me to try again.`,
    `tell: What answered at ${machineSite} is not a chuggy site this program can read, so chuggy setup went no further. Check the address, and tell me if you want me to try again.`,
  ];
  for (const [index, site] of (["Silent", "Garbles"] as const).entries()) {
    const out = await lapsedAt((machine) => {
      machine.site = site;
    });
    expect(out.lines.slice(0, byMint.length), site).toEqual(byMint);
    expect(out.lines.at(-3), site).toBe(tells[index]);
  }
});

test("a declined sign-in that still stands where a run enters its sign-in again part-way is said as where the run went no further, and as having changed nothing only where the run had done nothing", async () => {
  const declined = (machine: SetupMachine) => {
    machine.token = "Refuses";
    setupSignInNoteWritten(machine.ports().files, {
      note: "Ended",
      site: machineSite,
      ended: "Declined",
      endedAtMs: machine.nowMs,
      told: false,
    });
  };
  const told = (left: string) => [
    `site: ${machineSite}, not signed in`,
    "found: the sign-in was declined in the browser",
    `tell: The sign-in was declined in the browser, so chuggy setup is not signed in and ${left}. Tell me if you want to sign in after all.`,
  ];
  const partWay = await lapsedAt(declined);
  expect(partWay.lines.slice(0, byMint.length + 3)).toEqual([
    ...byMint,
    ...told("went no further"),
  ]);
  const first = await fresh();
  first.lapse();
  declined(first);
  const alone = await ran(first);
  expect(alone.lines.slice(0, 3)).toEqual(told("nothing was changed"));
  expect([partWay.lines.at(-1), alone.lines.at(-1)]).toEqual([stop, stop]);
  expect(first.box.ran).toEqual([]);
});

const pages = `${machineSite}/acme/widgets`;
const offer = `rule: Run node ${machineScript} runner ${flags} only once the person says yes to a runner on this machine.`;
const runnerIs =
  "The next step is a runner: the machine that does the work on your tickets";

test("the bare command, where a runner is next and this machine could take one, says once what runner would put here and names it only under the person's yes, having looked at the machine and changed nothing", async () => {
  const machine = await fresh();
  const before = new Map(machine.box.paths);
  const done = await ran(machine, []);
  expect(done.exit).toBe(0);
  expect(done.lines.slice(-5)).toEqual([
    "step: runner      todo",
    "step: ticket      todo",
    `tell: ${runnerIs}. I can make this machine one. That puts here the runner package, chuggy-linux, and a background service of yours that starts when you log in; work on your tickets then runs on this machine in containers, on your Claude plan. Tell me yes to go ahead. For a runner on another machine instead, that machine's own browser opens ${pages}/runners, where you press Add runner.`,
    offer,
    stop,
  ]);
  expect(machine.box.acts).toEqual(["services", "docker"]);
  expect(machine.box.paths).toEqual(before);
  expect(machine.box.read).toEqual([]);
  expect(writes(machine)).toEqual([]);
});

test("from the offer to live: the command the rule names sets the runner up, and the checklist it ends on says the runner's step done", async () => {
  const machine = await fresh();
  const offered = await ran(machine, []);
  const ruled = /^rule: Run node \S+ (.+) only once /u.exec(
    offered.lines.at(-2) ?? "",
  );
  expect(ruled?.[1]?.split(" ")).toEqual(runner);
  const set = await ran(machine, ruled?.[1]?.split(" "));
  const after = await ran(machine, set.lines.at(-1)?.split(" ").slice(3));
  expect(
    after.lines.filter((line) => /^step: (?:runner|ticket) /u.test(line)),
  ).toEqual(["step: runner      done     live", "step: ticket      todo"]);
  expect(after.lines.at(-2)).toBe(
    `rule: Run node ${machineScript} ${flags} only once the person says the ticket is created.`,
  );
});

test("where the person's chats run on runners, the bare command offers two services of theirs here, one for the project's work and one for their own chats, and says the runner's step done only once the site sees both live", async () => {
  const machine = await both();
  const offered = await ran(machine, []);
  expect(offered.lines.slice(-3)).toEqual([
    `tell: ${runnerIs}. I can make this machine one. That puts here the runner package, chuggy-linux, and two background services of yours that start when you log in: one for the work on your project's tickets, one for your own chats, which run only on a runner of your own. Both run on this machine in containers, on your Claude plan. Tell me yes to go ahead. For a runner on another machine instead, that machine's own browser opens ${pages}/runners, where you press Add runner.`,
    offer,
    stop,
  ]);
  await ran(machine);
  const step = async () =>
    (await ran(machine, [])).lines.find((line) =>
      line.startsWith("step: runner "),
    );
  expect(await step()).toBe("step: runner      done     live");
  const held = machine.world.own.get("acme");
  if (held === undefined) throw new Error("no runner of the person's own");
  held.live = false;
  expect(await step()).toBe(
    "step: runner      waiting  live; your own runner is set up for it, not running",
  );
  machine.world.own.delete("acme");
  expect(await step()).toBe(
    "step: runner      todo     live; your own runner is not set up for it",
  );
});

/** As much of a tell as says which of the machine's lacks it is of. */
const tellHead = 140;

test("the bare command says why this machine cannot take a runner where it cannot, offers nothing, and still names the page for another machine", async () => {
  const told = async (prepare: (machine: SetupMachine) => void) => {
    const machine = await fresh();
    prepare(machine);
    const done = await ran(machine, []);
    expect(done.lines.join("\n")).not.toContain(" runner --workspace");
    expect(done.lines.at(-3)).toContain(`${pages}/runners`);
    return [done.lines.at(-3)?.slice(0, tellHead), machine.box.acts];
  };
  expect(
    await told((machine) => {
      machine.platform = "darwin";
    }),
  ).toEqual([
    `tell: ${runnerIs}. This machine is a Mac and chuggy setup puts a runner only on Linux, but a Mac runs one with chuggy-darwin, added by hand`.slice(
      0,
      tellHead,
    ),
    [],
  ]);
  expect(
    await told((machine) => {
      machine.box.services = false;
    }),
  ).toEqual([
    `tell: ${runnerIs}. chuggy setup runs one as a background service of yours, and this machine's user services did not answer`.slice(
      0,
      tellHead,
    ),
    ["services"],
  ]);
  expect(
    await told((machine) => {
      machine.box.engines.docker = "No";
    }),
  ).toEqual([
    `tell: ${runnerIs}, in containers. This machine cannot be one yet: neither Docker nor Podman answered here without a password`.slice(
      0,
      tellHead,
    ),
    ["services", "docker", "podman"],
  ]);
  expect(
    await told((machine) => {
      machine.user = "1001";
    }),
  ).toEqual([
    `tell: ${runnerIs}, in containers. This machine cannot be one yet. Under docker a runner's work runs as this machine's user 1000`.slice(
      0,
      tellHead,
    ),
    ["services", "podman"],
  ]);
});

test("a runner registered and not running is offered to be started here only where this machine holds a registration for the project, and the offer says the machine is registered again where the site no longer knows that one", async () => {
  const elsewhere = await machineSignedIn(projectOnly(setupSiteAt("Offline")));
  expect((await ran(elsewhere, [])).lines.slice(-3)).toEqual([
    "tell: A runner is registered and is not running. Start it on its machine and tell me once it is running.",
    `rule: Run node ${machineScript} only once the person says the runner is running.`,
    stop,
  ]);
  const here = await fresh();
  await ran(here);
  for (const unit of here.box.units.values()) unit.active = false;
  for (const held of here.world.projects) held.runner = "Offline";
  const offered = await ran(here, []);
  expect(offered.lines.slice(-2)).toEqual([offer, stop]);
  const holds =
    "tell: A runner is registered for acme/widgets and is not running, and this machine holds a registration for that project. With your yes I will check it and start it here as a background service of yours that starts when you log in, registering this machine again first if the site no longer knows that registration, so work on your tickets runs on this machine in containers, on your Claude plan. If the runner package here, chuggy-linux, is older than chuggy setup needs, I install its latest release first. Tell me yes to go ahead.";
  expect(offered.lines.at(-3)).toBe(holds);
  const started = await ran(here);
  expect(started.lines.slice(-3)).toEqual([did.started, live, next]);
  expect(writes(here)).toEqual([mint]);

  const stale = await machineSignedIn(projectOnly(setupSiteAt("Offline")));
  const old = `${boxPools}/acme.widgets.oldname.json`;
  stale.box.paths.set(old, "{}");
  expect((await ran(stale, [])).lines.slice(-3)).toEqual([holds, offer, stop]);
  const anew = await ran(stale);
  expect(anew.lines).toContain(
    `found: ${old} registered this machine as oldname, and the site lists no runner of acme/widgets by that name`,
  );
  expect(anew.lines).toContain(did.pool);
  expect(writes(stale)).toEqual([mint]);
});

test("the machine is looked at only where the runner's step is the one next, and at no stage is anything on it changed or anything but a read sent", async () => {
  const looked: string[] = [];
  for (const stage of setupSiteStages) {
    const machine = await machineSignedIn(setupSiteAt(stage));
    const before = new Map(machine.box.paths);
    await ran(machine, []);
    if (machine.box.ran.length > 0) looked.push(stage);
    expect(machine.box.acts, stage).toEqual(
      machine.box.ran.length > 0 ? ["services", "docker"] : [],
    );
    expect(machine.box.paths, stage).toEqual(before);
    expect(writes(machine), stage).toEqual([]);
  }
  expect(looked).toEqual(["Configured", "Offline"]);
});

/** An API that records what reached it and answers a mint. */
function reaching(): { readonly api: ApiPorts; readonly reached: string[] } {
  const reached: string[] = [];
  return {
    reached,
    api: {
      fetch: (url, init) => {
        reached.push(`${init.method} ${url}`);
        return Promise.resolve(
          new Response(JSON.stringify({ token: "t", expiresAtMs: 1 }), {
            status: 201,
          }),
        );
      },
      bearer: () => Promise.resolve("the session's own"),
      sleepMs: () => Promise.resolve(),
    },
  };
}

test("the ports the writes go out through pass the mint for this project's runner, the mint for the person's own, this project added to what theirs serves, and any read, and refuse every other write having reached nothing", async () => {
  const { api, reached } = reaching();
  const partition = { tenant: "two words", project: "a/b" };
  const ports = setupWritePorts(api, "the run's", partition);
  const tenant = "/api/v1/tenants/two%20words";
  const path = `${tenant}/projects/a%2Fb/worker-pool-registration-tokens`;
  const personal = `${tenant}/personal-runner-registration-tokens`;
  const project = `${tenant}/personal-runner/projects/a%2Fb`;
  const init = (method: string) => ({
    method,
    headers: {},
    signal: new AbortController().signal,
  });
  const asked = { capabilities: [], lifetimeSecs: 1 };
  expect((await apiMintWorkerPoolToken(ports, partition, asked)).outcome).toBe(
    "Ok",
  );
  expect(
    (await apiMintPersonalRunnerToken(ports, partition.tenant, asked)).outcome,
  ).toBe("Ok");
  expect((await apiPersonalRunnerServes(ports, partition, true)).outcome).toBe(
    "Ok",
  );
  await ports.fetch("/api/v1/projects", init("GET"));
  for (const [method, url] of [
    [
      "POST",
      "/api/v1/tenants/acme/projects/a%2Fb/worker-pool-registration-tokens",
    ],
    ["POST", `${path}/`],
    ["POST", `${path}?x=1`],
    ["POST", "/api/v1/worker-pool-registrations"],
    ["POST", "/api/v1/personal-runner-registrations"],
    ["POST", "/api/v1/tenants/acme/personal-runner-registration-tokens"],
    ["PUT", `${tenant}/personal-runner/projects/other`],
    ["DELETE", project],
    ["DELETE", `${tenant}/personal-runner`],
    ["DELETE", path],
    ["PUT", path],
    ["PATCH", path],
  ] as const)
    await expect(
      ports.fetch(url, init(method)),
      `${method} ${url}`,
    ).rejects.toThrow("the checklist sends nothing but reads");
  expect(reached).toEqual([
    `POST ${path}`,
    `POST ${personal}`,
    `PUT ${project}`,
    "GET /api/v1/projects",
  ]);
  expect(await ports.bearer()).toBe("the run's");
});
