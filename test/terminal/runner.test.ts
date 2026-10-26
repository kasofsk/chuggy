/**
 * `runner` as a process, on a stand-in machine and against a stand-in
 * installation: the real program, real children, real files and real HTTP,
 * with nothing of this machine in any of it.
 *
 * These are the cases only real processes make of what a run sets up, and
 * sets up again; where a run stops is
 * `test/terminal/runnerStops.test.ts`'s. The registration token is one word of
 * one child's arguments and is in nothing the program writes. Every child is
 * given nothing to read and a session of its own, so none can ask a person for
 * a password, and no command that asks for one is run. The site is sent the
 * mints and the project added to what the person's own runner serves, and none
 * of them where the machine and that runner already have what they need. Most
 * cases are of a project whose chats run on the cluster, so of the project's
 * runner alone; the person's own beside it has cases of its own. Every run
 * takes itself for the user the runner package takes docker from, whoever the
 * suite runs as. The last case is the control: everything every run here wrote
 * is searched for everything the stand-ins handed out and for the runner's
 * Claude login.
 */

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { runnerPackageOffered } from "../../ui/chuggy-ui/app/core/runners.ts";
import { setupSiteOwnAdded } from "../../ui/chuggy-ui/test/setupSite.ts";

import { machineLoginSecret } from "./machine.ts";
import { program, shellWords, userSaid } from "./program.ts";
import {
  type Stood,
  acts,
  again,
  cleared,
  first,
  lines,
  mint,
  next,
  ownFile,
  ownUnit,
  poolFile,
  probes,
  ran,
  redemption,
  rerun,
  runner,
  stood,
  stoodSearched,
  unasked,
  unit,
  user,
  words,
} from "./runnerStood.ts";

const ownMint =
  "program POST /api/v1/tenants/acme/personal-runner-registration-tokens";
const ownRedemption = "runner POST /api/v1/personal-runner-registrations";
const serves =
  "program PUT /api/v1/tenants/acme/personal-runner/projects/widgets";

/** The arguments of a command the program printed, as a shell makes words of it. */
async function commanded(command: string): Promise<readonly string[]> {
  const [node, script, ...argv] = await shellWords(command);
  assert.deepEqual([node, script], ["node", program], command);
  return argv;
}

/** A fresh machine taken through `runner` to a runner the site sees live. */
async function setUp(): Promise<Stood> {
  const on = await stood();
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.equal(done.lines.at(-1), next, done.stdout);
  return on;
}

test("on a fresh machine the bare command offers a runner having changed nothing, and the command its rule names installs, registers, checks and starts one, with the token one word of one command, and ends on a checklist that says the runner live", async () => {
  const on = await stood();
  const { found, did } = lines(on);
  const offered = await ran(on, []);
  assert.equal(offered.code, 0, offered.stdout);
  assert.equal(offered.lines.at(-1), "next: stop");
  const rule = offered.lines.at(-2) ?? "";
  const yes = " only once the person says yes to a runner on this machine.";
  assert.ok(rule.startsWith("rule: Run ") && rule.endsWith(yes), rule);
  assert.deepEqual(acts(on), ["services", "docker"]);
  assert.deepEqual(on.installation.writes, []);
  assert.ok(!existsSync(on.machine.settings));

  cleared(on);
  const argv = await commanded(rule.slice("rule: Run ".length, -yes.length));
  assert.deepEqual(argv, runner);
  const done = await ran(on, argv);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines, [
    `site: ${on.installation.site}, signed in`,
    found.engine,
    found.login,
    did.package,
    did.settings,
    did.pool,
    found.check,
    did.unit,
    did.linger,
    did.started,
    found.live,
    next,
  ]);
  assert.deepEqual(acts(on), first);
  assert.deepEqual(on.installation.writes, [mint, redemption]);
  const [token = ""] = on.installation.world.secrets;
  assert.deepEqual(words(on, "chuggy-linux")[0], [
    "register",
    "--api",
    on.installation.site,
    `--token=${token}`,
  ]);
  const carrying = on.machine
    .calls()
    .flatMap((call) => call.argv)
    .filter((word) => word.includes(token));
  assert.equal(carrying.length, 1);
  assert.deepEqual(words(on, "npm"), [
    ["prefix", "-g"],
    runnerPackageOffered.installCommand.split(" ").slice(1),
    ["prefix", "-g"],
  ]);
  assert.deepEqual(words(on, "loginctl"), [
    ["show-user", user, "--property", "Linger"],
    ["--no-ask-password", "enable-linger", user],
    ["show-user", user, "--property", "Linger"],
  ]);
  unasked(on);
  assert.equal(readFileSync(on.machine.login, "utf8"), machineLoginSecret);

  const after = await ran(on, await commanded(next.slice("next: ".length)));
  assert.ok(after.lines.includes("step: runner      done     live"));
  assert.deepEqual(on.installation.writes, [mint, redemption]);
});

