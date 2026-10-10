/**
 * `runner` as a process, on a stand-in machine and against a stand-in
 * installation: the real program, real children, real files and real HTTP,
 * with nothing of this machine in any of it.
 *
 * These are the cases only real processes make. The registration token is one
 * word of one child's arguments and is in nothing the program writes, also
 * where that child says it back, whole or in pieces, as it fails. Every child
 * is given nothing to read and a session of its own, so none can ask a person
 * for a password, and no command that asks for one is run. The site is sent
 * one write by the program, the mint, and none where the machine is already
 * registered. Every run takes itself for the user the runner package takes
 * docker from unless its case says another, whoever the suite runs as. The
 * last case is the control: everything every run here wrote is searched for
 * everything the stand-ins handed out and for the runner's Claude login.
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
import { boxActOf } from "../../ui/chuggy-ui/test/setupRunnerBox.ts";
import { rosterLines } from "../../ui/chuggy-ui/test/setupRunnerRoster.ts";
import { setupSiteAt } from "../../ui/chuggy-ui/test/setupSite.ts";
import {
  machineAskers,
  machineLoginSecret,
  machineStoodIn,
} from "./machine.ts";
import type { Machine } from "./machine.ts";
import {
  dialect,
  making,
  platformSaid,
  program,
  shellWords,
  signedIn,
  userSaid,
} from "./program.ts";
import type { Home, Ran } from "./program.ts";
import type { StandIn } from "./standIn.ts";

const made = making();

interface Stood {
  readonly installation: StandIn;
  readonly home: Home;
  readonly machine: Machine;
}

/** Every machine this suite stood up, for the control to search. */
const stoodAll: Stood[] = [];

const runner = ["runner", "--workspace", "acme", "--project", "widgets"];
const flags = "--workspace acme --project widgets";
const poolFile = "acme.widgets.shame.json";
const unit = "chuggy-linux-acme.widgets.shame.service";
/** The user a run here takes itself for, by number: the one the runner package takes docker from, and for the cases that say so one it does not. */
const user = "1000";
const other = "1001";
const mint =
  "program POST /api/v1/tenants/acme/projects/widgets/worker-pool-registration-tokens";
const redemption = "runner POST /api/v1/worker-pool-registrations";
const next = `next: node ${program} ${flags}`;
const again = `rule: Run node ${program} runner ${flags} only `;

/** A machine a runner could be put on, signed in to an installation whose project is set up as far as a runner, with nothing yet kept of what was asked or run. */
async function stood(): Promise<Stood> {
  const installation = await made.installation();
  const home = made.machine();
  const machine = machineStoodIn(home, installation);
  const done = await signedIn(installation, home);
  assert.equal(done.code, 0, done.stdout);
  installation.world = setupSiteAt("Configured");
  installation.asked.length = 0;
  machine.forget();
  const on = { installation, home, machine };
  stoodAll.push(on);
  return on;
}

/** Everything the stand-ins handed out on this machine that nothing the program writes may hold. */
function secrets(on: Stood): readonly string[] {
  return [
    ...on.installation.world.secrets,
    ...on.installation.issued,
    machineLoginSecret,
  ];
}

/** One run, which is in the dialect and holds no secret whatever it met. */
async function ran(
  on: Stood,
  argv: readonly string[] = runner,
  environment?: Readonly<Record<string, string>>,
): Promise<Ran> {
  const done = await on.home.run(argv, { [userSaid]: user, ...environment });
  dialect(done, done.stdout);
  for (const secret of secrets(on))
    assert.ok(!done.stdout.includes(secret), done.stdout);
  return done;
}

function lines(on: Stood, engine: "docker" | "podman" = "docker") {
  return rosterLines({
    command: join(on.machine.prefix, "bin", "chuggy-linux"),
    settings: on.machine.settings,
    login: on.machine.login,
    pool: join(on.machine.pools, poolFile),
    unit,
    engine,
  });
}

/** What each command run was for, in order, but for the ones that are no act of `runner`'s. */
function acts(on: Stood): readonly string[] {
  return on.machine
    .calls()
    .flatMap((call) => boxActOf([call.name, ...call.argv]) ?? []);
}

/** The words each command of this name was run with. */
function words(on: Stood, name: string): readonly (readonly string[])[] {
  return on.machine
    .calls()
    .filter((call) => call.name === name)
    .map((call) => call.argv);
}

/** The arguments of a command the program printed, as a shell makes words of it. */
async function commanded(command: string): Promise<readonly string[]> {
  const [node, script, ...argv] = await shellWords(command);
  assert.deepEqual([node, script], ["node", program], command);
  return argv;
}

