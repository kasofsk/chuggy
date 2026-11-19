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
 * mints, and none of them where the machine already has what it needs. Most
 * cases are of a project whose chats run on the cluster, so of the project's
 * runner alone; the person's chat host beside it has cases of its own. Every run
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
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { runnerPackages } from "../../ui/chuggy-ui/app/core/runners.ts";
import { setupSiteChatAdded } from "../../ui/chuggy-ui/test/setupSite.ts";
import { pacingVariable } from "../../ui/chuggy-ui/terminal/ports.ts";

import { machineLoginSecret } from "./machine.ts";
import { program, servedArguments, shellWords, userSaid } from "./program.ts";
import {
  type Stood,
  acts,
  again,
  chatFile,
  chatUnit,
  cleared,
  first,
  flags,
  lines,
  mcp,
  mint,
  next,
  personalFile,
  ran,
  redemption,
  rerun,
  runner,
  runnerAlone,
  serve,
  stood,
  stoodSearched,
  unasked,
  unit,
  user,
  words,
} from "./runnerStood.ts";

const chatMint =
  "program POST /api/v1/tenants/acme/chat-host-registration-tokens";
/** Where a chat host's token is redeemed, which is where a member's runner's is. */
const chatRedemption = "runner POST /api/v1/personal-runner-registrations";

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

test("on a fresh machine signed in, the bare command offers chuggy's MCP server once the project exists, having changed nothing, and the command its rule names installs the runner package and names the server in Claude Code here, after which the step is done with no second sign-in", async () => {
  const on = await stood("InCluster", false);
  const { did } = lines(on);
  const offered = await ran(on, []);
  assert.equal(offered.code, 0, offered.stdout);
  assert.ok(
    offered.lines.includes(
      "step: mcp         todo     Claude Code here has no chuggy MCP server for acme/widgets",
    ),
    offered.stdout,
  );
  const rule = offered.lines.at(-2) ?? "";
  const yes =
    " only once the person says yes to chuggy's MCP server on this machine.";
  assert.ok(rule.startsWith("rule: Run ") && rule.endsWith(yes), rule);
  assert.deepEqual(words(on, "npm"), [["prefix", "-g"]]);
  assert.deepEqual(words(on, "claude"), [["plugin", "list", "--json"]]);
  assert.deepEqual(on.installation.writes, []);

  cleared(on);
  const argv = await commanded(rule.slice("rule: Run ".length, -yes.length));
  assert.deepEqual(argv, mcp);
  const done = await ran(on, argv);
  assert.equal(done.code, 0, done.stdout);
  const command = join(on.machine.prefix, "bin", "chuggy-linux");
  const arguments_ = servedArguments(on.installation.site);
  assert.deepEqual(done.lines, [
    `site: ${on.installation.site}`,
    did.package,
    `did: named chuggy's MCP server for acme/widgets in Claude Code's configuration for this folder, in ${join(on.home.home, ".claude.json")}; a Claude Code session started here from now on has its tools`,
    `next: node ${program} ${flags}`,
  ]);
  assert.deepEqual(words(on, "claude"), [
    ["mcp", "add", "--scope", "local", "chuggy", "--", command, ...arguments_],
  ]);
  const config = JSON.parse(
    readFileSync(join(on.home.home, ".claude.json"), "utf8"),
  ) as {
    readonly projects: Record<
      string,
      { readonly mcpServers: Record<string, unknown> }
    >;
  };
  assert.deepEqual(config.projects[realpathSync(on.home.folder)]?.mcpServers, {
    chuggy: { type: "stdio", command, args: arguments_, env: {} },
  });
  assert.deepEqual(on.installation.writes, []);
  unasked(on);

  const after = await ran(
    on,
    await commanded(done.lines.at(-1)?.slice("next: ".length) ?? ""),
  );
  assert.equal(after.lines[0], `site: ${on.installation.site}, signed in`);
  assert.ok(
    after.lines.includes(
      "step: mcp         done     Claude Code here runs chuggy's MCP server for acme/widgets",
    ),
    after.stdout,
  );
  assert.deepEqual(
    on.installation.grants.filter((grant) =>
      grant.startsWith("authorization_code"),
    ),
    ["authorization_code granted"],
  );
  assert.ok(on.home.held(on.installation.site) === on.installation.renewal());
});