test("a second run on a machine that has everything finds each thing as it is, runs nothing but its probes and an install-service that writes its unit as it was, and sends the site no write", async () => {
  const on = await setUp();
  const { found } = lines(on);
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines, [
    `site: ${on.installation.site}, signed in`,
    found.engine,
    found.settings,
    found.login,
    found.package,
    found.pool,
    found.check,
    found.unit,
    found.linger,
    found.running,
    found.live,
    next,
  ]);
  assert.deepEqual(acts(on), rerun);
  assert.deepEqual(on.installation.writes, []);
  assert.equal(on.installation.world.mints.length, 1);
  unasked(on);
});

/** The words each registration was run with, a pool's and the person's own. */
function registrations(on: Stood): readonly (readonly string[])[] {
  return words(on, "chuggy-linux").filter((argv) => argv[0] === "register");
}

test("where the person's chats run on runners and they have none, the bare command offers two services of theirs here, and the command its rule names makes this machine the project's runner and then their own, on one package, one settings file and one Claude login, and ends on a checklist that says the runner's step done", async () => {
  const on = await stood("Pool");
  const { found, did } = lines(on);
  const offered = await ran(on, []);
  assert.equal(offered.code, 0, offered.stdout);
  assert.match(
    offered.lines.at(-3) ?? "",
    / two background services of yours that start when you log in: one for the work on your project's tickets, one for your own chats, /u,
  );
  const rule = offered.lines.at(-2) ?? "";
  const yes = " only once the person says yes to a runner on this machine.";
  assert.ok(rule.startsWith("rule: Run ") && rule.endsWith(yes), rule);
  assert.deepEqual(on.installation.writes, []);

  cleared(on);
  const done = await ran(
    on,
    await commanded(rule.slice("rule: Run ".length, -yes.length)),
  );
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines, [
    `site: ${on.installation.site}, signed in`,
    found.engine,
    found.login,
    did.package,
    did.settings,
    did.pool,
    found.check,
    did.unit,
    did.linger,
    did.started,
    found.live,
    did.own,
    did.ownUnit,
    did.ownStarted,
    did.serves,
    found.ownLive,
    next,
  ]);
  assert.deepEqual(on.installation.writes, [
    mint,
    redemption,
    ownMint,
    ownRedemption,
    serves,
  ]);
  const [, token = ""] = on.installation.world.secrets.filter((secret) =>
    secret.includes("registration"),
  );
  assert.deepEqual(registrations(on)[1], [
    "register",
    "--personal",
    "--api",
    on.installation.site,
    `--token=${token}`,
  ]);
  assert.deepEqual(words(on, "chuggy-linux").at(-1), [
    "install-service",
    "--pool",
    join(on.machine.pools, ownFile),
  ]);
  assert.equal(acts(on).filter((act) => act === "install").length, 1);
  assert.ok(existsSync(join(on.machine.units, ownUnit)));
  assert.equal(readFileSync(on.machine.login, "utf8"), machineLoginSecret);
  unasked(on);

  const after = await ran(on, await commanded(next.slice("next: ".length)));
  assert.ok(after.lines.includes("step: runner      done     live"));
});

/** A fresh machine, where the person's chats run on runners, taken through `runner` to both runners the site sees live. */
async function setUpBoth(): Promise<Stood> {
  const on = await stood("Pool");
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.equal(done.lines.at(-2), lines(on).found.ownLive, done.stdout);
  return on;
}

