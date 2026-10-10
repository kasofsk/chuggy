/**
 * `runner`, over a machine and an installation that are both doubles: what it
 * does on each state of the machine, what it says, and what it never does.
 *
 * Every case that prints checks that no secret the doubles handed out is in a
 * line: no bearer, no renewal token, no registration token, no pool
 * credential, and nothing of the Claude login. The machine is a box whose
 * programs answer as the real ones were found to, so a case moves one probe or
 * one act and reads what the run then did.
 */

import { expect, test } from "vitest";

import type { ApiPorts } from "../app/core/apiRequest.ts";
import { apiMintWorkerPoolToken } from "../app/core/apiRoutes.ts";
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
  setupMintPorts,
} from "../app/core/setupRunner.ts";
import { setupLockWord } from "../app/core/setupStore.ts";
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
  boxPoolFile,
  boxPoolName,
  boxPools,
  boxPrefix,
  boxSettings,
  boxUnitName,
  boxUnits,
  exited,
} from "./setupRunnerBox.ts";
import type { BoxAct } from "./setupRunnerBox.ts";
import { rosterLines, rosterLingerRefusal } from "./setupRunnerRoster.ts";
import {
  setupSiteAt,
  setupSiteStages,
  setupSiteTokensMax,
} from "./setupSite.ts";

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

/** One command as the entry prints it, which holds no secret whatever the run met. */
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
  return { exit: setupReportExit(report), lines };
}

/** A machine signed in to a site set up as far as a runner, with nothing of a runner on it but an engine and a Claude login. */
function fresh(): Promise<SetupMachine> {
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
});

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