/** What a run that makes a fresh machine the person's runner says, up to the site seeing it live. */
function madeRunner(on: Stood): readonly string[] {
  const { found, did } = lines(on);
  return [
    `site: ${on.installation.site}, signed in`,
    found.engine,
    found.login,
    found.package,
    did.settings,
    did.personal,
    found.check,
    did.unit,
    did.linger,
    did.started,
    did.given,
    found.live,
  ];
}

test("on a machine `mcp` has put the runner package on, the bare command offers a runner having changed nothing, and the command its rule names registers, checks and starts one, with the token one word of one command, and ends on a checklist that says the runner live", async () => {
  const on = await stood();
  const offered = await ran(on, []);
  assert.equal(offered.code, 0, offered.stdout);
  assert.equal(offered.lines.at(-1), "next: stop");
  const rule = offered.lines.at(-3) ?? "";
  assert.ok(
    rule.startsWith("rule: Run ") && rule.endsWith(unlessObjected),
    rule,
  );
  assert.deepEqual(acts(on), ["services", "docker"]);
  assert.deepEqual(on.installation.writes, []);
  assert.ok(!existsSync(on.machine.settings));

  cleared(on);
  const argv = await commanded(
    rule.slice("rule: Run ".length, -unlessObjected.length),
  );
  assert.deepEqual(argv, runnerAlone);
  const done = await ran(on, argv);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines, [...madeRunner(on), next]);
  assert.deepEqual(acts(on), first);
  assert.deepEqual(on.installation.writes, [mint, redemption, ...serve]);
  const [token = ""] = on.installation.world.secrets;
  assert.deepEqual(words(on, "chuggy-linux")[0], [
    "register",
    "--personal",
    "--api",
    on.installation.site,
    `--token=${token}`,
  ]);
  const carrying = on.machine
    .calls()
    .flatMap((call) => call.argv)
    .filter((word) => word.includes(token));
  assert.equal(carrying.length, 1);
  assert.deepEqual(words(on, "npm"), [["prefix", "-g"]]);
  assert.deepEqual(words(on, "loginctl"), [
    ["show-user", user, "--property", "Linger"],
    ["--no-ask-password", "enable-linger", user],
    ["show-user", user, "--property", "Linger"],
  ]);
  unasked(on);
  assert.equal(readFileSync(on.machine.login, "utf8"), machineLoginSecret);

  const after = await ran(on, await commanded(next.slice("next: ".length)));
  assert.ok(after.lines.includes("step: runner      done     live"));
  assert.deepEqual(on.installation.writes, [mint, redemption, ...serve]);
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
    found.personal,
    found.check,
    found.unit,
    found.linger,
    found.running,
    found.given,
    found.live,
    next,
  ]);
  assert.deepEqual(acts(on), rerun);
  assert.deepEqual(on.installation.writes, []);
  assert.equal(on.installation.world.mints.length, 1);
  unasked(on);
});

/** How the bare command says the chat host it puts here beside the runner on an engine with room for three chats beside a run, and the rule that names the answer it does not take by default. */
const chatAsked =
  /^tell: I'll install your chat host and your runner on this machine, as yours alone\. (?!.*(?:GiB|MiB))/u;
const chatRuleNo =
  "rule: Run it with --chat-host no in place of --chat-host yes only where the person says they want no chat host. Before running it with --chat-host yes, tell the person: Downloading the chat image. This takes a few minutes the first time.";