test("a second run where both runners are live and the person's own serves the project changes nothing, says each thing as found, writes both units again only as they were, and sends the site no write", async () => {
  const on = await setUpBoth();
  const { found } = lines(on);
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(-7), [
    found.live,
    found.own,
    found.ownUnit,
    found.ownRunning,
    found.serves,
    found.ownLive,
    next,
  ]);
  assert.ok(!done.lines.some((line) => line.startsWith("did: ")));
  assert.deepEqual(acts(on), [...rerun, "service", "enabled", "active"]);
  assert.deepEqual(on.installation.writes, []);
});

test("a workspace that does not let the person register a runner of their own stops the run once the project's runner is live, says an admin, who may be the person, turns on Personal runners for them with Edit on their row of the People page, and the run its rule names finishes the job", async () => {
  const on = await stood("Pool");
  on.installation.world.withheld.add("acme");
  const withheld = await ran(on);
  assert.equal(withheld.code, 0, withheld.stdout);
  assert.deepEqual(withheld.lines.slice(-5), [
    lines(on).found.live,
    "found: the workspace does not let you register a runner of your own",
    `tell: The runner for the work on acme/widgets is set up and live. Your chats there run only on a runner of your own, and the workspace does not let you register one yet. An admin of the workspace, you if you are one, turns on Personal runners for you on its People page, ${on.installation.site}/tenants/acme/settings/people, with Edit on your row. Tell me once it is on.`,
    `${again}once the person says Personal runners is on for them in the workspace.`,
    "next: stop",
  ]);
  assert.deepEqual(on.installation.writes, [mint, redemption]);
  assert.equal(registrations(on).length, 1);

  on.installation.world.withheld.delete("acme");
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(-2), [lines(on).found.ownLive, next]);
  assert.deepEqual(on.installation.writes, [ownMint, ownRedemption, serves]);
});

test("the person's own runner on this machine that serves another project is given this one, and nothing is registered again", async () => {
  const on = await setUpBoth();
  const { found, did } = lines(on);
  const held = on.installation.world.own.get("acme");
  assert.ok(held !== undefined);
  held.projects = ["gadgets"];
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(-6), [
    found.own,
    found.ownUnit,
    found.ownRunning,
    did.serves,
    found.ownLive,
    next,
  ]);
  assert.deepEqual(on.installation.writes, [serves]);
  assert.deepEqual(registrations(on), []);
  assert.deepEqual(held.projects, ["gadgets", "widgets"]);
});

test("a runner of the person's own on another machine is kept, and this machine is registered as one more of theirs, with a file and a service of its own, and waited on until the site sees it live", async () => {
  const on = await stood("Pool");
  const { found, did } = lines(on);
  const elsewhere = setupSiteOwnAdded(on.installation.world, "acme", true);
  on.installation.world.own.get("acme")?.projects.push("gadgets");
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(-7), [
    found.live,
    did.own,
    did.ownUnit,
    did.ownStarted,
    did.serves,
    found.ownLive,
    next,
  ]);
  assert.deepEqual(on.installation.writes, [
    mint,
    redemption,
    ownMint,
    ownRedemption,
    serves,
  ]);
  assert.equal(registrations(on).length, 2);
  assert.ok(existsSync(join(on.machine.pools, ownFile)));
  assert.ok(existsSync(join(on.machine.units, ownUnit)));
  assert.deepEqual(on.installation.world.own.get("acme"), {
    projects: ["gadgets", "widgets"],
    runners: [
      { id: elsewhere, live: true },
      { id: "chuggy-personal-2", live: true },
    ],
  });
});