/** No command run so far could have asked anyone for a password: each was given nothing to read, each led a session of its own, and none is a command that asks. */
function unasked(on: Stood): void {
  const calls = on.machine.calls();
  assert.ok(calls.length > 0);
  for (const call of calls) {
    const said = JSON.stringify(call);
    assert.equal(call.stdin, "/dev/null", said);
    assert.ok(!machineAskers.some((asker) => asker === call.name), said);
    assert.ok(call.leads, said);
    if (call.argv.includes("enable-linger"))
      assert.equal(call.argv[0], "--no-ask-password", said);
  }
}

const first = [
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
];

const probes = ["services", "docker", "doctor", "linger", "enabled", "active"];

/** A fresh machine taken through `runner` to a runner the site sees live. */
async function setUp(): Promise<Stood> {
  const on = await stood();
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.equal(done.lines.at(-1), next, done.stdout);
  return on;
}

/** Forgets what was asked and run, so a case reads only what its next run did. */
function cleared(on: Stood): void {
  on.machine.forget();
  on.installation.writes.length = 0;
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

test("a second run on a machine that has everything finds each thing as it is, runs nothing but its probes, and sends the site no write", async () => {
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
  assert.deepEqual(acts(on), probes);
  assert.deepEqual(on.installation.writes, []);
  assert.equal(on.installation.world.mints.length, 1);
  unasked(on);
});

const changing = new Set(first.filter((act) => !probes.includes(act)));

/** What the runner's settings hold, or nothing where there are none. */
function settings(on: Stood): string | undefined {
  return existsSync(on.machine.settings)
    ? readFileSync(on.machine.settings, "utf8")
    : undefined;
}

/** One run that stopped short of changing anything: it says what it found, names `runner` to be run again, and has installed nothing, written nothing and sent nothing but reads. */
async function unchanged(on: Stood, found: string, as = user): Promise<void> {
  const before = settings(on);
  const done = await ran(on, runner, { [userSaid]: as });
  assert.equal(done.code, 0, done.stdout);
  assert.equal(done.lines.at(-1), "next: stop", done.stdout);
  assert.ok(
    done.lines.some((line) => line.startsWith(found)),
    done.stdout,
  );
  assert.ok(
    done.lines.some((line) => line.startsWith(again)),
    done.stdout,
  );
  assert.deepEqual(
    acts(on).filter((act) => changing.has(act)),
    [],
  );
  assert.deepEqual(on.installation.writes, []);
  assert.equal(settings(on), before, found);
  assert.ok(!existsSync(on.machine.pools), found);
  assert.ok(!/setup-token|sk-ant|OAUTH/u.test(done.stdout), done.stdout);
}

test("a machine that could not take a runner, or lacks what this program cannot make, stops the run with nothing installed, nothing written and nothing sent but reads", async () => {
  const lacks: readonly (readonly [(on: Stood) => void, string])[] = [
    [
      (on) => {
        on.machine.tell({ engines: { docker: false } });
      },
      "found: docker did not answer you without a password; podman is not installed",
    ],
    [
      (on) => {
        on.machine.tell({ services: false });
      },
      "found: this machine's user services did not answer systemctl --user",
    ],
    [
      (on) => {
        rmSync(on.machine.login);
      },
      "found: the runner has no Claude login on this machine: nothing is at ",
    ],
    [
      (on) => {
        on.machine.has("npm", false);
      },
      "found: the runner package is not installed, and npm did not answer",
    ],
  ];
  for (const [lack, found] of lacks) {
    const on = await stood();
    lack(on);
    await unchanged(on, found);
    assert.equal(settings(on), undefined, found);
  }
});

test("a user the runner package bars from docker is stopped before anything is changed where podman is not there, where it does not answer them, and where the settings set the runner to use docker, and docker is never run", async () => {
  const bars: readonly (readonly [(on: Stood) => void, string])[] = [
    [
      () => undefined,
      "found: podman is not installed, and docker was not asked: the runner package takes docker only from this machine's user 1000",
    ],
    [
      (on) => {
        on.machine.has("podman");
        on.machine.tell({ engines: { docker: true, podman: false } });
      },
      "found: podman did not answer you without a password, and docker was not asked: ",
    ],
    [
      (on) => {
        on.machine.has("podman");
        writeFileSync(
          on.machine.settings,
          JSON.stringify({ claudeTokenFile: on.machine.login }),
        );
      },
      "found: the runner is set to use docker, in ",
    ],
  ];
  for (const [bar, found] of bars) {
    const on = await stood();
    bar(on);
    await unchanged(on, found, other);
    assert.deepEqual(words(on, "docker"), [], found);
    unasked(on);
  }
});

test("a user the runner package bars from docker is asked podman alone, and where it answers them the runner is set up on it: podman is what the settings name, and docker is never run", async () => {
  const on = await stood();
  on.machine.has("podman");
  const as = { [userSaid]: other };
  const { found, did } = lines(on, "podman");
  const offered = await ran(on, [], as);
  assert.equal(offered.lines.at(-1), "next: stop");
  assert.deepEqual(acts(on), ["services", "podman"]);
  const done = await ran(on, runner, as);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(1, 5), [
    found.engine,
    found.login,
    did.package,
    did.settings,
  ]);
  assert.deepEqual(done.lines.slice(-2), [found.live, next]);
  assert.deepEqual(words(on, "docker"), []);
  const settings = JSON.parse(
    readFileSync(on.machine.settings, "utf8"),
  ) as Record<string, unknown>;
  assert.equal(settings["engine"], "podman");
  assert.deepEqual(words(on, "loginctl")[0], [
    "show-user",
    other,
    "--property",
    "Linger",
  ]);
  unasked(on);

  cleared(on);
  const second = await ran(on, runner, as);
  assert.deepEqual(second.lines.slice(-2), [found.live, next]);
  assert.deepEqual(acts(on), ["services", "podman", ...probes.slice(2)]);
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
    acts: [...probes, "reload", "start", "active"],
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
    acts: [...probes, "reload", "start", "active"],
    sent: [],
  },
  {
    lost: "its services no longer outlive a logout",
    lose: (on) => {
      on.machine.keep({ ...on.machine.state(), linger: false });
    },
    did: (did) => [did.linger],
    acts: [...probes.slice(0, 4), "lingerOn", ...probes.slice(3)],
    sent: [],
  },
  {
    lost: "its unit",
    lose: (on) => {
      rmSync(join(on.machine.units, unit));
    },
    did: (did) => [did.unit, did.restarted],
    acts: [...probes.slice(0, 3), "service", ...probes.slice(3), ...restarted],
    sent: [],
  },
  {
    lost: "its registration",
    lose: (on) => {
      rmSync(join(on.machine.pools, poolFile));
    },
    did: (did) => [did.pool, did.restarted],
    acts: [...probes.slice(0, 2), "register", ...probes.slice(2), ...restarted],
    sent: [mint, redemption],
  },
  {
    lost: "the package",
    lose: (on) => {
      rmSync(join(on.machine.prefix, "bin", "chuggy-linux"));
    },
    did: (did) => [did.package, did.unit, did.restarted],
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
    acts: probes,
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
        `did: installed the runner package, chuggy-linux 0.3.0, at ${own}`,
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

/** As long a stretch of a registration token as is in no other word a run prints. */
const stretch = 16;

/** Whether any stretch of a secret is in a text, which is the secret said whole or in pieces. */
function pieced(text: string, secret: string): boolean {
  return Array.from({ length: secret.length - stretch + 1 }, (_, at) =>
    secret.slice(at, at + stretch),
  ).some((piece) => text.includes(piece));
}

test("a registration that fails saying its own arguments back, whole and in halves, has nothing it printed said of it: the package's own refusal is told in this program's words with no piece of the token, and the token it lost is left unredeemed while the next run mints another and finishes", async () => {
  const on = await stood();
  on.machine.tell({
    fails: {
      register: {
        exit: 1,
        aside: `chuggy at ${on.installation.site} did not answer the registration: fetch failed`,
        echoes: true,
      },
    },
  });
  const failed = await ran(on);
  assert.equal(failed.code, 1, failed.stdout);
  const [lost = ""] = on.installation.world.secrets;
  assert.ok(
    words(on, "chuggy-linux")[0]?.includes(`--token=${lost}`),
    "the child was given the token, and said it back",
  );
  assert.ok(lost.length > stretch && !pieced(failed.stdout, lost));
  assert.ok(pieced(`said ${lost.slice(0, stretch)} back`, lost));
  assert.ok(!failed.stdout.includes("fetch failed"), failed.stdout);
  assert.ok(
    failed.lines.includes(
      "found: registering this machine ended with exit 1: the site did not answer the runner package",
    ),
    failed.stdout,
  );
  assert.equal(failed.lines.at(-1), "next: stop");
  assert.ok(failed.lines.at(-2)?.startsWith(again), failed.stdout);
  assert.deepEqual(on.installation.writes, [mint]);

  on.machine.tell({ fails: {} });
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(on.installation.writes, [mint, redemption]);
  assert.equal(on.installation.world.mints.length, 2);
  assert.deepEqual(on.installation.world.projects[0]?.tokens, [lost]);
  assert.equal(done.lines.at(-1), next);
});

test("the runner's own check failing with a secret in what it says is told with the secret struck out, and nothing is started", async () => {
  const on = await stood();
  on.machine.tell({
    doctor: {
      exit: 1,
      aside: `FAIL  Claude token file: ${machineLoginSecret} is no login\n`,
    },
  });
  const failed = await ran(on);
  assert.equal(failed.code, 1, failed.stdout);
  assert.ok(
    failed.lines.includes(
      "found: the runner's Claude login is not as it needs it; the runner's own check said: FAIL Claude token file: [redacted] is no login",
    ),
    failed.stdout,
  );
  assert.equal(acts(on).at(-1), "doctor");
});

test("where keeping services running after a logout wants a password, none is taken: the person is told the command to run themselves, and the run after they have finishes", async () => {
  const on = await stood();
  on.machine.tell({ lingerAsks: true });
  const asked = await ran(on);
  assert.equal(asked.code, 0, asked.stdout);
  assert.equal(asked.lines.at(-1), "next: stop");
  assert.ok(asked.lines.at(-2)?.startsWith(again), asked.stdout);
  assert.match(
    asked.lines.at(-3) ?? "",
    /^tell: .* In a terminal of your own, run loginctl enable-linger and tell me once you have\.$/u,
  );
  assert.deepEqual(words(on, "loginctl"), [
    ["show-user", user, "--property", "Linger"],
    ["--no-ask-password", "enable-linger", user],
  ]);
  assert.ok(!acts(on).includes("start"));
  unasked(on);

  on.machine.keep({ ...on.machine.state(), linger: true });
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.ok(done.lines.includes(lines(on).found.linger), done.stdout);
  assert.deepEqual(done.lines.slice(-2), [lines(on).found.live, next]);
  assert.deepEqual(on.installation.writes, []);
});

test("a runner that is started and that the site does not see live within the wait is a failure that says how long was waited, having asked the service manager once more whether it still runs, and the run after it is seen ends on the checklist", async () => {
  const on = await stood();
  on.machine.tell({ polls: false });
  const waited = await ran(on, [...runner, "--wait-secs", "2"]);
  assert.equal(waited.code, 1, waited.stdout);
  assert.ok(
    waited.lines.includes(
      "found: the runner's service is running, and after 2 s the site still sees no runner of acme/widgets live",
    ),
    waited.stdout,
  );
  assert.equal(waited.lines.at(-1), "next: stop");
  assert.ok(waited.lines.at(-2)?.startsWith(again), waited.stdout);
  assert.deepEqual(acts(on).slice(-3), ["start", "active", "active"]);

  on.machine.tell({ polls: true });
  cleared(on);
  const done = await ran(on);
  assert.deepEqual(done.lines.slice(-3), [
    lines(on).found.running,
    lines(on).found.live,
    next,
  ]);
  assert.deepEqual(on.installation.writes, []);
});

test("on a Mac runner says it cannot set one up and asks nothing of the machine or the site, and the bare command says the same of the runner's step and offers nothing", async () => {
  const on = await stood();
  const mac = { [platformSaid]: "darwin" };
  const done = await ran(on, runner, mac);
  assert.equal(done.code, 2, done.stdout);
  assert.equal(
    done.lines[0],
    "found: this machine is a Mac, and chuggy's runner runs on Linux",
  );
  assert.deepEqual(done.lines.slice(-2), [
    `rule: Run node ${program} ${flags} only once the person says a runner is running on another machine.`,
    "next: stop",
  ]);
  assert.deepEqual(on.machine.calls(), []);
  assert.deepEqual(on.installation.asked, []);

  const bare = await ran(on, [], mac);
  assert.equal(bare.code, 0, bare.stdout);
  assert.match(
    bare.lines.at(-3) ?? "",
    /^tell: .* This machine is a Mac and chuggy has no runner for a Mac yet, so it cannot be one\. /u,
  );
  assert.ok(!bare.stdout.includes(" runner --workspace"), bare.stdout);
  assert.deepEqual(acts(on), []);
  assert.deepEqual(on.installation.writes, []);
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
  const handed = stoodAll.flatMap((on) => on.installation.world.secrets);
  for (const kind of ["registration", "credential"])
    assert.ok(
      handed.some((secret) => secret.startsWith(kind)),
      kind,
    );
  for (const on of stoodAll) {
    const wrote = on.home.written.join("\n");
    assert.ok(wrote.length > 0);
    for (const secret of secrets(on)) {
      assert.ok(secret.length >= 16, secret);
      assert.ok(!wrote.includes(secret));
    }
  }
  assert.ok(
    stoodAll.some((on) => on.home.written.join("\n").includes("[redacted]")),
  );
});