/** The end of the rule an offer of a runner names its command under. */
const unlessObjected =
  " only once the person has been told what it does here, has not objected, and has not asked for it on another machine instead.";

/** Every write a run that makes this machine the person's runner and their chat host sends. */
const madeBoth = [mint, redemption, ...serve, chatMint, chatRedemption];

/** The chat host's size the runner's settings on the machine name. */
function settingsChat(on: Stood): unknown {
  const held = JSON.parse(readFileSync(on.machine.settings, "utf8")) as {
    readonly chat?: unknown;
  };
  return held.chat;
}

/** The words each registration was run with, the person's own runner's and their chat host's. */
function registrations(on: Stood): readonly (readonly string[])[] {
  return words(on, "chuggy-linux").filter((argv) => argv[0] === "register");
}

test("where the person's chats run on a chat host and they have none, the bare command offers it beside the runner by default and naming no size, and the command its rule names makes this machine the project's runner and then their chat host, sized in the one settings file to four chats on an engine with 11.7 GiB, on one package and one Claude login, and ends on a checklist that says the runner's step done", async () => {
  const on = await stood("Pool");
  const { found, did } = lines(on);
  const offered = await ran(on, []);
  assert.equal(offered.code, 0, offered.stdout);
  assert.match(offered.lines.at(-5) ?? "", chatAsked);
  assert.equal(offered.lines.at(-3), chatRuleNo);
  const rule = offered.lines.at(-4) ?? "";
  assert.ok(
    rule.startsWith("rule: Run ") && rule.endsWith(unlessObjected),
    rule,
  );
  assert.deepEqual(on.installation.writes, []);

  cleared(on);
  const done = await ran(
    on,
    await commanded(rule.slice("rule: Run ".length, -unlessObjected.length)),
  );
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines, [
    ...madeRunner(on),
    did.chatSized,
    did.chat,
    found.chatCheck,
    did.chatUnit,
    did.chatStarted,
    found.chatLive,
    next,
  ]);
  assert.deepEqual(settingsChat(on), {
    sessionsMax: 4,
    sessionMemoryMib: 1024,
  });
  assert.deepEqual(on.installation.writes, madeBoth);
  const [, token = ""] = on.installation.world.secrets.filter((secret) =>
    secret.includes("registration"),
  );
  assert.deepEqual(registrations(on)[1], [
    "register",
    "--api",
    on.installation.site,
    `--token=${token}`,
    "--chat",
  ]);
  assert.deepEqual(words(on, "chuggy-linux").at(-1), [
    "install-service",
    "--pool",
    join(on.machine.pools, chatFile),
  ]);
  assert.equal(acts(on).filter((act) => act === "install").length, 0);
  assert.ok(existsSync(join(on.machine.units, chatUnit)));
  assert.equal(readFileSync(on.machine.login, "utf8"), machineLoginSecret);
  unasked(on);

  const after = await ran(on, await commanded(next.slice("next: ".length)));
  assert.ok(after.lines.includes("step: runner      done     live"));
});

/** A fresh machine, where the person's chats run on a chat host, taken through `runner` to the project's runner and their chat host the site sees live. */
async function setUpBoth(): Promise<Stood> {
  const on = await stood("Pool");
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.equal(done.lines.at(-2), lines(on).found.chatLive, done.stdout);
  return on;
}

test("a second run where the project's runner and the person's chat host are both live changes nothing, says each thing as found, writes both units again only as they were, and sends the site no write", async () => {
  const on = await setUpBoth();
  const { found } = lines(on);
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(-7), [
    found.live,
    found.chat,
    found.chatCheck,
    found.chatUnit,
    found.chatRunning,
    found.chatLive,
    next,
  ]);
  assert.ok(!done.lines.some((line) => line.startsWith("did: ")));
  assert.deepEqual(acts(on), [
    ...rerun,
    "doctor",
    "service",
    "enabled",
    "active",
  ]);
  assert.deepEqual(on.installation.writes, []);
});