test("a machine whose project's runner was set up on a package older than the first that updates itself has it installed again by the same command, its service restarted onto the new one, and the run finishes the job", async () => {
  const on = await setUp();
  const { found, did } = lines(on);
  const installs = () => words(on, "npm").filter((argv) => argv[0] === "i");
  const [install] = installs();
  writeFileSync(
    join(
      on.machine.prefix,
      "lib",
      "node_modules",
      "chuggy-linux",
      "package.json",
    ),
    JSON.stringify({ name: "chuggy-linux", version: "0.13.0" }),
  );
  for (const project of on.installation.world.projects)
    project.threads = "Pool";
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  const command = join(on.machine.prefix, "bin", "chuggy-linux");
  assert.deepEqual(done.lines, [
    `site: ${on.installation.site}, signed in`,
    found.engine,
    found.settings,
    found.login,
    `found: the runner package is installed: chuggy-linux 0.13.0, at ${command}, and chuggy setup needs 0.14.0 or later`,
    did.package,
    found.pool,
    found.check,
    found.unit,
    found.linger,
    did.restarted,
    found.live,
    did.own,
    did.ownUnit,
    did.ownStarted,
    did.serves,
    found.ownLive,
    next,
  ]);
  assert.deepEqual(installs(), [install]);
  assert.equal(acts(on).filter((act) => act === "restart").length, 1);
  assert.deepEqual(on.installation.writes, [ownMint, ownRedemption, serves]);
  unasked(on);
});

type Did = ReturnType<typeof lines>["did"];

/** One thing a machine that was set up can lose: how it is lost, what a run then says it did, what it ran, and what it sent the site. */
interface Loss {
  readonly lost: string;
  readonly lose: (on: Stood) => void;
  readonly did: (did: Did) => readonly string[];
  readonly acts: readonly string[];
  readonly sent: readonly string[];
}

const restarted = ["reload", "restart", "active"];

const losses: readonly Loss[] = [
  {
    lost: "its service stopped",
    lose: (on) => {
      on.machine.keep({
        ...on.machine.state(),
        units: { [unit]: { enabled: true, active: false } },
      });
      for (const project of on.installation.world.projects)
        project.runner = "Offline";
    },
    did: (did) => [did.started],
    acts: [...rerun, "reload", "start", "active"],
    sent: [],
  },
  {
    lost: "its start at login",
    lose: (on) => {
      on.machine.keep({
        ...on.machine.state(),
        units: { [unit]: { enabled: false, active: true } },
      });
    },
    did: (did) => [did.enabled],
    acts: [...rerun, "reload", "start", "active"],
    sent: [],
  },
  {
    lost: "its services no longer outlive a logout",
    lose: (on) => {
      on.machine.keep({ ...on.machine.state(), linger: false });
    },
    did: (did) => [did.linger],
    acts: [...rerun.slice(0, 5), "lingerOn", ...rerun.slice(4)],
    sent: [],
  },
  {
    lost: "its unit",
    lose: (on) => {
      rmSync(join(on.machine.units, unit));
    },
    did: (did) => [did.unit, did.restarted],
    acts: [...rerun, ...restarted],
    sent: [],
  },
  {
    lost: "its unit to one another copy of the package wrote",
    lose: (on) => {
      const path = join(on.machine.units, unit);
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          /^ExecStart=\S+ \S+/mu,
          "ExecStart=/usr/bin/node /usr/lib/node_modules/chuggy-linux/cli.mjs",
        ),
      );
    },
    did: (did) => [did.unit, did.restarted],
    acts: [...rerun, ...restarted],
    sent: [],
  },
  {
    lost: "its registration",
    lose: (on) => {
      rmSync(join(on.machine.pools, poolFile));
    },
    did: (did) => [did.pool, did.restarted],
    acts: [...rerun.slice(0, 2), "register", ...rerun.slice(2), ...restarted],
    sent: [mint, redemption],
  },
  {
    lost: "the package",
    lose: (on) => {
      rmSync(join(on.machine.prefix, "bin", "chuggy-linux"));
    },
    did: (did) => [did.package, did.restarted],
    acts: [
      ...probes.slice(0, 2),
      "install",
      "doctor",
      "service",
      ...probes.slice(3),
      ...restarted,
    ],
    sent: [],
  },
  {
    lost: "its settings",
    lose: (on) => {
      rmSync(on.machine.settings);
    },
    did: (did) => [did.settings],
    acts: rerun,
    sent: [],
  },
];