test("a second run on a machine that has everything finds each thing as it is, does none of it again, and sends the site nothing but reads", async () => {
  const machine = await fresh();
  await ran(machine);
  machine.box.acts.length = 0;
  machine.sent.length = 0;
  expect(await ran(machine)).toEqual({
    exit: 0,
    lines: [
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
      next,
    ],
  });
  expect(machine.box.acts).toEqual([
    "services",
    "docker",
    "doctor",
    "linger",
    "enabled",
    "active",
  ]);
  expect(writes(machine)).toEqual([]);
  expect(machine.sent.length).toBeGreaterThan(2);
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
      `did: installed the runner package, chuggy-linux 0.3.0, at ${boxOwn}/bin/chuggy-linux`,
    );
    expect(done.lines.slice(-2), sealed).toEqual([live, next]);
    expect((await ran(machine)).lines[4], sealed).toBe(
      `found: the runner package is installed: chuggy-linux 0.3.0, at ${boxOwn}/bin/chuggy-linux`,
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

test("the Claude login is looked for and never read, where it is and where the settings say it is", async () => {
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
});

test("with no Claude login the run stops before anything is changed, says this program cannot make one yet, and tells the agent never to make one itself", async () => {
  const machine = await fresh();
  machine.box.paths.delete(boxLogin);
  expect(await ran(machine)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      found.engine,
      `found: the runner has no Claude login on this machine: nothing is at ${boxLogin}`,
      `tell: The runner needs a Claude login of its own on this machine, in ${boxLogin}, and chuggy setup cannot make that yet, so nothing was changed on this machine. The runner's guide says how it is made by hand: ${runnerPackageOffered.guideAddress}. Tell me once it is there.`,
      "rule: Never make, read or print a Claude login yourself: it is a secret, and one made from this conversation would be shown in it.",
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
  expect((await ran(machine)).lines.slice(-2)).toEqual([live, next]);
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
  "Under docker a runner's work runs as this machine's user 1000, which could not read your Claude login, so the runner package takes docker only from that user, and you are user 1001.";
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
        `tell: The runner's settings file, ${boxSettings}, is there, and chuggy setup could not read from it which engine and which Claude login the runner uses, so nothing was changed on this machine. The runner's guide says what the file holds: ${runnerPackageOffered.guideAddress}. Tell me once it is mended.`,
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

test("with no package and an npm that does not answer the run stops before anything is changed, and a package under the person's own prefix is found without npm", async () => {
  const machine = await fresh();
  machine.box.prefix = undefined;
  expect(await ran(machine)).toEqual({
    exit: 0,
    lines: [
      signedIn,
      found.engine,
      found.login,
      "found: the runner package is not installed, and npm did not answer",
      "tell: The runner package is installed with npm, and npm did not answer on this machine, so nothing was changed on this machine. npm comes with Node. Tell me once npm runs here.",
      again("once the person says npm runs on this machine"),
      stop,
    ],
  });
  expect(machine.box.acts).toEqual(["services", "docker"]);
  machine.box.paths.set(`${boxOwn}/bin/chuggy-linux`, "#!/usr/bin/env node");
  const done = await ran(machine);
  expect(done.lines[3]).toBe(
    `found: the runner package is installed: chuggy-linux, at ${boxOwn}/bin/chuggy-linux`,
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

test("an act that ended well and left nothing where it makes its thing is said as that, and nothing is built on it", async () => {
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
  "a run that ended the moment %s was done is picked up by the next, which does nothing a second time",
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
    ).toEqual([1, 1, 1, 1, 1]);
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

test("a package gone from a machine that was set up is installed again, and the unit written for the one before is written again by the one now there and its service restarted", async () => {
  const machine = await fresh();
  await ran(machine);
  machine.box.paths.delete(command);
  machine.box.acts.length = 0;
  machine.sent.length = 0;
  const done = await ran(machine);
  expect(done.lines.filter((line) => line.startsWith("did: "))).toEqual([
    did.package,
    did.unit,
    did.restarted,
  ]);
  expect(done.lines.slice(-2)).toEqual([live, next]);
  expect(times(machine, "service")).toBe(1);
  expect(times(machine, "register")).toBe(0);
  expect(writes(machine)).toEqual([]);
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
    "tell: The chuggy site did not answer everything I asked it, so the runner is not set up yet. What was done before stays done. Tell me if you want me to try again.",
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

test("a service manager that does not answer whether the service is running is said as that, straight after the start and after the wait, and never as a service that is not running", async () => {
  const silentFrom = async (ask: number) => {
    const machine = await fresh();
    machine.box.polls = false;
    let asked = 0;
    machine.box.answers.set("active", (): SetupChildEnded => {
      asked += 1;
      if (asked >= ask) return { ended: "Unended" };
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
  expect(await silentFrom(2)).toBe(
    `found: ${unit} was started and ${unanswered}`,
  );
  expect(await silentFrom(3)).toBe(
    `found: ${unit} was running and after 3 s ${unanswered}`,
  );
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

test("on a Mac runner says it cannot set one up and names no page, before it asks a site anything or looks at the machine, signed in or not", async () => {
  const lines = [
    "found: this machine is a Mac, and chuggy's runner runs on Linux",
    "tell: chuggy has no runner for a Mac yet, and chuggy setup cannot set one up here, so nothing was changed on this machine. The work on your tickets needs a runner on a Linux machine. Tell me once one is running there.",
    `rule: Run node ${machineScript} ${flags} only once the person says a runner is running on another machine.`,
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
    `tell: ${runnerIs}. This machine is a Mac and chuggy has no runner for a Mac yet, so it cannot be one. A runner needs a machine`.slice(
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
  const elsewhere = await machineSignedIn(setupSiteAt("Offline"));
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
    "tell: A runner is registered for acme/widgets and is not running, and this machine holds a registration for that project. With your yes I will check it and start it here as a background service of yours that starts when you log in, registering this machine again first if the site no longer knows that registration, so work on your tickets runs on this machine in containers, on your Claude plan. Tell me yes to go ahead.";
  expect(offered.lines.at(-3)).toBe(holds);
  const started = await ran(here);
  expect(started.lines.slice(-3)).toEqual([did.started, live, next]);
  expect(writes(here)).toEqual([mint]);

  const stale = await machineSignedIn(setupSiteAt("Offline"));
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

test("the ports the mint goes out through pass this project's mint and any read, and refuse every other write having reached nothing", async () => {
  const { api, reached } = reaching();
  const partition = { tenant: "two words", project: "a/b" };
  const ports = setupMintPorts(api, "the run's", partition);
  const path =
    "/api/v1/tenants/two%20words/projects/a%2Fb/worker-pool-registration-tokens";
  const init = (method: string) => ({
    method,
    headers: {},
    signal: new AbortController().signal,
  });
  const minted = await apiMintWorkerPoolToken(ports, partition, {
    capabilities: [],
    lifetimeSecs: 1,
  });
  expect(minted.outcome).toBe("Ok");
  await ports.fetch("/api/v1/projects", init("GET"));
  for (const [method, url] of [
    [
      "POST",
      "/api/v1/tenants/acme/projects/a%2Fb/worker-pool-registration-tokens",
    ],
    ["POST", `${path}/`],
    ["POST", `${path}?x=1`],
    ["POST", "/api/v1/worker-pool-registrations"],
    ["DELETE", path],
    ["PUT", path],
    ["PATCH", path],
  ] as const)
    await expect(
      ports.fetch(url, init(method)),
      `${method} ${url}`,
    ).rejects.toThrow("the checklist sends nothing but reads");
  expect(reached).toEqual([`POST ${path}`, "GET /api/v1/projects"]);
  expect(await ports.bearer()).toBe("the run's");
});