test("a workspace that does not let the person register a runner of their own stops the run before anything is minted, says an admin, who may be the person, turns on Personal runners for them with Edit on their row of the People page, and the run its rule names finishes the job", async () => {
  const on = await stood("Pool");
  on.installation.world.withheld.add("acme");
  const withheld = await ran(on);
  assert.equal(withheld.code, 0, withheld.stdout);
  assert.deepEqual(withheld.lines.slice(-4), [
    "found: the workspace does not let you register a runner of your own",
    `tell: Your work in acme/widgets runs on a runner of your own, and the workspace does not let you register one yet. An admin of the workspace, you if you are one, turns on Personal runners for you on its People page, ${on.installation.site}/tenants/acme/settings/people, with Edit on your row. Tell me once it is on.`,
    `${again}once the person says Personal runners is on for them in the workspace.`,
    "next: stop",
  ]);
  assert.deepEqual(on.installation.writes, []);
  assert.equal(registrations(on).length, 0);

  on.installation.world.withheld.delete("acme");
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(-2), [lines(on).found.chatLive, next]);
  assert.deepEqual(on.installation.writes, madeBoth);
});

test("a chat host of the person's live on another machine is left serving their chats, and this machine is registered as nothing but the project's runner", async () => {
  const on = await stood("Pool");
  const { found } = lines(on);
  const elsewhere = setupSiteChatAdded(on.installation.world, "acme", true);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(-3), [
    found.live,
    found.chatElsewhere,
    next,
  ]);
  assert.deepEqual(on.installation.writes, [mint, redemption, ...serve]);
  assert.equal(registrations(on).length, 1);
  assert.ok(!existsSync(join(on.machine.pools, chatFile)));
  assert.deepEqual(on.installation.world.chat.get("acme"), {
    id: elsewhere,
    live: true,
  });
});

test("a chat host of the person's removed on the My runners page is said, and this machine is registered as it again, its file replaced and its service restarted, and waited on until the site sees it live", async () => {
  const on = await setUpBoth();
  const { found, did } = lines(on);
  on.installation.world.chat.delete("acme");
  cleared(on);
  const done = await ran(on);
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(done.lines.slice(-7), [
    found.chatGone,
    did.chat,
    found.chatCheck,
    found.chatUnit,
    did.chatRestarted,
    found.chatLive,
    next,
  ]);
  assert.deepEqual(on.installation.writes, [chatMint, chatRedemption]);
  assert.equal(registrations(on).length, 1);
  assert.deepEqual(on.installation.world.chat.get("acme"), {
    id: "chuggy-chat-2",
    live: true,
  });
});

/** The ways a machine that was set up can come to have no runner package `runner` can use: one older than the first that updates itself, and none at all. */
const unpackaged: readonly (readonly [string, (on: Stood) => void])[] = [
  [
    "older",
    (on) => {
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
    },
  ],
  [
    "gone",
    (on) => {
      rmSync(join(on.machine.prefix, "bin", "chuggy-linux"));
    },
  ],
];