test("a machine that was set up and has since lost one thing is given that thing back and nothing else, whichever it lost", async () => {
  const on = await setUp();
  const { found, did } = lines(on);
  for (const loss of losses) {
    loss.lose(on);
    cleared(on);
    const run = await ran(on);
    assert.equal(run.code, 0, `${loss.lost}: ${run.stdout}`);
    assert.deepEqual(
      run.lines.filter((line) => line.startsWith("did: ")),
      loss.did(did),
      loss.lost,
    );
    assert.deepEqual(acts(on), loss.acts, loss.lost);
    assert.deepEqual(on.installation.writes, loss.sent, loss.lost);
    assert.deepEqual(run.lines.slice(-2), [found.live, next], loss.lost);
  }
  unasked(on);
});

test("where the machine's own prefix is not this person's to write, the package goes under their own, by the console's install command with that prefix named, and no password is asked for", async () => {
  const on = await stood();
  const sealed = join(on.machine.prefix, "bin");
  chmodSync(sealed, 0o555);
  try {
    const done = await ran(on);
    assert.equal(done.code, 0, done.stdout);
    const address = runnerPackageOffered.installCommand.split(" ").at(-1);
    assert.deepEqual(words(on, "npm")[1], [
      "i",
      "-g",
      "--prefix",
      on.machine.own,
      address,
    ]);
    const own = join(on.machine.own, "bin", "chuggy-linux");
    assert.ok(
      done.lines.includes(
        `did: installed the runner package, chuggy-linux 0.14.0, at ${own}`,
      ),
      done.stdout,
    );
    assert.equal(words(on, "chuggy-linux").length, 3);
    assert.equal(done.lines.at(-1), next);
    unasked(on);
  } finally {
    chmodSync(sealed, 0o755);
  }
});

test("where the person keeps their configuration in a directory of their own choosing, the runner's things are looked for and put there and nowhere under the usual one", async () => {
  const on = await stood();
  const config = join(on.home.beside, "config");
  mkdirSync(join(config, "chuggy-linux"), { recursive: true });
  renameSync(on.machine.login, join(config, "chuggy-linux", "claude-token"));
  const done = await ran(on, runner, { XDG_CONFIG_HOME: config });
  assert.equal(done.code, 0, done.stdout);
  assert.equal(done.lines.at(-1), next);
  for (const made of [
    join("chuggy-linux", "runner.json"),
    join("chuggy", "pools", poolFile),
    join("systemd", "user", unit),
  ])
    assert.ok(existsSync(join(config, made)), made);
  for (const usual of [on.machine.settings, on.machine.pools, on.machine.units])
    assert.ok(!existsSync(usual), usual);
});

/** The names a run's environment holds: what a home sets, the user this suite has it take itself for, and what a shell adds of its own. */
const environmentNames = [
  userSaid,
  "BROWSER",
  "GIT_CEILING_DIRECTORIES",
  "HOME",
  "NODE_OPTIONS",
  "OLDPWD",
  "PATH",
  "PWD",
  "SHLVL",
  "_",
];

test("a run is given nothing of the suite's own surroundings: the programs it finds by name are its home's own, and no name of the suite's environment reaches it or what it starts", async () => {
  const on = await stood();
  const kept = join(on.home.beside, "environment");
  writeFileSync(
    join(on.home.bin, "git"),
    `#!/bin/sh\nexec '${process.execPath}' -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify(process.env))' '${kept}'\n`,
    { mode: 0o755 },
  );
  const before = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = join(on.home.beside, "the-suite-s-own");
  try {
    await ran(on, []);
  } finally {
    if (before === undefined) delete process.env["XDG_CONFIG_HOME"];
    else process.env["XDG_CONFIG_HOME"] = before;
  }
  const environment = JSON.parse(readFileSync(kept, "utf8")) as Record<
    string,
    string
  >;
  assert.equal(environment["PATH"], on.home.bin);
  assert.equal(environment["HOME"], on.home.home);
  assert.deepEqual(
    Object.keys(environment).filter((name) => !environmentNames.includes(name)),
    [],
  );
  assert.ok((process.env["PATH"] ?? "") !== on.home.bin);
});

test("across every run of this suite, nothing the site or the issuer handed out and nothing of the runner's Claude login is in anything the program wrote", () => {
  stoodSearched();
});