test("a machine that was set up and has since come to have no runner package runner can use, older or gone, is sent to mcp having changed nothing, which installs it again by the same command, and the run after finishes the job on it", async () => {
  for (const [how, lose] of unpackaged) {
    const on = await setUp();
    const { found, did } = lines(on);
    const installs = () => words(on, "npm").filter((argv) => argv[0] === "i");
    lose(on);
    for (const project of on.installation.world.projects)
      project.threads = "Pool";
    cleared(on);
    const stopped = await ran(on);
    assert.equal(stopped.code, 0, `${how}: ${stopped.stdout}`);
    assert.equal(
      stopped.lines.at(-2),
      `rule: Run node ${program} mcp ${flags} only once the person says yes to chuggy-linux and chuggy's MCP server on this machine.`,
      how,
    );
    assert.deepEqual(acts(on), ["services", "docker"], how);
    assert.deepEqual(on.installation.writes, [], how);

    cleared(on);
    const served = await ran(on, mcp);
    assert.equal(served.code, 0, `${how}: ${served.stdout}`);
    assert.ok(served.lines.includes(did.package), served.stdout);
    assert.deepEqual(
      installs(),
      [runnerPackages.linux.installCommand.split(" ").slice(1)],
      how,
    );

    cleared(on);
    const done = await ran(on);
    assert.equal(done.code, 0, `${how}: ${done.stdout}`);
    assert.deepEqual(
      done.lines,
      [
        `site: ${on.installation.site}, signed in`,
        found.engine,
        found.settings,
        found.login,
        found.package,
        found.personal,
        found.check,
        found.unit,
        found.linger,
        found.running,
        found.given,
        found.live,
        did.chatSized,
        did.chat,
        found.chatCheck,
        did.chatUnit,
        did.chatStarted,
        found.chatLive,
        next,
      ],
      how,
    );
    assert.deepEqual(installs(), [], how);
    assert.deepEqual(on.installation.writes, [chatMint, chatRedemption], how);
    unasked(on);
  }
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

const restarted = ["reload", "restart", "shown"];

const losses: readonly Loss[] = [
  {
    lost: "its service stopped",
    lose: (on) => {
      on.machine.keep({
        ...on.machine.state(),
        units: { [unit]: { enabled: true, active: false } },
      });
    },
    did: (did) => [did.started],
    acts: [...rerun, "reload", "start", "shown"],
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
    acts: [...rerun, "reload", "start", "shown"],
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
      rmSync(join(on.machine.pools, personalFile));
    },
    did: (did) => [did.personal, did.restarted],
    acts: [...rerun.slice(0, 2), "register", ...rerun.slice(2), ...restarted],
    sent: [mint, redemption],
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

test("where the machine's own prefix is not this person's to write, mcp puts the package under their own, by the console's install command with that prefix named, and no password is asked for", async () => {
  const on = await stood("InCluster", false);
  const sealed = join(on.machine.prefix, "bin");
  chmodSync(sealed, 0o555);
  try {
    const served = await ran(on, mcp);
    assert.equal(served.code, 0, served.stdout);
    const done = await ran(on);
    assert.equal(done.code, 0, done.stdout);
    const address = runnerPackages.linux.installCommand.split(" ").at(-1);
    assert.deepEqual(words(on, "npm")[1], [
      "i",
      "-g",
      "--prefix",
      on.machine.own,
      address,
    ]);
    const own = join(on.machine.own, "bin", "chuggy-linux");
    assert.ok(
      served.lines.includes(
        `did: installed the runner package, chuggy-linux 0.35.0, at ${own}`,
      ),
      served.stdout,
    );
    assert.ok(
      done.lines.includes(
        `found: the runner package is installed: chuggy-linux 0.35.0, at ${own}`,
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
  mkdirSync(join(config, "chuggy-linux", "claude"), { recursive: true });
  mkdirSync(join(config, "chuggy"));
  renameSync(on.machine.login, join(config, "chuggy-linux", "claude", "token"));
  renameSync(on.home.store, join(config, "chuggy", "sign-ins"));
  const done = await ran(on, runner, { XDG_CONFIG_HOME: config });
  assert.equal(done.code, 0, done.stdout);
  assert.equal(done.lines.at(-1), next);
  for (const made of [
    join("chuggy-linux", "runner.json"),
    join("chuggy", "pools", personalFile),
    join("systemd", "user", unit),
  ])
    assert.ok(existsSync(join(config, made)), made);
  for (const usual of [on.machine.settings, on.machine.pools, on.machine.units])
    assert.ok(!existsSync(usual), usual);
});

/** The names a run's environment holds: what a home sets, the user this suite has it take itself for, and what a shell adds of its own. */
const environmentNames = [
  userSaid,
  pacingVariable,
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
